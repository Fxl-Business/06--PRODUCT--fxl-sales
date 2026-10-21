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
They stay as pendencias of the survey (section 4); a later run owns them.

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

- Between 0030 and the phase 2 cutover the old tables stay the write path, so rows written in that window are not copied by 0030 alone.
- The repeat in 0031 only adds rows that do not exist yet.
- A lead that already exists in the new table is NOT refreshed by a verbatim repeat.
- The phase 2 cutover must therefore either (a) make 0031 a resync: after the repeated inserts, `UPDATE sales_ops_crm_leads ... FROM sales_ops_leads` for stage_id, position, stage_changed_at, seller, client, value, lost_reason, sale_id and deleted_* where they differ, `INSERT ... ON CONFLICT (org_id, lead_id, field_id, position) DO UPDATE` for value rows, and a stage_changed event for each changed stage, with a test that mutates the old tables between 0030 and 0031; or (b) dual-write old and new tables from the first phase 2 deploy until the cutover.
- Choose and test one; a verbatim repeat is not enough.
- No `sales_ops_crm_lead_field_values` row is written for Cliente by design; the owner accepted the backing-column form (D3).
- The dev seed deletes the new tables first (`SEED_DELETE_ORDER`), because `sales_ops_crm_leads` restrict-references clientes, pessoas, propostas and produtos.
- No existing API route, schema or web file changes in 1b and 1c.
- Open questions stay with the owner (survey section 6): whether contact requires phone or e-mail, whether Contato becomes an entity, whether finder referrals appear in the CRM, whether Orçamento creates a proposta.

## Verify notes applied

1. `estimated_value_brl` keeps NOT NULL DEFAULT 0 and the `>= 0` CHECK.
2. Only row `amountCents`, `saleId`, `saleCode`, the client name snapshot and `deepLinkPath` reach the Finance event, so nothing here changes it.
3. `restoreLead` depends on `kind` transitively through `firstOpenLeadStage`; the old API is untouched until phase 2.
4. "Excluded from the synced set on the producer" is the producer side, unchanged.
5. `sales_ops_leads_org_seller_idx` is mirrored as `sales_ops_crm_leads_org_seller_idx`.
