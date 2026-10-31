import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { GobkitCharacterAdapter, type CharacterAdapter, type CharacterState } from './avatar/character';
import './style.css';

type AvatarState = CharacterState;
const host = document.querySelector<HTMLDivElement>('#avatar');
const stateLabel = document.querySelector<HTMLSpanElement>('#state');
const form = document.querySelector<HTMLFormElement>('#chat-form');
const input = document.querySelector<HTMLTextAreaElement>('#message');
const messages = document.querySelector<HTMLDivElement>('#messages');
const notice = document.querySelector<HTMLParagraphElement>('#notice');
const send = document.querySelector<HTMLButtonElement>('#send');
if (!host || !stateLabel || !form || !input || !messages || !notice || !send) {
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

const owl = new THREE.Group();
scene.add(owl);
const brown = new THREE.MeshStandardMaterial({ color: '#b77c4a', roughness: 0.82 });
const cream = new THREE.MeshStandardMaterial({ color: '#f0dfb8', roughness: 0.84 });
const gold = new THREE.MeshStandardMaterial({ color: '#efb54c', roughness: 0.65 });
const pupil = new THREE.MeshStandardMaterial({ color: '#15212d', roughness: 0.2 });
const perchMaterial = new THREE.MeshStandardMaterial({ color: '#6d4a34', roughness: 0.95 });
function ball(x: number, y: number, z: number, sx: number, sy: number, sz: number, material: THREE.Material): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 24, 16), material);
  mesh.position.set(x, y, z);
  mesh.scale.set(sx, sy, sz);
  owl.add(mesh);
  return mesh;
}
ball(0, 0.2, 0, 0.95, 1.2, 0.72, brown);
ball(0, 0.0, 0.53, 0.68, 0.83, 0.19, cream);
ball(0, 1.55, 0, 1.05, 0.94, 0.8, brown);
ball(-0.43, 1.58, 0.69, 0.38, 0.39, 0.10, cream);
ball(0.43, 1.58, 0.69, 0.38, 0.39, 0.10, cream);
ball(-0.43, 1.58, 0.79, 0.16, 0.18, 0.07, pupil);
ball(0.43, 1.58, 0.79, 0.16, 0.18, 0.07, pupil);
ball(-0.88, 0.15, -0.12, 0.24, 0.72, 0.54, brown);
ball(0.88, 0.15, -0.12, 0.24, 0.72, 0.54, brown);
ball(-0.42, -0.97, 0.36, 0.18, 0.16, 0.32, gold);
ball(0.42, -0.97, 0.36, 0.18, 0.16, 0.32, gold);
const beak = new THREE.Mesh(new THREE.ConeGeometry(0.17, 0.32, 4), gold);
beak.rotation.z = Math.PI;
beak.position.set(0, 1.28, 0.85);
owl.add(beak);
const perch = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.13, 4.3, 20), perchMaterial);
perch.rotation.z = Math.PI / 2;
perch.position.set(0, -1.1, 0.18);
scene.add(perch);

host.dataset.character = 'placeholder';
let state: AvatarState = 'idle';
let character: CharacterAdapter | undefined;
let disposed = false;
const setState = (next: AvatarState) => {
  state = next;
  character?.setState(next);
  stateLabel.textContent = 'Status: ' + next;
};
if (renderer) {
  new GLTFLoader().load('/models/gobkit-owl.glb', gltf => {
    if (disposed) return;
    character = new GobkitCharacterAdapter(gltf);
    character.root.scale.setScalar(0.85);
    character.root.position.y = -1.1;
    character.setState(state);
    scene.add(character.root);
    owl.visible = false;
    host.dataset.character = 'gobkit';
    host.setAttribute('aria-label', 'Animierte dreidimensionale Eule');
    const description = document.querySelector<HTMLParagraphElement>('.heading p');
    if (description) description.textContent = 'Geriggtes 3D-Testmodell · Gobkit';
  }, undefined, error => {
    host.dataset.character = 'placeholder';
    console.warn('Eulenmodell nicht verfügbar; Platzhalter bleibt aktiv.', error);
  });
}
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
  const t = clock.elapsedTime;
  owl.position.y = Math.sin(t * 1.5) * 0.045;
  owl.rotation.y = Math.sin(t * 0.7) * (state === 'thinking' ? 0.26 : 0.08);
  const mouth = state === 'speaking' ? Math.abs(Math.sin(t * 14)) : 0;
  beak.scale.y = 1 + mouth * 0.7;
  character?.setMouthOpen(mouth);
  character?.update(delta);
  renderer.render(scene, camera);
}
if (renderer) animate();
window.addEventListener('pagehide', () => {
  disposed = true;
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

form.addEventListener('submit', async event => {
  event.preventDefault();
  const message = input.value.trim();
  if (!message || send.disabled) return;
  appendMessage('Du', message);
  input.value = '';
  send.disabled = true;
  notice.textContent = '';
  setState('thinking');
  try {
    const controller = new AbortController();
    const timeoutLimit = Number(import.meta.env.VITE_CHAT_TIMEOUT_MS) || 15000;
    const timeout = window.setTimeout(() => controller.abort(), Math.max(250, timeoutLimit));
    let response: Response;
    try {
      response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message }),
        signal: controller.signal,
      });
    } finally {
      window.clearTimeout(timeout);
    }
    if (!response.ok) throw new Error('API HTTP ' + response.status);
    const result = await response.json() as { reply: string; mode: string };
    if (result.mode !== 'mock' || typeof result.reply !== 'string') {
      throw new Error('Unexpected API response');
    }
    setState('speaking'); // Visual simulation only; no TTS playback yet.
    appendMessage('Eule (Mock)', result.reply);
    await new Promise<void>(resolve => window.setTimeout(resolve, 700));
  } catch (error) {
    setState('error');
    notice.textContent = 'Mock-API nicht erreichbar oder Antwort ungueltig. Backend lokal starten.';
    console.error(error);
  } finally {
    setState('idle');
    send.disabled = false;
    input.focus();
  }
});

