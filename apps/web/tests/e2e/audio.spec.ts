import { test, expect, type Page } from '@playwright/test';

test.use({ video: 'on' });

// Original generated PCM: silence, 440 Hz tone, silence; contains no voice asset.
function wavFixture(): Buffer {
  const rate = 16000, duration = 4, frames = rate * duration;
  const data = Buffer.alloc(44 + frames * 2);
  data.write('RIFF', 0); data.writeUInt32LE(data.length - 8, 4); data.write('WAVEfmt ', 8);
  data.writeUInt32LE(16, 16); data.writeUInt16LE(1, 20); data.writeUInt16LE(1, 22);
  data.writeUInt32LE(rate, 24); data.writeUInt32LE(rate * 2, 28); data.writeUInt16LE(2, 32); data.writeUInt16LE(16, 34);
  data.write('data', 36); data.writeUInt32LE(frames * 2, 40);
  for (let i = rate; i < rate * 3; i++) data.writeInt16LE(Math.round(26000 * Math.sin(2 * Math.PI * 440 * i / rate)), 44 + i * 2);
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

test('playback follows silence, audible tone and returns to idle', async ({ page }, testInfo) => {
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
  await page.route('**/api/tts', route => route.fulfill({ contentType: 'audio/wav', body: wavFixture() }));
  await enable(page); await send(page);
  await expect.poll(async () => Number(await page.locator('#avatar').getAttribute('data-mouth')), { timeout: 4000 }).toBeGreaterThan(0.1);
  await page.locator('#stop-audio').click();
  await expect(page.locator('#state')).toContainText('idle');
  await expect.poll(async () => Number(await page.locator('#avatar').getAttribute('data-mouth'))).toBe(0);
});

test('TTS error retains text and releases the chat', async ({ page }) => {
  await page.route('**/api/tts', route => route.fulfill({ status: 503, body: 'unavailable' }));
  await enable(page); await send(page);
  await expect(page.locator('#messages')).toContainText('Mock-Antwort');
  await expect(page.locator('#notice')).toContainText('Sprachausgabe');
  await expect(page.locator('#state')).toContainText('idle');
  await expect(page.locator('#send')).toBeEnabled();
});

test('muting silences the analyser and closes the jaw', async ({ page }) => {
  await page.route('**/api/tts', route => route.fulfill({ contentType: 'audio/wav', body: wavFixture() }));
  await enable(page); await send(page);
  await expect.poll(async () => Number(await page.locator('#avatar').getAttribute('data-mouth')), { timeout: 4000 }).toBeGreaterThan(0.1);
  await page.locator('#volume').fill('0');
  await expect.poll(async () => Number(await page.locator('#avatar').getAttribute('data-mouth')), { timeout: 3000 }).toBeLessThan(0.02);
});

test('stop during synthesis prevents a late response from playing', async ({ page }) => {
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
