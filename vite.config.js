import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
  // Pre-bundle CJS/ESM interop for butterchurn and all preset packs
  optimizeDeps: {
    include: [
      'butterchurn',
      'butterchurn-presets',
    ],
  },
  build: {
    commonjsOptions: {
      include: [/butterchurn/, /node_modules/],
      transformMixedEsModules: true,
    },
    chunkSizeWarningLimit: 5000,
    rollupOptions: {
      // Multi-page app: main visualizer + preset editor
      input: {
        main: resolve(__dirname, 'index.html'),
        editor: resolve(__dirname, 'editor.html'),
        timeline: resolve(__dirname, 'timeline.html'),
        promo: resolve(__dirname, 'promo/index.html'),
        help: resolve(__dirname, 'help.html'),
      },
      output: {
        manualChunks(id) {
          // Collapse the 762 individually-imported baron JSONs into one chunk,
          // otherwise startup does 762 sequential network round-trips.
          if (id.includes('butterchurn-presets-baron/dist/presets/')) {
            return 'baron-presets';
          }
        },
      },
    },
  },
});
