import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { runDatabaseMigrations } from '../migration-runner.js';

const validStatements = [
  '-- fxl-migration-mode: phased\n-- fxl-phase: column\nSELECT 1;',
  '-- fxl-phase: target-index\nSELECT 2;',
  '-- fxl-phase: source-index\nSELECT 3;',
  '-- fxl-phase: constraint\nSELECT 4;',
  '-- fxl-phase: backfill-context\nSELECT 5;',
  '-- fxl-phase: backfill-repeat\nSELECT 6;',
  '-- fxl-phase: validate\nSELECT 7;',
];

async function malformedMigrationFolder(source: string): Promise<string> {
  const folder = await mkdtemp(join(tmpdir(), 'fxl-sales-invalid-migration-'));
  await mkdir(join(folder, 'meta'));
  await writeFile(
    join(folder, 'meta/_journal.json'),
    JSON.stringify({
      dialect: 'postgresql',
      entries: [
        {
          breakpoints: true,
          idx: 0,
          tag: '0018_professional_payable_identity',
          version: '7',
          when: 1,
        },
      ],
      version: '7',
    }),
  );
  await writeFile(join(folder, '0018_professional_payable_identity.sql'), source);
  return folder;
}

describe('migration runner phased grammar', () => {
  it.each([
    {
      message: /unknown or malformed migration phase marker: target_index/,
      name: 'rejects malformed marker names',
      source: validStatements
        .map((statement) => statement.replace('target-index', 'target_index'))
        .join('--> statement-breakpoint\n'),
    },
    {
      message: /phase marker must start its breakpoint chunk: target-index/,
      name: 'rejects a marker placed after SQL',
      source: validStatements
        .map((statement) =>
          statement.startsWith('-- fxl-phase: target-index')
            ? 'SELECT 2;\n-- fxl-phase: target-index\nSELECT 2;'
            : statement,
        )
        .join('--> statement-breakpoint\n'),
    },
    {
      message: /breakpoint chunk must contain exactly one phase marker: column/,
      name: 'rejects duplicate or stray markers in one chunk',
      source: validStatements
        .map((statement) =>
          statement.startsWith('-- fxl-migration-mode: phased')
            ? `${statement}\n-- fxl-phase: validate\nSELECT 99;`
            : statement,
        )
        .join('--> statement-breakpoint\n'),
    },
  ])('$name before opening a database connection', async ({ message, source }) => {
    const folder = await malformedMigrationFolder(source);
    try {
      await expect(
        runDatabaseMigrations({
          databaseUrl: 'postgresql://invalid:invalid@127.0.0.1:1/invalid',
          migrationsFolder: folder,
        }),
      ).rejects.toThrow(message);
    } finally {
      await rm(folder, { force: true, recursive: true });
    }
  });
});
