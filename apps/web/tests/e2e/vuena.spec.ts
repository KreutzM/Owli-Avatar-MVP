import { test, expect } from '@playwright/test';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

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
});

test('missing model leaves chat usable', async ({ page }) => {
  await page.route('**/models/vuena-owl.glb', route => route.abort());
  await page.goto('/');
  await expect(page.locator('#model-fallback')).toBeVisible();
  await page.locator('#message').fill('Test');
  await page.locator('#send').click();
  await expect(page.locator('#messages')).toContainText('Mock-Antwort');
});
