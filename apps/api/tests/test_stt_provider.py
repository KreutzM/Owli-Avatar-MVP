import asyncio

import pytest

from owli_avatar.ollama import ProviderError
from owli_avatar.stt import FasterWhisperProvider, MAX_AUDIO_BYTES


def model_dir(tmp_path):
    (tmp_path / "config.json").write_text("{}")
    (tmp_path / "model.bin").write_bytes(b"local")
    (tmp_path / "tokenizer.json").write_text("{}")
    return str(tmp_path)


def webm():
    # Container signature accepted before worker-level PyAV validation.
    return b"\x1a\x45\xdf\xa3" + b"test"


def test_requires_absolute_existing_local_model_files(tmp_path):
    with pytest.raises(ValueError):
        FasterWhisperProvider("relative/path")
    with pytest.raises(ValueError):
        FasterWhisperProvider(str(tmp_path))
    assert FasterWhisperProvider(model_dir(tmp_path)).model_dir == str(tmp_path)


@pytest.mark.parametrize("audio", [b"", b"RIFFxxxx", b"\x1a\x45\xdf\xa3" + b"x" * MAX_AUDIO_BYTES])
def test_rejects_bad_or_oversized_audio(audio, tmp_path):
    provider = FasterWhisperProvider(model_dir(tmp_path), runner=lambda _: asyncio.sleep(0))
    with pytest.raises(ProviderError) as exc:
        asyncio.run(provider.transcribe(audio))
    assert exc.value.code == "INVALID_AUDIO"


def test_transcribe_delegates_audio_and_returns_text(tmp_path):
    seen = []
    async def runner(audio):
        seen.append(audio)
        return "Guten Tag"
    provider = FasterWhisperProvider(model_dir(tmp_path), runner=runner)
    assert asyncio.run(provider.transcribe(webm())) == "Guten Tag"
    assert seen == [webm()]


def test_runner_timeout_is_sanitized(tmp_path):
    async def runner(_):
        await asyncio.sleep(1)
    provider = FasterWhisperProvider(model_dir(tmp_path), timeout=0.01, runner=runner)
    with pytest.raises(ProviderError) as exc:
        asyncio.run(provider.transcribe(webm()))
    assert exc.value.code == "PROVIDER_TIMEOUT"


def test_worker_subprocess_is_killed_on_cancellation(tmp_path, monkeypatch):
    provider = FasterWhisperProvider(model_dir(tmp_path), timeout=5)
    class Process:
        returncode = None
        killed = False
        async def communicate(self, _):
            await asyncio.Event().wait()
        def kill(self):
            self.killed = True
            self.returncode = -9
        async def wait(self):
            return self.returncode
    process = Process()
    async def spawn(*args, **kwargs):
        return process
    monkeypatch.setattr(asyncio, "create_subprocess_exec", spawn)
    async def check():
        task = asyncio.create_task(provider.transcribe(webm()))
        await asyncio.sleep(0.01)
        task.cancel()
        with pytest.raises(asyncio.CancelledError):
            await task
        assert process.killed
    asyncio.run(check())


def test_tokenizer_must_be_present_to_prevent_download(tmp_path):
    (tmp_path / 'config.json').write_text('{}')
    (tmp_path / 'model.bin').write_bytes(b'local')
    with pytest.raises(ValueError): FasterWhisperProvider(str(tmp_path))


@pytest.mark.parametrize('scenario,expected', [
    ('silence', {'text': ''}), ('too_long', {'error': 'INVALID_AUDIO'}),
    ('bad_codec', {'error': 'INVALID_AUDIO'}), ('decode_error', {'error': 'INVALID_AUDIO'}),
    ('inference_error', {'error': True}), ('transcript_long', {'error': True}),
    ('success', {'text': 'Guten Tag'}),
])
def test_worker_decoding_and_inference_boundaries(monkeypatch, scenario, expected):
    import io
    import json
    import sys
    import types
    from owli_avatar.stt import _WORKER

    class Array:
        def __init__(self, length, value): self.length, self.value = length, value
        def reshape(self, *_): return self
        def astype(self, *_args, **_kwargs): return self
        def __len__(self): return self.length
        def __mul__(self, other): return self.value * other.value
    class Frame:
        def to_ndarray(self): return Array(320001 if scenario == 'too_long' else 1600, 0 if scenario == 'silence' else .2)
    stream = types.SimpleNamespace(type='audio', codec_context=types.SimpleNamespace(name='mp3' if scenario == 'bad_codec' else 'opus'))
    class Container:
        format = types.SimpleNamespace(name='matroska,webm')
        streams = [stream]
        def decode(self, _stream):
            if scenario == 'decode_error': raise ValueError('private decoder error')
            return [Frame()]
    class Resampler:
        def __init__(self, **_kwargs): pass
        def resample(self, frame): return [] if frame is None else [frame]
    fake_av = types.SimpleNamespace(open=lambda *_args, **_kwargs: Container(), AudioResampler=Resampler)
    fake_numpy = types.SimpleNamespace(float32=object(), concatenate=lambda chunks: chunks[0], mean=lambda x: x, sqrt=lambda x: x ** .5)
    class Model:
        def __init__(self, _path, **kwargs):
            assert kwargs['device'] == 'cpu' and kwargs['compute_type'] == 'int8' and kwargs['local_files_only'] is True
        def transcribe(self, _audio, **kwargs):
            assert kwargs['language'] == 'de'
            if scenario == 'inference_error': raise ValueError('private model error')
            return ([types.SimpleNamespace(text='x' * 1001 if scenario == 'transcript_long' else 'Guten Tag')], None)
    monkeypatch.setitem(sys.modules, 'av', fake_av)
    monkeypatch.setitem(sys.modules, 'numpy', fake_numpy)
    monkeypatch.setitem(sys.modules, 'faster_whisper', types.SimpleNamespace(WhisperModel=Model))
    monkeypatch.setattr(sys, 'stdin', io.TextIOWrapper(io.BytesIO(b'fake')))
    output = io.StringIO()
    monkeypatch.setattr(sys, 'stdout', output)
    monkeypatch.setattr(sys, 'argv', ['worker', '/local/model'])
    try:
        exec(_WORKER, {})
    except SystemExit as exc:
        assert exc.code == 0
    assert json.loads(output.getvalue()) == expected


def test_explicit_worker_python_is_used_and_validated(tmp_path, monkeypatch):
    import sys
    with pytest.raises(ValueError):
        FasterWhisperProvider(model_dir(tmp_path), python_executable="relative")
    provider = FasterWhisperProvider(model_dir(tmp_path), python_executable=sys.executable)
    seen = []
    class Process:
        returncode = 0
        async def communicate(self, _): return b'{"text":"ok"}', b''
    async def spawn(*args, **kwargs):
        seen.append(args[0])
        return Process()
    monkeypatch.setattr(asyncio, "create_subprocess_exec", spawn)
    assert asyncio.run(provider.transcribe(webm())) == "ok"
    assert seen == [sys.executable]
