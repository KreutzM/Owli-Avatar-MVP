#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
command -v python3 >/dev/null || { echo "Python 3 missing" >&2; exit 1; }
command -v npm >/dev/null || { echo "npm missing" >&2; exit 1; }
python3 -m venv .venv
.venv/bin/python -m pip install -e './apps/api[dev]'
(cd apps/web && npm install --no-audit --no-fund)
echo "Installed project-local dependencies. Run ./scripts/run-dev.sh"
echo "IMPORTANT: package-lock.json is not yet committed; add/pin it in Phase 1."

