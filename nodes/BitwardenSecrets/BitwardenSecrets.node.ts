import { BitwardenClient, LogLevel } from '@bitwarden/sdk-wasm';
import {
	IExecuteFunctions,
	INodeExecutionData,
	INodeType,
	INodeTypeDescription,
	NodeOperationError,
} from 'n8n-workflow';

// ── Types ────────────────────────────────────────────────────────────────────

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Envelope returned by every client.run_command() call */
interface SdkResponse {
	success: boolean;
	data?: unknown;
	errorMessage?: string | null;
}

/** Fields we care about from a decrypted secret */
interface SecretData {
	id?: string;
	organizationId?: string;
	projectId?: string | null;
	key?: string;
	value?: string;
	note?: string;
	creationDate?: string;
	revisionDate?: string;
}

// ── Singleton client ──────────────────────────────────────────────────────────
// The WASM SDK initializes a global logger inside the BitwardenClient constructor.
// Constructing more than one instance in the same Node.js process panics with
// SetLoggerError(()). We keep a single instance alive for the lifetime of the
// process and authenticate fresh on every execute() call.

let _sdkClient: BitwardenClient | null = null;

function getBitwardenClient(): BitwardenClient {
	if (!_sdkClient) {
		_sdkClient = new BitwardenClient(
			JSON.stringify({
				apiUrl: 'https://api.bitwarden.com',
				identityUrl: 'https://identity.bitwarden.com',
				userAgent: 'n8n-bitwarden-secrets/0.1.0',
				deviceType: 21, // DeviceType.SDK
			}),
			LogLevel.Info,
		);
	}
	return _sdkClient;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function sanitize(msg: string | undefined): string {
	if (!msg) return 'Unknown error';
	return msg
		.replace(/[A-Za-z0-9+/=]{40,}/g, '[REDACTED]')
		.substring(0, 500);
}

async function runCommand(
	client: BitwardenClient,
	command: object,
): Promise<unknown> {
	const raw = await client.run_command(JSON.stringify(command));
	const res = JSON.parse(raw) as SdkResponse;
	if (!res.success) {
		throw new Error(sanitize(res.errorMessage ?? undefined));
	}
	return res.data ?? null;
}

// ── Node definition ───────────────────────────────────────────────────────────

export class BitwardenSecrets implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Bitwarden Secrets',
		name: 'bitwardenSecrets',
		icon: 'file:bitwardenSecrets.svg',
		group: ['transform'],
		version: 1,
		subtitle: '={{$parameter["operation"]}}',
		description:
			'Retrieve secrets from Bitwarden Secrets Manager by UUID (powered by @bitwarden/sdk-wasm)',
		defaults: {
			name: 'Bitwarden Secrets',
		},
		inputs: ['main'],
		outputs: ['main'],
		credentials: [
			{
				name: 'bitwardenSecretsManagerApi',
				required: true,
			},
		],
		properties: [
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				options: [
					{
						name: 'Get Secret by ID',
						value: 'getSecret',
						description:
							'Retrieve a secret from Bitwarden Secrets Manager by its UUID',
						action: 'Get a secret by ID',
					},
				],
				default: 'getSecret',
			},
			{
				displayName: 'Secret ID',
				name: 'secretId',
				type: 'string',
				default: '',
				required: true,
				placeholder: 'e.g. 2863ced6-eba1-48b4-b5c0-afa30104877a',
				description:
					'UUID of the secret to retrieve. Supports expressions, e.g. <code>{{$json.secretId}}</code>.',
				displayOptions: {
					show: {
						operation: ['getSecret'],
					},
				},
			},
		],
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const returnData: INodeExecutionData[] = [];

		// ── Credentials ───────────────────────────────────────────────────────────
		const credentials = await this.getCredentials('bitwardenSecretsManagerApi');
		const accessToken = (credentials.accessToken as string | undefined)?.trim();

		if (!accessToken) {
			throw new NodeOperationError(
				this.getNode(),
				'Access Token is missing. Configure the Bitwarden Secrets Manager API credential.',
			);
		}

		// ── SDK client (singleton) ───────────────────────────────────────────────
		const client = getBitwardenClient();

		// ── Authenticate (once per execution) ────────────────────────────────────
		try {
			await runCommand(client, {
				loginAccessToken: { accessToken },
			});
		} catch (authErr: unknown) {
			const msg =
				authErr instanceof Error ? authErr.message : String(authErr);
			if (/unauthorized|401|invalid.*token|access.*denied/i.test(msg)) {
				throw new NodeOperationError(
					this.getNode(),
					'Authentication failed. Verify the Access Token in the Bitwarden Secrets Manager API credential.',
				);
			}
			throw new NodeOperationError(
				this.getNode(),
				`Failed to authenticate with Bitwarden Secrets Manager: ${sanitize(msg)}`,
			);
		}

		// ── Per-item secret retrieval ─────────────────────────────────────────────
		for (let i = 0; i < items.length; i++) {
			try {
				const rawId = this.getNodeParameter('secretId', i) as string;
				const secretId = rawId?.trim();

				if (!secretId) {
					throw new NodeOperationError(
						this.getNode(),
						'Secret ID is required',
						{ itemIndex: i },
					);
				}

				if (!UUID_REGEX.test(secretId)) {
					throw new NodeOperationError(
						this.getNode(),
						`Invalid Secret ID format: "${secretId}". ` +
							'Expected a UUID like 2863ced6-eba1-48b4-b5c0-afa30104877a.',
						{ itemIndex: i },
					);
				}

				let rawData: unknown;
				try {
					rawData = await runCommand(client, {
						secrets: { get: { id: secretId } },
					});
				} catch (fetchErr: unknown) {
					const msg =
						fetchErr instanceof Error ? fetchErr.message : String(fetchErr);
					if (/not.?found|404/i.test(msg)) {
						throw new NodeOperationError(
							this.getNode(),
							`Secret not found: ${secretId}`,
							{ itemIndex: i },
						);
					}
					if (/forbidden|403|unauthorized|permission/i.test(msg)) {
						throw new NodeOperationError(
							this.getNode(),
							`Permission denied for secret: ${secretId}. ` +
								'Ensure the Machine Account has read access to the project.',
							{ itemIndex: i },
						);
					}
					throw new NodeOperationError(
						this.getNode(),
						`Failed to retrieve secret ${secretId}: ${sanitize(msg)}`,
						{ itemIndex: i },
					);
				}

				if (rawData == null) {
					throw new NodeOperationError(
						this.getNode(),
						`Secret not found or empty response for: ${secretId}`,
						{ itemIndex: i },
					);
				}

				const secret = rawData as SecretData;

				returnData.push({
					json: {
						id: secret.id ?? null,
						key: secret.key ?? null,
						value: secret.value ?? null,
						projectId: secret.projectId ?? null,
						creationDate: secret.creationDate ?? null,
						revisionDate: secret.revisionDate ?? null,
					},
					pairedItem: { item: i },
				});
			} catch (itemErr: unknown) {
				if (this.continueOnFail()) {
					const msg =
						itemErr instanceof NodeOperationError
							? itemErr.message
							: sanitize(
									itemErr instanceof Error
										? itemErr.message
										: String(itemErr),
								);
					returnData.push({
						json: { error: msg },
						pairedItem: { item: i },
					});
					continue;
				}
				throw itemErr;
			}
		}

		// The singleton client is intentionally not freed — it must stay alive
		// so the WASM logger is not re-initialized on the next execute() call.

		return [returnData];
	}
}
