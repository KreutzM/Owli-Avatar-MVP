import { defineConfig, devices } from '@playwright/test';

const testPort = Number(process.env.OWLI_WEB_TEST_PORT || 15173);

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 30_000,
  use: {
    baseURL: `http://127.0.0.1:${testPort}`, 
    trace: 'retain-on-failure',
    launchOptions: { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined },
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [{
    command: `npm run dev -- --config vite.stream-test.config.ts --port ${testPort} --strictPort`,
    url: `http://127.0.0.1:${testPort}`, 
    reuseExistingServer: false,
    env: { VITE_OWLI_DIAGNOSTICS: '1', VITE_CHAT_TIMEOUT_MS: '3000' },
    timeout: 30_000,
  }],
});
