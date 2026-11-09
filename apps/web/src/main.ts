import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { VuenaCharacterAdapter, type CharacterAdapter, type CharacterState } from './avatar/character';
import { AudioPlayer } from './audio/AudioPlayer';
import { PushToTalk } from './audio/PushToTalk';
import './style.css';

type AvatarState = CharacterState;
type DialogueMetrics = { captureEndedAt: number; values: Record<string, number> };
const diagnosticsEnabled = import.meta.env.VITE_OWLI_DIAGNOSTICS === '1';
let dialogueMetrics: DialogueMetrics | undefined;
let currentFps = Number.NaN;
function serverDuration(response: Response, name: string): number | undefined {
  for (const item of (response.headers.get('server-timing') ?? '').split(',')) {
    const match = item.trim().match(new RegExp(`^${name};\\s*dur=([0-9]+(?:\\.[0-9]+)?)$`, 'i'));
    if (match) return Number(match[1]);
  }
  return undefined;
}
function addTiming(metrics: DialogueMetrics | undefined, key: string, start: number, end: number): void {
  if (metrics && Number.isFinite(start) && Number.isFinite(end) && end >= start) metrics.values[key] = end - start;
}
const host = document.querySelector<HTMLDivElement>('#avatar');
const stateLabel = document.querySelector<HTMLSpanElement>('#state');
const form = document.querySelector<HTMLFormElement>('#chat-form');
const input = document.querySelector<HTMLTextAreaElement>('#message');
const messages = document.querySelector<HTMLDivElement>('#messages');
const notice = document.querySelector<HTMLParagraphElement>('#notice');
const send = document.querySelector<HTMLButtonElement>('#send');
const speechEnabled = document.querySelector<HTMLInputElement>('#speech-enabled');
const stopAudioButton = document.querySelector<HTMLButtonElement>('#stop-audio');
const speechStatus = document.querySelector<HTMLParagraphElement>('#speech-status');
const volume = document.querySelector<HTMLInputElement>('#volume');
const ptt = document.querySelector<HTMLButtonElement>('#ptt');
const pttCancel = document.querySelector<HTMLButtonElement>('#ptt-cancel');
const sttStatus = document.querySelector<HTMLParagraphElement>('#stt-status');
const autoSend = document.querySelector<HTMLInputElement>('#voice-auto-send');
if (!host || !stateLabel || !form || !input || !messages || !notice || !send || !speechEnabled || !stopAudioButton || !speechStatus || !volume || !ptt || !pttCancel || !sttStatus || !autoSend) {
  throw new Error('Required UI elements missing');
}

const scene = new THREE.Scene();
scene.background = new THREE.Color('#243a53');
const camera = new THREE.PerspectiveCamera(36, 1, 0.1, 100);
camera.position.set(0, 1.4, 7.7);
camera.lookAt(0, 0.65, 0);
let renderer: THREE.WebGLRenderer | null = null;
try {
  renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  host.append(renderer.domElement);
} catch (error) {
  console.warn('3D rendering unavailable; text chat remains usable.', error);
  const message = document.createElement('p');
  message.textContent = '3D-Darstellung ist auf diesem Gerät nicht verfügbar. Der Textchat funktioniert weiterhin.';
  message.setAttribute('role', 'status');
  message.id = 'webgl-fallback';
  message.style.padding = '24px';
  host.append(message);
}
scene.add(new THREE.HemisphereLight(0xffffff, 0x4f6c87, 2.4));
const key = new THREE.DirectionalLight(0xffffff, 2);
key.position.set(-3, 6, 7);
scene.add(key);

let state: AvatarState = 'idle';
let character: CharacterAdapter | undefined;
let disposed = false;
const setState = (next: AvatarState) => {
  state = next;
  character?.setState(next);
  stateLabel.textContent = 'Status: ' + next;
};
let speechGeneration = 0;
let speechRequest: AbortController | undefined;
const audioPlayer = new AudioPlayer({ onEnded: () => {
  setState('idle');
  stopAudioButton!.disabled = true;
  speechStatus.textContent = 'Wiedergabe beendet.';
}, onPlaybackScheduled: () => {
  const metrics = dialogueMetrics;
  if (!diagnosticsEnabled || !metrics) return;
  addTiming(metrics, 'capture_to_playback_ms', metrics.captureEndedAt, performance.now());
  if (Number.isFinite(currentFps)) metrics.values.fps = currentFps;
  const values = Object.fromEntries(Object.entries(metrics.values).filter(([, value]) => Number.isFinite(value)));
  dialogueMetrics = undefined;
  // Numeric timing only: no prompt, transcript, audio, or session ID.
  void fetch('/api/diagnostics', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Owli-Request': '1' }, body: JSON.stringify(values), keepalive: true }).catch(() => undefined);
}});
function stopSpeech(): void {
  speechGeneration++;
  speechRequest?.abort();
  speechRequest = undefined;
  audioPlayer.stop();
  character?.setMouthOpen(0);
  stopAudioButton!.disabled = true;
  setState('idle');
}
stopAudioButton.addEventListener('click', () => { dialogueMetrics = undefined; stopSpeech(); speechStatus.textContent = 'Wiedergabe gestoppt.'; });
speechEnabled.addEventListener('change', () => { if (!speechEnabled.checked) { dialogueMetrics = undefined; stopSpeech(); } });
volume.addEventListener('input', () => audioPlayer.setVolume(Number(volume.value)));
void fetch('/api/tts/status').then(async response => {
  if (!response.ok) throw new Error('TTS status unavailable');
  const status = await response.json() as {enabled?: unknown};
  if (status.enabled === true) {
    speechEnabled.disabled = false;
    speechStatus.textContent = 'Sprachausgabe verfügbar; bitte aktivieren.';
  } else speechStatus.textContent = 'Sprachausgabe deaktiviert; Textchat bleibt verfügbar.';
}).catch(() => { speechStatus.textContent = 'Sprachausgabe nicht verfügbar; Textchat bleibt verfügbar.'; });
let captureGeneration = 0;
let sttRequest: AbortController | undefined;
let recording = false;
let sttAvailable = false;
const capture = new PushToTalk({
  onRecording: active => {
    recording = active;
    ptt!.textContent = active ? 'Aufnahme beenden' : 'Aufnahme starten';
    if (active) { setState('listening'); sttStatus!.textContent = 'Aufnahme läuft.'; }
  },
  onTranscribing: blob => { void transcribe(blob, captureGeneration); },
  onStopRequested: () => {
    if (diagnosticsEnabled && autoSend!.checked && speechEnabled!.checked && !speechEnabled!.disabled) {
      dialogueMetrics = { captureEndedAt: performance.now(), values: {} };
    }
  },
  onError: () => {
    dialogueMetrics = undefined;
    sttStatus!.textContent = 'Mikrofon nicht verfügbar oder Aufnahme fehlgeschlagen. Texteingabe bleibt möglich.';
    ptt!.disabled = !sttAvailable; pttCancel!.disabled = true;
    send!.disabled = false; setState('idle');
  },
});
function cancelCapture(): void {
  dialogueMetrics = undefined;
  captureGeneration++;
  sttRequest?.abort(); sttRequest = undefined;
  capture.cancel();
  ptt!.disabled = !sttAvailable; pttCancel!.disabled = true;
  send!.disabled = false; setState('idle');
}
async function transcribe(blob: Blob, generation: number): Promise<void> {
  if (generation !== captureGeneration || disposed) return;
  const metrics = dialogueMetrics;
  setState('thinking'); ptt!.disabled = true;
  sttStatus!.textContent = 'Sprache wird erkannt …';
  const controller = new AbortController(); sttRequest = controller;
  const requestStarted = performance.now();
  if (metrics) addTiming(metrics, 'capture_to_upload_ms', metrics.captureEndedAt, requestStarted);
  const timeout = window.setTimeout(() => controller.abort(), 125000);
  try {
    const response = await fetch('/api/stt', { method: 'POST', headers: { 'Content-Type': 'audio/webm;codecs=opus', 'X-Owli-Request': '1' }, body: blob, signal: controller.signal });
    if (!response.ok) throw new Error('STT unavailable');
    const sttProviderMs = serverDuration(response, 'stt');
    const uploadMs = serverDuration(response, 'upload');
    const result: unknown = await response.json();
    if (generation !== captureGeneration || disposed) return;
    addTiming(dialogueMetrics === metrics ? metrics : undefined, 'stt_request_ms', requestStarted, performance.now());
    if (sttProviderMs !== undefined && dialogueMetrics === metrics && metrics) metrics.values.stt_ms = sttProviderMs;
    if (uploadMs !== undefined && dialogueMetrics === metrics && metrics) metrics.values.upload_ms = uploadMs;
    const text = (result as {text?: unknown} | null)?.text;
    if (typeof text !== 'string' || text.length > 1000) throw new Error('Invalid transcription');
    if (!text.trim() || !autoSend!.checked || !speechEnabled!.checked || speechEnabled!.disabled) dialogueMetrics = undefined;
    input!.value = text;
    sttStatus!.textContent = text.trim() ? 'Erkannten Text prüfen oder senden.' : 'Keine Sprache erkannt.';
    setState('idle'); send!.disabled = false; pttCancel!.disabled = true; ptt!.disabled = !sttAvailable;
    if (text.trim() && autoSend!.checked) form!.requestSubmit();
  } catch {
    if (generation === captureGeneration && dialogueMetrics === metrics) dialogueMetrics = undefined;
    if (generation === captureGeneration && !disposed) {
      sttStatus!.textContent = 'Spracherkennung fehlgeschlagen. Texteingabe bleibt möglich.';
      setState('idle'); send!.disabled = false; pttCancel!.disabled = true; ptt!.disabled = !sttAvailable;
    }
  } finally {
    window.clearTimeout(timeout);
    if (sttRequest === controller) sttRequest = undefined;
  }
}
ptt.addEventListener('click', () => {
  if (recording) { ptt.disabled = true; void capture.stop().catch(() => undefined); return; }
  if (send.disabled || !sttAvailable) return;
  dialogueMetrics = undefined;
  stopSpeech();
  if (speechEnabled.checked && !speechEnabled.disabled) void audioPlayer.initialize().catch(() => undefined);
  captureGeneration++; send.disabled = true; ptt.disabled = true; pttCancel.disabled = false;
  sttStatus.textContent = 'Mikrofonberechtigung wird angefordert …';
  void capture.start().then(() => { if (recording) ptt.disabled = false; }).catch(() => undefined);
});
pttCancel.addEventListener('click', () => { cancelCapture(); sttStatus.textContent = 'Aufnahme abgebrochen.'; });
void fetch('/api/stt/status').then(async response => {
  if (!response.ok) throw new Error('STT status unavailable');
  const status = await response.json() as {enabled?: unknown};
  sttAvailable = status.enabled === true;
  ptt.disabled = !sttAvailable;
  sttStatus.textContent = sttAvailable ? 'Spracheingabe bereit.' : 'Spracheingabe deaktiviert; Texteingabe bleibt möglich.';
}).catch(() => { sttStatus.textContent = 'Spracheingabe nicht verfügbar; Texteingabe bleibt möglich.'; });
host.dataset.character = 'loading';
if (renderer) new GLTFLoader().load('/models/vuena-owl.glb', gltf => {
  if (disposed) return;
  character = new VuenaCharacterAdapter(gltf);
  character.root.scale.setScalar(5);
  character.root.position.y = -1.1;
  character.setState(state);
  scene.add(character.root);
  host.dataset.character = 'vuena';
  host.setAttribute('aria-label', 'Animierte dreidimensionale Vuena-Eule');
  const description = document.querySelector<HTMLParagraphElement>('.heading p');
  if (description) description.textContent = 'Vuena · 3D-Testmodell';
}, undefined, () => {
  host.dataset.character = 'unavailable';
  const message = document.createElement('p');
  message.id = 'model-fallback';
  message.setAttribute('role', 'status');
  message.textContent = 'Vuena-Modell nicht verfügbar. Der Textchat bleibt nutzbar.';
  host.append(message);
});
function resize() {
  if (!renderer) return;
  const width = Math.max(1, host!.clientWidth);
  const height = Math.max(1, host!.clientHeight);
  renderer.setSize(width, height);
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
}
const observer = new ResizeObserver(resize);
if (renderer) {
  observer.observe(host);
  resize();
}
const clock = new THREE.Clock();
let frame = 0;
let fpsFrames = 0;
let fpsWindowStarted = performance.now();
function animate() {
  if (!renderer) return;
  frame = requestAnimationFrame(animate);
  if (diagnosticsEnabled) {
    fpsFrames++;
    const now = performance.now();
    const elapsed = now - fpsWindowStarted;
    if (elapsed >= 1000) {
      currentFps = fpsFrames * 1000 / elapsed;
      fpsFrames = 0;
      fpsWindowStarted = now;
    }
  }
  const delta = clock.getDelta();
  const mouth = audioPlayer.sampleLevel();
  host!.dataset.mouth = mouth.toFixed(3);
  character?.setMouthOpen(mouth);
  character?.update(delta);
  renderer.render(scene, camera);
}
if (renderer) animate();
window.addEventListener('pagehide', () => {
  disposed = true;
  cancelCapture();
  capture.dispose();
  stopSpeech();
  audioPlayer.dispose();
  character?.dispose();
  cancelAnimationFrame(frame);
  observer.disconnect();
  renderer?.dispose();
});

function appendMessage(who: string, value: string): HTMLParagraphElement {
  const p = document.createElement('p');
  p.textContent = who + ': ' + value;
  messages!.append(p);
  messages!.scrollTop = messages!.scrollHeight;
  return p;
}

const modeLabel = document.querySelector<HTMLParagraphElement>('#chat-mode');
void fetch('/api/health').then(async response => {
  if (!response.ok) throw new Error('Health unavailable');
  const health: unknown = await response.json();
  const mode = (health as { mode?: unknown } | null)?.mode;
  if (modeLabel && (mode === 'mock' || mode === 'ollama')) {
    modeLabel.textContent = mode === 'ollama'
      ? 'Ollama-Modus: Nachrichten werden lokal vom Sprachmodell verarbeitet.'
      : 'Mock-Modus: Antworten sind simuliert.';
  }
}).catch(() => {
  if (modeLabel) modeLabel.textContent = 'Chat-Modus nicht verfügbar.';
});

let sessionId: string | undefined;

form.addEventListener('submit', async event => {
  event.preventDefault();
  const message = input.value.trim();
  if (!message || send.disabled) return;
  stopSpeech();
  const generation = speechGeneration;
  const wantsSpeech = speechEnabled.checked && !speechEnabled.disabled;
  const metrics = dialogueMetrics;
  const audioReady = wantsSpeech ? audioPlayer.initialize().then(() => true, () => false) : Promise.resolve(false);
  appendMessage('Du', message);
  input.value = '';
  send.disabled = true;
  notice.textContent = '';
  setState('thinking');
  let chatCompleted = false;
  try {
    const controller = new AbortController();
    const timeoutLimit = Number(import.meta.env.VITE_CHAT_TIMEOUT_MS) || 65000;
    let response: Response;
    let streamedReply = '';
    let chatMode: 'mock' | 'ollama' | undefined;
    let candidateSessionId: string | undefined;
    let replyLine: HTMLParagraphElement | undefined;
    let firstDeltaAt: number | undefined;
    const chatStarted = performance.now();
    const timeout = window.setTimeout(() => controller.abort(), Math.max(250, timeoutLimit));
    try {
      response = await fetch('/api/chat/stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Owli-Request': '1', 'Accept': 'application/x-ndjson' },
        body: JSON.stringify({ message, ...(sessionId ? { session_id: sessionId } : {}) }),
        signal: controller.signal,
      });
      if (!response.ok) {
        if (response.status === 404) sessionId = undefined;
        throw new Error('API HTTP ' + response.status);
      }
      if (!response.headers.get('content-type')?.toLowerCase().includes('application/x-ndjson')) throw new Error('Unexpected stream response');
      const reader = response.body?.getReader();
      if (!reader) throw new Error('Chat stream unavailable');
      let acceptedStream = false;
      try {
      const decoder = new TextDecoder();
      let pending = '';
      let streamBytes = 0;
      let finished = false;
      const handleLine = (line: string) => {
        if (!line) return;
        if (finished) throw new Error('Chat stream event after completion');
        if (line.length > 65536) throw new Error('Chat stream event too large');
        const event: unknown = JSON.parse(line);
        if (!event || typeof event !== 'object') throw new Error('Invalid chat stream event');
        const item = event as { type?: unknown; text?: unknown; reply?: unknown; session_id?: unknown; mode?: unknown; error?: unknown };
        if (item.type === 'start') {
          if (candidateSessionId || typeof item.session_id !== 'string' || !item.session_id || item.session_id.length > 64
            || (item.mode !== 'mock' && item.mode !== 'ollama')) throw new Error('Invalid chat stream start');
          candidateSessionId = item.session_id;
          chatMode = item.mode;
          replyLine = appendMessage(chatMode === 'ollama' ? 'Eule (Ollama)' : 'Eule (Mock)', '');
        } else if (item.type === 'delta') {
          if (!replyLine || typeof item.text !== 'string' || !item.text || streamedReply.length + item.text.length > 4000) throw new Error('Invalid chat stream delta');
          firstDeltaAt ??= performance.now();
          streamedReply += item.text;
          replyLine.textContent = (chatMode === 'ollama' ? 'Eule (Ollama)' : 'Eule (Mock)') + ': ' + streamedReply;
          messages!.scrollTop = messages!.scrollHeight;
        } else if (item.type === 'done') {
          if (!candidateSessionId || typeof item.reply !== 'string' || item.reply !== streamedReply
            || item.session_id !== candidateSessionId || item.mode !== chatMode || !streamedReply.trim()) throw new Error('Invalid chat stream completion');
          finished = true;
        } else if (item.type === 'error') {
          throw new Error('Chat stream failed');
        } else throw new Error('Unknown chat stream event');
      };
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        streamBytes += value.byteLength;
        if (streamBytes > 131072) throw new Error('Chat stream too large');
        pending += decoder.decode(value, { stream: true });
        let newline = pending.indexOf('\n');
        while (newline !== -1) {
          handleLine(pending.slice(0, newline));
          pending = pending.slice(newline + 1);
          newline = pending.indexOf('\n');
        }
        if (pending.length > 65536) throw new Error('Chat stream event too large');
      }
      pending += decoder.decode();
      if (pending) handleLine(pending);
      if (!finished || !candidateSessionId || !chatMode) throw new Error('Incomplete chat stream');
      acceptedStream = true;
      } finally {
        if (!acceptedStream) {
          controller.abort();
          await reader.cancel().catch(() => undefined);
        }
      }
      chatCompleted = true;
      sessionId = candidateSessionId;
      addTiming(dialogueMetrics === metrics ? metrics : undefined, 'chat_request_ms', chatStarted, performance.now());
      if (firstDeltaAt !== undefined && dialogueMetrics === metrics && metrics) metrics.values.chat_first_token_ms = firstDeltaAt - chatStarted;
    } finally {
      window.clearTimeout(timeout);
    }
    const chatResult = { reply: streamedReply, mode: chatMode!, session_id: candidateSessionId! };
    if (wantsSpeech && generation === speechGeneration) {
      if (!(await audioReady)) throw new Error('Audio unavailable');
      if (generation !== speechGeneration) return;
      const synth = new AbortController();
      speechRequest = synth;
      stopAudioButton.disabled = false;
      speechStatus.textContent = 'Sprachausgabe wird erzeugt …';
      const synthTimeout = window.setTimeout(() => synth.abort(), 65000);
      const ttsStarted = performance.now();
      try {
        const response = await fetch('/api/tts', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Owli-Request': '1' }, body: JSON.stringify({ text: chatResult.reply }), signal: synth.signal });
        if (!response.ok) throw new Error('TTS HTTP ' + response.status);
        const piperProviderMs = serverDuration(response, 'piper');
        const wav = await response.arrayBuffer();
        addTiming(dialogueMetrics === metrics ? metrics : undefined, 'tts_request_ms', ttsStarted, performance.now());
        if (piperProviderMs !== undefined && dialogueMetrics === metrics && metrics) metrics.values.piper_ms = piperProviderMs;
        if (generation !== speechGeneration) return;
        await audioPlayer.playWav(wav);
        if (generation !== speechGeneration) return;
        setState('speaking');
        speechStatus.textContent = 'Wiedergabe läuft.';
      } finally {
        window.clearTimeout(synthTimeout);
        if (speechRequest === synth) speechRequest = undefined;
      }
    } else {
      notice.textContent = 'Textantwort ohne Ton.';
    }
  } catch (error) {
    if (dialogueMetrics === metrics) dialogueMetrics = undefined;
    if (generation === speechGeneration) {
      stopSpeech();
      setState('error');
      notice.textContent = chatCompleted && wantsSpeech
        ? 'Sprachausgabe nicht erreichbar oder fehlgeschlagen; Textantwort bleibt erhalten.'
        : 'Chat-API nicht erreichbar oder Antwort ungueltig. Backend lokal starten und erneut versuchen.';
      console.error(error);
    }
  } finally {
    if (state !== 'speaking') setState('idle');
    send.disabled = false;
    input.focus();
  }
});

