import { test, expect } from './chat-stream-fixtures';

function wavFixture(duration = 1): Buffer {
  const rate = 16000, frames = rate * duration;
  const data = Buffer.alloc(44 + frames * 2);
  data.write('RIFF', 0); data.writeUInt32LE(data.length - 8, 4); data.write('WAVEfmt ', 8);
  data.writeUInt32LE(16, 16); data.writeUInt16LE(1, 20); data.writeUInt16LE(1, 22);
  data.writeUInt32LE(rate, 24); data.writeUInt32LE(rate * 2, 28); data.writeUInt16LE(2, 32); data.writeUInt16LE(16, 34);
  data.write('data', 36); data.writeUInt32LE(frames * 2, 40);
  for (let i = 0; i < frames; i++) data.writeInt16LE(Math.round(18000 * Math.sin(2 * Math.PI * 440 * i / rate)), 44 + i * 2);
  return data;
}

test('starts ordered TTS for a stable sentence before the LLM stream completes', async ({ page }) => {
  const spoken: string[] = [];
  await page.route('**/api/tts/status', route => route.fulfill({ json: { enabled: true } }));
  await page.route('**/api/tts', async route => {
    spoken.push((route.request().postDataJSON() as { text: string }).text);
    await route.fulfill({ contentType: 'audio/wav', body: wavFixture() });
  });
  await page.addInitScript(() => {
    const nativeFetch = window.fetch.bind(window);
    window.fetch = async (input, init) => {
      const url = typeof input === 'string' ? input : input instanceof Request ? input.url : String(input);
      if (new URL(url, location.href).pathname !== '/api/chat/stream') return nativeFetch(input, init);
      let release!: () => void;
      const gate = new Promise<void>(resolve => { release = resolve; });
      (window as Window & { __releaseChat?: () => void }).__releaseChat = release;
      const encoder = new TextEncoder();
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          for (const event of [
            { type: 'start', session_id: 'progressive-session', mode: 'mock' },
            { type: 'delta', text: 'Erster Satz. ' },
          ]) controller.enqueue(encoder.encode(JSON.stringify(event) + '\n'));
          void gate.then(() => {
            controller.enqueue(encoder.encode(JSON.stringify({ type: 'delta', text: 'Zweiter Satz.' }) + '\n'));
            controller.enqueue(encoder.encode(JSON.stringify({ type: 'done', reply: 'Erster Satz. Zweiter Satz.', session_id: 'progressive-session', mode: 'mock' }) + '\n'));
            controller.close();
          });
        },
      });
      return new Response(body, { headers: { 'Content-Type': 'application/x-ndjson' } });
    };
  });
  await page.goto('/');
  await page.locator('#speech-enabled').check();
  await page.locator('#message').fill('Bitte sprechen');
  await page.locator('#send').click();
  await expect.poll(() => spoken.length).toBe(1);
  await expect(page.locator('#speech-status')).toContainText('Wiedergabe läuft');
  await expect(page.locator('#messages')).not.toContainText('Zweiter Satz');
  expect(spoken).toEqual(['Erster Satz. ']);
  const elapsed = await page.evaluate(() => Object.fromEntries(
    performance.getEntriesByType('measure').filter(entry => entry.name.startsWith('owli:')).map(entry => [entry.name, entry.duration]),
  ));
  expect(elapsed['owli:first-llm-token-ms']).toBeGreaterThanOrEqual(0);
  expect(elapsed['owli:first-stable-sentence-ms']).toBeGreaterThanOrEqual(elapsed['owli:first-llm-token-ms']);
  expect(elapsed['owli:first-tts-request-ms']).toBeGreaterThanOrEqual(elapsed['owli:first-stable-sentence-ms']);
  expect(elapsed['owli:first-audio-source-ms']).toBeGreaterThanOrEqual(elapsed['owli:first-tts-request-ms']);
  await page.evaluate(() => (window as Window & { __releaseChat?: () => void }).__releaseChat?.());
  await expect(page.locator('#speech-status')).toContainText('Wiedergabe beendet.', { timeout: 10000 });
  expect(spoken).toEqual(['Erster Satz. ', 'Zweiter Satz.']);
  await expect(page.locator('#messages')).toContainText('Eule (Mock): Erster Satz. Zweiter Satz.');
});

test('Stop cancels a progressive playback and prevents queued speech', async ({ page }) => {
  const spoken: string[] = [];
  await page.route('**/api/tts/status', route => route.fulfill({ json: { enabled: true } }));
  await page.route('**/api/tts', async route => {
    spoken.push((route.request().postDataJSON() as { text: string }).text);
    await route.fulfill({ contentType: 'audio/wav', body: wavFixture(4) });
  });
  await page.addInitScript(() => {
    const nativeFetch = window.fetch.bind(window);
    window.fetch = async (input, init) => {
      const url = typeof input === 'string' ? input : input instanceof Request ? input.url : String(input);
      if (new URL(url, location.href).pathname !== '/api/chat/stream') return nativeFetch(input, init);
      const encoder = new TextEncoder();
      return new Response(new ReadableStream<Uint8Array>({
        start(controller) {
          for (const event of [
            { type: 'start', session_id: 'cancel-session', mode: 'mock' },
            { type: 'delta', text: 'First sentence. ' },
            { type: 'delta', text: 'Second sentence. ' },
            { type: 'delta', text: 'Third sentence.' },
            { type: 'delta', text: ' Fourth sentence.' },
          ]) controller.enqueue(encoder.encode(JSON.stringify(event) + '\n'));
          controller.enqueue(encoder.encode(JSON.stringify({ type: 'done', reply: 'First sentence. Second sentence. Third sentence. Fourth sentence.', session_id: 'cancel-session', mode: 'mock' }) + '\n'));
          controller.close();
        },
      }), { headers: { 'Content-Type': 'application/x-ndjson' } });
    };
  });
  await page.goto('/');
  await page.locator('#speech-enabled').check();
  await page.locator('#message').fill('Bitte abbrechen');
  await page.locator('#send').click();
  await expect.poll(() => spoken.length).toBeGreaterThan(0);
  await expect(page.locator('#state')).toContainText('speaking');
  await page.locator('#stop-audio').click();
  await expect(page.locator('#state')).toContainText('idle');
  await page.waitForTimeout(250);
  expect(spoken).toEqual(['First sentence. ']);
});

test('bounded audio backpressure pauses the chat timeout and drains every segment in order', async ({ page }) => {
  const spoken: string[] = [];
  await page.route('**/api/tts/status', route => route.fulfill({ json: { enabled: true } }));
  await page.route('**/api/tts', async route => {
    spoken.push((route.request().postDataJSON() as { text: string }).text);
    await route.fulfill({ contentType: 'audio/wav', body: wavFixture(1) });
  });
  await page.addInitScript(() => {
    const nativeFetch = window.fetch.bind(window);
    window.fetch = async (input, init) => {
      const url = typeof input === 'string' ? input : input instanceof Request ? input.url : String(input);
      if (new URL(url, location.href).pathname !== '/api/chat/stream') return nativeFetch(input, init);
      const events = [
        { type: 'start', session_id: 'backpressure-session', mode: 'mock' },
        { type: 'delta', text: 'One. ' }, { type: 'delta', text: 'Two. ' },
        { type: 'delta', text: 'Three. ' }, { type: 'delta', text: 'Four.' },
        { type: 'done', reply: 'One. Two. Three. Four.', session_id: 'backpressure-session', mode: 'mock' },
      ];
      const encoder = new TextEncoder();
      return new Response(new ReadableStream<Uint8Array>({
        start(controller) { for (const event of events) controller.enqueue(encoder.encode(JSON.stringify(event) + '\n')); controller.close(); },
      }), { headers: { 'Content-Type': 'application/x-ndjson' } });
    };
  });
  await page.goto('/');
  await page.locator('#speech-enabled').check();
  await page.locator('#message').fill('Vier Segmente');
  await page.locator('#send').click();
  await expect(page.locator('#messages')).toContainText('Eule (Mock): One. Two. Three. Four.');
  await expect(page.locator('#speech-status')).toContainText('Wiedergabe beendet.', { timeout: 10000 });
  expect(spoken).toEqual(['One. ', 'Two. ', 'Three. ', 'Four.']);
});
