import { defineConfig } from 'vite';

// COOP/COEP let WebAssembly use threads; the page works without them too.
const headers = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff',
};

export default defineConfig({
  base: process.env.SUMINURI_BASE || '/',
  esbuild: { jsx: 'automatic' },
  server: { headers },
  preview: { headers },
  build: { target: 'es2022', chunkSizeWarningLimit: 2500 },
  worker: { format: 'es' },
});
