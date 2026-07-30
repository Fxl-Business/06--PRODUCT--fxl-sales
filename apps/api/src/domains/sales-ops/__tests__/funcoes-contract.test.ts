import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  FuncaoSchema,
  PersonSchema,
  UpdateFuncaoSchema,
  planPersonFuncoes,
  slugifyFuncao,
} from '../service.js';

const MIGRATION_PATH = resolve(process.cwd(), 'drizzle/0012_sales_ops_funcoes.sql');
const JOURNAL_PATH = resolve(process.cwd(), 'drizzle/meta/_journal.json');
const MIGRATION_0011_WHEN = 1785349621521;

describe('sales operations funções contract', () => {
  it('accepts a minimal função payload and defaults status to active', () => {
    expect(FuncaoSchema.parse({ name: '  Desenvolvedor  ' })).toEqual({
      name: 'Desenvolvedor',
      status: 'active',
    });
  });

  it('rejects an empty or blank função name', () => {
    expect(FuncaoSchema.safeParse({ name: '' }).success).toBe(false);
    expect(FuncaoSchema.safeParse({ name: '   ' }).success).toBe(false);
    expect(FuncaoSchema.safeParse({ name: 'Designer' }).success).toBe(true);
  });

  it('rejects unsupported função statuses', () => {
    expect(FuncaoSchema.safeParse({ name: 'Tester', status: 'deleted' }).success).toBe(false);
    expect(FuncaoSchema.safeParse({ name: 'Tester', status: 'archived' }).success).toBe(true);
  });

  it('allows a partial patch payload but still rejects a blank rename', () => {
    expect(UpdateFuncaoSchema.safeParse({}).success).toBe(true);
    expect(UpdateFuncaoSchema.safeParse({ status: 'archived' }).success).toBe(true);
    expect(UpdateFuncaoSchema.safeParse({ name: '   ' }).success).toBe(false);
  });

  it('derives a slug from the função name, stripping diacritics and punctuation', () => {
    expect(slugifyFuncao('P.O.')).toBe('p-o');
    expect(slugifyFuncao('Desenvolvedor Sênior')).toBe('desenvolvedor-senior');
    expect(slugifyFuncao('Vendedor')).toBe('vendedor');
    expect(slugifyFuncao('  Product   Owner  ')).toBe('product-owner');
    expect(slugifyFuncao('Ação & Reação')).toBe('acao-reacao');
    expect(slugifyFuncao('X'.repeat(200))).toHaveLength(120);
  });

  it('never accepts slug or isSystem from the request body', () => {
    const parsed = FuncaoSchema.parse({ name: 'Designer', slug: 'vendedor', isSystem: true });

    expect(parsed).not.toHaveProperty('slug');
    expect(parsed).not.toHaveProperty('isSystem');
    expect(UpdateFuncaoSchema.parse({ slug: 'finder', isSystem: true })).toEqual({});
  });

  it('accepts a person payload without any legacy role boolean', () => {
    // The at-least-one-role .refine() moved out of the schema and into the
    // service resolver, because the rule now has to consult the org's funções.
    expect(PersonSchema.safeParse({ displayName: 'Sig' }).success).toBe(true);
    expect(
      PersonSchema.safeParse({ displayName: 'Sig', funcaoIds: ['not-a-uuid'] }).success,
    ).toBe(false);
  });

  it('requires at least one função on a person create payload', () => {
    expect(planPersonFuncoes({ displayName: 'Kayke' }, 'create')).toBe('funcao_required');
    expect(planPersonFuncoes({ displayName: 'Kayke', funcaoIds: [] }, 'create')).toBe(
      'funcao_required',
    );
    expect(planPersonFuncoes({ displayName: 'Kayke', isSeller: false }, 'create')).toBe(
      'funcao_required',
    );
  });

  it('leaves the assignment set untouched when a patch omits funcaoIds and every boolean', () => {
    expect(planPersonFuncoes({ displayName: 'Halland' }, 'update')).toEqual({ kind: 'unchanged' });
    // An explicitly empty set is still a rejection, not a no-op.
    expect(planPersonFuncoes({ funcaoIds: [] }, 'update')).toBe('funcao_required');
  });

  it('accepts the legacy boolean person payload as a deprecated compat shim', () => {
    expect(planPersonFuncoes({ displayName: 'Sig', isSeller: true }, 'create')).toEqual({
      kind: 'slugs',
      slugs: ['vendedor'],
    });
    expect(
      planPersonFuncoes(
        { displayName: 'Joao Boldo', isFinder: true, isCollaborator: true },
        'create',
      ),
    ).toEqual({ kind: 'slugs', slugs: ['finder', 'prestador'] });
  });

  it('prefers funcaoIds over the legacy booleans when both are present', () => {
    const funcaoId = '99999999-9999-4999-8999-999999999999';

    expect(
      planPersonFuncoes(
        { displayName: 'Cauet', funcaoIds: [funcaoId], isSeller: true, isFinder: true },
        'create',
      ),
    ).toEqual({ kind: 'ids', funcaoIds: [funcaoId] });
  });

  it('the shipped 0012 migration enables and forces RLS on both tables and seeds behind the admin context', () => {
    expect(existsSync(MIGRATION_PATH), `missing migration: ${MIGRATION_PATH}`).toBe(true);
    const migration = readFileSync(MIGRATION_PATH, 'utf8');

    expect(migration).toContain('CREATE TABLE "sales_ops_funcoes"');
    expect(migration).toContain('CREATE TABLE "sales_ops_person_funcoes"');

    for (const table of ['sales_ops_funcoes', 'sales_ops_person_funcoes']) {
      const enableIndex = migration.indexOf(`ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY`);
      const forceIndex = migration.indexOf(`ALTER TABLE ${table} FORCE ROW LEVEL SECURITY`);
      expect(enableIndex, `${table} missing ENABLE ROW LEVEL SECURITY`).toBeGreaterThan(-1);
      expect(forceIndex, `${table} missing FORCE ROW LEVEL SECURITY`).toBeGreaterThan(enableIndex);
      expect(migration).toContain(`${table}_tenant_isolation`);
      expect(migration).toContain(`${table}_admin_context`);
    }

    // The composite (org_id, fk) foreign keys are what make a cross-org
    // assignment impossible at the database level, and they need the two
    // (org_id, id) unique indexes as their targets.
    expect(migration).toContain('"sales_ops_funcoes_org_id_id_idx"');
    expect(migration).toContain('"sales_ops_people_org_id_id_idx"');
    expect(migration).toContain(
      'FOREIGN KEY ("org_id","person_id") REFERENCES "public"."sales_ops_people"("org_id","id")',
    );
    expect(migration).toContain(
      'FOREIGN KEY ("org_id","funcao_id") REFERENCES "public"."sales_ops_funcoes"("org_id","id")',
    );
    expect(migration).toMatch(
      /CHECK\s*\(NOT is_system OR slug IN \('vendedor',\s*'finder'\)\)/,
    );

    const lastPolicyIndex = migration.lastIndexOf('CREATE POLICY');
    const adminContextIndex = migration.indexOf(
      "SELECT set_config('app.fxl_admin', 'true', true)",
    );
    const firstFuncaoInsertIndex = migration.indexOf('INSERT INTO "sales_ops_funcoes"');
    const firstAssignmentInsertIndex = migration.indexOf(
      'INSERT INTO "sales_ops_person_funcoes"',
    );

    expect(adminContextIndex).toBeGreaterThan(lastPolicyIndex);
    expect(firstFuncaoInsertIndex).toBeGreaterThan(adminContextIndex);
    expect(firstAssignmentInsertIndex).toBeGreaterThan(firstFuncaoInsertIndex);

    expect(migration).toContain("'Vendedor', 'vendedor'");
    expect(migration).toContain("'Finder', 'finder'");
    expect(migration).toContain("'Prestador', 'prestador'");
    // The seed must union every org source: sales_ops_settings alone can miss an
    // org that has people but no settings row.
    expect(migration).toContain('FROM "sales_ops_people"');
    expect(migration).toContain('FROM "sales_ops_settings"');
    expect(migration).toContain('FROM "sales_ops_sales"');

    const seedStatements = migration
      .split('--> statement-breakpoint')
      .map((statement) => statement.trim())
      .filter((statement) => /^INSERT INTO/i.test(statement));
    expect(seedStatements.length).toBeGreaterThanOrEqual(5);
    for (const statement of seedStatements) {
      expect(statement, `seed INSERT is not idempotent:\n${statement}`).toMatch(
        /ON CONFLICT \([^)]+\) DO NOTHING/,
      );
    }

    // Expand-only: nothing existing may be dropped or narrowed.
    expect(migration).not.toMatch(/DROP\s+(TABLE|COLUMN|POLICY|CONSTRAINT)/i);
    expect(migration).not.toMatch(/set_config\('app\.fxl_admin',\s*'true',\s*false\)/i);
  });

  it('registers migration 0012 in the drizzle journal after 0011', () => {
    const journal = JSON.parse(readFileSync(JOURNAL_PATH, 'utf8')) as {
      entries: Array<{ idx: number; tag: string; when: number; breakpoints: boolean }>;
    };
    const entry = journal.entries.find((candidate) => candidate.idx === 12);

    expect(entry, 'no journal entry with idx 12').toBeDefined();
    expect(entry?.tag).toBe('0012_sales_ops_funcoes');
    expect(entry?.breakpoints).toBe(true);
    expect(entry?.when).toBeGreaterThan(MIGRATION_0011_WHEN);
    expect(journal.entries.filter((candidate) => candidate.idx === 12)).toHaveLength(1);
  });
});
