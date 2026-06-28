import { execFile } from 'child_process';
import {
	IExecuteFunctions,
	INode,
	INodeExecutionData,
	INodeType,
	INodeTypeDescription,
	NodeOperationError,
} from 'n8n-workflow';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface BwsSecret {
	id?: string;
	organizationId?: string;
	projectId?: string;
	key?: string;
	value?: string;
	note?: string;
	creationDate?: string;
	revisionDate?: string;
}

interface BwsExecError extends Error {
	code?: string | number;
	killed?: boolean;
	signal?: string;
	/** stderr captured from the process (attached manually) */
	bwsStderr?: string;
}

/**
 * Run `bws secret get <secretId> --output json` without a shell.
 * The access token is passed only via environment variable, never as an argument.
 */
function runBws(secretId: string, env: NodeJS.ProcessEnv): Promise<string> {
	return new Promise<string>((resolve, reject) => {
		execFile(
			'bws',
			['secret', 'get', secretId, '--output', 'json'],
			{
				env,
				timeout: 30_000,   // 30 s hard cap
				maxBuffer: 10 * 1024 * 1024, // 10 MB — a single secret is tiny
			},
			(error, stdout, stderr) => {
				if (error) {
					const enriched = error as BwsExecError;
					enriched.bwsStderr =
						typeof stderr === 'string' ? stderr : stderr.toString('utf8');
					reject(enriched);
					return;
				}
				resolve(typeof stdout === 'string' ? stdout : stdout.toString('utf8'));
			},
		);
	});
}

/**
 * Strip long base64-like strings and cap length to prevent token / encrypted
 * blobs from leaking into user-visible error messages.
 */
function sanitize(msg: string | undefined): string {
	if (!msg) return 'Unknown error';
	return msg
		.replace(/[A-Za-z0-9+/=]{40,}/g, '[REDACTED]')
		.substring(0, 500);
}

function mapBwsError(
	node: INode,
	err: unknown,
	secretId: string,
	itemIndex: number,
): NodeOperationError {
	const e = err as BwsExecError;

	// bws binary missing
	if (e.code === 'ENOENT') {
		return new NodeOperationError(
			node,
			'bws command not found. ' +
				'Install the Bitwarden Secrets Manager CLI inside the n8n container. ' +
				'See the README for instructions.',
		);
	}

	// Timed-out or killed by signal
	if (e.killed || e.signal) {
		return new NodeOperationError(
			node,
			`bws timed out or was killed retrieving secret: ${secretId}`,
			{ itemIndex },
		);
	}

	const stderr = e.bwsStderr ?? '';
	const safe = sanitize(stderr);

	if (/not.?found|does.?not.?exist/i.test(stderr)) {
		return new NodeOperationError(node, `Secret not found: ${secretId}`, { itemIndex });
	}
	if (/unauthorized|invalid.*token|401/i.test(stderr)) {
		return new NodeOperationError(
			node,
			'Authentication failed. Verify the Access Token in the Bitwarden Secrets Manager API credential.',
		);
	}
	if (/forbidden|403|permission/i.test(stderr)) {
		return new NodeOperationError(
			node,
			`Permission denied accessing secret: ${secretId}. ` +
				'Ensure the Machine Account has read access to the project.',
			{ itemIndex },
		);
	}
	if (/ECONNREFUSED|ENOTFOUND|network|connect.*time/i.test(stderr)) {
		return new NodeOperationError(
			node,
			`Network error communicating with Bitwarden: ${safe}`,
			{ itemIndex },
		);
	}

	return new NodeOperationError(
		node,
		`bws failed for secret ${secretId}: ${safe}`,
		{ itemIndex },
	);
}

export class BitwardenSecrets implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Bitwarden Secrets',
		name: 'bitwardenSecrets',
		icon: 'file:bitwardenSecrets.svg',
		group: ['transform'],
		version: 1,
		subtitle: '={{$parameter["operation"]}}',
		description: 'Retrieve secrets from Bitwarden Secrets Manager by UUID (uses bws CLI)',
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
				'Access Token is missing. Configure the Bitwarden Secrets Manager API credential.',
			);
		}

		// Pass token via environment variable only — never as a CLI argument.
		const bwsEnv: NodeJS.ProcessEnv = {
			...process.env,
			BWS_ACCESS_TOKEN: accessToken,
		};

		// ── Per-item processing ───────────────────────────────────────────────────
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

				// ── Invoke bws ────────────────────────────────────────────────────
				let rawOutput: string;
				try {
					rawOutput = await runBws(secretId, bwsEnv);
				} catch (execErr: unknown) {
					throw mapBwsError(this.getNode(), execErr, secretId, i);
				}

				// ── Parse JSON ────────────────────────────────────────────────────
				let secret: BwsSecret;
				try {
					const parsed: unknown = JSON.parse(rawOutput.trim());
					// bws may one day return an array; handle both shapes.
					secret = (Array.isArray(parsed) ? parsed[0] : parsed) as BwsSecret;
				} catch {
					throw new NodeOperationError(
						this.getNode(),
						'bws returned unexpected output (not valid JSON). ' +
							'Verify bws is correctly installed and the secret ID is correct.',
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

		return [returnData];
	}
}
