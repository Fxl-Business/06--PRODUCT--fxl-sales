---
id: lead-lixeira
milestone: v4.6.0
run: 20261007T203517Z-lead-lixeira
mode: autopilot
---

# Excluir lead (lixeira restaurável com log) e contador real da coluna

## Request (from the human, WHAT approved in conversation on 2026-10-07)

"Precisamos ter um menu de contexto em cada card, para poder clicar nele e deletar, e também poder fazer isso dentro do Form. Mas de maneira segura, precisamos de Logs para o gestor ver quem deletou o que."
Decisions the human took (AskUserQuestion):
- Who deletes: gestor AND vendedor. A vendedor deletes only the leads he can see (his own and the unassigned pool); the gestor deletes any lead. Everyone is logged.
- Recoverable: a trash (lixeira). The lead leaves the board for everyone, the gestor sees it in the log and can restore it. Never a hard delete (the system's archive-never-delete rule).
- Where: a new screen in Cadastros, "Leads excluídos": who deleted, when, which lead and empresa, with a Restaurar button.
Also reported by the human: after importing 114 leads the column shows "100". Root cause found by the orchestrator: the board loads 50 leads per column per page and the column badge, the R$ totals, the Lista chips/footer and the Funil are computed from the LOADED leads only; 15 leads sit behind "Carregar mais leads" at the bottom of the page. That defect is fixed in this run too.

## Acceptance criteria (feature level)

- AC1 A card in the Quadro has a context menu (a kebab button on the card AND right-click on the card) with `Excluir`; opening it never starts a drag and never opens the edit form.
- AC2 The Lista row has an `Excluir` action beside `Mover` and `Editar`.
- AC3 The edit form (both the leads-edition contact dialog and the full-edition lead dialog) has an `Excluir lead` button in EDIT mode only.
- AC4 Every delete entry point asks for confirmation in an in-app dialog (never `window.confirm`) naming the lead, and only then deletes; cancel changes nothing.
- AC5 A converted lead (`saleId !== null`) cannot be deleted (no menu item, no button; the API answers 409).
- AC6 Delete is a soft delete: the lead disappears from the board, the Lista, the Funil, the counts and every lead read for everyone; the column stays densely numbered.
- AC7 A non-admin vendedor can delete exactly the leads he can read (own + unassigned pool when he is an active vendedor); anything else is 404. Deleting never claims a lead.
- AC8 Every delete and restore writes an immutable hash-chained `audit_log` entry in the same transaction, with the actor name snapshotted from the token.
- AC9 The gestor (admin) sees `Cadastros > Leads excluídos` in both editions: one row per deleted lead, newest first, with lead, empresa, etapa, vendedor, who deleted (`Autor não identificado` when unknown) and when; never a raw id.
- AC10 `Restaurar` (admin only) puts the lead back on the board in its etapa (or the first active open etapa when its etapa was archived), at the end of the column, and the row leaves the list. A non-admin gets 403.
- AC11 The column badge, the column R$ total and `% do total`, the Lista phase chips and footer total, and the Funil (both shapes) use the server's per-stage totals, so 115 leads read 115 even when only 100 are loaded.
- AC12 `CLAUDE.md` and the kanban reference are updated in the same change (capture).

## Out of scope (YAGNI)

- Bulk delete; purging the trash; deleting from `meus-dados` for an admin (an admin in the leads edition never sees meus-dados anyway).
- Showing deleted leads to vendedores.

## Slices

| id | goal | depends_on | wave |
| --- | --- | --- | --- |
| 01-api-lixeira | migration, soft delete + restore + deleted list, audit, every reader filters | - | 1 |
| 02-api-stage-summary | per-stage count and value endpoint, scoped like the list | 01 | 2 |
| 03-web-delete-ui | card menu, Lista action, form button, confirm dialog | 01 | 2 |
| 04-web-lixeira-screen | Cadastros > Leads excluídos with Restaurar | 01 | 2 |
| 05-web-board-totals | badge, totals, chips, Funil from the summary; summary invalidation | 02, 03, 04 | 3 |

The names every slice must use are fixed in `SEAM-CONTRACT.md` beside this file. It is authoritative: a planner that needs a different name stops and reports instead of inventing one.

## Environment notes for every agent

- Work ONLY inside your own worktree under `.worktrees/20261007T203517Z-lead-lixeira/`. Never cd into, write to or run git in the main checkout `/Users/cauetpinciara/Documents/fxl/projects/06--PRODUCT--fxl-sales`.
- Deps: `pnpm install --frozen-lockfile` and `pnpm run build:packages` in a fresh worktree; `apps/api/.env` is copied from the main checkout read-only (git-ignored). Integration tests use the local Postgres on 5006.
- Run-once commands only; kill every process you start.
- Never use the em dash character; use a plain dash. One sentence per physical line in long Markdown.
