import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { VuenaCharacterAdapter } from '../../src/avatar/character';

declare global { interface Window { visual26?: { setPose: (mouth: number, factor: number, camera: string) => void; metrics: () => object } } }
export async function mountVisual26() {
  const host=document.querySelector<HTMLDivElement>('#avatar')!; host.querySelector('canvas')?.remove();
  const scene=new THREE.Scene(); scene.background=new THREE.Color('#243a53');
  const camera=new THREE.PerspectiveCamera(36,1,.1,100);
  const renderer=new THREE.WebGLRenderer({antialias:true,preserveDrawingBuffer:true}); renderer.setPixelRatio(1); host.append(renderer.domElement);
  scene.add(new THREE.HemisphereLight(0xffffff,0x4f6c87,2.4)); const key=new THREE.DirectionalLight(0xffffff,2);key.position.set(-3,6,7);scene.add(key);
  const gltf=await new GLTFLoader().loadAsync('/models/vuena-owl.glb'); const adapter=new VuenaCharacterAdapter(gltf);scene.add(adapter.root);
  const jaw=adapter.root.getObjectByName('Jaw') as THREE.Bone;const restJaw=jaw.quaternion.clone();let amount=0,factor=1,view='baseline';
  const resize=()=>{const r=host.getBoundingClientRect();renderer.setSize(r.width,r.height,false);camera.aspect=r.width/r.height;camera.updateProjectionMatrix();};resize();new ResizeObserver(resize).observe(host);
  window.visual26={setPose(m,f,v){amount=m;factor=f;view=v;},metrics(){return {mouth:amount,angleFromRest:jaw.quaternion.angleTo(restJaw),capabilities:adapter.capabilities};}};
  let last=performance.now();const frame=(now:number)=>{const dt=Math.min(.1,(now-last)/1000);last=now;adapter.setMouthOpen(Math.min(1,amount*factor));adapter.update(dt);const close=view.includes('close'),low=view.includes('low');camera.position.set(0,low?1.08:1.4,close?4.4:7.7);camera.lookAt(0,low?.5:.65,0);renderer.render(scene,camera);requestAnimationFrame(frame);};requestAnimationFrame(frame);
}
