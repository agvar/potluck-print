import { defineConfig } from 'vite';
import { resolve } from 'node:path';

// Two pages: the guest form (index.html) and your print queue (admin.html).
export default defineConfig({
  appType: 'mpa',
  build: {
    rolldownOptions: {
      input: {
        main: resolve(import.meta.dirname, 'index.html'),
        admin: resolve(import.meta.dirname, 'admin.html'),
      },
    },
  },
});
