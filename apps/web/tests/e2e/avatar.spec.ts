import { test, expect } from './chat-stream-fixtures';
import { fulfillChatStream } from './chat-stream-fixtures';

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
  await page.route('**/api/chat/stream', route => route.fulfill({ status: 503, body: 'unavailable' }));
  await page.goto('/');
  await page.locator('#message').fill('Test 503');
  await page.locator('#send').click();
  await expect(page.locator('#notice')).toContainText('nicht erreichbar');
  await expect(page.locator('#state')).toContainText('idle');
  await expect(page.locator('#send')).toBeEnabled();
});

test('timed out API request allows retry', async ({ page }) => {
  await page.route('**/api/chat/stream', () => new Promise<void>(() => {}));
  await page.goto('/');
  await page.locator('#message').fill('Langsame Antwort');
  await page.locator('#send').click();
  await expect(page.locator('#notice')).toContainText('nicht erreichbar', { timeout: 6_000 });
  await expect(page.locator('#send')).toBeEnabled();
});

test('Ollama mode continues the returned session across turns', async ({ page }) => {
  const requests: Array<{ message: string; session_id?: string }> = [];
  await page.route('**/api/chat/stream', async route => {
    const payload = route.request().postDataJSON() as { message: string; session_id?: string };
    requests.push(payload);
    await fulfillChatStream(route, { reply: `Ollama-Antwort: ${payload.message}`, session_id: 'ollama-session-1', mode: 'ollama' });
  });
  await page.goto('/');
  await page.locator('#message').fill('Erster Zug');
  await page.locator('#send').click();
  await expect(page.locator('#messages')).toContainText('Eule (Ollama): Ollama-Antwort: Erster Zug');
  await page.locator('#message').fill('Zweiter Zug');
  await page.locator('#send').click();
  await expect(page.locator('#messages')).toContainText('Eule (Ollama): Ollama-Antwort: Zweiter Zug');
  expect(requests).toEqual([
    { message: 'Erster Zug' },
    { message: 'Zweiter Zug', session_id: 'ollama-session-1' },
  ]);
  await expect(page.locator('#notice')).toContainText('ohne Ton');
});

test('API error can be retried successfully', async ({ page }) => {
  let attempts = 0;
  await page.route('**/api/chat/stream', async route => {
    attempts += 1;
    if (attempts === 1) return route.fulfill({ status: 503, body: 'unavailable' });
    return fulfillChatStream(route, { reply: 'Wieder da', session_id: 'retry-session', mode: 'mock' });
  });
  await page.goto('/');
  await page.locator('#message').fill('Retry');
  await page.locator('#send').click();
  await expect(page.locator('#notice')).toContainText('nicht erreichbar');
  await page.locator('#message').fill('Retry erneut');
  await page.locator('#send').click();
  await expect(page.locator('#messages')).toContainText('Wieder da');
  await expect(page.locator('#send')).toBeEnabled();
});

test('health identifies Ollama mode before chat', async ({ page }) => {
  await page.route('**/api/health', route => route.fulfill({ json: { status: 'ok', mode: 'ollama' } }));
  await page.goto('/');
  await expect(page.locator('#chat-mode')).toContainText('Ollama-Modus');
});
