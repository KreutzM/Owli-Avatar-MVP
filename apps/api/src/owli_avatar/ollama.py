"""Bounded, asynchronous Ollama adapter; no model downloads or fallback."""
import asyncio
import ipaddress
import json
from urllib.parse import urlsplit

import httpx


class ProviderError(Exception):
    def __init__(self, code: str, status: int, message: str):
        self.code, self.status, self.message = code, status, message
        super().__init__(message)


def validate_base_url(url: str) -> str:
    try:
        parsed = urlsplit(url)
        host = parsed.hostname or ""
        loopback = host == "localhost" or ipaddress.ip_address(host).is_loopback
        if parsed.scheme != "http" or not loopback or parsed.username or parsed.password or parsed.path not in ("", "/") or parsed.query or parsed.fragment:
            raise ValueError
        _ = parsed.port
    except ValueError as exc:
        raise ValueError("OLLAMA_BASE_URL must be an HTTP loopback origin") from exc
    return url.rstrip("/")


class OllamaProvider:
    def __init__(self, base_url: str, model: str, connect_timeout: float = 3, total_timeout: float = 60, transport=None, think: str = "auto"):
        self.base_url = validate_base_url(base_url)
        if not model.strip() or len(model) > 256:
            raise ValueError("OLLAMA_MODEL is required")
        self.model = model
        if think not in ("auto", "true", "false"):
            raise ValueError("OLLAMA_THINK must be auto, true or false")
        self.think = think
        self.connect_timeout = connect_timeout
        self.total_timeout = total_timeout
        self.transport = transport

    async def generate(self, messages: list[dict[str, str]]) -> str:
        payload = {"model": self.model, "messages": messages, "stream": False, "options": {"num_predict": 256}}
        if self.think != "auto":
            payload["think"] = self.think == "true"
        try:
            async with asyncio.timeout(self.total_timeout):
                async with httpx.AsyncClient(timeout=httpx.Timeout(self.total_timeout, connect=self.connect_timeout), transport=self.transport, trust_env=False, follow_redirects=False) as client:
                    async with client.stream("POST", self.base_url + "/api/chat", json=payload) as response:
                        if response.status_code == 404:
                            raise ProviderError("MODEL_NOT_FOUND", 503, "The configured model is unavailable")
                        if response.status_code >= 400 or response.status_code < 200 or response.status_code >= 300:
                            raise ProviderError("PROVIDER_ERROR", 502, "The text provider could not complete the request")
                        data = bytearray()
                        async for chunk in response.aiter_bytes():
                            data.extend(chunk)
                            if len(data) > 65536:
                                raise ProviderError("INVALID_PROVIDER_RESPONSE", 502, "The text provider returned an invalid response")
                        try:
                            body = json.loads(data)
                            reply = body["message"]["content"]
                            if not isinstance(reply, str) or not reply.strip() or len(reply) > 4000:
                                raise ValueError
                        except (ValueError, KeyError, TypeError) as exc:
                            raise ProviderError("INVALID_PROVIDER_RESPONSE", 502, "The text provider returned an invalid response") from exc
                        return reply.strip()
        except (TimeoutError, httpx.TimeoutException) as exc:
            raise ProviderError("PROVIDER_TIMEOUT", 504, "The text provider timed out") from exc
        except httpx.RequestError as exc:
            raise ProviderError("PROVIDER_UNAVAILABLE", 503, "The text provider is unavailable") from exc
