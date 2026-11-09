import { defineConfig } from 'vite';

// Avatar tests are static/browser-only and must never proxy requests to the API.
export default defineConfig({ server: { host: '127.0.0.1' } });
