import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: { '@b20-ui': fileURLToPath(new URL('./src/untitled', import.meta.url)) },
  },
});
