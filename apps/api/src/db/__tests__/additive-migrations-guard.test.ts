import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { migrationNumber, scanMigrationDir, scanSql } from './additive-migration-scan.js';

const DRIZZLE_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../drizzle');
const LAST_HISTORICAL_MIGRATION = 28;

const tempDirs: string[] = [];
afterAll(() => {
  for (const dir of tempDirs) fs.rmSync(dir, { recursive: true, force: true });
});

function makeFixtureDir(files: Record<string, string>): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'additive-guard-'));
  tempDirs.push(dir);
  for (const [name, body] of Object.entries(files)) fs.writeFileSync(path.join(dir, name), body, 'utf8');
  return dir;
}

describe('additive migration guard', () => {
  it('finds the drizzle folder and the shipped history (non-vacuity)', () => {
    expect(fs.existsSync(DRIZZLE_DIR)).toBe(true);
    const sqlFiles = fs.readdirSync(DRIZZLE_DIR).filter((f) => f.endsWith('.sql'));
    expect(sqlFiles.length).toBeGreaterThanOrEqual(29);
    expect(sqlFiles.some((f) => f.startsWith('0022_'))).toBe(true);
    expect(sqlFiles.some((f) => f.startsWith('0028_'))).toBe(true);
    expect(scanMigrationDir(DRIZZLE_DIR, -1).scanned).toHaveLength(sqlFiles.length);
  });

  it('the scanner flags violations in the pre-0029 history', () => {
    const { violations } = scanMigrationDir(DRIZZLE_DIR, -1);
    expect(violations.length).toBeGreaterThan(0);
    expect(violations).toContainEqual(expect.objectContaining({ file: '0001_hard_riptide.sql', rule: 'DROP' }));
  });

  // Passes vacuously on files today by design: no migration after 0028 exists yet.
  // The positive and negative controls below carry the proof that the scan works.
  it('every migration after 0028 is additive', () => {
    const { scanned, violations } = scanMigrationDir(DRIZZLE_DIR, LAST_HISTORICAL_MIGRATION);
    const detail = violations.map((v) => `${v.file} [${v.rule}] ${v.excerpt}`).join('\n');
    expect(violations, detail).toEqual([]);
    for (const file of scanned) expect(migrationNumber(file)).toBeGreaterThan(LAST_HISTORICAL_MIGRATION);
  });

  const forbidden: [string, string][] = [
    ['DROP TABLE "x";', 'DROP'],
    ['ALTER TABLE "t" DROP COLUMN "c";', 'DROP'],
    ['drop index "i";', 'DROP'],
    ['DELETE FROM "t";', 'DELETE FROM'],
    ['delete\n  from "t";', 'DELETE FROM'],
    ['TRUNCATE "t";', 'TRUNCATE'],
    ['ALTER TABLE "t" RENAME COLUMN "a" TO "b";', 'RENAME'],
    ['ALTER TABLE "t" RENAME TO "u";', 'RENAME'],
    ['ALTER TABLE "t" ALTER COLUMN "c" SET DATA TYPE bigint;', 'ALTER COLUMN TYPE'],
    ['ALTER TABLE "t" ALTER COLUMN "c" TYPE text;', 'ALTER COLUMN TYPE'],
    ['ALTER TABLE t ALTER c TYPE text;', 'ALTER COLUMN TYPE'],
    ['GRANT SELECT ON "t" TO app;', 'GRANT'],
    ['REVOKE ALL ON "t" FROM app;', 'REVOKE'],
    ['CREATE ROLE r;', 'CREATE ROLE'],
    ['ALTER ROLE r BYPASSRLS;', 'ALTER ROLE'],
    ['ALTER ROLE r BYPASSRLS;', 'BYPASSRLS'],
  ];

  it.each(forbidden)('positive control: %j is detected as %s', (sql, rule) => {
    expect(scanSql(sql).map((v) => v.rule)).toContain(rule);
  });

  const additive = [
    'ALTER TABLE "t" ADD COLUMN "deleted_at" timestamp with time zone;',
    'ALTER TABLE "t" ADD COLUMN "dropped_count" integer DEFAULT 0;',
    'ALTER TABLE "t" ADD COLUMN "type" text;',
    'CREATE TABLE "renamed_things" ("id" uuid PRIMARY KEY);--> statement-breakpoint',
    '-- DROP TABLE x',
    '/* DELETE FROM x; TRUNCATE y; */ SELECT 1;',
    "INSERT INTO \"t\" (\"note\") VALUES ('DROP TABLE a; DELETE FROM b; it''s fine');",
    'INSERT INTO "t" ("a") VALUES (1) ON CONFLICT DO NOTHING;',
    'ALTER TABLE "t" ADD CONSTRAINT "fk" FOREIGN KEY ("a") REFERENCES "u"("id") ON DELETE RESTRICT;',
    'ALTER TABLE "t" ENABLE ROW LEVEL SECURITY; ALTER TABLE "t" FORCE ROW LEVEL SECURITY;',
    `CREATE POLICY "p" ON "t" USING ("org_id" = current_setting('app.current_org_id', true));`,
    'UPDATE "t" SET "new_col" = "old_col" WHERE "new_col" IS NULL;',
  ];

  it.each(additive)('negative control: additive SQL is not flagged: %j', (sql) => {
    expect(scanSql(sql)).toEqual([]);
  });

  it('folder-level control: a numbered fixture folder is gated by the cut-off', () => {
    const dir = makeFixtureDir({
      '0028_old.sql': 'DROP TABLE x;',
      '0029_ok.sql': 'ALTER TABLE "t" ADD COLUMN "c" text;',
      '0030_bad.sql': 'DELETE FROM "t";',
    });
    const { scanned, violations } = scanMigrationDir(dir, 28);
    expect(scanned).toEqual(['0029_ok.sql', '0030_bad.sql']);
    expect(violations).toHaveLength(1);
    expect(violations[0]).toMatchObject({ file: '0030_bad.sql', rule: 'DELETE FROM' });
  });

  it('a missing migration folder throws instead of passing silently', () => {
    expect(() => scanMigrationDir(path.join(os.tmpdir(), 'does-not-exist-additive-guard'), 28)).toThrow(
      /migration folder not found/,
    );
  });
});
