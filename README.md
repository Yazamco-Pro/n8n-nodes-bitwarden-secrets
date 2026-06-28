# n8n-nodes-bitwarden-secrets

A private [n8n](https://n8n.io) community node that retrieves secrets from **Bitwarden Secrets Manager** by exact Secret UUID.

---

## What this node does

- Authenticates with Bitwarden Secrets Manager using a Machine Account **Access Token**.
- Retrieves a single secret by its **UUID** (exact ID — no search, no wildcards).
- Returns the decrypted secret fields: `id`, `key`, `value`, `projectId`, `creationDate`, `revisionDate`.
- Supports multiple input items — one secret fetch per item.
- Supports n8n **Continue On Fail** — failed items return an `error` field instead of stopping the workflow.

## What this node does NOT do

- Does not create, update, or delete secrets.
- Does not list or search secrets by name/key.
- Does not support the regular Bitwarden Password Manager (organization/member/collection APIs).
- Does not cache secrets or store them anywhere other than the normal n8n node output.

---

## Requirements

| Requirement | Details |
|---|---|
| Node.js | ≥ 18.0.0 |
| n8n | ≥ 1.0.0 (community node API v1) |
| Bitwarden plan | Secrets Manager add-on required (Teams or Enterprise) |
| `@bitwarden/sdk-napi` | Bundled — installs automatically via `npm install` |

> **Alpine Linux / Docker note** — The official `n8nio/n8n` Docker image is Alpine-based (musl libc).
> The Bitwarden NAPI module is compiled for glibc. See [Docker installation](#docker-installation) below
> for how to handle this.

---

## How to create a Bitwarden Secrets Manager Access Token

1. Log in to [vault.bitwarden.com](https://vault.bitwarden.com) and open **Secrets Manager**.
2. In the left sidebar click **Machine Accounts** → **New Machine Account**.
3. Give the account a name (e.g. `n8n-integration`).
4. Assign the machine account to the **Projects** that contain the secrets you want n8n to read.
   Use the **Can read** permission for least-privilege.
5. Click the machine account → **Access Tokens** tab → **Create Access Token**.
6. Copy the generated token — it is shown **only once**.
7. Store it immediately in your n8n credential (see below).

---

## Configuring the credential in n8n

1. In n8n go to **Settings → Credentials → Add Credential**.
2. Search for **Bitwarden Secrets Manager API**.
3. Paste your Access Token into the **Access Token** field.
4. Click **Save**.

The Access Token is stored encrypted inside n8n and is never written to logs, node parameters, or output data.

---

## How to find a Secret ID / UUID

Every secret in Bitwarden Secrets Manager has a UUID, e.g.:

```
2863ced6-eba1-48b4-b5c0-afa30104877a
```

To find it:

- **In the UI**: Open the secret in Bitwarden Secrets Manager → the UUID appears in the browser URL.
- **Via CLI** (`bws`):
  ```bash
  bws secret list | jq '.[] | {id, key}'
  ```
- **Via API**: `GET https://api.bitwarden.com/secrets` (with a valid bearer token).

---

## Using the node

1. Add the **Bitwarden Secrets** node to your workflow.
2. Select your **Bitwarden Secrets Manager API** credential.
3. Choose operation **Get Secret by ID**.
4. Enter the **Secret ID** — either hardcoded UUID or an expression:
   ```
   {{ $json.secretId }}
   ```
5. Run. The node outputs one item per input item with:

```json
{
  "id": "2863ced6-eba1-48b4-b5c0-afa30104877a",
  "key": "STRIPE_API_KEY",
  "value": "sk_live_...",
  "projectId": "1d0a63e8-3974-4cbd-a7e4-afa30102257e",
  "creationDate": "2024-01-15T10:30:00Z",
  "revisionDate": "2024-06-01T08:00:00Z"
}
```

### Example workflow

```
[HTTP Request] → [Set node: secretId = {{$json.body.secretName}}]
→ [Bitwarden Secrets: Get Secret by ID]
→ [use {{$json.value}} in downstream nodes]
```

### Continue On Fail

Enable **Continue On Fail** in the node settings. Items that fail (e.g. secret not found, permission denied) output:

```json
{ "error": "Secret not found: 2863ced6-..." }
```

and processing continues for remaining items.

---

## Docker installation

### Option A — Custom image (recommended for production)

This is the safest, most reproducible approach.

```dockerfile
# Dockerfile
FROM n8nio/n8n:latest

USER root

# gcompat adds glibc compatibility to Alpine so that NAPI modules work.
RUN apk add --no-cache gcompat

USER node

# Install the community node package globally.
# n8n picks up packages installed under the node user's global npm prefix.
RUN npm install -g n8n-nodes-bitwarden-secrets

# If you are using a private/local tarball instead of a published package:
# COPY n8n-nodes-bitwarden-secrets-0.1.0.tgz /tmp/
# RUN npm install -g /tmp/n8n-nodes-bitwarden-secrets-0.1.0.tgz
```

Build and run:

```bash
docker build -t my-n8n .
docker run -d \
  -p 5678:5678 \
  -e N8N_COMMUNITY_PACKAGES_ENABLED=true \
  -v n8n_data:/home/node/.n8n \
  my-n8n
```

### Option B — docker-compose

```yaml
# docker-compose.yml
version: "3.8"

services:
  n8n:
    build:
      context: .
      dockerfile: Dockerfile   # use the Dockerfile from Option A
    ports:
      - "5678:5678"
    environment:
      - N8N_COMMUNITY_PACKAGES_ENABLED=true
      - GENERIC_TIMEZONE=UTC
      - N8N_ENCRYPTION_KEY=your-random-secret-here
    volumes:
      - n8n_data:/home/node/.n8n

volumes:
  n8n_data:
```

### Option C — Install in an existing n8n container (local/dev only)

```bash
# One-time manual install inside a running container
docker exec -u node -it <container_name> \
  npm install -g n8n-nodes-bitwarden-secrets

# Restart n8n so it picks up the new node
docker restart <container_name>
```

### Verifying the node loads

After starting n8n, open the editor and search for **Bitwarden Secrets** in the node palette.
If the node does not appear, check the container logs:

```bash
docker logs <container_name> 2>&1 | grep -i bitwarden
```

Common log messages:
- `@bitwarden/sdk-napi native module could not be loaded` → add `gcompat` (see Option A).
- `Authentication failed` → check the Access Token in the credential.

---

## Building from source

```bash
# Prerequisites: Node.js >= 18, npm

git clone https://github.com/YOUR_USERNAME/n8n-nodes-bitwarden-secrets
cd n8n-nodes-bitwarden-secrets

# Install dependencies
npm install

# Compile TypeScript → dist/
npm run build

# Optional: lint
npm run lint

# Create a tarball for local Docker install
npm pack
# → produces n8n-nodes-bitwarden-secrets-0.1.0.tgz
```

After a successful build the `dist/` directory will contain:

```
dist/
  credentials/
    BitwardenSecretsManagerApi.credentials.js
    BitwardenSecretsManagerApi.credentials.d.ts
  nodes/
    BitwardenSecrets/
      BitwardenSecrets.node.js
      BitwardenSecrets.node.d.ts
      bitwardenSecrets.svg
```

---

## Security notes

| Topic | Implementation |
|---|---|
| Access Token storage | n8n encrypted credential store only — never in node parameters or source files |
| Access Token in logs | Never logged. Error messages that might contain token fragments are redacted (`[REDACTED]`). |
| Access Token in output | Never included in node output data |
| Secret value in logs | Not logged — only returned in normal n8n output |
| SDK state file | Created in OS tmpdir per execution and deleted in `finally` block |
| Minimal permissions | Machine Account should use **Can read** permission — never **Can read/write** |

---

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| Node not visible in n8n palette | `N8N_COMMUNITY_PACKAGES_ENABLED` not set | Set env var to `true` and restart n8n |
| `native module could not be loaded` | Missing glibc on Alpine | Add `apk add --no-cache gcompat` to Dockerfile |
| `Authentication failed` | Wrong or expired Access Token | Regenerate the token in Bitwarden Secrets Manager |
| `Secret not found` | Wrong UUID or machine account has no access | Check UUID; ensure machine account is assigned to the secret's project |
| `Invalid Secret ID format` | A name/key was entered instead of UUID | Enter the UUID (from the browser URL or `bws secret list`) |
| `Permission denied` | Machine account lacks read access to the project | Go to Machine Account → Projects → add the project with Can read |
| Build error `Cannot find module '@bitwarden/sdk-napi'` | `npm install` not run | Run `npm install` before `npm run build` |

---

## Limitations and TODOs (v0.1.0)

- **Read-only**: only Get Secret by ID. No create/update/delete/list operations.
- **No caching**: authenticates fresh on every workflow execution.
- **No self-hosted Bitwarden support**: API URL is hardcoded to `api.bitwarden.com`. Self-hosted users need to change `apiUrl` and `identityUrl` in the node source and rebuild.
- **glibc dependency**: NAPI binary requires glibc or Alpine `gcompat`. Pure musl (Alpine without `gcompat`) is untested.
- **No credential test**: the n8n credential UI "Test" button is not wired up in v0.1.0.
