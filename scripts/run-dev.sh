#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
[[ -x apps/api/.venv/bin/python ]] || { echo "Run bash scripts/bootstrap.sh first" >&2; exit 1; }
[[ -d apps/web/node_modules ]] || { echo "Run bash scripts/bootstrap.sh first" >&2; exit 1; }
apps/api/.venv/bin/python -m uvicorn owli_avatar.main:app --app-dir apps/api/src --host 127.0.0.1 --port 8765 &
api_pid=$!
trap 'kill "$api_pid" 2>/dev/null || true; wait "$api_pid" 2>/dev/null || true' EXIT
(cd apps/web && npm run dev)

