/** Owli-specific 3D adapter for the own parametric Blender GLB.
 *
 * Unlike Blender, glTF does not carry driver expressions. Jaw and blink morphs
 * are therefore controlled explicitly here. Vendor-specific naming never
 * leaks into the chat/TTS application; it uses CharacterAdapter semantics.
 */
import { Group, MathUtils, Mesh, Object3D, Quaternion, Vector3 } from 'three';
import type { GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { CharacterAdapter, CharacterCapabilities, CharacterState } from './character';

type Morph = { mesh: Mesh; index: number };
const AXIS_X = new Vector3(1, 0, 0);
const AXIS_Y = new Vector3(0, 1, 0);
const AXIS_Z = new Vector3(0, 0, 1);
const MAX_JAW_ANGLE = 42 * Math.PI / 180;

/** GLTFLoader sanitizes spaces/dots in node names, preserving the original
 * glTF node name in userData.name. Resolve source names, never guess the
 * loader's output sanitizer or force vendor strings into application code. */
function getBySourceName(root: Group, name: string): Object3D | undefined {
  const direct = root.getObjectByName(name);
  if (direct) return direct;
  let result: Object3D | undefined;
  root.traverse(node => {
    if (!result && node.userData.name === name) result = node;
  });
  return result;
}

function getMorph(root: Group, objectName: string, targetName: string): Morph | undefined {
  const object = getBySourceName(root, objectName);
  const mesh = object && (object as Mesh).isMesh ? object as Mesh : undefined;
  if (!mesh) return undefined;
  const index = mesh.morphTargetDictionary?.[targetName];
  return index !== undefined && mesh.morphTargetInfluences
    ? { mesh, index }
    : undefined;
}

function applyMorph(target: Morph | undefined, value: number): void {
  if (target?.mesh.morphTargetInfluences) target.mesh.morphTargetInfluences[target.index] = value;
}

export class OwliCharacterAdapter implements CharacterAdapter {
  readonly root: Group;
  readonly capabilities: Readonly<CharacterCapabilities>;

  private readonly jaw?: Object3D;
  private readonly jawRest?: Quaternion;
  private readonly head?: Object3D;
  private readonly headRest?: Quaternion;
  private readonly gazeLeft?: Object3D;
  private readonly gazeRight?: Object3D;
  private readonly gazeLeftRest?: Quaternion;
  private readonly gazeRightRest?: Quaternion;
  private readonly mouthCavity?: Morph;
  private readonly mouthWide?: Morph;
  private readonly mouthNarrow?: Morph;
  private readonly lidsLeft?: Morph;
  private readonly lidsRight?: Morph;

  private desiredMouth = 0;
  private currentMouth = 0;
  private state: CharacterState = 'idle';
  private explicitBlink?: number;
  private autoBlinkClock = 0;
  private lookX = 0;
  private lookY = 0;
  private elapsed = 0;
  private disposed = false;

  constructor(gltf: GLTF) {
    this.root = gltf.scene;
    this.jaw = getBySourceName(this.root, 'jaw');
    this.jawRest = this.jaw?.quaternion.clone();
    this.head = getBySourceName(this.root, 'head');
    this.headRest = this.head?.quaternion.clone();
    this.gazeLeft = getBySourceName(this.root, 'gaze.L');
    this.gazeRight = getBySourceName(this.root, 'gaze.R');
    this.gazeLeftRest = this.gazeLeft?.quaternion.clone();
    this.gazeRightRest = this.gazeRight?.quaternion.clone();

    this.mouthCavity = getMorph(this.root, 'Beak | inner mouth cavity (morph)', 'Open');
    this.mouthWide = getMorph(this.root, 'Beak | lower articulated mandible', 'Wide');
    this.mouthNarrow = getMorph(this.root, 'Beak | lower articulated mandible', 'Narrow');
    this.lidsLeft = getMorph(this.root, 'Eyelid.L | 0=open 1=closed', 'Closed');
    this.lidsRight = getMorph(this.root, 'Eyelid.R | 0=open 1=closed', 'Closed');

    this.capabilities = Object.freeze({
      idleAnimation: false, // This GLB exports static rig geometry; idle is procedural.
      mouthMovement: Boolean(this.jaw && this.mouthCavity),
      blink: Boolean(this.lidsLeft && this.lidsRight),
      gaze: Boolean(this.gazeLeft && this.gazeRight),
      clips: Object.freeze(gltf.animations.map(clip => clip.name)),
    });
  }

  setState(value: CharacterState): void { this.state = value; }
  setMouthOpen(value: number): void {
    this.desiredMouth = Number.isFinite(value) ? MathUtils.clamp(value, 0, 1) : 0;
  }
  setBlink(value: number): void {
    this.explicitBlink = Number.isFinite(value) ? MathUtils.clamp(value, 0, 1) : 0;
  }
  releaseBlink(): void { this.explicitBlink = undefined; }
  lookAt(x: number, y: number): void {
    this.lookX = Number.isFinite(x) ? MathUtils.clamp(x, -1, 1) : 0;
    this.lookY = Number.isFinite(y) ? MathUtils.clamp(y, -1, 1) : 0;
  }

  update(dt: number): void {
    if (this.disposed) return;
    const delta = MathUtils.clamp(Number.isFinite(dt) ? dt : 0, 0, 0.1);
    this.elapsed += delta;

    // Absolute bone pose, not cumulative rotation, so idle/stop never drifts.
    this.currentMouth += (this.desiredMouth - this.currentMouth) * (1 - Math.exp(-23 * delta));
    if (this.jaw && this.jawRest) {
      this.jaw.quaternion.copy(this.jawRest)
        .multiply(new Quaternion().setFromAxisAngle(AXIS_X, MAX_JAW_ANGLE * this.currentMouth));
    }
    applyMorph(this.mouthCavity, this.currentMouth);
    // Approximate stylized syllables until timed visemes are available.
    applyMorph(this.mouthWide, Math.min(0.28, this.currentMouth * 0.28));
    applyMorph(this.mouthNarrow, 0);

    // Stop idle blinking immediately on manual override, but keep two lids in sync.
    const blink = this.explicitBlink ?? (
      Math.max(0, 1 - Math.abs((this.autoBlinkClock % 4.2) - 2.4) / 0.15)
    );
    this.autoBlinkClock += delta;
    applyMorph(this.lidsLeft, blink);
    applyMorph(this.lidsRight, blink);

    const tilt = this.state === 'listening' ? -0.045 : this.state === 'thinking' ? 0.065 : 0;
    if (this.head && this.headRest) {
      this.head.quaternion.copy(this.headRest).multiply(
        new Quaternion().setFromAxisAngle(AXIS_Z, tilt + 0.017 * Math.sin(this.elapsed * 1.2)),
      );
    }
    for (const [bone, rest] of [[this.gazeLeft, this.gazeLeftRest], [this.gazeRight, this.gazeRightRest]] as const) {
      if (!bone || !rest) continue;
      bone.quaternion.copy(rest)
        .multiply(new Quaternion().setFromAxisAngle(AXIS_Y, this.lookX * 0.16))
        .multiply(new Quaternion().setFromAxisAngle(AXIS_X, this.lookY * 0.13));
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.setMouthOpen(0);
    this.currentMouth = 0;
    this.jaw?.quaternion.copy(this.jawRest!);
    applyMorph(this.mouthCavity, 0);
    applyMorph(this.mouthWide, 0);
    applyMorph(this.mouthNarrow, 0);
    applyMorph(this.lidsLeft, 0);
    applyMorph(this.lidsRight, 0);
  }
}
