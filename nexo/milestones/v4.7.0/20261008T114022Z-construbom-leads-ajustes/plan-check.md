# Plan check: construbom-leads-ajustes

Checker: plan-check sub-agent (separate from the three planners), read-only, worktree at `b3ceab7`.
Inputs: `nexo/plans/construbom-leads-ajustes/00-OVERVIEW.md`, `01-web-leads-board-parity.md`, `02-web-client-picker-copy.md`, `03-import-recognize-clients.md`, plus spot checks of every cited code location.

## Verdict

PASS.
The three slices can be executed as-is in one parallel wave.
No required fixes.

## 1. Coverage of AC1-AC13

| AC | Slice | Proving tests |
| --- | --- | --- |
| AC1 column R$ total, `% do total`, bar | 01 | `leads-contact-board.test.tsx` "stage R$ total ... from the loaded cards" and "from the server summary" (`data-stage-total`, `data-stage-bar` width) |
| AC2 card Nome & Cliente, birthday, no contact line, value beside menu | 01 | `leads-contact-board.test.tsx` Quadro REPLACE/NEW cases, `contact LeadCard header` describe, `board-labels.test.ts` `leadClientLabel` cases |
| AC3 Lista R$ chips, footer TOTAL, `Valor estimado` column, contact line kept, colSpan 7 | 01 | `leads-contact-board.test.tsx` Lista REPLACE/NEW/EDIT cases incl. summary-driven chips and footer |
| AC4 full edition unchanged | 01 | new full-edition guards in `leads-contact-board.test.tsx` plus unedited `leads-full-edition`, `lead-board-totals`, `leads-board-columns`, `leads-list-view` |
| AC5 leads picker copy | 02 | `contact-lead-dialog.test.tsx` with and without `onCreateClient`, `client-picker-copy.test.ts` |
| AC6 full picker copy, no create row | 02 | `lead-dialog.test.tsx` new copy test with the create-row check |
| AC7 recognition by document | 03 | `client-recognition.test.ts` 2, 8, 9, `cadastros.test.ts` NEW recognition case, `refs.test.ts` |
| AC8 recognition by name without document conflict | 03 | `client-recognition.test.ts` 3, 4, 5, 10, 11 |
| AC9 same name, different document not recognized | 03 | `client-recognition.test.ts` 6, 10, `cadastros.test.ts` deliberate rewrite, `refs.test.ts` "keeps an unrecognized same-name row ambiguous" |
| AC10 references resolve to the existing cliente | 03 | `refs.test.ts`, `plan-leads.test.ts`, `plan-propostas.test.ts` new cases, integration tests A and B |
| AC11 never writes the cliente | 03 | integration tests A and B compare every `sales_ops_clients` column before and after commit |
| AC12 one summary line, counts exclude, commit re-plans | 03 | `plan-index.test.ts`, `executor.integration.test.ts`, integration test A (preview and commit bodies, audit), `import-view.test.tsx`, `import-copy.test.ts`, `issues.test.ts` |
| AC13 docs | Capture | handoffs in all three slices; slice 03 gives exact `CLAUDE.md` and `importacao-por-planilha.md` wording |

Every AC1-AC12 has at least one test that fails at `b3ceab7` and passes after the slice, or a guard that pins the unchanged behaviour.
The only workbook client references are Leads `Empresa` and Propostas `Cliente` (`workbook-schema.ts:173,188`), so AC10 "any other client reference" is fully covered.

## 2. Acceptance and oracle lists

Each slice's `acceptance` entries are concrete DOM, body or row assertions, and each is backed by a named test in that slice's `oracle` list.
Cited helpers exist with the stated shapes: `renderBoard` overrides, `required`, `LOOKUPS`, `clientTrigger`, `comboboxSearch`, `escape`, `typeInto`, `renderDialog` override spreading, `validatedWith`, `okPreview`, `importButton`, `richCatalog`, `seededCatalog`, `workbook`, `IDS.clientPadaria`, `IDS.padaria`, `sale`, `one`, `headerRow`, `buildXlsx`.
Arithmetic in the new fixtures checks out (33%/67% from loaded cards, 97%/3% from the summary because `resolveStageAggregates` keeps the server row while the loaded count is not higher; 8 warnings as the Red evidence of the import bug).

## 3. Fidelity to the human decisions

- The Lista keeps `telefone · email` under the name (slice 01 keeps `[data-row-contact]` and asserts the client name is NOT in the Lead cell).
- Only the card swaps contact for Cliente (slice 01).
- The full edition board, card and Lista are unchanged (slice 01 full branch textually untouched plus guards).
- The full-edition picker has no create row and reads `Buscar cliente cadastrado` (slice 02).
- Recognition never UPDATEs a cliente and emits no operation for a recognized row (slice 03 D-R4, AC11 test).
- Same name with different documents is not recognized and still warns (slice 03 D-R2 rule 2 with the tab-wide document agreement).
- No plan reopens or contradicts a decision.

## 4. files_modified and disjointness

The three `files_modified` sets are pairwise disjoint, and no slice edits a file that another slice lists as an oracle.
Shared modules checked:
- `contact-lead.ts` is edited only by slice 02 (deletes `clientPlaceholder`, read only by `ContactLeadDialog.tsx:202`); slice 01 reads `CONTACT_LEAD_COPY.birthdayPrefix`, `CONTACT_LIST_HEADERS` and `leadContactLine`, which stay.
- `board-labels.ts` is edited only by slice 01.
- `board-write-surface.test.ts` is edited by nobody; both web slices only run it, and neither adds a transition call, a write path, a quoted `'converted'` or an inline `kind ===`.
- `lead-delete.test.tsx`, `leads-full-edition.test.tsx` and `leads-contact-container.test.tsx` are run by both web slices and edited by neither; none of them queries the old picker strings or the contact card line.
- Every routing test that touches leads (`leads-routing`, `vendedores-routing`, `sale-deep-link`, `no-role-redirect`, `import-routing`) mocks `LeadsBoardContainer`, so the board changes cannot reach them.
- Slice 03 lists every API test literal the required `ImportPlan.recognized` and the new `ImportRefIndex.recognizedClient` member force to change (`executor.test.ts`, `executor.integration.test.ts`, `plan-index.test.ts`, `plan/__tests__/desfechos.test.ts`); no other `ImportPlan` or `ImportRefIndex` literal exists in `apps/api`.

## 5. depends_on

All three slices have `depends_on: []` and run in wave 1, consistent with the overview table.

## 6. Repo rules

- No em dash character in any plan, snippet or new pt-BR string; slice 03's new Leia-me lines satisfy `template.test.ts` (one sentence, final period, no `[.!?]\s+[A-ZÀ-Ý]`).
- UI identifiers: every client label goes through `leadClientLabel` / `leadCompanyLabel`; raw-id tests now include the client id.
- `useInlineLayer`: the picker is the existing `Combobox` (already calls it); slice 02 adds Escape tests inside the REAL `Dialog` with the bare-Escape positive control.
- Import create-only wording: slice 03 replaces the Leia-me line that became false and hands exact `CLAUDE.md` and reference wording to Capture.
- `liveLeadCondition` and "never trust ids from bodies": not touched; slice 03 takes nothing from bodies and reads no leads.
- Run-once: `vitest run` and `test:integration` (`VITEST_INTEGRATION=1 vitest run`) only; the two visual checks kill their servers by process group.

## 7. Open decisions left to the executor

None that change behaviour.
Each plan gives exact code, exact strings, exact test cases and the implementation order.

## Non-blocking suggestions

1. Slice 03 D-R7 ends with "the recognized line sits right above the button", which contradicts its own JSX and test (the line sits right under the counts table and must follow `[data-import-counts]`); the executor should follow the JSX and test.
2. Slice 02's constraints say slice 01 "owns" `board-write-surface.test.ts`; nobody edits it, so this is wording only.
3. Capture applies three `CLAUDE.md` handoffs that shift line numbers; anchor each edit by its text, not by line 386/395.
4. Capture may add that the board R$ in the leads edition is not "full-product chrome" (the `Edição Leads` capability bullet), and that the Kanban bullet "Creating a lead never creates a cliente" is a full-edition rule (the leads edition creates one inline, now announced by `Buscar ou criar novo cliente`).
5. Slice 03 edge: a recognized row skips the in-sheet duplicate bookkeeping, so a non-recognized row that reuses its sheet name gets no in-sheet name warning; lead references to that name still raise `ambiguous_client`, so nothing is silent.
6. Slice 03 edge: a recognized row skips `ClientSchema` validation of its optional columns because nothing is written; parser-level errors still block the commit.
7. Slice 03 could add one assertion that a cliente created between preview and commit changes the commit's `recognized` count, to prove AC12's "never trusts the preview" directly; the existing re-plan test plus test A step 6 already cover it indirectly.
