# Part 11a-api-modulos-nucleo of slice 11-api-modulos-org

Original frontmatter (for reference, not a slice):

```yaml
id: 11a-api-modulos-nucleo
milestone: v4.8.0
status: todo
depends_on: ["10b-web-propostas-rotas"]
files_modified: ["packages/shared-utils/src/crm-model.ts", "packages/shared-utils/src/__tests__/crm-model.test.ts", "apps/api/src/domains/org-modules/service.ts", "apps/api/src/domains/org-modules/context.ts", "apps/api/test/rls/org-modules.test.ts"]
affected_tests: [
  {path: packages/shared-utils/src/__tests__/crm-model.test.ts, impact: "append-only: new describe blocks, no existing assertion changes", update: "append", command: "pnpm --filter @fxl-sales/shared-utils exec vitest run src/__tests__/crm-model.test.ts", owner: builder},
  {path: packages/shared-utils/src/__tests__/sales-edition.test.ts, impact: "sales-edition.ts is NOT edited here; must stay green", update: none, command: "pnpm --filter @fxl-sales/shared-utils exec vitest run src/__tests__/sales-edition.test.ts", owner: builder},
  {path: apps/api/src/domains/crm/__tests__/crm-seed-callers.test.ts, impact: "the new service must not import crm/defaults.ts", update: none, command: "pnpm --filter @fxl-sales/api exec vitest run src/domains/crm/__tests__/crm-seed-callers.test.ts", owner: builder}
]
acceptance: "given an org with no sales_ops_org_modules row, when loadOrgModules runs with the leads token module (even 12 concurrent calls with mixed tokens), then exactly 7 rows exist, written once with source token_backfill, clientes and importacao enabled and nothing else; a later call with a different token changes nothing"
goal: "The pure module vocabulary and the DB-backed, concurrency-safe loader/updater of per-org modules with the one-time token backfill, with NO request path wired yet"
must_not_break: ["no request path imports org-modules/service.ts or context.ts yet (this slice is dormant: whole API suite unchanged)", "sales-edition.ts is not edited", "crm/defaults.ts is not imported by the new service (crm-seed-callers.test.ts)", "the migration folder is untouched (slice 05a already created sales_ops_org_modules)"]
rules: ["Never use the em dash; use '-'", "crm-model.ts stays pure: no env, no clock, no I/O", "After editing shared-utils run pnpm --filter @fxl-sales/shared-utils build; the API resolves it through dist", "Tenant tables are only touched inside withTenant (apps/api/src/domains/sales-ops/leads/with-tenant.ts)", "No migration in this slice"]
verifier_focus: "Run the integration test several times (the 12-way concurrency case must never produce more than 7 rows or a mixed backfill); confirm modulesAllowCapability parity with hasCapability for both editions; confirm nothing outside the new files and crm-model.ts changed"
oracle: "apps/api/test/rls/org-modules.test.ts"
```

# 11a - Org modules: pure vocabulary and the loader (phase 3, API core)

Phase 3 plan group: 11a (this), 11b (cutover of the gates), 11c (admin route, bootstrap, orcamento stage rule, docs), 12a/12b (web).
Why split: the owner asked for one slice `11-api-modulos-org`, but it needs ~17 files and touches 9 locked oracles; 11a is dormant additive code (no behaviour change), 11b is the risky switch, 11c is the surface. The orchestrator may rename; the dependency chain is 11a -> 11b -> 11c -> 12b and 11a -> 12a.

## Context

- `SalesEdition = 'full' | 'leads'`, `SalesCapability`, `hasCapability`, `resolveSalesEdition`, `SALES_EDITION_LEADS_MODULE` live in `packages/shared-utils/src/sales-edition.ts`. They are NOT edited.
- Slice 05b created `packages/shared-utils/src/crm-model.ts` with `CRM_MODULE_KEYS` (`orcamentos|comissoes|financeiro|finders|catalogo|importacao|clientes`), `CrmModuleKey`, `CRM_MODULE_SOURCES`, `CrmModuleSource`, `isCrmModuleKey`, `CAPABILITY_MODULES`, `modulesForEdition`, `StageBehavior`, `defaultStageBehavior`. Read the file first: `grep -n "^export" packages/shared-utils/src/crm-model.ts`.
- Slice 05a created `sales_ops_org_modules` (Drizzle export `salesOpsOrgModules` in `apps/api/src/db/schema.ts`): `id`, `orgId`, `moduleKey`, `enabled` (default false), `source` (default 'default'), `createdAt`, `updatedAt`; unique index `sales_ops_org_modules_org_key_idx (org_id, module_key)`; FORCE RLS with `sales_ops_org_modules_tenant_isolation` and `sales_ops_org_modules_admin_context`. Nobody writes it before this slice.
- Equivalence facts (verified from `CAPABILITY_MODULES` and `LEADS_CAPABILITIES`): `modulesForEdition('leads')` enables exactly `clientes` and `importacao`; `modulesForEdition('full')` enables all seven. Capability `history` maps to `financeiro`; `leadFullFields` and `catalog` map to `catalogo`.
- Tenant door: `withTenant(db, orgId, fn)` re-exported by `apps/api/src/domains/sales-ops/leads/with-tenant.ts` (opens a transaction and sets `app.current_org_id`).
- Integration harness to copy: `apps/api/test/rls/leads-edition.test.ts` lines 1-60 and 80-140 (`testDatabaseUrls()`, `postgres(APP_DB_URL)` for the RLS-live app role, `postgres(ADMIN_DB_URL, {connection: {'app.fxl_admin': 'true'}})` for setup and teardown). Token fixture: `hubAuthContext({ entitlements: { modules: [...] } })` from `apps/api/src/auth/__tests__/hub-auth-context-fixture.ts` is NOT needed here: the loader takes the token's module list as a plain argument.

## Design (decided)

1. The module set of an org lives ONLY in `sales_ops_org_modules`. A row per `CRM_MODULE_KEYS` entry. A key with no row reads as `false`. A row whose `module_key` is not a known key is ignored. An unknown `source` reads as `'default'`.
2. One-time backfill. `loadOrgModules(orgId, tokenModules)` reads the org's rows in a tenant transaction. If there are NONE it takes a per-org transaction advisory lock, re-reads (a concurrent winner may have committed), and only if still empty inserts the 7 rows from `modulesForEdition(resolveSalesEdition(tokenModules))` with `source = 'token_backfill'` using `ON CONFLICT (org_id, module_key) DO NOTHING`. After that the token is never consulted again for that org. An org with at least one row is never backfilled (a key added to `CRM_MODULE_KEYS` later ships its own additive `INSERT ... ON CONFLICT DO NOTHING` migration).
3. The advisory lock makes the backfill all-or-nothing even when two concurrent requests carry different tokens (the second blocks, re-reads, finds 7 rows, inserts nothing). The unique index plus `ON CONFLICT DO NOTHING` is the second line of defence.
4. `updateOrgModules(orgId, tokenModules, patch)` runs the same ensure step first (so an admin write on a never-seen org cannot skip the compat backfill), then upserts each patched key with `source = 'admin'` and `updated_at = now()`.
5. A store failure throws; callers never treat it as "all enabled" (fail closed, a 500 from the app `onError`).
6. Pure additions to `crm-model.ts` (shared by API and web): `OrgModules`, `ALL_MODULES_ENABLED`, `modulesAllowCapability`, `editionFromModules`, `isOrgModules`, `stageActsAsOrcamento`, `effectiveStageBehavior`. `editionFromModules(modules)` is `modules.orcamentos ? 'full' : 'leads'` - the derived PROJECTION that keeps every existing `edition` argument working: "orcamentos off behaves like today's leads edition".
7. `context.ts` gives the request-level API: `getOrgModules(c)` (memoized on the Hono context under the key `orgModules`; a value already on the context wins, which is the test seam), `getSalesEdition(c)` (the projection). A context with neither `orgModules` nor `hubAuth` (hand-built test context; impossible behind `appAuthMiddleware`) is `ALL_MODULES_ENABLED`, the same fail-to-full rule `requireCapability` has today, so this can never take a capability away from an unmarked org. Declaring the `orgModules` context variable type is done in slice 11b (`middleware/auth.ts`), which is why `context.ts` here uses a local typed accessor (see code).

## Steps (TDD)

1. Append the failing tests to `packages/shared-utils/src/__tests__/crm-model.test.ts` (text in Tests). Run: expect FAIL (exports missing).
2. Append the pure block to `packages/shared-utils/src/crm-model.ts` (below). Build shared-utils. Re-run: PASS.
3. Create `apps/api/test/rls/org-modules.test.ts` (Tests). Run with `VITEST_INTEGRATION=1`: expect FAIL (service missing).
4. Create `apps/api/src/domains/org-modules/service.ts` and `context.ts` (code below). Re-run integration test: PASS. Run it 3 times in a row.
5. Run the focused and affected commands, lint, type-check.

### Code: append to `packages/shared-utils/src/crm-model.ts`

The file already imports `hasCapability`, `SalesCapability`, `SalesEdition` from `./sales-edition.js`. Add nothing to the imports except, if `StageBehavior` is not already in scope, it is declared in this same file by 05b. Append at the end:

```ts
// ---------------------------------------------------------------------------
// Phase 3 (per-organization modules). Pure; shared by the API and the web.
// ---------------------------------------------------------------------------

/** The module flags of one organization. Every key is present. */
export type OrgModules = Record<CrmModuleKey, boolean>;

/** The fail-to-full value: a context that never resolved modules is the whole product. */
export const ALL_MODULES_ENABLED: Readonly<OrgModules> = Object.freeze(
  Object.fromEntries(CRM_MODULE_KEYS.map((key) => [key, true])) as OrgModules,
);

/** A capability is granted iff EVERY module mapped to it is enabled. */
export function modulesAllowCapability(modules: OrgModules, capability: SalesCapability): boolean {
  return CAPABILITY_MODULES[capability].every((key) => modules[key] === true);
}

/**
 * The legacy two-value projection. 'full' while `orcamentos` is on, 'leads' while it
 * is off. It exists so every service argument and web conditional that still takes an
 * edition keeps working; it never decides a capability (modulesAllowCapability does).
 */
export function editionFromModules(modules: OrgModules): SalesEdition {
  return modules.orcamentos === true ? 'full' : 'leads';
}

/** True only for an object with every module key present as a boolean. */
export function isOrgModules(value: unknown): value is OrgModules {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Record<string, unknown>;
  return CRM_MODULE_KEYS.every((key) => typeof record[key] === 'boolean');
}

/**
 * An `orcamento` stage with the `opens_orcamentos` behaviour opens the proposta
 * wizard / answers sale_required_for_conversion ONLY while the organization has the
 * `orcamentos` module. With it off the stage is an ordinary stage.
 */
export function stageActsAsOrcamento(
  stage: { type: string; behavior: string },
  modules: OrgModules,
): boolean {
  return modules.orcamentos === true && stage.type === 'orcamento' && stage.behavior === 'opens_orcamentos';
}

/** The behaviour a stage really has for this organization (`none` when it cannot act). */
export function effectiveStageBehavior(
  stage: { type: string; behavior: string },
  modules: OrgModules,
): StageBehavior {
  return stageActsAsOrcamento(stage, modules) ? 'opens_orcamentos' : 'none';
}
```

### Code: `apps/api/src/domains/org-modules/service.ts` (new, complete)

```ts
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
import { and, eq, sql } from 'drizzle-orm';
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
 * MUST run inside a tenant transaction. The token decides ONLY here, and only for an
 * org with no row at all.
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
```

(`and` is imported only if needed; remove unused imports so lint passes.)

### Code: `apps/api/src/domains/org-modules/context.ts` (new, complete)

```ts
import {
  ALL_MODULES_ENABLED,
  editionFromModules,
  type OrgModules,
} from '@fxl-sales/shared-utils/crm-model';
import type { SalesEdition } from '@fxl-sales/shared-utils/sales-edition';
import type { Context } from 'hono';
import { loadOrgModules } from './service.js';

const KEY = 'orgModules';

type Loose = { get(key: string): unknown; set(key: string, value: unknown): void };

/**
 * The organization's modules for THIS request: one query, memoized on the context.
 * A value already on the context wins (tests inject it; the first call stores it).
 * A context with neither modules nor a verified Hub context is the whole product -
 * the same fail-to-full rule requireCapability always had. A store failure THROWS.
 */
export async function getOrgModules(c: Context): Promise<OrgModules> {
  const loose = c as unknown as Loose;
  const preset = loose.get(KEY) as OrgModules | undefined;
  if (preset) return preset;
  const hubAuth = loose.get('hubAuth') as { entitlements?: { modules?: readonly unknown[] } } | undefined;
  const orgId = loose.get('orgId') as string | undefined;
  if (!hubAuth || !orgId) return ALL_MODULES_ENABLED;
  const state = await loadOrgModules(orgId, hubAuth.entitlements?.modules);
  loose.set(KEY, state.modules);
  return state.modules;
}

/** The legacy two-value projection of the request's modules (orcamentos off => 'leads'). */
export async function getSalesEdition(c: Context): Promise<SalesEdition> {
  return editionFromModules(await getOrgModules(c));
}
```

(Slice 11b replaces the `Loose` cast with the typed `c.get('orgModules')` once `ContextVariableMap` declares it; 11a stays type-clean without touching `middleware/auth.ts`.)

## Tests

`packages/shared-utils/src/__tests__/crm-model.test.ts` (append; import the new names from `../crm-model.js`, `hasCapability` and `SalesCapability` from `../sales-edition.js`):
- `describe('org modules (phase 3)')`:
  - `it('ALL_MODULES_ENABLED is frozen with every key true')`: `Object.isFrozen`, `CRM_MODULE_KEYS.every(k => ALL_MODULES_ENABLED[k] === true)`.
  - `it.each(['full','leads'])('modulesAllowCapability reproduces hasCapability for %s on every capability')`: for each capability in the literal list `['proposals','commissions','catalog','clients','import','finders','history','leadFullFields']`, `modulesAllowCapability(modulesForEdition(edition), capability) === hasCapability(edition, capability)`. (This is the parity oracle: the module table is exactly today's editions.)
  - `it('editionFromModules round-trips both editions')`: `editionFromModules(modulesForEdition('full')) === 'full'`, same for `'leads'`.
  - `it('editionFromModules follows orcamentos alone')`: `{...ALL_MODULES_ENABLED, orcamentos:false}` -> `'leads'`; `{...modulesForEdition('leads'), orcamentos:true}` -> `'full'`.
  - `it('isOrgModules accepts a full record and rejects a missing key or a non-boolean')`.
  - `it('stageActsAsOrcamento needs orcamentos on, type orcamento and behavior opens_orcamentos')`: the 2x2x2 table - only (on, 'orcamento', 'opens_orcamentos') is true; `effectiveStageBehavior` returns 'opens_orcamentos' for that one and 'none' for the rest.

`apps/api/test/rls/org-modules.test.ts` (new; harness copied from `leads-edition.test.ts`: `appClient` RLS role, `adminClient`, `db = drizzle(appClient, { schema })`, org ids `org_mod_<label>_<Date.now()>_<uuid8>`, `afterAll` deletes `DELETE FROM sales_ops_org_modules WHERE org_id = ...` through `adminClient` for every created org and ends the clients). Import `loadOrgModules`, `updateOrgModules` from `../../src/domains/org-modules/service.js`, `CRM_MODULE_KEYS`, `modulesForEdition` from `@fxl-sales/shared-utils/crm-model`. Rows are read back with `adminClient\`SELECT module_key, enabled, source FROM sales_ops_org_modules WHERE org_id = ${orgId} ORDER BY module_key\``. Tests:
1. `a Construbom-like org (token module sales.edition.leads, no rows) backfills exactly today's leads capabilities`: `loadOrgModules(org, ['sales.edition.leads'], db)`; state.modules equals `modulesForEdition('leads')`; admin read shows 7 rows, every `source` `token_backfill`, enabled keys sorted equal `['clientes','importacao']`.
2. `a full org (modules []) backfills all seven enabled`.
3. `token near-misses and unrelated add-ons backfill full`: tokens `['sales.some-other-addon']`, `['SALES.EDITION.LEADS']`, `['sales.edition.leads ']`, `undefined`, `null` each on a fresh org -> all seven true. And `['sales.some-other-addon','sales.edition.leads']` -> leads set.
4. `after the backfill the token no longer decides`: first call leads token, second call on the same org with `[]` returns the leads set and the row count stays 7 (and `updated_at` null).
5. `twelve concurrent first calls with mixed tokens write one coherent set`: `await Promise.all` of 12 `loadOrgModules` (even index leads token, odd index `[]`) on one fresh org; assert no rejection, exactly 7 rows, all 12 returned states deep-equal, the 7 rows have identical `source` `token_backfill`, and the winning set is either entirely the leads set or entirely the full set (never mixed: enabled count is 2 or 7).
6. `RLS isolates orgs`: after orgs A and B are loaded, `withTenant(db, B, tx => tx.select().from(salesOpsOrgModules))` returns only rows with `orgId === B` and `withTenant(db, B, tx => tx.select().from(salesOpsOrgModules).where(eq(salesOpsOrgModules.orgId, A)))` returns `[]`.
7. `updateOrgModules turns a flag on as source admin and leaves the rest`: leads org, `{ orcamentos: true }` -> orcamentos true, `sources.orcamentos === 'admin'`, `sources.clientes === 'token_backfill'`, other flags unchanged, `updated_at` set for that row only.
8. `updateOrgModules on a never-seen org backfills first`: fresh org, token leads, patch `{ comissoes: true }` -> 7 rows, comissoes true/admin, clientes+importacao true/token_backfill, rest false.
9. `a partially populated org is not backfilled; a missing key reads false`: insert ONE row (`orcamentos`, enabled true, source 'admin') through `adminClient`; `loadOrgModules(org, [], db)` -> only orcamentos true, `SELECT count(*)` still 1.
10. `an unknown module_key row is ignored and an unknown source reads default`: insert rows `('zzz', true, 'admin')` and `('clientes', true, 'weird')` via adminClient (so the org has rows); state.modules has no `zzz` key, `sources.clientes === 'default'`.

## Commands

- Pure: `pnpm --filter @fxl-sales/shared-utils exec vitest run src/__tests__/crm-model.test.ts` then `pnpm --filter @fxl-sales/shared-utils build`.
- Oracle: `pnpm --filter @fxl-sales/api exec env VITEST_INTEGRATION=1 vitest run test/rls/org-modules.test.ts` (run 3 times; local Docker DB on 5006, `apps/api/.env` must exist in the worktree).
- Affected: the three commands in `affected_tests`.
- `pnpm --filter @fxl-sales/shared-utils lint`, `pnpm --filter @fxl-sales/shared-utils type-check`, `pnpm --filter @fxl-sales/api lint`, `pnpm --filter @fxl-sales/api type-check`.
- Guards: `node --test scripts/__tests__/hub-sdk-pin.test.mjs scripts/__tests__/fxl-contracts-pin.test.mjs scripts/__tests__/no-legacy-auth.test.mjs scripts/__tests__/no-legacy-env-names.test.mjs scripts/__tests__/auth-fake-isolation.test.mjs`.

## Risks

- `hashtextextended` needs PostgreSQL 11+ (the project runs 16). The advisory lock is transaction-scoped, released at commit, no cleanup.
- `drizzle` `onConflictDoNothing({ target: [...] })` with a unique INDEX (not constraint) works because the target columns match the unique index `sales_ops_org_modules_org_key_idx`.
- If 05b named a helper differently (for example `CAPABILITY_MODULES` as a function), read the file first and keep the NAMES in `contracts/SEAM-CONTRACT.md`; do not rename them here.
