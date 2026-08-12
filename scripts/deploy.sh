#!/usr/bin/env bash
# Pull the latest code, rebuild, and restart n8n.
# Run on the n8n host, from anywhere:
#   ~/n8n-compose/custom-nodes/n8n-nodes-bitwarden-secrets/scripts/deploy.sh
set -euo pipefail

cd "$(dirname "$0")/.."

# ~/n8n-compose/custom-nodes/<this repo> -> ~/n8n-compose
COMPOSE_DIR="${COMPOSE_DIR:-$(cd ../.. && pwd)}"
SERVICE="${SERVICE:-n8n}"
# Only used when the host has no npm; matches the Node major in the n8n image.
NODE_IMAGE="${NODE_IMAGE:-node:22-alpine}"

echo "==> git pull"
git pull

if command -v npm >/dev/null 2>&1; then
  echo "==> npm install && npm run build (host)"
  npm install --ignore-scripts
  npm run build
else
  # No Node on the host, so build in a throwaway container. --user keeps
  # node_modules/ and dist/ owned by the invoking user instead of root.
  echo "==> npm install && npm run build (in $NODE_IMAGE)"
  docker run --rm \
    -v "$PWD:/app" -w /app \
    --user "$(id -u):$(id -g)" \
    -e HOME=/tmp -e npm_config_cache=/tmp/.npm \
    "$NODE_IMAGE" \
    sh -c 'npm install --ignore-scripts && npm run build'
fi

COMMIT=$(git log -1 --pretty='%h %s')

echo "==> docker compose restart $SERVICE"
cd "$COMPOSE_DIR"
docker compose restart "$SERVICE"

echo "Done: $COMMIT"
