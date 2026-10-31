import {
  AnimationClip,
  AnimationMixer,
  Bone,
  Group,
  Mesh,
  Quaternion,
  SkinnedMesh,
  Vector3,
} from 'three';
import type { GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';

export type CharacterState = 'idle' | 'listening' | 'thinking' | 'speaking' | 'error';

export interface CharacterCapabilities {
  idleAnimation: boolean;
  mouthMovement: boolean;
  blink: boolean;
  gaze: boolean;
  clips: readonly string[];
}

/** Semantic controls; asset-specific bone names remain inside the adapter. */
export interface CharacterAdapter {
  readonly root: Group;
  readonly capabilities: Readonly<CharacterCapabilities>;
  setState(state: CharacterState): void;
  update(deltaSeconds: number): void;
  setMouthOpen(amount: number): void;
  setBlink(amount: number): void;
  releaseBlink(): void;
  lookAt(x: number, y: number): void;
  dispose(): void;
}

/** Vuena sample owl adapter. No model-specific names escape this class. */
export class VuenaCharacterAdapter implements CharacterAdapter {
  readonly root: Group;
  readonly capabilities: Readonly<CharacterCapabilities>;

  private readonly mixer: AnimationMixer;
  private readonly mouthMorphs: Array<{mesh: Mesh; index: number}> = [];
  private readonly idleAction?: ReturnType<AnimationMixer['clipAction']>;
  private readonly jaw?: Bone;
  private readonly lids?: Bone;
  private readonly jawRest?: Quaternion;
  private jawBase?: Quaternion;
  private lidsBase?: Vector3;
  private readonly jawCall?: Quaternion;
  private readonly lidsNeutral?: Vector3;
  private readonly lidsClosedDelta?: Vector3;
  private mouthAmount = 0;
  private manualBlink?: number;
  private manualBlinkBlend = 0;
  private blinkCountdown = 2.5;
  private blinkElapsed?: number;
  private targetTilt = 0;
  private disposed = false;

  constructor(gltf: GLTF) {
    this.root = gltf.scene;
    this.mixer = new AnimationMixer(this.root);
    this.root.traverse(object => {
      if (!(object instanceof Mesh)) return;
      const index = object.morphTargetDictionary?.BeakOpen;
      if (index !== undefined && object.morphTargetInfluences) this.mouthMorphs.push({mesh: object, index});
    });
    const bones: Bone[] = [];
    this.root.traverse(object => {
      if ((object as Bone).isBone) bones.push(object as Bone);
    });
    this.jaw = bones.find(bone => bone.name === 'Jaw');
    this.lids = bones.find(bone => bone.name === 'Lids');

    const hasWeightedBone = (bone?: Bone): boolean => {
      if (!bone) return false;
      let found = false;
      this.root.traverse(object => {
        if (found || !(object as SkinnedMesh).isSkinnedMesh) return;
        const mesh = object as SkinnedMesh;
        const jointIndex = mesh.skeleton.bones.indexOf(bone);
        const indices = mesh.geometry.getAttribute('skinIndex');
        const weights = mesh.geometry.getAttribute('skinWeight');
        if (jointIndex < 0 || !indices || !weights) return;
        for (let vertex = 0; vertex < indices.count && !found; vertex++) {
          for (let component = 0; component < 4; component++) {
            if (indices.getComponent(vertex, component) === jointIndex &&
                weights.getComponent(vertex, component) > 0) {
              found = true;
              break;
            }
          }
        }
      });
      return found;
    };
    if (!hasWeightedBone(this.jaw)) this.jaw = undefined;
    if (!hasWeightedBone(this.lids)) this.lids = undefined;

    // The supplied sample has desktop LOD0 and mobile LOD1 in one scene.
    if (this.root.getObjectByName('owl_LOD0')) {
      this.root.traverse(object => {
        if (object.name.toLowerCase().includes('lod1')) object.visible = false;
      });
    }

    const idle = gltf.animations.find((clip: AnimationClip) => clip.name.toLowerCase() === 'idle');
    this.idleAction = idle ? this.mixer.clipAction(idle) : undefined;
    this.jawRest = this.jaw?.quaternion.clone().normalize();
    // Sample the original call clip once; never run it as a speaking loop.
    const call = gltf.animations.find(clip => clip.name.toLowerCase() === 'call');
    if (this.jaw && this.jawRest && call) {
      const probe = new AnimationMixer(this.root);
      const action = probe.clipAction(call).play();
      let maximum = 0;
      let endpoint = this.jawRest.clone();
      for (let i = 0; i <= 4000; i++) {
        probe.setTime(Math.min(call.duration * i / 4000, call.duration - 1e-7));
        const angle = this.jawRest.angleTo(this.jaw.quaternion);
        if (angle > maximum) { maximum = angle; endpoint = this.jaw.quaternion.clone().normalize(); }
      }
      action.stop();
      probe.uncacheRoot(this.root);
      this.jaw.quaternion.copy(this.jawRest);
      if (maximum > 1e-6) this.jawCall = endpoint;
    }

    const lidTrack = idle?.tracks.find(track =>
      track.name.includes('Lids') && track.name.endsWith('.position'),
    );
    if (lidTrack && lidTrack.values.length >= 6) {
      const values = lidTrack.values;
      const neutral = new Vector3(values[0], values[1], values[2]);
      let closed = neutral;
      let farthest = 0;
      for (let i = 3; i + 2 < values.length; i += 3) {
        const candidate = new Vector3(values[i], values[i + 1], values[i + 2]);
        const distance = candidate.distanceToSquared(neutral);
        if (distance > farthest) {
          farthest = distance;
          closed = candidate;
        }
      }
      if (farthest > 1e-8) {
        this.lidsNeutral = neutral;
        this.lidsClosedDelta = closed.clone().sub(neutral);
      }
    }

    this.capabilities = Object.freeze({
      idleAnimation: Boolean(this.idleAction),
      mouthMovement: Boolean(this.jaw && this.jawCall),
      blink: Boolean(this.lids && this.lidsClosedDelta),
      gaze: false,
      clips: Object.freeze(gltf.animations.map(clip => clip.name)),
    });
    this.idleAction?.play();
  }

  setState(state: CharacterState): void {
    this.targetTilt = state === 'listening' ? -0.045 : state === 'thinking' ? 0.065 : 0;
  }

  setMouthOpen(amount: number): void {
    this.mouthAmount = Number.isFinite(amount) ? Math.max(0, Math.min(1, amount)) : 0;
  }

  /** Override automatic idle blinking until releaseBlink() is called. */
  setBlink(amount: number): void {
    this.manualBlink = Number.isFinite(amount) ? Math.max(0, Math.min(1, amount)) : 0;
  }

  /** Return eyelids to the authored idle animation and automatic blinking. */
  releaseBlink(): void {
    if (this.manualBlink === undefined) return;
    this.manualBlink = undefined;
  }

  lookAt(_x: number, _y: number): void { /* The sample has no gaze control. */ }

  update(deltaSeconds: number): void {
    if (this.disposed) return;
    const delta = Math.max(0, Math.min(deltaSeconds, 0.1));
    // Mixer may skip writing unchanged tracks; remove last frame's overlay first.
    if (this.jaw && this.jawBase) this.jaw.quaternion.copy(this.jawBase);
    if (this.lids && this.lidsBase) this.lids.position.copy(this.lidsBase);
    this.mixer.update(delta);
    if (this.jaw) this.jawBase = this.jaw.quaternion.clone();
    if (this.lids) this.lidsBase = this.lids.position.clone();
    this.root.rotation.z += (this.targetTilt - this.root.rotation.z) * (1 - Math.exp(-4 * delta));

    for (const {mesh, index} of this.mouthMorphs) {
      if (mesh.morphTargetInfluences) mesh.morphTargetInfluences[index] = this.mouthAmount;
    }
    // Absolute pose after the mixer: independent of idle and previous frames.
    if (this.jaw && this.jawRest && this.jawCall) {
      this.jaw.quaternion.copy(this.jawRest).slerp(this.jawCall, this.mouthAmount);
    }

    if (!this.lids || !this.lidsClosedDelta || !this.lidsNeutral) return;
    // Interpolate the explicit override toward/from the animated idle pose.
    const target = this.manualBlink ?? 0;
    this.manualBlinkBlend += (target - this.manualBlinkBlend) * (1 - Math.exp(-18 * delta));
    if (this.manualBlink !== undefined || this.manualBlinkBlend > 0.001) {
      const closed = this.lidsNeutral.clone().add(this.lidsClosedDelta);
      this.lids.position.lerp(closed, this.manualBlinkBlend);
      return;
    }
    // Preserve the authored idle blink; add a short occasional blink only
    // between manual overrides, without moving past the closed endpoint.
    if (this.blinkElapsed === undefined) {
      this.blinkCountdown -= delta;
      if (this.blinkCountdown <= 0) this.blinkElapsed = 0;
      else return;
    }
    this.blinkElapsed += delta;
    const phase = Math.min(1, this.blinkElapsed / 0.18);
    const amount = phase < 0.5 ? phase * 2 : (1 - phase) * 2;
    if (amount > 0) this.lids.position.lerp(this.lidsNeutral.clone().add(this.lidsClosedDelta), amount);
    if (phase >= 1) {
      this.blinkElapsed = undefined;
      this.blinkCountdown = 2.4 + Math.random() * 2.8;
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.idleAction?.stop();
    this.mixer.stopAllAction();
    this.mixer.uncacheRoot(this.root);
  }
}
