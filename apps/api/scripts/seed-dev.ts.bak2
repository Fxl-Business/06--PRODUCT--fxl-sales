/**
 * The deterministic, idempotent LOCAL-ONLY development seed for the dev-fake
 * identity roster.
 *
 * This is the THIRD entrypoint guarded by `assertLocalDatabase`, and it is the
 * second most dangerous one in the tree after `migrate.ts`, because it DELETES
 * rows before it inserts them. `scripts/__tests__/local-database-guard.test.mjs`
 * is extended in the SAME change to prove this file still calls the guard, still
 * loads its environment only through `loadEnvFiles`, and never regains a raw
 * `dotenv/config` import - see CLAUDE.md's "Local database guard" section.
 *
 * Run with: pnpm --filter @fxl-sales/api db:seed:dev
 */

// ONLY these three static imports. Every one of them is pure with respect to
// the database and the Hub configuration. Everything else - the roster,
// getDb, withTenant, closeDb, the schema tables and drizzle-orm's `eq` - is
// loaded with `await import(...)` INSIDE main(), for the same reason
// server.ts does it: ESM evaluates the entire static import graph before the
// first statement of this module runs, and a static import reaching
// ../src/middleware/app-auth.js (which loads the Hub configuration at module
// top level) would throw there, burying the guard's verdict.
import { API_ROOT_DIR, loadEnvFiles } from '../src/config/env-files.js';
import { assertLocalDatabase, describeDatabaseTarget } from '../src/db/local-database-guard.js';
import {
  assertFakeOrgIds,
  buildDevSeedPlan,
  parseSeedCutoff,
  SEED_DELETE_ORDER,
  SEED_WRITE_ORDER,
} from './seed/plan.js';
// Type-only: erased entirely at compile time, so this adds no runtime import
// and cannot affect the module-evaluation ordering the comment above protects.
import type {
  AreaRow,
  ClientRow,
  DevSeedPlan,
  FuncaoRow,
  LeadProductRow,
  LeadRow,
  LeadStageRow,
  PayableRow,
  PersonFuncaoRow,
  PersonRow,
  ProductFuncaoCostRow,
  ProductRow,
  ReceivableRow,
  SaleItemRow,
  SaleProfessionalRow,
  SaleRow,
  SeedIdentity,
  SettingsRow,
} from './seed/plan.js';

const SEED_CUTOFF_DEFAULT = '2026-09-01';
const CUTOFF_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function resolveCutoffIso(): string {
  const raw = process.env.SEED_CUTOFF;
  if (typeof raw === 'string' && CUTOFF_PATTERN.test(raw)) return raw;
  return SEED_CUTOFF_DEFAULT;
}

// The exact order `plan.ts` exports, restated here so a divergence between the
// plan's order and this writer's operations throws immediately rather than
// silently reordering deletes or inserts around a restrict FK.
const EXPECTED_DELETE_ORDER = [
  'salesOpsPayables',
  'salesOpsReceivables',
  'salesOpsSaleProfessionals',
  'salesOpsSaleItems',
  'salesOpsLeadProducts',
  'salesOpsLeads',
  'salesOpsSales',
  'salesOpsLeadStages',
  'salesOpsProductFuncaoCosts',
  'salesOpsProducts',
  'salesOpsPersonFuncoes',
  'salesOpsPeople',
  'salesOpsFuncoes',
  'salesOpsClients',
  'salesOpsAreas',
  'salesOpsSettings',
] as const;

const EXPECTED_WRITE_ORDER = [
  'salesOpsSettings',
  'salesOpsAreas',
  'salesOpsFuncoes',
  'salesOpsPeople',
  'salesOpsPersonFuncoes',
  'salesOpsClients',
  'salesOpsProducts',
  'salesOpsProductFuncaoCosts',
  'salesOpsLeadStages',
  'salesOpsSales',
  'salesOpsSaleItems',
  'salesOpsSaleProfessionals',
  'salesOpsReceivables',
  'salesOpsPayables',
  'salesOpsLeads',
  'salesOpsLeadProducts',
] as const;

function assertOrderMatches(actual: readonly string[], expected: readonly string[], label: string): void {
  const drifted = actual.length !== expected.length || actual.some((value, i) => value !== expected[i]);
  if (drifted) {
    throw new Error(
      `[seed] ${label} in apps/api/scripts/seed/plan.ts no longer matches the order ` +
        'apps/api/scripts/seed-dev.ts writes in. Update the writer to match before seeding.',
    );
  }
}

// ── Row -> insert-shape mappers. Each converts the plan's ISO-string
// timestamps to the Date objects the schema's timestamp columns expect, and
// changes nothing else. ──────────────────────────────────────────────────────

function toSettingsInsert(row: SettingsRow) {
  return { ...row, createdAt: new Date(row.createdAt), updatedAt: new Date(row.updatedAt) };
}

function toAreaInsert(row: AreaRow) {
  return {
    ...row,
    archivedAt: row.archivedAt ? new Date(row.archivedAt) : null,
    createdAt: new Date(row.createdAt),
    updatedAt: new Date(row.updatedAt),
  };
}

function toFuncaoInsert(row: FuncaoRow) {
  return {
    ...row,
    archivedAt: row.archivedAt ? new Date(row.archivedAt) : null,
    createdAt: new Date(row.createdAt),
    updatedAt: new Date(row.updatedAt),
  };
}

function toPersonInsert(row: PersonRow) {
  return {
    ...row,
    archivedAt: row.archivedAt ? new Date(row.archivedAt) : null,
    createdAt: new Date(row.createdAt),
    updatedAt: new Date(row.updatedAt),
  };
}

function toPersonFuncaoInsert(row: PersonFuncaoRow) {
  return { ...row, createdAt: new Date(row.createdAt) };
}

function toClientInsert(row: ClientRow) {
  return { ...row, createdAt: new Date(row.createdAt), updatedAt: new Date(row.updatedAt) };
}

function toProductInsert(row: ProductRow) {
  return {
    ...row,
    archivedAt: row.archivedAt ? new Date(row.archivedAt) : null,
    createdAt: new Date(row.createdAt),
    updatedAt: new Date(row.updatedAt),
  };
}

function toProductFuncaoCostInsert(row: ProductFuncaoCostRow) {
  return { ...row, createdAt: new Date(row.createdAt), updatedAt: new Date(row.updatedAt) };
}

function toLeadStageInsert(row: LeadStageRow) {
  return {
    ...row,
    archivedAt: row.archivedAt ? new Date(row.archivedAt) : null,
    createdAt: new Date(row.createdAt),
    updatedAt: new Date(row.updatedAt),
  };
}

function toSaleInsert(row: SaleRow) {
  return {
    ...row,
    wonAt: row.wonAt ? new Date(row.wonAt) : null,
    lostAt: row.lostAt ? new Date(row.lostAt) : null,
    baseDate: new Date(row.baseDate),
    createdAt: new Date(row.createdAt),
    updatedAt: new Date(row.updatedAt),
  };
}

function toSaleItemInsert(row: SaleItemRow) {
  return { ...row };
}

function toSaleProfessionalInsert(row: SaleProfessionalRow) {
  return { ...row };
}

function toReceivableInsert(row: ReceivableRow) {
  return { ...row, dueDate: new Date(row.dueDate) };
}

function toPayableInsert(row: PayableRow) {
  return { ...row, dueDate: new Date(row.dueDate) };
}

function toLeadInsert(row: LeadRow) {
  return {
    ...row,
    stageChangedAt: new Date(row.stageChangedAt),
    createdAt: new Date(row.createdAt),
    updatedAt: new Date(row.updatedAt),
  };
}

function toLeadProductInsert(row: LeadProductRow) {
  return { ...row, createdAt: new Date(row.createdAt) };
}

async function main(): Promise<void> {
  assertOrderMatches(SEED_DELETE_ORDER, EXPECTED_DELETE_ORDER, 'SEED_DELETE_ORDER');
  assertOrderMatches(SEED_WRITE_ORDER, EXPECTED_WRITE_ORDER, 'SEED_WRITE_ORDER');

  // Step 1: the ONE shared resolver, never a bare `import 'dotenv/config'`.
  const { namedEnvFile } = loadEnvFiles({ baseDir: API_ROOT_DIR, bag: process.env });

  // Step 2: after loadEnvFiles, because dotenv populates process.env inside it.
  if (!process.env.DATABASE_URL) {
    console.error('DATABASE_URL is required');
    process.exit(1);
  }

  // Step 3: the guard, with namedEnvFile HARD-CODED to null. This entrypoint
  // deletes rows, so SALES_ENV_FILE - the escape hatch that lets `make
  // back-stg` reach staging on purpose - does not apply here: a named file
  // that resolves to a remote DATABASE_URL is still refused.
  const databaseViolations = assertLocalDatabase({
    nodeEnv: process.env.NODE_ENV ?? '',
    databaseUrl: process.env.DATABASE_URL,
    namedEnvFile: null,
  });
  if (databaseViolations.length > 0) {
    for (const line of databaseViolations) console.error(line);
    console.error(
      '[local-database-guard] This seed has no named-env-file escape hatch, because it deletes ' +
        'rows: point DATABASE_URL at the local database instead.',
    );
    process.exit(1);
  }

  // Step 4: the roster, dynamically imported and mapped onto SeedIdentity[].
  // This is the ONE place in this file that knows the roster's real field
  // names.
  const { allFakeOrgIds, IDENTITIES } = await import('@fxl-sales/auth-fake');
  const identities: SeedIdentity[] = IDENTITIES.map((identity) => ({
    accountId: identity.accountId,
    workspaceIds: identity.workspaces.map((workspace) => workspace.workspaceId),
    workspaceRole: identity.workspaceRole,
    productRoles: identity.productRoles ? [...identity.productRoles] : [],
    name: identity.profile.name,
    email: identity.profile.email,
  }));
  const orgIds = allFakeOrgIds();

  const orgViolations = assertFakeOrgIds(orgIds);
  if (orgViolations.length > 0) {
    for (const line of orgViolations) console.error(line);
    process.exit(1);
  }

  // Step 5: one boot line, host and port only.
  if ((process.env.NODE_ENV ?? 'development') !== 'production') {
    const target = describeDatabaseTarget(process.env.DATABASE_URL);
    console.log(
      target
        ? `[fxl-sales-seed] database host=${target.host} port=${target.port}`
        : '[fxl-sales-seed] database target unknown - DATABASE_URL does not parse',
    );
  }
  if (namedEnvFile) {
    console.log(`[fxl-sales-seed] named env file loaded: ${namedEnvFile}`);
  }

  const cutoff = parseSeedCutoff(resolveCutoffIso());
  const plan: DevSeedPlan = buildDevSeedPlan({ orgIds, identities, cutoff });

  // Step 6: everything database-shaped loads here, after the guard has had its
  // say.
  const { getDb, closeDb } = await import('../src/db/client.js');
  const { withTenant } = await import('../src/domains/sales-ops/service.js');
  const schema = await import('../src/db/schema.js');
  const { eq } = await import('drizzle-orm');

  const db = getDb();

  for (const orgId of orgIds) {
    await withTenant(db, orgId, async (tx) => {
      // Deletes: children first, every one scoped by org_id, in
      // SEED_DELETE_ORDER.
      await tx.delete(schema.salesOpsPayables).where(eq(schema.salesOpsPayables.orgId, orgId));
      await tx
        .delete(schema.salesOpsReceivables)
        .where(eq(schema.salesOpsReceivables.orgId, orgId));
      await tx
        .delete(schema.salesOpsSaleProfessionals)
        .where(eq(schema.salesOpsSaleProfessionals.orgId, orgId));
      await tx.delete(schema.salesOpsSaleItems).where(eq(schema.salesOpsSaleItems.orgId, orgId));
      await tx
        .delete(schema.salesOpsLeadProducts)
        .where(eq(schema.salesOpsLeadProducts.orgId, orgId));
      await tx.delete(schema.salesOpsLeads).where(eq(schema.salesOpsLeads.orgId, orgId));
      await tx.delete(schema.salesOpsSales).where(eq(schema.salesOpsSales.orgId, orgId));
      await tx
        .delete(schema.salesOpsLeadStages)
        .where(eq(schema.salesOpsLeadStages.orgId, orgId));
      await tx
        .delete(schema.salesOpsProductFuncaoCosts)
        .where(eq(schema.salesOpsProductFuncaoCosts.orgId, orgId));
      await tx.delete(schema.salesOpsProducts).where(eq(schema.salesOpsProducts.orgId, orgId));
      await tx
        .delete(schema.salesOpsPersonFuncoes)
        .where(eq(schema.salesOpsPersonFuncoes.orgId, orgId));
      await tx.delete(schema.salesOpsPeople).where(eq(schema.salesOpsPeople.orgId, orgId));
      await tx.delete(schema.salesOpsFuncoes).where(eq(schema.salesOpsFuncoes.orgId, orgId));
      await tx.delete(schema.salesOpsClients).where(eq(schema.salesOpsClients.orgId, orgId));
      await tx.delete(schema.salesOpsAreas).where(eq(schema.salesOpsAreas.orgId, orgId));
      await tx.delete(schema.salesOpsSettings).where(eq(schema.salesOpsSettings.orgId, orgId));

      // Inserts: parents first, in SEED_WRITE_ORDER, taken straight from
      // plan.rows and filtered to this org. No read-back of a generated id, no
      // conditional read, no per-org branching.
      const orgSettings = plan.rows.salesOpsSettings.filter((row) => row.orgId === orgId);
      if (orgSettings.length > 0) {
        await tx.insert(schema.salesOpsSettings).values(orgSettings.map(toSettingsInsert));
      }

      const orgAreas = plan.rows.salesOpsAreas.filter((row) => row.orgId === orgId);
      if (orgAreas.length > 0) {
        await tx.insert(schema.salesOpsAreas).values(orgAreas.map(toAreaInsert));
      }

      const orgFuncoes = plan.rows.salesOpsFuncoes.filter((row) => row.orgId === orgId);
      if (orgFuncoes.length > 0) {
        await tx.insert(schema.salesOpsFuncoes).values(orgFuncoes.map(toFuncaoInsert));
      }

      const orgPeople = plan.rows.salesOpsPeople.filter((row) => row.orgId === orgId);
      if (orgPeople.length > 0) {
        await tx.insert(schema.salesOpsPeople).values(orgPeople.map(toPersonInsert));
      }

      const orgPersonFuncoes = plan.rows.salesOpsPersonFuncoes.filter(
        (row) => row.orgId === orgId,
      );
      if (orgPersonFuncoes.length > 0) {
        await tx
          .insert(schema.salesOpsPersonFuncoes)
          .values(orgPersonFuncoes.map(toPersonFuncaoInsert));
      }

      const orgClients = plan.rows.salesOpsClients.filter((row) => row.orgId === orgId);
      if (orgClients.length > 0) {
        await tx.insert(schema.salesOpsClients).values(orgClients.map(toClientInsert));
      }

      const orgProducts = plan.rows.salesOpsProducts.filter((row) => row.orgId === orgId);
      if (orgProducts.length > 0) {
        await tx.insert(schema.salesOpsProducts).values(orgProducts.map(toProductInsert));
      }

      const orgProductFuncaoCosts = plan.rows.salesOpsProductFuncaoCosts.filter(
        (row) => row.orgId === orgId,
      );
      if (orgProductFuncaoCosts.length > 0) {
        await tx
          .insert(schema.salesOpsProductFuncaoCosts)
          .values(orgProductFuncaoCosts.map(toProductFuncaoCostInsert));
      }

      const orgLeadStages = plan.rows.salesOpsLeadStages.filter((row) => row.orgId === orgId);
      if (orgLeadStages.length > 0) {
        await tx.insert(schema.salesOpsLeadStages).values(orgLeadStages.map(toLeadStageInsert));
      }

      const orgSales = plan.rows.salesOpsSales.filter((row) => row.orgId === orgId);
      if (orgSales.length > 0) {
        await tx.insert(schema.salesOpsSales).values(orgSales.map(toSaleInsert));
      }

      const orgSaleItems = plan.rows.salesOpsSaleItems.filter((row) => row.orgId === orgId);
      if (orgSaleItems.length > 0) {
        await tx.insert(schema.salesOpsSaleItems).values(orgSaleItems.map(toSaleItemInsert));
      }

      const orgSaleProfessionals = plan.rows.salesOpsSaleProfessionals.filter(
        (row) => row.orgId === orgId,
      );
      if (orgSaleProfessionals.length > 0) {
        await tx
          .insert(schema.salesOpsSaleProfessionals)
          .values(orgSaleProfessionals.map(toSaleProfessionalInsert));
      }

      const orgReceivables = plan.rows.salesOpsReceivables.filter((row) => row.orgId === orgId);
      if (orgReceivables.length > 0) {
        await tx.insert(schema.salesOpsReceivables).values(orgReceivables.map(toReceivableInsert));
      }

      const orgPayables = plan.rows.salesOpsPayables.filter((row) => row.orgId === orgId);
      if (orgPayables.length > 0) {
        await tx.insert(schema.salesOpsPayables).values(orgPayables.map(toPayableInsert));
      }

      const orgLeads = plan.rows.salesOpsLeads.filter((row) => row.orgId === orgId);
      if (orgLeads.length > 0) {
        await tx.insert(schema.salesOpsLeads).values(orgLeads.map(toLeadInsert));
      }

      const orgLeadProducts = plan.rows.salesOpsLeadProducts.filter(
        (row) => row.orgId === orgId,
      );
      if (orgLeadProducts.length > 0) {
        await tx.insert(schema.salesOpsLeadProducts).values(orgLeadProducts.map(toLeadProductInsert));
      }
    });
  }

  // Step 7: a one-line summary, then close the pool so the process exits.
  const totalRows = Object.values(plan.rows).reduce((sum, rows) => sum + rows.length, 0);
  console.log(`[fxl-sales-seed] seeded ${orgIds.length} org(s), ${totalRows} row(s) total.`);
  await closeDb();
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[seed] FAILED: ${message}`);
  process.exit(1);
});
