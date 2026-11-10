// The prototype script is a database-touching entrypoint (CREATE and DROP DATABASE), so it carries
// its own local-database proof, the same promise as the three entrypoints that
// `scripts/__tests__/local-database-guard.test.mjs` pins. It is a structural read: the refusal lives
// in the pure `ambiente.ts`, and `run.ts` must reach every database URL only through it.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const DIR = resolve(import.meta.dirname, '..');
const code = (file: string) =>
  readFileSync(resolve(DIR, file), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^[ \t]*\/\/.*$/gm, '');

describe('prototype: local database guard', () => {
  it('ambiente.ts refuses a non-local host through the shared guard', () => {
    const ambiente = code('ambiente.ts');
    expect(ambiente).toMatch(/import\s*\{[^}]*isLocalDatabaseHost[^}]*\}\s*from\s*'..\/..\/src\/db\/local-database-guard\.js'/);
    expect((ambiente.match(/isLocalDatabaseHost\(devUrl\)/g) ?? []).length).toBeGreaterThanOrEqual(2);
  });

  it('run.ts reaches the database only through the derived URLs', () => {
    const run = code('run.ts');
    expect(run).toContain('maintenanceDatabaseUrl(devUrl)');
    expect(run).toContain('scratchDatabaseUrl(devUrl, name)');
    // Never the raw environment's DATABASE_URL, never a named env file, never a raw dotenv import.
    expect(run).not.toMatch(/process\.env\.DATABASE_URL|process\.env\[['"]DATABASE_URL/);
    expect(run).not.toMatch(/SALES_ENV_FILE/);
    expect(run).not.toMatch(/['"]dotenv(\/config)?['"]/);
  });

  it('run.ts drops only through the scratch-name gate', () => {
    const run = code('run.ts');
    expect(run).toMatch(/if \(!isScratchDatabaseName\(name\)\) throw/);
    expect(run.match(/DROP DATABASE/g)?.length).toBe(1);
  });
});
