/**
 * Slice 02 (org-scoped-history-read) NAMED ORACLE.
 *
 * `audit_log` has NO row level security (verified: relrowsecurity = f) and the
 * ordinary application role `fxl_sales_test` holds SELECT on it, so the tenant
 * connection used here can genuinely read every org's ledger. That is the whole
 * point of this file: the `WHERE actor_org_id = $orgId` predicate inside
 * `listOrgAuditHistory` is the ONE AND ONLY isolation control for this endpoint,
 * and every assertion below is made over that non-superuser connection so that
 * deleting the predicate breaks the suite immediately.
 *
 * The admin (`app.fxl_admin`, `postgres` superuser, BYPASSRLS) client is used
 * ONLY to seed and clean up fixtures. An isolation assertion made over it would
 * prove nothing.
 *
 * Run: pnpm --filter @fxl-sales/api test:integration
 */
import { randomUUID } from 'node:crypto';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as schema from '../../src/db/schema.js';
import { listOrgAuditHistory } from '../../src/domains/audit/history-service.js';

const APP_DB_URL =
  process.env.TEST_DATABASE_URL ??
  process.env.DATABASE_URL ??
  'postgresql://postgres:postgres@localhost:5006/fxl_sales';
const ADMIN_DB_URL = process.env.ADMIN_DATABASE_URL ?? APP_DB_URL;
const ADMIN_CONNECTION_OPTIONS = { connection: { 'app.fxl_admin': 'true' } } as const;

const stamp = `${Date.now()}_${randomUUID().slice(0, 8)}`;

const ORG_A = `org_hist_a_${stamp}`;
const ORG_B = `org_hist_b_${stamp}`;

const ACTOR_SELF = `acct_self_${stamp}`;
const ACTOR_FINDER_A = `acct_finder_a_${stamp}`;
const ACTOR_FINDER_B = `acct_finder_b_${stamp}`;
const ACTOR_STRANGER = `acct_stranger_${stamp}`;
const ACTOR_BLOB = `acct_blob_${stamp}`;

const ACTION_ARCHIVED = `cadastro.archived.${stamp}`;
const ACTION_RESTORED = `cadastro.restored.${stamp}`;
const ACTION_B = `commission.created.${stamp}`;

const ENTITY_TYPE_A = `produto_${stamp}`;
const ENTITY_TYPE_B = `payout_${stamp}`;

const SELF_ACTOR = { userId: ACTOR_SELF, displayName: 'Cauet Pinciara' } as const;

/**
 * The big blob row: no `label`, no `actorLabel`. Its keys must NEVER appear in a
 * serialized response - that is the "the projection is by name, the blob never
 * crossed the wire" half of assertion 11.
 */
const BLOB_ONLY_KEY = `segredoDoBlob_${stamp}`;
const BLOB_ONLY_VALUE = `valor-secreto-${stamp}`;

type SeedRow = {
  org: string | null;
  actor: string;
  action: string;
  entityType: string;
  entityId: string;
  after: Record<string, unknown> | null;
};

/**
 * Insertion order is INTERLEAVED between the two orgs on purpose: `id DESC`
 * must not be able to segregate them by accident.
 */
const SEED_ROWS: SeedRow[] = [
  {
    org: ORG_A,
    actor: ACTOR_SELF,
    action: ACTION_ARCHIVED,
    entityType: ENTITY_TYPE_A,
    entityId: `entity_a_self_${stamp}`,
    // No actorLabel: exercises the self-from-token fallback.
    after: { status: 'archived', label: 'Produto do Self' },
  },
  {
    org: ORG_B,
    actor: `acct_b1_${stamp}`,
    action: ACTION_B,
    entityType: ENTITY_TYPE_B,
    entityId: `entity_b1_${stamp}`,
    after: { status: 'archived', label: 'Nao deve vazar 1' },
  },
  {
    org: ORG_A,
    actor: ACTOR_FINDER_A,
    action: ACTION_ARCHIVED,
    entityType: ENTITY_TYPE_A,
    entityId: `entity_a_finder_a_${stamp}`,
    // No actorLabel: exercises the org-scoped finders lookup.
    after: { status: 'archived', label: 'Produto do Finder A' },
  },
  {
    org: ORG_B,
    actor: `acct_b2_${stamp}`,
    action: ACTION_B,
    entityType: ENTITY_TYPE_B,
    entityId: `entity_b2_${stamp}`,
    after: { status: 'archived', label: 'Nao deve vazar 2' },
  },
  {
    org: ORG_A,
    actor: ACTOR_FINDER_B,
    action: ACTION_ARCHIVED,
    entityType: ENTITY_TYPE_A,
    entityId: `entity_a_finder_b_${stamp}`,
    // The finders row for this account id lives in ORG B. Must resolve to null.
    after: { status: 'archived', label: 'Produto do Finder B' },
  },
  {
    org: ORG_B,
    actor: `acct_b3_${stamp}`,
    action: ACTION_B,
    entityType: ENTITY_TYPE_B,
    entityId: `entity_b3_${stamp}`,
    after: { status: 'archived', label: 'Nao deve vazar 3' },
  },
  {
    org: ORG_A,
    actor: ACTOR_STRANGER,
    action: ACTION_RESTORED,
    entityType: ENTITY_TYPE_A,
    entityId: `entity_a_stranger_${stamp}`,
    // The write-time snapshot: the only branch that can name a third party.
    after: { status: 'archived', label: 'Marketing', actorLabel: 'Terceiro Admin' },
  },
  {
    org: ORG_A,
    actor: ACTOR_BLOB,
    action: ACTION_RESTORED,
    entityType: ENTITY_TYPE_A,
    entityId: `entity_a_blob_${stamp}`,
    after: {
      [BLOB_ONLY_KEY]: BLOB_ONLY_VALUE,
      amountBrl: 1234567,
      contactEmail: `pii-${stamp}@fxl.example`,
    },
  },
  {
    org: null,
    actor: `acct_system_${stamp}`,
    action: ACTION_ARCHIVED,
    entityType: ENTITY_TYPE_A,
    entityId: `entity_null_org_${stamp}`,
    after: { status: 'archived', label: 'Sistema' },
  },
];

const ORG_A_ROWS = SEED_ROWS.filter((row) => row.org === ORG_A);
const ORG_B_ROWS = SEED_ROWS.filter((row) => row.org === ORG_B);

describe('org-scoped audit history read', () => {
  let appClient: postgres.Sql;
  let adminClient: postgres.Sql;
  let db: ReturnType<typeof drizzle<typeof schema>>;

  /** entity_id -> audit_log.id (decimal string), captured at seed time. */
  const seededIds = new Map<string, string>();

  function idFor(entityId: string): string {
    const id = seededIds.get(entityId);
    if (!id) throw new Error(`fixture not seeded: ${entityId}`);
    return id;
  }

  const orgAIds = () => ORG_A_ROWS.map((row) => idFor(row.entityId));
  const orgBIds = () => ORG_B_ROWS.map((row) => idFor(row.entityId));

  beforeAll(async () => {
    appClient = postgres(APP_DB_URL, { max: 3 });
    adminClient = postgres(ADMIN_DB_URL, { max: 2, ...ADMIN_CONNECTION_OPTIONS });
    db = drizzle(appClient, { schema });

    for (const row of SEED_ROWS) {
      // `row.after` is bound as an OBJECT, never as JSON.stringify(row.after):
      // postgres.js applies its own JSON serializer to a `::jsonb` parameter, so
      // a pre-stringified value lands as a jsonb *string* scalar and every
      // `->>` extraction against it silently returns NULL.
      //
      // prev_hash / entry_hash are the documented pre-Phase-05 '' placeholder, so
      // these rows sit OUTSIDE the hash chain (verifyChain and /verify-chain both
      // filter on length(entry_hash) = 64) and cannot perturb the chain
      // assertions in the conversion suites that share this database.
      const [inserted] = await adminClient<{ id: string }[]>`
        INSERT INTO audit_log
          (actor_user_id, actor_org_id, action, entity_type, entity_id, after_jsonb, prev_hash, entry_hash)
        VALUES (
          ${row.actor},
          ${row.org},
          ${row.action},
          ${row.entityType},
          ${row.entityId},
          ${row.after}::jsonb,
          '',
          ''
        )
        RETURNING id::text AS id
      `;
      seededIds.set(row.entityId, inserted.id);
    }

    // finders.account_id is globally UNIQUE, so seeding ACTOR_FINDER_B's row in
    // ORG B is exactly how this test proves the NAME lookup is org-scoped too.
    await adminClient`
      INSERT INTO finders (org_id, account_id, status, display_name, contact_email)
      VALUES
        (${ORG_A}, ${ACTOR_FINDER_A}, 'approved', 'Finder do Org A', ${`finder-a-${stamp}@fxl.example`}),
        (${ORG_B}, ${ACTOR_FINDER_B}, 'approved', 'Finder do Org B', ${`finder-b-${stamp}@fxl.example`})
    `;
  });

  afterAll(async () => {
    // Tail delete, safe only because vitest.config.ts pins fileParallelism: false
    // for the integration project. These rows carry entry_hash = '' so they were
    // never part of the chain in the first place.
    for (const row of SEED_ROWS) {
      await adminClient`DELETE FROM audit_log WHERE entity_id = ${row.entityId}`;
    }
    await adminClient`DELETE FROM finders WHERE org_id IN (${ORG_A}, ${ORG_B})`;
    await appClient.end();
    await adminClient.end();
  });

  it('returns only the caller org rows, newest first (assertions 1 and 2)', async () => {
    const page = await listOrgAuditHistory(db, ORG_A, { selfActor: SELF_ACTOR });
    const ids = page.entries.map((entry) => entry.id);

    // 1. Positive control: exactly org A's ids, ordered by id DESC.
    expect(ids).toEqual([...orgAIds()].sort((a, b) => Number(b) - Number(a)));
    expect(page.entries).toHaveLength(ORG_A_ROWS.length);

    // 2. Cross-org isolation - the reason this slice exists.
    for (const idB of orgBIds()) {
      expect(ids).not.toContain(idB);
    }
    const pageB = await listOrgAuditHistory(db, ORG_B, { selfActor: SELF_ACTOR });
    const idsB = pageB.entries.map((entry) => entry.id);
    expect(idsB).toHaveLength(ORG_B_ROWS.length);
    for (const idA of orgAIds()) {
      expect(idsB).not.toContain(idA);
    }
  });

  it('can actually see org B rows over the same connection (assertion 3)', async () => {
    // Without this, assertion 2 could be passing for the wrong reason - e.g. if
    // the database were silently scoping the read. It is not: audit_log has no
    // RLS and this is the non-superuser app role.
    const ids = orgBIds();
    const rows = await appClient<{ id: string }[]>`
      SELECT id::text AS id FROM audit_log WHERE id::text = ANY(${ids})
    `;
    expect(rows).toHaveLength(ORG_B_ROWS.length);
  });

  it('never returns the NULL-org system row (assertion 4)', async () => {
    const nullOrgId = idFor(`entity_null_org_${stamp}`);
    const pageA = await listOrgAuditHistory(db, ORG_A, { selfActor: SELF_ACTOR });
    const pageB = await listOrgAuditHistory(db, ORG_B, { selfActor: SELF_ACTOR });
    expect(pageA.entries.map((e) => e.id)).not.toContain(nullOrgId);
    expect(pageB.entries.map((e) => e.id)).not.toContain(nullOrgId);
  });

  it('a filter can only narrow, never widen scope (assertion 5)', async () => {
    const byOrgBEntityType = await listOrgAuditHistory(db, ORG_A, {
      entityType: ENTITY_TYPE_B,
      selfActor: SELF_ACTOR,
    });
    expect(byOrgBEntityType).toEqual({ entries: [], nextCursor: null });

    const byOrgBAction = await listOrgAuditHistory(db, ORG_A, {
      actions: [ACTION_B],
      selfActor: SELF_ACTOR,
    });
    expect(byOrgBAction).toEqual({ entries: [], nextCursor: null });

    const byMixedActions = await listOrgAuditHistory(db, ORG_A, {
      actions: [ACTION_ARCHIVED, ACTION_B],
      selfActor: SELF_ACTOR,
    });
    // Narrows within org A, and still cannot reach org B.
    const archivedInA = ORG_A_ROWS.filter((row) => row.action === ACTION_ARCHIVED);
    expect(byMixedActions.entries).toHaveLength(archivedInA.length);
    for (const idB of orgBIds()) {
      expect(byMixedActions.entries.map((e) => e.id)).not.toContain(idB);
    }
  });

  it('the action filter is a SET (assertion 5b)', async () => {
    const archivedInA = ORG_A_ROWS.filter((row) => row.action === ACTION_ARCHIVED);
    const restoredInA = ORG_A_ROWS.filter((row) => row.action === ACTION_RESTORED);
    expect(archivedInA.length).toBeGreaterThan(0);
    expect(restoredInA.length).toBeGreaterThan(0);

    const both = await listOrgAuditHistory(db, ORG_A, {
      actions: [ACTION_ARCHIVED, ACTION_RESTORED],
      selfActor: SELF_ACTOR,
    });
    expect(both.entries).toHaveLength(archivedInA.length + restoredInA.length);

    const onlyArchived = await listOrgAuditHistory(db, ORG_A, {
      actions: [ACTION_ARCHIVED],
      selfActor: SELF_ACTOR,
    });
    expect(onlyArchived.entries).toHaveLength(archivedInA.length);

    // An empty set is "no filter at all", never a false predicate or a throw.
    const emptySet = await listOrgAuditHistory(db, ORG_A, {
      actions: [],
      selfActor: SELF_ACTOR,
    });
    expect(emptySet.entries).toHaveLength(ORG_A_ROWS.length);
  });

  it('fails closed on a blank org id (assertion 6)', async () => {
    await expect(listOrgAuditHistory(db, '')).rejects.toThrow('org_id_required');
    await expect(listOrgAuditHistory(db, '   ')).rejects.toThrow('org_id_required');
  });

  it('keyset paging is stable, scoped and honest about the last page (assertion 7)', async () => {
    const expected = [...orgAIds()].sort((a, b) => Number(b) - Number(a));
    const seen: string[] = [];
    let cursor: string | undefined;
    let lastCursor: string | null = null;

    for (let guard = 0; guard < 20; guard += 1) {
      const page: Awaited<ReturnType<typeof listOrgAuditHistory>> = await listOrgAuditHistory(
        db,
        ORG_A,
        { limit: 2, cursor, selfActor: SELF_ACTOR },
      );
      expect(page.entries.length).toBeGreaterThan(0);
      expect(page.entries.length).toBeLessThanOrEqual(2);
      for (const entry of page.entries) {
        expect(orgBIds()).not.toContain(entry.id);
        expect(seen).not.toContain(entry.id);
        seen.push(entry.id);
      }
      lastCursor = page.nextCursor;
      if (page.nextCursor === null) break;
      cursor = page.nextCursor;
    }

    expect(seen).toEqual(expected);
    expect(lastCursor).toBeNull();

    // The whole point of fetching limit + 1: an EXACTLY full last page still
    // reports nextCursor === null, so slice 04's truncation footer is honest.
    const exact = await listOrgAuditHistory(db, ORG_A, {
      limit: ORG_A_ROWS.length,
      selfActor: SELF_ACTOR,
    });
    expect(exact.entries).toHaveLength(ORG_A_ROWS.length);
    expect(exact.nextCursor).toBeNull();
  });

  it('serializes without a BigInt hazard (assertion 8)', async () => {
    const result = await listOrgAuditHistory(db, ORG_A, { limit: 2, selfActor: SELF_ACTOR });
    expect(typeof result.entries[0]!.id).toBe('string');
    expect(['string', 'object']).toContain(typeof result.nextCursor);
    expect(() => JSON.stringify(result)).not.toThrow();

    const last = await listOrgAuditHistory(db, ORG_A, { selfActor: SELF_ACTOR });
    expect(last.nextCursor).toBeNull();
    expect(() => JSON.stringify(last)).not.toThrow();
  });

  it('exposes exactly the eight contract keys (assertion 9)', async () => {
    const result = await listOrgAuditHistory(db, ORG_A, { selfActor: SELF_ACTOR });
    for (const entry of result.entries) {
      expect(Object.keys(entry).sort()).toEqual([
        'action',
        'actorDisplayName',
        'actorUserId',
        'entityId',
        'entityLabel',
        'entityType',
        'id',
        'ts',
      ]);
    }
    const serialized = JSON.stringify(result);
    for (const forbidden of [
      'beforeJsonb',
      'afterJsonb',
      'prevHash',
      'entryHash',
      'requestId',
      'actorOrgId',
      'actorLabelSnapshot',
    ]) {
      expect(serialized).not.toContain(forbidden);
    }
  });

  it('resolves the actor name through all four branches (assertion 10)', async () => {
    const result = await listOrgAuditHistory(db, ORG_A, { selfActor: SELF_ACTOR });
    const byEntity = new Map(result.entries.map((entry) => [entry.entityId, entry]));

    // 0. Write-time snapshot wins, and is the only branch that names a third party.
    expect(byEntity.get(`entity_a_stranger_${stamp}`)?.actorDisplayName).toBe('Terceiro Admin');
    // 1. Self, from the verified token.
    expect(byEntity.get(`entity_a_self_${stamp}`)?.actorDisplayName).toBe('Cauet Pinciara');
    // 2. finders, org-scoped.
    expect(byEntity.get(`entity_a_finder_a_${stamp}`)?.actorDisplayName).toBe('Finder do Org A');
    // 2b. The same lookup is itself org-scoped: this finders row lives in ORG B.
    expect(byEntity.get(`entity_a_finder_b_${stamp}`)?.actorDisplayName).toBeNull();
    // 3. Otherwise null.
    expect(byEntity.get(`entity_a_blob_${stamp}`)?.actorDisplayName).toBeNull();

    for (const entry of result.entries) {
      expect(entry.actorDisplayName).not.toBe(entry.actorUserId);
    }
  });

  it('extracts entityLabel by name and never ships the blob (assertion 11)', async () => {
    const result = await listOrgAuditHistory(db, ORG_A, { selfActor: SELF_ACTOR });
    const byEntity = new Map(result.entries.map((entry) => [entry.entityId, entry]));

    expect(byEntity.get(`entity_a_stranger_${stamp}`)?.entityLabel).toBe('Marketing');
    expect(byEntity.get(`entity_a_blob_${stamp}`)?.entityLabel).toBeNull();

    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain(BLOB_ONLY_KEY);
    expect(serialized).not.toContain(BLOB_ONLY_VALUE);
    expect(serialized).not.toContain('1234567');
    expect(serialized).not.toContain(`pii-${stamp}@fxl.example`);
  });
});
