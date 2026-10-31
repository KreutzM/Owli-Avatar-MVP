import { test, expect } from '@playwright/test';

test('canvas renders and mock chat replies', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#avatar canvas')).toBeVisible();
  await page.locator('#message').fill('Hallo!');
  await page.locator('#send').click();
  await expect(page.locator('#messages')).toContainText('Mock-Antwort: Du hast gefragt: Hallo!');
  await expect(page.locator('#state')).toContainText('idle');
});

test('WebGL absence does not break chat', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', { value: () => null });
  });
  await page.goto('/');
  await expect(page.locator('#webgl-fallback')).toBeVisible();
  await page.locator('#message').fill('Ohne WebGL');
  await page.locator('#send').click();
  await expect(page.locator('#messages')).toContainText('Mock-Antwort: Du hast gefragt: Ohne WebGL');
});

test('HTTP failures do not trap the user in thinking state', async ({ page }) => {
  await page.route('**/api/chat', route => route.fulfill({ status: 503, body: 'unavailable' }));
  await page.goto('/');
  await page.locator('#message').fill('Test 503');
  await page.locator('#send').click();
  await expect(page.locator('#notice')).toContainText('nicht erreichbar');
  await expect(page.locator('#state')).toContainText('idle');
  await expect(page.locator('#send')).toBeEnabled();
});

test('timed out API request allows retry', async ({ page }) => {
  await page.route('**/api/chat', () => new Promise<void>(() => {}));
  await page.goto('/');
  await page.locator('#message').fill('Langsame Antwort');
  await page.locator('#send').click();
  await expect(page.locator('#notice')).toContainText('nicht erreichbar', { timeout: 6_000 });
  await expect(page.locator('#send')).toBeEnabled();
});

test('loads the rigged owl, animates, and retains the mock chat', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  await expect(page.locator('#avatar')).toHaveAttribute('data-character', 'gobkit');
  await page.locator('#message').fill('Hallo Eule');
  await page.locator('#send').click();
  await expect(page.locator('#messages')).toContainText('Mock-Antwort: Du hast gefragt: Hallo Eule');
  await expect(page.locator('#state')).toContainText('idle');
  expect(errors).toEqual([]);
});

test('model load failure keeps the procedural owl and chat usable', async ({ page }) => {
  await page.route('**/models/gobkit-owl.glb', route => route.fulfill({ status: 404 }));
  const failedModel = page.waitForResponse(response => response.url().endsWith('/models/gobkit-owl.glb'));
  await page.goto('/');
  expect((await failedModel).status()).toBe(404);
  await expect(page.locator('#avatar')).toHaveAttribute('data-character', 'placeholder');
  await expect(page.locator('#avatar canvas')).toBeVisible();
  await page.locator('#message').fill('Fallback');
  await page.locator('#send').click();
  await expect(page.locator('#messages')).toContainText('Mock-Antwort: Du hast gefragt: Fallback');
});

test('mouth overlay remains independent of idle and missing capabilities degrade safely', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const path = '/tests/e2e/adapter-harness.ts';
    const harness = await import(/* @vite-ignore */ path);
    return harness.checkAdapter();
  });
  expect(result.caps).toMatchObject({ idleAnimation: true, mouthMovement: true, blink: false, gaze: false });
  expect(result.caps.clips).toContain('idle');
  expect(result.open.length).toBeGreaterThan(0);
  expect(result.open.every((value: number) => value === 1)).toBe(true);
  expect(result.closed.every((value: number) => value === 0)).toBe(true);
  expect(result.idleMoved).toBe(true);
  expect(result.tiltBeforeIdle).toBeGreaterThan(0.05);
  expect(result.tiltAfterState).toBe(result.tiltBeforeIdle);
  expect(Math.abs(result.tiltAtRest)).toBeLessThan(0.001);
  expect(result.emptyCaps).toEqual({ idleAnimation: false, mouthMovement: false, blink: false, gaze: false, clips: [] });
});
