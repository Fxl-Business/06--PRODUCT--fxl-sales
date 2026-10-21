/**
 * The per-organization module flags (`sales_ops_org_modules`).
 *
 * The token's `entitlements.modules` is consulted ONLY here, and only for an
 * organization with no row at all: that one-time backfill reproduces the edition the
 * organization had before modules existed. After it, the database decides.
 */
import {
  CRM_MODULE_KEYS,
  CRM_MODULE_SOURCES,
  isCrmModuleKey,
  modulesForEdition,
  type CrmModuleKey,
  type CrmModuleSource,
  type OrgModules,
} from '@fxl-sales/shared-utils/crm-model';
import { resolveSalesEdition } from '@fxl-sales/shared-utils/sales-edition';
import { eq, sql } from 'drizzle-orm';
import { getDb } from '../../db/client.js';
import { salesOpsOrgModules } from '../../db/schema.js';
import { withTenant } from '../sales-ops/leads/with-tenant.js';

type Db = ReturnType<typeof getDb>;

export type OrgModuleSources = Record<CrmModuleKey, CrmModuleSource>;
export interface OrgModulesState {
  modules: OrgModules;
  sources: OrgModuleSources;
}
export type OrgModulesPatch = Partial<Record<CrmModuleKey, boolean>>;

type ModuleRow = typeof salesOpsOrgModules.$inferSelect;

function isModuleSource(value: string): value is CrmModuleSource {
  return (CRM_MODULE_SOURCES as readonly string[]).includes(value);
}

function stateFromRows(rows: readonly ModuleRow[]): OrgModulesState {
  const modules = {} as OrgModules;
  const sources = {} as OrgModuleSources;
  for (const key of CRM_MODULE_KEYS) {
    modules[key] = false;
    sources[key] = 'default';
  }
  for (const row of rows) {
    if (!isCrmModuleKey(row.moduleKey)) continue;
    modules[row.moduleKey] = row.enabled;
    sources[row.moduleKey] = isModuleSource(row.source) ? row.source : 'default';
  }
  return { modules, sources };
}

async function readRows(tx: Db, orgId: string): Promise<ModuleRow[]> {
  return tx.select().from(salesOpsOrgModules).where(eq(salesOpsOrgModules.orgId, orgId));
}

/**
 * Returns the org's rows, writing the one-time compat backfill first when it has none.
 * MUST run inside a tenant transaction.
 */
async function ensureRows(
  tx: Db,
  orgId: string,
  tokenModules: readonly unknown[] | null | undefined,
): Promise<ModuleRow[]> {
  const existing = await readRows(tx, orgId);
  if (existing.length > 0) return existing;

  // Serialize first backfills of the same org: the loser blocks here, then re-reads.
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`org-modules:${orgId}`}, 0))`);
  const again = await readRows(tx, orgId);
  if (again.length > 0) return again;

  const seed = modulesForEdition(resolveSalesEdition(tokenModules));
  await tx
    .insert(salesOpsOrgModules)
    .values(
      CRM_MODULE_KEYS.map((moduleKey) => ({
        orgId,
        moduleKey,
        enabled: seed[moduleKey],
        source: 'token_backfill' as const,
      })),
    )
    .onConflictDoNothing({ target: [salesOpsOrgModules.orgId, salesOpsOrgModules.moduleKey] });
  return readRows(tx, orgId);
}

/** The org's modules, backfilled from the token on first sight. One transaction. */
export async function loadOrgModules(
  orgId: string,
  tokenModules: readonly unknown[] | null | undefined,
  db: Db = getDb(),
): Promise<OrgModulesState> {
  return withTenant(db, orgId, async (tx) => stateFromRows(await ensureRows(tx, orgId, tokenModules)));
}

/** Admin toggle: ensure the backfill, then upsert the patched keys as source 'admin'. */
export async function updateOrgModules(
  orgId: string,
  tokenModules: readonly unknown[] | null | undefined,
  patch: OrgModulesPatch,
  db: Db = getDb(),
): Promise<OrgModulesState> {
  return withTenant(db, orgId, async (tx) => {
    await ensureRows(tx, orgId, tokenModules);
    for (const key of CRM_MODULE_KEYS) {
      const enabled = patch[key];
      if (enabled === undefined) continue;
      await tx
        .insert(salesOpsOrgModules)
        .values({ orgId, moduleKey: key, enabled, source: 'admin', updatedAt: new Date() })
        .onConflictDoUpdate({
          target: [salesOpsOrgModules.orgId, salesOpsOrgModules.moduleKey],
          set: { enabled, source: 'admin', updatedAt: new Date() },
        });
    }
    return stateFromRows(await readRows(tx, orgId));
  });
}
