import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const journalPath = resolve(process.cwd(), 'drizzle/meta/_journal.json');
const sqlPath = resolve(process.cwd(), 'drizzle/0018_professional_payable_identity.sql');
const snapshotPath = resolve(process.cwd(), 'drizzle/meta/0018_snapshot.json');

describe('professional payable identity migration 0018', () => {
  it('registers migration 0018 after professional payment split', () => {
    const journal = JSON.parse(readFileSync(journalPath, 'utf8')) as {
      entries: Array<{ idx: number; when: number; tag: string }>;
    };
    const previous = journal.entries.find(
      (entry) => entry.tag === '0017_professional_payment_split',
    );
    const current = journal.entries.find(
      (entry) => entry.tag === '0018_professional_payable_identity',
    );

    expect(previous).toBeDefined();
    expect(current).toBeDefined();
    expect(current!.idx).toBeGreaterThan(previous!.idx);
    expect(current!.when).toBeGreaterThan(previous!.when);
    expect(existsSync(sqlPath)).toBe(true);
    expect(existsSync(snapshotPath)).toBe(true);
  });

  it('adds a nullable indexed sale professional id with an org and sale scoped foreign key', () => {
    const sql = readFileSync(sqlPath, 'utf8');

    expect(sql).toMatch(/ADD COLUMN IF NOT EXISTS "sale_professional_id" uuid/);
    expect(sql).not.toMatch(/"sale_professional_id" uuid NOT NULL/);
    expect(sql).toContain(
      'CREATE UNIQUE INDEX CONCURRENTLY "sales_ops_sale_professionals_org_sale_id_id_idx"',
    );
    expect(sql).toContain(
      'CREATE INDEX CONCURRENTLY "sales_ops_payables_sale_professional_id_idx"',
    );
    expect(sql).toContain(
      'FOREIGN KEY ("org_id","sale_id","sale_professional_id") REFERENCES "public"."sales_ops_sale_professionals"("org_id","sale_id","id")',
    );
    expect(sql).toMatch(
      /sales_ops_payables_org_sale_professional_fk[\s\S]*ON DELETE restrict[\s\S]*NOT VALID/i,
    );
    expect(sql).not.toMatch(/FOREIGN KEY \("sale_professional_id"\)/);
    expect(sql).not.toMatch(/CREATE (?:UNIQUE )?INDEX (?!CONCURRENTLY)/);
  });

  it('declares the exact phased statement contract in execution order', () => {
    const sql = readFileSync(sqlPath, 'utf8');
    const markerLines = sql
      .split(/\r?\n/)
      .filter((line) => line.startsWith('-- fxl-'));

    expect(markerLines).toEqual([
      '-- fxl-migration-mode: phased',
      '-- fxl-phase: column',
      '-- fxl-phase: target-index',
      '-- fxl-phase: source-index',
      '-- fxl-phase: constraint',
      '-- fxl-phase: backfill-context',
      '-- fxl-phase: backfill-repeat',
      '-- fxl-phase: validate',
    ]);

    const orderedConcepts = [
      'ADD COLUMN IF NOT EXISTS',
      'CREATE UNIQUE INDEX CONCURRENTLY',
      'CREATE INDEX CONCURRENTLY',
      'ADD CONSTRAINT',
      'NOT VALID',
      'LIMIT 1000',
      'FOR UPDATE OF p SKIP LOCKED',
      'VALIDATE CONSTRAINT',
    ];
    let previousIndex = -1;
    for (const concept of orderedConcepts) {
      const index = sql.indexOf(concept);
      expect(index, `missing or misordered concept: ${concept}`).toBeGreaterThan(previousIndex);
      previousIndex = index;
    }
  });

  it('backfills only unambiguous professional cost snapshots behind admin context', () => {
    const sql = readFileSync(sqlPath, 'utf8');

    expect(sql).toContain("set_config('app.fxl_admin', 'true', true)");
    expect(sql).toContain(`p."kind" = 'professional_cost'`);
    expect(sql).toContain('sp."org_id" = p."org_id"');
    expect(sql).toContain('sp."sale_id" = p."sale_id"');
    expect(sql).toContain('sp."person_name_snapshot" = p."beneficiary_name"');
    expect(sql).toContain('NOT EXISTS');
    expect(sql).toContain('other."id" <> sp."id"');
    expect(sql.match(/p\."sale_professional_id" IS NULL/g)?.length).toBeGreaterThanOrEqual(2);
    expect(sql).toContain('FOR UPDATE OF p SKIP LOCKED');
    expect(sql).toContain('LIMIT 1000');
    expect(sql).toContain('RETURNING p."id"');
  });
});
