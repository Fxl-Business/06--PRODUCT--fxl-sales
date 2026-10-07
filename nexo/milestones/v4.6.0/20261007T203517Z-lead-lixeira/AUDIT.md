# Autopilot audit - run 20261007T203517Z-lead-lixeira

## Decisions taken without the human
- WHAT came from the human's three answers in chat (gestor and vendedor delete; lixeira with Restaurar; log screen in Cadastros); the run proceeded in autopilot like the previous one, with no separate Gate 1 prompt.
- Deletion is a `POST /leads/:id/delete` action, because `salesOpsRouter` keeps having no `DELETE` verb; the lead is soft-deleted (`deleted_at`), never removed.
- The delete, restore and deleted-list code lives in a new `lead-trash-service.ts`, so `lead-service.ts` keeps its "no audit writes here" contract test unchanged.
- Restore has no confirmation (it loses nothing) and puts the lead at the end of its etapa, or of the first open etapa when its etapa was archived.
- The card's `...` trigger is always visible in light grey instead of appearing only on hover: a hidden button left an empty gap, and touch screens have no hover.
- The column count uses the larger of the server total and the cards already loaded, so a fresh card never shows a smaller number while the total refreshes.
- `apiFetch` now accepts a `204` with no body; this also fixes the finder link revoke, which already answered 204 and was failing on success.
- The board loads 100 leads per page (not 50 as first said in chat); the `Carregar mais leads (100 de 115)` label now says how many are still unloaded.
- The repo configures no mutation tool, so the feature-tier mutation pass closed `not_applicable`; every slice Verify ran targeted mutation probes instead (slice 04 failed its first Verify on two surviving mutants and passed after its oracle was strengthened).

## For you to test or decide
- [ ] TEST: in production after the deploy, delete one lead as a vendedor and restore it as the gestor in `Cadastros > Leads excluídos`.
- [ ] TEST: the Construbom board should read 115 in Lead Novo (not 100) once this is deployed; the remaining 15 still load with `Carregar mais leads (100 de 115)`.
- [ ] Migration `0028_lead_soft_delete` (three nullable columns, a CHECK and a partial index) runs at API container start; production API must be on this release for the trash to work.

## Ready to ship
- [ ] `/nexo-ship` - five slices on `master` (lixeira API + migration 0028, stage totals API, delete UI, Leads excluídos screen, real column totals).
