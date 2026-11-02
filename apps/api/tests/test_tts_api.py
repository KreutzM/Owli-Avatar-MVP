import asyncio

from fastapi.testclient import TestClient
import pytest

from owli_avatar.main import app
from owli_avatar.ollama import ProviderError


def test_off_preserves_chat(monkeypatch):
    monkeypatch.delenv('OWLI_TTS_MODE', raising=False)
    with TestClient(app) as client:
        assert client.get('/api/tts/status').json() == {'enabled': False}
        assert client.post('/api/tts', json={'text': 'Hallo'}).status_code == 501
        assert client.post('/api/chat', json={'message': 'Hallo'}).status_code == 200


def test_tts_success_no_store_and_validation(monkeypatch):
    import owli_avatar.main as main
    monkeypatch.setenv('OWLI_TTS_MODE', 'piper')
    class Fake:
        async def synthesize(self, text):
            assert text == 'Hallo'
            return b'RIFF fake'
    monkeypatch.setattr(main, 'tts_provider', lambda: Fake())
    with TestClient(app) as client:
        assert client.get('/api/tts/status').json() == {'enabled': True}
        response = client.post('/api/tts', json={'text': ' Hallo '})
        assert response.status_code == 200
        assert response.headers['content-type'] == 'audio/wav'
        assert response.headers['cache-control'] == 'no-store'
        assert response.content == b'RIFF fake'
        for value in ('', ' ', 'x' * 4001):
            assert client.post('/api/tts', json={'text': value}).status_code == 422
        assert client.post('/api/tts', json={'text': 'x', 'extra': 'x' * 17000}).status_code == 413


def test_failure_and_capacity(monkeypatch):
    import owli_avatar.main as main
    monkeypatch.setenv('OWLI_TTS_MODE', 'piper')
    class Fake:
        async def synthesize(self, text):
            raise ProviderError('PROVIDER_UNAVAILABLE', 503, 'The speech provider is unavailable')
    monkeypatch.setattr(main, 'tts_provider', lambda: Fake())
    with TestClient(app) as client:
        response = client.post('/api/tts', json={'text': 'Hallo'})
        assert response.status_code == 503
        assert response.json()['error']['code'] == 'PROVIDER_UNAVAILABLE'
        assert main.active_tts_requests == 0
        monkeypatch.setattr(main, 'active_tts_requests', 2)
        assert client.post('/api/tts', json={'text': 'Hallo'}).json()['error']['code'] == 'TTS_BUSY'


def test_cancellation_releases_provider(monkeypatch):
    import owli_avatar.main as main
    async def scenario():
        monkeypatch.setenv('OWLI_TTS_MODE', 'piper')
        monkeypatch.setattr(main, 'active_tts_requests', 0)
        cancelled = asyncio.Event()
        class Fake:
            async def synthesize(self, text):
                try:
                    await asyncio.sleep(10)
                finally:
                    cancelled.set()
        class Disconnected:
            async def is_disconnected(self):
                return True
        monkeypatch.setattr(main, 'tts_provider', lambda: Fake())
        with pytest.raises(asyncio.CancelledError):
            await main.tts(Disconnected(), main.TTSRequest(text='Hallo'))
        assert cancelled.is_set()
        assert main.active_tts_requests == 0
    asyncio.run(scenario())
