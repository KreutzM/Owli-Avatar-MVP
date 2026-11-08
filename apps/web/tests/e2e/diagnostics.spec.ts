import { test, expect } from '@playwright/test';

// Run with VITE_OWLI_DIAGNOSTICS=1 so only the Vite test server opts in.
test.skip(process.env.OWLI_DIAGNOSTICS_E2E !== '1', 'requires the isolated diagnostics Playwright config');

test('opt-in posts numeric timing only after captured audio is scheduled for playback', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'mediaDevices', { value: { getUserMedia: async () => ({ getTracks: () => [{ stop() {} }] }) } });
    class FakeRecorder {
      static isTypeSupported() { return true; }
      state = 'inactive'; ondataavailable: ((event: {data: Blob}) => void) | null = null;
      onstop: (() => void) | null = null; onerror: (() => void) | null = null;
      constructor(_stream: unknown, _options: unknown) {}
      start() { this.state = 'recording'; }
      stop() { this.state = 'inactive'; queueMicrotask(() => { this.ondataavailable?.({data: new Blob([new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 1])])}); this.onstop?.(); }); }
    }
    (window as unknown as {MediaRecorder: unknown}).MediaRecorder = FakeRecorder;
  });
  const rate = 16000, frames = rate;
  const wav = Buffer.alloc(44 + frames * 2);
  wav.write('RIFF', 0); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8);
  wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(rate, 24); wav.writeUInt32LE(rate * 2, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34);
  wav.write('data', 36); wav.writeUInt32LE(frames * 2, 40);
  for (let i = 0; i < frames; i++) wav.writeInt16LE(Math.round(12000 * Math.sin(2 * Math.PI * 440 * i / rate)), 44 + i * 2);

  let diagnostics: Record<string, unknown> | undefined;
  await page.route('**/api/stt/status', route => route.fulfill({json:{enabled:true}}));
  await page.route('**/api/health', route => route.fulfill({json:{status:'ok',mode:'mock'}}));
  await page.route('**/api/tts/status', route => route.fulfill({json:{enabled:true}}));
  await page.route('**/api/stt', route => route.fulfill({json:{text:'Frage'}, headers:{'Server-Timing':'upload;dur=4.5, stt;dur=24.5'}}));
  await page.route('**/api/chat', route => route.fulfill({json:{reply:'Antwort',session_id:'must-not-be-logged',mode:'ollama'}, headers:{'Server-Timing':'ollama;dur=35.5'}}));
  await page.route('**/api/tts', route => route.fulfill({contentType:'audio/wav',body:wav, headers:{'Server-Timing':'piper;dur=12.5'}}));
  await page.route('**/api/diagnostics', async route => { diagnostics = route.request().postDataJSON() as Record<string, unknown>; await route.fulfill({status:204,body:''}); });
  await page.goto('/');
  await page.check('#speech-enabled');
  await page.check('#voice-auto-send');
  await page.click('#ptt');
  await page.click('#ptt');
  await expect.poll(() => diagnostics).toBeTruthy();
  expect(diagnostics).toMatchObject({upload_ms:4.5,stt_ms:24.5,ollama_ms:35.5,piper_ms:12.5});
  expect(diagnostics).toHaveProperty('capture_to_playback_ms');
  expect(Object.values(diagnostics!).every(value => typeof value === 'number' && Number.isFinite(value))).toBe(true);
  expect(Object.keys(diagnostics!).filter(key => key !== 'fps').sort()).toEqual(['capture_to_playback_ms','capture_to_upload_ms','upload_ms','chat_request_ms','ollama_ms','piper_ms','stt_ms','stt_request_ms','tts_request_ms'].sort());
  if (diagnostics!.fps !== undefined) expect(typeof diagnostics!.fps).toBe('number');
});

for (const autoSend of [false, true]) {
  test(`does not emit a measurement when speech is not enabled (auto-send=${autoSend})`, async ({page}) => {
    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'mediaDevices', {value:{getUserMedia:async()=>({getTracks:()=>[{stop(){}}]})}});
      class Recorder {
        static isTypeSupported() { return true; }
        state = 'inactive'; ondataavailable: ((event:{data:Blob})=>void)|null = null; onstop:(()=>void)|null = null; onerror:(()=>void)|null = null;
        constructor(_stream:unknown,_options:unknown) {}
        start() { this.state='recording'; }
        stop() { this.state='inactive'; queueMicrotask(()=>{this.ondataavailable?.({data:new Blob([new Uint8Array([0x1a,0x45,0xdf,0xa3,1])])});this.onstop?.();}); }
      }
      (window as unknown as {MediaRecorder:unknown}).MediaRecorder=Recorder;
    });
    let diagnosticsRequests=0;
    await page.route('**/api/stt/status',route=>route.fulfill({json:{enabled:true}}));
    await page.route('**/api/health',route=>route.fulfill({json:{status:'ok',mode:'mock'}}));
    await page.route('**/api/tts/status',route=>route.fulfill({json:{enabled:true}}));
    await page.route('**/api/stt',route=>route.fulfill({json:{text:'Transkript'}}));
    await page.route('**/api/chat',route=>route.fulfill({json:{reply:'Antwort',session_id:'private-test-id',mode:'mock'}}));
    await page.route('**/api/diagnostics',async route=>{diagnosticsRequests++;await route.fulfill({status:204,body:''});});
    await page.goto('/');
    if (autoSend) await page.check('#voice-auto-send');
    await page.click('#ptt'); await page.click('#ptt');
    if (autoSend) await expect(page.locator('#messages')).toContainText('Antwort');
    else await expect(page.locator('#message')).toHaveValue('Transkript');
    await page.waitForTimeout(100);
    expect(diagnosticsRequests).toBe(0);
  });
}
