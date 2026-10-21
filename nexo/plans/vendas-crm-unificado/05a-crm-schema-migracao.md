---
id: 05a-crm-schema-migracao
milestone: v4.8.0
status: todo
depends_on: ["04-levantamento-entidades"]
files_modified: ["nexo/knowledge/decisions/2026-10-21-crm-unificado-modelo.md", "apps/api/src/db/schema.ts", "apps/api/drizzle/0029_crm_unificado_modelo.sql", "apps/api/drizzle/meta/0029_snapshot.json", "apps/api/drizzle/meta/_journal.json", "apps/api/src/db/__tests__/crm-schema.test.ts", "apps/api/test/rls/crm-schema-rls.test.ts"]
affected_tests: [
  {path: apps/api/src/db/__tests__/additive-migrations-guard.test.ts, impact: "its 'every migration after 0028 is additive' case stops being vacuous and now scans 0029", update: none (must stay green), command: "pnpm --filter @fxl-sales/api exec vitest run src/db/__tests__/additive-migrations-guard.test.ts", owner: builder},
  {path: apps/api/src/db/__tests__/single-role-db-contract.test.ts, impact: "reads the bytes of every migration and refuses GRANT or ROLE statements", update: none (must stay green), command: "pnpm --filter @fxl-sales/api exec vitest run src/db/__tests__/single-role-db-contract.test.ts", owner: builder},
  {path: apps/api/test/rls/leads-schema-migration.test.ts, impact: "0022 oracle on the shared test DB, which now also runs 0029", update: none (must stay green), command: "pnpm --filter @fxl-sales/api exec env VITEST_INTEGRATION=1 vitest run test/rls/leads-schema-migration.test.ts", owner: builder}
]
acceptance: "given the repo at migration 0028, when 0029 is applied, then ten new org-scoped tables exist with FORCE RLS and both org policies, every FK is composite with org_id first, the old lead tables are untouched, the additive guard scans 0029 green, and the constraints reject exit/type mismatches, cross-pipeline stages and transitions, a second default pipeline and a value row with zero or two slots"
goal: "ADR plus Drizzle schema plus additive migration 0029 with RLS for pipelines, stages, transitions, field definitions and values, the unified lead, lead events, notes, follow-ups and org modules"
must_not_break: ["sales_ops_leads, sales_ops_lead_products and sales_ops_lead_stages are not altered (no column, index, policy, trigger)", "legacy leads, sales_ops_sales, receivables, payables and settlements are not altered", "migration 0029 contains no DROP, DELETE FROM, TRUNCATE, RENAME, ALTER COLUMN TYPE, GRANT, REVOKE or ROLE statement", "no existing API route, service or web file changes"]
rules: ["Never use the em dash; use '-'", "Migration 0029 is ordinary (no 'fxl-migration-mode: phased' header)", "Hand-edit the generated SQL only through the helper script in step 4, never by retyping", "The SEAM-CONTRACT.md names are authoritative: do not rename a table, column or export"]
verifier_focus: "Run the two new tests; apply the full migration chain to an empty scratch database (the RLS test does) and confirm 10 tables, 20 policies, 20 FKs; read 0029 for any statement against an old table; confirm the snapshot chain (prevId of 0029 equals id of 0028); run the additive guard and the single-role contract; run the integration leads-schema-migration test on the shared DB"
oracle: "apps/api/test/rls/crm-schema-rls.test.ts"
---

# 05a - CRM schema and migration 0029 (phase 1b)

## Context

Input: `nexo/runs/20261021T011348Z-vendas-crm-unificado/levantamento-entidades.md` (sections 1, 3.1, 3.3 to 3.6, 3.12, 3.13, 4, 5) and its Verify notes.
Decisions D1 to D5 of the orchestrator are recorded in the ADR below with their alternatives; the exact names are in `nexo/plans/vendas-crm-unificado/contracts/SEAM-CONTRACT.md`.

Verified anchors on the run branch:
- Old tables stay intact: `salesOpsLeadStages` `apps/api/src/db/schema.ts:927`, `salesOpsLeads` `:1000`, `salesOpsLeadProducts` `:1138`; migration `apps/api/drizzle/0022_sales_ops_leads.sql` (RLS block at lines 97 to 130 is the molde).
- Journal ends at `0028_lead_soft_delete` (`apps/api/drizzle/meta/_journal.json`, `idx` 28); snapshots live in `apps/api/drizzle/meta/NNNN_snapshot.json`. Migrations are produced by `drizzle-kit generate` (config `apps/api/drizzle.config.ts`, it needs no database) and then hand-edited (0022 appends RLS by hand).
- The additive guard `apps/api/src/db/__tests__/additive-migrations-guard.test.ts` has `LAST_HISTORICAL_MIGRATION = 28`; its scanner is `additive-migration-scan.ts` (`scanSql`, `scanMigrationDir`). Do not change it.
- The migration runner `apps/api/src/db/migration-runner.ts` applies non-phased migrations in one transaction as the NOSUPERUSER owner; `throughTag` stops after a tag. Tests use `apps/api/test/rls/scratch-database.ts` (`createScratchDatabase`, `scratchClient`, `cleanupScratch`, `MIGRATIONS_FOLDER`); template `apps/api/test/rls/settlements-schema-migration.test.ts`.
- The shared test DB is migrated once per integration run by `apps/api/test/rls/global-setup.ts`; the new RLS test uses a scratch database instead and therefore does not depend on it.
- `schema.ts` already imports `bigint, boolean, check, date, foreignKey, index, integer, jsonb, numeric, pgTable, text, timestamp, uniqueIndex, uuid` and `sql`: no import changes.

Prototype result (all of the code below was run by the planner on a scratch database against this tree): migration applies, 10 tables, 20 policies, 20 FKs, `crm-schema.test.ts` 26 tests and `crm-schema-rls.test.ts` 45 tests pass, API unit suite 1552 tests pass, `tsc --noEmit` for `tsconfig.json`, `tsconfig.scripts.json` and `tsconfig.test.json` clean.

## Design

- Ten new tables, names and columns exactly as `contracts/SEAM-CONTRACT.md`. Nothing references them yet; no API, web or service code changes.
- Why EAV and not JSONB, why a real `estimated_value_brl`, why no CHECK on growing enumerations, the transition and default pipeline rules, the module mapping: all in the ADR (step 1). The executor copies it verbatim.
- drizzle-kit emits composite FKs before the unique indexes they need when every table is new. The helper script in step 4 reorders (CREATE TABLE, indexes, FKs) and appends the RLS block; it is a throwaway file outside the repo.
- Migration 0029 has NO seed rows. The seeds are 0030 (slice 06) and `ensureDefaultPipeline` (slice 05b). The `SLICE-05-HOOK` in `default-pipeline-parity.test.ts` is therefore closed by slice 06, which compares the 0030 seed.
- FK delete rules: restrict everywhere except `sales_ops_crm_lead_field_values.lead_id` (cascade, the `sales_ops_lead_products` precedent). History tables (events, notes, follow-ups) restrict.

## Steps

1. Create `nexo/knowledge/decisions/2026-10-21-crm-unificado-modelo.md` with exactly the text below (one sentence per line, no em dash).

```markdown
# Unified CRM model: new tables, copy-with-same-uuid, default pipeline, typed dynamic values

**Date:** 2026-10-21
**Surfaced by:** run `20261021T011348Z-vendas-crm-unificado` (milestone v4.8.0), phases 1b and 1c
**Survey:** `nexo/runs/20261021T011348Z-vendas-crm-unificado/levantamento-entidades.md` (passed its separate Verify), sections 1, 3.1, 3.3 to 3.6, 3.12, 3.13, 4 and 5.

## Context

Today a lead lives in `sales_ops_leads` (survey 3.1), its columns are the stage of one fixed four-stage list per org in `sales_ops_lead_stages` (survey 3.3), and the "funnel" is only that list (survey 3.4).
Migration 0022 blocks the product the owner asked for: `sales_ops_lead_stages_org_kind_idx` allows one conversion and one lost stage per org, `sales_ops_lead_stages_kind_check` only knows `normal|conversion|lost`, `sales_ops_lead_stages_system_kind_check` ties `is_system` to `kind`, `sales_ops_lead_stages_org_name_idx` forbids the same stage name in two funnels (survey 5.1).
Widening any of them needs DROP CONSTRAINT or DROP INDEX, and every migration after 0028 is 100% additive (guard `apps/api/src/db/__tests__/additive-migrations-guard.test.ts`).
Eleven files read `sales_ops_lead_stages.kind` and eighteen read `stage_id` (survey 5.2 and 5.3), so the old API must keep working until phase 2.

## Decision

D1 - Lead identity.
The unified lead lives in NEW tables.
`sales_ops_leads`, `sales_ops_lead_products` and `sales_ops_lead_stages` stay byte-intact: no new column, index, policy or trigger.
Migration 0030 COPIES with the SAME uuid (new lead id = old lead id; a migrated stage id = the old stage id), so URLs, `sale_id` links and the copy idempotency (`INSERT ... SELECT ... ON CONFLICT (id) DO NOTHING`) are stable.
Phase 2 cuts the API over to the new tables; until then the old reads keep working.
Alternatives rejected: (a) evolve `sales_ops_leads` in place - needs DROP/ALTER CHECK and index changes, forbidden, and puts 18 readers at risk at once; (b) a view over both tables - no writes, no FK targets; (c) copy with NEW uuids and a mapping table - breaks stable URLs and makes the copy non-idempotent without extra state.

D2 - Never touched.
Legacy `leads` (P1), `fxl-sales.*` events (P2), payables, receivables and settlements (P3), `sales_ops_sales`, items and professionals (P4), the affiliate module (P5).
The new lead references a proposta only by `sale_id`, a composite FK to `sales_ops_sales (org_id, id)` like today, with the same partial unique index `(org_id, sale_id) WHERE sale_id IS NOT NULL`: at most ONE lead per proposta in the org, deleted leads included.

D3 - Tables (all org-scoped, FORCE RLS with `tenant_isolation` and `admin_context` exactly as 0022, composite FKs with `org_id` first onto a `UNIQUE (org_id, id)`, no GRANT or ROLE):
`sales_ops_pipelines`, `sales_ops_pipeline_stages`, `sales_ops_pipeline_transitions`, `sales_ops_field_definitions`, `sales_ops_crm_leads`, `sales_ops_crm_lead_field_values`, `sales_ops_crm_lead_events`, `sales_ops_crm_lead_notes`, `sales_ops_crm_lead_followups`, `sales_ops_org_modules`.
The exact columns are in `nexo/plans/vendas-crm-unificado/contracts/SEAM-CONTRACT.md`.

The lead keeps a FIXED core of real columns: name, contact phone and e-mail, pipeline, stage, position, `stage_changed_at`, seller, `client_id` plus `client_name_snapshot`, `sale_id`, `lost_reason`, soft delete, timestamps, and `estimated_value_brl integer NOT NULL DEFAULT 0 CHECK (>= 0)`.
`estimated_value_brl` stays a real column although the survey lists it as configurable: the board sums it in SQL (`summarizeLeadStages` groups by stage, survey 3.1) and the `>= 0` floor and the default must survive (Verify note 1).
`estimated_value_brl` is the only money field; it is NOT a dynamic field.

Dynamic-value storage: EAV with typed columns, NOT a JSONB column with a GIN index.
Why: (1) reference values (Cliente, Produto, Serviço, Venda) need real composite FKs, otherwise a deleted produto or a foreign-org id leaves a dangling reference no constraint sees, and the survey shows how much of this product depends on those FKs (3.5, 3.8); JSONB cannot carry a FK; (2) "typed and filterable": a number, money or date range filter, an `ORDER BY` and a `SUM` need native types and btree indexes, while GIN serves containment only and every range or sort over JSONB needs casts the planner cannot estimate; (3) a multi-valued field (Produto, Serviço) is natural rows, and it follows the `sales_ops_lead_products` precedent (child rows, name snapshot, nullable product id); (4) RLS and the composite `org_id` FKs apply per row.
Cost accepted: one join (or `EXISTS`) per filtered field and one row per value; mitigated by one partial btree per value slot.
The value table has one slot per type (`value_text`, `value_number numeric(20,6)`, `value_cents bigint`, `value_date`, `value_option`, `value_client_id`, `value_product_id`, `value_sale_id`) and a CHECK that exactly ONE slot is set.
A FREE produto (no catalog row, survey-confirmed in `lead-schemas.ts` and `lead-service.ts`) is stored as `value_text` plus `ref_name_snapshot` with `value_product_id` NULL; a catalog produto sets `value_product_id` plus the snapshot.
A Contato reference has no Contato entity yet (survey 3.6, open question), so it is `value_text` plus snapshot with no FK.
That the slot matches the field definition's kind is a zod rule in the service layer, the same way "Perdido requires a reason" is (0022 header): a CHECK cannot join another table.

Cliente: the Cliente system field is ONE definition row (`key 'cliente'`, `is_system true`, `removable false`, `backing_column 'client_id'`) whose value lives in the lead's `client_id` and `client_name_snapshot` columns, never in value rows.
The columns keep the composite FK to `sales_ops_clients` and the snapshot every reader needs (survey 3.5), and the definition row is what makes it a non-removable field in the UI.
CHECK `removable OR is_system` makes a removable system field unrepresentable.

Stages: `type` is `normal | orcamento | saida`, `behavior` is open-ended text (`none | opens_orcamentos`), `exit_kind` is `ganho | perdido | pausado` and set exactly when `type = 'saida'` (CHECK), `requires_reason` may be true only for `perdido`.
A name is unique per pipeline, not per org.
No unique index limits the number of exits: several exits per pipeline are the point.
A lead's stage must belong to the lead's own pipeline: the FK `(org_id, pipeline_id, stage_id)` targets `UNIQUE (org_id, pipeline_id, id)` on the stages; a transition has the same two-ended composite FK, so it can never cross pipelines.

Enumerations that may grow carry NO CHECK: stage `behavior`, field `kind`, `reference_target`, module `key`, module `source`, event `kind`.
The additive guard forbids DROP CONSTRAINT, so a CHECK could never be widened.
They are validated by zod and by `packages/shared-utils/src/crm-model.ts`.
Closed sets keep their CHECK: stage `type`, `exit_kind`, `status`.

History: `sales_ops_crm_lead_events` is the server-written stage history, in its own table, never in `audit_log` (survey 3.13: the hash chain serializes every writer on one row lock).
A `NULL` `from_stage_id` is the lead's initial entry; a partial unique index allows at most one initial entry per lead.
Notes (`sales_ops_crm_lead_notes`) and follow-ups (`sales_ops_crm_lead_followups`, `due_on` civil day NOT NULL, owner pessoa, `done_at`) are separate tables.
Events, notes and follow-ups reference their lead with `ON DELETE restrict` (history is never cascaded); only value rows cascade from the lead (the `sales_ops_lead_products` precedent: no independent identity, nothing references them).

D4 - Default pipeline.
`ensureDefaultPipeline(tx, orgId)` seeds `DEFAULT_PIPELINE_NAME` ('Funil CRM padrão', system key `crm-padrao`, `is_default true`) from `DEFAULT_PIPELINE_STAGES` and `DEFAULT_PIPELINE_TRANSITIONS` only when the org has NO pipeline row at all (a renamed or archived pipeline is never reinserted), with the same concurrency safety as `ensureLeadStages`: a bare `ON CONFLICT DO NOTHING` insert of the pipeline row that a concurrent first caller blocks on until the winner commits, children written only by the caller whose insert returned a row, a re-read at the end.
Migration 0030 builds the pipeline of an org that HAS old stages from its OWN stages: same ids, names, positions, `conversion` -> `orcamento` with behavior `opens_orcamentos`, `lost` -> `saida` `perdido` requiring a reason, `normal` -> `normal`, archived stays archived.
It ADDS the missing exits `Ganho` and `Pausado` with new ids at `max(position) + 1` and `+ 2` (`Ganho (saída)` if the org already named a normal etapa `Ganho`), only when the pipeline has no stage with that `exit_kind`.
It does NOT add `Qualificação`: that is an open stage the org names itself.
The transition graph is generated by one rule over the ACTIVE stages of a pipeline that has no transition yet: open = `normal|orcamento` ordered by `(position, name)`, exits = `saida`; `open[i] -> open[i+1]`, `open[i+1] -> open[i]`, every open -> every exit, every `pausado` exit -> every open.
For the pure default pipeline this equals `DEFAULT_PIPELINE_TRANSITIONS` (22 pairs); `planPipelineTransitions` in `crm-model.ts` is the same rule in TypeScript and a test compares both.
An org with no old stages gets the pure default pipeline.
The org universe is the orgs 0022 seeded (people, settings, sales) plus every org with an etapa, a lead or a cliente.

D5 - Modules.
`sales_ops_org_modules (org_id, module_key, enabled, source default|token_backfill|admin, updated_at)` is created in 1b and written by nobody until phase 3.
No row is backfilled from the token in a migration (the token is not in the database); phase 3 does the one-time token backfill at request time.
Keys: `orcamentos`, `comissoes`, `financeiro`, `finders`, `catalogo`, `importacao`, `clientes` (the current `clients` capability needs its own key, because the leads edition grants it alone).
Mapping from `packages/shared-utils/src/sales-edition.ts` (`CAPABILITY_MODULES`; a capability is granted when ALL its modules are on): `proposals -> orcamentos`, `commissions -> comissoes`, `catalog -> catalogo`, `clients -> clientes`, `import -> importacao`, `finders -> finders`, `history -> financeiro`, `leadFullFields -> catalogo`.
`modulesForEdition('full')` is all seven on; `modulesForEdition('leads')` is exactly `clientes` and `importacao`, which is today's Construbom.
No org plan table is created: no plan semantics exist yet and the modules cover the need.

## Consequences

- Between 0030 and the phase 2 cutover the old tables stay the write path, so rows written in that window are not copied.
  The phase 2 cutover slice MUST repeat the 0030 statements verbatim in its own migration (idempotent) before it switches reads; `crm-legacy-copy-migration.test.ts` proves a second run is a no-op.
- The dev seed deletes the new tables first (`SEED_DELETE_ORDER`), because `sales_ops_crm_leads` restrict-references clientes, pessoas, propostas and produtos.
- No existing API route, schema or web file changes in 1b and 1c.
- Open questions stay with the owner (survey section 6): whether contact requires phone or e-mail, whether Contato becomes an entity, whether finder referrals appear in the CRM, whether Orçamento creates a proposta.

## Verify notes applied

1. `estimated_value_brl` keeps NOT NULL DEFAULT 0 and the `>= 0` CHECK.
2. Only row `amountCents`, `saleId`, `saleCode`, the client name snapshot and `deepLinkPath` reach the Finance event, so nothing here changes it.
3. `restoreLead` depends on `kind` transitively through `firstOpenLeadStage`; the old API is untouched until phase 2.
4. "Excluded from the synced set on the producer" is the producer side, unchanged.
5. `sales_ops_leads_org_seller_idx` is mirrored as `sales_ops_crm_leads_org_seller_idx`.
```

2. TDD: create `apps/api/src/db/__tests__/crm-schema.test.ts` and `apps/api/test/rls/crm-schema-rls.test.ts` (texts in "Tests"). Run them; both must FAIL (no 0029 file, no exports).
3. Append the Drizzle block below to the END of `apps/api/src/db/schema.ts` (after `integrationCursor`). Do not touch any existing table.

```ts
// ─────────────────────────────────────────────────────────────────────────────
// CRM unificado (migration 0029). New tables only: sales_ops_leads,
// sales_ops_lead_products and sales_ops_lead_stages above stay byte-intact until
// the phase 2 cutover. Every FK that crosses a tenant boundary is COMPOSITE on
// (org_id, <fk>) and restrict, except the child rows noted below.
// Closed sets (type, exit_kind, status) carry a CHECK. Open-ended sets (behavior,
// field kind, reference target, module key, event kind, source) are plain text
// validated by zod, because the additive migration guard forbids DROP CONSTRAINT.
// ─────────────────────────────────────────────────────────────────────────────
export const salesOpsPipelines = pgTable(
  'sales_ops_pipelines',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: text('org_id').notNull(),
    name: text('name').notNull(),
    /** Stable machine key of a seeded pipeline ('crm-padrao'); NULL for org-created ones. */
    systemKey: text('system_key'),
    position: integer('position').notNull().default(0),
    isDefault: boolean('is_default').notNull().default(false),
    status: text('status').notNull().default('active'), // 'active' | 'archived'
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }),
  },
  (t) => [
    uniqueIndex('sales_ops_pipelines_org_id_id_idx').on(t.orgId, t.id),
    uniqueIndex('sales_ops_pipelines_org_name_idx').on(t.orgId, t.name),
    uniqueIndex('sales_ops_pipelines_org_system_key_idx')
      .on(t.orgId, t.systemKey)
      .where(sql`${t.systemKey} is not null`),
    uniqueIndex('sales_ops_pipelines_org_default_idx')
      .on(t.orgId)
      .where(sql`${t.isDefault}`),
    check('sales_ops_pipelines_status_check', sql`${t.status} in ('active', 'archived')`),
  ],
);

export const salesOpsPipelineStages = pgTable(
  'sales_ops_pipeline_stages',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: text('org_id').notNull(),
    pipelineId: uuid('pipeline_id').notNull(),
    name: text('name').notNull(),
    position: integer('position').notNull().default(0),
    type: text('type').notNull().default('normal'), // 'normal' | 'orcamento' | 'saida'
    /** Open-ended: 'none' | 'opens_orcamentos' today. Validated by zod, no CHECK. */
    behavior: text('behavior').notNull().default('none'),
    exitKind: text('exit_kind'), // 'ganho' | 'perdido' | 'pausado'; only when type = 'saida'
    requiresReason: boolean('requires_reason').notNull().default(false),
    status: text('status').notNull().default('active'),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }),
  },
  (t) => [
    uniqueIndex('sales_ops_pipeline_stages_org_id_id_idx').on(t.orgId, t.id),
    uniqueIndex('sales_ops_pipeline_stages_org_pipeline_id_idx').on(t.orgId, t.pipelineId, t.id),
    uniqueIndex('sales_ops_pipeline_stages_org_pipeline_name_idx').on(t.orgId, t.pipelineId, t.name),
    index('sales_ops_pipeline_stages_org_pipeline_position_idx').on(t.orgId, t.pipelineId, t.position),
    foreignKey({
      columns: [t.orgId, t.pipelineId],
      foreignColumns: [salesOpsPipelines.orgId, salesOpsPipelines.id],
      name: 'sales_ops_pipeline_stages_org_pipeline_fk',
    }).onDelete('restrict'),
    check('sales_ops_pipeline_stages_type_check', sql`${t.type} in ('normal', 'orcamento', 'saida')`),
    check('sales_ops_pipeline_stages_exit_kind_check', sql`${t.exitKind} in ('ganho', 'perdido', 'pausado')`),
    check('sales_ops_pipeline_stages_exit_pair_check', sql`(${t.type} = 'saida') = (${t.exitKind} is not null)`),
    check('sales_ops_pipeline_stages_reason_check', sql`not ${t.requiresReason} or ${t.exitKind} = 'perdido'`),
    check('sales_ops_pipeline_stages_status_check', sql`${t.status} in ('active', 'archived')`),
  ],
);

export const salesOpsPipelineTransitions = pgTable(
  'sales_ops_pipeline_transitions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: text('org_id').notNull(),
    pipelineId: uuid('pipeline_id').notNull(),
    fromStageId: uuid('from_stage_id').notNull(),
    toStageId: uuid('to_stage_id').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex('sales_ops_pipeline_transitions_org_from_to_idx').on(t.orgId, t.fromStageId, t.toStageId),
    index('sales_ops_pipeline_transitions_org_pipeline_idx').on(t.orgId, t.pipelineId),
    // Both ends carry pipeline_id in the composite key: a transition can never cross pipelines.
    foreignKey({
      columns: [t.orgId, t.pipelineId, t.fromStageId],
      foreignColumns: [salesOpsPipelineStages.orgId, salesOpsPipelineStages.pipelineId, salesOpsPipelineStages.id],
      name: 'sales_ops_pipeline_transitions_org_from_fk',
    }).onDelete('restrict'),
    foreignKey({
      columns: [t.orgId, t.pipelineId, t.toStageId],
      foreignColumns: [salesOpsPipelineStages.orgId, salesOpsPipelineStages.pipelineId, salesOpsPipelineStages.id],
      name: 'sales_ops_pipeline_transitions_org_to_fk',
    }).onDelete('restrict'),
    check('sales_ops_pipeline_transitions_distinct_check', sql`${t.fromStageId} <> ${t.toStageId}`),
  ],
);

export const salesOpsFieldDefinitions = pgTable(
  'sales_ops_field_definitions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: text('org_id').notNull(),
    key: text('key').notNull(),
    label: text('label').notNull(),
    /** Open-ended: 'text' | 'number' | 'money' | 'date' | 'options' | 'reference'. */
    kind: text('kind').notNull().default('text'),
    /** Open-ended: 'cliente' | 'contato' | 'produto' | 'servico' | 'venda'; only when kind = 'reference'. */
    referenceTarget: text('reference_target'),
    /** More than one value per lead (Produto, Serviço). */
    multiple: boolean('multiple').notNull().default(false),
    /** [{ key, label }] for kind = 'options'; NULL otherwise. */
    options: jsonb('options'),
    filterable: boolean('filterable').notNull().default(false),
    isSystem: boolean('is_system').notNull().default(false),
    removable: boolean('removable').notNull().default(true),
    /** Lead column that stores the value of a system field ('client_id' for Cliente); NULL = value rows. */
    backingColumn: text('backing_column'),
    position: integer('position').notNull().default(0),
    status: text('status').notNull().default('active'),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }),
  },
  (t) => [
    uniqueIndex('sales_ops_field_definitions_org_id_id_idx').on(t.orgId, t.id),
    uniqueIndex('sales_ops_field_definitions_org_key_idx').on(t.orgId, t.key),
    index('sales_ops_field_definitions_org_position_idx').on(t.orgId, t.position),
    check('sales_ops_field_definitions_status_check', sql`${t.status} in ('active', 'archived')`),
    check('sales_ops_field_definitions_removable_check', sql`${t.removable} or ${t.isSystem}`),
    check(
      'sales_ops_field_definitions_reference_check',
      sql`(${t.kind} = 'reference') = (${t.referenceTarget} is not null)`,
    ),
  ],
);

export const salesOpsCrmLeads = pgTable(
  'sales_ops_crm_leads',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: text('org_id').notNull(),
    contactName: text('contact_name').notNull(),
    contactPhone: text('contact_phone'),
    contactEmail: text('contact_email'),
    pipelineId: uuid('pipeline_id').notNull(),
    stageId: uuid('stage_id').notNull(),
    position: integer('position').notNull().default(0),
    stageChangedAt: timestamp('stage_changed_at', { withTimezone: true }).defaultNow().notNull(),
    sellerPersonId: uuid('seller_person_id'),
    sellerNameSnapshot: text('seller_name_snapshot').notNull().default(''),
    /** Backs the Cliente system field (field_definitions.backing_column = 'client_id'). */
    clientId: uuid('client_id'),
    clientNameSnapshot: text('client_name_snapshot').notNull().default(''),
    /** Integer cents. A real column because the board sums it in SQL. */
    estimatedValueBrl: integer('estimated_value_brl').notNull().default(0),
    lostReason: text('lost_reason'),
    saleId: uuid('sale_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    deletedByUserId: text('deleted_by_user_id'),
    deletedByName: text('deleted_by_name'),
  },
  (t) => [
    uniqueIndex('sales_ops_crm_leads_org_id_id_idx').on(t.orgId, t.id),
    index('sales_ops_crm_leads_org_stage_position_idx').on(t.orgId, t.stageId, t.position),
    index('sales_ops_crm_leads_org_pipeline_idx').on(t.orgId, t.pipelineId),
    index('sales_ops_crm_leads_org_seller_idx').on(t.orgId, t.sellerPersonId),
    index('sales_ops_crm_leads_org_created_idx').on(t.orgId, t.createdAt),
    // At most ONE lead per proposta in the org, deleted leads included (same rule as sales_ops_leads_org_sale_idx).
    uniqueIndex('sales_ops_crm_leads_org_sale_idx')
      .on(t.orgId, t.saleId)
      .where(sql`${t.saleId} is not null`),
    index('sales_ops_crm_leads_org_deleted_idx')
      .on(t.orgId, t.deletedAt, t.id)
      .where(sql`${t.deletedAt} is not null`),
    foreignKey({
      columns: [t.orgId, t.pipelineId],
      foreignColumns: [salesOpsPipelines.orgId, salesOpsPipelines.id],
      name: 'sales_ops_crm_leads_org_pipeline_fk',
    }).onDelete('restrict'),
    // The stage must belong to the lead's own pipeline.
    foreignKey({
      columns: [t.orgId, t.pipelineId, t.stageId],
      foreignColumns: [salesOpsPipelineStages.orgId, salesOpsPipelineStages.pipelineId, salesOpsPipelineStages.id],
      name: 'sales_ops_crm_leads_org_stage_fk',
    }).onDelete('restrict'),
    foreignKey({
      columns: [t.orgId, t.clientId],
      foreignColumns: [salesOpsClients.orgId, salesOpsClients.id],
      name: 'sales_ops_crm_leads_org_client_fk',
    }).onDelete('restrict'),
    foreignKey({
      columns: [t.orgId, t.sellerPersonId],
      foreignColumns: [salesOpsPeople.orgId, salesOpsPeople.id],
      name: 'sales_ops_crm_leads_org_seller_fk',
    }).onDelete('restrict'),
    foreignKey({
      columns: [t.orgId, t.saleId],
      foreignColumns: [salesOpsSales.orgId, salesOpsSales.id],
      name: 'sales_ops_crm_leads_org_sale_fk',
    }).onDelete('restrict'),
    check('sales_ops_crm_leads_estimated_value_check', sql`${t.estimatedValueBrl} >= 0`),
    check(
      'sales_ops_crm_leads_deleted_pair_check',
      sql`(${t.deletedAt} is null) = (${t.deletedByUserId} is null)`,
    ),
  ],
);

/**
 * Typed dynamic values, one row per value (EAV with typed columns). Exactly one
 * value slot is set. A free Produto (no catalog row) uses value_text plus
 * ref_name_snapshot; a catalog Produto/Serviço uses value_product_id plus the
 * snapshot; a Contato reference is value_text (no Contato entity yet).
 * Cascade from the lead is the sales_ops_lead_products precedent: a value row
 * has no independent identity and nothing references it.
 */
export const salesOpsCrmLeadFieldValues = pgTable(
  'sales_ops_crm_lead_field_values',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: text('org_id').notNull(),
    leadId: uuid('lead_id').notNull(),
    fieldId: uuid('field_id').notNull(),
    /** 0 for a single-valued field; 0..n for a multiple one. */
    position: integer('position').notNull().default(0),
    valueText: text('value_text'),
    valueNumber: numeric('value_number', { precision: 20, scale: 6 }),
    valueCents: bigint('value_cents', { mode: 'number' }),
    valueDate: date('value_date', { mode: 'string' }),
    valueOption: text('value_option'),
    valueClientId: uuid('value_client_id'),
    valueProductId: uuid('value_product_id'),
    valueSaleId: uuid('value_sale_id'),
    refNameSnapshot: text('ref_name_snapshot'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }),
  },
  (t) => [
    uniqueIndex('sales_ops_crm_lead_field_values_slot_idx').on(t.orgId, t.leadId, t.fieldId, t.position),
    index('sales_ops_crm_lead_field_values_org_lead_idx').on(t.orgId, t.leadId),
    index('sales_ops_crm_lead_field_values_text_idx').on(t.orgId, t.fieldId, t.valueText).where(sql`${t.valueText} is not null`),
    index('sales_ops_crm_lead_field_values_number_idx').on(t.orgId, t.fieldId, t.valueNumber).where(sql`${t.valueNumber} is not null`),
    index('sales_ops_crm_lead_field_values_cents_idx').on(t.orgId, t.fieldId, t.valueCents).where(sql`${t.valueCents} is not null`),
    index('sales_ops_crm_lead_field_values_date_idx').on(t.orgId, t.fieldId, t.valueDate).where(sql`${t.valueDate} is not null`),
    index('sales_ops_crm_lead_field_values_option_idx').on(t.orgId, t.fieldId, t.valueOption).where(sql`${t.valueOption} is not null`),
    index('sales_ops_crm_lead_field_values_client_idx').on(t.orgId, t.valueClientId).where(sql`${t.valueClientId} is not null`),
    index('sales_ops_crm_lead_field_values_product_idx').on(t.orgId, t.valueProductId).where(sql`${t.valueProductId} is not null`),
    index('sales_ops_crm_lead_field_values_sale_idx').on(t.orgId, t.valueSaleId).where(sql`${t.valueSaleId} is not null`),
    foreignKey({
      columns: [t.orgId, t.leadId],
      foreignColumns: [salesOpsCrmLeads.orgId, salesOpsCrmLeads.id],
      name: 'sales_ops_crm_lead_field_values_org_lead_fk',
    }).onDelete('cascade'),
    foreignKey({
      columns: [t.orgId, t.fieldId],
      foreignColumns: [salesOpsFieldDefinitions.orgId, salesOpsFieldDefinitions.id],
      name: 'sales_ops_crm_lead_field_values_org_field_fk',
    }).onDelete('restrict'),
    foreignKey({
      columns: [t.orgId, t.valueClientId],
      foreignColumns: [salesOpsClients.orgId, salesOpsClients.id],
      name: 'sales_ops_crm_lead_field_values_org_client_fk',
    }).onDelete('restrict'),
    foreignKey({
      columns: [t.orgId, t.valueProductId],
      foreignColumns: [salesOpsProducts.orgId, salesOpsProducts.id],
      name: 'sales_ops_crm_lead_field_values_org_product_fk',
    }).onDelete('restrict'),
    foreignKey({
      columns: [t.orgId, t.valueSaleId],
      foreignColumns: [salesOpsSales.orgId, salesOpsSales.id],
      name: 'sales_ops_crm_lead_field_values_org_sale_fk',
    }).onDelete('restrict'),
    check(
      'sales_ops_crm_lead_field_values_one_slot_check',
      sql`num_nonnulls(${t.valueText}, ${t.valueNumber}, ${t.valueCents}, ${t.valueDate}, ${t.valueOption}, ${t.valueClientId}, ${t.valueProductId}, ${t.valueSaleId}) = 1`,
    ),
    check('sales_ops_crm_lead_field_values_position_check', sql`${t.position} >= 0`),
  ],
);

/** Server-written stage history. from_stage_id NULL is the lead's initial entry (at most one per lead). */
export const salesOpsCrmLeadEvents = pgTable(
  'sales_ops_crm_lead_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: text('org_id').notNull(),
    leadId: uuid('lead_id').notNull(),
    /** Open-ended; 'stage_changed' today. */
    kind: text('kind').notNull().default('stage_changed'),
    fromStageId: uuid('from_stage_id'),
    toStageId: uuid('to_stage_id'),
    reason: text('reason'),
    actorUserId: text('actor_user_id'),
    actorNameSnapshot: text('actor_name_snapshot'),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex('sales_ops_crm_lead_events_org_id_id_idx').on(t.orgId, t.id),
    index('sales_ops_crm_lead_events_org_lead_idx').on(t.orgId, t.leadId, t.occurredAt, t.id),
    uniqueIndex('sales_ops_crm_lead_events_first_entry_idx')
      .on(t.orgId, t.leadId)
      .where(sql`${t.fromStageId} is null and ${t.kind} = 'stage_changed'`),
    foreignKey({
      columns: [t.orgId, t.leadId],
      foreignColumns: [salesOpsCrmLeads.orgId, salesOpsCrmLeads.id],
      name: 'sales_ops_crm_lead_events_org_lead_fk',
    }).onDelete('restrict'),
    foreignKey({
      columns: [t.orgId, t.fromStageId],
      foreignColumns: [salesOpsPipelineStages.orgId, salesOpsPipelineStages.id],
      name: 'sales_ops_crm_lead_events_org_from_fk',
    }).onDelete('restrict'),
    foreignKey({
      columns: [t.orgId, t.toStageId],
      foreignColumns: [salesOpsPipelineStages.orgId, salesOpsPipelineStages.id],
      name: 'sales_ops_crm_lead_events_org_to_fk',
    }).onDelete('restrict'),
  ],
);

export const salesOpsCrmLeadNotes = pgTable(
  'sales_ops_crm_lead_notes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: text('org_id').notNull(),
    leadId: uuid('lead_id').notNull(),
    /** Optional link to the stage event the note was written with. */
    eventId: uuid('event_id'),
    body: text('body').notNull(),
    authorUserId: text('author_user_id'),
    authorNameSnapshot: text('author_name_snapshot'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index('sales_ops_crm_lead_notes_org_lead_idx').on(t.orgId, t.leadId, t.createdAt),
    foreignKey({
      columns: [t.orgId, t.leadId],
      foreignColumns: [salesOpsCrmLeads.orgId, salesOpsCrmLeads.id],
      name: 'sales_ops_crm_lead_notes_org_lead_fk',
    }).onDelete('restrict'),
    foreignKey({
      columns: [t.orgId, t.eventId],
      foreignColumns: [salesOpsCrmLeadEvents.orgId, salesOpsCrmLeadEvents.id],
      name: 'sales_ops_crm_lead_notes_org_event_fk',
    }).onDelete('restrict'),
    check('sales_ops_crm_lead_notes_body_check', sql`length(btrim(${t.body})) > 0`),
  ],
);

export const salesOpsCrmLeadFollowups = pgTable(
  'sales_ops_crm_lead_followups',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: text('org_id').notNull(),
    leadId: uuid('lead_id').notNull(),
    nextStep: text('next_step').notNull(),
    /** Civil day (string mode), never a JS Date. A follow-up always has a date. */
    dueOn: date('due_on', { mode: 'string' }).notNull(),
    ownerPersonId: uuid('owner_person_id'),
    ownerNameSnapshot: text('owner_name_snapshot'),
    doneAt: timestamp('done_at', { withTimezone: true }),
    createdByUserId: text('created_by_user_id'),
    createdByName: text('created_by_name'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }),
  },
  (t) => [
    index('sales_ops_crm_lead_followups_org_lead_idx').on(t.orgId, t.leadId),
    index('sales_ops_crm_lead_followups_org_open_due_idx')
      .on(t.orgId, t.dueOn)
      .where(sql`${t.doneAt} is null`),
    foreignKey({
      columns: [t.orgId, t.leadId],
      foreignColumns: [salesOpsCrmLeads.orgId, salesOpsCrmLeads.id],
      name: 'sales_ops_crm_lead_followups_org_lead_fk',
    }).onDelete('restrict'),
    foreignKey({
      columns: [t.orgId, t.ownerPersonId],
      foreignColumns: [salesOpsPeople.orgId, salesOpsPeople.id],
      name: 'sales_ops_crm_lead_followups_org_owner_fk',
    }).onDelete('restrict'),
    check('sales_ops_crm_lead_followups_step_check', sql`length(btrim(${t.nextStep})) > 0`),
  ],
);

/** Per-org module flags. Phase 3 reads them; 1b only creates the table. */
export const salesOpsOrgModules = pgTable(
  'sales_ops_org_modules',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: text('org_id').notNull(),
    /** Open-ended: orcamentos, comissoes, financeiro, finders, catalogo, importacao, clientes. */
    moduleKey: text('module_key').notNull(),
    enabled: boolean('enabled').notNull().default(false),
    /** Open-ended: 'default' | 'token_backfill' | 'admin'. */
    source: text('source').notNull().default('default'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }),
  },
  (t) => [uniqueIndex('sales_ops_org_modules_org_key_idx').on(t.orgId, t.moduleKey)],
);
```

4. Generate and finalize the migration (from the repo root `run/`):
   - `pnpm --filter @fxl-sales/api exec drizzle-kit generate --name crm_unificado_modelo` (creates `apps/api/drizzle/0029_crm_unificado_modelo.sql`, `apps/api/drizzle/meta/0029_snapshot.json` and one journal entry; if drizzle-kit asks anything interactive, STOP and report).
   - Write the helper below to `$TMPDIR/finalize-0029.mjs` (NOT inside the repo), then run `cd apps/api && node $TMPDIR/finalize-0029.mjs drizzle/0029_crm_unificado_modelo.sql`.
   - Check: `grep -c "CREATE TABLE" apps/api/drizzle/0029_crm_unificado_modelo.sql` prints 10; `grep -c "FORCE ROW LEVEL SECURITY"` prints 10; `grep -c "CREATE POLICY"` prints 20; `git diff apps/api/drizzle/meta/_journal.json` shows exactly one new entry `idx 29`, `tag 0029_crm_unificado_modelo`, `breakpoints true`.
   - Do NOT edit the generated snapshot.

```js
// One-off helper, NOT committed. Usage (from apps/api): node finalize-0029.mjs drizzle/0029_crm_unificado_modelo.sql
// 1) reorders drizzle-kit output: CREATE TABLE, then CREATE [UNIQUE] INDEX, then FKs (the FK targets need their unique indexes first)
// 2) prepends the header comment, 3) appends FORCE RLS + the two org policies for every new table (spelled exactly like 0022).
import fs from 'node:fs';
const file = process.argv[2];
const TABLES = [
  'sales_ops_pipelines',
  'sales_ops_pipeline_stages',
  'sales_ops_pipeline_transitions',
  'sales_ops_field_definitions',
  'sales_ops_crm_leads',
  'sales_ops_crm_lead_field_values',
  'sales_ops_crm_lead_events',
  'sales_ops_crm_lead_notes',
  'sales_ops_crm_lead_followups',
  'sales_ops_org_modules',
];
const HEADER = `-- 0029_crm_unificado_modelo - the unified CRM model (vendas-crm-unificado phase 1b).
--
-- 100% additive: ten NEW tables, no column, index, policy or trigger on any existing table.
-- sales_ops_leads, sales_ops_lead_products and sales_ops_lead_stages stay byte-intact until the
-- phase 2 cutover; migration 0030 COPIES their rows (same uuids) into these tables.
-- See nexo/knowledge/decisions/2026-10-21-crm-unificado-modelo.md for every decision below.
--
-- Hand-edited after drizzle-kit generate, in two ways only:
--   1. statements are ordered CREATE TABLE, then indexes, then FKs, because drizzle-kit emits the
--      composite FKs first and their target UNIQUE (org_id, id) indexes would not exist yet;
--   2. the FORCE ROW LEVEL SECURITY block with the tenant_isolation and admin_context policies
--      (drizzle-kit does not emit RLS) is appended, spelled exactly like 0022.
--
-- Enumerations that may grow (stage behavior, field kind, reference target, module key, event
-- kind, module source) carry NO CHECK: the additive guard forbids DROP CONSTRAINT, so a CHECK
-- could never be widened. They are validated by zod and packages/shared-utils/src/crm-model.ts.
-- Closed sets (stage type, exit_kind, status) keep their CHECK.
--
-- No privilege statement appears here (single-role database contract). Ordinary non-phased migration.
`;
const parts = fs.readFileSync(file, 'utf8').split('--> statement-breakpoint').map((s) => s.trim()).filter(Boolean);
const rank = (s) => (/^CREATE TABLE/.test(s) ? 0 : /^CREATE (UNIQUE )?INDEX/.test(s) ? 1 : 2);
const sorted = parts.map((s, i) => ({ s, i, r: rank(s) })).sort((a, b) => a.r - b.r || a.i - b.i).map((x) => x.s);
const rls = TABLES.flatMap((t) => [
  `ALTER TABLE ${t} ENABLE ROW LEVEL SECURITY;`,
  `ALTER TABLE ${t} FORCE ROW LEVEL SECURITY;`,
  `CREATE POLICY ${t}_tenant_isolation ON ${t}\n  AS PERMISSIVE FOR ALL\n  USING (org_id = current_setting('app.current_org_id', true))\n  WITH CHECK (org_id = current_setting('app.current_org_id', true));`,
  `CREATE POLICY ${t}_admin_context ON ${t}\n  AS PERMISSIVE FOR ALL\n  USING (current_setting('app.fxl_admin', true) = 'true')\n  WITH CHECK (current_setting('app.fxl_admin', true) = 'true');`,
]);
fs.writeFileSync(file, HEADER + [...sorted, ...rls].join('\n--> statement-breakpoint\n') + '\n');
```

5. Run the tests of this slice until green (commands below). Run the additive guard and the single-role contract.
6. `pnpm --filter @fxl-sales/api lint` and `type-check` (all three tsconfigs run inside `type-check`).
7. Report. Do not commit anything outside `files_modified`.

## Tests

`apps/api/src/db/__tests__/crm-schema.test.ts` (pure, no DB) - cases and assertions:
- `journals 0029... immediately after 0028...`: entry `idx 29` after `idx 28`, `when` greater.
- `is additive`: `scanSql(sql)` is `[]`, no `fxl-migration-mode`, no statement starts with INSERT, UPDATE or SELECT.
- `creates exactly the ten CRM tables and orders ...`: the CREATE TABLE names equal the ten, and statement ranks are non-decreasing (tables, indexes, FKs, RLS).
- per table: ENABLE + FORCE RLS and both policies spelled exactly like 0022 (string equality).
- per table: `org_id` NOT NULL and every FK is composite with `org_id` first on both sides.
- snapshot chain `prevId` and presence of every table in 0029 and absence in 0028.
- no statement touches a legacy table (old lead tables, `leads`, sale ledger).
- Drizzle mirror: the Cliente removable CHECK, the partial unique `sales_ops_crm_leads_org_sale_idx`, `estimatedValueBrl` NOT NULL default 0.

```ts
/**
 * Pure oracle for migration 0029 (vendas-crm-unificado slice 05a): no database connection, just
 * the journal, the shipped SQL bytes, the snapshot chain and the Drizzle mirror. Applying the
 * migration and its RLS is proven by test/rls/crm-schema-rls.test.ts under `test:integration`.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getTableConfig } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';
import * as schema from '../schema.js';
import { scanSql } from './additive-migration-scan.js';

const drizzleDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../drizzle');
const TAG = '0029_crm_unificado_modelo';

const TABLES = {
  sales_ops_pipelines: schema.salesOpsPipelines,
  sales_ops_pipeline_stages: schema.salesOpsPipelineStages,
  sales_ops_pipeline_transitions: schema.salesOpsPipelineTransitions,
  sales_ops_field_definitions: schema.salesOpsFieldDefinitions,
  sales_ops_crm_leads: schema.salesOpsCrmLeads,
  sales_ops_crm_lead_field_values: schema.salesOpsCrmLeadFieldValues,
  sales_ops_crm_lead_events: schema.salesOpsCrmLeadEvents,
  sales_ops_crm_lead_notes: schema.salesOpsCrmLeadNotes,
  sales_ops_crm_lead_followups: schema.salesOpsCrmLeadFollowups,
  sales_ops_org_modules: schema.salesOpsOrgModules,
} as const;

const sql = fs.readFileSync(path.join(drizzleDir, `${TAG}.sql`), 'utf8');
const statements = sql
  .split('--> statement-breakpoint')
  .map((s) => s.split('\n').filter((line) => !line.startsWith('--')).join('\n').trim())
  .filter((s) => s !== '');

function journal(): { idx: number; tag: string; when: number }[] {
  return JSON.parse(fs.readFileSync(path.join(drizzleDir, 'meta', '_journal.json'), 'utf8')).entries;
}

describe('CRM schema (migration 0029)', () => {
  it('journals 0029_crm_unificado_modelo immediately after 0028_lead_soft_delete', () => {
    const entries = journal();
    const at = entries.findIndex((entry) => entry.tag === TAG);
    expect(at).toBeGreaterThan(0);
    expect(entries[at]).toMatchObject({ idx: 29, tag: TAG });
    expect(entries[at - 1]).toMatchObject({ idx: 28, tag: '0028_lead_soft_delete' });
    expect(entries[at]!.when).toBeGreaterThan(entries[at - 1]!.when);
  });

  it('is additive: the guard scanner finds nothing, and there is no data statement', () => {
    expect(scanSql(sql)).toEqual([]);
    expect(sql).not.toMatch(/fxl-migration-mode/);
    for (const statement of statements) {
      expect(statement).not.toMatch(/^(INSERT|UPDATE|SELECT)\b/i);
    }
  });

  it('creates exactly the ten CRM tables and orders CREATE TABLE, then indexes, then FKs, then RLS', () => {
    const created = statements.filter((s) => s.startsWith('CREATE TABLE')).map((s) => /CREATE TABLE "([a-z_]+)"/.exec(s)![1]);
    expect(created.sort()).toEqual(Object.keys(TABLES).sort());
    const rank = (s: string) => (s.startsWith('CREATE TABLE') ? 0 : /^CREATE (UNIQUE )?INDEX/.test(s) ? 1 : /^ALTER TABLE "[a-z_]+" ADD CONSTRAINT/.test(s) ? 2 : 3);
    const ranks = statements.map(rank);
    expect(ranks).toEqual([...ranks].sort((a, b) => a - b));
  });

  it.each(Object.keys(TABLES))('%s has ENABLE + FORCE RLS and both org policies spelled exactly like 0022', (table) => {
    expect(sql).toContain(`ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY;`);
    expect(sql).toContain(`ALTER TABLE ${table} FORCE ROW LEVEL SECURITY;`);
    expect(sql).toContain(
      `CREATE POLICY ${table}_tenant_isolation ON ${table}\n  AS PERMISSIVE FOR ALL\n  USING (org_id = current_setting('app.current_org_id', true))\n  WITH CHECK (org_id = current_setting('app.current_org_id', true));`,
    );
    expect(sql).toContain(
      `CREATE POLICY ${table}_admin_context ON ${table}\n  AS PERMISSIVE FOR ALL\n  USING (current_setting('app.fxl_admin', true) = 'true')\n  WITH CHECK (current_setting('app.fxl_admin', true) = 'true');`,
    );
  });

  it.each(Object.entries(TABLES))('%s: org_id is NOT NULL and every FK is composite with org_id first', (name, table) => {
    const config = getTableConfig(table);
    expect(config.name).toBe(name);
    const orgId = config.columns.find((column) => column.name === 'org_id');
    expect(orgId?.notNull).toBe(true);
    for (const fk of config.foreignKeys) {
      expect(fk.reference().columns[0]!.name, `${name} ${fk.getName()}`).toBe('org_id');
      expect(fk.reference().foreignColumns[0]!.name, `${name} ${fk.getName()} target`).toBe('org_id');
    }
  });

  it('chains the 0029 snapshot to 0028 and records every table', () => {
    const read = (index: string) => JSON.parse(fs.readFileSync(path.join(drizzleDir, 'meta', `${index}_snapshot.json`), 'utf8'));
    const previous = read('0028');
    const current = read('0029');
    expect(current.prevId).toBe(previous.id);
    for (const name of Object.keys(TABLES)) {
      expect(current.tables[`public.${name}`], name).toBeDefined();
      expect(previous.tables[`public.${name}`], name).toBeUndefined();
    }
  });

  it('keeps the legacy lead tables byte-intact: no 0029 statement touches them', () => {
    for (const legacy of ['sales_ops_leads', 'sales_ops_lead_products', 'sales_ops_lead_stages', 'leads', 'sales_ops_sales', 'sales_ops_receivables', 'sales_ops_payables', 'sales_ops_settlements']) {
      const touching = statements.filter((s) => new RegExp(`(ALTER TABLE|INDEX [^;]* ON|ON) "?${legacy}"?[ ;(]`).test(s) && !s.startsWith('ALTER TABLE "sales_ops_crm') && !/REFERENCES "public"\."/.test(s));
      expect(touching, legacy).toEqual([]);
    }
  });

  it('the Cliente system field and the one-proposta-per-lead index are declared on the Drizzle tables', () => {
    const fields = getTableConfig(schema.salesOpsFieldDefinitions);
    expect(fields.checks.map((c) => c.name)).toContain('sales_ops_field_definitions_removable_check');
    const leads = getTableConfig(schema.salesOpsCrmLeads);
    const saleIdx = leads.indexes.find((index) => index.config.name === 'sales_ops_crm_leads_org_sale_idx');
    expect(saleIdx?.config.unique).toBe(true);
    expect(saleIdx?.config.where).toBeDefined();
    expect(schema.salesOpsCrmLeads.estimatedValueBrl.notNull).toBe(true);
    expect(schema.salesOpsCrmLeads.estimatedValueBrl.default).toBe(0);
  });
});
```

`apps/api/test/rls/crm-schema-rls.test.ts` (integration over a scratch database, owner role with FORCE RLS) - cases and assertions:
- every table has `relrowsecurity` and `relforcerowsecurity` and exactly the two policies.
- per table (`it.each`): a tenant sees only its own rows, no tenant context sees zero rows, admin context sees both orgs; a tenant UPDATE against another org affects 0 rows; an INSERT for another org fails `42501`.
- composite FKs refuse a cross-org reference (`23503`); a lead stage must belong to the lead's pipeline (`sales_ops_crm_leads_org_stage_fk`); a transition cannot cross pipelines nor loop (`23514 sales_ops_pipeline_transitions_distinct_check`).
- the 19 constraint cases in `bad` (exit/type pair, reason only for perdido, closed stage type, unique stage name per pipeline, second default pipeline, non-removable system field, reference target, unique field key, value slot none/two/duplicate position, negative estimated value, half-deleted lead, second initial event, blank note, follow-up without date or step, duplicate module key).
- the one-proposta-per-lead partial unique index definition.

```ts
/**
 * Migration 0029 oracle (vendas-crm-unificado slice 05a): FORCE RLS with the two org policies on
 * every new table, and the constraints that make an invalid CRM row unrepresentable. A scratch
 * database is migrated to the head and driven as the NOSUPERUSER owner role, so FORCE RLS applies.
 *
 * Requires Docker Postgres running. Run with:
 *   pnpm --filter @fxl-sales/api exec env VITEST_INTEGRATION=1 vitest run test/rls/crm-schema-rls.test.ts
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runDatabaseMigrations } from '../../src/db/migration-runner.js';
import {
  cleanupScratch,
  createScratchDatabase,
  MIGRATIONS_FOLDER,
  scratchClient,
  type ScratchDatabase,
  type SqlClient,
} from './scratch-database.js';

const CRM_TABLES = [
  'sales_ops_pipelines',
  'sales_ops_pipeline_stages',
  'sales_ops_pipeline_transitions',
  'sales_ops_field_definitions',
  'sales_ops_crm_leads',
  'sales_ops_crm_lead_field_values',
  'sales_ops_crm_lead_events',
  'sales_ops_crm_lead_notes',
  'sales_ops_crm_lead_followups',
  'sales_ops_org_modules',
] as const;

const A = 'org_crm_a';
const B = 'org_crm_b';

type Ids = { pipeline: string; stage1: string; stage2: string; lead: string; field: string; event: string };

describe('CRM schema 0029: RLS and constraints', () => {
  let scratch: ScratchDatabase;
  let client: SqlClient;
  const ids: Record<string, Ids> = {};

  /** Runs `work` in a transaction whose tenant is `org` (or admin when org is null). */
  async function as<T>(org: string | null, work: (tx: SqlClient) => Promise<T>): Promise<T> {
    return (await client.begin(async (tx) => {
      if (org === null) await tx.unsafe(`SELECT set_config('app.fxl_admin', 'true', true)`);
      else await tx.unsafe(`SELECT set_config('app.current_org_id', '${org}', true)`);
      return work(tx as unknown as SqlClient);
    })) as T;
  }

  async function seedOrg(org: string): Promise<Ids> {
    return as(org, async (tx) => {
      const one = async (q: string) => (await tx.unsafe(q))[0]!.id as string;
      const pipeline = await one(
        `INSERT INTO sales_ops_pipelines (org_id, name, system_key, is_default) VALUES ('${org}', 'Funil', 'crm-padrao', true) RETURNING id`,
      );
      const stage1 = await one(
        `INSERT INTO sales_ops_pipeline_stages (org_id, pipeline_id, name, position) VALUES ('${org}', '${pipeline}', 'Novo', 1) RETURNING id`,
      );
      const stage2 = await one(
        `INSERT INTO sales_ops_pipeline_stages (org_id, pipeline_id, name, position, type, exit_kind) VALUES ('${org}', '${pipeline}', 'Ganho', 2, 'saida', 'ganho') RETURNING id`,
      );
      await tx.unsafe(
        `INSERT INTO sales_ops_pipeline_transitions (org_id, pipeline_id, from_stage_id, to_stage_id) VALUES ('${org}', '${pipeline}', '${stage1}', '${stage2}')`,
      );
      const field = await one(
        `INSERT INTO sales_ops_field_definitions (org_id, key, label, kind) VALUES ('${org}', 'obs', 'Obs', 'text') RETURNING id`,
      );
      const lead = await one(
        `INSERT INTO sales_ops_crm_leads (org_id, contact_name, pipeline_id, stage_id) VALUES ('${org}', 'Fulano', '${pipeline}', '${stage1}') RETURNING id`,
      );
      await tx.unsafe(
        `INSERT INTO sales_ops_crm_lead_field_values (org_id, lead_id, field_id, value_text) VALUES ('${org}', '${lead}', '${field}', 'x')`,
      );
      const event = await one(
        `INSERT INTO sales_ops_crm_lead_events (org_id, lead_id, to_stage_id) VALUES ('${org}', '${lead}', '${stage1}') RETURNING id`,
      );
      await tx.unsafe(`INSERT INTO sales_ops_crm_lead_notes (org_id, lead_id, event_id, body) VALUES ('${org}', '${lead}', '${event}', 'nota')`);
      await tx.unsafe(`INSERT INTO sales_ops_crm_lead_followups (org_id, lead_id, next_step, due_on) VALUES ('${org}', '${lead}', 'ligar', '2026-11-01')`);
      await tx.unsafe(`INSERT INTO sales_ops_org_modules (org_id, module_key, enabled) VALUES ('${org}', 'orcamentos', true)`);
      return { pipeline, stage1, stage2, lead, field, event };
    });
  }

  beforeAll(async () => {
    scratch = await createScratchDatabase();
    await runDatabaseMigrations({ databaseUrl: scratch.ownerUrl, migrationsFolder: MIGRATIONS_FOLDER });
    client = scratchClient(scratch);
    ids[A] = await seedOrg(A);
    ids[B] = await seedOrg(B);
  }, 120000);

  afterAll(async () => {
    const errors = await cleanupScratch(scratch);
    if (errors.length > 0) throw new AggregateError(errors, 'scratch database cleanup failed');
  });

  it('every new table has FORCE RLS and exactly the tenant_isolation and admin_context policies', async () => {
    const rows = await scratch.adminScratch.unsafe<{ relname: string; relrowsecurity: boolean; relforcerowsecurity: boolean }[]>(
      `SELECT relname, relrowsecurity, relforcerowsecurity FROM pg_class WHERE relname = ANY(ARRAY[${CRM_TABLES.map((t) => `'${t}'`).join(',')}])`,
    );
    expect(rows).toHaveLength(CRM_TABLES.length);
    for (const row of rows) expect(row, row.relname).toMatchObject({ relrowsecurity: true, relforcerowsecurity: true });
    const policies = await scratch.adminScratch.unsafe<{ tablename: string; policyname: string }[]>(
      `SELECT tablename, policyname FROM pg_policies WHERE tablename = ANY(ARRAY[${CRM_TABLES.map((t) => `'${t}'`).join(',')}]) ORDER BY 1, 2`,
    );
    expect(policies.map((p) => p.policyname)).toEqual(
      [...CRM_TABLES].sort().flatMap((t) => [`${t}_admin_context`, `${t}_tenant_isolation`]),
    );
  });

  it.each(CRM_TABLES)('%s: a tenant sees only its own rows, no tenant sees nothing, admin sees both', async (table) => {
    const own = await as(A, (tx) => tx.unsafe(`SELECT org_id FROM ${table}`));
    expect(own.length).toBeGreaterThan(0);
    expect(new Set(own.map((r) => r.org_id))).toEqual(new Set([A]));
    const nobody = await client.begin((tx) => tx.unsafe(`SELECT 1 FROM ${table}`));
    expect(nobody).toHaveLength(0);
    const all = await as(null, (tx) => tx.unsafe(`SELECT DISTINCT org_id FROM ${table}`));
    expect(new Set(all.map((r) => r.org_id))).toEqual(new Set([A, B]));
  });

  it.each(CRM_TABLES)('%s: a tenant cannot write another org rows (RLS USING)', async (table) => {
    const updated = await as(B, (tx) => tx.unsafe(`UPDATE ${table} SET org_id = org_id WHERE org_id = '${A}'`));
    expect(updated.count).toBe(0);
  });

  it('a tenant cannot insert a row for another org', async () => {
    await expect(
      as(B, (tx) => tx.unsafe(`INSERT INTO sales_ops_pipelines (org_id, name) VALUES ('${A}', 'intruso')`)),
    ).rejects.toMatchObject({ code: '42501' });
  });

  it('composite FKs refuse a cross-org reference even over the admin connection', async () => {
    await expect(
      as(null, (tx) =>
        tx.unsafe(
          `INSERT INTO sales_ops_crm_leads (org_id, contact_name, pipeline_id, stage_id) VALUES ('${B}', 'x', '${ids[A]!.pipeline}', '${ids[A]!.stage1}')`,
        ),
      ),
    ).rejects.toMatchObject({ code: '23503' });
  });

  it('a lead stage must belong to the lead pipeline', async () => {
    const other = await as(A, async (tx) => {
      const p = (await tx.unsafe(`INSERT INTO sales_ops_pipelines (org_id, name) VALUES ('${A}', 'Outro') RETURNING id`))[0]!.id as string;
      return p;
    });
    await expect(
      as(A, (tx) =>
        tx.unsafe(
          `INSERT INTO sales_ops_crm_leads (org_id, contact_name, pipeline_id, stage_id) VALUES ('${A}', 'x', '${other}', '${ids[A]!.stage1}')`,
        ),
      ),
    ).rejects.toMatchObject({ code: '23503', constraint_name: 'sales_ops_crm_leads_org_stage_fk' });
  });

  it('a transition cannot cross pipelines nor loop on one stage', async () => {
    const other = await as(A, async (tx) => {
      const p = (await tx.unsafe(`INSERT INTO sales_ops_pipelines (org_id, name) VALUES ('${A}', 'Outro 2') RETURNING id`))[0]!.id as string;
      return (await tx.unsafe(`INSERT INTO sales_ops_pipeline_stages (org_id, pipeline_id, name) VALUES ('${A}', '${p}', 'Z') RETURNING id`))[0]!.id as string;
    });
    await expect(
      as(A, (tx) => tx.unsafe(`INSERT INTO sales_ops_pipeline_transitions (org_id, pipeline_id, from_stage_id, to_stage_id) VALUES ('${A}', '${ids[A]!.pipeline}', '${ids[A]!.stage1}', '${other}')`)),
    ).rejects.toMatchObject({ code: '23503' });
    await expect(
      as(A, (tx) => tx.unsafe(`INSERT INTO sales_ops_pipeline_transitions (org_id, pipeline_id, from_stage_id, to_stage_id) VALUES ('${A}', '${ids[A]!.pipeline}', '${ids[A]!.stage1}', '${ids[A]!.stage1}')`)),
    ).rejects.toMatchObject({ code: '23514', constraint_name: 'sales_ops_pipeline_transitions_distinct_check' });
  });

  const bad: [string, string, string][] = [
    ['an exit stage needs an exit_kind', `INSERT INTO sales_ops_pipeline_stages (org_id, pipeline_id, name, type) VALUES ('A', 'P', 'S1', 'saida')`, 'sales_ops_pipeline_stages_exit_pair_check'],
    ['a normal stage cannot carry an exit_kind', `INSERT INTO sales_ops_pipeline_stages (org_id, pipeline_id, name, exit_kind) VALUES ('A', 'P', 'S2', 'ganho')`, 'sales_ops_pipeline_stages_exit_pair_check'],
    ['only perdido requires a reason', `INSERT INTO sales_ops_pipeline_stages (org_id, pipeline_id, name, type, exit_kind, requires_reason) VALUES ('A', 'P', 'S3', 'saida', 'ganho', true)`, 'sales_ops_pipeline_stages_reason_check'],
    ['stage type is a closed set', `INSERT INTO sales_ops_pipeline_stages (org_id, pipeline_id, name, type) VALUES ('A', 'P', 'S4', 'x')`, 'sales_ops_pipeline_stages_type_check'],
    ['a stage name is unique per pipeline', `INSERT INTO sales_ops_pipeline_stages (org_id, pipeline_id, name) VALUES ('A', 'P', 'Novo')`, 'sales_ops_pipeline_stages_org_pipeline_name_idx'],
    ['a second default pipeline is refused', `INSERT INTO sales_ops_pipelines (org_id, name, is_default) VALUES ('A', 'Outro default', true)`, 'sales_ops_pipelines_org_default_idx'],
    ['a system field must stay non-removable', `INSERT INTO sales_ops_field_definitions (org_id, key, label, removable, is_system) VALUES ('A', 'k1', 'K', false, false)`, 'sales_ops_field_definitions_removable_check'],
    ['a reference field needs a target', `INSERT INTO sales_ops_field_definitions (org_id, key, label, kind) VALUES ('A', 'k2', 'K', 'reference')`, 'sales_ops_field_definitions_reference_check'],
    ['a field key is unique per org', `INSERT INTO sales_ops_field_definitions (org_id, key, label) VALUES ('A', 'obs', 'Obs 2')`, 'sales_ops_field_definitions_org_key_idx'],
    ['a value row sets exactly one slot (none)', `INSERT INTO sales_ops_crm_lead_field_values (org_id, lead_id, field_id, position) VALUES ('A', 'L', 'F', 1)`, 'sales_ops_crm_lead_field_values_one_slot_check'],
    ['a value row sets exactly one slot (two)', `INSERT INTO sales_ops_crm_lead_field_values (org_id, lead_id, field_id, position, value_text, value_cents) VALUES ('A', 'L', 'F', 2, 'a', 1)`, 'sales_ops_crm_lead_field_values_one_slot_check'],
    ['a value slot position is unique per lead and field', `INSERT INTO sales_ops_crm_lead_field_values (org_id, lead_id, field_id, value_text) VALUES ('A', 'L', 'F', 'again')`, 'sales_ops_crm_lead_field_values_slot_idx'],
    ['estimated value cannot be negative', `INSERT INTO sales_ops_crm_leads (org_id, contact_name, pipeline_id, stage_id, estimated_value_brl) VALUES ('A', 'x', 'P', 'S', -1)`, 'sales_ops_crm_leads_estimated_value_check'],
    ['a half-deleted lead is refused', `INSERT INTO sales_ops_crm_leads (org_id, contact_name, pipeline_id, stage_id, deleted_at) VALUES ('A', 'x', 'P', 'S', now())`, 'sales_ops_crm_leads_deleted_pair_check'],
    ['a lead has exactly one initial entry event', `INSERT INTO sales_ops_crm_lead_events (org_id, lead_id, to_stage_id) VALUES ('A', 'L', 'S')`, 'sales_ops_crm_lead_events_first_entry_idx'],
    ['a note cannot be blank', `INSERT INTO sales_ops_crm_lead_notes (org_id, lead_id, body) VALUES ('A', 'L', '   ')`, 'sales_ops_crm_lead_notes_body_check'],
    ['a follow-up always has a date', `INSERT INTO sales_ops_crm_lead_followups (org_id, lead_id, next_step) VALUES ('A', 'L', 'ligar')`, ''],
    ['a follow-up needs a next step', `INSERT INTO sales_ops_crm_lead_followups (org_id, lead_id, next_step, due_on) VALUES ('A', 'L', ' ', '2026-11-01')`, 'sales_ops_crm_lead_followups_step_check'],
    ['a module key is unique per org', `INSERT INTO sales_ops_org_modules (org_id, module_key) VALUES ('A', 'orcamentos')`, 'sales_ops_org_modules_org_key_idx'],
  ];

  it.each(bad)('%s', async (_name, sql, constraint) => {
    const a = ids[A]!;
    const text = sql
      .replaceAll("'A'", `'${A}'`)
      .replaceAll("'P'", `'${a.pipeline}'`)
      .replaceAll("'S'", `'${a.stage1}'`)
      .replaceAll("'L'", `'${a.lead}'`)
      .replaceAll("'F'", `'${a.field}'`);
    const failure = await as(A, (tx) => tx.unsafe(text)).then(
      () => null,
      (error: unknown) => error as { code?: string; constraint_name?: string; column_name?: string },
    );
    expect(failure, text).not.toBeNull();
    if (constraint === '') expect(failure).toMatchObject({ code: '23502', column_name: 'due_on' });
    else expect(failure!.constraint_name).toBe(constraint);
  });

  it('the one-proposta-per-lead partial unique index is on (org_id, sale_id) where sale_id is not null', async () => {
    const [row] = await scratch.adminScratch.unsafe<{ indexdef: string }[]>(
      `SELECT indexdef FROM pg_indexes WHERE indexname = 'sales_ops_crm_leads_org_sale_idx'`,
    );
    expect(row!.indexdef).toMatch(/UNIQUE INDEX .* \(org_id, sale_id\) WHERE \(sale_id IS NOT NULL\)/);
  });
});
```

## Commands

- Focused: `pnpm --filter @fxl-sales/api exec vitest run src/db/__tests__/crm-schema.test.ts`
- Oracle: `pnpm --filter @fxl-sales/api exec env VITEST_INTEGRATION=1 vitest run test/rls/crm-schema-rls.test.ts` (Docker Postgres on 5006, `apps/api/.env` must exist).
- Affected: `pnpm --filter @fxl-sales/api exec vitest run src/db/__tests__` and `pnpm --filter @fxl-sales/api exec env VITEST_INTEGRATION=1 vitest run test/rls/leads-schema-migration.test.ts test/rls/lead-stages-rls.test.ts test/rls/leads-rls.test.ts`
- Lint and types: `pnpm --filter @fxl-sales/api lint`; `pnpm --filter @fxl-sales/api type-check`
- Root guards that apply: `node --test scripts/__tests__/api-dockerfile-workspace-deps.test.mjs scripts/__tests__/api-test-typecheck.test.mjs` (the Dockerfile ships `drizzle/`; no change expected).

## Risks

- drizzle-kit version drift changes the generated statement text: the helper script only reorders and appends, so it survives; the test pins ranks and RLS text, not the generated DDL.
- The shared test DB: `global-setup.ts` applies 0029 (and later 0030) to it. Other worktrees on older code are unaffected because the old tables are untouched.
- Postgres identifiers are capped at 63 bytes; the longest new name is 48. A longer rename would be silently truncated: keep the SEAM-CONTRACT names.
