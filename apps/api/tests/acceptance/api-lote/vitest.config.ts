import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

/**
 * Runner of the api-lote acceptance tests: the same project settings as the API's
 * integration run (migrate-first globalSetup, per-file URL resolution, serial files,
 * 30s budgets), pointed at this folder only.
 *
 * Run once, from apps/api:
 *   pnpm exec vitest run --config tests/acceptance/api-lote/vitest.config.ts
 */
const apiRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

export default defineConfig({
  root: apiRoot,
  test: {
    include: ['tests/acceptance/api-lote/**/*.test.ts'],
    globalSetup: ['./test/rls/global-setup.ts'],
    setupFiles: ['./test/rls/setup-env.ts'],
    testTimeout: 30000,
    hookTimeout: 30000,
    fileParallelism: false,
  },
});
