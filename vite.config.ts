import { defineConfig } from 'vite';

export default defineConfig({
  // GitHub Pages serves this repo under /<repo>/, so the workflow sets VITE_BASE.
  // Locally it stays at the root.
  base: process.env.VITE_BASE ?? '/',
  server: { host: true },
  build: {
    // The GLB/HDR live in public/ and are copied verbatim; keep the JS chunk readable.
    target: 'es2022',
    chunkSizeWarningLimit: 1500,
  },
});
