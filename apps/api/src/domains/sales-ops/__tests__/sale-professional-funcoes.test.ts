import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { CreateSaleSchema, SaleInputError, SaleProfessionalSchema } from '../service.js';

const funcaoId = '55555555-5555-4555-8555-555555555555';
const personId = '22222222-2222-4222-8222-222222222222';

/**
 * Resolved from the journal rather than hardcoded, so the "next free idx" rule the
 * plan binds the executor to cannot desync this test from the shipped file.
 */
const journal = JSON.parse(
  readFileSync(resolve(process.cwd(), 'drizzle/meta/_journal.json'), 'utf8'),
) as { entries: Array<{ idx: number; when: number; tag: string }> };

const funcoesEntry = journal.entries.find((entry) => entry.tag.endsWith('_sales_ops_funcoes'));
const professionalEntry = [...journal.entries]
  .filter((entry) => entry.tag.endsWith('_sale_professional_funcoes'))
  .sort((a, b) => b.idx - a.idx)[0];

describe('sale professional funcoes contract', () => {
  it('accepts a professional row identified only by funcaoId', () => {
    const parsed = SaleProfessionalSchema.parse({
      personId,
      personName: 'Ana Martins',
      funcaoId,
      costBrl: 100000,
    });

    expect(parsed.funcaoId).toBe(funcaoId);
    expect(parsed.role).toBeUndefined();
  });

  it('still accepts a legacy free-text role row', () => {
    const parsed = SaleProfessionalSchema.parse({
      personName: 'Prestador avulso',
      role: 'Operacional',
      costBrl: 50000,
    });

    expect(parsed.role).toBe('Operacional');
    expect(parsed.funcaoId).toBeUndefined();
  });

  it('rejects a professional row with neither funcaoId nor role', () => {
    expect(SaleProfessionalSchema.safeParse({ personName: 'Ana', costBrl: 1000 }).success).toBe(
      false,
    );
    expect(
      SaleProfessionalSchema.safeParse({ personName: 'Ana', role: '   ', costBrl: 1000 }).success,
    ).toBe(false);
    // Positive control: the identical payload with one of the two present parses,
    // so the rejections above are the refine and not an unrelated schema failure.
    expect(
      SaleProfessionalSchema.safeParse({ personName: 'Ana', funcaoId, costBrl: 1000 }).success,
    ).toBe(true);
  });

  it('never accepts funcaoNameSnapshot from the request body', () => {
    const parsed = SaleProfessionalSchema.parse({
      personName: 'Ana Martins',
      funcaoId,
      funcaoNameSnapshot: 'Rótulo forjado',
      costBrl: 100000,
    });

    expect(Object.keys(parsed)).not.toContain('funcaoNameSnapshot');
    expect(parsed).not.toHaveProperty('funcaoNameSnapshot');
    // Positive control: the fields the schema DOES declare survived the same parse.
    expect(parsed.funcaoId).toBe(funcaoId);
  });

  it('carries funcaoId through the whole sale payload schema', () => {
    const parsed = CreateSaleSchema.parse({
      clientName: 'SegPro',
      sellerName: 'Ana Martins',
      status: 'open',
      baseDate: '2026-07-14',
      items: [
        {
          productId: '44444444-4444-4444-8444-444444444444',
          productName: 'X',
          quantity: 1,
          unitBrl: 400000,
        },
      ],
      professionals: [{ personId, personName: 'Ana Martins', funcaoId, costBrl: 100000 }],
      installments: [{ dueDate: '2026-07-14', amountBrl: 400000, method: 'pix' }],
    });

    expect(parsed.professionals[0]?.funcaoId).toBe(funcaoId);
  });

  it('extends SaleInputError with the four party resolution codes', () => {
    expect(new SaleInputError('seller_not_found', -1).code).toBe('seller_not_found');
    expect(new SaleInputError('finder_not_found', -1).itemIndex).toBe(-1);
    expect(new SaleInputError('person_not_found', 0).itemIndex).toBe(0);
    expect(new SaleInputError('funcao_not_found', 1).code).toBe('funcao_not_found');
    // The pre-existing item codes are untouched.
    expect(new SaleInputError('product_not_found', 0).code).toBe('product_not_found');
  });
});

describe('sale professional funcoes migration', () => {
  const migrationPath = resolve(process.cwd(), `drizzle/${professionalEntry?.tag}.sql`);
  const migration = existsSync(migrationPath) ? readFileSync(migrationPath, 'utf8') : '';

  it('ships a migration file matching its journal tag', () => {
    expect(
      professionalEntry,
      'no *_sale_professional_funcoes entry in _journal.json',
    ).toBeDefined();
    expect(existsSync(migrationPath), `missing migration: ${migrationPath}`).toBe(true);
  });

  it('adds funcao_id nullable and funcao_name_snapshot not null with an empty default', () => {
    expect(migration).toContain('ADD COLUMN "funcao_id" uuid');
    expect(migration).toContain(`ADD COLUMN "funcao_name_snapshot" text DEFAULT '' NOT NULL`);
    // Nullable is load-bearing: a legacy row whose role matched no função must
    // still satisfy the composite FK through MATCH SIMPLE.
    expect(migration).not.toMatch(/"funcao_id"\s+uuid\s+NOT NULL/i);
  });

  it('declares an org-scoped composite foreign key to sales_ops_funcoes', () => {
    expect(migration).toContain(
      'FOREIGN KEY ("org_id","funcao_id") REFERENCES "public"."sales_ops_funcoes"("org_id","id")',
    );
    expect(migration).toContain('ON DELETE restrict');
    expect(migration).toContain('sales_ops_sale_professionals_org_funcao_idx');
    // A single-column FK would not consult the RLS predicate; assert none was emitted.
    expect(migration).not.toMatch(
      /FOREIGN KEY \("funcao_id"\) REFERENCES "public"\."sales_ops_funcoes"/i,
    );
  });

  it('backfills behind the transaction-local admin context and is replay safe', () => {
    const adminContextIndex = migration.indexOf("SELECT set_config('app.fxl_admin', 'true', true)");
    const lastAlterIndex = migration.lastIndexOf('ALTER TABLE');
    const firstUpdateIndex = migration.indexOf('UPDATE "sales_ops_sale_professionals"');

    expect(adminContextIndex).toBeGreaterThan(lastAlterIndex);
    expect(adminContextIndex).toBeLessThan(firstUpdateIndex);
    expect(migration).not.toMatch(/set_config\('app\.fxl_admin',\s*'true',\s*false\)/i);

    // Both UPDATEs carry their guard, so applying the file twice is a no-op.
    expect(migration).toContain(`WHERE "funcao_name_snapshot" = ''`);
    expect(migration).toContain('sp."funcao_id" IS NULL');
    expect(migration).toContain('lower(btrim(f."name")) = lower(btrim(sp."role"))');

    // Expand only: nothing is dropped, and `role` keeps its NOT NULL.
    expect(migration).not.toMatch(/\bDROP\b/i);
  });

  it('registers the migration in the drizzle journal after the funcoes migration', () => {
    expect(funcoesEntry, 'no *_sales_ops_funcoes entry in _journal.json').toBeDefined();
    expect(professionalEntry!.idx).toBeGreaterThan(funcoesEntry!.idx);
    expect(professionalEntry!.when).toBeGreaterThan(funcoesEntry!.when);
  });
});
