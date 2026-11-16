import { test, expect } from '@playwright/test';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

test('Owli semantic jaw, blink and gaze controls are absolute without a vendor mixer', async ({page}) => {
  await page.goto('/');
  const data = await page.evaluate(async () => {
    const module = await import(/* @vite-ignore */ '/tests/e2e/owli-harness.ts');
    return module.inspect();
  });
  expect(data.capabilities).toMatchObject({ mouthMovement: true, blink: true, gaze: true });
  expect(data.angleOpen).toBeGreaterThan(.65);
  expect(data.angleClosed).toBeLessThan(.0001);
  expect(data.cavityOpen).toBeGreaterThan(.99);
  expect(data.lidClosed).toBe(1);
  expect(data.gazeRotated).toBeGreaterThan(.01);
});

test('optional local Owli asset is a real loadable glTF, if supplied', async ({page}) => {
  test.skip(!existsSync(resolve('public/models/owli-avatar.glb')),
    'Requires explicit installation of pinned Owli artifact');
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const {GLTFLoader} = await import('three/examples/jsm/loaders/GLTFLoader.js');
    const gltf = await new GLTFLoader().loadAsync('/models/owli-avatar.glb');
    const {OwliCharacterAdapter} = await import('/src/avatar/owli.ts');
    const avatar = new OwliCharacterAdapter(gltf);
    avatar.setMouthOpen(1);
    for (let i = 0; i < 60; i++) avatar.update(1 / 60);
    const jaw = avatar.root.getObjectByName('jaw');
    const lower = avatar.root.getObjectByName('Beak | lower articulated mandible');
    const out = { capabilities: avatar.capabilities, hasJaw: Boolean(jaw),
      hasLower: Boolean(lower) };
    avatar.dispose();
    return out;
  });
  expect(result.capabilities.mouthMovement).toBe(true);
  expect(result.capabilities.blink).toBe(true);
  expect(result.capabilities.gaze).toBe(true);
  expect(result.hasJaw && result.hasLower).toBe(true);
});
