import { defineConfig } from 'vite';

// Browser tests intercept every /api request; this config intentionally has no API proxy.
export default defineConfig({ server: { host: '127.0.0.1' } });
