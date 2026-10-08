---
id: construbom-leads-ajustes
milestone: v4.7.0
run: 20261008T114022Z-construbom-leads-ajustes
mode: autopilot
---

# Construbom: valores no Kanban da edição Leads, card com Cliente, texto do campo de cliente e importação que reconhece clientes

## Request (from the human, WHAT approved in conversation on 2026-10-08)

"Vamos precisar liberar uma funcionalidade para o módulo da Construbom.
Mostrar a soma de valores no topo da coluna do Kanban (igual tem na versão normal).
Isso pode mudar para ambos: o que aparece direto no Kanban tem que ser Nome & Cliente, ao invés de Nome e contato como é hoje.
No input de cliente o texto deve ser 'Buscar ou criar novo', algo assim para ficar claro."

Then, mid-run: "Aproveite e já resolva isso: tive que apagar todo mundo e importar a mesma planilha de novo; ao invés dele já identificar os clientes já criados, ele deu esse monte de mensagem (342 avisos: 'Já existe um cliente chamado ... no cadastro', 'O documento ... já é do cliente ...'). Posso importar normalmente ou vai acabar duplicando?"

Decisions the human took (AskUserQuestion):
- Valor em R$ na edição Leads: igual à versão normal (topo da coluna com total, `% do total` e barra; valor no card; R$ nos chips e no rodapé da Lista).
- Card vs Lista: só o CARD troca o contato pelo Cliente. A Lista continua mostrando `telefone · email` abaixo do nome.
- Campo de cliente: edição Leads diz "Buscar ou criar novo cliente"; a versão normal, cujo seletor não cria cliente, diz "Buscar cliente cadastrado" (a regra "um lead da edição completa nunca cria cliente" continua).
- Importação, como reconhecer um cliente existente: pelo CNPJ/CPF; sem documento, pelo nome. Mesmo nome com documentos diferentes continua criando cliente novo, com aviso.
- Importação, cliente reconhecido: NÃO altera o cadastro existente, só reaproveita (a importação continua create-only).

Root cause of the import report, confirmed by the orchestrator in code: `planClientes` (`apps/api/src/domains/import/plan/cadastros.ts`) always emits `createClient` and only WARNS on a same-name or same-document client; `refs.ts` then sees two candidates (the existing client and the workbook row) for every empresa in the Leads tab and answers `ambiguous_ref`, so `planLeads` stores the empresa as free text with an `ambiguous_client` warning.
342 = 114 name warnings + 114 document warnings + 114 `ambiguous_client` warnings.
Committing that preview would create 114 duplicate clients and 114 leads linked to no client.

## Acceptance criteria (feature level)

Kanban, edição Leads (`fieldSet === 'contact'`):
- AC1 The Quadro column header shows the stage R$ total, `% do total` and the proportion bar exactly like the full edition, from the same summary-backed aggregates (`stageAggregate(aggregates, stage.id)`), with the same `data-stage-total` / `data-stage-bar` hooks.
- AC2 The card shows the contact name on top and, under it, the Cliente: the same resolution ladder as `leadCompanyLabel` (live cadastro name, then the snapshot), falling back to `Sem cliente` in the leads edition; never an id. The birthday line stays when present. The `telefone · email` line is no longer on the card. The estimated value sits on the right beside the `...` menu, formatted like the full card (0 decimals).
- AC3 The Lista shows R$ like the full edition: `Todas as fases` chip and every phase chip carry their R$, the footer shows `TOTAL` with the R$, and the table has a right-aligned `Valor estimado` column before `Ações`. The `Lead` cell still shows the name plus `telefone · email` (unchanged), and the `Aniversário` column stays. The empty-row `colSpan` matches the column count.
- AC4 The full edition board, card and Lista are unchanged.

Campo de cliente:
- AC5 Leads edition (`ContactLeadDialog`): the empresa picker's trigger placeholder AND its search field read `Buscar ou criar novo cliente` when inline create is wired (`onCreateClient` present); without it the copy never promises creation.
- AC6 Full edition (`LeadDialog`): the `Empresa (cliente cadastrado)` picker's trigger placeholder AND search field read `Buscar cliente cadastrado`; it still has no create row.

Importação (Clientes tab):
- AC7 A Clientes row whose document (digits only) equals an existing client's document (digits only) is RECOGNIZED as that client: no `createClient` operation and no `possible_duplicate` warning for that row.
- AC8 A Clientes row is also recognized by name (normalized like today) when exactly one existing client has that name AND there is no document conflict (the row has no document, or the existing client has none).
- AC9 Same name with two different documents is NOT recognized: the row creates a new client with a warning, as today.
- AC10 Every reference by the recognized row's name in the other tabs (Leads `Empresa`, Propostas cliente, any other client reference) resolves to the existing client, even when the existing client's stored name is spelled differently from the sheet; a re-import of the same Clientes + Leads workbook links every lead to its existing client with no `ambiguous_client` warning.
- AC11 Recognition never writes to the existing client (no UPDATE of any column).
- AC12 The preview tells the operator in ONE place (not one line per row) how many clients were recognized and will not be created; the Clientes count to create excludes them. Commit re-plans from scratch and applies the same recognition (never trusts the preview).
- AC13 `CLAUDE.md` (Importação por planilha, Kanban/Edição Leads bullets) and the matching `nexo/knowledge/reference/*.md` are updated in the same run (Capture).

## Out of scope (YAGNI)

- Recognizing existing Pessoas, Produtos or Leads on re-import (only Clientes was asked).
- Updating or completing an existing client from the sheet.
- Showing produtos on the leads-edition card (the leads edition stores none).
- Changing the Funil (it already shows R$ in both editions).

## Slices

| id | goal | depends_on | wave |
| --- | --- | --- | --- |
| 01-web-leads-board-parity | AC1-AC4: R$ in the leads-edition column header, card and Lista; card shows Nome & Cliente | - | 1 |
| 02-web-client-picker-copy | AC5-AC6: picker copy in both lead dialogs | - | 1 |
| 03-import-recognize-clients | AC7-AC12: the import recognizes existing clients instead of duplicating | - | 1 |

The three slices touch disjoint files and run in parallel in wave 1.
Slice 01 must not edit `contact-lead.ts` (slice 02 owns it); the leads-edition fallback `Sem cliente` and any new label live in `board-labels.ts`.

## Environment notes for every agent

- Work ONLY inside your own worktree under `.worktrees/20261008T114022Z-construbom-leads-ajustes/`. Never cd into, write to or run git in the main checkout `/Users/cauetpinciara/Documents/fxl/projects/06--PRODUCT--fxl-sales`.
- Deps: `pnpm install --frozen-lockfile` and `pnpm run build:packages` in a fresh worktree; `apps/api/.env` is copied from the main checkout read-only (git-ignored). Integration tests use the local Postgres on 5006.
- Run-once commands only (`vitest run`, never watch); kill every process you start, by PID or process group, never by name.
- Never use the em dash character; use a plain dash. One sentence per physical line in long Markdown.
