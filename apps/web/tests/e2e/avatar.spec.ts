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
