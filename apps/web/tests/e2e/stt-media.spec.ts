import { test, expect } from './chat-stream-fixtures';

test.use({ launchOptions: { args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] } });

test('Chromium MediaRecorder supplies a real WebM upload without physical microphone', async ({page}) => {
  let audio: Buffer | undefined;
  await page.route('**/api/stt/status', r => r.fulfill({json:{enabled:true}}));
  await page.route('**/api/stt', r => {
    audio = r.request().postDataBuffer() ?? undefined;
    return r.fulfill({json:{text:'Testaufnahme'}});
  });
  await page.goto('/'); await expect(page.locator('#ptt')).toBeEnabled();
  await page.click('#ptt'); await expect(page.locator('#state')).toContainText('listening');
  await page.waitForTimeout(500); await page.click('#ptt');
  await expect(page.locator('#message')).toHaveValue('Testaufnahme');
  expect(audio?.subarray(0,4).toString('hex')).toBe('1a45dfa3');
  expect(audio?.length).toBeGreaterThan(100);
});
