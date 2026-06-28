import { ICredentialType, INodeProperties } from 'n8n-workflow';

export class BitwardenSecretsManagerApi implements ICredentialType {
	name = 'bitwardenSecretsManagerApi';
	displayName = 'Bitwarden Secrets Manager API';
	documentationUrl =
		'https://bitwarden.com/help/access-tokens/';
	properties: INodeProperties[] = [
		{
			displayName: 'Access Token',
			name: 'accessToken',
			type: 'string',
			typeOptions: {
				password: true,
			},
			default: '',
			required: true,
			description:
				'Machine Account Access Token from Bitwarden Secrets Manager. Create one under Machine Accounts → Access Tokens.',
		},
		{
			displayName: 'API URL',
			name: 'apiUrl',
			type: 'string',
			default: 'https://api.bitwarden.com',
			description:
				'Bitwarden API base URL. Change only for self-hosted instances (e.g. https://bitwarden.example.com/api).',
		},
		{
			displayName: 'Identity URL',
			name: 'identityUrl',
			type: 'string',
			default: 'https://identity.bitwarden.com',
			description:
				'Bitwarden Identity base URL. Change only for self-hosted instances (e.g. https://bitwarden.example.com/identity).',
		},
	];
}
