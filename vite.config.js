import { defineConfig } from 'vite';

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
  },
});
