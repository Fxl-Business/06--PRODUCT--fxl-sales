import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const testDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(testDir, '../../../../..');

describe('Docker migration startup contract', () => {
  it('includes migrations and runs the compiled migrator before the API server', () => {
    const dockerfile = readFileSync(resolve(repoRoot, 'apps/api/Dockerfile'), 'utf8');

    expect(existsSync(resolve(repoRoot, 'apps/api/src/db/migrate.ts'))).toBe(true);
    expect(dockerfile).toContain(
      'COPY --from=build /app/apps/api/drizzle ./apps/api/drizzle',
    );
    expect(dockerfile).toContain(
      'CMD ["sh", "-c", "node dist/db/migrate.js && exec node dist/server.js"]',
    );
  });
});
