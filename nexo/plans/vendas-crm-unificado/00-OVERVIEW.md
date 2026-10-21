---
feature: vendas-crm-unificado
run: 20261021T011348Z-vendas-crm-unificado
milestone: v4.8.0
mode: autopilot
---

# FXL Vendas: CRM unificado (v1)

Pace: economico

Source request: `.nexo/tmp/vendas-crm-prompt-v1.md` (read in full; its section 0 rules are binding on every slice).
Context base: `.nexo/tmp/vendas-modos-analise.md`.

## Frame (WHAT and why)

Today FXL Sales is one app with two Hub-derived "editions" (`full` for FXL, `leads` for Construbom).
The edition lives in the token, not in the database, the funnel is a fixed 4-stage list per org with one `conversion` and one `lost` stage enforced by a unique index, and orgs created after migration 0022 (ECV Control) have no stages at all because only the import route seeds them.
The owner wants one CRM product, branded "FXL Vendas", where:

1. Every user-visible "FXL Sales" reads "FXL Vendas"; technical ids (`fxl-sales`, `@fxl-sales/*`, `SALES_*`, `sales_ops_*`, `salesOps*`, event names, localStorage keys, domains) never change.
2. Product capability comes from per-org modules stored in the database (plan plus flags such as `orcamentos`, `comissoes`, `financeiro`, `finders`, `catalogo`, `importacao`), not from an edition in the token.
3. The funnel is a flowchart: several pipelines per org, stages with a type and a behaviour, explicit allowed transitions, typed exit stages (`ganho`, `perdido`, `pausado`); the Kanban is only one view of a pipeline; an unconfigured org gets the default CRM pipeline, seeded idempotently.
4. A lead requires only name and contact; everything else is typed, filterable dynamic fields (simple or reference); Cliente is a default, non-removable reference field.
5. Clicking a lead opens a summary page (current stage, history with notes, an Avançar button offering only valid transitions, a next-step-plus-date follow-up); stage history is written by the server.
6. Nothing is lost in the migration; the high-risk entities are left untouched and filed as pending.
7. One lead component everywhere, creating the empresa inline and prefilling contacts and the responsible seller.
8. Proposta versus Vendido is decided by stage type; every list and the Kanban have a period filter; each Propostas submenu entry is its own route.
9. Second wave: "dias sem comprar" per cliente and spreadsheet import with column-to-field and stage mapping.

Out of scope (listed in the Report and `nexo/ROADMAP.md` only): onboarding of pipelines, fields and modules; an AI agent; calendar integration.

## Feature acceptance criteria

- AC-0 Brand: `grep "FXL Sales"` over `apps/web/src` and the API's user-facing strings is 0 (comments may stay); a guard test pins `fxlAppId`, package names, event names, env names and localStorage keys unchanged.
- AC-0 ECV: `GET /lead-stages` and the bootstrap seed missing stages idempotently, never reinsert renamed or archived stages, and two concurrent reads never 500.
- AC-0 Default pipeline: one constant is the single source of the default CRM pipeline, with a test comparing it to the migration seed.
- AC-1 Survey: `nexo/runs/<run-id>/levantamento-entidades.md` exists, classifies every listed entity low, medium or high with code citations, and passes a separate Sonnet Verify before any data model is written.
- AC-1 Model: an ADR in `nexo/knowledge/decisions/` cites the survey; the migrations after `0028_*` are 100% additive (a guard test fails on `DROP`, `DELETE`, `TRUNCATE`, `RENAME`, or a lossy `ALTER COLUMN ... TYPE`); new org-scoped tables use FORCE RLS with the tenant and admin policies; no GRANT or ROLE in migrations.
- AC-1 Data migration: a synthetic-dataset migration test proves every source table is identical before and after, destination counts and value sums match, payables, receivables, settlements and outbox are unchanged, no FK is orphaned, RLS isolates orgs, and a second run is a no-op.
- AC-2 Lead: one create/edit component; inline empresa creation; prefilled contacts and responsible; dynamic fields by type; Cliente not removable; invalid transition answers 4xx; advancing writes a server-side history event; a follow-up requires a date; period filters use `America/Sao_Paulo`; clicking a card opens the summary, not the form.
- AC-3 Modules: an org with `orcamentos` off (Construbom) sees exactly what it sees today plus the phase 2 additions; a full org shows no regression (whole suite green); toggling a flag changes navigation and the capability 403 without a redeploy; no pin or legacy guard breaks.
- AC-4: "dias sem comprar" is empty (not 0) for a cliente with no won sale, ignores lost sales, uses the latest won sale; import with column mapping has idempotent preview and commit, keeps existing-cliente recognition, and its template carries the FXL Vendas brand.
- Every wave merges only with a green separate Sonnet Verify and a Codex review (`gpt-6-astra`, reasoning `high`, ChatGPT subscription) with no blocking finding, both recorded.

## Phases, waves and slices (abstract plan)

Phase N is planned in detail by a Sonnet planner only once phase N-1 is green on local `master`, because phase 1b and later depend on the survey's verdicts.
Every slice is registered now so the run's shape is visible; detailed plans land in this folder as `NN-slug.md`.

| Wave | Phase | Slice | Goal | Depends on |
| --- | --- | --- | --- | --- |
| 1 | 0 | 01-marca-fxl-vendas | User-visible brand FXL Vendas, technical-id guard test | - |
| 1 | 0 | 02-etapas-seed-on-read | `ensureLeadStagesForOrg` on `GET /lead-stages` and bootstrap (ECV bug) | - |
| 1 | 0 | 03-funil-padrao-e-guard-aditivo | Default CRM pipeline constant (single source) and the additive-migration guard | - |
| 2 | 1a | 04-levantamento-entidades | Read-only entity survey with risk classification (document only) | 03 |
| 3 | 1b | 05-modelo-crm-schema | ADR + Drizzle schema + additive migration 0029 with RLS for pipelines, stages, transitions, field definitions and values, lead events, notes, follow-ups, org modules | 04 |
| 4 | 1c | 06-migracao-dados-crm | Additive backfill from today's stages and leads into the new model, with the synthetic migration oracle | 05 |
| 5 | 2 | 07-api-pipeline-e-lead | API: pipelines, valid transitions, server-written history, notes, follow-ups, dynamic fields, period filters | 06 |
| 5 | 2 | 08-web-lead-form-unico | One lead create/edit component with inline empresa and dynamic fields | 06 |
| 6 | 2 | 09-web-lead-resumo | Lead summary page, Avançar with valid transitions, follow-up modal and list | 07, 08 |
| 6 | 2 | 10-web-kanban-funil-periodo | Pipeline selector, Proposta versus Vendido by stage type, period filters, Propostas submenu routes | 07 |
| 7 | 3 | 11-api-modulos-org | Capability from per-org modules in the database, one-time token backfill compat | 10 |
| 7 | 3 | 12-web-modulos-navegacao | Navigation filtered by module, no per-edition lists | 11 |
| 8 | 4 | 13-dias-sem-comprar | Days since the last won sale per cliente, shown and filterable | 12 |
| 8 | 4 | 14-importacao-mapeamento | Import with column-to-field and stage mapping, preview and commit idempotent | 12 |

The planner of each phase may split or merge slices within the run budget (16 initial, 24 total); the final ids are recorded in this table's plans.

## Process per phase (from the request, section 3)

Planner `sonnet` writes the phase's slices, plan-checker `sonnet` checks them, Executor `haiku` builds each slice in `.worktrees/<run-id>/<slice>` on `feat/6q75vnog-<slice>`, a separate Verify `sonnet` runs the oracle, the affected suite, lint and type-check, then the Codex reviewer (`codex exec -m gpt-6-astra`, reasoning `high`, read-only sandbox) reviews the wave diff.
A blocking finding returns to the `haiku` Executor, then Verify and review are redone, within `runtime-policy.json` rounds; exhausted means `AUDIT.md` plus pending, no merge.
The wave gate is `wave-suite.sh` on the integrated run branch; the phase then enters local `master` through `nexo-trunk-merge.sh` (merge `--no-ff`, `full-suite.sh` on the exact merge tree).

## Risks

- High risk by definition, left untouched and filed as pending: unifying the legacy finder `leads` table with `sales_ops_leads`; any change to `fxl-sales.obligation.*` or `fxl-sales.settlement.*`; `sales_ops_payables`, `sales_ops_receivables`, `sales_ops_settlements`.
- `0022` constraints (`sales_ops_lead_stages_org_kind_idx`, `sales_ops_lead_stages_system_kind_check`) block several exit stages per org, so the new stages live in their own table and the old table stays intact.
- `SalesOpsApp.tsx` is about 9,700 lines; web slices must name exact line ranges and keep new screens in their own folders.
- Removing the edition concept touches many locked oracles (`navigation-edition.test.ts`, `edition-gate-map.test.ts`, `auth-mock-edition-export.test.ts`); phase 3 must keep Construbom byte-identical.
- One local Postgres serves every worktree's integration run, so integration suites run serially.
- No production, no push, no Hub change; branches and worktrees are never deleted in this run.
