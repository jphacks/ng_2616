#!/usr/bin/env bash
# Update the Azure VM: fast-forward the git clone to its branch on GitHub, then rebuild and restart.
# The VM never carries local commits; a diverged clone stops here instead of merging.
set -euo pipefail
cd -- "$(dirname -- "$0")/.."
git pull --ff-only
git log -1 --format='Deploying %h %s'
bash scripts/start-report-service.sh
