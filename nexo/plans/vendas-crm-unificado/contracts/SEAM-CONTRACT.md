# SEAM CONTRACT - unified CRM model (phases 1b and 1c)

This file is AUTHORITATIVE for the names used by the phase 2, 3 and 4 planners and executors.
If a plan disagrees with it, this file wins.
It was verified by running the migrations, the schema and the service code on a scratch database; every name below exists in the plans `05a`, `05b` and `06`.
Decisions and alternatives are in `nexo/knowledge/decisions/2026-10-21-crm-unificado-modelo.md`.

## Slices and files

| Slice | Plan | Creates |
| --- | --- | --- |
| 05a | `05a-crm-schema-migracao.md` | ADR, Drizzle tables in `apps/api/src/db/schema.ts`, migration `0029_crm_unificado_modelo` (SQL, snapshot, journal), tests `src/db/__tests__/crm-schema.test.ts` and `test/rls/crm-schema-rls.test.ts` |
| 05b | `05b-crm-defaults-servicos.md` | `packages/shared-utils/src/crm-model.ts` (subpath `@fxl-sales/shared-utils/crm-model`), `apps/api/src/domains/crm/defaults.ts`, tests |
| 06 | `06-migracao-dados-crm.md` | migration `0030_crm_legacy_copy` (data only), the migration oracle `test/rls/crm-legacy-copy-migration.test.ts`, seed delete order, parity hook |

Migration file names (journal tags): `0029_crm_unificado_modelo`, `0030_crm_legacy_copy`.
The next free migration number is `0031`.
Both migrations are ordinary (non-phased), 100% additive, and carry no GRANT or ROLE.

## Rules every later slice must keep

- The old tables `sales_ops_leads`, `sales_ops_lead_products`, `sales_ops_lead_stages` are never altered. The phase 2 API cutover is code only.
- A phase 2 cutover migration (`0031_*`) repeats the `0030_crm_legacy_copy.sql` statements and then RESYNCS rows changed in the old tables since 0030 (UPDATE changed leads, upsert changed values, one history event per changed stage) BEFORE the reads switch. Generate it with `drizzle-kit generate --custom` and copy the file body.
- Every new org-scoped table: `org_id text NOT NULL`, composite FKs with `org_id` first onto a `UNIQUE (org_id, id)`, FORCE RLS with `<table>_tenant_isolation` and `<table>_admin_context` spelled like 0022.
- An enumeration that may grow gets NO CHECK (the guard forbids DROP CONSTRAINT); validate it with zod and the constants below.
- drizzle-kit emits FKs before the unique indexes they need when the tables are new: reorder to CREATE TABLE, indexes, FKs (the slice 05a helper script does it).
- Writers of `stage_id` or `position` on the NEW lead table take the per-org advisory lock the old `lockLeadBoard` takes (same key, same order), right after the scope gate and before any row lock. Phase 2 owns that function.
- Only `ensureDefaultPipeline`, `ensureSystemFieldDefinitions`, `ensureCrmDefaults`, `ensureCrmDefaultsForOrg` may seed; the allow-list test `apps/api/src/domains/crm/__tests__/crm-seed-callers.test.ts` (`ALLOWED_CALLERS`) is where phase 2 registers a request path.
- Civil days (`due_on`, `value_date`) are `date` columns in string mode, never `Date`.

## Tables (SQL name -> Drizzle export in `apps/api/src/db/schema.ts`)

| SQL table | Drizzle export | Row type |
| --- | --- | --- |
| `sales_ops_pipelines` | `salesOpsPipelines` | `typeof salesOpsPipelines.$inferSelect` |
| `sales_ops_pipeline_stages` | `salesOpsPipelineStages` | idem |
| `sales_ops_pipeline_transitions` | `salesOpsPipelineTransitions` | idem |
| `sales_ops_field_definitions` | `salesOpsFieldDefinitions` | idem |
| `sales_ops_crm_leads` | `salesOpsCrmLeads` | idem |
| `sales_ops_crm_lead_field_values` | `salesOpsCrmLeadFieldValues` | idem |
| `sales_ops_crm_lead_events` | `salesOpsCrmLeadEvents` | idem |
| `sales_ops_crm_lead_notes` | `salesOpsCrmLeadNotes` | idem |
| `sales_ops_crm_lead_followups` | `salesOpsCrmLeadFollowups` | idem |
| `sales_ops_org_modules` | `salesOpsOrgModules` | idem |

Drizzle property names are the camelCase of the SQL column. All tables have `id uuid PK default gen_random_uuid()`, `org_id text NOT NULL`, `created_at timestamptz NOT NULL default now()`; the mutable ones have `updated_at timestamptz NULL` (set by the service, no trigger).

### `sales_ops_pipelines`
`name text NOT NULL`, `system_key text NULL` (`'crm-padrao'` for the seeded one), `position int NOT NULL default 0`, `is_default bool NOT NULL default false`, `status text NOT NULL default 'active'` (CHECK `active|archived`), `archived_at timestamptz NULL`.
Indexes: unique `(org_id, id)`, unique `(org_id, name)`, unique partial `(org_id, system_key) WHERE system_key IS NOT NULL`, unique partial `(org_id) WHERE is_default` (at most one default per org).

### `sales_ops_pipeline_stages`
`pipeline_id uuid NOT NULL`, `name text NOT NULL`, `position int NOT NULL default 0`, `type text NOT NULL default 'normal'` (CHECK `normal|orcamento|saida`), `behavior text NOT NULL default 'none'` (no CHECK; `none|opens_orcamentos`), `exit_kind text NULL` (CHECK `ganho|perdido|pausado`), `requires_reason bool NOT NULL default false`, `status`, `archived_at`.
CHECKs: `(type = 'saida') = (exit_kind IS NOT NULL)`; `NOT requires_reason OR exit_kind = 'perdido'`.
Indexes: unique `(org_id, id)`, unique `(org_id, pipeline_id, id)` (FK target for leads and transitions), unique `(org_id, pipeline_id, name)`, `(org_id, pipeline_id, position)`.
FK `(org_id, pipeline_id) -> pipelines (org_id, id)` restrict.
Migrated legacy stages keep their old `sales_ops_lead_stages.id`.

### `sales_ops_pipeline_transitions`
`pipeline_id`, `from_stage_id`, `to_stage_id` (all uuid NOT NULL).
Unique `(org_id, from_stage_id, to_stage_id)`; CHECK `from_stage_id <> to_stage_id`; FKs `(org_id, pipeline_id, from_stage_id)` and `(org_id, pipeline_id, to_stage_id)` -> stages `(org_id, pipeline_id, id)` restrict.
A pair that is absent is not allowed.

### `sales_ops_field_definitions`
`key text NOT NULL` (unique per org), `label text NOT NULL`, `kind text NOT NULL default 'text'` (no CHECK; `text|number|money|date|options|reference`), `reference_target text NULL` (no CHECK; `cliente|contato|produto|servico|venda`, set exactly when `kind = 'reference'`, CHECK), `multiple bool default false`, `options jsonb NULL` (`[{key, label}]`), `filterable bool default false`, `is_system bool default false`, `removable bool default true` (CHECK `removable OR is_system`), `backing_column text NULL` (`'client_id'` for Cliente), `position int`, `status`, `archived_at`.
The Cliente row: `key 'cliente'`, `label 'Cliente'`, `kind 'reference'`, `reference_target 'cliente'`, `multiple false`, `filterable true`, `is_system true`, `removable false`, `backing_column 'client_id'`, `position 1`. Constant: `SYSTEM_FIELD_CLIENTE`.
Backfilled optional fields (only when data exists): `produtos` (reference produto, multiple, position 2), `descricao` (text, position 3), `nascimento` (date, position 4).

### `sales_ops_crm_leads`
`contact_name text NOT NULL`, `contact_phone`, `contact_email` (text NULL), `pipeline_id uuid NOT NULL`, `stage_id uuid NOT NULL`, `position int default 0`, `stage_changed_at timestamptz NOT NULL default now()`, `seller_person_id uuid NULL`, `seller_name_snapshot text NOT NULL default ''`, `client_id uuid NULL`, `client_name_snapshot text NOT NULL default ''`, `estimated_value_brl int NOT NULL default 0` (CHECK `>= 0`), `lost_reason text NULL`, `sale_id uuid NULL`, `deleted_at`, `deleted_by_user_id`, `deleted_by_name` (CHECK `(deleted_at IS NULL) = (deleted_by_user_id IS NULL)`).
Indexes: unique `(org_id, id)`; `(org_id, stage_id, position)` (board column); `(org_id, pipeline_id)`; `(org_id, seller_person_id)`; `(org_id, created_at)` (period filter); unique partial `(org_id, sale_id) WHERE sale_id IS NOT NULL` (one lead per proposta, deleted included); partial `(org_id, deleted_at, id) WHERE deleted_at IS NOT NULL`.
FKs (all restrict, composite): pipeline `(org_id, pipeline_id)`, stage `(org_id, pipeline_id, stage_id)`, client, seller person, sale.
Dynamic fields are NOT columns here. Birth date, description and produtos are field values.

### `sales_ops_crm_lead_field_values` (EAV, typed)
`lead_id`, `field_id` (uuid NOT NULL), `position int NOT NULL default 0` (CHECK `>= 0`; 0 for single-valued), `value_text text`, `value_number numeric(20,6)`, `value_cents bigint` (Drizzle `mode: 'number'`), `value_date date` (string), `value_option text`, `value_client_id uuid`, `value_product_id uuid`, `value_sale_id uuid`, `ref_name_snapshot text`, `updated_at`.
CHECK `num_nonnulls(value_text, value_number, value_cents, value_date, value_option, value_client_id, value_product_id, value_sale_id) = 1`.
Unique `(org_id, lead_id, field_id, position)`; one partial btree per slot for filtering `(org_id, field_id, <slot>) WHERE <slot> IS NOT NULL` (client and sale slots: `(org_id, <slot>)`).
FKs: lead (cascade), field, client, product, sale (restrict).
Slot by field: text -> `value_text`; number -> `value_number`; money -> `value_cents` (integer cents); date -> `value_date`; options -> `value_option` (the option key); reference cliente -> `value_client_id` + snapshot; reference produto or servico -> `value_product_id` + snapshot, OR `value_text` + snapshot for a FREE item (no catalog row); reference venda -> `value_sale_id`; reference contato -> `value_text` (no entity yet).
Matching slot to definition is a zod rule in the phase 2 service.

### `sales_ops_crm_lead_events`
`lead_id`, `kind text NOT NULL default 'stage_changed'` (no CHECK), `from_stage_id uuid NULL`, `to_stage_id uuid NULL`, `reason text NULL`, `actor_user_id text NULL`, `actor_name_snapshot text NULL`, `occurred_at timestamptz NOT NULL default now()`.
Unique `(org_id, id)`; `(org_id, lead_id, occurred_at, id)`; unique partial `(org_id, lead_id) WHERE from_stage_id IS NULL AND kind = 'stage_changed'` (exactly one initial entry per lead).
FKs restrict: lead, from stage `(org_id, from_stage_id)`, to stage `(org_id, to_stage_id)`.
Migrated first event: `from_stage_id NULL`, `to_stage_id` = the lead's stage, `occurred_at` = `stage_changed_at`, `actor_user_id 'system'`, `actor_name_snapshot 'Migração'`, `reason` = `lost_reason`.
Phase 2 writes ONE event per stage change in the SAME transaction as the move, with the actor name snapshotted from the token.

### `sales_ops_crm_lead_notes`
`lead_id`, `event_id uuid NULL` (the stage event the note was written with), `body text NOT NULL` (CHECK not blank), `author_user_id`, `author_name_snapshot`. FKs restrict: lead, event.

### `sales_ops_crm_lead_followups`
`lead_id`, `next_step text NOT NULL` (CHECK not blank), `due_on date NOT NULL` (civil day, string mode), `owner_person_id uuid NULL`, `owner_name_snapshot`, `done_at timestamptz NULL`, `created_by_user_id`, `created_by_name`, `updated_at`.
Partial index `(org_id, due_on) WHERE done_at IS NULL`. FKs restrict: lead, owner pessoa.

### `sales_ops_org_modules`
`module_key text NOT NULL` (no CHECK), `enabled bool NOT NULL default false`, `source text NOT NULL default 'default'` (no CHECK; `default|token_backfill|admin`), `updated_at`. Unique `(org_id, module_key)`.
Written by nobody before phase 3.

## Constants and pure functions (`@fxl-sales/shared-utils/crm-model`, file `packages/shared-utils/src/crm-model.ts`)

Run `pnpm --filter @fxl-sales/shared-utils build` after editing; the API resolves the package through `dist`.

- `CRM_STATUSES`, `CrmStatus`
- `PIPELINE_STAGE_TYPES` (`normal|orcamento|saida`), `PIPELINE_EXIT_KINDS` (`ganho|perdido|pausado`) (types `PipelineStageType`, `PipelineExitKind` come from `@fxl-sales/shared-utils/default-pipeline`)
- `STAGE_BEHAVIORS`, `StageBehavior`
- `FIELD_KINDS`, `FieldKind`; `FIELD_REFERENCE_TARGETS`, `FieldReferenceTarget`
- `LEAD_EVENT_KINDS`, `LeadEventKind`
- `CRM_MODULE_KEYS` (`orcamentos|comissoes|financeiro|finders|catalogo|importacao|clientes`), `CrmModuleKey`, `isCrmModuleKey(value)`, `CRM_MODULE_SOURCES`, `CrmModuleSource`
- `CAPABILITY_MODULES: Record<SalesCapability, readonly CrmModuleKey[]>` and `modulesForEdition(edition): Record<CrmModuleKey, boolean>` (phase 3 token backfill)
- `defaultStageBehavior(stage)`, `defaultStageRequiresReason(stage)`
- `planPipelineTransitions(stages: readonly TransitionPlanStage[]): [string, string][]` (the 0030 rule in TypeScript; phase 2 may use it to regenerate a graph)
- `SYSTEM_FIELD_CLIENTE`, `DEFAULT_PIPELINE_STAGE_BY_KEY`
- Existing, unchanged: `DEFAULT_PIPELINE_STAGES`, `DEFAULT_PIPELINE_TRANSITIONS`, `DEFAULT_PIPELINE_KEY` (`'crm-padrao'`), `DEFAULT_PIPELINE_NAME` (`'Funil CRM padrão'`) from `@fxl-sales/shared-utils/default-pipeline`.

## Service functions (`apps/api/src/domains/crm/defaults.ts`)

```ts
type Db = ReturnType<typeof getDb>;
export type PipelineRow = typeof salesOpsPipelines.$inferSelect;
export type FieldDefinitionRow = typeof salesOpsFieldDefinitions.$inferSelect;

/** Seeds the default pipeline only when the org has NO pipeline row. Inside a tenant tx. Returns the org's pipelines ordered by (position, name). */
export function ensureDefaultPipeline(tx: Db, orgId: string): Promise<PipelineRow[]>;
/** Inserts the Cliente system field with ON CONFLICT DO NOTHING. Returns the org's fields ordered by (position, key). */
export function ensureSystemFieldDefinitions(tx: Db, orgId: string): Promise<FieldDefinitionRow[]>;
export function ensureCrmDefaults(tx: Db, orgId: string): Promise<{ pipelines: PipelineRow[]; fields: FieldDefinitionRow[] }>;
/** Opens withTenant (domains/sales-ops/leads/with-tenant.js) and calls ensureCrmDefaults. */
export function ensureCrmDefaultsForOrg(db: Db, orgId: string): Promise<{ pipelines: PipelineRow[]; fields: FieldDefinitionRow[] }>;
```

There is no `copyLegacyLeadsToCrm` function: the copy is the migration SQL (`0030_crm_legacy_copy.sql`), run once at deploy, and a phase 2 migration repeats it.

## Fixed numbers the tests pin

- Default pipeline: 7 stages, 22 transitions, 1 pipeline, 1 field (`cliente`).
- Legacy org shaped like FXL (Novo/Em negociação/Proposta/Perdido): 4 stages copied with their ids, plus `Ganho` (position 5) and `Pausado` (position 6), 3 open stages + Perdido + Ganho + Pausado, 16 transitions (an archived 5th stage is excluded and keeps its position).
- 20 foreign keys across the ten tables; 10 tables, 20 policies.

## What the phase 2 to 4 planners must NOT redo

- Do not add columns to the lead table for dynamic fields; add a field definition and value rows.
- Do not read `sales_ops_lead_stages.kind` in new code; read `type`, `exit_kind`, `behavior`, `requires_reason` on `sales_ops_pipeline_stages`.
- Do not write `fxl-sales.*` outbox events for a lead (P2 stays untouched); a lead move never touches the ledger.
- Do not import the legacy `leads` table into the CRM (P1).
