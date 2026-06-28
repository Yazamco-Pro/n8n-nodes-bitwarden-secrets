# n8n-nodes-bitwarden-secrets

A private [n8n](https://n8n.io) community node that retrieves secrets from **Bitwarden Secrets Manager** by exact Secret UUID.

**This version uses the official `bws` CLI** — no native NAPI modules, fully compatible with the Alpine-based official n8n Docker image.

---

## What this node does

- Authenticates with Bitwarden Secrets Manager using a Machine Account **Access Token** (stored as an n8n credential, never in node parameters).
- Retrieves a single secret by its **UUID** by invoking `bws secret get <UUID> --output json`.
- The access token is passed only via the `BWS_ACCESS_TOKEN` environment variable — never as a CLI argument.
- Returns the decrypted secret fields: `id`, `key`, `value`, `projectId`, `creationDate`, `revisionDate`.
- Supports multiple input items — one secret fetch per item.
- Supports n8n **Continue On Fail** — failed items return an `{ error: "..." }` object instead of stopping the workflow.

## What this node does NOT do

- Does not create, update, or delete secrets.
- Does not list or search secrets by name/key.
- Does not support the regular Bitwarden Password Manager (organization/member/collection APIs).
- Does not cache secrets.

---

## Requirements

| Requirement | Details |
|---|---|
| n8n | ≥ 1.0.0 (community node API v1) |
| `bws` CLI | Must be installed inside the n8n container — see below |
| Bitwarden plan | Secrets Manager add-on (Teams or Enterprise) |
| Node.js | ≥ 18.0.0 (for building from source) |

---

## Installing the `bws` CLI inside the n8n container

`bws` must be present and executable as `bws` in the container's `PATH` before n8n can use this node.

### Find the right binary for your platform

Go to the [bws releases page](https://github.com/bitwarden/sdk-sm/releases) and download the binary that matches your container architecture:

| Container OS | Architecture | File to download |
|---|---|---|
| Alpine Linux (n8n default) | x86_64 (amd64) | `bws-x86_64-unknown-linux-musl.tar.gz` |
| Alpine Linux (n8n default) | ARM64 | `bws-aarch64-unknown-linux-musl.tar.gz` |
| Debian/Ubuntu | x86_64 | `bws-x86_64-unknown-linux-gnu.tar.gz` |

> **Alpine / official n8n Docker image**: Use the `*-musl` binary. It is statically linked and works on Alpine without any glibc compatibility layers.

### Option A — Install via Dockerfile (recommended for production)

```dockerfile
FROM n8nio/n8n:latest

USER root

# Set the bws version you want to pin to (check releases page for latest)
ARG BWS_VERSION=1.0.0
ARG BWS_ARCH=x86_64-unknown-linux-musl

RUN apk add --no-cache curl tar && \
    curl -fsSL \
      "https://github.com/bitwarden/sdk-sm/releases/download/bws-v${BWS_VERSION}/bws-${BWS_ARCH}.tar.gz" \
      -o /tmp/bws.tar.gz && \
    tar -xzf /tmp/bws.tar.gz -C /usr/local/bin/ && \
    chmod +x /usr/local/bin/bws && \
    rm /tmp/bws.tar.gz

USER node
```

> **Tip**: After adding `bws`, also copy your node package in the same Dockerfile step — or use the volume-based approach below.

### Option B — Install manually into a running container (dev / test)

```bash
# 1. Exec into the running n8n container as root
docker exec -u root -it <container_name> sh

# 2. Inside the container:
apk add --no-cache curl tar
curl -fsSL \
  "https://github.com/bitwarden/sdk-sm/releases/download/bws-v1.0.0/bws-x86_64-unknown-linux-musl.tar.gz" \
  -o /tmp/bws.tar.gz
tar -xzf /tmp/bws.tar.gz -C /usr/local/bin/
chmod +x /usr/local/bin/bws
rm /tmp/bws.tar.gz

# 3. Verify
bws --version

# 4. Exit root shell, then restart n8n if needed
exit
```

> **Warning**: This is not persistent. If the container is recreated, you must reinstall.

### Option C — docker-compose with a shared volume

```yaml
# docker-compose.yml
version: "3.8"

services:
  bws-installer:
    image: alpine:latest
    volumes:
      - bws_bin:/usr/local/bin
    command: >
      sh -c "
        apk add --no-cache curl tar &&
        curl -fsSL https://github.com/bitwarden/sdk-sm/releases/download/bws-v1.0.0/bws-x86_64-unknown-linux-musl.tar.gz
        | tar -xz -C /usr/local/bin/ &&
        chmod +x /usr/local/bin/bws
      "

  n8n:
    image: n8nio/n8n:latest
    depends_on:
      bws-installer:
        condition: service_completed_successfully
    volumes:
      - bws_bin:/usr/local/bin:ro   # read-only bws binary
      - n8n_data:/home/node/.n8n
    environment:
      - N8N_COMMUNITY_PACKAGES_ENABLED=true
    ports:
      - "5678:5678"

volumes:
  bws_bin:
  n8n_data:
```

---

## Loading this node from `/home/node/.n8n/custom`

n8n auto-loads community node packages placed under `~/.n8n/custom/` (the `custom` directory inside the n8n data directory).

### Step-by-step

```bash
# 1. Build the package on your development machine (requires Node.js ≥ 18)
npm install --include=dev --production=false
npm run build
npm pack
# → produces: n8n-nodes-bitwarden-secrets-0.1.0.tgz

# 2. Copy the tarball into the container
docker cp n8n-nodes-bitwarden-secrets-0.1.0.tgz <container_name>:/tmp/

# 3. Install it in the custom directory
docker exec -u node <container_name> sh -c "
  mkdir -p /home/node/.n8n/custom &&
  cd /home/node/.n8n/custom &&
  npm install /tmp/n8n-nodes-bitwarden-secrets-0.1.0.tgz
"

# 4. Restart n8n to pick up the new node
docker restart <container_name>
```

After restart, open the n8n editor and search for **Bitwarden Secrets** in the node palette.

> Set `N8N_COMMUNITY_PACKAGES_ENABLED=true` if the node does not appear.

---

## Testing `bws` manually inside the container

Before running a workflow, verify that `bws` works correctly:

```bash
# Exec into the n8n container
docker exec -u node -it <container_name> sh

# Test authentication and secret retrieval
BWS_ACCESS_TOKEN="your-access-token-here" bws secret get 2863ced6-eba1-48b4-b5c0-afa30104877a --output json

# Expected output (values decrypted):
# {
#   "id": "2863ced6-eba1-48b4-b5c0-afa30104877a",
#   "organizationId": "...",
#   "projectId": "...",
#   "key": "STRIPE_API_KEY",
#   "value": "sk_live_...",
#   "note": "",
#   "creationDate": "2024-01-15T10:30:00Z",
#   "revisionDate": "2024-06-01T08:00:00Z"
# }

# If bws is not found:
# sh: bws: not found  →  install bws first (see above)

# If authentication fails:
# error: Unauthorized  →  check your Access Token
```

---

## How to create a Bitwarden Secrets Manager Access Token

1. Log in to [vault.bitwarden.com](https://vault.bitwarden.com) → **Secrets Manager**.
2. **Machine Accounts** → **New Machine Account** → give it a name (e.g. `n8n`).
3. Assign the machine account to the **Projects** that contain your secrets → **Can read** permission.
4. Click the machine account → **Access Tokens** tab → **Create Access Token**.
5. Copy the token — it is shown **only once**.
6. Store it in an n8n credential (see below).

---

## Configuring the credential in n8n

1. **Settings → Credentials → Add Credential**.
2. Search for **Bitwarden Secrets Manager API**.
3. Paste your Access Token into the **Access Token** field (stored encrypted, never logged).
4. **Save**.

---

## How to find a Secret ID / UUID

Every secret has a UUID, e.g. `2863ced6-eba1-48b4-b5c0-afa30104877a`.

- **Browser UI**: Open the secret → UUID is in the browser URL.
- **bws CLI**: `bws secret list --output json | jq '.[] | {id, key}'`

---

## Using the node

1. Add **Bitwarden Secrets** to your workflow.
2. Select your **Bitwarden Secrets Manager API** credential.
3. Operation: **Get Secret by ID**.
4. **Secret ID** — hardcoded UUID or an expression:
   ```
   {{ $json.secretId }}
   ```
5. The node outputs one item per input item:

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

### Continue On Fail

Enable **Continue On Fail** in node settings. Failed items output:
```json
{ "error": "Secret not found: 2863ced6-..." }
```

---

## Security notes

| Topic | Implementation |
|---|---|
| Access Token storage | n8n encrypted credential store only |
| Access Token in CLI args | **Never** — passed via `BWS_ACCESS_TOKEN` env var only |
| Access Token in logs | Never logged by this node |
| Access Token in errors | Error messages are sanitized — long base64-like strings replaced with `[REDACTED]` |
| Secret value in output | Only in normal n8n output; not logged |
| Least-privilege | Use **Can read** permission on the Machine Account |

---

## Troubleshooting

| Error | Cause | Fix |
|---|---|---|
| `bws command not found` | `bws` not installed in container | Install bws (see above) |
| `Authentication failed` | Wrong / expired token | Regenerate token in Bitwarden Secrets Manager |
| `Secret not found` | Wrong UUID or no machine account access | Check UUID; assign secret's project to machine account |
| `Invalid Secret ID format` | A name was entered instead of UUID | Use the UUID from the browser URL or `bws secret list` |
| `Permission denied` | Machine account lacks read access | Add the project with Can read in Machine Account → Projects |
| Node not in palette | `N8N_COMMUNITY_PACKAGES_ENABLED` not set | Set env var to `true`, restart n8n |
| `bws returned unexpected output` | bws outputting warnings to stdout | Check bws version; file an issue |

---

## Building from source

```bash
# Requires Node.js ≥ 18 on your development machine (not inside the n8n container)

git clone https://github.com/YOUR_USERNAME/n8n-nodes-bitwarden-secrets
cd n8n-nodes-bitwarden-secrets

npm install --include=dev --production=false
npm run build

# Check compiled output
ls dist/credentials/    # BitwardenSecretsManagerApi.credentials.js
ls dist/nodes/BitwardenSecrets/  # BitwardenSecrets.node.js  bitwardenSecrets.svg

# Create installable tarball
npm pack
```

---

## Limitations / TODOs (v0.1.0)

- **Read-only** — Get Secret by ID only.
- **bws must be pre-installed** — the node does not install bws automatically.
- **`bws` in PATH** — bws must be executable as `bws` (not a full path). If installed elsewhere, symlink it: `ln -s /path/to/bws /usr/local/bin/bws`.
- **Self-hosted Bitwarden** — bws accepts `--server-url` and `--config`; the current node uses bws defaults (cloud). Add a `Server URL` credential field in a future version.
- **No credential test button** — validates on first workflow run only.
- **One `bws` process per item** — if you fetch 100 secrets, 100 `bws` processes run (sequentially). A future version could batch or cache sessions.
