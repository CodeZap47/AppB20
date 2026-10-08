import { resolve } from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Manifest V3 no permite cargar código remoto: todo (React, SDK de SpacetimeDB, etc.)
// queda empaquetado en `dist/`, que es la carpeta que se carga en chrome://extensions.
export default defineConfig({
  envDir: '../..',
  base: './',
  plugins: [react()],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        sidepanel: resolve(import.meta.dirname, 'sidepanel.html'),
        app: resolve(import.meta.dirname, 'app.html'),
        background: resolve(import.meta.dirname, 'src/background.ts'),
      },
      output: {
        entryFileNames: (chunk) =>
          chunk.name === 'background' ? 'background.js' : 'assets/[name]-[hash].js',
      },
    },
  },
});
