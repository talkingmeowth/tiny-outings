import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));

export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  envDir: repoRoot,
  publicDir: fileURLToPath(new URL('../public', import.meta.url)),
  base: '/review/',
  plugins: [react()],
  build: {
    target: 'esnext',
    outDir: fileURLToPath(new URL('../desktop-review-dist', import.meta.url)),
    emptyOutDir: true,
  },
  server: {
    port: 5174,
  },
});
