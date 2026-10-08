# E2E - construbom-leads-ajustes

Driven by the orchestrator in the real app: a detached checkout of the run branch, `SALES_AUTH_FAKE=1` API on 3006 and `VITE_AUTH_FAKE=1` web on 8006 (the `make dev-fake` pair), local Postgres on 5006, Chrome at 1440x900.
Started at `a146f13` (wave 1), moved to `67bed52` and `55d8adf` as slices 04 and 05 landed.

## Import, the Construbom report reproduced in the browser (leads edition, `leads-owner`)

- Workbook built from the real template (`GET /import/template`): Clientes tab with 3 clientes carrying a CNPJ (one 58-character name), Leads tab with 3 leads naming them, values R$ 125.000, R$ 48.500 and R$ 9.900.
- First import: preview `Clientes 3 / Leads 3`, no issue; commit created 3 clientes and 3 leads.
- Same workbook again: the Clientes row left the counts table, ONE line read "3 clientes da aba Clientes já estão no cadastro (mesmo CNPJ/CPF ou mesmo nome) e não serão criados de novo nem alterados; as outras abas usam os clientes existentes.", zero warnings (before the fix the same shape gave 3 warnings per row).
- Commit: "Importação concluída", Leads 3 created, "3 clientes da aba Clientes já estavam no cadastro e foram reaproveitados, sem alteração."
- Database check: each of the 3 clientes exists once, with its CNPJ; all 6 leads have `client_id` pointing at them.
- The leads themselves were NOT deleted before the second import, so the 3 leads now exist twice: the import does not recognize leads already on the board (out of scope; reported as a question).

## Kanban, leads edition

- Quadro: every column header shows the R$ total, `% do total` and the bar (Primeiro contato R$ 347.000 / 95%, Negociação R$ 19.800 / 5%).
- Card: name, Cliente (or `Sem cliente`), birthday when present, value beside the `...` menu.
- Defect found at `a146f13`: the Cliente line shared the width with the value column and was cut (`VILLA CONSTRUTORA L...`) next to blank space; fixed by slice 04 and re-checked at `67bed52` (full name on one line, the 58-character name on two lines with an ellipsis).
- Lista: chips carry R$, `Valor estimado` column right-aligned, footer `Todas as fases · 12 leads` with `TOTAL R$ 366.800`; the Lead cell keeps `telefone · email`.
- `leads-seller` on `meus-dados/leads`: same R$ chrome over the vendedor's own scope.

## Cliente picker

- Leads edition: trigger and search read `Buscar ou criar novo cliente`; a new name offers `+ Criar novo cliente "..."`.
- Defect found (pre-existing, `Combobox`): two divider lines 8px apart above the create row when nothing matched; fixed by slice 04, re-checked: one divider.
- Full edition (`team-owner`): trigger reads `Buscar cliente cadastrado`, no create row.

## Lead dialogs

- Defect found (pre-existing, full edition): `+ Adicionar item livre` wrapped to two lines (55px tall next to a 42px field) and `Produto não cadastrado` sat 6px under the produtos row; fixed by slice 04.
- Defect found (pre-existing, both editions): `Limpar` and `Adicionar` rendered 36px next to 42px fields; fixed by slice 05, re-measured at `55d8adf`: every inline button equals its field (44.0 vs 44.0 in the leads dialog, 41.8 vs 41.8 in the full dialog at the page zoom).

## Not covered

- A real 390px viewport: the window resize did not apply in this Chrome session; the Quadro columns have a fixed width, so the card layout is the same on a phone.
- Full edition card with a long company name (unchanged code path, AC4).

## Cleanup

- Dev servers stopped by process group (API 641, web 642); ports 3006 and 8006 free; the Chrome tab closed; the dev-identity keys removed from localStorage; the E2E checkout and its throwaway workbook removed.
- Left in the local dev database (`org_fake_leads`): the 3 test clientes and 6 test leads.
