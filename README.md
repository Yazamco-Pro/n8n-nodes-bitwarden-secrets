# n8n-nodes-bitwarden-secrets

An [n8n](https://n8n.io) community node for retrieving secrets from **Bitwarden Secrets Manager** by UUID.

Uses the official `@bitwarden/sdk-wasm` SDK — no OS binaries, fully compatible with the Alpine-based n8n Docker image.

---

## Requirements

| | |
|---|---|
| n8n | ≥ 1.0.0 |
| Node.js | ≥ 18.0.0 |
| Bitwarden plan | Secrets Manager add-on (Teams or Enterprise) |

---

## Installation

### Docker (recommended)

```bash
# 1. Build and pack
npm install && npm run build && npm pack
# → n8n-nodes-bitwarden-secrets-0.1.0.tgz

# 2. Copy into container and install
docker cp n8n-nodes-bitwarden-secrets-0.1.0.tgz <container>:/tmp/
docker exec -u node <container> sh -c "
  mkdir -p /home/node/.n8n/custom &&
  cd /home/node/.n8n/custom &&
  npm install /tmp/n8n-nodes-bitwarden-secrets-0.1.0.tgz
"

# 3. Restart
docker restart <container>
```

### docker-compose (bind mount)

```yaml
services:
  n8n:
    image: n8nio/n8n:latest
    volumes:
      - n8n_data:/home/node/.n8n
      - ./n8n-custom:/home/node/.n8n/custom
    environment:
      - N8N_COMMUNITY_PACKAGES_ENABLED=true
    ports:
      - "5678:5678"
volumes:
  n8n_data:
```

```bash
mkdir -p ./n8n-custom && cd ./n8n-custom
npm install /path/to/n8n-nodes-bitwarden-secrets-0.1.0.tgz
```

> If the node doesn't appear in the palette, set `N8N_COMMUNITY_PACKAGES_ENABLED=true` and restart n8n.

---

## Setup

### 1. Create a Bitwarden Machine Account Access Token

1. Log in to [vault.bitwarden.com](https://vault.bitwarden.com) → **Secrets Manager**.
2. Go to **Machine Accounts** → **New Machine Account** (e.g. name it `n8n`).
3. Assign it to the **Projects** that contain your secrets with **Can read** permission.
4. Click the machine account → **Access Tokens** → **Create Access Token**.
5. **Copy the token immediately** — it is shown only once.

### 2. Find your Secret UUIDs

Every secret has a UUID like `2863ced6-eba1-48b4-b5c0-afa30104877a`.

- **Browser**: open a secret — the UUID is in the URL.
- **CLI**: `bws secret list --output json | jq '.[] | {id, key}'`

### 3. Configure the credential in n8n

1. **Settings → Credentials → Add Credential** → search for **Bitwarden Secrets Manager API**.
2. Fill in the fields:

| Field | Required | Description |
|---|---|---|
| Access Token | Yes | The Machine Account token from step 1 |
| API URL | No | Default: `https://api.bitwarden.com`. Override for self-hosted instances. |
| Identity URL | No | Default: `https://identity.bitwarden.com`. Override for self-hosted instances. |

3. **Save**.

> **Self-hosted note:** The API and Identity URLs are applied on the first workflow execution after n8n starts. Changing them requires an n8n restart (WASM SDK limitation).

---

## Usage

1. Add **Bitwarden Secrets** to your workflow.
2. Select your credential.
3. Enter a **Secret ID** (UUID) — hardcoded or via expression: `{{ $json.secretId }}`

### Output

```json
{
  "id": "2863ced6-eba1-48b4-b5c0-afa30104877a",
  "key": "STRIPE_API_KEY",
  "value": "sk_live_...",
  "note": "Rotated 2024-06-01",
  "projectId": "1d0a63e8-3974-4cbd-a7e4-afa30102257e",
  "creationDate": "2024-01-15T10:30:00Z",
  "revisionDate": "2024-06-01T08:00:00Z"
}
```

Enable **Continue On Fail** in node settings to handle errors per-item instead of stopping the workflow:

```json
{ "error": "Secret not found: 2863ced6-..." }
```

---

## Troubleshooting

| Error | Fix |
|---|---|
| `Authentication failed` | Regenerate the Access Token in Bitwarden |
| `Secret not found` | Check the UUID; ensure the project is assigned to the Machine Account |
| `Invalid Secret ID format` | Use the UUID from the browser URL, not the secret name |
| `Permission denied` | Add the project to the Machine Account with **Can read** |
| Node not in palette | Set `N8N_COMMUNITY_PACKAGES_ENABLED=true` and restart n8n |
