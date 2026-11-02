import asyncio
import json

import httpx
import pytest
from fastapi.testclient import TestClient

from owli_avatar.main import app
from owli_avatar.ollama import OllamaProvider, ProviderError
from owli_avatar.sessions import Sessions


def run(coro):
    return asyncio.run(coro)


def test_payload_and_reply():
    def handler(request):
        body = json.loads(request.content)
        assert body == {"model": "local", "messages": [{"role": "user", "content": "Hallo"}], "stream": False, "options": {"num_predict": 256}}
        assert request.url.path == "/api/chat"
        return httpx.Response(200, json={"message": {"role": "assistant", "content": " Antwort "}})
    provider = OllamaProvider("http://127.0.0.1:11434", "local", transport=httpx.MockTransport(handler))
    assert run(provider.generate([{"role": "user", "content": "Hallo"}])) == "Antwort"


@pytest.mark.parametrize("response,code", [
    (httpx.Response(404), "MODEL_NOT_FOUND"),
    (httpx.Response(400), "PROVIDER_ERROR"),
    (httpx.Response(500), "PROVIDER_ERROR"),
    (httpx.Response(200, content=b"bad"), "INVALID_PROVIDER_RESPONSE"),
    (httpx.Response(200, json={"message": {"content": " "}}), "INVALID_PROVIDER_RESPONSE"),
    (httpx.Response(200, json={"message": {"content": "a" * 4001}}), "INVALID_PROVIDER_RESPONSE"),
    (httpx.Response(200, content=b"a" * 65537), "INVALID_PROVIDER_RESPONSE"),
    (httpx.Response(200, json={"message": []}), "INVALID_PROVIDER_RESPONSE"),
])
def test_invalid_provider_responses(response, code):
    provider = OllamaProvider("http://localhost:11434", "local", transport=httpx.MockTransport(lambda request: response))
    with pytest.raises(ProviderError) as exc:
        run(provider.generate([{"role": "user", "content": "Hi"}]))
    assert exc.value.code == code


@pytest.mark.parametrize("error,code", [(httpx.ConnectError("private"), "PROVIDER_UNAVAILABLE"), (httpx.ReadTimeout("private"), "PROVIDER_TIMEOUT")])
def test_transport_errors(error, code):
    def handler(request):
        raise error
    provider = OllamaProvider("http://localhost:11434", "local", transport=httpx.MockTransport(handler))
    with pytest.raises(ProviderError) as exc:
        run(provider.generate([]))
    assert exc.value.code == code
    assert "private" not in exc.value.message


def test_total_timeout_and_cancellation():
    async def scenario():
        cancelled = asyncio.Event()
        async def handler(request):
            try:
                await asyncio.sleep(10)
            finally:
                cancelled.set()
        p = OllamaProvider("http://localhost:11434", "local", total_timeout=0.01, transport=httpx.MockTransport(handler))
        with pytest.raises(ProviderError) as exc:
            await p.generate([])
        assert exc.value.code == "PROVIDER_TIMEOUT"
        assert cancelled.is_set()
        from owli_avatar.main import generate_until_disconnect
        class Disconnected:
            async def is_disconnected(self):
                return True
        cancelled.clear()
        with pytest.raises(asyncio.CancelledError):
            await generate_until_disconnect(Disconnected(), p.__class__("http://localhost:11434", "local", transport=httpx.MockTransport(handler)), [])
        assert cancelled.is_set()
    run(scenario())


@pytest.mark.parametrize("url", ["http://example.com", "http://127.0.0.1:11434/path", "http://user@localhost", "https://localhost"])
def test_reject_non_loopback_or_invalid_origins(url):
    with pytest.raises(ValueError):
        OllamaProvider(url, "local")


def test_session_bounds_and_expiry(monkeypatch):
    clock = [100.0]
    monkeypatch.setattr("owli_avatar.sessions.time.monotonic", lambda: clock[0])
    store = Sessions(limit=2, ttl=10, max_messages=2, max_chars=10)
    first, session = store.get(None)
    second, _ = store.get(None)
    assert first != second
    with pytest.raises(OverflowError):
        store.get(None)
    store.add_turn(session, "hi", "there")
    store.add_turn(session, "a", "b")
    assert session.messages == [{"role": "user", "content": "a"}, {"role": "assistant", "content": "b"}]
    clock[0] += 11
    with pytest.raises(KeyError):
        store.get(first)


def test_api_sessions_and_safe_errors(monkeypatch):
    import owli_avatar.main as main
    monkeypatch.setenv("OWLI_MODE", "ollama")
    monkeypatch.setattr(main, "sessions", Sessions())
    seen = []
    class Fake:
        async def generate(self, messages):
            seen.append(messages)
            return "Antwort"
    monkeypatch.setattr(main, "provider", lambda: Fake())
    with TestClient(app) as client:
        assert client.get('/api/health').json()['mode'] == 'ollama'
        one = client.post('/api/chat', json={'message': 'eins'}).json()
        two = client.post('/api/chat', json={'message': 'zwei'}).json()
        assert one['session_id'] != two['session_id']
        response = client.post('/api/chat', json={'message': 'weiter', 'session_id': one['session_id']})
        assert response.json()['mode'] == 'ollama'
        assert [m['content'] for m in seen[-1]] == ['eins', 'Antwort', 'weiter']
        assert client.post('/api/chat', json={'message': 'x', 'session_id': 'unknown'}).status_code == 404
        assert client.post('/api/chat', json={'message': 'a' * 1001}).status_code == 422


def test_api_provider_failure_is_sanitized(monkeypatch):
    import owli_avatar.main as main
    monkeypatch.setenv('OWLI_MODE', 'ollama')
    monkeypatch.setattr(main, 'sessions', Sessions())
    class Broken:
        async def generate(self, messages):
            raise ProviderError('PROVIDER_UNAVAILABLE', 503, 'The text provider is unavailable')
    monkeypatch.setattr(main, 'provider', lambda: Broken())
    with TestClient(app) as client:
        result = client.post('/api/chat', json={'message': 'hi'})
    assert result.status_code == 503
    assert result.json() == {'error': {'code': 'PROVIDER_UNAVAILABLE', 'message': 'The text provider is unavailable'}}
    assert not main.sessions.items


def test_invalid_mode_and_configuration(monkeypatch):
    monkeypatch.setenv('OWLI_MODE', 'invalid')
    with TestClient(app) as client:
        assert client.get('/api/health').status_code == 503
        monkeypatch.setenv('OWLI_MODE', 'ollama')
        monkeypatch.setenv('OLLAMA_MODEL', '')
        result = client.post('/api/chat', json={'message': 'hi'})
        assert result.status_code == 503
        assert result.json()['error']['code'] == 'CONFIG_ERROR'
