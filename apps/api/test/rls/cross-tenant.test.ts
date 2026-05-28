/**
 * Cross-tenant RLS integration tests (D-G).
 *
 * Requires Docker Postgres running + migrations applied (vitest globalSetup —
 * see test/rls/global-setup.ts).
 * Run with: pnpm --filter @fxl-finders/api test:integration
 *
 * CRITICAL (D-G): the test connection authenticates as fxl_finders_app, NOT the
 * postgres superuser. The postgres superuser and the fxl_finders_admin BYPASSRLS
 * role both BYPASS RLS — testing as either proves NOTHING. A beforeAll guard
 * fails loudly if TEST_DATABASE_URL points at a superuser/BYPASSRLS role.
 *
 * Coverage for the two tenant-scoped tables (finders, leads):
 *   1. positive control — org A reads its own row → exactly 1 row
 *   2. cross-org-zero  — org B reads org A's row by PK → 0 rows
 *   3. WITH CHECK      — org A inserting a row claiming org B's org_id → rejected
 *   4. UPDATE path     — org B UPDATE of org A's row → 0 rows; org A own UPDATE → 1 row
 */
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// fxl_finders_app login — NOT postgres. globalSetup applies migrations first
// (with an owner/superuser URL); this URL is the RLS-enforced runtime role.
const TEST_DB_URL =
  process.env.TEST_DATABASE_URL ??
  'postgresql://fxl_finders_app:fxl_finders_app@localhost:5006/fxl_finders';

// Owner/superuser URL used ONLY for test-row cleanup (the app role is granted
// SELECT/INSERT/UPDATE but not DELETE in the Phase 01 migration).
const CLEANUP_DB_URL =
  process.env.TEST_MIGRATE_DATABASE_URL ??
  process.env.MIGRATE_DATABASE_URL ??
  'postgresql://postgres:postgres@localhost:5006/fxl_finders';

describe('RLS: cross-tenant isolation (as fxl_finders_app)', () => {
  let sql: postgres.Sql;
  let cleanup: postgres.Sql;

  beforeAll(async () => {
    sql = postgres(TEST_DB_URL);
    cleanup = postgres(CLEANUP_DB_URL);
    // Guard: fail loudly if someone points TEST_DATABASE_URL at a superuser/BYPASSRLS role.
    const rows = await sql<{ rolsuper: boolean; rolbypassrls: boolean; current_user: string }[]>`
      SELECT rolsuper, rolbypassrls, current_user
      FROM pg_roles WHERE rolname = current_user
    `;
    const me = rows[0];
    if (!me) throw new Error('could not resolve current_user role');
    if (me.rolsuper || me.rolbypassrls) {
      throw new Error(
        `RLS tests must run as a non-superuser, non-BYPASSRLS role; got ${me.current_user}`,
      );
    }
  });

  afterAll(async () => {
    await sql.end();
    await cleanup.end();
  });

  // ── finders ────────────────────────────────────────────────────────────────
  it('finders: positive control + cross-org-zero + UPDATE path', async () => {
    const ORG_A = 'org_test_a_' + Date.now();
    const ORG_B = 'org_test_b_' + Date.now();

    // Insert as org_A.
    const [inserted] = await sql.begin(async (tx) => {
      await tx`SELECT set_config('app.current_org_id', ${ORG_A}, true)`;
      return tx`
        INSERT INTO finders (org_id, clerk_user_id, clerk_org_id, status, display_name, contact_email)
        VALUES (${ORG_A}, ${'usr_test_' + Date.now()}, ${'corg_' + Date.now()}, 'pending', 'Test Finder A', 'a@test.com')
        RETURNING id
      `;
    });
    const id = (inserted as { id: string }).id;

    // (1) POSITIVE CONTROL — org_A reads its own row → exactly 1 row.
    const ownRows = await sql.begin(async (tx) => {
      await tx`SELECT set_config('app.current_org_id', ${ORG_A}, true)`;
      return tx`SELECT id FROM finders WHERE id = ${id}`;
    });
    expect(ownRows).toHaveLength(1);

    // (2) CROSS-ORG-ZERO — org_B cannot read org_A row → 0 rows.
    const otherRows = await sql.begin(async (tx) => {
      await tx`SELECT set_config('app.current_org_id', ${ORG_B}, true)`;
      return tx`SELECT id FROM finders WHERE id = ${id}`;
    });
    expect(otherRows).toHaveLength(0);

    // (4a) UPDATE PATH — org_B cannot update org_A's row → 0 rows affected.
    const crossUpdate = await sql.begin(async (tx) => {
      await tx`SELECT set_config('app.current_org_id', ${ORG_B}, true)`;
      return tx`UPDATE finders SET display_name = 'hijacked' WHERE id = ${id} RETURNING id`;
    });
    expect(crossUpdate).toHaveLength(0);

    // (4b) UPDATE PATH — org_A updates its own row → 1 row affected.
    const ownUpdate = await sql.begin(async (tx) => {
      await tx`SELECT set_config('app.current_org_id', ${ORG_A}, true)`;
      return tx`UPDATE finders SET display_name = 'renamed' WHERE id = ${id} RETURNING id`;
    });
    expect(ownUpdate).toHaveLength(1);

    // Cleanup via owner connection (app role has no DELETE grant).
    await cleanup`DELETE FROM finders WHERE id = ${id}`;
  });

  it('finders: WITH CHECK prevents cross-org insert', async () => {
    const ORG_A = 'org_test_a_' + Date.now();
    const ORG_B = 'org_test_b_' + Date.now();
    await expect(
      sql.begin(async (tx) => {
        await tx`SELECT set_config('app.current_org_id', ${ORG_A}, true)`;
        return tx`
          INSERT INTO finders (org_id, clerk_user_id, clerk_org_id, status, display_name, contact_email)
          VALUES (${ORG_B}, ${'usr_check_' + Date.now()}, ${'corg_chk_' + Date.now()}, 'pending', 'Smuggler', 'x@test.com')
          RETURNING id
        `;
      }),
    ).rejects.toThrow(); // Postgres raises on WITH CHECK violation.
  });

  // ── leads ───────────────────────────────────────────────────────────────────
  it('leads: positive control + cross-org-zero + UPDATE path', async () => {
    const ORG_A = 'org_test_a_' + Date.now();
    const ORG_B = 'org_test_b_' + Date.now();

    const [inserted] = await sql.begin(async (tx) => {
      await tx`SELECT set_config('app.current_org_id', ${ORG_A}, true)`;
      return tx`INSERT INTO leads (org_id, status) VALUES (${ORG_A}, 'clicked') RETURNING id`;
    });
    const id = (inserted as { id: string }).id;

    const ownRows = await sql.begin(async (tx) => {
      await tx`SELECT set_config('app.current_org_id', ${ORG_A}, true)`;
      return tx`SELECT id FROM leads WHERE id = ${id}`;
    });
    expect(ownRows).toHaveLength(1); // positive control

    const otherRows = await sql.begin(async (tx) => {
      await tx`SELECT set_config('app.current_org_id', ${ORG_B}, true)`;
      return tx`SELECT id FROM leads WHERE id = ${id}`;
    });
    expect(otherRows).toHaveLength(0); // cross-org-zero

    const crossUpdate = await sql.begin(async (tx) => {
      await tx`SELECT set_config('app.current_org_id', ${ORG_B}, true)`;
      return tx`UPDATE leads SET status = 'lead' WHERE id = ${id} RETURNING id`;
    });
    expect(crossUpdate).toHaveLength(0); // UPDATE isolation

    const ownUpdate = await sql.begin(async (tx) => {
      await tx`SELECT set_config('app.current_org_id', ${ORG_A}, true)`;
      return tx`UPDATE leads SET status = 'lead' WHERE id = ${id} RETURNING id`;
    });
    expect(ownUpdate).toHaveLength(1); // own UPDATE allowed

    await cleanup`DELETE FROM leads WHERE id = ${id}`;
  });

  it('leads: WITH CHECK prevents cross-org insert', async () => {
    const ORG_A = 'org_test_a_' + Date.now();
    const ORG_B = 'org_test_b_' + Date.now();
    await expect(
      sql.begin(async (tx) => {
        await tx`SELECT set_config('app.current_org_id', ${ORG_A}, true)`;
        return tx`INSERT INTO leads (org_id, status) VALUES (${ORG_B}, 'clicked') RETURNING id`;
      }),
    ).rejects.toThrow();
  });
});
