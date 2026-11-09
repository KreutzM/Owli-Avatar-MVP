import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests/visual26',
  timeout: 60_000,
  use: { baseURL: 'http://127.0.0.1:15326', viewport: { width: 1365, height: 900 }, launchOptions: { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined }, video: 'on' },
  outputDir: '/tmp/owli-visual26/test-results',
  webServer: [{ command: './node_modules/.bin/vite --config vite.visual26.config.ts --host 127.0.0.1 --port 15326 --strictPort', url: 'http://127.0.0.1:15326', reuseExistingServer: false, env: { VITE_OWLI_DIAGNOSTICS: '1' }, timeout: 30_000 }],
});
