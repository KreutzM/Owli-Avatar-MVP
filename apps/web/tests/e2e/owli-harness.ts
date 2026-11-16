import { Bone, BoxGeometry, Group, Mesh, MeshBasicMaterial } from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { OwliCharacterAdapter } from '../../src/avatar/owli';

function morphNode(name: string, morphs: string[]): Mesh {
  const mesh = new Mesh(new BoxGeometry(), new MeshBasicMaterial());
  mesh.name = name;
  mesh.morphTargetDictionary = Object.fromEntries(morphs.map((key, index) => [key, index]));
  mesh.morphTargetInfluences = morphs.map(() => 0);
  return mesh;
}
export function inspect() {
  const root = new Group();
  const head = new Bone(); head.name = 'head'; root.add(head);
  const jaw = new Bone(); jaw.name = 'jaw'; head.add(jaw);
  jaw.add(morphNode('Beak | lower articulated mandible', ['Wide', 'Narrow']));
  head.add(morphNode('Beak | inner mouth cavity (morph)', ['Open']));
  head.add(morphNode('Eyelid.L | 0=open 1=closed', ['Closed']));
  head.add(morphNode('Eyelid.R | 0=open 1=closed', ['Closed']));
  const gazeL = new Bone(); gazeL.name = 'gaze.L'; head.add(gazeL);
  const gazeR = new Bone(); gazeR.name = 'gaze.R'; head.add(gazeR);
  const adapter = new OwliCharacterAdapter({scene: root, animations: []} as unknown as GLTF);
  const rest = jaw.quaternion.clone();
  adapter.setMouthOpen(1);
  for (let i = 0; i < 60; i++) adapter.update(1 / 60);
  const angleOpen = rest.angleTo(jaw.quaternion);
  const cavityOpen = (root.getObjectByName('Beak | inner mouth cavity (morph)') as Mesh).morphTargetInfluences?.[0] ?? 0;
  adapter.setBlink(1);
  adapter.update(1 / 60);
  const lidClosed = (root.getObjectByName('Eyelid.L | 0=open 1=closed') as Mesh).morphTargetInfluences?.[0] ?? 0;
  adapter.lookAt(.75, .5);
  adapter.update(1 / 60);
  const gazeMoved = gazeL.quaternion.angleTo(gazeR.quaternion); // identical gaze is intended; test against rest separately
  const gazeRotated = Math.abs(gazeL.rotation.x) + Math.abs(gazeL.rotation.y);
  adapter.setMouthOpen(0);
  for (let i = 0; i < 65; i++) adapter.update(1 / 60);
  const angleClosed = rest.angleTo(jaw.quaternion);
  adapter.dispose();
  return {capabilities: adapter.capabilities, angleOpen, angleClosed, cavityOpen, lidClosed, gazeRotated, gazeMoved};
}

export async function inspectReal() {
  const gltf = await new GLTFLoader().loadAsync('/models/owli-avatar.glb');
  const avatar = new OwliCharacterAdapter(gltf);
  avatar.setMouthOpen(1);
  for (let i = 0; i < 60; i++) avatar.update(1 / 60);
  // Preserve true source node names despite GLTFLoader's animation-safe
  // sanitization of Object3D.name (spaces and dots are not preserved).
  const find = (name: string) => {
    let obj = avatar.root.getObjectByName(name);
    if (!obj) avatar.root.traverse(node => { if (!obj && node.userData.name === name) obj = node; });
    return obj;
  };
  const jaw = find('jaw');
  const lower = find('Beak | lower articulated mandible');
  const cavity = find('Beak | inner mouth cavity (morph)') as Mesh | undefined;
  const cavityIndex = cavity?.morphTargetDictionary?.Open;
  const cavityOpen = cavityIndex !== undefined ? cavity?.morphTargetInfluences?.[cavityIndex] : undefined;
  const out = {capabilities: avatar.capabilities, hasJaw: Boolean(jaw),
    hasLower: Boolean(lower), cavityOpen};
  avatar.dispose();
  return out;
}
