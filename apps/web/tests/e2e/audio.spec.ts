import { test, expect, fulfillChatStream, type Page } from './chat-stream-fixtures';

test.use({ video: 'on' });

// Original generated PCM: silence, 440 Hz tone, silence; contains no voice asset.
function wavFixture(duration = 4): Buffer {
  const rate = 16000, frames = rate * duration;
  const data = Buffer.alloc(44 + frames * 2);
  data.write('RIFF', 0); data.writeUInt32LE(data.length - 8, 4); data.write('WAVEfmt ', 8);
  data.writeUInt32LE(16, 16); data.writeUInt16LE(1, 20); data.writeUInt16LE(1, 22);
  data.writeUInt32LE(rate, 24); data.writeUInt32LE(rate * 2, 28); data.writeUInt16LE(2, 32); data.writeUInt16LE(16, 34);
  data.write('data', 36); data.writeUInt32LE(frames * 2, 40);
  for (let i = Math.floor(rate * duration * 0.1); i < Math.floor(rate * duration * 0.8); i++) data.writeInt16LE(Math.round(26000 * Math.sin(2 * Math.PI * 440 * i / rate)), 44 + i * 2);
  return data;
}
async function enable(page: Page) {
  await page.route('**/api/tts/status', route => route.fulfill({ json: { enabled: true } }));
  await page.goto('/');
  await expect(page.locator('#speech-enabled')).toBeEnabled();
  await page.locator('#speech-enabled').check();
}
async function send(page: Page) {
  await page.locator('#message').fill('Audiotest');
  await page.locator('#send').click();
}
async function blockUnmockedApi(page: Page) {
  // Registered before per-test routes; any unexpected API fetch is answered locally,
  // so these tests can never fall through the Vite proxy to another service.
  await page.route('**/api/**', route => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/chat/stream') return fulfillChatStream(route, { reply: 'Mock-Antwort für den Audiotest.', mode: 'mock', session_id: 'test-session' });
    if (path === '/api/tts/status') return route.fulfill({ json: { enabled: true } });
    if (path === '/api/health') return route.fulfill({ json: { mode: 'mock' } });
    if (path === '/api/stt/status') return route.fulfill({ json: { enabled: false } });
    return route.fulfill({ status: 501, contentType: 'application/json', body: '{"error":"unmocked test API route"}' });
  });
}

test('playback follows silence, audible tone and returns to idle', async ({ page }, testInfo) => {
  await blockUnmockedApi(page);
  await page.route('**/api/tts', route => route.fulfill({ status: 200, contentType: 'audio/wav', body: wavFixture() }));
  await enable(page);
  await send(page);
  await expect(page.locator('#state')).toContainText('speaking');
  await expect.poll(async () => Number(await page.locator('#avatar').getAttribute('data-mouth'))).toBeLessThan(0.01);
  await expect.poll(async () => Number(await page.locator('#avatar').getAttribute('data-mouth')), { timeout: 3000 }).toBeGreaterThan(0.1);
  await page.screenshot({ path: testInfo.outputPath('tone.png') });
  await expect(page.locator('#state')).toContainText('idle', { timeout: 6000 });
  await expect.poll(async () => Number(await page.locator('#avatar').getAttribute('data-mouth'))).toBe(0);
});

test('stop closes jaw and cancels playback', async ({ page }) => {
  await blockUnmockedApi(page);
  await page.route('**/api/tts', route => route.fulfill({ contentType: 'audio/wav', body: wavFixture() }));
  await enable(page); await send(page);
  await expect.poll(async () => Number(await page.locator('#avatar').getAttribute('data-mouth')), { timeout: 4000 }).toBeGreaterThan(0.1);
  await page.locator('#stop-audio').click();
  await expect(page.locator('#state')).toContainText('idle');
  await expect.poll(async () => Number(await page.locator('#avatar').getAttribute('data-mouth'))).toBe(0);
});

test('TTS error retains text and releases the chat', async ({ page }) => {
  await blockUnmockedApi(page);
  await page.route('**/api/tts', route => route.fulfill({ status: 503, body: 'unavailable' }));
  await enable(page); await send(page);
  await expect(page.locator('#messages')).toContainText('Mock-Antwort');
  await expect(page.locator('#notice')).toContainText('Sprachausgabe');
  await expect(page.locator('#state')).toContainText('idle');
  await expect(page.locator('#send')).toBeEnabled();
});

test('muting silences the analyser and closes the jaw', async ({ page }) => {
  await blockUnmockedApi(page);
  await page.route('**/api/tts', route => route.fulfill({ contentType: 'audio/wav', body: wavFixture() }));
  await enable(page); await send(page);
  await expect.poll(async () => Number(await page.locator('#avatar').getAttribute('data-mouth')), { timeout: 4000 }).toBeGreaterThan(0.1);
  await page.locator('#volume').fill('0');
  await expect.poll(async () => Number(await page.locator('#avatar').getAttribute('data-mouth')), { timeout: 3000 }).toBeLessThan(0.02);
});

test('stop during synthesis prevents a late response from playing', async ({ page }) => {
  await blockUnmockedApi(page);
  await page.route('**/api/tts', async route => {
    await new Promise(resolve => setTimeout(resolve, 1200));
    await route.fulfill({ contentType: 'audio/wav', body: wavFixture() }).catch(() => undefined);
  });
  await enable(page); await send(page);
  await expect(page.locator('#speech-status')).toContainText('erzeugt');
  await page.locator('#stop-audio').click();
  await page.waitForTimeout(1500);
  await expect(page.locator('#state')).toContainText('idle');
  await expect.poll(async () => Number(await page.locator('#avatar').getAttribute('data-mouth'))).toBe(0);
  await expect(page.locator('#send')).toBeEnabled();
});

test('long speech is split at sentence boundaries and all chunks play in order', async ({ page }) => {
  const reply = ['Erster Abschnitt ' + 'eins '.repeat(58) + '.', 'Zweiter Abschnitt ' + 'zwei '.repeat(58) + '.', 'Dritter Abschnitt ' + 'drei '.repeat(58) + '.'].join(' ');
  const spoken: string[] = [];
  await blockUnmockedApi(page);
  await page.route('**/api/chat/stream', route => fulfillChatStream(route, { reply, mode: 'mock', session_id: 'test-session' }));
  await page.route('**/api/tts/status', route => route.fulfill({ json: { enabled: true } }));
  await page.route('**/api/tts', async route => {
    spoken.push((route.request().postDataJSON() as { text: string }).text);
    await route.fulfill({ contentType: 'audio/wav', body: wavFixture(0.3) });
  });
  await page.goto('/');
  await page.locator('#speech-enabled').check();
  await page.locator('#message').fill('Lange Antwort');
  await page.locator('#send').click();
  await expect(page.locator('#speech-status')).toContainText('Wiedergabe beendet.', { timeout: 10000 });
  expect(spoken.length).toBeGreaterThan(1);
  expect(spoken.every(chunk => chunk.length <= 350)).toBe(true);
  expect(spoken.join('')).toBe(reply);
  await expect(page.locator('#messages')).toContainText(reply);
  await expect(page.locator('#state')).toContainText('idle');
});

test('a later TTS failure reports partial playback and closes the jaw', async ({ page }) => {
  const reply = 'Erster vollständiger Satz ' + 'eins '.repeat(58) + '. Zweiter Satz ' + 'zwei '.repeat(58) + '.';
  let requests = 0;
  await blockUnmockedApi(page);
  await page.route('**/api/chat/stream', route => fulfillChatStream(route, { reply, mode: 'mock', session_id: 'test-session' }));
  await page.route('**/api/tts/status', route => route.fulfill({ json: { enabled: true } }));
  await page.route('**/api/tts', route => {
    requests++;
    return requests === 1
      ? route.fulfill({ contentType: 'audio/wav', body: wavFixture(0.3) })
      : route.fulfill({ status: 503, json: { error: { code: 'TTS_BUSY' } } });
  });
  await page.goto('/');
  await page.locator('#speech-enabled').check();
  await page.locator('#message').fill('Lange Antwort mit Teilfehler');
  await page.locator('#send').click();
  await expect(page.locator('#speech-status')).toContainText('teilweise fehlgeschlagen', { timeout: 10000 });
  await expect(page.locator('#notice')).toContainText('Textantwort bleibt erhalten.');
  await expect(page.locator('#messages')).toContainText(reply);
  await expect(page.locator('#state')).toContainText('idle');
  await expect(page.locator('#retry-speech')).toBeEnabled();
  expect(requests).toBe(2);
  await expect.poll(async () => Number(await page.locator('#avatar').getAttribute('data-mouth'))).toBe(0);
});

test('segmentation preserves leading punctuation, repeated spaces and Unicode code points', async ({ page }) => {
  const reply = '...?!   Grüße 👩🏽‍🚀 — ' + '界😀 '.repeat(100) + '??? End.“  ';
  const spoken: string[] = [];
  await blockUnmockedApi(page);
  await page.route('**/api/chat/stream', route => fulfillChatStream(route, { reply, mode: 'mock', session_id: 'test-session' }));
  await page.route('**/api/tts/status', route => route.fulfill({ json: { enabled: true } }));
  await page.route('**/api/tts', async route => {
    spoken.push((route.request().postDataJSON() as { text: string }).text);
    await route.fulfill({ contentType: 'audio/wav', body: wavFixture(0.08) });
  });
  await page.goto('/');
  await page.locator('#speech-enabled').check();
  await page.locator('#message').fill('Unicode segmentation');
  await page.locator('#send').click();
  await expect(page.locator('#speech-status')).toContainText('Wiedergabe beendet.', { timeout: 10000 });
  expect(spoken.join('')).toBe(reply);
  expect(spoken.every(chunk => Array.from(chunk).length <= 350)).toBe(true);
  expect(spoken[0].startsWith('...?!   Grüße 👩🏽‍🚀')).toBe(true);
});

test('retry resumes only at the failed chunk and continues in order', async ({ page }) => {
  const chunks = [
    'Erster Abschnitt ' + 'eins '.repeat(58) + '.',
    'Zweiter Abschnitt ' + 'zwei '.repeat(58) + '.',
    'Dritter Abschnitt ' + 'drei '.repeat(58) + '.',
  ];
  const reply = chunks.join(' ');
  const requested: string[] = [];
  await blockUnmockedApi(page);
  await page.route('**/api/chat/stream', route => fulfillChatStream(route, { reply, mode: 'mock', session_id: 'test-session' }));
  await page.route('**/api/tts/status', route => route.fulfill({ json: { enabled: true } }));
  await page.route('**/api/tts', async route => {
    const text = (route.request().postDataJSON() as { text: string }).text;
    requested.push(text);
    if (requested.length === 2) return route.fulfill({ status: 503, json: { error: { code: 'TTS_BUSY' } } });
    return route.fulfill({ contentType: 'audio/wav', body: wavFixture(0.08) });
  });
  await page.goto('/');
  await page.locator('#speech-enabled').check();
  await page.locator('#message').fill('Lange Antwort mit gezielter Wiederholung');
  await page.locator('#send').click();
  await expect(page.locator('#retry-speech')).toBeEnabled({ timeout: 10000 });
  await page.locator('#retry-speech').click();
  await expect(page.locator('#speech-status')).toContainText('Wiedergabe beendet.', { timeout: 10000 });
  expect(requested).toHaveLength(4);
  expect(requested[0].trim()).toBe(chunks[0]);
  expect(requested[1].trim()).toBe(chunks[1]);
  expect(requested[2]).toBe(requested[1]);
  expect(requested[3].trim()).toBe(chunks[2]);
  expect(requested[0] + requested[2] + requested[3]).toBe(reply);
  await expect(page.locator('#retry-speech')).toBeDisabled();
});
