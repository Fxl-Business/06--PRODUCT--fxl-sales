---
id: 00-overview
milestone: v2.3.0
status: done
---

# Feature: Propostas + Áreas

## Frame

FXL Sales stops recording only finished sales.
Every deal starts life as a **Proposta** with a lifecycle (`Rascunho -> Aberta -> Ganha / Perdida / Cancelada`), so the team can see how many each seller opens and closes.
Products and free-form service lines belong to configurable **Áreas** (business units: FXL Tech, FXL Visual, FXL Advisor, FXL BPO Sales, FXL Influência Estratégica, FXL Treinamentos), enabling per-área reporting later.
The payment plan becomes a flexible list of parcelas (date + amount + method each) instead of "condição + N parcelas mensais", supporting cases like "R$ 20k PIX today + 3x R$ 3.333 boleto" and cancellable monthly contracts (FXL Advisor: R$ 10k/month x 3, client can stop anytime).
This feature also lays the data foundation for contract-document generation (client legal fields, full snapshots); document generation itself is a follow-up feature.

## Decisions locked by the user (2026-07-29)

1. Name is **Proposta** (button "Nova proposta", nav label "Propostas", route slug stays `vendas`).
2. States: `draft` (Rascunho), `open` (Aberta), `won` (Ganha), `lost` (Perdida), `cancelled` (Cancelada). No validade/expiry, no Enviada/Em negociação sub-state.
3. Existing sale rows are test data and can be remapped freely (`closed|completed -> won`, `forecast|in_progress -> open`); no compatibility constraints.
4. Financial ledger (payables) materializes **only when a proposta becomes won**; reverting/losing/cancelling voids open payables.
5. Payment plan builder: list of parcela rows (dueDate, amountBrl, method) that must sum to the total, plus a "dividir em N x" shortcut that autofills equal monthly rows.
6. Advisor-style contracts: recurring component that can be cancelled mid-way; cancellation voids remaining open parcelas AND their linked commissions (commission is earned per parcela, not on the full contract at win).
7. Áreas: new Cadastros page, seeded with the six FXL areas, org-configurable. Área is required on every product and on every proposal item.
8. Free-form service items are allowed: no product, just área + description + value.
9. Product "Tipo" (hardcoded `SaaS/Custom/Advisor/Visual`) is removed from the UI; classification becomes dynamic via Áreas plus the existing pricing flags (openPrice, setup, mensalidade).
10. Autopilot-resolved (user interrupted before answering): contract document = data foundation only in this feature; single "Propostas" list view with filters + win/lose actions (no kanban); dashboard funnel is Phase 2, but this feature must keep the dashboard correct under the new statuses.

## Domain contract (all slices must respect this)

### Status model
- Canonical statuses: `draft`, `open`, `won`, `lost`, `cancelled`.
- New timestamps on `sales_ops_sales`: `won_at`, `lost_at` (nullable timestamptz).
- `closedStatuses` concept becomes `won` only; update every duplicated copy (`apps/api/src/domains/sales-ops/service.ts`, `apps/web/src/sales-ops/calculations.ts`, `statusMeta` in SalesOpsApp.tsx).
- Migration remaps legacy rows: `closed|completed -> won` (set `won_at = updated_at ?? created_at`), `forecast|in_progress -> open`.

### Payment plan and ledger
- `sales_ops_receivables` rows ARE the payment plan: created with the proposta, replaced on update while not won. New column `method` (`pix|card|boleto|transfer`). Status values: `open|paid|void`.
- The old `payment_method` + `condition` + `installments` sale columns stay in the DB but stop driving the ledger; API v2 payload carries an explicit `installments: [{dueDate, amountBrl, method}]` array (min 1, must sum to totalBrl) plus optional `recurring: {monthlyBrl, startDate, cycles}` where `cycles` is int or null (indefinite).
- Bounded recurring (cycles != null) also materializes parcela rows; indefinite recurring only sets `recurring_brl` (MRR metric) and creates no rows beyond any setup parcelas.
- Commission and tax payables are generated **per receivable row** at win time: `seller_commission`, `finder_commission`, `tax` payables each linked via new nullable `receivable_id` column on `sales_ops_payables`, amount = pct of that row, due date = row due date. `professional_cost` and `other_cost` payables stay one-shot at win, due at win date.
- Transitions: `won` materializes payables from the current plan; leaving `won` (revert to open, or to lost/cancelled) voids payables with status `open` (never touches `paid`); cancelling a recurring contract mid-way (`contract cancel` action on a won sale) voids remaining `open` receivables and their linked `open` payables.
- `buildSaleLedger` stays a pure function: it computes totals/margin from an explicit plan, and materialization happens at transition time in the service layer.
- Bootstrap payload adds `receivables` and `areas` arrays.

### Áreas
- New table `sales_ops_areas`: `id uuid PK`, `org_id text NOT NULL`, `name text NOT NULL`, `status text NOT NULL default 'active'` (`active|archived`), `created_at`, `updated_at`, unique `(org_id, name)`, RLS pattern copied from migration 0007 (tenant-isolation + admin-context policies).
- Migration seeds the six FXL áreas for every org that already has a `sales_ops_settings` row (backfill with `app.fxl_admin` set, mirroring migration 0009).
- `sales_ops_products.area_id uuid NULL` references areas; API requires `areaId` on product create, existing products get backfilled to NULL and the product dialog requires an área on next save.
- `sales_ops_sale_items` gains `area_id uuid NULL` + `area_name_snapshot text NOT NULL default ''`; item área comes from the product or is picked directly on free-form items; API rejects items without a resolvable área.
- Free-form item = `productId` null + `productName` used as the description (consistent with the 2026-07-14 name-snapshot decision), `areaId` required.

### Clients (contract data foundation)
- `sales_ops_clients` gains nullable text columns: `legal_name`, `document` (CNPJ/CPF), `address`, `legal_rep_name`, `legal_rep_document`.
- Client dialog exposes them as optional fields.

### API surface
- `POST /api/v1/sales-ops/areas`, `PATCH /areas/:id`, areas in bootstrap.
- `POST /sales` accepts the v2 payload and any status in `draft|open|won` (won materializes immediately).
- `PUT /sales/:id` (or PATCH, planner decides one and documents it) replaces a non-won proposta (children replaced transactionally).
- `POST /sales/:id/transition` with `{status}` for open/won/lost/cancelled/reopen, and `POST /sales/:id/cancel-contract` for mid-contract cancellation. Planner may fold these into one endpoint if cleaner, but transitions must be explicit and validated (no free status writes).
- Tenancy: every query filtered by orgId inside `withTenant`, RLS on all new tables/columns per the 0007 pattern.

### Web UX
- Sidebar and header CTA become "Nova proposta"; dialog title reflects Proposta (the old "Fechamento da venda" copy dies).
- Wizard steps: 1 Proposta (cliente, responsáveis, itens with área + free-form rows), 2 Pagamento (plan builder + N x shortcut + recurring block), 3 Custos e margem, 4 Revisão (ledger preview labelled as "previsão"; payables table shown as what WILL be generated on Ganha).
- The wizard's primary submit creates the proposta as `open` ("Salvar proposta"); a secondary "Salvar rascunho" keeps `draft`; marking won happens from the list (a proposta created for an already-done deal is saved then immediately marked Ganha from the list, or via a "Criar e marcar como ganha" convenience if the planner finds it low-cost).
- `operacional/vendas` view renders the Propostas table: columns code, cliente, vendedor, áreas, total, status chip, data; filter controls for status and área (real state, replacing the inert placeholder panel); row actions: Marcar como ganha, Marcar como perdida, Cancelar, Reabrir, Editar (opens wizard prefilled), Cancelar contrato (won + recurring only); a row click opens a read-only detail drawer/dialog with items, plan and payables.
- Cadastros gains an `areas` view (nav union + arrays + titleForView + render switch + navigation tests) with a simple table + dialog CRUD modeled on ClientsView/ClientDialog.
- Product dialog: área select (required) replaces the Tipo select; ProductsView shows an Área column instead of Tipo.
- statusMeta chips: Rascunho (neutral), Aberta (blue/info), Ganha (green), Perdida (red), Cancelada (gray).
- Dashboard: swap closed->won semantics, "Receita por produto" keeps working; KPI card labels updated ("Vendas fechadas" -> "Propostas ganhas"); no new funnel widgets in this feature.
- meus-dados reuses the same views read-only as today; row actions hidden outside admin workspaces.

### Testing contract
- Every slice names its oracle test(s) in the plan.
- `sale-wizard-ui-contract.test.ts` and other source-grep contract tests are updated deliberately to the new copy, never deleted.
- Ledger/transition logic gets unit tests on the pure functions plus integration tests under the existing RLS harness for the new tables/endpoints.
- `pnpm run lint`, `pnpm run type-check`, `pnpm test` and `pnpm --filter @fxl-sales/api test:integration` must stay green at every wave boundary.

## Slice index

| id | slug | scope | depends_on |
|---|---|---|---|
| 01 | areas-backend | areas table + seed migration + product.area_id + service CRUD + routes + bootstrap.areas | - |
| 02 | proposal-schema-backend | one migration for all remaining schema changes: sale statuses/won_at/lost_at + remap, receivables.method/status, payables.receivable_id, sale_items.area_id/snapshot, clients legal columns | 01 |
| 03 | proposal-write-backend | CreateSale v2 schema (installments[]/recurring/areas/free-form), createSale + update endpoint, buildSaleLedger rework, bootstrap.receivables | 02 |
| 04 | proposal-transition-backend | transition + cancel-contract endpoints, per-receivable payable materialization/void, won/lost timestamps | 03 |
| 05 | areas-web | cadastros/areas view + dialog, product dialog área select, ProductsView column, navigation + tests, CLAUDE.md routes line | 01 |
| 06 | proposal-wizard-web | wizard revamp: naming, 4 steps, plan builder, free-form items, recurring block, preview; payload v2; contract-test updates | 03, 05 |
| 07 | propostas-list-web | Propostas table + filters + row actions + detail view + statusMeta + dashboard/status sweep + sidebar CTA | 04, 06 |
| 08 | client-legal-web | client dialog legal fields | 02, 07 |

Web slices 05-08 all touch `apps/web/src/sales-ops/SalesOpsApp.tsx` and related shared files, so they never run in the same wave in parallel; the dependency chain makes them serial by design.
