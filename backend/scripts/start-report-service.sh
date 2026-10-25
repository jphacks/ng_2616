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
# Same pattern for Lean: the key is shared with Vercel's LEAN_WORKER_KEY.
if [ ! -e .env.lean ]; then
    python3 - <<'PY'
import secrets
from pathlib import Path
Path('.env.lean').write_text('APP_ENV=production\nLEAN_WORKER_KEY=' + secrets.token_urlsafe(32) + '\n')
PY
fi
chmod 600 .env.lean
# And for CAS: the key is shared with Vercel's CAS_WORKER_KEY.
if [ ! -e .env.cas ]; then
    python3 - <<'PY'
import secrets
from pathlib import Path
Path('.env.cas').write_text('APP_ENV=production\nCAS_WORKER_KEY=' + secrets.token_urlsafe(32) + '\n')
PY
fi
chmod 600 .env.cas
sudo docker compose -f compose.azure.yaml config --quiet
sudo docker compose -f compose.azure.yaml build
sudo docker compose -f compose.azure.yaml run --rm --no-deps https caddy validate --config /etc/caddy/Caddyfile
sudo docker compose -f compose.azure.yaml up -d
sudo docker compose -f compose.azure.yaml ps
