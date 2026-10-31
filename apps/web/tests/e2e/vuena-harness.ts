import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { VuenaCharacterAdapter } from '../../src/avatar/character';

export async function inspect() {
  const gltf = await new GLTFLoader().loadAsync('/models/vuena-owl.glb');
  const adapter = new VuenaCharacterAdapter(gltf);
  const jaw = adapter.root.getObjectByName('Jaw')!;
  const lids = adapter.root.getObjectByName('Lids')!;
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
  const result = { capabilities: adapter.capabilities, angle: rest.angleTo(open), maxError, blinkDistance };
  adapter.dispose(); return result;
}
