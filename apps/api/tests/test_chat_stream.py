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


def ndjson(*items):
    return b"".join((json.dumps(item) + "\n").encode() for item in items)


def test_ollama_stream_requests_incremental_ndjson_and_ignores_thinking():
    chunks = [
        {"message": {"thinking": "private reasoning"}, "done": False},
        {"message": {"content": "Hello"}, "done": False},
        {"message": {"content": " world"}, "done": True},
    ]

    def handler(request):
        payload = json.loads(request.content)
        assert payload["stream"] is True
        assert request.url.path == "/api/chat"
        return httpx.Response(200, content=ndjson(*chunks))

    async def scenario():
        provider = OllamaProvider("http://127.0.0.1:11434", "local", transport=httpx.MockTransport(handler))
        return [delta async for delta in provider.stream([{"role": "user", "content": "Hi"}])]

    assert run(scenario()) == ["Hello", " world"]


@pytest.mark.parametrize("body", [b"bad\n", ndjson({"message": {"content": "partial"}, "done": False}), ndjson({"message": {"content": ""}, "done": True})])
def test_ollama_stream_rejects_bad_or_incomplete_events(body):
    async def scenario():
        provider = OllamaProvider("http://127.0.0.1:11434", "local", transport=httpx.MockTransport(lambda _: httpx.Response(200, content=body)))
        return [item async for item in provider.stream([])]

    with pytest.raises(ProviderError) as error:
        run(scenario())
    assert error.value.code == "INVALID_PROVIDER_RESPONSE"


def test_ollama_stream_enforces_cumulative_character_limit():
    body = ndjson(
        {"message": {"content": "x" * 3000}, "done": False},
        {"message": {"content": "y" * 1001}, "done": True},
    )

    async def scenario():
        provider = OllamaProvider("http://127.0.0.1:11434", "local", transport=httpx.MockTransport(lambda _: httpx.Response(200, content=body)))
        return [item async for item in provider.stream([])]

    with pytest.raises(ProviderError) as error:
        run(scenario())
    assert error.value.code == "INVALID_PROVIDER_RESPONSE"


def test_chat_stream_returns_deltas_then_commits_complete_turn(monkeypatch):
    import owli_avatar.main as main
    monkeypatch.setenv("OWLI_MODE", "ollama")
    monkeypatch.setattr(main, "sessions", Sessions())
    observed = []

    class Provider:
        async def stream(self, messages):
            observed.append(messages)
            yield "Hello"
            await asyncio.sleep(0)
            yield " world"

    monkeypatch.setattr(main, "provider", lambda: Provider())
    with TestClient(app) as client:
        first = client.post("/api/chat/stream", json={"message": "Hi"})
        events = [json.loads(line) for line in first.text.splitlines()]
        assert first.headers["content-type"].startswith("application/x-ndjson")
        assert first.headers["cache-control"] == "no-store"
        assert [event["type"] for event in events] == ["start", "delta", "delta", "done"]
        session_id = events[0]["session_id"]
        assert events[-1] == {"type": "done", "reply": "Hello world", "session_id": session_id, "mode": "ollama"}
        second = client.post("/api/chat/stream", json={"message": "Again", "session_id": session_id})
        assert second.status_code == 200
    assert observed[-1] == [
        {"role": "user", "content": "Hi"},
        {"role": "assistant", "content": "Hello world"},
        {"role": "user", "content": "Again"},
    ]


def test_failed_stream_emits_safe_error_without_committing_partial_turn(monkeypatch):
    import owli_avatar.main as main
    store = Sessions()
    monkeypatch.setenv("OWLI_MODE", "ollama")
    monkeypatch.setattr(main, "sessions", store)

    class Provider:
        async def stream(self, messages):
            yield "partial"
            raise ProviderError("PROVIDER_TIMEOUT", 504, "The text provider timed out")

    monkeypatch.setattr(main, "provider", lambda: Provider())
    with TestClient(app) as client:
        response = client.post("/api/chat/stream", json={"message": "Hi"})
    events = [json.loads(line) for line in response.text.splitlines()]
    assert [event["type"] for event in events] == ["start", "delta", "error"]
    assert events[-1] == {"type": "error", "error": {"code": "PROVIDER_TIMEOUT", "message": "The text provider timed out"}}
    assert not store.items


def test_mock_stream_is_incremental_and_matches_legacy_chat(monkeypatch):
    monkeypatch.setenv("OWLI_MODE", "mock")
    with TestClient(app) as client:
        stream = client.post("/api/chat/stream", json={"message": "Hallo"})
        legacy = client.post("/api/chat", json={"message": "Hallo"})
    events = [json.loads(line) for line in stream.text.splitlines()]
    deltas = [event["text"] for event in events if event["type"] == "delta"]
    assert len(deltas) > 1
    assert "".join(deltas) == legacy.json()["reply"]
    assert events[-1]["reply"] == legacy.json()["reply"]


def test_stream_is_sent_before_provider_finishes_and_busy_turn_keeps_session(monkeypatch):
    import owli_avatar.main as main
    monkeypatch.setenv("OWLI_MODE", "ollama")
    store = Sessions()
    monkeypatch.setattr(main, "sessions", store)
    release_provider = asyncio.Event()

    class Provider:
        async def stream(self, messages):
            yield "first"
            await release_provider.wait()
            yield " last"

    monkeypatch.setattr(main, "provider", lambda: Provider())

    async def scenario():
        async def invoke(message, session_id=None):
            body = json.dumps({"message": message, **({"session_id": session_id} if session_id else {})}).encode()
            scope = {
                "type": "http", "asgi": {"version": "3.0"}, "http_version": "1.1", "method": "POST",
                "scheme": "http", "path": "/api/chat/stream", "raw_path": b"/api/chat/stream", "query_string": b"",
                "root_path": "", "headers": [(b"content-type", b"application/json"), (b"content-length", str(len(body)).encode())],
                "client": ("127.0.0.1", 12345), "server": ("127.0.0.1", 8765),
            }
            first = True
            disconnected = asyncio.Event()
            sent = []
            first_delta = asyncio.Event()

            async def receive():
                nonlocal first
                if first:
                    first = False
                    return {"type": "http.request", "body": body, "more_body": False}
                await disconnected.wait()
                return {"type": "http.disconnect"}

            async def send(event):
                sent.append(event)
                if event.get("type") == "http.response.body" and b'"type":"delta"' in event.get("body", b""):
                    first_delta.set()

            task = asyncio.create_task(app(scope, receive, send))
            return task, sent, first_delta, disconnected

        first_task, first_sent, first_delta, _ = await invoke("first")
        await asyncio.wait_for(first_delta.wait(), timeout=1)
        assert not any(event.get("type") == "http.response.body" and b'"type":"done"' in event.get("body", b"") for event in first_sent)
        start = next(json.loads(event["body"]) for event in first_sent if event.get("type") == "http.response.body" and b'"type":"start"' in event.get("body", b""))
        second_task, second_sent, _, _ = await invoke("racing", start["session_id"])
        await second_task
        assert next(event["status"] for event in second_sent if event["type"] == "http.response.start") == 409
        assert start["session_id"] in store.items
        release_provider.set()
        await first_task
        assert [item["content"] for item in store.items[start["session_id"]].messages] == ["first", "first last"]

    run(scenario())


def test_ollama_stream_cancellation_closes_provider_response():
    class SlowBody(httpx.AsyncByteStream):
        def __init__(self):
            self.release = asyncio.Event()
            self.closed = asyncio.Event()

        async def __aiter__(self):
            yield ndjson({"message": {"content": "early"}, "done": False})
            await self.release.wait()
            yield ndjson({"message": {"content": " late"}, "done": True})

        async def aclose(self):
            self.closed.set()

    async def scenario():
        body = SlowBody()
        provider = OllamaProvider("http://127.0.0.1:11434", "local", transport=httpx.MockTransport(lambda _: httpx.Response(200, stream=body)))
        first_delta = asyncio.Event()

        async def consume():
            async for _ in provider.stream([]):
                first_delta.set()

        task = asyncio.create_task(consume())
        await asyncio.wait_for(first_delta.wait(), timeout=1)
        task.cancel()
        with pytest.raises(asyncio.CancelledError):
            await task
        assert body.closed.is_set()

    run(scenario())
