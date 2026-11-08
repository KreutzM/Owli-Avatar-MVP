#!/usr/bin/env bash
# Starts only the Owli API child and Vite; Ollama/Piper remain external services.
set -Eeuo pipefail
cd "$(dirname "$0")/.."

api_pid=''
web_pid=''
stop_children() {
  for pid in "$api_pid" "$web_pid"; do
    if [[ -n "$pid" ]]; then kill "$pid" 2>/dev/null || true; fi
  done
  for pid in "$api_pid" "$web_pid"; do
    if [[ -n "$pid" ]]; then wait "$pid" 2>/dev/null || true; fi
  done
}
trap stop_children EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

fail() { printf 'Owli preflight: %s\n' "$1" >&2; exit 1; }
case "${OWLI_MODE:-mock}" in mock|ollama) ;; *) fail 'OWLI_MODE must be mock or ollama' ;; esac
case "${OWLI_TTS_MODE:-off}" in off|piper) ;; *) fail 'OWLI_TTS_MODE must be off or piper' ;; esac
case "${OWLI_STT_MODE:-off}" in off|faster-whisper) ;; *) fail 'OWLI_STT_MODE must be off or faster-whisper' ;; esac

[[ -x apps/api/.venv/bin/python ]] || fail 'API environment missing; run bash scripts/bootstrap.sh'
[[ -x apps/web/node_modules/.bin/vite ]] || fail 'Web dependencies missing; run bash scripts/bootstrap.sh'
if [[ "${OWLI_STT_MODE:-off}" == faster-whisper ]]; then
  model="${STT_MODEL_PATH:-}"
  [[ -n "$model" && "$model" == /* && -d "$model" ]] || fail 'STT_MODEL_PATH must be an existing absolute model directory'
  apps/api/.venv/bin/python -c "import av, faster_whisper" || fail 'STT requires PyAV and faster-whisper in the API environment'
  for file in config.json model.bin tokenizer.json; do
    [[ -f "$model/$file" && -r "$model/$file" ]] || fail "STT model is missing readable $file"
  done
fi
if [[ "${OWLI_MODE:-mock}" == ollama ]]; then
  [[ -n "${OLLAMA_MODEL:-}" ]] || fail 'OLLAMA_MODEL is required when OWLI_MODE=ollama'
  [[ "${OLLAMA_BASE_URL:-http://127.0.0.1:11434}" == http://127.0.0.1:* || "${OLLAMA_BASE_URL:-http://127.0.0.1:11434}" == http://localhost:* ]] || fail 'Ollama origin must use HTTP loopback'
fi
if [[ "${OWLI_TTS_MODE:-off}" == piper ]]; then
  [[ "${PIPER_BASE_URL:-http://127.0.0.1:5000}" == http://127.0.0.1:* || "${PIPER_BASE_URL:-http://127.0.0.1:5000}" == http://localhost:* ]] || fail 'Piper origin must use HTTP loopback'
fi

# Check existing loopback services without starting, stopping, or changing them.
if [[ "${OWLI_MODE:-mock}" == ollama || "${OWLI_TTS_MODE:-off}" == piper ]]; then
  apps/api/.venv/bin/python - <<'PYCODE' || fail 'live provider preflight failed'
import json, os, socket, sys, urllib.parse, urllib.request
def origin(value):
    u = urllib.parse.urlsplit(value)
    if u.scheme != 'http' or u.hostname not in ('127.0.0.1', 'localhost') or u.username or u.password or u.path not in ('', '/') or u.query or u.fragment:
        raise ValueError('provider origin must be a plain HTTP loopback origin')
    return u
try:
    if os.getenv('OWLI_MODE', 'mock') == 'ollama':
        u = origin(os.getenv('OLLAMA_BASE_URL', 'http://127.0.0.1:11434'))
        opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
        with opener.open(f'http://{u.netloc}/api/tags', timeout=3) as response:
            data = json.load(response)
        if not any(item.get('name') == os.getenv('OLLAMA_MODEL') for item in data.get('models', [])):
            raise ValueError('configured Ollama model was not listed')
    if os.getenv('OWLI_TTS_MODE', 'off') == 'piper':
        u = origin(os.getenv('PIPER_BASE_URL', 'http://127.0.0.1:5000'))
        with socket.create_connection((u.hostname, u.port or 80), timeout=3):
            pass
except (OSError, ValueError, TypeError, AttributeError) as exc:
    print(f'Provider check failed: {exc}', file=sys.stderr)
    sys.exit(1)
PYCODE
fi

# Probe fixed application ports without touching any existing listener.
apps/api/.venv/bin/python - <<'PY' || fail 'could not verify application ports'
import socket
import sys
for port in (8765, 5173):
    try:
        with socket.socket() as sock:
            sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
            sock.bind(('127.0.0.1', port))
    except OSError as exc:
        print(f'Cannot bind loopback port {port}: {exc}', file=sys.stderr)
        sys.exit(1)
PY
[[ "${OWLI_PREFLIGHT_ONLY:-0}" == 1 ]] && { echo 'Owli preflight OK (loopback ports 8765, 5173 available)'; exit 0; }

OWLI_HOST=127.0.0.1 OWLI_PORT=8765 apps/api/.venv/bin/python -m uvicorn \
  owli_avatar.main:app --app-dir apps/api/src --host 127.0.0.1 --port 8765 &
api_pid=$!
(cd apps/web && exec ./node_modules/.bin/vite --host 127.0.0.1 --port 5173 --strictPort) &
web_pid=$!
echo "Owli API PID=$api_pid; Vite PID=$web_pid at http://127.0.0.1:5173"
# A failed child must stop its sibling, including on a port race after preflight.
wait -n "$api_pid" "$web_pid"
