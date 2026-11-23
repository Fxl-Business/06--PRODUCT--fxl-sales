import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const api = (p: string) => fileURLToPath(new URL(`../../../apps/api/${p}`, import.meta.url));

/** Runs the API half of this slice: `unit` (fake database) or, with VITEST_INTEGRATION=1, the real test database. */
const integration = process.env.VITEST_INTEGRATION === '1';

/** The test files live outside apps/api, so its dependencies are pointed at explicitly. */
const dep = (name: string) => ({ find: new RegExp(`^${name}$`), replacement: api(`node_modules/${name}`) });

export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  resolve: {
    alias: [
      // The package maps each subpath through `exports`, so it resolves to its built file.
      {
        find: /^@fxl-sales\/shared-utils\/(.+)$/,
        replacement: `${api('../../packages/shared-utils/dist')}/$1.js`,
      },
      ...['hono', 'exceljs', 'drizzle-orm'].map(dep),
    ],
  },
  test: integration
    ? {
        include: ['*.integration.test.ts'],
        globalSetup: [api('test/rls/global-setup.ts')],
        setupFiles: [api('test/rls/setup-env.ts')],
        testTimeout: 30000,
        hookTimeout: 30000,
        fileParallelism: false,
      }
    : { include: ['*.api.test.ts'], setupFiles: [api('test/unit-setup.ts')] },
});
