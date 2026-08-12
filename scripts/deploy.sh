#!/usr/bin/env bash
# Pull the latest code, rebuild, and restart n8n.
# Run on the n8n host, from anywhere:
#   ~/n8n-compose/custom-nodes/n8n-nodes-bitwarden-secrets/scripts/deploy.sh
set -euo pipefail

cd "$(dirname "$0")/.."

# ~/n8n-compose/custom-nodes/<this repo> -> ~/n8n-compose
COMPOSE_DIR="${COMPOSE_DIR:-$(cd ../.. && pwd)}"
SERVICE="${SERVICE:-n8n}"

echo "==> git pull"
git pull

echo "==> npm install"
npm install

echo "==> npm run build"
npm run build

COMMIT=$(git log -1 --pretty='%h %s')

echo "==> docker compose restart $SERVICE"
cd "$COMPOSE_DIR"
docker compose restart "$SERVICE"

echo "Done: $COMMIT"
