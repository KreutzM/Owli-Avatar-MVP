import { test, expect, fulfillChatStream } from './chat-stream-fixtures';

function wavFixture(duration = 0.25): Buffer {
  const rate = 16_000, frames = Math.floor(rate * duration);
  const data = Buffer.alloc(44 + frames * 2);
  data.write('RIFF', 0); data.writeUInt32LE(data.length - 8, 4); data.write('WAVEfmt ', 8);
  data.writeUInt32LE(16, 16); data.writeUInt16LE(1, 20); data.writeUInt16LE(1, 22);
  data.writeUInt32LE(rate, 24); data.writeUInt32LE(rate * 2, 28); data.writeUInt16LE(2, 32); data.writeUInt16LE(16, 34);
  data.write('data', 36); data.writeUInt32LE(frames * 2, 40);
  for (let i = 0; i < frames; i++) data.writeInt16LE(Math.round(12_000 * Math.sin(2 * Math.PI * 440 * i / rate)), 44 + i * 2);
  return data;
}

async function enableSpeech(page: import('@playwright/test').Page): Promise<void> {
  await page.route('**/api/tts/status', route => route.fulfill({ json: { enabled: true } }));
  await page.goto('/');
  await expect(page.locator('#speech-enabled')).toBeEnabled();
  await page.locator('#speech-enabled').check();
}

test('short completed speech can replay without another chat or TTS request', async ({ page }) => {
  let chats = 0;
  const spoken: string[] = [];
  await page.route('**/api/chat/stream', route => {
    chats++;
    return fulfillChatStream(route, { reply: 'Kurze Antwort.', session_id: 'replay-session', mode: 'mock' });
  });
  await page.route('**/api/tts', route => {
    spoken.push((route.request().postDataJSON() as { text: string }).text);
    return route.fulfill({ contentType: 'audio/wav', body: wavFixture() });
  });
  await enableSpeech(page);
  await expect(page.locator('#replay-audio')).toBeDisabled();
  await page.locator('#message').fill('Frage');
  await page.locator('#send').click();
  await expect(page.locator('#speech-status')).toContainText('Wiedergabe beendet.');
  await expect(page.locator('#replay-audio')).toBeEnabled();
  await page.locator('#replay-audio').click();
  await expect(page.locator('#speech-status')).toContainText('Wiedergabe beendet.');
  expect(chats).toBe(1);
  expect(spoken).toEqual(['Kurze Antwort.']);
  await page.reload();
  await expect(page.locator('#replay-audio')).toBeDisabled();
});

test('long completed segmented speech replays every cached segment in order', async ({ page }) => {
  const reply = ['Erster Satz ' + 'eins '.repeat(70) + '.', 'Zweiter Satz ' + 'zwei '.repeat(70) + '.', 'Dritter Satz ' + 'drei '.repeat(70) + '.'].join(' ');
  const spoken: string[] = [];
  let chats = 0;
  await page.route('**/api/chat/stream', route => {
    chats++;
    return fulfillChatStream(route, { reply, session_id: 'replay-session', mode: 'mock' });
  });
  await page.route('**/api/tts', route => {
    spoken.push((route.request().postDataJSON() as { text: string }).text);
    return route.fulfill({ contentType: 'audio/wav', body: wavFixture(0.08) });
  });
  await enableSpeech(page);
  await page.locator('#message').fill('Lange Frage');
  await page.locator('#send').click();
  await expect(page.locator('#speech-status')).toContainText('Wiedergabe beendet.');
  await expect(page.locator('#replay-audio')).toBeEnabled();
  const initialSegments = [...spoken];
  expect(initialSegments.length).toBeGreaterThan(1);
  expect(initialSegments.join('')).toBe(reply);
  expect(initialSegments.every(segment => segment.length <= 350)).toBe(true);
  await page.locator('#replay-audio').click();
  await expect(page.locator('#speech-status')).toContainText('Wiedergabe beendet.');
  expect(chats).toBe(1);
  expect(spoken).toEqual(initialSegments);
});

test('stop cancels replay and a new request disables replay while it is in flight', async ({ page }) => {
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  let chats = 0;
  let ttsRequests = 0;
  await page.route('**/api/chat/stream', async route => {
    chats++;
    if (chats > 1) await gate;
    await fulfillChatStream(route, { reply: chats === 1 ? 'Gespeicherte Antwort.' : 'Neue Antwort.', session_id: 'replay-session', mode: 'mock' });
  });
  await page.route('**/api/tts', route => {
    ttsRequests++;
    return route.fulfill({ contentType: 'audio/wav', body: wavFixture(1) });
  });
  await enableSpeech(page);
  await page.locator('#message').fill('Erste Frage');
  await page.locator('#send').click();
  await expect(page.locator('#speech-status')).toContainText('Wiedergabe beendet.');
  await page.locator('#replay-audio').click();
  await expect(page.locator('#state')).toContainText('speaking');
  await page.locator('#stop-audio').click();
  await expect(page.locator('#state')).toContainText('idle');
  await page.waitForTimeout(1100);
  await expect(page.locator('#state')).toContainText('idle');
  expect(ttsRequests).toBe(1);

  await page.locator('#message').fill('Zweite Frage');
  await page.locator('#send').click();
  await expect(page.locator('#replay-audio')).toBeDisabled();
  release();
});

test('a new chat stops replay before its own response can speak', async ({ page }) => {
  let chats = 0;
  let releaseNewChat!: () => void;
  const gate = new Promise<void>(resolve => { releaseNewChat = resolve; });
  const ttsTexts: string[] = [];
  await page.route('**/api/chat/stream', async route => {
    chats++;
    if (chats === 1) {
      await fulfillChatStream(route, { reply: 'Erste Antwort.', session_id: 'replay-session', mode: 'mock' });
      return;
    }
    await gate;
    await fulfillChatStream(route, { reply: 'Zweite Antwort.', session_id: 'replay-session', mode: 'mock' });
  });
  await page.route('**/api/tts', route => {
    const text = (route.request().postDataJSON() as { text: string }).text;
    ttsTexts.push(text);
    return route.fulfill({ contentType: 'audio/wav', body: wavFixture(text.startsWith('Erste') ? 1 : 0.08) });
  });
  await enableSpeech(page);
  await page.locator('#message').fill('Erste Frage');
  await page.locator('#send').click();
  await expect(page.locator('#speech-status')).toContainText('Wiedergabe beendet.');
  await page.locator('#replay-audio').click();
  await expect(page.locator('#state')).toContainText('speaking');
  await page.locator('#message').fill('Zweite Frage');
  await page.locator('#send').click();
  await expect(page.locator('#replay-audio')).toBeDisabled();
  await expect(page.locator('#state')).toContainText('thinking');
  await page.waitForTimeout(500);
  await expect(page.locator('#state')).toContainText('thinking');
  releaseNewChat();
  await expect(page.locator('#speech-status')).toContainText('Wiedergabe beendet.', { timeout: 5000 });
  expect(chats).toBe(2);
  expect(ttsTexts).toEqual(['Erste Antwort.', 'Zweite Antwort.']);
});
