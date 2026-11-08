"""Local chat API with explicit mock and Ollama modes."""

import asyncio
import os
import time
from collections import deque

from typing import Literal

from fastapi import FastAPI, HTTPException, Request

from .ollama import OllamaProvider, ProviderError
from .sessions import Sessions
from .tts import MAX_TEXT_CHARS, PiperProvider
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse, Response
from pydantic import BaseModel, Field

class ChatGuard:
    def __init__(self, app):
        self.app = app
        self.requests = deque()
        self.reading = 0
        self.read_timeout = 5

    async def __call__(self, scope, receive, send):
        if scope['type'] != 'http' or scope['path'] not in ('/api/chat', '/api/tts') or scope['method'] != 'POST':
            return await self.app(scope, receive, send)
        now = time.monotonic()
        while self.requests and now - self.requests[0] >= 60:
            self.requests.popleft()
        if len(self.requests) >= 60:
            return await JSONResponse(status_code=429, content={'error': {'code': 'RATE_LIMIT', 'message': 'Too many requests'}})(scope, receive, send)
        self.requests.append(now)
        if self.reading >= 8:
            return await JSONResponse(status_code=503, content={'error': {'code': 'REQUEST_BUSY', 'message': 'Too many requests in progress'}})(scope, receive, send)
        self.reading += 1
        body = bytearray()
        try:
            try:
                async with asyncio.timeout(self.read_timeout):
                    while True:
                        event = await receive()
                        if event['type'] == 'http.disconnect':
                            return
                        body.extend(event.get('body', b''))
                        if len(body) > 16384:
                            return await JSONResponse(status_code=413, content={'error': {'code': 'REQUEST_TOO_LARGE', 'message': 'Request is too large'}})(scope, receive, send)
                        if not event.get('more_body', False):
                            break
            except TimeoutError:
                return await JSONResponse(status_code=408, content={'error': {'code': 'REQUEST_TIMEOUT', 'message': 'Request timed out'}})(scope, receive, send)
        finally:
            self.reading -= 1
        delivered = False
        async def replay():
            nonlocal delivered
            if not delivered:
                delivered = True
                return {'type': 'http.request', 'body': bytes(body), 'more_body': False}
            return await receive()
        await self.app(scope, replay, send)


class STTGuard:
    """Bound untrusted raw audio before FastAPI reads the body."""
    def __init__(self, app):
        self.app = app
        self.requests = deque()
        self.reading = 0
        self.read_timeout = 10

    async def __call__(self, scope, receive, send):
        if scope['type'] != 'http' or scope['path'] != '/api/stt' or scope['method'] != 'POST':
            return await self.app(scope, receive, send)
        now = time.monotonic()
        while self.requests and now - self.requests[0] >= 60:
            self.requests.popleft()
        if len(self.requests) >= 20:
            return await JSONResponse(status_code=429, content={'error': {'code': 'RATE_LIMIT', 'message': 'Too many requests'}})(scope, receive, send)
        self.requests.append(now)
        if self.reading >= 2:
            return await JSONResponse(status_code=503, content={'error': {'code': 'REQUEST_BUSY', 'message': 'Too many requests in progress'}})(scope, receive, send)
        self.reading += 1
        body = bytearray()
        try:
            try:
                async with asyncio.timeout(self.read_timeout):
                    while True:
                        event = await receive()
                        if event['type'] == 'http.disconnect':
                            return
                        chunk = event.get('body', b'')
                        if len(body) + len(chunk) > 5 * 1024 * 1024:
                            return await JSONResponse(status_code=413, content={'error': {'code': 'REQUEST_TOO_LARGE', 'message': 'Request is too large'}})(scope, receive, send)
                        body.extend(chunk)
                        if not event.get('more_body', False):
                            break
            except TimeoutError:
                return await JSONResponse(status_code=408, content={'error': {'code': 'REQUEST_TIMEOUT', 'message': 'Request timed out'}})(scope, receive, send)
        finally:
            self.reading -= 1
        delivered = False
        async def replay():
            nonlocal delivered
            if not delivered:
                delivered = True
                return {'type': 'http.request', 'body': bytes(body), 'more_body': False}
            return await receive()
        await self.app(scope, replay, send)


app = FastAPI(title="Owli Avatar MVP", version="0.1.0")
app.add_middleware(ChatGuard)
app.add_middleware(STTGuard)
sessions = Sessions()
active_provider_requests = 0
active_tts_requests = 0
active_stt_requests = 0


def mode() -> str:
    value = os.getenv("OWLI_MODE", "mock")
    if value not in ("mock", "ollama"):
        raise ProviderError("CONFIG_ERROR", 503, "Chat is not configured correctly")
    return value


def provider() -> OllamaProvider:
    try:
        connect = float(os.getenv("OLLAMA_CONNECT_TIMEOUT", "3"))
        total = float(os.getenv("OLLAMA_TOTAL_TIMEOUT", "60"))
        if not (0 < connect <= 30 and 0 < total <= 300):
            raise ValueError
        return OllamaProvider(os.getenv("OLLAMA_BASE_URL", "http://127.0.0.1:11434"), os.getenv("OLLAMA_MODEL", ""), connect, total, think=os.getenv("OLLAMA_THINK", "auto"))
    except ValueError as exc:
        raise ProviderError("CONFIG_ERROR", 503, "Chat is not configured correctly") from exc


@app.exception_handler(ProviderError)
async def handle_provider_error(request, exc: ProviderError) -> JSONResponse:
    return api_error(exc.status, exc.code, exc.message)


def api_error(status: int, code: str, message: str) -> JSONResponse:
    return JSONResponse(status_code=status, content={"error": {"code": code, "message": message}})


@app.exception_handler(RequestValidationError)
async def handle_validation_error(request, exc: RequestValidationError) -> JSONResponse:
    return api_error(422, "VALIDATION_ERROR", "Invalid request payload")


@app.exception_handler(HTTPException)
async def handle_http_error(request, exc: HTTPException) -> JSONResponse:
    if exc.status_code == 501:
        return api_error(501, "NOT_IMPLEMENTED", str(exc.detail))
    if exc.status_code == 422:
        return api_error(422, "VALIDATION_ERROR", str(exc.detail))
    return api_error(exc.status_code, "HTTP_ERROR", str(exc.detail))


class ChatRequest(BaseModel):
    message: str = Field(min_length=1, max_length=1000)
    session_id: str | None = Field(default=None, max_length=64)


class ChatResponse(BaseModel):
    reply: str
    session_id: str
    mode: Literal["mock", "ollama"] = "mock"


@app.get("/api/health")
def health() -> dict[str, str]:
    return {"status": "ok", "mode": mode()}


@app.get("/api/avatar/config")
def avatar_config() -> dict[str, object]:
    return {
        "id": "procedural-owl-placeholder",
        "mode": "placeholder",
        "capabilities": {"mouth": True, "blink": False, "gaze": False},
    }


async def generate_until_disconnect(request: Request, chat_provider: OllamaProvider, messages: list[dict[str, str]]) -> str:
    task = asyncio.create_task(chat_provider.generate(messages))
    try:
        while not task.done():
            await asyncio.wait({task}, timeout=0.1)
            if not task.done() and await request.is_disconnected():
                raise asyncio.CancelledError
        return await task
    finally:
        if not task.done():
            task.cancel()
            await asyncio.gather(task, return_exceptions=True)


@app.post("/api/chat", response_model=ChatResponse)
async def chat(payload: ChatRequest, request: Request) -> ChatResponse:
    message = payload.message.strip()
    if not message:
        raise HTTPException(status_code=422, detail="message must not be blank")
    selected = mode()
    if selected == "mock":
        return ChatResponse(reply=f"Mock-Antwort: Du hast gefragt: {message}", session_id=payload.session_id or "demo-session")
    global active_provider_requests
    chat_provider = provider()
    if active_provider_requests >= 4:
        raise ProviderError("PROVIDER_BUSY", 503, "The text provider is busy")
    active_provider_requests += 1
    try:
        return await ollama_chat(payload, request, message, chat_provider)
    finally:
        active_provider_requests -= 1


async def ollama_chat(payload: ChatRequest, request: Request, message: str, chat_provider: OllamaProvider) -> ChatResponse:
    try:
        session_id, session = sessions.get(payload.session_id)
    except KeyError:
        raise HTTPException(status_code=404, detail="Session expired or unavailable")
    except OverflowError:
        raise ProviderError("SESSION_LIMIT", 503, "Too many active sessions")
    if session.lock.locked():
        raise ProviderError("SESSION_BUSY", 409, "A request is already in progress")
    async with session.lock:
        try:
            messages = [*session.messages, {"role": "user", "content": message}]
            reply = await generate_until_disconnect(request, chat_provider, messages)
            sessions.add_turn(session, message, reply)
            return ChatResponse(reply=reply, session_id=session_id, mode="ollama")
        finally:
            if not session.messages:
                sessions.items.pop(session_id, None)


def tts_mode() -> str:
    value = os.getenv("OWLI_TTS_MODE", "off")
    if value not in ("off", "piper"):
        raise ProviderError("TTS_CONFIG_ERROR", 503, "Speech is not configured correctly")
    return value


def tts_provider() -> PiperProvider:
    try:
        connect = float(os.getenv("PIPER_CONNECT_TIMEOUT", "3"))
        total = float(os.getenv("PIPER_TOTAL_TIMEOUT", "60"))
        if not (0 < connect <= 30 and 0 < total <= 60):
            raise ValueError
        return PiperProvider(os.getenv("PIPER_BASE_URL", "http://127.0.0.1:5000"), connect, total)
    except ValueError as exc:
        raise ProviderError("TTS_CONFIG_ERROR", 503, "Speech is not configured correctly") from exc


class TTSRequest(BaseModel):
    text: str = Field(min_length=1, max_length=MAX_TEXT_CHARS)


@app.get("/api/tts/status")
def tts_status() -> dict[str, bool]:
    return {"enabled": tts_mode() == "piper"}


@app.post("/api/tts")
async def tts(request: Request, payload: TTSRequest | None = None) -> Response:
    if tts_mode() == "off":
        raise HTTPException(status_code=501, detail="TTS is disabled")
    if payload is None or not payload.text.strip():
        raise HTTPException(status_code=422, detail="Text must not be blank")
    global active_tts_requests
    if active_tts_requests >= 2:
        raise ProviderError("TTS_BUSY", 503, "Speech synthesis is busy")
    speech = tts_provider()
    active_tts_requests += 1
    task = asyncio.create_task(speech.synthesize(payload.text.strip()))
    try:
        while not task.done():
            await asyncio.wait({task}, timeout=0.1)
            if not task.done() and await request.is_disconnected():
                raise asyncio.CancelledError
        audio = await task
        return Response(content=audio, media_type="audio/wav", headers={"Cache-Control": "no-store"})
    finally:
        if not task.done():
            task.cancel()
            await asyncio.gather(task, return_exceptions=True)
        active_tts_requests -= 1


def stt_mode() -> str:
    value = os.getenv("OWLI_STT_MODE", "off")
    if value not in ("off", "faster-whisper"):
        raise ProviderError("STT_CONFIG_ERROR", 503, "Speech recognition is not configured correctly")
    return value


@app.get("/api/stt/status")
def stt_status() -> dict[str, bool]:
    return {"enabled": stt_mode() == "faster-whisper"}


@app.post("/api/stt")
async def stt(request: Request) -> JSONResponse:
    if stt_mode() == "off":
        raise HTTPException(status_code=501, detail="STT is disabled")
    content_type = request.headers.get("content-type", "").split(";", 1)[0].strip().lower()
    if content_type != "audio/webm":
        raise ProviderError("UNSUPPORTED_AUDIO", 415, "Unsupported audio format")
    audio = await request.body()
    if not audio or not audio.startswith(b"\x1a\x45\xdf\xa3"):
        raise ProviderError("INVALID_AUDIO", 422, "Invalid audio")
    global active_stt_requests
    if active_stt_requests >= 1:
        raise ProviderError("STT_BUSY", 503, "Speech recognition is busy")
    from .stt import FasterWhisperProvider
    try:
        timeout = float(os.getenv("STT_TIMEOUT", "60"))
        if not (0 < timeout <= 120):
            raise ValueError
        recognizer = FasterWhisperProvider(os.getenv("STT_MODEL_PATH", ""), timeout=timeout)
    except ValueError as exc:
        raise ProviderError("STT_CONFIG_ERROR", 503, "Speech recognition is not configured correctly") from exc
    active_stt_requests += 1
    task = asyncio.create_task(recognizer.transcribe(audio))
    try:
        while not task.done():
            await asyncio.wait({task}, timeout=0.1)
            if not task.done() and await request.is_disconnected():
                raise asyncio.CancelledError
        text = await task
        return JSONResponse({"text": text}, headers={"Cache-Control": "no-store"})
    finally:
        if not task.done():
            task.cancel()
            await asyncio.gather(task, return_exceptions=True)
        active_stt_requests -= 1
