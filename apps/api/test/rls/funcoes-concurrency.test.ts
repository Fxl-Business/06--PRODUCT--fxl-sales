import { randomUUID } from 'node:crypto';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as schema from '../../src/db/schema.js';
import {
  createFuncao,
  createPerson,
  listFuncoes,
  listPeople,
  updateFuncao,
} from '../../src/domains/sales-ops/service.js';

/**
 * The actor threaded through every sales-ops cadastro write. Only the
 * archive/restore lifecycle is audited, so most calls here produce no ledger row
 * at all - but the parameter is required, and passing it is what keeps these
 * suites exercising the real route-to-service signature.
 */
const TEST_ACTOR = { userId: 'acct_rls_test', displayName: 'RLS Test Actor' } as const;

const APP_DB_URL =
  process.env.TEST_DATABASE_URL ??
  process.env.DATABASE_URL ??
  'postgresql://postgres:postgres@localhost:5006/fxl_sales';
const ADMIN_DB_URL = process.env.ADMIN_DATABASE_URL ?? APP_DB_URL;
const ADMIN_CONNECTION_OPTIONS = { connection: { 'app.fxl_admin': 'true' } } as const;

/** Enough connections that the calls below genuinely overlap in Postgres. */
const POOL_SIZE = 16;

/**
 * Concurrency regressions for the sales-ops funções write paths.
 *
 * Every write here goes through a unique index, and the pre-flight duplicate
 * probes are time-of-check/time-of-use races by construction. These tests fail if
 * a lost race escapes as an unhandled Postgres 23505 (which the Hono handler turns
 * into an HTTP 500) instead of resolving to the designed 409 sentinel or simply
 * succeeding. A sequential test cannot catch any of it.
 */
describe('sales operations funções write concurrency', () => {
  let appClient: postgres.Sql;
  let adminClient: postgres.Sql;
  let db: ReturnType<typeof drizzle<typeof schema>>;
  const orgIds: string[] = [];

  function newOrg(label: string): string {
    const orgId = `org_conc_${label}_${Date.now()}_${randomUUID().slice(0, 8)}`;
    orgIds.push(orgId);
    return orgId;
  }

  beforeAll(() => {
    appClient = postgres(APP_DB_URL, { max: POOL_SIZE });
    adminClient = postgres(ADMIN_DB_URL, { max: 1, ...ADMIN_CONNECTION_OPTIONS });
    db = drizzle(appClient, { schema });
  });

  afterAll(async () => {
    for (const orgId of orgIds) {
      await adminClient`DELETE FROM sales_ops_person_funcoes WHERE org_id = ${orgId}`;
      await adminClient`DELETE FROM sales_ops_funcoes WHERE org_id = ${orgId}`;
      await adminClient`DELETE FROM sales_ops_people WHERE org_id = ${orgId}`;
    }
    await appClient.end();
    await adminClient.end();
  });

  it('resolves concurrent createFuncao calls for the same name to one row plus 409 sentinels, never an unhandled error', async () => {
    const ATTEMPTS = 4;
    const ORGS = 12;
    const orgs = Array.from({ length: ORGS }, (_, index) => newOrg(`create${index}`));

    const settled = await Promise.all(
      orgs.flatMap((orgId) =>
        Array.from({ length: ATTEMPTS }, () =>
          createFuncao(db, orgId, { name: 'Desenvolvedor', status: 'active' }).then(
            (value) => ({ ok: true as const, value }),
            (error: unknown) => ({ ok: false as const, error }),
          ),
        ),
      ),
    );

    const unhandled = settled.filter((outcome) => !outcome.ok);
    expect(
      unhandled.map((outcome) =>
        JSON.stringify({
          message: (outcome as { error: { message?: string } }).error?.message,
          code: (outcome as { error: { cause?: { code?: string } } }).error?.cause?.code,
        }),
      ),
      'a lost createFuncao race must resolve to a sentinel, not raise 23505 as an HTTP 500',
    ).toEqual([]);

    const resolved = settled.flatMap((outcome) => (outcome.ok ? [outcome.value] : []));
    expect(resolved).toHaveLength(ORGS * ATTEMPTS);
    // Every outcome is either the created row or one of the two designed 409
    // reasons - never anything else.
    for (const value of resolved) {
      if (typeof value === 'string') {
        expect(['duplicate', 'duplicate_slug']).toContain(value);
      } else {
        expect(value.slug).toBe('desenvolvedor');
      }
    }
    // Exactly one winner per org, and the data is intact.
    expect(resolved.filter((value) => typeof value !== 'string')).toHaveLength(ORGS);
    for (const orgId of orgs) {
      const rows = await listFuncoes(db, orgId);
      expect(rows.map((funcao) => funcao.slug)).toEqual(['desenvolvedor']);
    }
  });

  it('resolves concurrent updateFuncao renames onto the same name to 409 sentinels, never an unhandled error', async () => {
    const ORGS = 10;
    const orgs = Array.from({ length: ORGS }, (_, index) => newOrg(`rename${index}`));

    // Three distinct funções per org, all renamed onto the same target at once, so
    // two of the three necessarily lose on sales_ops_funcoes_org_name_idx.
    const seeded = await Promise.all(
      orgs.map(async (orgId) => {
        const rows = await Promise.all(
          ['Designer', 'Tester', 'Analista'].map((name) =>
            createFuncao(db, orgId, { name, status: 'active' }),
          ),
        );
        const ids = rows.map((row) => {
          if (typeof row === 'string') throw new Error(`unexpected sentinel: ${row}`);
          return row.id;
        });
        return { orgId, ids };
      }),
    );

    const settled = await Promise.all(
      seeded.flatMap(({ orgId, ids }) =>
        ids.map((id) =>
          updateFuncao(db, orgId, id, { name: 'Product Owner' }, TEST_ACTOR).then(
            (value) => ({ ok: true as const, value }),
            (error: unknown) => ({ ok: false as const, error }),
          ),
        ),
      ),
    );

    const unhandled = settled.filter((outcome) => !outcome.ok);
    expect(
      unhandled.map((outcome) =>
        JSON.stringify({
          message: (outcome as { error: { message?: string } }).error?.message,
          code: (outcome as { error: { cause?: { code?: string } } }).error?.cause?.code,
        }),
      ),
      'a lost updateFuncao rename race must resolve to a sentinel, not raise 23505 as an HTTP 500',
    ).toEqual([]);

    const resolved = settled.flatMap((outcome) => (outcome.ok ? [outcome.value] : []));
    for (const value of resolved) {
      if (typeof value === 'string') {
        expect(['duplicate', 'duplicate_slug']).toContain(value);
      } else {
        expect(value?.name).toBe('Product Owner');
      }
    }
    // The losers must be left untouched, not half-renamed: each org still has its
    // three funções, exactly one of them renamed.
    for (const { orgId } of seeded) {
      const rows = await listFuncoes(db, orgId);
      expect(rows).toHaveLength(3);
      expect(rows.filter((funcao) => funcao.name === 'Product Owner')).toHaveLength(1);
      expect(rows.filter((funcao) => funcao.slug === 'product-owner')).toHaveLength(1);
    }
  });

  it('absorbs a seed conflict on the name index, which a slug-only arbiter cannot see', async () => {
    // The deterministic guard for the on-demand legacy seed's conflict clause.
    //
    // The seed writes both `name` and `slug`, and the table has a unique index on
    // each. A named `(org_id, slug)` arbiter only pre-checks the slug index, so a
    // row that occupies the seed's NAME but not its SLUG is invisible to it: the
    // insert proceeds and Postgres raises 23505 on
    // sales_ops_funcoes_org_name_idx, which escapes as an HTTP 500 and rolls the
    // person create back. A bare `onConflictDoNothing()` covers every unique index.
    //
    // The row below is written with the admin client because no API path produces
    // it (name and slug move together, since the slug is derived from the name).
    // It is the deterministic stand-in for the real race: in the concurrent case
    // the same name-index violation happens in the window between the arbiter
    // pre-check and index insertion, which a test cannot schedule directly.
    const orgId = newOrg('namesquat');
    await adminClient`
      INSERT INTO sales_ops_funcoes (org_id, name, slug, is_system)
      VALUES (${orgId}, 'Prestador', 'prestador-legado', false)
    `;

    const outcome = await createPerson(db, orgId, {
      displayName: 'Joao Boldo',
      status: 'active',
      isCollaborator: true,
    }).then(
      (value) => ({ ok: true as const, value }),
      (error: unknown) => ({ ok: false as const, error }),
    );

    expect(
      outcome.ok
        ? null
        : JSON.stringify({
            code: (outcome.error as { cause?: { code?: string } })?.cause?.code,
            constraint: (outcome.error as { cause?: { constraint_name?: string } })?.cause
              ?.constraint_name,
          }),
      'the seed must absorb the conflict and report a sentinel, never raise 23505',
    ).toBeNull();
    // The name is taken by a row the seed cannot adopt, so this resolves to the
    // ordinary 400 sentinel. The contract being pinned is "never a 500".
    expect(outcome.ok ? outcome.value : null).toBe('unknown_funcao');
    expect(await listPeople(db, orgId)).toEqual([]);

    // Positive control: with the squatting row renamed out of the way, the very
    // same call succeeds and seeds the prestador bucket.
    await adminClient`
      UPDATE sales_ops_funcoes SET name = 'Prestador Legado'
      WHERE org_id = ${orgId} AND slug = 'prestador-legado'
    `;
    const created = await createPerson(db, orgId, {
      displayName: 'Joao Boldo',
      status: 'active',
      isCollaborator: true,
    });
    if (typeof created === 'string') throw new Error(`unexpected sentinel: ${created}`);
    expect(created.funcoes.map((funcao) => funcao.slug)).toEqual(['prestador']);
  });

  it('resolves concurrent first person writes in a freshly provisioned org without an unhandled seed conflict', async () => {
    // The realistic form of the defect above: many freshly provisioned orgs, each
    // taking several concurrent first person writes. The race window is per fresh
    // org (it closes as soon as the org has its funções), so the shape below
    // deliberately maximises fresh orgs rather than attempts per org. Measured
    // against the narrow-arbiter version this reproduces on every run.
    const ATTEMPTS = 5;
    const ORGS = 30;
    const orgs = Array.from({ length: ORGS }, (_, index) => newOrg(`seed${index}`));

    const settled = await Promise.all(
      orgs.flatMap((orgId) =>
        Array.from({ length: ATTEMPTS }, (_, index) =>
          createPerson(db, orgId, {
            displayName: `Pessoa ${index}`,
            status: 'active',
            isSeller: true,
            isFinder: true,
            isCollaborator: true,
          }).then(
            (value) => ({ ok: true as const, value }),
            (error: unknown) => ({ ok: false as const, error }),
          ),
        ),
      ),
    );

    const unhandled = settled.filter((outcome) => !outcome.ok);
    expect(
      unhandled.map((outcome) =>
        JSON.stringify({
          message: (outcome as { error: { message?: string } }).error?.message,
          code: (outcome as { error: { cause?: { code?: string } } }).error?.cause?.code,
          constraint: (outcome as { error: { cause?: { constraint_name?: string } } }).error?.cause
            ?.constraint_name,
        }),
      ),
      'a concurrent on-demand função seed must absorb the conflict, not raise 23505',
    ).toEqual([]);

    // Every person was created, each with all three funções, and the org ended up
    // with exactly one row per slug.
    for (const outcome of settled) {
      if (!outcome.ok) continue;
      expect(typeof outcome.value).not.toBe('string');
      if (typeof outcome.value === 'string') continue;
      expect(outcome.value.funcoes.map((funcao) => funcao.slug).sort()).toEqual([
        'finder',
        'prestador',
        'vendedor',
      ]);
      expect(outcome.value.isSeller).toBe(true);
      expect(outcome.value.isFinder).toBe(true);
      expect(outcome.value.isCollaborator).toBe(true);
    }
    for (const orgId of orgs) {
      const rows = await listFuncoes(db, orgId);
      expect(rows.map((funcao) => funcao.slug).sort()).toEqual(['finder', 'prestador', 'vendedor']);
      expect(await listPeople(db, orgId)).toHaveLength(ATTEMPTS);
    }
  });
});
