import { resolve } from 'node:path';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

const shared = {
  globals: true,
  setupFiles: ['tests/setup.ts'],
  restoreMocks: true,
};

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@shared': resolve(import.meta.dirname, 'src/shared'),
      '@renderer': resolve(import.meta.dirname, 'src/renderer'),
    },
  },
  test: {
    projects: [
      {
        // Main-process and shared code runs in plain Node.
        extends: true,
        test: {
          ...shared,
          name: 'node',
          environment: 'node',
          include: ['tests/unit/main/**/*.test.ts', 'tests/unit/shared/**/*.test.ts', 'tests/unit/engine/**/*.test.ts'],
        },
      },
      {
        // Renderer components need a DOM.
        extends: true,
        test: {
          ...shared,
          name: 'renderer',
          environment: 'jsdom',
          include: ['tests/unit/renderer/**/*.test.{ts,tsx}'],
        },
      },
    ],
  },
});
