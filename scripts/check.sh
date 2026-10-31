#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
python3 scripts/check_foundation.py
[[ -x apps/api/.venv/bin/python ]] || { echo "Run bash scripts/bootstrap.sh first" >&2; exit 1; }
apps/api/.venv/bin/python -m pytest apps/api/tests -q
(cd apps/web && npm run build)


if [[ "${1:-}" == "--browser" ]]; then
  (cd apps/web && npm run test:e2e)
fi
