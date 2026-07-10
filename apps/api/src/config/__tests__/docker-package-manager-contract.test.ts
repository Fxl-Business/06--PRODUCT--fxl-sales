import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const testDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(testDir, '../../../../..');

describe('Docker package manager contract', () => {
  it('pins a Node 20 compatible pnpm version for Corepack installs', () => {
    const rootPackageJson = JSON.parse(readFileSync(resolve(repoRoot, 'package.json'), 'utf8')) as {
      packageManager?: string;
    };

    expect(rootPackageJson.packageManager).toBe('pnpm@10.17.1');
  });
});

describe('Docker runtime dependency layout contract', () => {
  it('preserves the pnpm workspace layout for runtime node_modules resolution', () => {
    const dockerfile = readFileSync(resolve(repoRoot, 'apps/api/Dockerfile'), 'utf8');

    expect(dockerfile).toContain('COPY --from=build /app/node_modules ./node_modules');
    expect(dockerfile).toContain(
      'COPY --from=build /app/apps/api/node_modules ./apps/api/node_modules',
    );
    expect(dockerfile).toContain('WORKDIR /app/apps/api');
    expect(dockerfile).not.toContain('COPY --from=build /app/apps/api/node_modules ./node_modules');
  });
});
