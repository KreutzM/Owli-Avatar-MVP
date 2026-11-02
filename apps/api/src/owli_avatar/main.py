"""Local chat API with explicit mock and Ollama modes."""

import asyncio
import os

from typing import Literal

from fastapi import FastAPI, HTTPException, Request

from .ollama import OllamaProvider, ProviderError
from .sessions import Sessions
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

app = FastAPI(title="Owli Avatar MVP", version="0.1.0")
sessions = Sessions()


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
        return OllamaProvider(os.getenv("OLLAMA_BASE_URL", "http://127.0.0.1:11434"), os.getenv("OLLAMA_MODEL", ""), connect, total)
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
    chat_provider = provider()
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


@app.post("/api/tts", status_code=501)
def tts_not_implemented() -> dict[str, str]:
    raise HTTPException(status_code=501, detail="TTS is not implemented")


@app.post("/api/stt", status_code=501)
def stt_not_implemented() -> dict[str, str]:
    raise HTTPException(status_code=501, detail="STT is not implemented")

