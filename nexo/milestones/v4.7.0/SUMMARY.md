# v4.7.0 - Construbom: valores no Kanban, cliente no card e importação que reconhece clientes

Tag: `v4.7.0` at `dac953a`
Cut: 2026-10-08
Flow: `/nexo-ship-prod-ready` (Gate 3 approved by the owner in chat, "Pode subir pra prod", as one approval for cut, staging and production)
Chain: `master == staging == production == dac953a`
Release-verify: PASS at `91a429c` by a separate agent (`RELEASE-VERIFY.md`); `dac953a` differs only in `nexo/state.json` (the gate-3 record).
Vercel Production deployment for `dac953a`: success.
The production API (AWS) is not observable from here; the import recognition is server-side.

## Accomplishments

- Run `20261008T114022Z-construbom-leads-ajustes`, 5 slices in 3 waves (3 requested, 2 inserted from defects measured in the browser).
- The leads-edition kanban shows R$ like the full edition: column header total, `% do total` and bar, the card value, the Lista chips, the footer `TOTAL` and a `Valor estimado` column.
- The leads-edition card shows Nome, then the Cliente on its own full-width row (`Sem cliente` when none), then the birthday; the Lista keeps `telefone · email`.
- The cliente picker reads `Buscar ou criar novo cliente` where inline create is wired and `Buscar cliente cadastrado` otherwise (`client-picker-copy.ts`).
- The spreadsheet import recognizes an existing cliente (`recognizeClientRows`, computed once inside `buildRefIndex`): it creates and writes nothing for it, links every other tab to it, and reports `recognized: { clientes: N }` in preview, commit and the `import.completed` audit, shown as one line.
  This fixes the Construbom re-import that previewed 114 duplicate clientes and 342 warnings.
- Layout: a `Combobox` with no match and a create row draws one divider; inline dialog buttons carry `self-stretch` and match the field height; `+ Adicionar item livre` never wraps.

## Key decisions

- Recognition is strict: document digits first (narrowed by name when several clientes share them, never a name fallback), otherwise exactly one same-name cliente whose document agrees with every same-name row of the tab; anything else is created with today's warning.
- A recognized cliente is never updated; the import stays create-only.
- Waves 2 and 3 were verified by one integrated full-suite run.

## Open items

- The import does not recognize leads already on the board; re-importing a Leads tab without deleting the leads first duplicates them silently (question asked to the owner).
- Web test output carries pre-existing React Router v7 future-flag and `act(...)` warnings in a few leads and dev-identity suites.
- Optional, carried: bound the board-lock wait with a `lock_timeout` during long imports; `Minha prospecção` subtitle copy.

References: `nexo/milestones/v4.7.0/RELEASE-NOTES.md`, `CLAUDE.md` `## Kanban de leads`, `## Edição Leads`, `## Importação por planilha` and `## UI Controls`.
