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
	];
}
