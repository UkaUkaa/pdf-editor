import { resolve } from 'node:path';
import { defineConfig } from 'electron-vite';
import react from '@vitejs/plugin-react';

const alias = {
  '@shared': resolve(import.meta.dirname, 'src/shared'),
  '@renderer': resolve(import.meta.dirname, 'src/renderer'),
};

export default defineConfig({
  main: {
    resolve: { alias },
    build: {
      // Bundled so the packaged app has no runtime node_modules lookups.
      externalizeDeps: { exclude: ['zod', 'electron-updater'] },
      lib: { entry: resolve(import.meta.dirname, 'src/main/index.ts'), formats: ['es'] },
    },
  },
  preload: {
    resolve: { alias },
    build: {
      // Sandboxed preload scripts must be a single CommonJS file.
      externalizeDeps: false,
      lib: {
        entry: resolve(import.meta.dirname, 'src/preload/index.ts'),
        formats: ['cjs'],
        fileName: () => 'index.cjs',
      },
    },
  },
  renderer: {
    root: resolve(import.meta.dirname, 'src/renderer'),
    resolve: { alias },
    plugins: [react()],
    build: {
      minify: true,
      rollupOptions: { input: resolve(import.meta.dirname, 'src/renderer/index.html') },
    },
  },
});
