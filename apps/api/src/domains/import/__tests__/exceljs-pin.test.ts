import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('exceljs pin', () => {
  it('pins exceljs exactly in apps/api dependencies', () => {
    const pkg = JSON.parse(readFileSync(new URL('../../../../package.json', import.meta.url), 'utf8')) as {
      dependencies: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    expect(pkg.dependencies.exceljs).toMatch(/^4\.\d+\.\d+$/);
    expect(pkg.devDependencies?.exceljs).toBeUndefined();
  });
});
