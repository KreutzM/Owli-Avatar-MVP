import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 30_000,
  use: {
    baseURL: 'http://127.0.0.1:15173',
    launchOptions: { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined },
  },
  webServer: [{
    command: 'npm run dev -- --host 127.0.0.1 --port 15173 --strictPort',
    url: 'http://127.0.0.1:15173',
    reuseExistingServer: false,
    env: { VITE_OWLI_DIAGNOSTICS: '1' },
    timeout: 30_000,
  }],
});
