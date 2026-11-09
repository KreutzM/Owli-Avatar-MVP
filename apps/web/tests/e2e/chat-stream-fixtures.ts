import { test as base, expect, type Page, type Route } from '@playwright/test';

export async function fulfillChatStream(
  route: Route,
  result: { reply: string; session_id: string; mode: 'mock' | 'ollama' },
): Promise<void> {
  const events = [
    { type: 'start', session_id: result.session_id, mode: result.mode },
    ...Array.from({ length: Math.ceil(result.reply.length / 12) }, (_, index) => ({
      type: 'delta', text: result.reply.slice(index * 12, index * 12 + 12),
    })),
    { type: 'done', ...result },
  ];
  await route.fulfill({ status: 200, contentType: 'application/x-ndjson', body: events.map(event => JSON.stringify(event)).join('\n') + '\n' });
}

export const test = base.extend<{ page: Page }>({
  page: async ({ page }, use) => {
    await page.route('**/api/**', async route => {
      const url = new URL(route.request().url());
      if (url.pathname === '/api/health') return route.fulfill({ json: { status: 'ok', mode: 'mock' } });
      if (url.pathname === '/api/stt/status') return route.fulfill({ json: { enabled: false } });
      if (url.pathname === '/api/tts/status') return route.fulfill({ json: { enabled: false } });
      if (url.pathname === '/api/chat/stream') {
        const payload = route.request().postDataJSON() as { message?: string };
        return fulfillChatStream(route, { reply: `Mock-Antwort: Du hast gefragt: ${(payload.message ?? '').trim()}`, session_id: 'fixture-session', mode: 'mock' });
      }
      if (url.pathname === '/api/diagnostics') return route.fulfill({ status: 204, body: '' });
      return route.fulfill({ status: 501, json: { error: { code: 'NOT_IMPLEMENTED', message: 'Mock fixture' } } });
    });
    await use(page);
  },
});

export { expect };
export type { Page };
