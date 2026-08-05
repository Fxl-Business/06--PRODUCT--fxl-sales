import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const testDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(testDir, '../../../../..');

describe('Docker migration startup contract', () => {
  it('includes migrations and runs the compiled migrator before the API server', () => {
    const dockerfile = readFileSync(resolve(repoRoot, 'apps/api/Dockerfile'), 'utf8');
    const productionEntrypoint = readFileSync(
      resolve(repoRoot, 'apps/api/src/db/migrate.ts'),
      'utf8',
    );
    const integrationEntrypoint = readFileSync(
      resolve(repoRoot, 'apps/api/test/rls/global-setup.ts'),
      'utf8',
    );

    expect(existsSync(resolve(repoRoot, 'apps/api/src/db/migrate.ts'))).toBe(true);
    expect(dockerfile).toContain(
      'COPY --from=build /app/apps/api/drizzle ./apps/api/drizzle',
    );
    expect(dockerfile).toContain(
      'CMD ["sh", "-c", "node dist/db/migrate.js && exec node dist/server.js"]',
    );
    expect(productionEntrypoint).toContain("import { runDatabaseMigrations } from './migration-runner.js'");
    expect(productionEntrypoint).toMatch(/await runDatabaseMigrations\(/);
    expect(integrationEntrypoint).toContain(
      "import { runDatabaseMigrations } from '../../src/db/migration-runner.js'",
    );
    expect(integrationEntrypoint).toMatch(/await runDatabaseMigrations\(/);
    expect(productionEntrypoint).not.toContain('drizzle-orm/postgres-js/migrator');
    expect(integrationEntrypoint).not.toContain('drizzle-orm/postgres-js/migrator');
  });
});
