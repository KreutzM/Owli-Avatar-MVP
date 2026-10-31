import { AnimationClip, AnimationMixer, Group, Mesh } from 'three';
import type { GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';

export type CharacterState =
  | 'idle'
  | 'listening'
  | 'thinking'
  | 'speaking'
  | 'error';

export interface CharacterCapabilities {
  idleAnimation: boolean;
  mouthMovement: boolean;
  blink: boolean;
  gaze: boolean;
  clips: readonly string[];
}

/** Model-independent controls exposed by an avatar implementation. */
export interface CharacterAdapter {
  readonly root: Group;
  readonly capabilities: Readonly<CharacterCapabilities>;
  setState(state: CharacterState): void;
  update(deltaSeconds: number): void;
  setMouthOpen(amount: number): void;
  setBlink(amount: number): void;
  lookAt(x: number, y: number): void;
  dispose(): void;
}

/** Adapter for the current Gobkit test owl. Model-specific names stay here. */
export class GobkitCharacterAdapter implements CharacterAdapter {
  readonly root: Group;
  readonly capabilities: Readonly<CharacterCapabilities>;

  private readonly mixer: AnimationMixer;
  private readonly mouthTargets: Array<{ mesh: Mesh; index: number }> = [];
  private readonly idleAction;
  private mouthAmount = 0;
  private tilt = 0;
  private disposed = false;

  constructor(gltf: GLTF) {
    this.root = gltf.scene;
    this.mixer = new AnimationMixer(this.root);
    this.root.traverse(object => {
      if (!(object instanceof Mesh)) return;
      const index = object.morphTargetDictionary?.BeakOpen;
      if (index !== undefined && object.morphTargetInfluences) {
        this.mouthTargets.push({ mesh: object, index });
      }
    });

    const idleClip = gltf.animations.find((clip: AnimationClip) =>
      clip.name.toLowerCase() === 'idle',
    );
    this.idleAction = idleClip ? this.mixer.clipAction(idleClip) : undefined;
    this.capabilities = Object.freeze({
      idleAnimation: Boolean(this.idleAction),
      mouthMovement: this.mouthTargets.length > 0,
      blink: false,
      gaze: false,
      clips: Object.freeze(gltf.animations.map(clip => clip.name)),
    });
    this.idleAction?.play();
  }

  setState(state: CharacterState): void {
    // The authored clip keeps playing; modest procedural tilts communicate
    // listening/thinking without replacing or restarting it.
    this.tilt = state === 'listening' ? -0.08 : state === 'thinking' ? 0.1 : 0;
  }

  update(deltaSeconds: number): void {
    if (this.disposed) return;
    const delta = Math.max(0, Math.min(deltaSeconds, 0.1));
    this.mixer.update(delta);
    this.root.rotation.z += (this.tilt - this.root.rotation.z) * (1 - Math.exp(-5 * delta));
    for (const { mesh, index } of this.mouthTargets) {
      if (mesh.morphTargetInfluences) mesh.morphTargetInfluences[index] = this.mouthAmount;
    }
  }

  setMouthOpen(amount: number): void {
    this.mouthAmount = Number.isFinite(amount)
      ? Math.min(1, Math.max(0, amount))
      : 0;
  }

  setBlink(_amount: number): void { /* not available on this rig */ }

  lookAt(_x: number, _y: number): void { /* not available on this rig */ }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.idleAction?.stop();
    this.mixer.stopAllAction();
    this.mixer.uncacheRoot(this.root);
  }
}
