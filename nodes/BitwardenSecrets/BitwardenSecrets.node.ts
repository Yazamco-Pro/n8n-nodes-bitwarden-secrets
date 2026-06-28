import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
	IExecuteFunctions,
	INodeExecutionData,
	INodeType,
	INodeTypeDescription,
	NodeOperationError,
} from 'n8n-workflow';

// Type-only import — erased at compile time; actual loading done via require() at runtime.
import type * as BitwardenSDK from '@bitwarden/sdk-napi';

const UUID_REGEX =
	/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Cached module reference and error to avoid repeated require() attempts.
let _sdk: typeof BitwardenSDK | null = null;
let _sdkLoadError: string | null = null;

function getSDK(): typeof BitwardenSDK {
	if (_sdk) return _sdk;
	if (_sdkLoadError) throw new Error(_sdkLoadError);
	try {
		// eslint-disable-next-line @typescript-eslint/no-require-imports
		_sdk = require('@bitwarden/sdk-napi') as typeof BitwardenSDK;
		return _sdk;
	} catch (err: unknown) {
		const detail = err instanceof Error ? err.message : String(err);
		_sdkLoadError =
			`The @bitwarden/sdk-napi native module could not be loaded: ${detail}. ` +
			'On Alpine Linux (the default n8n Docker image) you may need to run ' +
			'"apk add --no-cache gcompat" in your Dockerfile and rebuild.';
		throw new Error(_sdkLoadError);
	}
}

/**
 * Strip long base64-like strings and cap length so that tokens / encrypted
 * blobs never leak into user-visible error messages.
 */
function sanitizeErrorMessage(raw: string | undefined): string {
	if (!raw) return 'Unknown error';
	return raw
		.replace(/[A-Za-z0-9+/=]{40,}/g, '[REDACTED]')
		.substring(0, 300);
}

export class BitwardenSecrets implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Bitwarden Secrets',
		name: 'bitwardenSecrets',
		icon: 'file:bitwardenSecrets.svg',
		group: ['transform'],
		version: 1,
		subtitle: '={{$parameter["operation"]}}',
		description: 'Retrieve secrets from Bitwarden Secrets Manager by UUID',
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

		// ── Credentials ──────────────────────────────────────────────────────────
		const credentials = await this.getCredentials('bitwardenSecretsManagerApi');
		const accessToken = (credentials.accessToken as string | undefined)?.trim();

		if (!accessToken) {
			throw new NodeOperationError(
				this.getNode(),
				'Access Token is missing. Configure the "Bitwarden Secrets Manager API" credential.',
			);
		}

		// ── Load SDK (fails early if native binary is unavailable) ────────────────
		let sdk: typeof BitwardenSDK;
		try {
			sdk = getSDK();
		} catch (err: unknown) {
			throw new NodeOperationError(
				this.getNode(),
				err instanceof Error ? err.message : String(err),
			);
		}

		// ── Authenticate (one call per execution, not per item) ───────────────────
		// A per-execution temp file keeps SDK state isolated across parallel runs.
		const stateFile = path.join(
			os.tmpdir(),
			`bw-n8n-${process.pid}-${Date.now()}.json`,
		);

		const settings: BitwardenSDK.ClientSettings = {
			apiUrl: 'https://api.bitwarden.com',
			identityUrl: 'https://identity.bitwarden.com',
			userAgent: 'n8n-bitwarden-secrets/0.1.0',
			deviceType: sdk.DeviceType.SDK,
		};

		const client = new sdk.BitwardenClient(settings, sdk.LogLevel.Info);

		try {
			await client.auth().loginAccessToken(accessToken, stateFile);
		} catch (authErr: unknown) {
			const msg =
				authErr instanceof Error ? authErr.message : String(authErr);
			if (/unauthorized|401|invalid.*token|access.*denied/i.test(msg)) {
				throw new NodeOperationError(
					this.getNode(),
					'Authentication failed. Verify the Access Token in your Bitwarden Secrets Manager API credential.',
				);
			}
			throw new NodeOperationError(
				this.getNode(),
				`Failed to authenticate with Bitwarden: ${sanitizeErrorMessage(msg)}`,
			);
		}

		// ── Per-item secret retrieval ─────────────────────────────────────────────
		try {
			for (let i = 0; i < items.length; i++) {
				try {
					const rawId = this.getNodeParameter('secretId', i) as string;
					const secretId = rawId?.trim();

					if (!secretId) {
						throw new NodeOperationError(this.getNode(), 'Secret ID is required', {
							itemIndex: i,
						});
					}

					if (!UUID_REGEX.test(secretId)) {
						throw new NodeOperationError(
							this.getNode(),
							`Invalid Secret ID format: "${secretId}". ` +
								'Expected a UUID like 2863ced6-eba1-48b4-b5c0-afa30104877a.',
							{ itemIndex: i },
						);
					}

					// eslint-disable-next-line @typescript-eslint/no-explicit-any
					let secret: any;
					try {
						secret = await client.secrets().get(secretId);
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
									'Check that the Machine Account has access to this secret.',
								{ itemIndex: i },
							);
						}
						throw new NodeOperationError(
							this.getNode(),
							`Failed to retrieve secret ${secretId}: ${sanitizeErrorMessage(msg)}`,
							{ itemIndex: i },
						);
					}

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
						const errMsg =
							itemErr instanceof NodeOperationError
								? itemErr.message
								: sanitizeErrorMessage(
										itemErr instanceof Error
											? itemErr.message
											: String(itemErr),
									);
						returnData.push({
							json: { error: errMsg },
							pairedItem: { item: i },
						});
						continue;
					}
					throw itemErr;
				}
			}
		} finally {
			// Always clean up the SDK state file.
			try {
				if (fs.existsSync(stateFile)) {
					fs.unlinkSync(stateFile);
				}
			} catch {
				// Ignore cleanup errors — temp files will be collected by the OS.
			}
		}

		return [returnData];
	}
}
