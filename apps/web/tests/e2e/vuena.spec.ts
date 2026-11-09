import { test, expect, fulfillChatStream } from './chat-stream-fixtures';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

test.beforeEach(async ({ page }) => {
  await page.route('**/api/**', route => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/health') return route.fulfill({ json: { status: 'ok', mode: 'mock' } });
    if (path === '/api/stt/status') return route.fulfill({ json: { enabled: false } });
    if (path === '/api/tts/status') return route.fulfill({ json: { enabled: false } });
    if (path === '/api/chat/stream') return fulfillChatStream(route, { reply: 'Mock-Antwort', session_id: 'fixture', mode: 'mock' });
    return route.fulfill({ status: 501, json: { error: { code: 'TEST_UNMOCKED', message: 'No API in avatar tests' } } });
  });
});

test('original model loads and rig controls stay absolute across mixer updates', async ({ page }) => {
  test.skip(!existsSync(resolve('public/models/vuena-owl.glb')), 'Local original model not provided');
  await page.goto('/');
  await expect(page.locator('#avatar')).toHaveAttribute('data-character', 'vuena');
  const result = await page.evaluate(async () => {
    const path = '/tests/e2e/vuena-harness.ts';
    return (await import(/* @vite-ignore */ path)).inspect();
  });
  expect(result.capabilities).toMatchObject({ idleAnimation: true, mouthMovement: true, blink: true, gaze: false });
  expect(result.angle).toBeGreaterThan(0.54);
  expect(result.angle).toBeLessThan(0.56);
  expect(result.maxError).toBeLessThan(0.0001);
  expect(result.blinkDistance).toBeGreaterThan(0.001);
  expect(result.idleHeadDrift).toBeLessThan(0.0001);
});

test('idle head is settled, state gestures are distinct, and timing is frame-rate independent', async ({ page }) => {
  const result = await import('./vuena-harness').then(module => module.inspectSyntheticIdleMotion());
  expect(result.headDrift).toBeLessThan(0.0001);
  expect(result.bodyMoved).toBe(true);
  expect(Math.abs(result.idleTilt)).toBeLessThan(0.001);
  expect(result.listeningTilt).toBeLessThan(-0.02);
  expect(result.thinkingTilt).toBeGreaterThan(0.03);
  expect(result.speakingTilt).toBeGreaterThan(0.01);
  expect(result.returnedIdleTilt).toBeLessThan(0.005);
  expect(Math.abs(result.tilt30fps - result.tilt60fps)).toBeLessThan(0.0001);
});

test('missing model leaves chat usable', async ({ page }) => {
  await page.route('**/models/vuena-owl.glb', route => route.abort());
  await page.goto('/');
  await expect(page.locator('#model-fallback')).toBeVisible();
  await page.locator('#message').fill('Test');
  await page.locator('#send').click();
  await expect(page.locator('#messages')).toContainText('Mock-Antwort');
});
