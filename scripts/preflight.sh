#!/usr/bin/env bash
# Read-only capability checks: no installs, downloads or servers.
set -uo pipefail
cd "$(dirname "$0")/.."
failed=0
check() {
  printf '\n== %s ==\n' "$1"
  shift
  "$@" || { printf 'FAILED: %s\n' "$*" >&2; failed=1; }
}
check Python python3 --version
check uv uv --version
check Node node --version
check npm npm --version
check Git git --version
check Blender "${BLENDER_BIN:-blender-lts}" -b --factory-startup --python-expr 'print("headless OK")'
check 'API Python' apps/api/.venv/bin/python --version
check Playwright apps/web/node_modules/.bin/playwright --version
check Chromium bash -c 'cd apps/web && node --input-type=module -e '\''import {chromium} from "playwright"; const browser = await chromium.launch({headless: true, executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined}); console.log(`Chromium ${browser.version()}`); await browser.close();'\'''
exit "$failed"
