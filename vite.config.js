import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';

export default defineConfig({
  plugins: [react()],
  base: './',
  build: {
    outDir: 'dist',
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        output: resolve(__dirname, 'output.html'),
      },
    },
  },
  server: {
    port: 5173,
    strictPort: true,
    // Browser-source output in dev gets live updates from the Electron app.
    proxy: { '/events': 'http://localhost:4317' },
  },
});
