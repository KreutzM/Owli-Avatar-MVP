import { test, expect } from './chat-stream-fixtures';

test('renders streamed text before completion and accepts the final reply', async ({ page }) => {
  await page.addInitScript(() => {
    const nativeFetch = window.fetch.bind(window);
    window.fetch = async (input, init) => {
      const target = typeof input === 'string' ? input : input instanceof Request ? input.url : String(input);
      if (new URL(target, location.href).pathname !== '/api/chat/stream') return nativeFetch(input, init);
      let release!: () => void;
      const wait = new Promise<void>(resolve => { release = resolve; });
      (window as Window & { __releaseChat?: () => void }).__releaseChat = release;
      const encoder = new TextEncoder();
      const events = [
        { type: 'start', session_id: 'slow-session', mode: 'mock' },
        { type: 'delta', text: 'Früher Text' },
      ];
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          for (const event of events) controller.enqueue(encoder.encode(JSON.stringify(event) + '\n'));
          void wait.then(() => {
            controller.enqueue(encoder.encode(JSON.stringify({ type: 'delta', text: ' und Schluss' }) + '\n'));
            controller.enqueue(encoder.encode(JSON.stringify({ type: 'done', reply: 'Früher Text und Schluss', session_id: 'slow-session', mode: 'mock' }) + '\n'));
            controller.close();
          });
        },
      });
      return new Response(body, { headers: { 'Content-Type': 'application/x-ndjson' } });
    };
  });
  await page.goto('/');
  await page.locator('#message').fill('Streamtest');
  await page.locator('#send').click();
  await expect(page.locator('#messages')).toContainText('Eule (Mock): Früher Text');
  await expect(page.locator('#messages')).not.toContainText('und Schluss');
  await page.evaluate(() => (window as Window & { __releaseChat?: () => void }).__releaseChat?.());
  await expect(page.locator('#messages')).toContainText('Eule (Mock): Früher Text und Schluss');
  await expect(page.locator('#messages [data-status="incomplete"]')).toHaveCount(0);
});

test('marks partial text when a stream fails before completion', async ({ page }) => {
  await page.addInitScript(() => {
    const nativeFetch = window.fetch.bind(window);
    window.fetch = async (input, init) => {
      const target = typeof input === 'string' ? input : input instanceof Request ? input.url : String(input);
      if (new URL(target, location.href).pathname !== '/api/chat/stream') return nativeFetch(input, init);
      const encoder = new TextEncoder();
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          for (const event of [
            { type: 'start', session_id: 'failed-session', mode: 'mock' },
            { type: 'delta', text: 'Nur teilweise' },
            { type: 'error', error: { code: 'PROVIDER_TIMEOUT', message: 'timeout' } },
          ]) controller.enqueue(encoder.encode(JSON.stringify(event) + '\n'));
          controller.close();
        },
      });
      return new Response(body, { headers: { 'Content-Type': 'application/x-ndjson' } });
    };
  });
  await page.goto('/');
  await page.locator('#message').fill('Fehlerstream');
  await page.locator('#send').click();
  const partial = page.locator('#messages [data-status="incomplete"]');
  await expect(partial).toContainText('Nur teilweise');
  await expect(partial).toContainText('unvollständig, nicht gespeichert');
  await expect(page.locator('#notice')).toContainText('Chat-API');
});
