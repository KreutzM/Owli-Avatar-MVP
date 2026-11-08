import json

from fastapi.testclient import TestClient
from owli_avatar.main import app


def test_diagnostics_disabled_and_strict_numeric(monkeypatch, capsys):
    monkeypatch.delenv("OWLI_DIAGNOSTICS", raising=False)
    with TestClient(app) as client:
        assert client.post("/api/diagnostics", json={"capture_to_playback_ms": 42}).status_code == 404
        monkeypatch.setenv("OWLI_DIAGNOSTICS", "1")
        assert client.post("/api/diagnostics", json={"capture_to_playback_ms": 42, "stt_ms": 12.5}).status_code == 204
        assert client.post("/api/diagnostics", json={"capture_to_playback_ms": 42, "transcript": "private"}).status_code == 422
        assert client.post("/api/diagnostics", json={"capture_to_playback_ms": True}).status_code == 422
        assert client.post("/api/diagnostics", content=b" " * 2049, headers={"content-type": "application/json"}).status_code == 413
    output = capsys.readouterr().out
    line = next(line for line in output.splitlines() if line.startswith("OWLI_METRICS "))
    assert json.loads(line.removeprefix("OWLI_METRICS ")) == {"capture_to_playback_ms": 42, "stt_ms": 12.5}
    assert "private" not in output


def test_provider_timing_only_when_enabled(monkeypatch):
    import owli_avatar.stt as stt

    class Fake:
        def __init__(self, *args, **kwargs): pass
        async def transcribe(self, audio): return "test"

    monkeypatch.setattr(stt, "FasterWhisperProvider", Fake)
    monkeypatch.setenv("OWLI_STT_MODE", "faster-whisper")
    monkeypatch.delenv("OWLI_DIAGNOSTICS", raising=False)
    with TestClient(app) as client:
        response = client.post("/api/stt", content=b"\x1a\x45\xdf\xa3test", headers={"content-type": "audio/webm"})
        assert response.status_code == 200
        assert "server-timing" not in response.headers
        monkeypatch.setenv("OWLI_DIAGNOSTICS", "1")
        response = client.post("/api/stt", content=b"\x1a\x45\xdf\xa3test", headers={"content-type": "audio/webm"})
        assert response.status_code == 200
        assert response.headers["server-timing"].startswith("upload;dur=")
        assert ", stt;dur=" in response.headers["server-timing"]
