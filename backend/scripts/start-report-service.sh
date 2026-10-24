#!/usr/bin/env bash
# Run inside backend/ of the git clone. Never prints the generated API key.
set -euo pipefail
cd -- "$(dirname -- "$0")/.."
test -f compose.azure.yaml
umask 077
if [ ! -e .env.report ]; then
    python3 - <<'PY'
import secrets
from pathlib import Path
Path('.env.report').write_text('APP_ENV=preview\nBACKEND_API_KEY=' + secrets.token_urlsafe(32) + '\n')
PY
fi
chmod 600 .env.report
sudo docker compose -f compose.azure.yaml config --quiet
sudo docker compose -f compose.azure.yaml build pdf-compiler
sudo docker compose -f compose.azure.yaml run --rm --no-deps https caddy validate --config /etc/caddy/Caddyfile
sudo docker compose -f compose.azure.yaml up -d
sudo docker compose -f compose.azure.yaml ps
