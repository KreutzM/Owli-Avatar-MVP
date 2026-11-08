import asyncio
import pytest
from fastapi.testclient import TestClient
from owli_avatar.main import app
from owli_avatar.ollama import ProviderError

AUDIO = b'\x1a\x45\xdf\xa3fake'


def test_disabled_and_invalid_inputs(monkeypatch):
    monkeypatch.delenv('OWLI_STT_MODE', raising=False)
    with TestClient(app) as client:
        assert client.get('/api/stt/status').json() == {'enabled': False}
        assert client.post('/api/stt').status_code == 501
        monkeypatch.setenv('OWLI_STT_MODE', 'faster-whisper')
        assert client.post('/api/stt', content=AUDIO, headers={'content-type':'audio/wav'}).status_code == 415
        assert client.post('/api/stt', content=b'bad', headers={'content-type':'audio/webm'}).status_code == 422
        assert client.post('/api/stt', content=b'x' * (5 * 1024 * 1024 + 1), headers={'content-type':'audio/webm'}).status_code == 413


def test_success_and_silence(monkeypatch):
    import owli_avatar.stt as stt
    monkeypatch.setenv('OWLI_STT_MODE', 'faster-whisper')
    class Fake:
        def __init__(self, path, timeout): pass
        async def transcribe(self, audio): return 'Hallo Owli' if len(audio) > 5 else ''
    monkeypatch.setattr(stt, 'FasterWhisperProvider', Fake)
    with TestClient(app) as client:
        result = client.post('/api/stt', content=AUDIO, headers={'content-type':'audio/webm;codecs=opus'})
        assert result.json() == {'text':'Hallo Owli'}
        assert result.headers['cache-control'] == 'no-store'
        result = client.post('/api/stt', content=AUDIO[:4], headers={'content-type':'audio/webm'})
        assert result.json() == {'text':''}


def test_error_missing_model_and_busy(monkeypatch):
    import owli_avatar.main as main
    monkeypatch.setenv('OWLI_STT_MODE', 'faster-whisper')
    monkeypatch.setenv('STT_MODEL_PATH', '/missing')
    with TestClient(app) as client:
        response = client.post('/api/stt', content=AUDIO, headers={'content-type':'audio/webm'})
        assert response.status_code == 503
        assert response.json()['error']['code'] == 'STT_CONFIG_ERROR'
        monkeypatch.setattr(main, 'active_stt_requests', 1)
        assert client.post('/api/stt', content=AUDIO, headers={'content-type':'audio/webm'}).json()['error']['code'] == 'STT_BUSY'


def test_disconnect_cancels_and_releases(monkeypatch):
    import owli_avatar.main as main
    import owli_avatar.stt as stt
    async def scenario():
        monkeypatch.setenv('OWLI_STT_MODE', 'faster-whisper')
        monkeypatch.setattr(main, 'active_stt_requests', 0)
        stopped = asyncio.Event()
        class Fake:
            def __init__(self, path, timeout): pass
            async def transcribe(self, audio):
                try: await asyncio.sleep(10)
                finally: stopped.set()
        class Request:
            headers={'content-type':'audio/webm'}
            async def body(self): return AUDIO
            async def is_disconnected(self): return True
        monkeypatch.setattr(stt, 'FasterWhisperProvider', Fake)
        with pytest.raises(asyncio.CancelledError): await main.stt(Request())
        assert stopped.is_set() and main.active_stt_requests == 0
    asyncio.run(scenario())


def test_body_read_timeout_and_capacity():
    from owli_avatar.main import STTGuard
    async def scenario():
        async def downstream(scope, receive, send):
            raise AssertionError('incomplete upload reached endpoint')
        guard = STTGuard(downstream)
        guard.read_timeout = .02
        statuses = []
        async def receive(): await asyncio.sleep(10)
        async def send(event):
            if event['type'] == 'http.response.start': statuses.append(event['status'])
        scope = {'type':'http','path':'/api/stt','method':'POST'}
        tasks = [asyncio.create_task(guard(scope, receive, send)) for _ in range(2)]
        await asyncio.sleep(0)
        await guard(scope, receive, send)
        await asyncio.gather(*tasks)
        assert statuses.count(503) == 1 and statuses.count(408) == 2
        assert guard.reading == 0
    asyncio.run(scenario())


def test_stt_rate_limit():
    from fastapi import FastAPI
    from owli_avatar.main import STTGuard
    test_app = FastAPI()
    test_app.add_middleware(STTGuard)
    @test_app.post('/api/stt')
    async def ok(): return {'ok':True}
    with TestClient(test_app) as client:
        for _ in range(20): assert client.post('/api/stt', content=b'x').status_code == 200
        assert client.post('/api/stt', content=b'x').status_code == 429
