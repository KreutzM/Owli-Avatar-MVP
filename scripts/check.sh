#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
# Load optional user-local tool paths without changing the caller's shell.
source scripts/dev-tools-env.sh
python3 scripts/check_foundation.py
[[ -x apps/api/.venv/bin/python ]] || { echo "Run bash scripts/bootstrap.sh first" >&2; exit 1; }
apps/api/.venv/bin/python -m pytest apps/api/tests -q
python3 -m unittest scripts.tests.test_run_dev scripts.tests.test_lan_proxy -v
(cd apps/web && npm run build)


if [[ "${1:-}" == "--browser" ]]; then
  (cd apps/web && npm run test:e2e)
fi
