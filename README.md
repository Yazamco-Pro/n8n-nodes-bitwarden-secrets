# n8n-nodes-bitwarden-secrets

A private [n8n](https://n8n.io) community node that retrieves secrets from **Bitwarden Secrets Manager** by exact Secret UUID.

**This version uses `@bitwarden/sdk-wasm`** — the official Bitwarden Secrets Manager JS/WebAssembly SDK. No native NAPI modules, no OS-level binaries, fully compatible with the Alpine-based official n8n Docker image and any Node.js ≥ 18 environment.

---

## What this node does

- Authenticates with Bitwarden Secrets Manager using a Machine Account **Access Token** (stored as an n8n credential, never in node parameters).
- Retrieves a single secret by its **UUID** using the Bitwarden WASM SDK.
- Returns the decrypted secret fields: `id`, `key`, `value`, `projectId`, `creationDate`, `revisionDate`.
- Supports multiple input items — one secret fetch per item (shared SDK client session per execution).
- Supports n8n **Continue On Fail** — failed items return an `{ error: "..." }` object instead of stopping the workflow.

## What this node does NOT do

- Does not create, update, or delete secrets.
- Does not list or search secrets by name/key.
- Does not support the regular Bitwarden Password Manager (organization/member/collection APIs).
- Does not cache secrets between workflow executions.

---

## Requirements

| Requirement | Details |
|---|---|
| n8n | ≥ 1.0.0 (community node API v1) |
| Node.js | ≥ 18.0.0 |
| WebAssembly | Supported natively in Node.js 18+ — no extra setup |
| Bitwarden plan | Secrets Manager add-on (Teams or Enterprise) |

No OS-level dependencies, no CLI tools to install. The WASM binary ships inside the `@bitwarden/sdk-wasm` npm package.

---

## Loading this node into n8n

### Step-by-step (volume-based, no custom Dockerfile)

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

### Alternative: docker-compose with a bind-mounted custom directory

```yaml
# docker-compose.yml
services:
  n8n:
    image: n8nio/n8n:latest
    volumes:
      - n8n_data:/home/node/.n8n
      - ./n8n-custom:/home/node/.n8n/custom   # pre-install your node here
    environment:
      - N8N_COMMUNITY_PACKAGES_ENABLED=true
    ports:
      - "5678:5678"

volumes:
  n8n_data:
```

Install the package into `./n8n-custom` on the host:

```bash
mkdir -p ./n8n-custom
cd ./n8n-custom
npm install /path/to/n8n-nodes-bitwarden-secrets-0.1.0.tgz
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
- **Bitwarden CLI**: `bws secret list --output json | jq '.[] | {id, key}'`
- **Bitwarden web app**: Settings → Secrets Manager → click a secret → UUID visible in the URL bar.

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
| Access Token in SDK calls | Passed directly to the WASM SDK, never written to disk or logs |
| Access Token in errors | Error messages are sanitized — long base64-like strings replaced with `[REDACTED]` |
| Access Token in node parameters | Never — always retrieved via `getCredentials()` |
| Secret value in output | Only in normal n8n output; not logged |
| WASM client | Singleton — created once per Node.js process; never freed, so the WASM/Rust logger is not re-initialized |
| Least-privilege | Use **Can read** permission on the Machine Account |

---

## Troubleshooting

| Error | Cause | Fix |
|---|---|---|
| `Authentication failed` | Wrong / expired token | Regenerate token in Bitwarden Secrets Manager |
| `Secret not found` | Wrong UUID or no machine account access | Check UUID; assign secret's project to machine account |
| `Invalid Secret ID format` | A name was entered instead of UUID | Use the UUID from the browser URL |
| `Permission denied` | Machine account lacks read access | Add the project with Can read in Machine Account → Projects |
| Node not in palette | `N8N_COMMUNITY_PACKAGES_ENABLED` not set | Set env var to `true`, restart n8n |
| `Failed to authenticate … [REDACTED]` | Token contains invalid characters or is truncated | Re-copy the Access Token from Bitwarden |

---

## Building from source

```bash
# Requires Node.js ≥ 18 on your development machine

git clone https://github.com/YOUR_USERNAME/n8n-nodes-bitwarden-secrets
cd n8n-nodes-bitwarden-secrets

npm install --include=dev --production=false
npm run build

# Check compiled output
ls dist/credentials/           # BitwardenSecretsManagerApi.credentials.js
ls dist/nodes/BitwardenSecrets/  # BitwardenSecrets.node.js  bitwardenSecrets.svg

# Create installable tarball
npm pack
```

---

## How it works

The node uses [`@bitwarden/sdk-wasm`](https://www.npmjs.com/package/@bitwarden/sdk-wasm) — Bitwarden's official WebAssembly SDK for Secrets Manager. The WASM binary is loaded synchronously from the npm package at module load time (no async init required in Node.js).

Startup (once per Node.js process):
- A `BitwardenClient` singleton is created with the Bitwarden cloud API/identity URLs.
- The singleton is never freed — re-constructing it in the same process would reinitialize the WASM/Rust global logger and cause a `SetLoggerError(())` panic.

For each workflow execution:
1. The singleton client is retrieved (already initialized).
2. The Access Token is used to authenticate via the `accessTokenLogin` command.
3. Each input item triggers a `secrets.get` command to retrieve the specified secret by UUID.

The SDK communicates via a JSON message-passing interface (`run_command`), which works identically on Alpine Linux, Debian, macOS, and Windows.

---

## Limitations / TODOs (v0.1.0)

- **Read-only** — Get Secret by ID only.
- **Cloud Bitwarden only** — hardcoded to `api.bitwarden.com` / `identity.bitwarden.com`. A future version could expose a `Server URL` credential field for self-hosted instances.
- **No credential test button** — validates on first workflow run only.
- **Singleton SDK client** — `BitwardenClient` is created once per Node.js process (not per execution). Authentication via `accessTokenLogin` runs on every execution so fresh credentials are used, but the underlying WASM instance is reused to avoid the global-logger panic.
- **No cross-execution credential caching** — the Access Token is read from the n8n credential store on every execution; no tokens are persisted to disk.
