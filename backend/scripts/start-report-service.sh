#!/usr/bin/env bash
# Run inside the uploaded backend directory. Never prints the generated API key.
set -euo pipefail
cd -- "$(dirname -- "$0")/.."
test -f compose.report.yaml
umask 077
if [ ! -e .env.report ]; then
    python3 - <<'PY'
import secrets
from pathlib import Path
Path('.env.report').write_text('APP_ENV=preview\nBACKEND_API_KEY=' + secrets.token_urlsafe(32) + '\n')
PY
fi
chmod 600 .env.report
sudo docker compose -p math-notebook-pdf -f compose.report.yaml config --quiet
sudo docker compose -p math-notebook-pdf -f compose.report.yaml build pdf-compiler
sudo docker compose -p math-notebook-pdf -f compose.report.yaml run --rm --no-deps https caddy validate --config /etc/caddy/Caddyfile
sudo docker compose -p math-notebook-pdf -f compose.report.yaml up -d
sudo docker compose -p math-notebook-pdf -f compose.report.yaml ps
