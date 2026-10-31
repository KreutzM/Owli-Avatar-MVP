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
    assert client.post("/api/chat", json={"message": ""}).status_code == 422
    assert client.post("/api/chat", json={"message": " "}).status_code == 422
    assert client.post("/api/chat", json={"message": "a" * 1001}).status_code == 422


def test_missing_tts_stt_fail_openly() -> None:
    assert client.post("/api/tts").status_code == 501
    assert client.post("/api/stt").status_code == 501


def test_avatar_is_labelled_placeholder() -> None:
    data = client.get("/api/avatar/config").json()
    assert data["mode"] == "placeholder"

