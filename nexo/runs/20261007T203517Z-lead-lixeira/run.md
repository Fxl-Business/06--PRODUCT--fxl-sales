# Run record: lixeira de leads

Run id: `20261007T203517Z-lead-lixeira`
Mode: autopilot, milestone v4.6.0, integrated on `feat/20261007-00-run`.
Plan: `nexo/plans/lead-lixeira/00-OVERVIEW.md`.

## Request

"A menu on each card to delete, and also inside the form, but safely, with logs so the gestor sees who deleted what."
The human also reported that after importing 114 leads the column shows 100.
Answers to the three questions:
- Who deletes: gestor and vendedor; a vendedor only the leads he can see, the gestor any lead, everyone logged.
- Recoverable: a trash (lixeira) the gestor can restore from, never a hard delete.
- Where: a new Cadastros screen, `Leads excluídos`, with who, when, which lead and `Restaurar`.

## Slices

| Slice | Slice commit | Merge | What |
| --- | --- | --- | --- |
| 01-api-lixeira | ad74ef0 | d8ccf14 | Migration 0028, soft delete, restore and deleted list in `lead-trash-service.ts`, `liveLeadCondition()` on every lead query |
| 02-api-stage-summary | 8eaab95 | 994e259 | `GET /leads/summary` per stage count and exact sum |
| 03-web-delete-ui | 92b55d9, 29b5db1 | 79e59a4 | `...` menu, right-click, Lista and form `Excluir`, `LeadDeleteDialog`, 204 in `apiFetch` |
| 04-web-lixeira-screen | c246951, ea3aea1 | f4f9c6a | `Cadastros > Leads excluídos` with Restaurar (second commit is the retry) |
| 05-web-board-totals | 7e46146 | e597739 | Badge, totals, Lista and Funil from the summary, `Carregar mais leads (N de M)` |

## Verify

- Slice 01: integration 3 files 26/26 twice, unit 4 files 260/260; regression 140/140 integration and 425/425 unit; mutant removing `liveLeadCondition()` turned 3 red; PASS.
- Slice 02: oracle 9/9 twice, unit 247/247; 2 mutants killed; regression 78/78 and 374/374; PASS.
- Slice 03: 5 files 60/60 twice; 3 mutants killed; full web 125 files, 1628 tests; PASS.
- Slice 04: first Verify FAILED, two mutants survived (restore cache removal and narrowed invalidation masked each other); after the retry 6 files 221/221 twice, 4 mutants killed, full web 124 files, 1631 tests; PASS.
- Slice 05: 12 files 141/141 twice; 4 of 4 mutant groups red; full web 127 files, 1699 tests; PASS.
- Wave 1 (d8ccf14): lint, type-check, unit (api 1448, web 1601, node:test 91), integration 50 files 391 tests, build and audit green.
- Wave 2 (f4f9c6a): unit (api 1454, web 1658), integration 51 files 400 tests, build and audit green.
- Wave 3 (e597739): cold build, lint, type-check, unit (api 1454, web 1699, node:test 91), integration 51 files 400 tests, audit with no high advisories (1 low, 12 moderate, pre-existing); no new em dash; PASS.
- Feature-tier mutation testing: no tool is configured, so it closed `not_applicable`; each slice ran targeted mutant probes.

## E2E

`make dev-fake` on `org_fake_leads` (leads edition): the vendedor opened the `...` menu, confirmed `Excluir lead` and the card left with the badge 2 to 1; the edit form offered `Excluir lead` and Escape closed only the confirmation.
The gestor saw `Cadastros > Leads excluídos` with the deleter and São Paulo time, restored the lead into `Primeiro contato`, and `audit_log` held `lead.deleted` and `lead.restored`.
The `Carregar mais leads (N de M)` label was not exercised in the browser (needs more than 100 leads), only by the slice 05 oracle.
Details: `e2e.md`.

## Decisions

- Delete is `POST /leads/:id/delete` and a soft delete; the code lives in `lead-trash-service.ts`.
- A vendedor deletes what he can read and never restores; delete takes `lockLeadBoard` and renumbers.
- The column count is the larger of the summary and the loaded cards.
- `apiFetch` accepts a 204, which also fixes the finder link revoke.
- The planners shared one worktree, so two plan-check agents verified the plans against the integrated state.
- Decision record: `nexo/knowledge/decisions/2026-10-07-lead-trash-soft-delete.md`.
- Rules: `CLAUDE.md` (Arquivamento e histórico, Kanban de leads) and `nexo/knowledge/reference/kanban-de-leads.md`.

## Audit

`AUDIT.md` lists the autopilot decisions and the open items: test delete and restore in production, check the Construbom column reads 115, and migration 0028 running at API start.
