"""Safe, preflight-only checks for the local runner."""
import os
from pathlib import Path
import subprocess
import unittest

ROOT = Path(__file__).resolve().parents[2]
RUNNER = ROOT / "scripts" / "run-dev.sh"


class RunnerPreflightTests(unittest.TestCase):
    def run_preflight(self, **overrides):
        env = {**os.environ, "OWLI_PREFLIGHT_ONLY": "1", **overrides}
        return subprocess.run(["bash", str(RUNNER)], cwd=ROOT, env=env, text=True, capture_output=True)

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


if __name__ == "__main__":
    unittest.main()
