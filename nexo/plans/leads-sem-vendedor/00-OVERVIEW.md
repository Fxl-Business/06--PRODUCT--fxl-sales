---
id: leads-sem-vendedor
milestone: v4.4.0
run: 20261007T181210Z-leads-sem-vendedor
mode: autopilot
---

# Leads sem vendedor: visíveis a todos os vendedores, assumidos por quem mexer primeiro

## Request (verbatim from the human, Gate 1 approved in conversation)

Leads sem vendedor visíveis a todos os vendedores e assumidos por quem mexer primeiro (Prospecção, edição Leads e full).
Decisões do humano:
(1) um vendedor não-gestor vê os próprios leads MAIS os leads sem vendedor (seller_person_id IS NULL);
(2) quando um vendedor não-gestor MOVE ou EDITA (qualquer escrita) um lead sem vendedor, o lead passa a ser dele na mesma transação (seller_person_id = pessoa do chamador, snapshot do nome), com FOR UPDATE para que de dois vendedores simultâneos só o primeiro assuma e o segundo receba not_found;
(3) gestor (admin) que move/edita NÃO assume, o lead segue sem vendedor;
(4) o card de um lead sem vendedor mostra uma marca "Sem vendedor - disponível".

## Why

Construbom imports its prospect base (114 leads from the Vila Capixaba customer base) with NO vendedor on purpose.
The team works it as a shared pool: every vendedor sees the pool, and whoever acts on a lead first takes it.
Today a non-admin only ever sees `seller_person_id = <own pessoa>` (`listLeads`, `leadIdentityConditions` in `apps/api/src/domains/sales-ops/leads/lead-service.ts`), so an unassigned lead is invisible to every vendedor and unwritable by them.

## Acceptance criteria (feature level, testable)

- AC1 (list) A non-admin caller whose resolved pessoa is an ACTIVE vendedor (system função `vendedor`) gets, per stage, their own leads PLUS every lead with `seller_person_id IS NULL`, never another vendedor's lead. `total` counts exactly that set. `?sellerPersonId=` stays ignored for a non-admin.
- AC2 (read one) `GET /leads/:id` for that caller answers 200 for an own or unassigned lead and 404 `not_found` for another vendedor's lead.
- AC3 (claim on move) That caller moving an unassigned lead succeeds and, in the SAME transaction, sets `seller_person_id` to the caller's pessoa and `seller_name_snapshot` to that pessoa's server-side display name.
- AC4 (claim on edit) The same for every lead PATCH (`updateLead` full edition and `updateContactLead` leads edition). For a non-admin on an unassigned lead the body's `sellerPersonId` may be absent, `null` or the caller's own id (all claim); any other id answers `403 seller_scope` and writes nothing.
- AC5 (race) Two vendedores acting on the same unassigned lead: the first to take the row lock claims it; the second, blocked on `SELECT ... FOR UPDATE`, re-evaluates the predicate after the first commits and answers 404 `not_found`, writing nothing.
- AC6 (admin) An admin (gestor) moving or editing an unassigned lead never claims it: `seller_person_id` stays NULL unless the admin PATCH explicitly names a vendedor, exactly as today.
- AC7 (unchanged) A lead owned by vendedor A stays invisible and unwritable (404) for vendedor B. A converted unassigned lead is still read-only (`already_converted`) and a refused write never claims.
- AC8 (no vendedor função) A non-admin caller whose pessoa is NOT an active vendedor (e.g. finder-only in the full edition) keeps today's scope exactly: own leads only, no unassigned visibility, no claim.
- AC9 (web marker) A lead card whose `sellerPersonId === null` shows the marker text `Sem vendedor - disponível` (carrying `data-unassigned-lead`) in the seller footer, instead of the plain `Sem vendedor` avatar line; the Lista view's vendedor cell shows the same marker. A lead with a vendedor renders exactly as today.
- AC10 (docs) `CLAUDE.md` (Kanban de leads) and `nexo/knowledge/reference/kanban-de-leads.md` state the new scoping and claim rule in the same change.

## Out of scope (YAGNI)

- No new admin filter "Sem vendedor" in the vendedor picker.
- No audit_log entry for a claim (stage moves write nothing to audit_log, and the claim rides the same write).
- No change to lead CREATE rules (a vendedor still files only their own lead; leads edition still defaults to the caller).
- No schema migration: `seller_person_id` is already nullable.

## Slices

| id | goal | depends_on | wave |
| --- | --- | --- | --- |
| 01-api-claim | Server scoping + claim-on-write (AC1-AC8) | - | 1 |
| 02-web-marker | Card and Lista marker for unassigned leads (AC9) | - | 1 |

AC10 is written at Capture by the scribe from the merged diff.

## Environment notes for every agent

- Work ONLY inside your own worktree under `.worktrees/20261007T181210Z-leads-sem-vendedor/`. Another agent is working in the main checkout right now: never `cd` there, never write there, never `git add -A` there.
- A fresh worktree has no `node_modules` and no `apps/api/.env`. Run `pnpm install --frozen-lockfile` in the worktree, and copy `apps/api/.env` from the main checkout (read-only copy) before integration tests. Integration tests hit the local Docker Postgres on port 5006 through `TEST_DATABASE_URL` / `ADMIN_DATABASE_URL`.
- Run-once commands only (`vitest run`), never watch mode. Kill any process you start.
- Never use the em dash character in any file or message; use a plain dash.
