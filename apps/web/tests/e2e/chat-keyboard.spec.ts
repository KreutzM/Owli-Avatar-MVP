import { test, expect, fulfillChatStream } from './chat-stream-fixtures';

test.beforeEach(async ({ page }) => {
  await page.route('**/api/health', route => route.fulfill({ json: { status: 'ok', mode: 'mock' } }));
});

test('Enter submits once and returns focus to the message field', async ({ page }) => {
  const requests: string[] = [];
  await page.route('**/api/chat/stream', async route => {
    requests.push(route.request().postDataJSON().message);
    await fulfillChatStream(route, { reply: 'Antwort', session_id: 'keyboard-session', mode: 'mock' });
  });
  await page.goto('/');
  const message = page.locator('#message');
  await expect(message).toHaveAttribute('aria-describedby', 'message-help');
  await expect(page.locator('#message-help')).toHaveText('Enter: Senden · Shift+Enter: Zeilenumbruch');
  await message.fill('Mit Enter senden');
  await message.press('Enter');
  await expect(page.locator('#messages')).toContainText('Eule (Mock): Antwort');
  await expect(message).toBeFocused();
  expect(requests).toEqual(['Mit Enter senden']);
});

test('Shift+Enter inserts a newline; a later Enter submits the full message', async ({ page }) => {
  let submitted = '';
  await page.route('**/api/chat/stream', async route => {
    submitted = route.request().postDataJSON().message;
    await fulfillChatStream(route, { reply: 'Antwort', session_id: 'keyboard-session', mode: 'mock' });
  });
  await page.goto('/');
  const message = page.locator('#message');
  await message.fill('Erste Zeile');
  await message.press('Shift+Enter');
  await message.type('Zweite Zeile');
  await expect(message).toHaveValue('Erste Zeile\nZweite Zeile');
  await message.press('Enter');
  await expect(page.locator('#messages')).toContainText('Eule (Mock): Antwort');
  expect(submitted).toBe('Erste Zeile\nZweite Zeile');
});

test('IME composition Enter and keyCode 229 do not submit', async ({ page }) => {
  let requests = 0;
  await page.route('**/api/chat/stream', async route => {
    requests += 1;
    await fulfillChatStream(route, { reply: 'Antwort', session_id: 'keyboard-session', mode: 'mock' });
  });
  await page.goto('/');
  const message = page.locator('#message');
  await message.fill('Komposition');
  await message.dispatchEvent('keydown', { key: 'Enter', isComposing: true });
  await message.dispatchEvent('keydown', { key: 'Enter', keyCode: 229 });
  await expect(page.locator('#messages')).toBeEmpty();
  expect(requests).toBe(0);
});

test('blank input does not submit and Shift+Enter on whitespace stays local', async ({ page }) => {
  let requests = 0;
  await page.route('**/api/chat/stream', async route => {
    requests += 1;
    await fulfillChatStream(route, { reply: 'Antwort', session_id: 'keyboard-session', mode: 'mock' });
  });
  await page.goto('/');
  const message = page.locator('#message');
  await message.press('Enter');
  await message.fill('   ');
  await message.press('Shift+Enter');
  await message.press('Enter');
  await expect(page.locator('#messages')).toBeEmpty();
  expect(requests).toBe(0);
});

test('in-flight and autorepeat Enter cannot duplicate a request; button still submits', async ({ page }) => {
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const requests: string[] = [];
  await page.route('**/api/chat/stream', async route => {
    requests.push(route.request().postDataJSON().message);
    await gate;
    await fulfillChatStream(route, { reply: 'Antwort', session_id: 'keyboard-session', mode: 'mock' });
  });
  await page.goto('/');
  const message = page.locator('#message');
  await message.fill('Einmal');
  await message.press('Enter');
  await expect(page.locator('#send')).toBeDisabled();
  await message.dispatchEvent('keydown', { key: 'Enter', repeat: true });
  await message.dispatchEvent('keydown', { key: 'Enter' });
  expect(requests).toEqual(['Einmal']);
  release();
  await expect(page.locator('#messages')).toContainText('Eule (Mock): Antwort');

  await message.fill('Per Button');
  await page.locator('#send').click();
  await expect(page.locator('#messages')).toContainText('Du: Per Button');
  expect(requests).toEqual(['Einmal', 'Per Button']);
});
