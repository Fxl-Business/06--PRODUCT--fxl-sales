// Runs tests/acceptance/<SLICE> API files from apps/api, so its own dependencies resolve. Untracked, run-local.
import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';
const api = (p: string) => resolve(import.meta.dirname, p);
const integration = process.env.VITEST_INTEGRATION === '1';
const dir = `../../tests/acceptance/${process.env.SLICE}`;
export default defineConfig({
  root: api('.'),
  resolve: { alias: ['hono', 'exceljs', 'drizzle-orm'].map((n) => ({ find: new RegExp(`^${n}$`), replacement: api(`node_modules/${n}`) })).concat([{ find: /^@fxl-sales\/shared-utils\/(.+)$/, replacement: `${api('../../packages/shared-utils/dist')}/$1.js` }]) },
  test: integration
    ? { include: [`${dir}/*.integration.test.ts`], globalSetup: [api('test/rls/global-setup.ts')], setupFiles: [api('test/rls/setup-env.ts')], testTimeout: 30000, hookTimeout: 30000, fileParallelism: false }
    : { include: [`${dir}/*.api.test.ts`], setupFiles: [api('test/unit-setup.ts')] },
});
