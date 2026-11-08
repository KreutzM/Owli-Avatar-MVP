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


@pytest.mark.parametrize("setting,expected", [("auto", None), ("true", True), ("false", False)])
@pytest.mark.parametrize("model", ["gemma4:e2b", "another-model"])
def test_think_configuration_controls_ollama_request(monkeypatch, setting, expected, model):
    from owli_avatar.main import provider
    monkeypatch.setenv("OLLAMA_MODEL", model)
    monkeypatch.setenv("OLLAMA_THINK", setting)
    def handler(request):
        payload = json.loads(request.content)
        assert payload["model"] == model
        if expected is None:
            assert "think" not in payload
        else:
            assert payload["think"] is expected
        return httpx.Response(200, json={"message": {"content": "OK"}})
    instance = provider()
    instance.transport = httpx.MockTransport(handler)
    assert run(instance.generate([{"role": "user", "content": "Hallo"}])) == "OK"


@pytest.mark.parametrize("setting", ["", "yes", "False", "0", " false "])
def test_invalid_think_setting_fails_safely_and_mock_remains_available(monkeypatch, setting):
    monkeypatch.setenv("OLLAMA_MODEL", "local")
    monkeypatch.setenv("OLLAMA_THINK", setting)
    monkeypatch.setenv("OWLI_MODE", "ollama")
    with TestClient(app) as client:
        response = client.post("/api/chat", json={"message": "Hallo"})
        assert response.status_code == 503
        assert response.json()["error"]["code"] == "CONFIG_ERROR"
        monkeypatch.setenv("OWLI_MODE", "mock")
        assert client.post("/api/chat", json={"message": "Hallo"}).status_code == 200


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


def test_raw_request_limit():
    with TestClient(app) as client:
        result = client.post('/api/chat', json={'message': 'hello', 'extra': 'x' * 17000})
    assert result.status_code == 413
    assert result.json()['error']['code'] == 'REQUEST_TOO_LARGE'


def test_provider_capacity_releases_on_error(monkeypatch):
    import owli_avatar.main as main
    monkeypatch.setenv('OWLI_MODE', 'ollama')
    monkeypatch.setenv('OLLAMA_MODEL', 'local')
    monkeypatch.setattr(main, 'active_provider_requests', 4)
    with TestClient(app) as client:
        result = client.post('/api/chat', json={'message': 'hi'})
    assert result.status_code == 503
    assert result.json()['error']['code'] == 'PROVIDER_BUSY'


def test_rate_limit_and_window(monkeypatch):
    from fastapi import FastAPI
    from owli_avatar.main import ChatGuard
    clock = [100.0]
    monkeypatch.setattr('owli_avatar.main.time.monotonic', lambda: clock[0])
    test_app = FastAPI()
    test_app.add_middleware(ChatGuard)
    @test_app.post('/api/chat')
    async def ok():
        return {'ok': True}
    with TestClient(test_app) as client:
        for _ in range(60):
            assert client.post('/api/chat', json={}).status_code == 200
        assert client.post('/api/chat', json={}).status_code == 429
        clock[0] += 61
        assert client.post('/api/chat', json={}).status_code == 200


def test_slow_body_timeout_and_capacity():
    from owli_avatar.main import ChatGuard
    async def scenario():
        async def app(scope, receive, send):
            raise AssertionError('incomplete body reached app')
        guard = ChatGuard(app)
        guard.read_timeout = 0.02
        statuses = []
        async def receive():
            await asyncio.sleep(10)
        async def send(event):
            if event['type'] == 'http.response.start':
                statuses.append(event['status'])
        scope = {'type': 'http', 'path': '/api/chat', 'method': 'POST'}
        tasks = [asyncio.create_task(guard(scope, receive, send)) for _ in range(8)]
        await asyncio.sleep(0)
        await guard(scope, receive, send)
        await asyncio.gather(*tasks)
        assert statuses.count(503) == 1
        assert statuses.count(408) == 8
        assert guard.reading == 0
    run(scenario())


def test_parallel_provider_limit_and_cancel_release(monkeypatch):
    import owli_avatar.main as main
    async def scenario():
        monkeypatch.setenv('OWLI_MODE', 'ollama')
        monkeypatch.setattr(main, 'sessions', Sessions())
        monkeypatch.setattr(main, 'active_provider_requests', 0)
        class Fake:
            async def generate(self, messages):
                await asyncio.sleep(10)
        class Request:
            async def is_disconnected(self):
                return False
        monkeypatch.setattr(main, 'provider', lambda: Fake())
        tasks = [asyncio.create_task(main.chat(main.ChatRequest(message='hi'), Request())) for _ in range(4)]
        await asyncio.sleep(0.02)
        with pytest.raises(ProviderError) as error:
            await main.chat(main.ChatRequest(message='hi'), Request())
        assert error.value.code == 'PROVIDER_BUSY'
        for task in tasks:
            task.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)
        assert main.active_provider_requests == 0
        assert not main.sessions.items
    run(scenario())
