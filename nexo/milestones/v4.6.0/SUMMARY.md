# v4.6.0 - Lixeira de leads e totais reais da coluna

Tag: `v4.6.0` at `7d468e4`
Cut: 2026-10-07
Flow: `/nexo-ship-prod-ready` (Gate 3 approved by the owner in chat as one approval for cut, staging and production)
Chain: `master == staging == production == 7d468e4`
Release-verify: PASS at `9bc47c9`; `7d468e4` differs only in `nexo/state.json` (the gate-3 record).
Vercel Production deployment for `7d468e4`: success.

## Accomplishments

- Lead trash (run `20261007T203517Z-lead-lixeira`, 5 slices in 3 waves): a soft delete through `POST /leads/:id/delete`, restore and the deleted list behind `requireAdmin`, `lead.deleted` and `lead.restored` audit entries in the same transaction.
- Excluir from the card menu (also right-click), the Lista and both edit forms, always through one in-app confirmation; a converted lead cannot be deleted.
- `Cadastros > Leads excluídos` for the gestor in both editions, with who deleted, when, and `Restaurar`.
- The column badge, R$ totals, Lista chips and footer and both Funil shapes read `GET /leads/summary`, so 115 leads read 115 when 100 are loaded.
- `apiFetch` accepts a 204 with no body, which also fixes the finder link revoke.

## Key decisions

- Soft delete instead of a hard delete, consistent with archive-never-delete; the code lives in `lead-trash-service.ts` (`nexo/knowledge/decisions/2026-10-07-lead-trash-soft-delete.md`).
- A vendedor deletes what he can read and never restores; the gestor deletes any lead and is the only one who restores.
- The column count is the larger of the server total and the loaded cards, so it never shows less than the screen.

## Open items

- Construbom still needs the Hub module grant `sales.edition.leads` (carried from v4.4.0).
- Optional: bound the board-lock wait with a `lock_timeout` during long imports.
- Copy: `Minha prospecção` still says "Seus leads em negociação" although it also lists the unassigned pool.

References: `nexo/milestones/v4.6.0/RELEASE-NOTES.md`, `CLAUDE.md` `## Kanban de leads` and `## Arquivamento e histórico`.
