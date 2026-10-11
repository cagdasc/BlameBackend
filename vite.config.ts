import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { fileURLToPath } from 'url';
import { defineConfig } from 'vite';

export default defineConfig(() => {
  const currentDir = import.meta.dirname ?? fileURLToPath(new URL('.', import.meta.url));
  const isCloudPreview = Boolean(
    process.env.APPLET_ID ||
    process.env.K_SERVICE ||
    process.env.CNB_STACK_ID ||
    process.env.DISABLE_HMR === 'true'
  );

  return {
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        '@': path.resolve(currentDir, '.'),
      },
    },
    server: {
      // HMR is fully enabled on your local machine, and disabled only in cloud preview proxies
      hmr: isCloudPreview ? false : true,
      watch: isCloudPreview ? null : {},
    },
    build: {
      outDir: 'dist/client',
      emptyOutDir: true,
    },
  };
});
