"""Minimal deterministic mock API. No LLM, TTS or STT is running here."""

from typing import Literal

from fastapi import FastAPI, HTTPException
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

app = FastAPI(title="Owli Avatar MVP", version="0.1.0")


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
    mode: Literal["mock"] = "mock"


@app.get("/api/health")
def health() -> dict[str, str]:
    return {"status": "ok", "mode": "mock"}


@app.get("/api/avatar/config")
def avatar_config() -> dict[str, object]:
    return {
        "id": "procedural-owl-placeholder",
        "mode": "placeholder",
        "capabilities": {"mouth": True, "blink": False, "gaze": False},
    }


@app.post("/api/chat", response_model=ChatResponse)
def chat(request: ChatRequest) -> ChatResponse:
    message = request.message.strip()
    if not message:
        raise HTTPException(status_code=422, detail="message must not be blank")
    return ChatResponse(
        reply=f"Mock-Antwort: Du hast gefragt: {message}",
        session_id=request.session_id or "demo-session",
    )


@app.post("/api/tts", status_code=501)
def tts_not_implemented() -> dict[str, str]:
    raise HTTPException(status_code=501, detail="TTS is not implemented")


@app.post("/api/stt", status_code=501)
def stt_not_implemented() -> dict[str, str]:
    raise HTTPException(status_code=501, detail="STT is not implemented")

