import { test, expect, type Page } from '@playwright/test';

async function configure(page: Page, mode: 'ok'|'denied'|'insecure'|'unsupported' = 'ok') {
  await page.addInitScript((selected) => {
    (window as any).__tracksStopped = 0;
    (window as any).__micCalls = 0;
    if (selected === 'insecure') Object.defineProperty(window, 'isSecureContext', {value:false});
    Object.defineProperty(navigator, 'mediaDevices', {value:{ getUserMedia: async () => {
      (window as any).__micCalls++;
      if (selected === 'denied') throw new DOMException('Permission denied', 'NotAllowedError');
      return {getTracks: () => [{stop: () => { (window as any).__tracksStopped++; }}]};
    }}});
    class FakeRecorder {
      static isTypeSupported() { return selected !== 'unsupported'; }
      state = 'inactive'; ondataavailable: ((e: any)=>void) | null = null;
      onstop: (()=>void) | null = null; onerror: (()=>void) | null = null;
      constructor(_stream: unknown, _options: unknown) {}
      start() { this.state = 'recording'; }
      stop() { this.state = 'inactive'; queueMicrotask(() => {
        this.ondataavailable?.({data: new Blob([new Uint8Array([0x1a,0x45,0xdf,0xa3,1])], {type:'audio/webm'})});
        this.onstop?.();
      }); }
    }
    (window as any).MediaRecorder = FakeRecorder;
  }, mode);
  await page.route('**/api/stt/status', route => route.fulfill({json:{enabled:true}}));
  await page.goto('/');
  await expect(page.locator('#ptt')).toBeEnabled();
}

test('record, stop, edit transcript and send via existing chat', async ({page}) => {
  let calls=0;
  await page.route('**/api/stt', route => { calls++; return route.fulfill({json:{text:'Hallo Eule'}}); });
  await configure(page);
  expect(await page.evaluate(() => (window as any).__micCalls)).toBe(0);
  await page.click('#ptt'); await expect(page.locator('#state')).toContainText('listening');
  await page.click('#ptt'); await expect(page.locator('#message')).toHaveValue('Hallo Eule');
  expect(await page.evaluate(() => (window as any).__tracksStopped)).toBeGreaterThan(0);
  expect(calls).toBe(1);
  await page.fill('#message','Korrigierter Text'); await page.click('#send');
  await expect(page.locator('#messages')).toContainText('Korrigierter Text');
});

test('explicit auto send transcribes and sends once', async ({page}) => {
  let chats=0;
  await page.route('**/api/stt', route => route.fulfill({json:{text:'Automatische Frage'}}));
  await page.route('**/api/chat', route => { chats++; return route.fulfill({json:{reply:'Antwort',session_id:'one',mode:'mock'}}); });
  await configure(page); await page.check('#voice-auto-send');
  await page.click('#ptt'); await page.click('#ptt');
  await expect(page.locator('#messages')).toContainText('Antwort'); expect(chats).toBe(1);
});

for (const scenario of ['denied','insecure','unsupported'] as const) {
  test(`${scenario} preserves text fallback`, async ({page}) => {
    await configure(page, scenario); await page.click('#ptt');
    await expect(page.locator('#stt-status')).toContainText('nicht verfügbar');
    await expect(page.locator('#state')).toContainText('idle');
    await page.fill('#message','Text bleibt'); await page.click('#send');
    await expect(page.locator('#messages')).toContainText('Text bleibt');
  });
}

test('cancel stops tracks and never uploads', async ({page}) => {
  let calls=0;
  await page.route('**/api/stt', route => { calls++; return route.fulfill({json:{text:'unerwartet'}}); });
  await configure(page); await page.click('#ptt'); await page.click('#ptt-cancel');
  await expect(page.locator('#state')).toContainText('idle');
  expect(await page.evaluate(() => (window as any).__tracksStopped)).toBeGreaterThan(0);
  expect(calls).toBe(0);
});

test('STT error returns to text input', async ({page}) => {
  await page.route('**/api/stt', route => route.fulfill({status:503,body:'unavailable'}));
  await configure(page); await page.click('#ptt'); await page.click('#ptt');
  await expect(page.locator('#stt-status')).toContainText('fehlgeschlagen');
  await expect(page.locator('#send')).toBeEnabled();
});

test('cancel during transcription aborts the request and keeps the form usable', async ({page}) => {
  let releaseResponse!: () => void;
  let received = false;
  let requestFailed = false;
  page.on('requestfailed', request => { if (request.url().endsWith('/api/stt')) requestFailed = true; });
  let settleResponse!: () => void;
  const responseGate = new Promise<void>(resolve => { releaseResponse = resolve; });
  const responseSettled = new Promise<void>(resolve => { settleResponse = resolve; });
  await page.route('**/api/stt', async route => {
    received = true;
    await responseGate;
    await route.fulfill({json:{text:'Zu spät'}}).catch(() => undefined);
    settleResponse();
  });
  try {
    await configure(page); await page.click('#ptt'); await page.click('#ptt');
    await expect.poll(() => received).toBe(true);
    await expect(page.locator('#ptt-cancel')).toBeEnabled();
    await page.click('#ptt-cancel');
    await expect.poll(() => requestFailed).toBe(true);
    releaseResponse();
    await responseSettled;
    await expect(page.locator('#message')).toHaveValue('');
    await expect(page.locator('#state')).toContainText('idle');
    await expect(page.locator('#send')).toBeEnabled();
  } finally {
    releaseResponse();
  }
});


test('ignores a late STT result even if the transport ignores abort', async ({page}) => {
  await page.addInitScript(() => {
    const originalFetch = window.fetch.bind(window);
    (window as any).__lateSttStarted = false;
    (window as any).__lateSttRead = false;
    window.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
      if (input !== '/api/stt') return originalFetch(input, init);
      (window as any).__lateSttStarted = true;
      return new Promise<Response>(resolve => {
        (window as any).__releaseLateStt = () => resolve({
          ok: true,
          headers: new Headers(),
          json: async () => { (window as any).__lateSttRead = true; return {text: 'Zu spät'}; },
        } as Response);
      });
    }) as typeof fetch;
  });
  await configure(page);
  await page.click('#ptt'); await page.click('#ptt');
  await expect.poll(() => page.evaluate(() => (window as any).__lateSttStarted)).toBe(true);
  await page.click('#ptt-cancel');
  await page.evaluate(() => (window as any).__releaseLateStt());
  await expect.poll(() => page.evaluate(() => (window as any).__lateSttRead)).toBe(true);
  await expect(page.locator('#message')).toHaveValue('');
  await expect(page.locator('#state')).toContainText('idle');
  await expect(page.locator('#send')).toBeEnabled();
});

test('pagehide stops active microphone tracks', async ({page}) => {
  await configure(page); await page.click('#ptt');
  await page.evaluate(() => window.dispatchEvent(new Event('pagehide')));
  expect(await page.evaluate(() => (window as any).__tracksStopped)).toBeGreaterThan(0);
});

test('starting recording stops currently playing speech', async ({page}) => {
  const rate = 16000, frames = 4 * rate;
  const wav = Buffer.alloc(44 + frames * 2);
  wav.write('RIFF',0); wav.writeUInt32LE(wav.length-8,4); wav.write('WAVEfmt ',8);
  wav.writeUInt32LE(16,16); wav.writeUInt16LE(1,20); wav.writeUInt16LE(1,22);
  wav.writeUInt32LE(rate,24); wav.writeUInt32LE(rate*2,28); wav.writeUInt16LE(2,32); wav.writeUInt16LE(16,34);
  wav.write('data',36); wav.writeUInt32LE(frames*2,40);
  for (let i=0;i<frames;i++) wav.writeInt16LE(Math.round(16000*Math.sin(2*Math.PI*440*i/rate)),44+i*2);
  await page.route('**/api/tts/status', r => r.fulfill({json:{enabled:true}}));
  await page.route('**/api/tts', r => r.fulfill({contentType:'audio/wav',body:wav}));
  await configure(page); await expect(page.locator('#speech-enabled')).toBeEnabled();
  await page.check('#speech-enabled'); await page.fill('#message','Sprich'); await page.click('#send');
  await expect(page.locator('#state')).toContainText('speaking'); await expect(page.locator('#send')).toBeEnabled();
  await page.click('#ptt'); await expect(page.locator('#state')).toContainText('listening');
  await expect.poll(async()=>Number(await page.locator('#avatar').getAttribute('data-mouth'))).toBe(0);
  await page.click('#ptt-cancel');
});
