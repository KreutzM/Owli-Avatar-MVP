import { defineConfig } from 'vite';
// No API proxy: the test intercepts every /api request, so no backend can be reached.
export default defineConfig({server:{host:'127.0.0.1',proxy:{}}});
