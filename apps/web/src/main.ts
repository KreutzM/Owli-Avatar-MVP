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
const retrySpeechButton = document.querySelector<HTMLButtonElement>('#retry-speech');
const speechStatus = document.querySelector<HTMLParagraphElement>('#speech-status');
const volume = document.querySelector<HTMLInputElement>('#volume');
const ptt = document.querySelector<HTMLButtonElement>('#ptt');
const pttCancel = document.querySelector<HTMLButtonElement>('#ptt-cancel');
const sttStatus = document.querySelector<HTMLParagraphElement>('#stt-status');
const autoSend = document.querySelector<HTMLInputElement>('#voice-auto-send');
if (!host || !stateLabel || !form || !input || !messages || !notice || !send || !speechEnabled || !stopAudioButton || !retrySpeechButton || !speechStatus || !volume || !ptt || !pttCancel || !sttStatus || !autoSend) {
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
let activeChatRequest: AbortController | undefined;
let wakeProgressiveQueue: (() => void) | undefined;
let speechSequenceActive = false;
let playbackFinished: (() => void) | undefined;
let retrySpeech: { chunks: string[]; nextIndex: number; generation: number; metrics?: DialogueMetrics } | undefined;
const audioPlayer = new AudioPlayer({ onEnded: () => {
  playbackFinished?.();
  playbackFinished = undefined;
  if (!speechSequenceActive) {
    setState('idle');
    stopAudioButton!.disabled = true;
    speechStatus.textContent = 'Wiedergabe beendet.';
  }
}, onPlaybackScheduled: () => {
  if (!performance.getEntriesByName('owli:first-audio-source-start').length) {
    performance.mark('owli:first-audio-source-start');
    if (performance.getEntriesByName('owli:chat-start').length) {
      performance.measure('owli:first-audio-source-ms', 'owli:chat-start', 'owli:first-audio-source-start');
    }
  }
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
  activeChatRequest?.abort();
  activeChatRequest = undefined;
  wakeProgressiveQueue?.();
  speechSequenceActive = false;
  retrySpeech = undefined;
  retrySpeechButton!.disabled = true;
  playbackFinished?.();
  playbackFinished = undefined;
  speechRequest?.abort();
  speechRequest = undefined;
  audioPlayer.stop();
  character?.setMouthOpen(0);
  stopAudioButton!.disabled = true;
  setState('idle');
}

/** Return only complete or safely bounded speech chunks; retain unstable text. */
function takeSpeechChunks(buffer: string, flush = false, maxChars = 350): { chunks: string[]; rest: string } {
  const chars = Array.from(buffer);
  const chunks: string[] = [];
  let start = 0;
  const punct = '.!?。！？';
  const closers = `\"'»”’)]}`;
  while (start < chars.length) {
    const limit = Math.min(chars.length, start + maxChars);
    let sentenceEnd = -1;
    for (let i = start; i < limit; i++) {
      if (!punct.includes(chars[i])) continue;
      if (!/[\p{L}\p{N}]/u.test(chars.slice(start, i).join(''))) continue;
      let end = i + 1;
      while (end < chars.length && punct.includes(chars[end])) end++;
      while (end < chars.length && closers.includes(chars[end])) end++;
      if (end <= limit && end < chars.length && /\s/u.test(chars[end])) {
        while (end < limit && end < chars.length && /\s/u.test(chars[end])) end++;
        sentenceEnd = end;
      }
      else if (flush && end === chars.length && end <= limit) sentenceEnd = end;
    }
    if (sentenceEnd > start) {
      chunks.push(chars.slice(start, sentenceEnd).join(''));
      start = sentenceEnd;
      continue;
    }
    if (chars.length - start > maxChars) {
      let cut = -1;
      for (let i = start; i < limit; i++) if (/\s/u.test(chars[i])) cut = i + 1;
      if (cut < 0) cut = limit;
      chunks.push(chars.slice(start, cut).join(''));
      start = cut;
      continue;
    }
    if (flush) {
      chunks.push(chars.slice(start).join(''));
      start = chars.length;
    }
    break;
  }
  return { chunks, rest: chars.slice(start).join('') };
}

// Keep Piper requests comfortably below its per-WAV duration limit. Cut at the last
// sentence boundary in the safe window, then at whitespace or a Unicode code point.
// Slicing the original code point array keeps leading punctuation and every space.
function splitSpeechText(text: string, maxChars = 350): string[] {
  if (!text) return [];
  const chars = Array.from(text);
  const chunks: string[] = [];
  let start = 0;
  const isPunctuation = (char: string) => '.!?。！？'.includes(char);
  const isClosingMark = (char: string) => `"'»”’)]}`.includes(char);
  while (start < chars.length) {
    const limit = Math.min(chars.length, start + maxChars);
    if (limit === chars.length) { chunks.push(chars.slice(start).join('')); break; }
    let sentenceCut = -1;
    for (let i = start; i < limit; i++) {
      if (!isPunctuation(chars[i])) continue;
      let end = i + 1;
      while (end < chars.length && isPunctuation(chars[end])) end++;
      while (end < chars.length && isClosingMark(chars[end])) end++;
      if (end <= limit && (end === chars.length || /\s/u.test(chars[end]))) sentenceCut = end;
    }
    let cut = sentenceCut;
    if (cut < 0) {
      for (let i = start; i < limit; i++) if (/\s/u.test(chars[i])) cut = i + 1;
    }
    if (cut < 0) cut = limit;
    chunks.push(chars.slice(start, cut).join(''));
    start = cut;
  }
  return chunks;
}

async function playSpeechSequence(text: string, generation: number, metrics?: DialogueMetrics, startAt = 0, retainedChunks?: string[]): Promise<void> {
  if (generation !== speechGeneration) return;
  const chunks = retainedChunks ?? splitSpeechText(text);
  retrySpeech = undefined;
  retrySpeechButton!.disabled = true;
  speechSequenceActive = true;
  stopAudioButton!.disabled = false;
  for (let index = startAt; index < chunks.length; index++) {
    if (generation !== speechGeneration) return;
    const synth = new AbortController();
    speechRequest = synth;
    speechStatus!.textContent = chunks.length > 1
      ? `Sprachausgabe wird erzeugt … Abschnitt ${index + 1} von ${chunks.length}`
      : 'Sprachausgabe wird erzeugt …';
    const synthTimeout = window.setTimeout(() => synth.abort(), 65000);
    const ttsStarted = performance.now();
    let response: Response;
    try {
      response = await fetch('/api/tts', {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Owli-Request': '1' },
        body: JSON.stringify({ text: chunks[index] }), signal: synth.signal,
      });
      if (!response.ok) throw new Error(`TTS HTTP ${response.status}`);
      const piperProviderMs = serverDuration(response, 'piper');
      const wav = await response.arrayBuffer();
      addTiming(dialogueMetrics === metrics ? metrics : undefined, 'tts_request_ms', ttsStarted, performance.now());
      if (piperProviderMs !== undefined && dialogueMetrics === metrics && metrics) metrics.values.piper_ms = piperProviderMs;
      if (generation !== speechGeneration) return;
      speechStatus!.textContent = chunks.length > 1
        ? `Wiedergabe läuft · Abschnitt ${index + 1} von ${chunks.length}`
        : 'Wiedergabe läuft.';
      const ended = new Promise<void>(resolve => { playbackFinished = resolve; });
      await audioPlayer.playWav(wav);
      if (generation !== speechGeneration) { playbackFinished?.(); return; }
      setState('speaking');
      await ended;
    } catch (error) {
      if (generation !== speechGeneration) return;
      speechSequenceActive = false;
      stopAudioButton!.disabled = true;
      character?.setMouthOpen(0);
      setState('idle');
      const complete = index === 0 ? 'Sprachausgabe fehlgeschlagen.' : `Sprachausgabe teilweise fehlgeschlagen: ${index} von ${chunks.length} Abschnitten wurden abgespielt.`;
      retrySpeech = { chunks, nextIndex: index, generation, metrics };
      retrySpeechButton!.disabled = false;
      speechStatus!.textContent = `${complete} Fehlgeschlagenen Abschnitt gezielt wiederholen möglich.`;
      notice!.textContent = complete + ' Textantwort bleibt erhalten.';
      console.error(error);
      return;
    } finally {
      window.clearTimeout(synthTimeout);
      if (speechRequest === synth) speechRequest = undefined;
    }
  }
  if (generation === speechGeneration) {
    speechSequenceActive = false;
    stopAudioButton!.disabled = true;
    speechStatus!.textContent = 'Wiedergabe beendet.';
    setState('idle');
  }
}
stopAudioButton.addEventListener('click', () => { dialogueMetrics = undefined; stopSpeech(); speechStatus.textContent = 'Wiedergabe gestoppt.'; });
retrySpeechButton.addEventListener('click', () => {
  const retry = retrySpeech;
  if (!retry || retry.generation !== speechGeneration) return;
  retrySpeech = undefined;
  retrySpeechButton.disabled = true;
  notice!.textContent = '';
  // initialize() is invoked in this click handler so a suspended AudioContext can resume.
  void audioPlayer.initialize().then(
    () => playSpeechSequence('', retry.generation, retry.metrics, retry.nextIndex, retry.chunks),
    () => {
      if (retry.generation !== speechGeneration) return;
      retrySpeech = retry;
      retrySpeechButton.disabled = false;
      speechStatus.textContent = 'Audio-Wiedergabe nicht verfügbar; fehlgeschlagenen Abschnitt erneut versuchen.';
    },
  );
});
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

input.addEventListener('keydown', event => {
  if (event.key !== 'Enter' || event.shiftKey || event.ctrlKey || event.altKey || event.metaKey
    || event.isComposing || event.keyCode === 229 || event.repeat || send.disabled) return;
  event.preventDefault();
  form.requestSubmit();
});

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
  let canSpeak = false;
  let progressiveBuffer = '';
  const progressiveChunks: string[] = [];
  const progressiveQueue: string[] = [];
  let progressivePlayed = 0;
  let progressiveFinished = false;
  let progressiveFailed = false;
  let progressiveWorker: Promise<void> | undefined;
  const progressiveWaiters: Array<() => void> = [];
  const signalProgressive = () => { for (const wake of progressiveWaiters.splice(0)) wake(); };
  wakeProgressiveQueue = signalProgressive;
  const waitProgressive = () => new Promise<void>(resolve => progressiveWaiters.push(resolve));
  let pauseChatTimeout = () => {};
  let resumeChatTimeout = () => {};
  const enqueueProgressive = async (chunk: string): Promise<void> => {
    if (!chunk) return;
    progressiveChunks.push(chunk);
    while (progressiveQueue.length >= 2 && !progressiveFailed && generation === speechGeneration) {
      pauseChatTimeout();
      try { await waitProgressive(); } finally { resumeChatTimeout(); }
    }
    if (progressiveFailed || generation !== speechGeneration) return;
    progressiveQueue.push(chunk);
    signalProgressive();
    if (progressiveWorker) return;
    speechSequenceActive = true;
    stopAudioButton!.disabled = false;
    progressiveWorker = (async () => {
      while (generation === speechGeneration) {
        if (!progressiveQueue.length) {
          if (progressiveFinished || progressiveFailed) break;
          await waitProgressive();
          continue;
        }
        const part = progressiveQueue.shift()!;
        signalProgressive();
        const index = progressivePlayed;
        const synth = new AbortController();
        speechRequest = synth;
        speechStatus!.textContent = `Sprachausgabe wird erzeugt · Abschnitt ${index + 1}`;
        const timeout = window.setTimeout(() => synth.abort(), 65000);
        try {
          const started = performance.now();
          if (!performance.getEntriesByName('owli:first-tts-request').length) {
            performance.mark('owli:first-tts-request');
            if (performance.getEntriesByName('owli:chat-start').length) {
              performance.measure('owli:first-tts-request-ms', 'owli:chat-start', 'owli:first-tts-request');
            }
          }
          const response = await fetch('/api/tts', {
            method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Owli-Request': '1' },
            body: JSON.stringify({ text: part }), signal: synth.signal,
          });
          if (!response.ok) throw new Error(`TTS HTTP ${response.status}`);
          const providerMs = serverDuration(response, 'piper');
          const wav = await response.arrayBuffer();
          addTiming(dialogueMetrics === metrics ? metrics : undefined, 'tts_request_ms', started, performance.now());
          if (providerMs !== undefined && dialogueMetrics === metrics && metrics) metrics.values.piper_ms = providerMs;
          if (generation !== speechGeneration) break;
          speechStatus!.textContent = `Wiedergabe läuft · Abschnitt ${index + 1}`;
          const ended = new Promise<void>(resolve => { playbackFinished = resolve; });
          await audioPlayer.playWav(wav);
          if (generation !== speechGeneration) { playbackFinished?.(); break; }
          setState('speaking');
          await ended;
          if (generation !== speechGeneration) break;
          progressivePlayed++;
        } catch (error) {
          if (generation === speechGeneration) {
            progressiveFailed = true;
            progressiveQueue.length = 0;
            console.error(error);
          }
        } finally {
          window.clearTimeout(timeout);
          if (speechRequest === synth) speechRequest = undefined;
          signalProgressive();
        }
        if (progressiveFailed) break;
      }
    })();
  };
  const feedProgressive = async (text: string, flush = false): Promise<void> => {
    if (!canSpeak || generation !== speechGeneration) return;
    progressiveBuffer += text;
    const extracted = takeSpeechChunks(progressiveBuffer, flush);
    progressiveBuffer = extracted.rest;
    if (extracted.chunks.length && !performance.getEntriesByName('owli:first-stable-sentence').length) {
      performance.mark('owli:first-stable-sentence');
      if (performance.getEntriesByName('owli:chat-start').length) {
        performance.measure('owli:first-stable-sentence-ms', 'owli:chat-start', 'owli:first-stable-sentence');
      }
    }
    for (const chunk of extracted.chunks) await enqueueProgressive(chunk);
  };
  let chatCompleted = false;
  let incompleteReplyLine: HTMLParagraphElement | undefined;
  const controller = new AbortController();
  activeChatRequest = controller;
  try {
    const timeoutLimit = Number(import.meta.env.VITE_CHAT_TIMEOUT_MS) || 65000;
    let response: Response;
    let streamedReply = '';
    let chatMode: 'mock' | 'ollama' | undefined;
    let candidateSessionId: string | undefined;
    let firstDeltaAt: number | undefined;
    const chatStarted = performance.now();
    for (const name of ['owli:chat-start', 'owli:first-llm-delta', 'owli:first-stable-sentence', 'owli:first-tts-request', 'owli:first-audio-source-start']) performance.clearMarks(name);
    for (const name of ['owli:first-llm-token-ms', 'owli:first-stable-sentence-ms', 'owli:first-tts-request-ms', 'owli:first-audio-source-ms']) performance.clearMeasures(name);
    performance.mark('owli:chat-start');
    canSpeak = wantsSpeech && await audioReady;
    let timeoutRemaining = Math.max(250, timeoutLimit);
    let timeoutStartedAt = performance.now();
    let timeout: number | undefined;
    resumeChatTimeout = () => {
      if (timeout !== undefined || controller.signal.aborted) return;
      timeoutStartedAt = performance.now();
      timeout = window.setTimeout(() => controller.abort(), timeoutRemaining);
    };
    pauseChatTimeout = () => {
      if (timeout === undefined) return;
      window.clearTimeout(timeout);
      timeout = undefined;
      timeoutRemaining = Math.max(250, timeoutRemaining - (performance.now() - timeoutStartedAt));
    };
    resumeChatTimeout();
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
      const handleLine = async (line: string) => {
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
          incompleteReplyLine = appendMessage(chatMode === 'ollama' ? 'Eule (Ollama)' : 'Eule (Mock)', '');
        } else if (item.type === 'delta') {
          if (!incompleteReplyLine || typeof item.text !== 'string' || !item.text || streamedReply.length + item.text.length > 4000) throw new Error('Invalid chat stream delta');
          firstDeltaAt ??= performance.now();
          if (!performance.getEntriesByName('owli:first-llm-delta').length) {
            performance.mark('owli:first-llm-delta');
            performance.measure('owli:first-llm-token-ms', 'owli:chat-start', 'owli:first-llm-delta');
          }
          streamedReply += item.text;
          incompleteReplyLine.textContent = (chatMode === 'ollama' ? 'Eule (Ollama)' : 'Eule (Mock)') + ': ' + streamedReply;
          messages!.scrollTop = messages!.scrollHeight;
          await feedProgressive(item.text);
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
          await handleLine(pending.slice(0, newline));
          pending = pending.slice(newline + 1);
          newline = pending.indexOf('\n');
        }
        if (pending.length > 65536) throw new Error('Chat stream event too large');
      }
      pending += decoder.decode();
      if (pending) await handleLine(pending);
      if (!finished || !candidateSessionId || !chatMode) throw new Error('Incomplete chat stream');
      acceptedStream = true;
      } finally {
        if (!acceptedStream) {
          controller.abort();
          await reader.cancel().catch(() => undefined);
        }
      }
      chatCompleted = true;
      if (activeChatRequest === controller) activeChatRequest = undefined;
      sessionId = candidateSessionId;
      addTiming(dialogueMetrics === metrics ? metrics : undefined, 'chat_request_ms', chatStarted, performance.now());
      if (firstDeltaAt !== undefined && dialogueMetrics === metrics && metrics) metrics.values.chat_first_token_ms = firstDeltaAt - chatStarted;
    } finally {
      if (timeout !== undefined) window.clearTimeout(timeout);
    }
    if (canSpeak && generation === speechGeneration) {
      await feedProgressive('', true);
      progressiveFinished = true;
      signalProgressive();
      await progressiveWorker;
      if (generation !== speechGeneration) return;
      speechSequenceActive = false;
      stopAudioButton!.disabled = true;
      if (progressiveFailed) {
        setState('idle');
        retrySpeech = { chunks: progressiveChunks, nextIndex: progressivePlayed, generation, metrics };
        retrySpeechButton!.disabled = progressivePlayed >= progressiveChunks.length;
        speechStatus!.textContent = `Sprachausgabe teilweise fehlgeschlagen: ${progressivePlayed} von ${progressiveChunks.length} Abschnitten. Fehlgeschlagenen Abschnitt wiederholen möglich.`;
        notice.textContent = 'Sprachausgabe teilweise fehlgeschlagen. Textantwort bleibt erhalten.';
      } else {
        speechStatus!.textContent = 'Wiedergabe beendet.';
        setState('idle');
      }
    } else {
      notice.textContent = 'Textantwort ohne Ton.';
    }
  } catch (error) {
    if (!chatCompleted && incompleteReplyLine) {
      incompleteReplyLine.textContent += ' (Antwort unvollständig, nicht gespeichert)';
      incompleteReplyLine.dataset.status = 'incomplete';
    }
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
    if (activeChatRequest?.signal.aborted || chatCompleted) activeChatRequest = undefined;
    if (wakeProgressiveQueue === signalProgressive) wakeProgressiveQueue = undefined;
    if (state !== 'speaking') setState('idle');
    send.disabled = false;
    input.focus();
  }
});

