# PLAN-CHECK - edicao-leads

Checker: plan-check agent (separate from the eight planners).
Inputs: `00-OVERVIEW.md`, `SEAM-CONTRACT.md` (section 6 amendments authoritative), slices 01 to 08.
Execution order (serial, each slice on its own branch off the then-current master): 01, 03, 02, 05, 04, 08, 06, 07.
Verdict: PASS after the corrections below, all applied in place to the slice plans (binding).

## Coverage of the feature goal and AC1 to AC7

- AC1 (FXL unchanged): 01 (fail-to-full resolver), 02 (gate map with full-edition pass over every route, missing edition is full), 04 (full schemas and call arity byte-identical), 05 (literal full-edition navigation tables), 06 (innerHTML-equality oracles), 07 (full PessoasView oracle).
- AC2 (navigation): 05, with D-05-1 kept (an admin in the leads edition does not see `meus-dados`).
- AC3 (API 403 `edition_capability`, open reads work): 02.
- AC4 (empty board, refusal until an etapa exists): 04 (reuses `400 reason no_open_stage`, per A1) plus 06 (empty-state, inline notice keyed on 400 plus reason).
- AC5 (contact dialog, card, list): 06.
- AC6 (dev-fake roster, fixture org, browser): 08 (roster, seed) plus the end-to-end browser check now owned by 07, the last slice.
- AC7 (playbook): 08.

Gated READ audit (item 1): grepped every `/api/v1` call and every `useQuery` / `useInfiniteQuery` in `apps/web/src`.
The sales-ops shell fires only `GET /bootstrap` on mount; `GET /history` runs only inside `CadastroHistorySection` (Geral view, invisible in the leads edition); `GET /sales/:id/settlements` runs only inside the proposta detail (no `vendas` view in the leads edition); import calls run only on `importacao`.
The Etapas screen reads only `/lead-stages`; the leads board only `/leads` and `/lead-stages`; the Pessoas screen reads funções from the bootstrap payload, never `GET /funcoes`.
The only gated WRITE reachable from those screens in the full UI is `PersonDialog`'s inline função create (`POST /funcoes`), and slice 07 replaces that dialog with `VendedorDialog` (no Combobox, no create) in the leads edition; `ContactLeadDialog` has no `onCreate`.
Result: no missing gate fix; nothing reassigned.
Known, accepted and out of scope: the legacy trees `/seller/*`, `/finder/*`, `/admin/*` are untouched and would show their own error handling for an `edition_capability` 403 if a leads-edition user typed those URLs.

## Corrections (binding, applied in place)

- C1 (A2, slice 04): `ContactLeadFieldsSchema` now normalizes `''` to `null` and accepts `null` for `description` (trim, max 4000, `blankToNull`) and `sellerPersonId` (`z.preprocess('' -> null, uuid.nullish())`), not only the three contact fields; oracle 6a case 3 extended to all five keys and to the update schema.
- C2 (A3, slice 04): `planPersonFuncoesForEdition` in the leads edition returns `{ kind: 'unchanged' }` for an UPDATE that carries no função key (status-only Inativar / Reativar, name-only edit) and `[vendedor]` otherwise, always before `planPersonFuncoes`, so empty `funcaoIds` never answers `funcao_required`; new integration case 12a (empty `funcaoIds`, status-only PATCH keeps the same person_funcao row) and route case 7; acceptance and verifier_focus updated.
- C3 (A1, slice 06): every `409` / `no_stage` reference replaced by `400` plus `reason === 'no_open_stage'`; `apiFetch` drops `reason` today, so 06 adds an optional `reason` to `ApiError` in `apps/web/src/lib/api-client.ts` (set only when present) with a new oracle `apps/web/src/lib/__tests__/api-client-reason.test.ts`; `contactLeadSaveErrorCopy` stays a structural check (no `@/lib/api-client` import, board-write-surface rule); tests and acceptance updated.
- C4 (A5, slice 05): new Step 7g adds `useSalesEdition: () => 'full'` to all 24 existing `vi.mock('@/auth/react')` factories (enumerated, all added to `files_modified`; `leads-routing` and `no-role-redirect` return `profileEdition ?? 'full'`), plus a durable guard `apps/web/src/auth/__tests__/auth-mock-edition-export.test.ts` (non-vacuous, at least 24 files); rule and downstream seam notes rewritten.
- C5 (A5, slice 06): Step 10 no longer edits existing mocks; it relies on slice 05's additions and the guard; code facts updated.
- C6 (edition read, slice 07): `SalesOpsApp` reads the edition only through slice 05's `const edition = profile.edition;` (shell rule, test-mock safe); Step 3 rewritten as a precondition with a STOP, every `salesEdition === 'leads'` became `edition === 'leads'`, the contradicting rule ("only through useSalesEdition") replaced.
- C7 (A4, slice 07): the Vendedores screen lists inactive vendedores last, muted, with an `Inativo` badge and a `Reativar` action (status-only PATCH to `active` through `changeCadastroStatus`, no confirmation); new `onReactivate` prop and mount wiring; inactivate copy now points to this screen for a restore; view, routing oracle (cases 6 and 7) and reference text updated; the old "open product question" line removed.
- C8 (overlap, slice 08): the `/probe` `salesEdition` key (already added by 02) and the `Probe` edition change (already made by 05) are no longer re-applied; a duplicate object key would be a TypeScript error.
- C9 (A1 wording): `00-OVERVIEW.md` AC4 and the slice table, and slice 02's out-of-scope line, now name the reused `no_open_stage` refusal instead of `no_stage`.
- C10 (rule docs, slices 02, 04, 07, 08): `CLAUDE.md` is edited by exactly two slices: 02 (Auth Model access-gate lines, where the rule moves) and 07 (last in serial order: one consolidated `## Edição Leads` section, a leads bullet under Sales Ops Routing, and the dev-identity bullet moved out of 08). 08 dropped `CLAUDE.md` from `files_modified`; 04's note points to 07. Reference files stay with the slice whose rule moves (02 auth-model, 04 kanban + pessoas, 05 sales-ops-routing, 06 kanban on top of 04, 07 pessoas on top of 04, 08 development-identity-mode).
- C11 (rule docs, slice 06): adds its UI rules to `nexo/knowledge/reference/kanban-de-leads.md` under slice 04's section (was missing).
- C12 (settings, slice 08 and 05): decided NO default settings row for the leads fixture org; every consumer already handles `null` (`GET /settings` answers `{settings:null}`, bootstrap `settings[0] ?? null`, web type `SalesOpsSettings | null`, `activeSettings()` defaults), the leads edition never writes settings (`PUT /settings` gated), and slice 05's shell test now renders the leads edition with `settings: null`.
- C13 (A6, slices 05, 06, 07): `pnpm run build:packages` is the first command of 05 (was a shared-utils-only build), 06 and 07.
- C14 (AC6, slice 07): 08 runs before 06 and 07, so the end-to-end `make dev-fake` browser check (both leads identities, Vendedores inactivate and reactivate, contact lead, FXL control) is added to 07, with the process-group kill.
- C15 (em dash, slice 04): `kanban-de-leads.md` carries three pre-existing U+2014 characters; slice 04, which edits that file first, replaces them with ` - `.

## Checks that passed without change

- Seam names are consistent across all plans: `salesEdition`, `requireCapability`, `EDITION_CAPABILITY_BODY`, `ContactLeadFieldsSchema`, `createContactLead` / `updateContactLead`, `useSalesEdition`, `profile.edition`, `leadFieldSet`, `FIXTURE_LEADS_EDITION_ORGANIZATION_ID`, `leads-owner` / `leads-seller`, the trailing `edition` parameter on every navigation function, and `canSettleInWorkspace` (05 adds its `edition` parameter).
- Slice-local names (`getSalesOpsWorkspaces`, `PersonWriteOptions`, `fieldSet`, `LEADS_EDITION_MODULE`, `VENDEDORES_COPY`) are not consumed across slices except as documented in the consuming slice's own plan.
- A7: slice 03 is second in serial order, before any other `test:integration` run.
- A8: slice 04 services take the edition as an explicit argument from the route.
- Every slice names an oracle, has a testable acceptance, uses run-once commands only (`vitest run`, `node --test`, package `test` scripts that are `vitest run`), and no plan file contains U+2014.
- Slice 05's product decision (an admin in the leads edition does not see `meus-dados`) is kept.

## WHAT questions

None.
