import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { VuenaCharacterAdapter, type CharacterAdapter, type CharacterState } from './avatar/character';
import { AudioPlayer } from './audio/AudioPlayer';
import { PushToTalk } from './audio/PushToTalk';
import './style.css';

type AvatarState = CharacterState;
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
stopAudioButton.addEventListener('click', () => { stopSpeech(); speechStatus.textContent = 'Wiedergabe gestoppt.'; });
speechEnabled.addEventListener('change', () => { if (!speechEnabled.checked) stopSpeech(); });
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
  onError: () => {
    sttStatus!.textContent = 'Mikrofon nicht verfügbar oder Aufnahme fehlgeschlagen. Texteingabe bleibt möglich.';
    ptt!.disabled = !sttAvailable; pttCancel!.disabled = true;
    send!.disabled = false; setState('idle');
  },
});
function cancelCapture(): void {
  captureGeneration++;
  sttRequest?.abort(); sttRequest = undefined;
  capture.cancel();
  ptt!.disabled = !sttAvailable; pttCancel!.disabled = true;
  send!.disabled = false; setState('idle');
}
async function transcribe(blob: Blob, generation: number): Promise<void> {
  if (generation !== captureGeneration || disposed) return;
  setState('thinking'); ptt!.disabled = true;
  sttStatus!.textContent = 'Sprache wird erkannt …';
  const controller = new AbortController(); sttRequest = controller;
  const timeout = window.setTimeout(() => controller.abort(), 125000);
  try {
    const response = await fetch('/api/stt', { method: 'POST', headers: { 'Content-Type': 'audio/webm;codecs=opus' }, body: blob, signal: controller.signal });
    if (!response.ok) throw new Error('STT unavailable');
    const result: unknown = await response.json();
    const text = (result as {text?: unknown} | null)?.text;
    if (typeof text !== 'string' || text.length > 1000) throw new Error('Invalid transcription');
    if (generation !== captureGeneration || disposed) return;
    input!.value = text;
    sttStatus!.textContent = text.trim() ? 'Erkannten Text prüfen oder senden.' : 'Keine Sprache erkannt.';
    setState('idle'); send!.disabled = false; pttCancel!.disabled = true; ptt!.disabled = !sttAvailable;
    if (text.trim() && autoSend!.checked) form!.requestSubmit();
  } catch {
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
function animate() {
  if (!renderer) return;
  frame = requestAnimationFrame(animate);
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

function appendMessage(who: string, value: string) {
  const p = document.createElement('p');
  p.textContent = who + ': ' + value;
  messages!.append(p);
  messages!.scrollTop = messages!.scrollHeight;
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
  const audioReady = wantsSpeech ? audioPlayer.initialize().then(() => true, () => false) : Promise.resolve(false);
  appendMessage('Du', message);
  input.value = '';
  send.disabled = true;
  notice.textContent = '';
  setState('thinking');
  try {
    const controller = new AbortController();
    const timeoutLimit = Number(import.meta.env.VITE_CHAT_TIMEOUT_MS) || 65000;
    const timeout = window.setTimeout(() => controller.abort(), Math.max(250, timeoutLimit));
    let response: Response;
    try {
      response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message, ...(sessionId ? { session_id: sessionId } : {}) }),
        signal: controller.signal,
      });
    } finally {
      window.clearTimeout(timeout);
    }
    if (!response.ok) {
      if (response.status === 404) sessionId = undefined;
      throw new Error('API HTTP ' + response.status);
    }
    const result: unknown = await response.json();
    if (!result || typeof result !== 'object') throw new Error('Unexpected API response');
    const chatResult = result as { reply?: unknown; mode?: unknown; session_id?: unknown };
    if (typeof chatResult.reply !== 'string' || !chatResult.reply.trim()
      || (chatResult.mode !== 'mock' && chatResult.mode !== 'ollama')
      || typeof chatResult.session_id !== 'string' || !chatResult.session_id.trim()
      || chatResult.session_id.length > 64) {
      throw new Error('Unexpected API response');
    }
    sessionId = chatResult.session_id;
    appendMessage(chatResult.mode === 'ollama' ? 'Eule (Ollama)' : 'Eule (Mock)', chatResult.reply);
    if (wantsSpeech && generation === speechGeneration) {
      if (!(await audioReady)) throw new Error('Audio unavailable');
      if (generation !== speechGeneration) return;
      const synth = new AbortController();
      speechRequest = synth;
      stopAudioButton.disabled = false;
      speechStatus.textContent = 'Sprachausgabe wird erzeugt …';
      const synthTimeout = window.setTimeout(() => synth.abort(), 65000);
      try {
        const response = await fetch('/api/tts', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: chatResult.reply }), signal: synth.signal });
        if (!response.ok) throw new Error('TTS HTTP ' + response.status);
        const wav = await response.arrayBuffer();
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
    if (generation === speechGeneration) {
      stopSpeech();
      setState('error');
      notice.textContent = wantsSpeech && messages!.lastElementChild?.textContent?.startsWith('Eule')
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

