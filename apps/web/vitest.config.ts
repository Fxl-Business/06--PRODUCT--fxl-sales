import { defineConfig } from 'vitest/config';
import path from 'node:path';

/**
 * Vitest config for apps/web (Phase 03 T13b). Kept separate from vite.config.ts
 * because `vitest/config` resolves a newer vite types version than the app's
 * build vite@5, which collides when merged into the same defineConfig. This file
 * is excluded from the app's tsconfig (not in `include`).
 *
 * The `@` alias mirrors vite.config.ts so test imports resolve identically.
 */
export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/__tests__/**/*.test.ts'],
    passWithNoTests: true,
  },
});
