from fastapi.testclient import TestClient

from owli_avatar.main import app

client = TestClient(app)


def test_health_is_explicitly_mock() -> None:
    assert client.get("/api/health").json() == {"status": "ok", "mode": "mock"}


def test_chat_is_deterministic_and_not_live() -> None:
    response = client.post("/api/chat", json={"message": "Hallo!"})
    assert response.status_code == 200
    assert response.json() == {
        "reply": "Mock-Antwort: Du hast gefragt: Hallo!",
        "session_id": "demo-session",
        "mode": "mock",
    }


def test_invalid_messages_rejected() -> None:
    for message in ("", " ", "a" * 1001):
        response = client.post("/api/chat", json={"message": message})
        assert response.status_code == 422
        assert response.json() == {
            "error": {"code": "VALIDATION_ERROR", "message": response.json()["error"]["message"]}
        }


def test_missing_tts_stt_fail_openly() -> None:
    for path in ("/api/tts", "/api/stt"):
        response = client.post(path)
        assert response.status_code == 501
        assert response.json()["error"]["code"] == "NOT_IMPLEMENTED"
        assert isinstance(response.json()["error"]["message"], str)


def test_avatar_is_labelled_placeholder() -> None:
    data = client.get("/api/avatar/config").json()
    assert data["mode"] == "placeholder"
    assert data["capabilities"]["blink"] is False

