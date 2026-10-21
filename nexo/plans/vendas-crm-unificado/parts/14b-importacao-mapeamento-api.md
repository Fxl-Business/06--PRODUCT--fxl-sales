# Part 14b-importacao-mapeamento-api of slice 14-importacao-mapeamento

Original frontmatter (for reference, not a slice):

```yaml
id: 14b-importacao-mapeamento-api
milestone: v4.8.0
status: todo
depends_on: ["14a-importacao-mapeamento-nucleo"]
files_modified: ["apps/api/src/domains/import/mapping/catalog.ts", "apps/api/src/domains/import/mapping/executor.ts", "apps/api/src/domains/import/mapping/routes.ts", "apps/api/src/domains/import/routes.ts", "apps/api/src/domains/sales-ops/routes.ts", "apps/api/src/domains/crm/__tests__/crm-seed-callers.test.ts", "apps/api/src/domains/import/__tests__/mapping-routes.integration.test.ts", "apps/api/src/domains/import/__tests__/template-brand.test.ts", "nexo/knowledge/reference/importacao-por-planilha.md", "CLAUDE.md"]
affected_tests: [
  {path: apps/api/src/domains/import/__tests__/import-routes.integration.test.ts, impact: "routes.ts only gains `export` keywords and the sales-ops router gains a sibling mount; the official flow must be byte-identical in behaviour", update: "none expected, run to prove", command: "pnpm --filter @fxl-sales/api exec env VITEST_INTEGRATION=1 vitest run src/domains/import/__tests__/import-routes.integration.test.ts", owner: builder},
  {path: apps/api/src/domains/import/__tests__/import-routes.test.ts, impact: "unit routing test of the import router", update: "none expected, run to prove", command: "pnpm --filter @fxl-sales/api exec vitest run src/domains/import/__tests__/import-routes.test.ts", owner: builder},
  {path: apps/api/src/domains/crm/__tests__/crm-seed-callers.test.ts, impact: "ALLOWED_CALLERS must list the new request path that calls ensureCrmDefaults", update: "add apps/api/src/domains/import/mapping/routes.ts to the allow-list", command: "pnpm --filter @fxl-sales/api exec vitest run src/domains/crm/__tests__/crm-seed-callers.test.ts", owner: builder},
  {path: apps/api/src/domains/sales-ops/__tests__/edition-gate-map.test.ts, impact: "maps every route to a capability; /import/mapping/* is under /import/* and must stay gated by the same capability/module", update: "none expected unless the test enumerates routes; then add /import/mapping/* beside /import/*", command: "pnpm --filter @fxl-sales/api exec vitest run src/middleware/__tests__/edition-gate-map.test.ts", owner: builder}
]
acceptance: "given an admin, a sheet with arbitrary headers and a mapping, when POST /import/mapping/preview then /commit run, then preview writes nothing, commit writes leads and clientes through the domain services in one transaction, and committing the same file again creates nothing and reports the leads and clientes as recognized"
goal: "Expose the mapped import: inspect, preview and commit routes with a database catalog, a domain-service executor, one audit entry and idempotent re-import."
must_not_break: ["the official /import/template, /preview, /commit behave exactly as before", "import-routes.integration.test.ts and executor.integration.test.ts", "admin gate and the import capability/module gate on every new route", "the template brand FXL Vendas"]
rules: ["Every route behind requireAdmin; the org only from c.get('orgId'), never from the file or the config", "Writes only through domain services (createClient, the phase 2 createLead); no raw INSERT into a business table", "Preview plans inside a transaction that is always rolled back; commit re-parses, re-reads the catalog inside its transaction, re-plans, executes at zero errors, all or nothing", "The commit takes the lead-board advisory lock (lockLeadBoard) FIRST so two concurrent imports cannot both create the same lead", "ensureCrmDefaults is called only from a registered request path (crm-seed-callers allow-list)", "ONE import.completed audit entry, written last in the same transaction", "The web classifies by HTTP status; a 403 is inline, never ForbiddenPanel"]
verifier_focus: "preview leaves every org table count at zero; commit then recommit creates zero rows and recognized counts equal the first run; a cliente created by the first run is recognized (not duplicated); a failing row rolls back clientes, leads and the audit entry; non-admin gets 403 on all three routes; new routes sit under the /import/* gate; lead writes go through createLead"
oracle: "apps/api/src/domains/import/__tests__/mapping-routes.integration.test.ts"
```

# 14b - Importação com mapeamento: API

## Context

- Core (14a): `mapping/types.ts`, `read-sheet.ts` (`readMappingSheet`), `suggest.ts` (`suggestTargets`), `plan.ts` (`planMappedImport`) are pure and done.
- Official routes: `apps/api/src/domains/import/routes.ts` - `readOnlyTenant` (line 36, rolled-back tx), `seededCatalog` (line 55), `uploadBodyLimit` (line 68), `refusal` (line 87), `importRouter` mounted at `apps/api/src/domains/sales-ops/routes.ts:331` under the gate `salesOpsRouter.use('/import/*', requireCapability('import'))` (line 89; phase 3 turns it into the `importacao` module gate). A new `/import/mapping/*` route inherits that gate because the pattern `/import/*` matches deeper paths. Confirm with `grep -n "'/import" apps/api/src/domains/sales-ops/routes.ts`.
- Cliente creation: `createClient(db, orgId, ClientSchema.parse(input))` in `sales-ops/service.ts:2298`; `ClientSchema` at `:355`.
- Audit: `writeAuditEntry(tx, {...})` and the `import.completed` entry shape at `executor.ts:447-456` (the entry is written LAST).
- Lead write (phase 2, see `contracts/SEAM-CONTRACT-PHASE2.md` "Cutover" and "Lead wire shape"): the new lead tables and `createLead`/`LeadWriteSchema`/`LeadScope` in `apps/api/src/domains/sales-ops/leads/` (today `lead-service.ts` exports `createLead`, `LeadInputError`, `LeadScope`, `lockLeadBoard` is imported by `lead-trash-service.ts:13`). `LeadWriteSchema` accepts `contactName`, a contact (`contactPhone` or `contactEmail`), `pipelineId`, `stageId`, `sellerPersonId`, `clientId` or `clientName`, `estimatedValueBrl`, `fields`.
- DB schema names (SEAM-CONTRACT): `salesOpsPipelines`, `salesOpsPipelineStages`, `salesOpsFieldDefinitions`, `salesOpsCrmLeads` in `apps/api/src/db/schema.ts`.
- Test harness to copy (do not import across test files): `__tests__/import-routes.integration.test.ts` lines 1-296 (hub env hoist, `createTestApp`, `newOrg`, `ORG_TABLES`, `orgTableCounts`, `expectNothingWritten`, cleanup in `afterAll` through `getAdminDb()` and `deleteSettlementsForOrgs`). Replace the legacy lead tables in `ORG_TABLES` with the CRM ones (`salesOpsCrmLeads`, `salesOpsCrmLeadFieldValues`, `salesOpsCrmLeadEvents`, `salesOpsCrmLeadNotes`, `salesOpsCrmLeadFollowups`, `salesOpsPipelineTransitions`, `salesOpsPipelineStages`, `salesOpsPipelines`, `salesOpsFieldDefinitions`) in FK-safe delete order (children first).

## Step 0 - pin the phase 2 names (do this before writing code)

Open the phase 2 API plans in `nexo/plans/vendas-crm-unificado/` (the lead service slices) and the merged code, then record in the executor's header comment these four facts, confirmed with `grep`:
1. `createLead` signature and return type. Expected: `createLead(db: Db, orgId: string, data: LeadWriteInput, scope: LeadScope): Promise<{ ok: true; lead: ... } | { ok: false; reason: string }>`, throwing `LeadInputError` (with `.code`) for service refusals.
2. `LeadWriteSchema` export name and file. Expected `LeadWriteSchema` in `leads/lead-schemas.ts`.
3. The `fields` write shape. Expected (symmetric to the read shape `LeadFieldValue` of the phase 2 contract): `fields: Array<{ fieldId: string; value: string | number | null | Array<{ id: string | null; name: string }> }>` with money as integer cents, date as ISO civil day, an options value as the option key (several as an array of `{id: key, name: label}` is NOT expected: use the contract's rule that an option is its key; for a `multiple` option field send an array of keys), references as `{id, name}` items.
4. `lockLeadBoard(tx, orgId)` export and file.
All the phase 2 knowledge is confined to ONE function, `toLeadWriteInput` in `mapping/executor.ts`, and its unit test. If a fact differs from the expectation, change only that function and its test, and note the difference in the commit message. If the new lead service does not accept a lead created directly in an exit stage (`stageId` of a `saida` stage), STOP and write the slice `BLOCKED` with that finding (the orchestrator decides between a service option and create-then-move).

## Design

### `mapping/catalog.ts` (database reads, tenant tx only)

```ts
import { and, eq, isNull } from 'drizzle-orm';
import { salesOpsClients, salesOpsCrmLeads, salesOpsFieldDefinitions, salesOpsPipelineStages, salesOpsPipelines } from '../../../db/schema.js';
import { normalizeLabel } from '../cells.js';
import type { Db } from '../../sales-ops/service.js';
import type { MappingCatalog } from './types.js';

export async function readMappingCatalog(tx: Db, orgId: string): Promise<MappingCatalog>;
export async function readExistingLeadKeys(tx: Db, orgId: string, pipelineId: string): Promise<Map<string, number>>;
```
- `readMappingCatalog`: three SELECTs each filtered `eq(table.orgId, orgId)`; pipelines `status` as stored, ordered by `(position, name)`; stages ordered `(pipelineId, position)`; fields ordered `(position, key)`; map the rows to the `MappingCatalog` types (camelCase columns: `pipelineId`, `exitKind`, `requiresReason`, `referenceTarget`, `isDefault`, `isSystem`, `options` jsonb cast to `Array<{key,label}> | null`).
- `readExistingLeadKeys`: `tx.select({ contactName: salesOpsCrmLeads.contactName, clientName: salesOpsClients.name, snapshot: salesOpsCrmLeads.clientNameSnapshot }).from(salesOpsCrmLeads).leftJoin(salesOpsClients, and(eq(salesOpsClients.orgId, salesOpsCrmLeads.orgId), eq(salesOpsClients.id, salesOpsCrmLeads.clientId))).where(and(eq(salesOpsCrmLeads.orgId, orgId), eq(salesOpsCrmLeads.pipelineId, pipelineId), isNull(salesOpsCrmLeads.deletedAt)))`; the key is `leadRecognitionKey(contactName, clientName ?? snapshot)` imported from `./plan.js` (14a exports it; one spelling for both sides); value is the count of rows per key.

### `mapping/executor.ts`

```ts
export class MappingExecutionError extends Error {
  constructor(readonly row: number, readonly reason: string) { super(mappingExecutionMessage(row, reason)); }
}
export function mappingExecutionMessage(row: number, reason: string): string {
  return `Linha ${row}: ${MAPPING_REASON_MESSAGES[reason] ?? 'o registro foi recusado pelo sistema'}.`;
}
export async function executeMappingPlan(tx: Db, orgId: string, plan: MappingPlan, config: MappingConfig, actor: CadastroActor, now: Date): Promise<{ counts: ImportCounts; recognized: ImportCounts }>;
export function toLeadWriteInput(op: MappingLeadOp, clientId: string | null, config: MappingConfig): unknown; // phase 2 shape, see Step 0
```
`MAPPING_REASON_MESSAGES` (pt-BR, no ids): `invalid_client` 'os dados do cliente foram recusados pela validação do sistema', `invalid_lead` 'os dados do lead foram recusados pela validação do sistema', `seller_not_found`, `seller_not_a_vendedor`, `client_not_found`, `product_not_found`, `stage_not_found` (copy the sentences of `executor.ts:64-90`), `lost_reason_required`, `transition_not_allowed` 'a etapa escolhida não aceita este lead', `sale_required_for_conversion` 'um lead não pode ser importado em uma etapa de orçamento', `db_unique_violation`, `db_foreign_key_violation`, `db_check_violation` (same sentences as `executor.ts:108-110`).
Algorithm (all on the caller's `tx`, so each service tenant scope is a savepoint and a throw rolls the route's transaction back):
1. `const clientIds = new Map<string, string>()`. For each `op of plan.clientOps` in order: `const created = await createClient(tx, orgId, ClientSchema.parse(op.input))` inside try/catch (any error -> `MappingExecutionError(op.row, 'invalid_client')` unless it carries a Postgres code `23505|23503|23514`, which map to `db_unique_violation|db_foreign_key_violation|db_check_violation` through a copy of `POSTGRES_REASONS` of `executor.ts:191-205`); `clientIds.set(op.planKey, created.id)`.
2. For each `op of plan.leadOps`: `clientId = op.clientRef ? ('existingId' in op.clientRef ? op.clientRef.existingId : clientIds.get(op.clientRef.planKey)) : null` (undefined for a planKey -> `MappingExecutionError(op.row, 'client_not_found')`); `const data = LeadWriteSchema.safeParse(toLeadWriteInput(op, clientId, config))` (failure -> `invalid_lead`); `const result = await createLead(tx, orgId, data.data, scope)` with `scope = { userId: actor.userId, email: null, isAdmin: true }`; a `LeadInputError` -> `MappingExecutionError(op.row, error.code)`; `result.ok === false` -> `MappingExecutionError(op.row, result.reason)`.
3. LAST statement: `writeAuditEntry(tx, { actorUserId: actor.userId, actorOrgId: orgId, action: 'import.completed', entityType: 'importacao', entityId: randomUUID(), beforeJsonb: {}, afterJsonb: { mode: 'mapping', counts: plan.counts, recognized: plan.recognized, actorLabel: actor.displayName } })`.
4. Return `{ counts: plan.counts, recognized: plan.recognized }`.
`now` is accepted for symmetry and used only if the phase 2 service needs a clock argument (pass it through; never `new Date()` here).

`toLeadWriteInput` (expected phase 2 shape, Step 0 may adjust):
```ts
{
  contactName: op.contactName,
  contactPhone: op.contactPhone,
  contactEmail: op.contactEmail,
  pipelineId: config.pipelineId,
  stageId: op.stageId,
  sellerPersonId: op.sellerPersonId,
  ...(clientId ? { clientId } : op.clientName ? { clientName: op.clientName } : {}),
  estimatedValueBrl: op.estimatedValueBrl,
  lostReason: op.lostReason,
  fields: op.fields.map((f) => ({ fieldId: f.fieldId, value: encode(f.value) })),
}
```
with `encode`: text -> string; number -> number; money -> `cents`; date -> `day`; options -> `keys[0]` when one key and the definition is not multiple else the `keys` array (the planner already enforces single value for a non-multiple field, so: one key -> that string, several -> the array); products -> `items.map((i) => ({ id: i.productId, name: i.name }))`.

### `mapping/routes.ts`

```ts
export const mappingRouter = new Hono();
```
Imports `readOnlyTenant`, `seededCatalog`, `uploadBodyLimit`, `refusal` from `../routes.js` (this slice adds the `export` keyword to those four declarations in `import/routes.ts`; nothing else in that file changes), `ensureCrmDefaults` from `../../crm/defaults.js`, `lockLeadBoard` (Step 0), `withTenant`, `getDb`, `requireAdmin`, `cadastroActor`, `buildRefIndex`-free: planning only through `planMappedImport`.

Shared helper (private):
```ts
async function planInTx(tx: Db, orgId: string, input: { sheet: MappedSheet; config: MappingConfig }, now: Date): Promise<MappingPlan> {
  const catalog = await seededCatalog(tx, orgId, now);   // the official seeds, then readImportCatalog
  await ensureCrmDefaults(tx, orgId);                      // idempotent; registered in crm-seed-callers
  const mapping = await readMappingCatalog(tx, orgId);
  const existingLeadKeys = await readExistingLeadKeys(tx, orgId, input.config.pipelineId);
  return planMappedImport({ sheet: input.sheet, config: input.config, catalog, mapping, existingLeadKeys });
}
```
Upload reader `readMappingUpload(c)`: `c.req.parseBody()` (catch -> 400); `file` must be a `File` (else 400), `file.size > MAX_UPLOAD_BYTES` -> 413; `config` field must be a string, `JSON.parse` in try, `MappingConfigSchema.safeParse` -> on failure `400 { error: 'validation_error', reason: 'invalid_mapping_config' }`; `sheet = await readMappingSheet(bytes, { sheetName: config.sheetName, headerRow: config.headerRow })`, `null` -> `400 INVALID_FILE_BODY` (same body as the official routes via `refusal(c, 400)`).

Routes (all `requireAdmin, uploadBodyLimit`):
- `POST /inspect`: form fields `file`, optional `sheetName`, optional `headerRow` (integer 1..50, default 1; invalid -> 400 `invalid_mapping_config`). `readMappingSheet` -> then in `readOnlyTenant`: `await seededCatalog`-free path: only `ensureCrmDefaults(tx, orgId)` then `readMappingCatalog(tx, orgId)`. Answer 200:
  ```ts
  type MappingInspectBody = {
    sheetNames: string[]; sheetName: string; headerRow: number; rowCount: number;
    columns: Array<{ index: number; header: string; sample: string[]; distinct: string[] | null; suggested: MappingTarget }>;
    pipelines: Array<{ id: string; name: string; isDefault: boolean; stages: Array<{ id: string; name: string; type: string; exitKind: string | null; requiresReason: boolean }> }>;  // active only, ordered by position
    fields: Array<{ key: string; label: string; kind: string; mappable: boolean }>;  // active, non-system; mappable = !(reference to cliente|contato|venda)
    issues: ImportIssue[];
  };
  ```
  `sample` = first 3 non-blank `displayRaw` values; `distinct` = the distinct non-blank `displayRaw` values in first-seen order, or `null` when there are more than 100; `suggested` from `suggestTargets(headers, mapping.fields)`.
- `POST /preview`: `readOnlyTenant(orgId, tx => planInTx(tx, orgId, upload, now))`, answer `200 toPreviewBody({ operations: [], issues, counts, recognized })` (import `toPreviewBody` from `../plan/index.js`).
- `POST /commit`:
  ```ts
  const result = await withTenant(getDb(), orgId, async (tx) => {
    await lockLeadBoard(tx, orgId);                 // first: serializes concurrent imports
    const plan = await planInTx(tx, orgId, upload, now);
    if (plan.issues.some((i) => i.severity === 'error')) throw new MappingPlanRejected(plan);
    return executeMappingPlan(tx, orgId, plan, upload.config, actor, now);
  });
  return c.json({ counts: result.counts, recognized: result.recognized }, 201);
  ```
  `MappingPlanRejected` -> `422 toPreviewBody(...)`; `MappingExecutionError` -> `409 { error: 'conflict', reason: 'import_execution_failed', message: error.message }`; anything else rethrown.

`apps/api/src/domains/sales-ops/routes.ts`: next to line 331 add
```ts
salesOpsRouter.route('/import/mapping', mappingRouter);
```
and the import `import { mappingRouter } from '../import/mapping/routes.js';`. Register it BEFORE `salesOpsRouter.route('/import', importRouter)` so the more specific mount is considered first (Hono matches by registration order; `importRouter` has no `/mapping/*` route, so order is only defensive).

`crm-seed-callers.test.ts`: add `'apps/api/src/domains/import/mapping/routes.ts'` to `ALLOWED_CALLERS` (use the exact path spelling the existing entries use).

Docs (rules move, so they move in the same change): add a section "Importação com mapeamento" to `nexo/knowledge/reference/importacao-por-planilha.md` (one sentence per line) stating the routes, the recognition rule (multiset key), that soft-deleted leads are re-created by a re-import, that exit stages are allowed except `orcamento`, that no transition graph is applied, that unmapped stage values are errors, and the lock order; add to CLAUDE.md "Importação por planilha" ONE bullet: `- The mapped import (`/import/mapping/{inspect,preview,commit}`, `apps/api/src/domains/import/mapping/`) imports LEADS only, from any sheet through a column mapping; it plans purely (`planMappedImport`), recognizes existing leads by the multiset key `contactName|cliente` and existing clientes through `recognizeClientRows`, takes `lockLeadBoard` first on commit, and writes only through `createClient` and `createLead`. Oracle: `mapping-routes.integration.test.ts`.` Do not touch any CHANGELOG.

## Steps (TDD)

1. Step 0 (confirm phase 2 names); write the findings into the `executor.ts` header comment later.
2. Write `__tests__/template-brand.test.ts` (it passes immediately; it is a guard, not a red test) run.
3. Write `mapping-routes.integration.test.ts` (Tests); run it: fails (routes missing).
4. Add the four `export` keywords in `import/routes.ts`; create `mapping/catalog.ts`, `executor.ts`, `routes.ts`; mount in `sales-ops/routes.ts`; update the allow-list test file.
5. Run the oracle until green, then the affected suites, then lint/type-check.
6. Update the two docs.

## Tests

`__tests__/template-brand.test.ts` (unit, no DB): `it('the official template says FXL Vendas and never FXL Sales')`: `buildTemplateWorkbook(seededCatalog(), {example:false})` from `../template.js` with the fixture `seededCatalog()` of `plan-fixtures.ts`; load the bytes with ExcelJS; join every string cell of every worksheet plus `wb.creator`; `expect(text).toContain('FXL Vendas')`, `expect(text).not.toMatch(/FXL Sales/)`. Also assert `TEMPLATE_FILENAME` and `EXAMPLE_TEMPLATE_FILENAME` (from `../routes.js`) start with `fxl-vendas-`.

`mapping-routes.integration.test.ts` (real `salesOpsRouter`, real DB, harness copied as described; sheets built with `buildXlsx`; helper `post(path, bytes, config, orgId)` builds a `FormData` with `file` and `config` (JSON string); the default pipeline is read from the DB after the first request via `getAdminDb()` select of `salesOpsPipelines`/`salesOpsPipelineStages` by org):
- `it('inspect lists tabs, headers with samples, suggestions, pipelines with stages and mappable fields, and writes nothing')`: sheet headers `Nome do cliente | Fone | Fase | Quanto` -> columns carry `suggested` `{core:contactName}`-style targets for the known ones and `ignore` for `Quanto`; `distinct` of `Fase` equals the sheet values; `pipelines[0].stages` has the 7 default stages; `expectNothingWritten`-style check on business tables (the CRM defaults seeded inside the rolled-back tx also leave zero rows).
- `it('preview of a valid mapping returns counts and writes nothing')`: 3 rows, 2 empresas (one existing cliente created by `createClient` before), stage values `Novo`, `Em contato`, `Fechado` mapped through `stageMap` to the default pipeline's stages; response `ok: true`, `counts {leads: 3, clientes: 1}`, `recognized {clientes: 1}`; `orgTableCounts` has `clients` still 1 and CRM leads 0.
- `it('commit writes clientes and leads through the services in one transaction, with one audit entry')`: counts equal SELECT counts (`clients` +1, `salesOpsCrmLeads` 3), each lead sits in the mapped stage with exactly one `stage_changed` event (`salesOpsCrmLeadEvents`), dynamic fields (`descricao`, `origem` option, a money field when the org has one defined: insert a field definition through `getAdminDb()` in the test setup) are stored as values, the vendedor is bound, `auditLog` has exactly one `import.completed` with `afterJsonb.mode === 'mapping'`.
- `it('IDEMPOTENT: committing the same file again creates nothing and reports every lead and cliente as recognized')`: second commit -> 201 with `counts {}` and `recognized {leads: 3, clientes: 2}`; all table counts equal the first run's; a second PREVIEW also reports `recognized`.
- `it('re-import after the operator edited a lead name creates a new lead (create-only, the rule is by name)')` and `it('a soft-deleted lead is re-created')`.
- `it('two identical rows in the file import two leads, then none on re-import (multiset)')`.
- `it('refuses to commit when the fresh plan has errors: 422 with located issues, nothing written')` (unmapped stage value; `stage_unmapped` row/column present).
- `it('rolls everything back when a row fails after writing: clientes, leads and the audit entry')`: use `vi.mock('../mapping/executor.js')` wrapper like the official test (`import-routes.integration.test.ts:79-100`) throwing `MappingExecutionError(row, 'db_unique_violation')` after `executeMappingPlan`; expect 409 `import_execution_failed` and zero rows.
- `it('re-plans at commit: a cliente created after the preview is recognized by the commit')` (create it between preview and commit with `createClient`).
- `it('admin only: a non-admin context gets 403 on inspect, preview and commit')` (the harness sets `userRoles`; use the same non-admin context the official test uses for its 403 case or set `c.set('userRoles', ['seller'])` and `userRole 'seller'` per `hasAdminRole`).
- `it('invalid inputs: not an xlsx is 400 invalid_file; missing or malformed config is 400 invalid_mapping_config; oversize is 413')`.
- `it('the org comes from the context: a pipelineId of another org is pipeline_not_found')`.
- `it('two concurrent commits of the same file create each lead once')`: `Promise.all` of two commits; after both, `salesOpsCrmLeads` count equals the row count and exactly one response has `counts.leads === N` while the other has `recognized.leads === N` (the board lock serializes them).
- `it('the official template round trip still works beside the mapping routes')`: one call to `GET /import/template` returns 200 (smoke; the real round trip stays in the official test).

## Commands

```bash
pnpm --filter @fxl-sales/api exec vitest run src/domains/import/__tests__/template-brand.test.ts src/domains/import/mapping
pnpm --filter @fxl-sales/api exec env VITEST_INTEGRATION=1 vitest run src/domains/import/__tests__/mapping-routes.integration.test.ts
pnpm --filter @fxl-sales/api exec env VITEST_INTEGRATION=1 vitest run src/domains/import/__tests__/import-routes.integration.test.ts src/domains/import/__tests__/executor.integration.test.ts
pnpm --filter @fxl-sales/api exec vitest run src/domains/import src/domains/crm src/middleware/__tests__/edition-gate-map.test.ts
pnpm --filter @fxl-sales/api lint
pnpm --filter @fxl-sales/api type-check
node --test scripts/__tests__/auth-fake-isolation.test.mjs
```

## Risks

- Phase 2 name drift (see Step 0): confined to `toLeadWriteInput`. The orchestrator must reconcile the `fields` write shape with the phase 2 API planner; this plan assumes it mirrors the read shape.
- Hono mount order and the capability gate: the tests prove `/import/mapping/*` answers the same gate as `/import/*` (add one assertion in the integration test: with the gate denying the capability, `POST /import/mapping/preview` is 403 `edition_capability` or the phase 3 equivalent; if phase 3 changed the harness, use its mechanism).
- Concurrency: relies on `lockLeadBoard` being a transaction advisory lock; the concurrent commit test is the proof, keep it.
- Large sheets: 5000 rows x `createLead` in one transaction; acceptable (the official import does the same); if the oracle exceeds the default 5s test timeout set `{ timeout: 60_000 }` on that single test only.
