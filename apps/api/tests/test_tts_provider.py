import asyncio
import io
import json
import wave

import httpx
import pytest

from owli_avatar.ollama import ProviderError
from owli_avatar.tts import MAX_AUDIO_BYTES, PiperProvider


def run(coro):
    return asyncio.run(coro)


def make_wav(seconds=0.1):
    stream = io.BytesIO()
    with wave.open(stream, "wb") as wav:
        wav.setnchannels(1)
        wav.setsampwidth(2)
        wav.setframerate(16000)
        wav.writeframes(b"\0\0" * int(16000 * seconds))
    return stream.getvalue()


def test_synthesize_posts_text_and_returns_valid_wav():
    expected = make_wav()
    def handler(request):
        assert request.url.path == "/synthesize"
        assert json.loads(request.content) == {"text": "Hallo Piper"}
        return httpx.Response(200, content=expected)
    provider = PiperProvider("http://127.0.0.1:5000", transport=httpx.MockTransport(handler))
    assert run(provider.synthesize("Hallo Piper")) == expected


@pytest.mark.parametrize("body", [b"bad", b"RIFF\0\0\0\0WAVE", make_wav(31)])
def test_rejects_malformed_or_too_long_wav(body):
    provider = PiperProvider("http://localhost:5000", transport=httpx.MockTransport(lambda _: httpx.Response(200, content=body)))
    with pytest.raises(ProviderError) as exc:
        run(provider.synthesize("Hallo"))
    assert exc.value.code == "INVALID_PROVIDER_RESPONSE"


def test_rejects_oversize_stream():
    provider = PiperProvider("http://localhost:5000", transport=httpx.MockTransport(lambda _: httpx.Response(200, content=b"x" * (MAX_AUDIO_BYTES + 1))))
    with pytest.raises(ProviderError) as exc:
        run(provider.synthesize("Hallo"))
    assert exc.value.code == "INVALID_PROVIDER_RESPONSE"


@pytest.mark.parametrize("status", [400, 404, 500])
def test_http_errors_are_safe(status):
    provider = PiperProvider("http://localhost:5000", transport=httpx.MockTransport(lambda _: httpx.Response(status, text="private detail")))
    with pytest.raises(ProviderError) as exc:
        run(provider.synthesize("Hallo"))
    assert exc.value.code == "PROVIDER_ERROR"
    assert "private" not in exc.value.message


@pytest.mark.parametrize("error,code", [(httpx.ConnectError("private"), "PROVIDER_UNAVAILABLE"), (httpx.ReadTimeout("private"), "PROVIDER_TIMEOUT")])
def test_transport_errors_are_safe(error, code):
    def handler(_):
        raise error
    provider = PiperProvider("http://localhost:5000", transport=httpx.MockTransport(handler))
    with pytest.raises(ProviderError) as exc:
        run(provider.synthesize("Hallo"))
    assert exc.value.code == code
    assert "private" not in exc.value.message


def test_total_timeout():
    async def handler(_):
        await asyncio.sleep(1)
        return httpx.Response(200, content=make_wav())
    provider = PiperProvider("http://localhost:5000", total_timeout=0.01, transport=httpx.MockTransport(handler))
    with pytest.raises(ProviderError) as exc:
        run(provider.synthesize("Hallo"))
    assert exc.value.code == "PROVIDER_TIMEOUT"


@pytest.mark.parametrize("url", ["http://example.com", "https://localhost:5000", "http://localhost:5000/path"])
def test_rejects_non_loopback_origin(url):
    with pytest.raises(ValueError):
        PiperProvider(url)


def test_truncated_wav_is_rejected():
    body = make_wav()[:-20]
    provider = PiperProvider('http://localhost:5000', transport=httpx.MockTransport(lambda _: httpx.Response(200, content=body)))
    with pytest.raises(ProviderError):
        run(provider.synthesize('Hallo'))
