"""Local German faster-whisper adapter with killable, per-request inference."""
import asyncio
import json
import os
from pathlib import Path
import sys

from .ollama import ProviderError

MAX_AUDIO_BYTES = 5 * 1024 * 1024
MAX_AUDIO_SECONDS = 20
MAX_TEXT_CHARS = 1000
DEFAULT_TIMEOUT = 45

# Runs in a fresh interpreter so cancellation can terminate native inference.
_WORKER = r'''
import io, json, sys
import av
import numpy as np
from faster_whisper import WhisperModel
data = sys.stdin.buffer.read()
try:
    container = av.open(io.BytesIO(data), mode="r")
    if "webm" not in str(container.format.name).lower(): raise ValueError()
    streams = [s for s in container.streams if s.type == "audio"]
    if len(streams) != 1 or len(container.streams) != 1 or streams[0].codec_context.name != "opus": raise ValueError()
    stream = streams[0]
    resampler = av.AudioResampler(format="fltp", layout="mono", rate=16000)
    chunks, samples = [], 0
    for frame in container.decode(stream):
        for converted in resampler.resample(frame):
            arr = converted.to_ndarray().reshape(-1).astype(np.float32, copy=False)
            samples += len(arr)
            if samples > 16000 * 20: raise ValueError()
            chunks.append(arr)
    for converted in resampler.resample(None):
        arr = converted.to_ndarray().reshape(-1).astype(np.float32, copy=False)
        samples += len(arr)
        if samples > 16000 * 20: raise ValueError()
        chunks.append(arr)
    if not chunks or samples == 0: raise ValueError()
    audio = np.concatenate(chunks)
    if float(np.sqrt(np.mean(audio * audio))) < 1e-5:
        print(json.dumps({"text": ""})); sys.exit(0)
except Exception:
    print(json.dumps({"error": "INVALID_AUDIO"})); sys.exit(0)
try:
    model = WhisperModel(sys.argv[1], device="cpu", compute_type="int8", cpu_threads=2, local_files_only=True)
    segments, _ = model.transcribe(audio, language="de", vad_filter=True)
    pieces, count = [], 0
    for segment in segments:
        part = segment.text.strip()
        count += len(part) + 1
        if count > 1001: raise ValueError()
        pieces.append(part)
    text = " ".join(pieces).strip()
    print(json.dumps({"text": text}))
except Exception:
    print(json.dumps({"error": True}))
'''


def _validate_model_dir(path: str) -> str:
    if not isinstance(path, str) or not os.path.isabs(path):
        raise ValueError("STT_MODEL_DIR must be an absolute local model directory")
    directory = Path(path)
    if not directory.is_dir() or not (directory / "config.json").is_file() or not (directory / "model.bin").is_file() or not (directory / "tokenizer.json").is_file():
        raise ValueError("STT_MODEL_DIR must contain config.json, model.bin and tokenizer.json")
    return str(directory)


def _validate_audio(data: bytes) -> None:
    if not isinstance(data, bytes) or not data or len(data) > MAX_AUDIO_BYTES:
        raise ProviderError("INVALID_AUDIO", 422, "Audio input is invalid")
    # WebM EBML header; full container and codec validation happens in PyAV.
    if not data.startswith(b"\x1a\x45\xdf\xa3"):
        raise ProviderError("INVALID_AUDIO", 422, "Audio input is invalid")


class FasterWhisperProvider:
    def __init__(self, model_dir: str, timeout: float = DEFAULT_TIMEOUT, runner=None):
        self.model_dir = _validate_model_dir(model_dir)
        if timeout <= 0:
            raise ValueError("timeout must be positive")
        self.timeout = timeout
        self._runner = runner or self._run_worker

    async def _run_worker(self, audio: bytes) -> str:
        process = await asyncio.create_subprocess_exec(
            sys.executable, "-c", _WORKER, self.model_dir,
            stdin=asyncio.subprocess.PIPE, stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.DEVNULL,
            env={**os.environ, "HF_HUB_OFFLINE": "1", "TRANSFORMERS_OFFLINE": "1", "OMP_NUM_THREADS": "2", "OPENBLAS_NUM_THREADS": "1", "MKL_NUM_THREADS": "1"},
        )
        try:
            async with asyncio.timeout(self.timeout):
                stdout, _ = await process.communicate(audio)
            if process.returncode != 0 or len(stdout) > 4096:
                raise ProviderError("PROVIDER_ERROR", 502, "The speech recognition provider failed")
            result = json.loads(stdout)
            text = result.get("text") if isinstance(result, dict) else None
            if isinstance(result, dict) and result.get("error") == "INVALID_AUDIO":
                raise ProviderError("INVALID_AUDIO", 422, "Audio input is invalid")
            if not isinstance(result, dict) or result.get("error") or not isinstance(text, str) or len(text) > MAX_TEXT_CHARS:
                raise ProviderError("INVALID_PROVIDER_RESPONSE", 502, "The speech recognition provider returned an invalid response")
            return text
        except TimeoutError as exc:
            raise ProviderError("PROVIDER_TIMEOUT", 504, "The speech recognition provider timed out") from exc
        except (json.JSONDecodeError, AttributeError) as exc:
            raise ProviderError("INVALID_PROVIDER_RESPONSE", 502, "The speech recognition provider returned an invalid response") from exc
        finally:
            if process.returncode is None:
                try:
                    process.kill()
                except ProcessLookupError:
                    pass
                await process.wait()

    async def transcribe(self, audio: bytes) -> str:
        _validate_audio(audio)
        try:
            async with asyncio.timeout(self.timeout):
                text = await self._runner(audio)
                if not isinstance(text, str) or len(text) > MAX_TEXT_CHARS:
                    raise ProviderError("INVALID_PROVIDER_RESPONSE", 502, "The speech recognition provider returned an invalid response")
                return text
        except TimeoutError as exc:
            raise ProviderError("PROVIDER_TIMEOUT", 504, "The speech recognition provider timed out") from exc
