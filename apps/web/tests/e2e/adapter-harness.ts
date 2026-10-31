import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { GobkitCharacterAdapter } from '../../src/avatar/character';

export async function checkAdapter() {
  const gltf = await new GLTFLoader().loadAsync('/models/gobkit-owl.glb');
  const adapter = new GobkitCharacterAdapter(gltf);
  const targets: Array<{ mesh: THREE.Mesh; index: number }> = [];
  gltf.scene.traverse(object => {
    if (object instanceof THREE.Mesh && object.morphTargetDictionary?.BeakOpen !== undefined) {
      targets.push({ mesh: object, index: object.morphTargetDictionary.BeakOpen });
    }
  });
  const bones: THREE.Bone[] = [];
  gltf.scene.traverse(object => { if (object instanceof THREE.Bone) bones.push(object); });
  const snapshot = () => bones.map(bone => [...bone.position.toArray(), ...bone.quaternion.toArray(), ...bone.scale.toArray()]);
  adapter.setState('speaking');
  adapter.setMouthOpen(2);
  adapter.update(0.1);
  const before = snapshot();
  for (let i = 0; i < 6; i++) adapter.update(0.1);
  const after = snapshot();
  const open = targets.map(({ mesh, index }) => mesh.morphTargetInfluences?.[index]);
  adapter.setState('thinking');
  for (let i = 0; i < 10; i++) adapter.update(0.1);
  const tiltBeforeIdle = adapter.root.rotation.z;
  adapter.setState('idle');
  const tiltAfterState = adapter.root.rotation.z;
  adapter.setMouthOpen(-1);
  for (let i = 0; i < 20; i++) adapter.update(0.1);
  const closed = targets.map(({ mesh, index }) => mesh.morphTargetInfluences?.[index]);
  const tiltAtRest = adapter.root.rotation.z;
  const caps = adapter.capabilities;
  adapter.dispose();

  const empty = new GobkitCharacterAdapter({ scene: new THREE.Group(), animations: [] } as unknown as GLTF);
  empty.setState('speaking');
  empty.setMouthOpen(1);
  empty.update(0.1);
  const emptyCaps = empty.capabilities;
  empty.dispose();
  return { caps, open, closed, tiltBeforeIdle, tiltAfterState, tiltAtRest, idleMoved: before.some((values, i) => values.some((value, j) => Math.abs(value - after[i][j]) > 0.00001)), emptyCaps };
}

// Deterministic visual inspection of both mouth extremes at the same idle phase.
export async function renderComparison() {
  const gltf = await new GLTFLoader().loadAsync('/models/gobkit-owl.glb');
  const adapter = new GobkitCharacterAdapter(gltf);
  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#243a53');
  scene.add(adapter.root);
  scene.add(new THREE.HemisphereLight(0xffffff, 0x4f6c87, 2.4));
  const light = new THREE.DirectionalLight(0xffffff, 2);
  light.position.set(-3, 6, 7);
  scene.add(light);
  const camera = new THREE.PerspectiveCamera(36, 1, 0.1, 100);
  camera.position.set(0, 1.8, 6.5);
  camera.lookAt(0, 1.8, 0);
  const panel = document.createElement('div');
  panel.id = 'comparison';
  panel.style.cssText = 'display:flex;position:fixed;inset:0;background:#243a53;z-index:100';
  document.body.append(panel);
  for (const amount of [0, 1]) {
    const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    renderer.setSize(600, 600);
    panel.append(renderer.domElement);
    adapter.setMouthOpen(amount);
    adapter.update(0);
    renderer.render(scene, camera);
  }
}
