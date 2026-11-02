"""Bounded asynchronous HTTP adapter for a local Piper service."""
import asyncio
import io
import wave

import httpx

from .ollama import ProviderError, validate_base_url

MAX_AUDIO_BYTES = 10 * 1024 * 1024
MAX_AUDIO_SECONDS = 30
MAX_TEXT_CHARS = 4000


class PiperProvider:
    def __init__(self, base_url: str, connect_timeout: float = 3, total_timeout: float = 60, transport=None):
        self.base_url = validate_base_url(base_url)
        if connect_timeout <= 0 or total_timeout <= 0:
            raise ValueError("timeouts must be positive")
        self.connect_timeout = connect_timeout
        self.total_timeout = total_timeout
        self.transport = transport

    async def synthesize(self, text: str) -> bytes:
        if not isinstance(text, str) or not text.strip() or len(text) > MAX_TEXT_CHARS:
            raise ProviderError("INVALID_PROVIDER_RESPONSE", 422, "Text for speech is invalid")
        try:
            async with asyncio.timeout(self.total_timeout):
                async with httpx.AsyncClient(timeout=httpx.Timeout(self.total_timeout, connect=self.connect_timeout), transport=self.transport, trust_env=False, follow_redirects=False) as client:
                    async with client.stream("POST", self.base_url + "/synthesize", json={"text": text}) as response:
                        if response.status_code < 200 or response.status_code >= 300:
                            raise ProviderError("PROVIDER_ERROR", 502, "The speech provider could not complete the request")
                        audio = bytearray()
                        async for chunk in response.aiter_bytes():
                            audio.extend(chunk)
                            if len(audio) > MAX_AUDIO_BYTES:
                                raise ProviderError("INVALID_PROVIDER_RESPONSE", 502, "The speech provider returned an invalid response")
                        result = bytes(audio)
                        self._validate_wav(result)
                        return result
        except (TimeoutError, httpx.TimeoutException) as exc:
            raise ProviderError("PROVIDER_TIMEOUT", 504, "The speech provider timed out") from exc
        except httpx.RequestError as exc:
            raise ProviderError("PROVIDER_UNAVAILABLE", 503, "The speech provider is unavailable") from exc

    @staticmethod
    def _validate_wav(data: bytes) -> None:
        try:
            with wave.open(io.BytesIO(data), "rb") as wav:
                channels = wav.getnchannels()
                rate = wav.getframerate()
                frames = wav.getnframes()
                width = wav.getsampwidth()
                duration = frames / rate if rate else 0
                if (wav.getcomptype() != "NONE" or channels not in (1, 2) or
                        width not in (1, 2, 3, 4) or not 8000 <= rate <= 192000 or
                        frames <= 0 or duration > MAX_AUDIO_SECONDS or
                        len(data) < 44 or frames * channels * width > MAX_AUDIO_BYTES):
                    raise ValueError
                if len(wav.readframes(frames)) != frames * channels * width:
                    raise ValueError
        except (wave.Error, EOFError, ValueError) as exc:
            raise ProviderError("INVALID_PROVIDER_RESPONSE", 502, "The speech provider returned an invalid response") from exc
