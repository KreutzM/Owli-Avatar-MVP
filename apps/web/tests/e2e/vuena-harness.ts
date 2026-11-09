import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { AnimationClip, Group, Quaternion, QuaternionKeyframeTrack, Vector3, VectorKeyframeTrack } from 'three';
import type { GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { VuenaCharacterAdapter } from '../../src/avatar/character';

export async function inspect() {
  const gltf = await new GLTFLoader().loadAsync('/models/vuena-owl.glb');
  const adapter = new VuenaCharacterAdapter(gltf);
  const jaw = adapter.root.getObjectByName('Jaw')!;
  const lids = adapter.root.getObjectByName('Lids')!;
  const head = adapter.root.getObjectByName('Head')!;
  const idleHeadPose = head.quaternion.clone();
  for (let i = 0; i < 180; i++) adapter.update(1 / 60);
  const idleHeadDrift = idleHeadPose.angleTo(head.quaternion);
  adapter.setMouthOpen(0); adapter.update(0.016); const rest = jaw.quaternion.clone();
  adapter.setMouthOpen(1); adapter.update(0.016); const open = jaw.quaternion.clone();
  let maxError = 0;
  for (let i = 0; i < 500; i++) {
    const value = (i % 5) / 4;
    adapter.setMouthOpen(value); adapter.update(0.016);
    maxError = Math.max(maxError, jaw.quaternion.angleTo(rest.clone().slerp(open, value)));
  }
  adapter.setBlink(0); for (let i = 0; i < 60; i++) adapter.update(0.016);
  const eyeOpen = lids.position.clone();
  adapter.setBlink(1); for (let i = 0; i < 60; i++) adapter.update(0.016);
  const blinkDistance = eyeOpen.distanceTo(lids.position);
  const result = { capabilities: adapter.capabilities, angle: rest.angleTo(open), maxError, blinkDistance, idleHeadDrift };
  adapter.dispose(); return result;
}

export function inspectSyntheticIdleMotion() {
  const scene = new Group();
  const head = new Group();
  head.name = 'Head';
  const body = new Group();
  body.name = 'Body';
  scene.add(head, body);
  const headTrack = new QuaternionKeyframeTrack('Head.quaternion', [0, 1, 2], [
    ...new Quaternion().toArray(),
    ...new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), 0.6).toArray(),
    ...new Quaternion().toArray(),
  ]);
  const bodyTrack = new VectorKeyframeTrack('Body.position', [0, 1, 2], [0, 0, 0, 0, 0.1, 0, 0, 0, 0]);
  const gltf = { scene, animations: [new AnimationClip('idle', 2, [headTrack, bodyTrack])] } as unknown as GLTF;
  const adapter = new VuenaCharacterAdapter(gltf);
  const initialHead = head.quaternion.clone();
  let bodyMoved = false;
  for (let i = 0; i < 180; i++) {
    adapter.update(1 / 60);
    bodyMoved ||= body.position.y !== 0;
  }
  const headDrift = initialHead.angleTo(head.quaternion);
  const idleTilt = adapter.root.rotation.z;
  adapter.setState('listening');
  for (let i = 0; i < 120; i++) adapter.update(1 / 60);
  const listeningTilt = adapter.root.rotation.z;
  adapter.setState('thinking');
  for (let i = 0; i < 120; i++) adapter.update(1 / 60);
  const thinkingTilt = adapter.root.rotation.z;
  adapter.setState('speaking');
  for (let i = 0; i < 120; i++) adapter.update(1 / 60);
  const speakingTilt = adapter.root.rotation.z;
  adapter.setState('idle');
  for (let i = 0; i < 180; i++) adapter.update(1 / 60);
  const returnedIdleTilt = adapter.root.rotation.z;
  adapter.dispose();

  const simulateTilt = (fps: number) => {
    const separate = new VuenaCharacterAdapter({
      scene: scene.clone(), animations: [new AnimationClip('idle', 2, [
        new QuaternionKeyframeTrack('Head.quaternion', [0, 1, 2], [
          ...new Quaternion().toArray(),
          ...new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), 0.6).toArray(),
          ...new Quaternion().toArray(),
        ]),
      ])],
    } as unknown as GLTF);
    separate.setState('thinking');
    for (let i = 0; i < fps * 2; i++) separate.update(1 / fps);
    const tilt = separate.root.rotation.z;
    separate.dispose();
    return tilt;
  };
  return {
    headDrift,
    bodyMoved,
    idleTilt,
    listeningTilt,
    thinkingTilt,
    speakingTilt,
    returnedIdleTilt,
    tilt30fps: simulateTilt(30),
    tilt60fps: simulateTilt(60),
  };
}
