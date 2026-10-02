---
id: 06-executor
milestone: v4.2.0
status: done
depends_on: [01-contract-and-parser, 02-catalog-refs-cadastros]
files_modified:
  - apps/api/src/domains/import/executor.ts
  - apps/api/src/domains/audit/service.ts
  - apps/api/src/domains/import/__tests__/executor.test.ts
  - apps/api/src/domains/import/__tests__/executor.integration.test.ts
acceptance: "Given a hand-built ImportPlan run as withTenant(getDb(), orgId, tx => executeImportPlan(tx, orgId, plan, actor, now)) on the local test DB, every operation kind is executed through the existing domain services (a won proposta gets won_at = <wonOn>T15:00:00Z and its one-shot payable that civil day, a settled parcela and its linked payables get manual baixas on paidOn, leads land in a workbook etapa in row order and in Perdido with lost_reason), exactly one import.completed audit entry is written last with the plan counts and actor label, and when the last operation is refused (service sentinel or a database error inside a nested savepoint) or the org's producer flow is live, an ImportExecutionError is thrown and every touched table, audit_log and integration_outbox keep zero new rows."
goal: "Ship executeImportPlan and ImportExecutionError: one all-or-nothing run of existing domain-service calls inside the route's tenant transaction, plus the import.completed audit action, proven on the real database with hand-built plans."
must_not_break:
  - "pnpm --filter @fxl-sales/api test (whole unit suite)"
  - "pnpm --filter @fxl-sales/api test:integration (whole integration suite)"
  - "pnpm --filter @fxl-sales/api lint"
  - "pnpm --filter @fxl-sales/api type-check (tsconfig.json, tsconfig.scripts.json, tsconfig.test.json)"
  - apps/api/src/domains/audit/__tests__/service.test.ts
  - apps/api/src/domains/sales-ops/__tests__/history-route.test.ts
  - apps/api/src/domains/sales-ops/__tests__/sao-paulo-day-decisions.test.ts
  - apps/api/src/domains/sales-ops/__tests__/update-sale-schema.test.ts
  - apps/api/src/domains/sales-ops/leads/__tests__/lead-contract.test.ts
  - apps/api/src/domains/sales-ops/__tests__/settlements.integration.test.ts
  - apps/api/src/domains/sales-ops/__tests__/producer-emission.integration.test.ts
  - apps/api/test/rls/cadastro-archive-audit.test.ts
  - apps/api/test/rls/audit-history-org-scope.test.ts
  - apps/api/test/rls/funcoes-rls.test.ts
  - apps/api/test/rls/funcoes-concurrency.test.ts
  - scripts/__tests__/auth-fake-isolation.test.mjs
rules:
  - "executor.ts calls ONLY existing domain services for writes: createArea, createFuncao, createProduct (after resolveProductRefs), createPerson, createClient, createLeadStage, createLead, moveLead, createSale, transitionSale, applyBaixaTx, ensureLeadStages, ensureSystemFuncoes (the one new export, see Seam deviations), writeAuditEntry. It never calls `.insert(`, `.update(` or `.delete(` itself; its only direct queries are two SELECTs (receivable by sale + label, payables by receivable)."
  - "executor.ts never imports getDb/getAdminDb, never calls withTenant, never reads process.env, and never calls `new Date()` without an argument. Every service gets the caller's `tx` as its `db`; `now` is the only clock."
  - "Every input is re-validated with the domain zod schema after ref resolution (AreaSchema, FuncaoSchema, ProductSchema, PersonSchema, ClientSchema, LeadStageSchema, CreateLeadSchema, MoveLeadSchema, CreateSaleSchema) with safeParse; a failure throws ImportExecutionError, never a ZodError."
  - "Every refusal throws ImportExecutionError(operation, reason): a returned sentinel string, a `{ ok: false, reason }`, a thrown SaleInputError or LeadInputError (reason = its code), a Postgres 23505/23503/23514 (also under `.cause`), an unresolved ref, a producer-live org. Any other thrown error is rethrown unchanged."
  - "isProducerFlowLive(orgId) is checked in a pre-scan before the first write AND again immediately before each won createSale and each settleReceivable; a live org throws ImportExecutionError(op, 'producer_flow_live'). No emission path is modified."
  - "writeAuditEntry is the LAST statement, on the same `tx`, exactly once per successful run: action 'import.completed', actorOrgId = orgId (never null), entityType 'importacao', entityId = randomUUID(), beforeJsonb {}, afterJsonb { counts, actorLabel }."
  - "'import.completed' is appended to AuditActionSchema only; CadastroEntityTypeSchema and CADASTRO_LIFECYCLE_ACTIONS stay unchanged (D10)."
  - "ImportExecutionError.message is pt-BR, names the tab and Excel row (and the parcela label for a settlement) and NEVER contains a uuid, a planKey or a column key. The `operation` field may contain ids: the route must never serialize it."
  - "The sales-ops/service.ts change is ONE new exported function (ensureSystemFuncoes) and one exported type alias; no existing function body changes. It must not add any `saoPauloDayOf(now)` or `todayInSaoPaulo(now)` occurrence (sao-paulo-day-decisions.test.ts counts them)."
  - "Integration tests clean up with deleteSettlementsForOrgs FIRST, then the integration outbox, then the ledger, sales and cadastros in FK order through getAdminDb. audit_log is append-only and is never deleted; tests scope it by a fresh org id."
  - "Do not touch apps/web/**, types.ts, workbook-schema.ts, cells.ts, parse.ts, refs.ts, catalog.ts, plan/** or routes.ts."
  - "No em dash in any file; relative imports use the `.js` extension (NodeNext)."
verifier_focus: "That the all-or-nothing oracles compare a full per-table row snapshot (all 16 sales_ops tables + audit_log + integration_outbox) and are not vacuous (the success test on the same plan shape produces non-zero rows in each); that the database-error oracle really fails INSIDE a service savepoint (createProduct duplicate code suffix) and still rolls everything back; that the producer-live refusal leaves the outbox empty and is restored to a closed gate in finally; that the audit entry is single and last; that won_at is the historical 15:00Z instant and the other_cost payable is due on wonOn; and that executor.ts has no write of its own (source guard)."
---

# Slice 06 - Executor

## Objective

Implement `executeImportPlan(tx, orgId, plan, actor, now)` in `apps/api/src/domains/import/executor.ts`.
It runs an already validated `ImportPlan` as ONE all-or-nothing sequence of existing domain-service calls on the transaction the route (slice 07) opened with `withTenant`, and writes one `import.completed` audit entry at the end.
It also adds `'import.completed'` to `AuditActionSchema`.
Nothing is mounted here; the planners are not merged yet, so the tests use hand-built `ImportPlan` objects.

## Code facts (verified while planning)

Transactions and savepoints:
- `withTenant(db, orgId, fn)` (`sales-ops/service.ts:1418`) is `db.transaction(async tx => { await setTenantContext(tx, orgId); return fn(tx) })`.
  On a drizzle transaction handle, `.transaction()` is a SAVEPOINT: drizzle-orm 0.45.2 `PostgresJsTransaction.transaction` calls `this.session.client.savepoint(...)` (`node_modules/drizzle-orm/postgres-js/session.js:130-141`), and postgres 3.4.9 `scope()` runs `savepoint sN`, on throw `rollback to sN` and rethrows, on success leaves it (released at commit) (`node_modules/postgres/src/index.js:251-288`).
  The repo already relies on this: `updateFuncao` (`service.ts:1821`) and `updateLeadStage` (`leads/stage-service.ts:162`) open `tx.transaction(...)` inside `withTenant`.
- `setTenantContext` is `SELECT set_config('app.current_org_id', $orgId, true)` (`middleware/auth.ts:34`), transaction-local.
  Run again inside a savepoint it sets the same value; a released savepoint keeps it, a rolled-back one restores the outer value, which is the same org. Harmless by construction, and the all-or-nothing integration oracle below proves the nesting on the real driver.
- A failed query inside a savepoint is rolled back to that savepoint and rethrown, so the outer transaction stays usable; the executor converts and throws anyway, and the route's `withTenant` then rolls back everything.

Service signatures, returns and sentinels (all take `db: Db` first, open their own `withTenant`):
- `createArea(db, orgId, AreaInput)` -> row | `'duplicate'`.
- `createFuncao(db, orgId, FuncaoInput)` -> row | `'reserved_slug' | 'duplicate' | 'duplicate_slug'`.
- `resolveProductRefs(db, orgId, Partial<ProductInput>)` -> `{ ok: true } | { ok: false, reason: 'unknown_area' } | { ok: false, reason: 'unknown_funcao', funcaoId }`. The POST route calls it before `createProduct`, because `createProduct` itself does NOT check the área or the função ids.
- `createProduct(db, orgId, ProductInput)` -> `{ product, productFuncaoCosts }`; never a sentinel; a repeated `code_suffix` raises 23505 on `sales_ops_products_org_code_suffix_idx` from inside its savepoint.
- `createPerson(db, orgId, PersonInput)` -> person (with `id`) | `'unknown_funcao' | 'funcao_required'`. `funcaoIds` is the full set (deduped by `planPersonFuncoes`); every id must exist in the org.
- `createClient(db, orgId, ClientInput)` -> row.
- `createLeadStage(db, orgId, LeadStageInput)` -> row | `'duplicate'`; always `kind: 'normal'` at `max(position) + 1`.
- `createLead(db, orgId, CreateLeadInput, scope: LeadScope)` -> `{ ok: true, lead: LeadView } | { ok: false, reason: 'not_found' | 'seller_scope' | 'seller_person_unmapped' | 'already_converted' }`; THROWS `LeadInputError` (`seller_not_found`, `seller_not_a_vendedor`, `client_not_found`, `product_not_found`, `no_open_stage`, ...). The lead lands in the first ACTIVE `normal` stage by `(position, name)`; `lead.stageId` tells which.
- `moveLead(db, orgId, leadId, MoveLeadInput, scope)` -> same union; THROWS `LeadInputError` (`stage_not_found`, `lost_reason_required`, `sale_required_for_conversion`, `sale_not_allowed`). `position` is clamped, so `100_000` appends at the end of the column. It is the only writer of `stage_id` and `lost_reason`.
- `LeadScope = { userId, email, isAdmin }`; `isAdmin: true` returns the no-predicate gate without touching `resolveCallerPersonId` (which would self-claim a pessoa by e-mail, a write). Use `email: null`.
- `createSale(db, orgId, CreateSaleInput, now = new Date())` -> `{ sale, ledger, payables }`; THROWS `SaleInputError` (`product_not_found`, `product_area_missing`, `area_not_found`, `seller_not_found`, `finder_not_found`, `person_not_found`, `funcao_not_found`). `won_at = now` when `status === 'won'`, and won payables use `wonDate: saoPauloDayOf(now)` (one-shot `other_cost` and the professional fallback are due that day). A won sale emits obligation events only when `isProducerFlowLive(orgId)`.
- `transitionSale(db, orgId, saleId, to, now = new Date())` -> `{ ok: true, sale } | { ok: false, reason: 'not_found' | 'invalid_transition' | 'sale_has_active_settlements' }`. `open -> lost|cancelled` and `draft -> cancelled` are allowed; `draft -> lost` is not. Leaving a never-won sale emits nothing.
- `applyBaixaTx(tx, orgId, { target: { kind, id }, paidOn, today, origin: 'manual', actor }, { mode: 'manual' })` (`settlements.ts:430`) -> `{ ok: true, settlement, row } | { ok: false, reason: SettlementErrorCode }` (`not_found`, `sale_not_won`, `row_void`, `already_paid`, `already_reversed`, `invalid_paid_on`, `paid_on_in_future`, `invalid_amount`). It does NOT open `withTenant`: the passed `tx` must already carry the tenant context, which the route's outer `tx` does. Manual policy = `validarNovaBaixa` (whole open amount, never in the future, sale must be `won`). With `mode: 'manual'` it enqueues a settlement event when the producer flow is live, hence the executor's re-check.
- `writeAuditEntry(db, entry)` (`audit/service.ts`) takes the global tail row `FOR UPDATE`; it must be the last statement of the transaction (CLAUDE.md, `auditCadastroLifecycle` comment). `entityType` is a free `string` there; `CadastroEntityTypeSchema` is only used by the cadastro lifecycle callers and is NOT consulted by `writeAuditEntry` or the history read.
- The history read (`GET /sales-ops/history`, `listOrgAuditHistory`) filters by `actor_org_id` and an optional free-text action set; nothing enumerates `AuditActionSchema.options`. The web panel filters to its own `CADASTRO_HISTORY_ACTIONS`, so `import.completed` stays invisible there (D10).
- `isProducerFlowLive(orgId)` / `registerProducerFlowGate(fn)` live in `domains/integration/producer-gate.ts`; the default gate is closed.

Fresh-org gaps found while planning (both load-bearing for AC2, see Seam deviations):
- `ensureLeadStages(tx, orgId)` (`leads/stages-seed.ts:62`, exported) has NO production caller; migration 0022 seeded only the orgs that existed then. An org first seen later has ZERO stages, so `createLead` throws `no_open_stage` and `Perdido` does not exist.
- The system funções `vendedor` / `finder` are created on demand only by `resolvePersonFuncoes` through the deprecated boolean payload (`isSeller`/`isFinder`). A fresh org has neither, and `createFuncao` refuses their slugs (`reserved_slug`). The example workbook gives the pessoa the função `Vendedor` (01 "Example story check"), so a fresh-org import cannot resolve it without a seeding path.

Testing:
- Integration files: `src/**/*.integration.test.ts` run under `VITEST_INTEGRATION=1` (`apps/api/vitest.config.ts`) with `test/rls/global-setup.ts` (migrate) and `test/rls/setup-env.ts` (points `DATABASE_URL` at `TEST_DATABASE_URL`, the non-superuser `fxl_sales_test` role, RLS live). `getDb()` therefore hits the test DB; `getAdminDb()` is the admin context for seeding, reads and cleanup. Files run serially.
- Cleanup precedent: `settlements.integration.test.ts` and `producer-emission.integration.test.ts` (`deleteSettlementsForOrgs(orgIds)` first, then payables, receivables, professionals, items, sales; outbox by `organization_id`), `test/rls/leads-seller-scope.test.ts:88-102` (lead products, leads, lead stages, ..., product funcao costs, products, areas, person funcoes, people, funcoes, clients).
- The local test DB must be up (`make db-up`); the integration suite fails loudly otherwise.

## File 1 - `apps/api/src/domains/audit/service.ts`

Append `'import.completed'` as the LAST member of `AuditActionSchema`, with a comment above it:

```ts
  // One entry per committed spreadsheet import (domains/import/executor.ts).
  // Deliberately NOT a cadastro lifecycle action: CADASTRO_LIFECYCLE_ACTIONS and
  // CadastroEntityTypeSchema stay unchanged, so the cadastro history panel never
  // lists it (importacao-planilha D10). entityType is 'importacao'.
  'import.completed',
```

Nothing else in this file changes.

## File 2 - `apps/api/src/domains/sales-ops/service.ts` (one addition)

Directly below `resolvePersonFuncoes`, add:

```ts
export type SystemFuncaoSlug = (typeof SYSTEM_FUNCAO_SLUGS)[number];

/**
 * Returns the ids of the requested SYSTEM funções, creating the missing ones
 * exactly like a person write does (resolvePersonFuncoes' legacy-slug path), so
 * an org first seen after migration 0012 can reference Vendedor/Finder by id.
 *
 * MUST run inside an already tenant-scoped transaction (the caller's tx). The
 * only caller is the spreadsheet import executor; every other path keeps
 * seeding through createPerson/updatePerson.
 */
export async function ensureSystemFuncoes(
  tx: Db,
  orgId: string,
  slugs: readonly SystemFuncaoSlug[],
): Promise<Map<SystemFuncaoSlug, string>> {
  const wanted = [...new Set(slugs)];
  if (wanted.length === 0) return new Map();
  const rows = await resolvePersonFuncoes(tx, orgId, { kind: 'slugs', slugs: wanted });
  if (rows === 'unknown_funcao') throw new Error('system_funcao_seed_failed');
  return new Map(wanted.map((slug, index) => [slug, rows[index]!.id]));
}
```

`SystemFuncaoSlug` is assignable to `LegacyFuncaoSlug` (both slugs are keys of `LEGACY_FUNCAO_SEEDS`); if `tsc` disagrees, type `wanted` as `LegacyFuncaoSlug[]` and record it in the exec notes.

## File 3 - `apps/api/src/domains/import/executor.ts`

### Imports (exact)

```ts
import { randomUUID } from 'node:crypto';
import { and, asc, eq, ne } from 'drizzle-orm';
import { isIsoDay, todayInSaoPaulo } from '@fxl-sales/shared-utils/sao-paulo-day';
import { salesOpsPayables, salesOpsReceivables } from '../../db/schema.js';
import { writeAuditEntry } from '../audit/service.js';
import { isProducerFlowLive } from '../integration/producer-gate.js';
import {
  AreaSchema, ClientSchema, CreateSaleSchema, FuncaoSchema, PersonSchema, ProductSchema,
  SaleInputError, createArea, createClient, createFuncao, createPerson, createProduct,
  createSale, ensureSystemFuncoes, resolveProductRefs, transitionSale,
  type CadastroActor, type Db, type SystemFuncaoSlug,
} from '../sales-ops/service.js';
import { applyBaixaTx } from '../sales-ops/settlements.js';
import { LeadInputError, createLead, moveLead, type LeadScope } from '../sales-ops/leads/lead-service.js';
import { CreateLeadSchema, MoveLeadSchema } from '../sales-ops/leads/lead-schemas.js';
import { LeadStageSchema } from '../sales-ops/leads/schemas.js';
import { createLeadStage } from '../sales-ops/leads/stage-service.js';
import { LEAD_STAGE_SEEDS, ensureLeadStages } from '../sales-ops/leads/stages-seed.js';
import type { EntityRef, ImportCounts, ImportOperation, ImportPlan, SheetKey } from './types.js';
import { SHEET_KEYS, getSheetDef } from './workbook-schema.js';
```

### Exports (exact)

```ts
export type ImportActor = CadastroActor;
export type ImportExecutionResult = { counts: ImportCounts };

/** Reserved planKey prefix for rows the executor materializes itself (see Seam deviations). */
export const SYSTEM_REF_PREFIX = 'system:';
export const SYSTEM_FUNCAO_REF_PREFIX = 'system:funcao:';      // + 'vendedor' | 'finder'
export const SYSTEM_LEAD_STAGE_REF_PREFIX = 'system:leadStage:'; // + LEAD_STAGE_SEEDS[i].position (1..4)
export const LEAD_MOVE_TO_END = 100_000;
export const WON_AT_UTC_TIME = 'T15:00:00.000Z';                // noon in São Paulo

export class ImportExecutionError extends Error {
  constructor(readonly operation: ImportOperation, readonly reason: string) {
    super(importExecutionMessage(operation, reason));
    this.name = 'ImportExecutionError';
  }
}

export function importExecutionMessage(operation: ImportOperation, reason: string): string;
export function collectOperationRefs(operation: ImportOperation): EntityRef[];
export async function executeImportPlan(tx: Db, orgId: string, plan: ImportPlan, actor: ImportActor, now: Date): Promise<ImportExecutionResult>;
```

### `importExecutionMessage(operation, reason)`

- Location key: `operation.planKey` for every op that has one; `operation.saleKey` for `transitionSale` and `settleReceivable`.
- `parsePlanKey(key)`: match `/^([A-Za-z]+):(\d+)$/`; the sheet must be in `SHEET_KEYS`; otherwise `null` (a `system:` key or malformed).
- Location text: `Aba ${getSheetDef(sheet).tab}, linha ${row}` or, when `null`, `Importação`.
  For `settleReceivable` append ` (parcela ${operation.receivableLabel})`.
- Result: `${location}: ${REASON_MESSAGES[reason] ?? FALLBACK}.` where `FALLBACK = 'o registro foi recusado pelo sistema'`.
- `REASON_MESSAGES` (exact, module-private `Record<string, string>`):

| reason | message |
| --- | --- |
| `duplicate` | `já existe um cadastro com este nome` |
| `duplicate_slug` | `já existe uma função com nome equivalente` |
| `reserved_slug` | `este nome é reservado para uma função do sistema` |
| `unknown_area` | `a área informada não existe nesta organização` |
| `unknown_funcao` | `uma das funções informadas não existe nesta organização` |
| `funcao_required` | `a pessoa precisa de pelo menos uma função` |
| `invalid_area`, `invalid_funcao`, `invalid_product`, `invalid_person`, `invalid_client`, `invalid_lead_stage`, `invalid_lead`, `invalid_sale` | `os dados da linha foram recusados pela validação do sistema` |
| `product_not_found` | `o produto informado não existe nesta organização` |
| `product_area_missing` | `o produto informado não tem área` |
| `area_not_found` | `a área informada não existe nesta organização` |
| `seller_not_found` | `o vendedor informado não existe nesta organização` |
| `seller_not_a_vendedor` | `a pessoa informada como vendedor não tem a função Vendedor` |
| `finder_not_found` | `o finder informado não existe nesta organização` |
| `person_not_found` | `a pessoa informada não existe nesta organização` |
| `funcao_not_found` | `a função informada não existe nesta organização` |
| `client_not_found` | `o cliente informado não existe nesta organização` |
| `stage_not_found` | `a etapa informada não existe ou está arquivada` |
| `no_open_stage` | `não há etapa ativa para receber o lead` |
| `lost_reason_required` | `a etapa de perda exige o motivo da perda` |
| `sale_required_for_conversion` | `um lead não pode ser importado na etapa de conversão` |
| `invalid_transition` | `a proposta não pode mudar para este status a partir do status atual` |
| `sale_has_active_settlements` | `a proposta tem pagamentos registrados` |
| `sale_not_won` | `a proposta precisa estar Ganha para registrar pagamento` |
| `row_void` | `a parcela foi cancelada` |
| `already_paid` | `a parcela já está paga` |
| `invalid_paid_on` | `a data de pagamento é inválida` |
| `paid_on_in_future` | `a data de pagamento está no futuro` |
| `receivable_not_found` | `a parcela não existe nesta proposta` |
| `receivable_ambiguous` | `há mais de uma parcela com este rótulo nesta proposta` |
| `won_on_mismatch` | `a data de ganho só vale para uma proposta Ganha, e uma proposta Ganha exige a data` |
| `invalid_won_on` | `a data de ganho é inválida` |
| `won_on_in_future` | `a data de ganho está no futuro` |
| `producer_flow_live` | `esta organização está conectada ao FXL Finance, então propostas ganhas e pagamentos não podem ser importados` |
| `unresolved_ref` | `a linha referencia um registro que não foi criado antes dela` |
| `duplicate_plan_key` | `a linha aparece duas vezes no plano de importação` |
| `db_unique_violation` | `o registro repete um valor que precisa ser único (por exemplo, o código do produto)` |
| `db_foreign_key_violation` | `o registro referencia um cadastro que não existe` |
| `db_check_violation` | `o registro tem um valor fora do permitido` |

### `collectOperationRefs(operation)` (pure)

Returns, in this order: `createProduct`: `areaRef`, each `funcaoCosts[].funcaoRef`; `createPerson`: `funcaoRefs`; `createLead`: `clientRef`, `sellerRef`, each non-null `products[].productRef`, `stageRef` (nulls skipped); `createSale`: `input.clientRef`, `input.sellerRef`, `input.finderRef`, each `items[].productRef` / `areaRef`, each `professionals[].personRef` / `funcaoRef` (nulls skipped); `transitionSale` / `settleReceivable`: `{ planKey: saleKey }`; every other op: `[]`.

### `executeImportPlan(tx, orgId, plan, actor, now)` algorithm

0. Invariant: if `plan.issues.some(i => i.severity === 'error')` throw `new Error('import_plan_has_errors')` (plain Error: a programmer error, the route never calls with errors). No `tx` access before this line.
1. Producer pre-scan: for each op in order, if `needsProducerGate(op)` and `isProducerFlowLive(orgId)`, throw `new ImportExecutionError(op, 'producer_flow_live')`.
   `needsProducerGate(op)` = `op.op === 'settleReceivable' || (op.op === 'createSale' && (op.input.status === 'won' || op.wonOn !== null))`.
   Still no `tx` access.
2. `const ids = new Map<string, string>()`, `const today = todayInSaoPaulo(now)`, `const scope: LeadScope = { userId: actor.userId, email: null, isAdmin: true }`.
3. Prelude (system rows), computed from `plan.operations.flatMap(collectOperationRefs)` planKeys:
   - Funções: the set of suffixes of keys starting with `SYSTEM_FUNCAO_REF_PREFIX` that are `'vendedor'` or `'finder'`. If non-empty: `const m = await ensureSystemFuncoes(tx, orgId, [...set])`; for each, `ids.set(SYSTEM_FUNCAO_REF_PREFIX + slug, id)`.
   - Etapas: if any op is `createLead` or `createLeadStage`, or any key starts with `SYSTEM_LEAD_STAGE_REF_PREFIX`: `const stages = await ensureLeadStages(tx, orgId)`; for each `seed` of `LEAD_STAGE_SEEDS`, find `stages.find(s => s.kind === seed.kind && s.name === seed.name)`; if found, `ids.set(SYSTEM_LEAD_STAGE_REF_PREFIX + seed.position, row.id)`.
     `ensureLeadStages` seeds only an org with ZERO stages, so an org that already has its funnel is untouched.
   - Any other `system:` key stays unmapped and fails as `unresolved_ref` at its operation.
4. For each `op` of `plan.operations`, in order: `await runOperation(op)`, where `runOperation` wraps `dispatch(op)` in `try/catch`:
   - `ImportExecutionError` -> rethrow; `SaleInputError` / `LeadInputError` -> `new ImportExecutionError(op, error.code)`;
   - Postgres code (read `error.code`, else `error.cause.code`, same probe as `mapFuncaoUniqueViolation`): `23505` -> `db_unique_violation`, `23503` -> `db_foreign_key_violation`, `23514` -> `db_check_violation`;
   - anything else -> rethrow unchanged.
   Helpers inside the closure: `resolve(ref, op)` = `'existingId' in ref ? ref.existingId : ids.get(ref.planKey) ?? throw new ImportExecutionError(op, 'unresolved_ref')`; `register(op, planKey, id)` throws `duplicate_plan_key` if `ids.has(planKey)`, else sets it.
5. `dispatch(op)` per kind (each `safeParse` failure throws the named `invalid_*` reason):
   - `createArea`: `AreaSchema.safeParse(op.input)` (`invalid_area`); `r = await createArea(tx, orgId, data)`; `r === 'duplicate'` -> throw `'duplicate'`; `register(op.planKey, r.id)`.
   - `createFuncao`: `FuncaoSchema` (`invalid_funcao`); `typeof r === 'string'` -> throw `r`; register.
   - `createProduct`: `ProductSchema.safeParse({ ...op.input, areaId: resolve(op.areaRef), productFuncaoCosts: op.funcaoCosts.map(c => ({ ...c.cost, funcaoId: resolve(c.funcaoRef) })) })` (`invalid_product`); `refs = await resolveProductRefs(tx, orgId, data)`; `!refs.ok` -> throw `refs.reason`; `created = await createProduct(tx, orgId, data)`; register `created.product.id`.
   - `createPerson`: `PersonSchema.safeParse({ ...op.input, funcaoIds: [...new Set(op.funcaoRefs.map(resolve))] })` (`invalid_person`); `typeof r === 'string'` -> throw `r`; register `r.id`.
   - `createClient`: `ClientSchema` (`invalid_client`); register `r.id`.
   - `createLeadStage`: `LeadStageSchema` (`invalid_lead_stage`); `r === 'duplicate'` -> throw; register.
   - `createLead`: `CreateLeadSchema.safeParse({ ...op.input, clientId: op.clientRef ? resolve(op.clientRef) : null, sellerPersonId: op.sellerRef ? resolve(op.sellerRef) : null, products: op.products.map(p => p.productRef ? { productId: resolve(p.productRef) } : { productName: p.name }) })` (`invalid_lead`); `created = await createLead(tx, orgId, data, scope)`; `!created.ok` -> throw `created.reason`; register `created.lead.id`.
     Then only when `op.stageRef !== null`: `MoveLeadSchema.safeParse({ stageId: resolve(op.stageRef), position: LEAD_MOVE_TO_END, ...(op.lostReason !== null ? { reason: op.lostReason } : {}) })` (`invalid_lead`); `moved = await moveLead(tx, orgId, created.lead.id, move, scope)`; `!moved.ok` -> throw `moved.reason`.
     The move runs even when the stage is the default one (03 decision L5: a harmless append in the same column), which also keeps workbook row order.
   - `createSale`:
     - won-day consistency: `const won = op.input.status === 'won'`; `won !== (op.wonOn !== null)` -> `won_on_mismatch`; when won: `!isIsoDay(op.wonOn)` -> `invalid_won_on`; `op.wonOn > today` -> `won_on_in_future`; `isProducerFlowLive(orgId)` -> `producer_flow_live` (the re-check).
     - Build `{ ...rest, clientId?, sellerPersonId, finderPersonId?, items, professionals }` from the draft: drop `clientRef`, `sellerRef`, `finderRef`; `clientId` / `finderPersonId` only when the ref is non-null (conditional spread); each item drops `productRef` / `areaRef` and spreads `productId` / `areaId` only for a non-null ref; each professional drops `personRef` / `funcaoRef` likewise into `personId` / `funcaoId`.
     - `CreateSaleSchema.safeParse(candidate)` (`invalid_sale`).
     - `const at = won ? new Date(`${op.wonOn}${WON_AT_UTC_TIME}`) : now`; `result = await createSale(tx, orgId, data, at)`; register `result.sale.id`.
   - `transitionSale`: `saleId = resolve({ planKey: op.saleKey })`; `r = await transitionSale(tx, orgId, saleId, op.to, now)`; `!r.ok` -> throw `r.reason`.
   - `settleReceivable`:
     - `isProducerFlowLive(orgId)` -> `producer_flow_live` (the re-check); `saleId = resolve({ planKey: op.saleKey })`.
     - `rows = await tx.select({ id: salesOpsReceivables.id }).from(salesOpsReceivables).where(and(eq(salesOpsReceivables.orgId, orgId), eq(salesOpsReceivables.saleId, saleId), eq(salesOpsReceivables.label, op.receivableLabel), ne(salesOpsReceivables.status, 'void')))`; 0 rows -> `receivable_not_found`; more than 1 -> `receivable_ambiguous`.
     - `baixa = await applyBaixaTx(tx, orgId, { target: { kind: 'receivable', id }, paidOn: op.paidOn, today, origin: 'manual', actor }, { mode: 'manual' })`; `!baixa.ok` -> throw `baixa.reason`.
     - When `op.settlePayables`: `payables = await tx.select({ id: salesOpsPayables.id }).from(salesOpsPayables).where(and(eq(salesOpsPayables.orgId, orgId), eq(salesOpsPayables.saleId, saleId), eq(salesOpsPayables.receivableId, id), ne(salesOpsPayables.status, 'void'))).orderBy(asc(salesOpsPayables.dueDate), asc(salesOpsPayables.id))`; for each, the same `applyBaixaTx` with `kind: 'payable'`; `!ok` -> throw. No linked payable is not an error.
6. `const counts: ImportCounts = { ...plan.counts }`.
7. LAST: `await writeAuditEntry(tx, { actorUserId: actor.userId, actorOrgId: orgId, action: 'import.completed', entityType: 'importacao', entityId: randomUUID(), beforeJsonb: {}, afterJsonb: { counts, actorLabel: actor.displayName } })`.
8. `return { counts }`.

A plan with zero operations still writes the audit entry (an import that was confirmed is an act); slice 07 decides whether such a commit is reachable.

## Red tests (write first, watch them fail, then implement)

### `apps/api/src/domains/import/__tests__/executor.test.ts` (unit, no DB)

A `untouchableTx` is `new Proxy({}, { get() { throw new Error('tx touched') } }) as unknown as Db`.
Producer cases register `registerProducerFlowGate(() => true)` and restore `registerProducerFlowGate(() => false)` in `afterEach`.

- `formats the tab and Excel row of a cadastro operation` - `createProduct` with `planKey: 'produtos:7'` and `reason: 'db_unique_violation'` -> starts with `Aba Produtos, linha 7: `.
- `names the parcela of a refused settlement` - `settleReceivable` with `saleKey: 'propostas:3'`, `receivableLabel: '2/4'`, `already_paid` -> `Aba Propostas, linha 3 (parcela 2/4): a parcela já está paga.`
- `never puts an id in the message` - a `createSale` whose refs are `{ existingId: <uuid> }`, every reason in the table -> no message matches the uuid regex, `planKey` text or `system:`.
- `falls back to a generic sentence for an unknown reason` and `uses Importação for a system key`.
- `exposes operation and reason on ImportExecutionError` - `instanceof Error`, `name`, `operation` (same reference), `reason`.
- `collects every ref of every operation kind` - one op per kind; asserts the exact arrays (order above), nulls skipped.
- `refuses a plan that still carries an error issue before touching the transaction` - rejects with `import_plan_has_errors` using `untouchableTx`.
- `refuses a won proposta in a producer-live org before touching the transaction` - plan `[createArea, createSale(won)]` -> `ImportExecutionError`, `reason === 'producer_flow_live'`, `operation.op === 'createSale'`, `untouchableTx` never touched.
- `refuses a settlement in a producer-live org before touching the transaction` - `[createSale(open), settleReceivable]` -> refused on `settleReceivable`.
- `keeps the reserved system ref keys stable` - `SYSTEM_FUNCAO_REF_PREFIX + 'vendedor' === 'system:funcao:vendedor'`, `SYSTEM_LEAD_STAGE_REF_PREFIX + 4 === 'system:leadStage:4'`, and `LEAD_STAGE_SEEDS` positions are `[1, 2, 3, 4]` with kinds `normal, normal, conversion, lost`.
- `adds import.completed to the audit actions and keeps it out of the cadastro lifecycle` - `AuditActionSchema.safeParse('import.completed').success`, `CADASTRO_LIFECYCLE_ACTIONS` does not include it, `CadastroEntityTypeSchema.safeParse('importacao').success === false`.
- `executor source writes nothing itself` - read `../executor.ts` with `readFileSync(new URL('../executor.ts', import.meta.url), 'utf8')`; vacuity control: length > 3000 and it contains `applyBaixaTx(` and `writeAuditEntry(`; it must not match `/\.insert\(|\.update\(|\.delete\(/`, `/getAdminDb|getDb\(/`, `/process\.env/`, `/new Date\(\)/`, `/withTenant/`, `/toISOString\(\)\.slice/`.

### `apps/api/src/domains/import/__tests__/executor.integration.test.ts` (real DB)

Setup: `ACTOR = { userId: 'hub-account-import-1', displayName: 'Equipe FXL' }`, `NOW = new Date('2026-06-01T15:00:00.000Z')` (today `2026-06-01`), `newOrg(tag)` = `org_imp_${tag}_${randomUUID()}` pushed to `seededOrgIds`; `run(orgId, plan) = withTenant(getDb(), orgId, (tx) => executeImportPlan(tx, orgId, plan, ACTOR, NOW))`.
`snapshot(orgId)` returns `{ [table]: count }` for the 16 org tables (`sales_ops_areas`, `sales_ops_funcoes`, `sales_ops_products`, `sales_ops_product_funcao_costs`, `sales_ops_people`, `sales_ops_person_funcoes`, `sales_ops_clients`, `sales_ops_lead_stages`, `sales_ops_leads`, `sales_ops_lead_products`, `sales_ops_sales`, `sales_ops_sale_items`, `sales_ops_sale_professionals`, `sales_ops_receivables`, `sales_ops_payables`, `sales_ops_settlements`, each `WHERE org_id = $1` through `getAdminDb().execute(sql\`SELECT count(*)::int AS n FROM ${sql.identifier(table)} WHERE org_id = ${orgId}\`)`), plus `audit_log` (`actor_org_id`) and `integration_outbox` (`organization_id`).
`afterEach`: `deleteSettlementsForOrgs(seededOrgIds)`, then per org through `getAdminDb()` in this order: `integration_outbox`, lead products, leads, lead stages, payables, receivables, sale items, sale professionals, sales, product funcao costs, products, areas, person funcoes, people, funcoes, clients; clear the arrays; `registerProducerFlowGate(() => false)`. `afterAll`: `closeDb()`.

`fullPlan(existingAreaId)` builds, in this order (planKeys are `<sheet>:<row>`):
1. `createArea areas:2 { name: 'Área Importada', status: 'active' }`
2. `createFuncao funcoes:2 { name: 'Consultor', status: 'active' }`
3. `createProduct produtos:2` input `{ name: 'Produto Importado', kind: 'product', codeSuffix: '7', setupBrl: 300000, hasMonthly: false, monthlyBrl: 0, recurringCommission: false, hasFinderCommission: false, sellerCommissionType: 'pct', sellerCommissionValue: 10, finderCommissionType: 'pct', finderCommissionValue: 3, defaultPaymentMethod: 'pix', defaultEntradaMode: 'none', defaultEntradaPct: null, defaultEntradaBrl: null, defaultRemainingInstallments: 1, defaultRecurringCycles: null, modules: [], providers: [], status: 'active' }`, `areaRef { planKey: 'areas:2' }`, `funcaoCosts [{ funcaoRef: { planKey: 'funcoes:2' }, cost: { mode: 'pct', valuePct: 5 } }]`
4. `createPerson pessoas:2 { displayName: 'Ana Importada', contactEmail: 'ana.importada@example.com', status: 'active' }`, `funcaoRefs [{ planKey: 'system:funcao:vendedor' }, { planKey: 'funcoes:2' }]`
5. `createClient clientes:2 { name: 'Cliente Importado', document: '12.345.678/0001-90' }`
6. `createLeadStage etapas:2 { name: 'Diagnóstico', status: 'active' }`
7. `createLead leads:2 { contactName: 'Bruno', clientName: 'Cliente Importado', estimatedValueBrl: 120000 }`, `clientRef clientes:2`, `sellerRef pessoas:2`, `products [{ productRef: { planKey: 'produtos:2' }, name: 'Produto Importado' }]`, `stageRef etapas:2`, `lostReason null`
8. `createLead leads:3 { contactName: 'Carla', clientName: 'Empresa Livre', estimatedValueBrl: 0 }`, `clientRef null`, `sellerRef null`, `products [{ productRef: null, name: 'Consultoria avulsa' }]`, `stageRef { planKey: 'system:leadStage:4' }`, `lostReason 'Sem orçamento'`
9. `createLead leads:4 { contactName: 'Diego', clientName: 'Cliente Importado', estimatedValueBrl: 0 }`, `clientRef clientes:2`, `sellerRef pessoas:2`, `products []`, `stageRef etapas:2`, `lostReason null`
10. `createSale propostas:2` won: `{ clientRef: clientes:2, clientName: 'Cliente Importado', sellerRef: pessoas:2, sellerName: 'Ana Importada', finderRef: null, finderName: null, status: 'won', baseDate: '2026-03-01', notes: null, sellerCommissionPct: 10, finderCommissionPct: 0, taxPct: 6, otherCostsBrl: 10000, items: [{ productRef: produtos:2, areaRef: null, productName: 'Produto Importado', quantity: 1, unitBrl: 300000 }], professionals: [{ personRef: pessoas:2, funcaoRef: funcoes:2, personName: 'Ana Importada', costBrl: 40000, costSplitBp: null }], installments: [{ dueDate: '2026-03-10', amountBrl: 150000, method: 'pix' }, { dueDate: '2026-04-10', amountBrl: 150000, method: 'pix' }], recurring: null }`, `wonOn '2026-03-10'`
11. `createSale propostas:3` open: same seller and client, `taxPct: 6`, `otherCostsBrl: 0`, `items [{ productRef: null, areaRef: { existingId: existingAreaId }, productName: 'Diagnóstico avulso', quantity: 1, unitBrl: 50000 }]`, `professionals []`, `installments [{ dueDate: '2026-05-01', amountBrl: 50000, method: 'boleto' }]`, `wonOn null`
12. `createSale propostas:4` draft: one product item `1 x 300000`, one installment `300000` on `2026-05-10`, `wonOn null`
13. `transitionSale propostas:3 -> lost`
14. `transitionSale propostas:4 -> cancelled`
15. `settleReceivable propostas:2 '1/2' paidOn '2026-03-15' settlePayables true`

with `issues: []` and `counts: { areas: 1, funcoes: 1, produtos: 1, custosProduto: 1, pessoas: 1, clientes: 1, etapas: 1, leads: 3, propostas: 3, pagamentos: 1 }`.
Each test pre-seeds the existing área with `createArea(getDb(), orgId, { name: 'Área Existente', status: 'active' })`.

Cases:
- `creates one of everything from a hand-built plan, including a won proposta on its historical day and a settled parcela` - result `counts` equals `plan.counts`; areas 2, funções exactly `consultor` + system `vendedor` (no `finder`: only referenced slugs are seeded), product `code_suffix '7'` with one função cost; pessoa with 2 person_funcoes; 5 lead stages (the 4 seeds + Diagnóstico); sales `won`, `lost`, `cancelled` with codes `0001-7`, `0002-0`, `0003-7`; the won sale `won_at.toISOString() === '2026-03-10T15:00:00.000Z'`; 7 payables (2 seller 15000, 2 tax 9000, 2 professional 20000, 1 `other_cost` 10000 with `receivable_id` null and due day `2026-03-10` via `asDateOnly`); receivable `1/2` status `paid`, `2/2` `open`; 4 settlements (`baixa`, `origin 'manual'`, `paid_on '2026-03-15'`, `actor_name 'Equipe FXL'`) on `1/2` and its seller, tax and professional payables; `other_cost` stays `open`.
- `lands leads in a workbook etapa in row order and in Perdido with its reason` (same run, separate `it` with its own org) - Bruno and Diego in Diagnóstico with Bruno's position < Diego's; Carla in the `kind = 'lost'` seed stage `Perdido` with `lost_reason 'Sem orçamento'`; Bruno's seller snapshot `Ana Importada` (proves the vendedor seeded in the same import passes `resolveSellerPersonId`); lead products: Bruno 1 linked, Carla 1 free text.
- `writes exactly one import.completed entry, last, with the counts and the actor label` - org audit rows: exactly 1; `action 'import.completed'`, `entity_type 'importacao'`, uuid `entity_id`, `after_jsonb` `{ counts: plan.counts, actorLabel: 'Equipe FXL' }`, `before_jsonb` `{}`, 64-char `entry_hash`.
- `rolls back every table when the last operation is refused (all or nothing)` - `before = snapshot(orgId)` after the pre-seed; plan = `fullPlan` + `settleReceivable propostas:2 '9/9'`; rejects with `ImportExecutionError`, `reason 'receivable_not_found'`, message contains `Aba Propostas, linha 2 (parcela 9/9)`; `snapshot(orgId)` deep-equals `before` (so the seeded system função and the 4 seeded stages are gone too).
- `rolls back every table when a service throws a database error inside its savepoint` - plan `[createArea areas:2, createProduct produtos:2 codeSuffix '7', createProduct produtos:3 name 'Outro Produto' codeSuffix '7']`; rejects with `reason 'db_unique_violation'` and `operation.planKey 'produtos:3'`; snapshot equals before.
- `refuses a won proposta in a producer-live org and writes nothing, outbox included` - `registerProducerFlowGate((id) => id === orgId)`; `fullPlan` -> `producer_flow_live` on `propostas:2`; snapshot equals before (outbox 0, audit 0).
- `executes cadastros and open propostas in a producer-live org with an empty outbox` - live gate; plan = steps 1-9, 11 and 13 of `fullPlan` with counts adjusted; resolves; outbox count for the org is 0; audit 1.

## Commands (run once each, never watch mode)

```bash
make db-up   # only if the local Postgres is not running
pnpm --filter @fxl-sales/api exec vitest run src/domains/import/__tests__/executor.test.ts
pnpm --filter @fxl-sales/api test:integration src/domains/import/__tests__/executor.integration.test.ts
pnpm --filter @fxl-sales/api exec eslint src/domains/import/executor.ts src/domains/import/__tests__/executor.test.ts src/domains/import/__tests__/executor.integration.test.ts src/domains/audit/service.ts src/domains/sales-ops/service.ts
pnpm --filter @fxl-sales/api type-check
pnpm --filter @fxl-sales/api test
pnpm --filter @fxl-sales/api test:integration
```

Named locked oracles: `src/domains/import/__tests__/executor.integration.test.ts` (`rolls back every table when the last operation is refused (all or nothing)`, `rolls back every table when a service throws a database error inside its savepoint`, `refuses a won proposta in a producer-live org and writes nothing, outbox included`, `writes exactly one import.completed entry, last, with the counts and the actor label`) and `src/domains/import/__tests__/executor.test.ts` (`executor source writes nothing itself`).
If `@fxl-sales/shared-utils/sao-paulo-day` fails to resolve, run `pnpm run build:packages` once at the repo root and retry.

## Handoff notes for slice 07 (routes)

- Call it as `withTenant(getDb(), orgId, (tx) => readImportCatalog(tx, ...) -> planImport -> executeImportPlan(tx, orgId, plan, actor, now))`; catch `ImportExecutionError` OUTSIDE `withTenant` (the transaction is then rolled back) and answer `409 { error: 'conflict', reason: 'import_execution_failed', message: error.message }`. Never put `error.operation` in a body or a log line (it carries ids).
- `actor` is `cadastroActor(c)` from `sales-ops/routes.ts` (the verified token's account id and name).
- The plain `Error('import_plan_has_errors')` is unreachable when the route checks `ok` first; let it be a 500.

## Seam deviations (proposed amendments to SEAM-CONTRACT.md)

1. Reserved system refs. An `EntityRef` may be `{ planKey: 'system:funcao:vendedor' }`, `{ planKey: 'system:funcao:finder' }` or `{ planKey: 'system:leadStage:<position>' }` (`position` from `LEAD_STAGE_SEEDS`: 1 Novo, 2 Em negociação, 3 Proposta, 4 Perdido).
   The executor materializes them before the first operation: funções through the new `ensureSystemFuncoes` (only the referenced slugs), etapas through the existing `ensureLeadStages`, which it ALSO calls whenever the plan has any `createLead` or `createLeadStage` (it seeds only an org with zero stages).
   Slice 02 is asked to: in `readImportCatalog`, when the org has no função with slug `vendedor` (resp. `finder`), append a virtual entry `{ id: 'system:funcao:vendedor', name: 'Vendedor', slug: 'vendedor', isSystem: true, status: 'active' }` (resp. Finder); when the org has zero stages, append the four `LEAD_STAGE_SEEDS` as `{ id: 'system:leadStage:<position>', name, kind, status: 'active', position }`; and in `buildRefIndex`, turn any catalog id starting with `system:` into `{ planKey: id }` instead of `{ existingId: id }`. The cadastro planner then treats seed names as existing (`duplicate_existing`) exactly like real rows, and slices 03-05 need no change.
   Reason: `ensureLeadStages` has no production caller and system funções are only seeded by deprecated person payloads, so without this a fresh org (the onboarding case) cannot import a lead (`no_open_stage`) or a pessoa with `Vendedor`, and AC2's fresh-org round trip fails. Preview cannot seed (AC3), so the executor must.
   No `types.ts` change: the strings live in `catalog.ts` and `refs.ts` (slice 02) and in `executor.ts` (exported `SYSTEM_*_REF_PREFIX`); slice 07's round-trip test is the cross-check.
2. `apps/api/src/domains/sales-ops/service.ts` gains `export type SystemFuncaoSlug` and `export async function ensureSystemFuncoes(tx, orgId, slugs)` (File 2). No import slice owns that file; this is the only change and it is additive.
3. `ImportExecutionError.message` is the pt-BR user message (built by `importExecutionMessage`), so slice 07's 409 `message` is `error.message`. Zod-failure reasons are `invalid_<entity>` (`invalid_lead` matches 03's Executor notes).
4. Result `counts` is `plan.counts` copied after a successful run (the planners' statement of what was created), and the audit entry stores the same object.

## Findings for the orchestrator (outside this slice)

- Production gap: no production code seeds lead stages for an org first seen after migration 0022, and no non-deprecated path seeds the system funções. The in-app leads board and pessoas dialog of such an org are affected independently of this feature (recorded, not fixed here).
- `canonicalJson` uses `JSON.stringify(obj, Object.keys(obj).sort())`; an array replacer filters keys at EVERY depth, so nested `beforeJsonb` / `afterJsonb` contents are serialized as `{}` and are not covered by `entry_hash`. Pre-existing for every audit entry; verification is self-consistent, but the chain does not protect snapshot contents.
