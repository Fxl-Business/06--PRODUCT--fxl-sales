# AUDIT - 20260924T013019Z-finance-prereqs (autopilot)

Decisions taken without the human, each with the option chosen.
The full reasoning lives in `nexo/plans/20260924T013019Z-finance-prereqs/00-OVERVIEW.md` (H1-H6).

- H1 (product, not explicit in the audit): won propostas become editable; `updateSale` accepts draft|open|won and reconciles payables in place. Chosen because PC2 names payables (which exist only on won) and the section 11 row lock and "Editar no Sales" presuppose it.
- H2 (asked by the request): drafts use the same reconcile path; rows leaving the plan become void, never deleted.
- H3 (product): a baixa is only allowed on a non-void row of a won proposta.
- H4 (product detail of PC23): POST /sales stays open to non-admins (seller lead conversion) but refuses status won for them; transition, cancel-contract, PUT sale, PUT settings and settlements are admin-only.
- H5 (product): cancel-contract refuses when a row it would void has an active baixa.
- H6 (process): execution is serial because every API slice shares the one local Docker test DB.

## Per-slice decisions (consolidated by the plan-check)


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

## Incidents

- 2026-09-24 ~00:05-01:40 (-03): an account usage limit (HTTP 429) killed four live agents at once (wave-1 verify, slice 04 verify, slice 05 and 06 executors).
  The wave-1 verify result never landed, so the wait inside `nexo-wave-exec.sh` hit its 3600 s timeout, which the script reads as a FAIL: it appended revert commits for all three merges and began the serial recovery (it had re-applied slice 01 when the orchestrator stopped its process group).
  The FAIL was not real: every per-slice Gate 2 had passed and the verify agent's last output reported 233/233 integration tests green.
  Repaired append-only (no reset, no force): `git revert` of the two remaining revert commits, giving master a tree byte-identical to the merged wave `bdbb450`; the wave-verify agent was resumed against that same tree.
  The outage also consumed about 1.5 h of the run's 4 h active-time budget; the budget was NOT expanded, so the slices that cannot finish inside it are parked with reason `budget`.
- Process gap found: a wave-verify wait timeout is indistinguishable from a real FAIL to `nexo-wave-exec.sh`; a lost dispatch (exit 3) should escalate, not revert.
- Waves 2 (slice 04) and 3 (slices 05, 06) share ONE integrated full-suite wave-verify after wave 3 merges, to fit the budget left after the outage; slice 04 was merged with its per-slice Gate 2 PASS only.
