# Plan check - 20260924T013019Z-finance-prereqs

## Verdict

PASS.
After the reconciliation edits below, the nine plans agree with each other and with the updated shared contract in `00-OVERVIEW.md` (every resolved clause is marked `RESOLVED by plan-check`, plus the new decision H7).
No blocking issue remains.
Execution stays strictly serial 01 to 09, each slice built from master after the previous one merged.

## Disagreements and resolutions

1. C2 reducer names.
   Resolution: slice 02's Finance names are the contract: `reduzirLiquidacao({ valorOriginalCentavos, eventos })`, events `{ id, tipo, estornaBaixaId, data, valorCentavos }`, output `{ pagoCentavos, abertoCentavos, dataUltimoPagamento, baixasAtivas: BaixaEvento[] }`, no `quitado`, and it throws `LiquidacaoErro` on a malformed history.
   Slice 04 now uses `eventoDeSettlement` + `temBaixaAtiva` (the amount map `ledgerAmountsById` and the reducer renaming were dropped).
   Slice 06 dropped its adapters (`toLiquidacaoFacts`, `reduceRow`, `nextCachedStatus`) and now calls `validarNovaBaixa`, `validarEstorno`, `statusCacheDaLinha`, `eventoDeSettlement`, `reduzirLiquidacao` directly, so there is one rule, not two.
   The API imports the subpaths `/liquidacao` and `/sao-paulo-day`, never the package root.
   Slice 08 does not reduce; it only reads the `paidOn` the server computed and uses the "no estorno points at it" rule to choose which baixa `Estornar` targets.
2. `removed_at` on sale items and professionals.
   Resolution: slice 03 adds both columns in its single `0024` migration and in `schema.ts` (with a contract-test assertion and a doc line).
   Slice 04 dropped `0025_sale_line_removed_at.sql`, the `_journal.json` edit and the `schema.ts` edit from `files_modified` and its design; it keeps every `removed_at IS NULL` reader and the soft-removal writer.
3. Recurring ids.
   Confirmed identical field `recurring.receivableIds`, index `i` = cycle `i + 1`, stored non-void `M` rows sorted by due date.
   One real conflict was found and fixed: slice 05 sent the whole list after a `Número de ciclos` decrease, which slice 04's `recurring_ids_exceed_cycles` refuses with 400.
   `payloadReceivableIds(ids, cycles)` now sends at most `cycles` ids (none for indefinite), with a new unit test and a new wizard assertion; the API voids every live `M` row not listed.
4. `PUT /sales/:id` on a won sale.
   Resolution: "won stays won" is accepted; `draft|open -> won` and `won -> draft|open` through PUT answer `409 invalid_status_change`; `lost|cancelled` answer `409 sale_not_editable`.
   Slices 04 and 05 and C4 now say the same thing.
5. Error body `rows` on the web.
   Resolution: slice 05 owns the change and adds a typed `ApiError.rows?: ApiErrorRow[]` (`{ kind, id, label }`), filled in `apiFetch` and `apiFetchBlob` only from `body.rows`; the generic `ApiError.body` idea was replaced so no other body field is echoed.
   Slice 08 removed `api-client.ts` from its files, its own `ApiErrorRow` / `LedgerLockRow` types and its duplicate test, and imports slice 05's type.
6. 409 row label shape.
   Resolution (C5): receivable = stored label (`2/3`, `M1/12`); payable = `<beneficiaryName> (<receivable label>)` or `<beneficiaryName>` alone.
   Slice 04 exports the only implementation (`receivableRowLabel`, `payableRowLabel` in `ledger-reconcile.ts`); slice 06 reuses them for `sale_has_active_settlements` and its integration expectations changed from `Parcela 1/2` / `Vendedor: Ana Martins - parcela 1/2` to `1/2` / `Ana Martins (1/2)`.
   Slice 05's copy reads `A parcela 2/6 ...` and `A conta a pagar Ana Martins (2/6) ...`; slice 08 prefers the bootstrap description and falls back to `Parcela <label>` / the payable label, never an id.
7. Settlement history shape.
   Resolution (C6): `GET` answers `{ settlements: SettlementEntry[] }` with `id, saleId, targetKind, receivableId, payableId, type, reversesSettlementId, reversedBySettlementId, paidOn, amountBrl, origin, actorName, recordedAt, reason`; POSTs answer `201 { settlement, row }`.
   `actor_user_id` is never projected, so slice 08's `SalesOpsSettlement` no longer declares `actorUserId` (its "never renders the account id" test now injects the key by cast, as a leak simulation).
   Slice 06 dropped `targetId`, `targetLabel` and its `settlementTargetLabel` / `PAYABLE_KIND_LABEL` (a second label vocabulary) and gained a key-list assertion.
8. Composite FKs and lock order.
   Slice 06 copies `sale_id` from the target row (asserted in its first integration test).
   Lock order resolved in C6: every ledger writer locks the sale first; `updateSale`, `transitionSale`, `cancelContract` take it `FOR UPDATE`, settlement writes take it `FOR SHARE` then the row `FOR UPDATE`.
   Slice 04's D6 and security note were changed from "the same FOR UPDATE lock" to this rule, so 04 and 06 agree.
9. Dev seed.
   Resolution: slice 03 alone owns it (synthetic baixa per seeded paid row, replica-mode delete before re-seed).
   Slice 08 dropped its seed deviation and "known seed gap"; its browser check now expects the seeded paid parcela to show `Pago em` and `Estornar`.
   Slices 04 and 06 now call slice 03's `deleteSettlementsForOrgs` for integration cleanup instead of their own replica-mode SQL.
10. `now` parameter.
    Slice 04 and 06 now state they keep slice 01's trailing `now` on `transitionSale` / `cancelContract`; slice 06's leave-won guard is placed "after `canTransition`, before any write" (there is no `const now` left after 01).
    The revision bumps on the revert and on `cancelContract` are slice 04's (D7); slice 06 no longer plans them a second time.
11. Two error components.
    Resolution (new H7): one page-level surface, slice 07's `MutationErrorBanner`; slice 08 drops `SaleActionErrorNotice`, the `actionError` props on `SalesView` and its rewiring of transition / cancel-contract, and instead adds an optional `lines` prop to the banner fed by `lockedRowLines`.
    Dialog-local errors stay local (slice 05 wizard, slice 08 dialogs).
    All 403 copy is `MUTATION_ERROR_COPY.adminRequired`: slice 07 now definitively edits slice 05's `describeSaleSaveError` 403 branch (files and oracle added), and slice 08's `settlementErrorMessage` uses it too.
12. Duplicate edits across serial slices.
    Checked: `Leaving won` doc bullet only in 06; `useCancelSalesOpsContract` stale comment only in 08 (04's out-of-scope note corrected); revert/cancel revision bumps only in 04; `api-client.ts` only in 05; seed only in 03; `removed_at` DDL only in 03; shared-utils `index.ts` / `package.json` get two distinct entries (01, 02).
    Additionally fixed: slice 08 no longer re-creates a civil-day formatter; `formatCivilDay` is an alias of slice 01's `displayDate`.

## Other fixes applied

- Oracle commands: `pnpm --filter @fxl-sales/api test:integration -- <files>` forwards a literal `--` (verified with pnpm 10), and vitest 3.2.7's cac puts everything after `--` into `options['--']`, so the file filters were silently ignored and the whole suite ran.
  All occurrences in 01, 03 and 04 were rewritten to `test:integration <files>` (06 already used that form).
- Dependencies: slice 07 edits slice 05's `sale-save-error.ts`, so `07.depends_on` is now `[05-wizard-row-ids, 06-settlements-api]` (overview table updated).
- Coverage oracles added: slice 04 `a counterparty change bumps the revision of the affected payables` (acceptance 8's counterparty clause); slice 06 source guard `settlements.ts writes only manual facts and holds no integration code` (acceptance 13).
- Slice 04 exports `type Db` from `service.ts` (needed by `settlement-locks.ts`); slice 06 now relies on it.
- Frontmatter of every plan re-parsed as YAML: all `depends_on`, `files_modified`, `acceptance` are inline arrays.
- No em dash in any plan file.

## Acceptance coverage matrix

| # | Dispatch acceptance | Slices and oracles |
| --- | --- | --- |
| 1 | updateSale never deletes; ids kept; removed row void; wizard returns ids; never N/M; drafts decided | 04 `ledger-reconcile.test.ts`, `update-sale-in-place.test.ts` (ids kept, zeroed middle voided by id, source guard no `.delete(`); 05 `row-identity.test.ts`, `sale-wizard-row-ids.test.tsx` (`never reads the label`); drafts H2 in overview and 04 docs |
| 2 | Immutable settlements table, UPDATE refused, RLS by org | 03 `settlements-schema.test.ts` (FXS01 for tenant and admin, RLS isolation and WITH CHECK, constraints), `settlements-schema-contract.test.ts` |
| 3 | Pure reducer with Finance rules; paid is cache; void is Sales' | 02 `liquidacao.test.ts` (parity table, invariants, `statusCacheDaLinha`); 06 cache writes via `statusCacheDaLinha` and `bootstrap ... paidOn` oracle |
| 4 | Full baixa only; paid row refused; default SP today; future refused API and UI | 02 `validarNovaBaixa` tests; 06 `already_paid`, `paid_on_in_future`, `defaults paidOn to the São Paulo day near UTC midnight`; 08 `mark-paid-dialog.test.tsx` |
| 5 | UI mark paid, reverse with reason, history, where rows appear | 08 dialog, history, row-actions, visibility tests plus the real-browser check |
| 6 | Row with active baixa locks value/due date and names the row; no leaving won | 04 `refuses with row_has_active_settlement ...`, `names a settled payable ...`; 05 `sale-wizard-save-error.test.tsx`; 06 `leaving won with an active baixa answers 409`, cancel-contract lock; 08 `sale-action-error.test.tsx` |
| 7 | 403 for non-admin on win, revert, cancel, edit, settings, baixa/estorno | 06 `every settlement route answers 403 ...`; 07 `financial-admin-gate.test.ts` (four routes plus `POST /sales` won) |
| 8 | `updated_at` and monotonic `revision` on value, due date, counterparty, state | 03 columns; 04 `bumps revision and updated_at only on a real change`, `a counterparty change bumps ...`, revert bump; 06 `revision increments by exactly one on each state change` |
| 9 | Deep link by id, cold entry through login | 09 `sale-deep-link.test.tsx`, `sale-deep-link-route.test.ts`, `session-journey.test.tsx` cold-entry oracle |
| 10 | USD removed, BRL only | 07 `settings currency is locked to BRL`, `settings-currency-brl.test.tsx` |
| 11 | Due date and payment date are SP days, near-UTC-midnight oracle | 01 `sao-paulo-day.test.ts`, `test/rls/sao-paulo-day.test.ts`, `civil-day.test.ts`; 06 near-midnight default; 08 fake-clock dialog test |
| 12 | Paid rows migrate with a synthetic baixa; docs per rule | 03 `settlements-schema-migration.test.ts` (backfill, timezone trap, idempotency, FXS03); every slice has a Docs section for `CLAUDE.md` and `propostas.md` (09 edits `sales-ops-routing.md`, 07 also `auth-model.md`) |
| 13 | No integration code; missing product decisions go to AUDIT | Every plan's Out of scope; 06 source guard on `settlements.ts`; consolidated decisions below go to the run's `AUDIT.md` |

## Remaining risks (non-blocking)

- The Finance reducer is still a plan, not code; slice 02 mirrors the plan's oracle list, so a later Finance implementation change can drift until the parity table is updated.
- Slice 04 is the largest slice (pure reconcile, payable heal for pre-0018 rows, won editing); its executor should expect the most review time.
- `FOR SHARE` on the sale in settlement writes versus `FOR UPDATE` elsewhere is deadlock-free only while no writer locks a ledger row before its sale; any future ledger writer must follow C6's order.
- Slices 04, 06 and 03's migration oracle need the local Docker test DB with `TEST_MIGRATE_DATABASE_URL` as a superuser (true locally via `setup-env.ts`); `deleteSettlementsForOrgs` refuses to run otherwise.
- `passWithNoTests: true` in api, web and shared-utils vitest configs: Verify must confirm each named test file appears in the reporter with a non-zero count.
- The real no-session login round trip for the deep link can only be proven in happy-dom under `make dev-fake`; slice 09 records whether a local Hub was available.
- `pnpm install --frozen-lockfile` is needed once in the worktree (no `node_modules` present); `pnpm run build:packages` before API and web tests that import new shared-utils subpaths.

## Decisions for AUDIT (consolidated, deduplicated)

- 01: The won date for the one-shot `other_cost` and the professional fallback is the São Paulo day of the win instant; `won_at` stays the raw instant.
- 01: An explicit `effectiveDate` on `cancel-contract` may still be in the future; only the default moves to the São Paulo day.
- 01: Every API day input (`dueDate`, `startDate`, `baseDate`, `effectiveDate`) rejects a non-calendar day with `400 validation_error`.
- 01: `isAfterTodayInSaoPaulo` throws `RangeError` on a malformed day instead of returning a boolean.
- 01: Instants shown with a clock stay in the operator's own timezone; only civil days are São Paulo days.
- 02: A new baixa is refused in the fixed order `sale_not_won`, `row_void`, `invalid_paid_on`, `paid_on_in_future`, `already_paid` (so a future date on a void row answers `row_void`).
- 02: A zero-amount receivable or payable answers `409 already_paid` to a baixa.
- 02: An estorno does not check the proposta or row status.
- 03: Migrated `paid_on` is `LEAST(UTC civil due day, São Paulo today)`; `won_at` rejected as the proxy.
- 03: A `paid` row with `amount_brl <= 0` gets no synthetic baixa and its status is left untouched.
- 03: DELETE is refused as well as UPDATE (`FXS01`), unlike Finance; tests and the dev seed use the local superuser in replica mode.
- 03: An estorno must mirror its baixa (org, sale, kind, row, amount) and may not target an estorno (`FXS02`).
- 03: No database guard against a future `paid_on`; the API and UI own that rule.
- 03: Synthetic baixas use `origin = 'manual'` and `actor_user_id = 'system'` (Finance uses a dedicated `migracao` origin).
- 03: The dev seed writes one synthetic baixa per seeded paid row with `actor_name = 'Seed de desenvolvimento'`.
- 03: SQLSTATEs `FXS01`, `FXS02`, `FXS03`.
- 03: `removed_at` for sale items and professionals ships in `0024`, so the feature has exactly one migration (plan-check).
- 04: Items and professionals that leave the payload are soft-removed with `removed_at`, never voided or deleted.
- 04: `PUT /sales/:id` never wins and never leaves `won`; a won proposta is saved with `status: 'won'` (won stays won); `draft <-> open` through PUT stays as today.
- 04: On `draft|open` an edit does not touch the payable set; legacy `paid` payables there stay as they are.
- 04: A void receivable or payable is never revived by an edit.
- 04: One-shot payables keep their stored due date on an edit; a newly created one uses the São Paulo day of `won_at`.
- 04: The edit lock treats `status = 'paid'` as settled even without an active baixa (fail closed).
- 04: Pre-0018 `professional_cost` rows with a null `sale_professional_id` are healed in place by `(receivable_id, beneficiary_name)`.
- 04: A cadastro referenced only by a removed item or professional stays unpurgeable; history wins over cleanup.
- 04: Any column change the reconcile writes bumps `revision` (label, method and the professional-id heal included), a superset of C7.
- 04: C5 row labels are the stored receivable label and `<beneficiário> (<N/M>)` for payables (plan-check).
- 05: A regenerated plan keeps ids by row index (positional), never by label, date or amount.
- 05: The wizard gains no way to zero a parcela; the zeroed-row id guarantee is at the payload layer.
- 05: No client-side pre-check of settled rows; the API's 409 is rendered after the save attempt, keeping the edits.
- 05: Swapping the produto of an item row keeps the item id.
- 05: Copy `A parcela N/M tem baixa ativa.`, `A mensalidade N/M ...`, `A conta a pagar <label> ...`, and a generic failure line.
- 05: A won proposta has no `Salvar rascunho`.
- 05: The recurring block sends at most `cycles` receivable ids; shrinking the recorrência voids the unlisted `M` rows (plan-check).
- 06: Reversing an estorno or any non-baixa id answers `404 not_found`.
- 06: A baixa's `paidOn` has no lower bound, not even the won date.
- 06: The estorno's `paid_on` is the São Paulo day of the reversal and never comes from the body.
- 06: The estorno reason is optional, trimmed, empty means null, capped at 500 characters.
- 06: Settlement bodies are `.strict()`; an unknown key is a 400.
- 06: `cancel-contract`'s lock checks non-void rows beyond the cut-off and their linked non-void payables; its void filters stay `status = 'open'`.
- 06: The history carries no row label; the UI describes rows from the bootstrap (plan-check).
- 06: Settlement writes lock the sale `FOR SHARE` before the row `FOR UPDATE` (plan-check lock order).
- 07: `POST /sales` refuses `status: 'won'` from a non-admin on the raw body, before validation.
- 07: The settings currency is shown read-only as `Real (BRL)` rather than removed.
- 07: No data migration and no DB CHECK for legacy non-BRL currency values.
- 07: A 403 on a financial mutation renders an in-page banner, never `ForbiddenPanel`; every 403 copy in sales-ops is `MUTATION_ERROR_COPY.adminRequired` (plan-check H7).
- 07: `SalesView.canManage` additionally requires the `admin` role.
- 07: `finder` and a missing role are treated exactly like `seller` on every gated route.
- 08: Settlement actions appear only for `admin` in `operacional`; `meus-dados` stays read-only for everyone.
- 08: `Estornar` reverses the newest active baixa of the row, read from the sale history on demand; the bootstrap grows no settlement id.
- 08: The UI always sends `paidOn` explicitly.
- 08: A `paid` row with `paidOn === null` shows only the `Paga` badge and offers no `Estornar`.
- 08: The settlement history is admin-only in the UI.
- 08: Blocking rows of a refused transition or cancel-contract are listed inside `MutationErrorBanner`; no second page-level error component (plan-check H7).
- 08: `operacional/comissoes` uses a per-payable `Histórico` dialog; the sale detail uses one in-flow `Histórico de pagamentos` disclosure.
- 09: `meus-dados/vendas/:saleId` exists (unpublished) because `SalesView` is one component; the Finance link is only `/operacional/vendas/:saleId`.
- 09: A non-admin following the Finance link gets the existing role default, not a re-map into `meus-dados`.
- 09: Unknown and other-org ids share one `Proposta não encontrada` state with no id.
- 09: Closing a detail pops history when opened in-app and replaces the URL otherwise.
- 09: The lead board's converted-card link now opens the proposta detail.
- overview H7: One page-level mutation error surface (`MutationErrorBanner`); dialog errors stay in their dialog (plan-check).
