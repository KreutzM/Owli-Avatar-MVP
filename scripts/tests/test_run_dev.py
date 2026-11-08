"""Safe, preflight-only checks for the local runner."""
import os
import json
import socket
import threading
from pathlib import Path
from http.server import BaseHTTPRequestHandler, HTTPServer
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[2]
RUNNER = ROOT / "scripts" / "run-dev.sh"


class RunnerPreflightTests(unittest.TestCase):
    def run_preflight(self, **overrides):
        env = {**os.environ, "OWLI_PREFLIGHT_ONLY": "1", **overrides}
        return subprocess.run(["bash", str(RUNNER)], cwd=ROOT, env=env, text=True, capture_output=True)

    def ollama_fixture(self, models):
        class Handler(BaseHTTPRequestHandler):
            def do_GET(self):
                body = json.dumps({"models": [{"name": name} for name in models]}).encode()
                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)

            def log_message(self, *_args):
                pass

        server = HTTPServer(("127.0.0.1", 0), Handler)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        self.addCleanup(server.server_close)
        self.addCleanup(server.shutdown)
        self.addCleanup(thread.join, 2)
        return server.server_port

    def tcp_fixture(self):
        server = socket.socket()
        server.bind(("127.0.0.1", 0))
        server.listen()
        self.addCleanup(server.close)
        return server.getsockname()[1]

    def test_rejects_unknown_chat_mode_before_start(self):
        result = self.run_preflight(OWLI_MODE="other")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("OWLI_MODE must be mock or ollama", result.stderr)

    def test_live_modes_require_explicit_model_and_local_origins(self):
        no_model = self.run_preflight(OWLI_MODE="ollama", OLLAMA_MODEL="")
        self.assertIn("OLLAMA_MODEL is required", no_model.stderr)
        remote = self.run_preflight(OWLI_MODE="ollama", OLLAMA_MODEL="fixture", OLLAMA_BASE_URL="http://192.0.2.1:11434")
        self.assertIn("Ollama origin must use HTTP loopback", remote.stderr)

    def test_stt_requires_existing_local_model_files(self):
        result = self.run_preflight(OWLI_STT_MODE="faster-whisper", STT_MODEL_PATH="/missing/owli-model")
        self.assertIn("STT_MODEL_PATH must be an existing absolute model directory", result.stderr)

    def test_ollama_preflight_requires_reachable_service_and_configured_model(self):
        unavailable = self.run_preflight(OWLI_MODE="ollama", OLLAMA_MODEL="fixture", OLLAMA_BASE_URL="http://127.0.0.1:1")
        self.assertIn("live provider preflight failed", unavailable.stderr)

        port = self.ollama_fixture(["other:latest"])
        missing_model = self.run_preflight(OWLI_MODE="ollama", OLLAMA_MODEL="fixture", OLLAMA_BASE_URL=f"http://127.0.0.1:{port}")
        self.assertIn("live provider preflight failed", missing_model.stderr)

        port = self.ollama_fixture(["fixture"])
        ready = self.run_preflight(OWLI_MODE="ollama", OLLAMA_MODEL="fixture", OLLAMA_BASE_URL=f"http://127.0.0.1:{port}")
        self.assertEqual(ready.returncode, 0, ready.stderr)

    def test_piper_preflight_checks_loopback_tcp_reachability(self):
        unavailable = self.run_preflight(OWLI_TTS_MODE="piper", PIPER_BASE_URL="http://127.0.0.1:1")
        self.assertIn("live provider preflight failed", unavailable.stderr)

        port = self.tcp_fixture()
        ready = self.run_preflight(OWLI_TTS_MODE="piper", PIPER_BASE_URL=f"http://127.0.0.1:{port}")
        self.assertEqual(ready.returncode, 0, ready.stderr)

    def test_stt_preflight_checks_model_files_and_local_dependencies(self):
        with tempfile.TemporaryDirectory(prefix="owli-runner-stt-test-") as directory:
            model = Path(directory)
            for name in ("config.json", "model.bin", "tokenizer.json"):
                (model / name).write_bytes(b"fixture")
            result = self.run_preflight(OWLI_STT_MODE="faster-whisper", STT_MODEL_PATH=str(model))

        self.assertNotIn("STT model is missing", result.stderr)
        if result.returncode:
            self.assertIn("STT requires PyAV and faster-whisper", result.stderr)
        else:
            self.assertIn("Owli preflight OK", result.stdout)


if __name__ == "__main__":
    unittest.main()
