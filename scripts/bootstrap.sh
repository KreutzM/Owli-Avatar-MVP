#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
command -v python3 >/dev/null || { echo "Python 3 missing" >&2; exit 1; }
command -v uv >/dev/null || { echo "uv missing: install uv 0.9.17 first" >&2; exit 1; }
command -v npm >/dev/null || { echo "npm missing" >&2; exit 1; }
uv sync --project apps/api --frozen --extra dev
(cd apps/web && npm ci --no-audit --no-fund)
echo "Installed project-local dependencies. Run ./scripts/run-dev.sh"
echo "Locked dependency installation complete; see docs/verification.md for browser prerequisites."

