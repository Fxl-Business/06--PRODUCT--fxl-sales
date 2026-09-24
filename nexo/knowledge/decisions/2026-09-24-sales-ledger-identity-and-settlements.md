# Sales ledger identity and settlements - decisions

**Date:** 2026-09-24
**Run:** `nexo/runs/20260924T013019Z-finance-prereqs/AUDIT.md`
**Milestone:** v4.1.0

Decisions taken without the human during the finance-prereqs run (autopilot mode), consolidated from the plan-check and the run's own AUDIT.md.
Full reasoning for H1-H7 lives in `nexo/plans/20260924T013019Z-finance-prereqs/00-OVERVIEW.md`.

## Overview-level decisions (H1-H7)

H1. Won propostas become editable.
`updateSale` now accepts `draft|open|won` and reconciles payables in place on a won proposta, because PC2 names payables (which exist only on won) and the Finance "Editar no Sales" button presupposes it.

H2. Drafts use the exact same reconcile path as every other editable status.
Rows that leave the plan become `void`, never deleted, so a draft's ids are already stable if it moves straight to `won`.

H3. A baixa is only allowed on a non-void row of a `won` proposta.
A draft or open proposta's receivables are projections, not obligations.

H4. `requireAdmin` gates transition, cancel-contract, `PUT /sales/:id`, `PUT /settings` and every settlement route.
`POST /sales` stays open to non-admins for lead conversion, but refuses `status: 'won'` from a non-admin.

H5. `cancel-contract` refuses with `409 sale_has_active_settlements` when any row it would void has an active baixa.

H6. Execution is serial, one slice at a time, because every API slice shares the one local Docker test DB.

H7. There is exactly one page-level mutation error surface, `MutationErrorBanner`.
Dialog-local errors (the wizard's save error, the settlement dialogs' own errors) stay local to their own dialog.

## Per-slice decisions

01-sao-paulo-day:
The won date for the one-shot `other_cost` and the professional fallback is the São Paulo day of the win instant, while `won_at` stays the raw instant.
An explicit `effectiveDate` on `cancel-contract` may still be in the future; only the default moves to the São Paulo day.
Every API day input rejects a non-calendar day with `400 validation_error`.
`isAfterTodayInSaoPaulo` throws `RangeError` on a malformed day instead of returning a boolean.
Instants shown with a clock stay in the operator's own timezone; only civil days are São Paulo days.

02-liquidacao-reducer:
A new baixa is refused in the fixed order `sale_not_won`, `row_void`, `invalid_paid_on`, `paid_on_in_future`, `already_paid`.
A zero-amount receivable or payable answers `409 already_paid` to a baixa.
An estorno does not check the proposta or row status.

03-ledger-schema:
Migrated `paid_on` is `LEAST(UTC civil due day, São Paulo today)`; `won_at` was rejected as the proxy.
A `paid` row with `amount_brl <= 0` gets no synthetic baixa and its status is left untouched.
DELETE is refused as well as UPDATE (`FXS01`), unlike Finance.
An estorno must mirror its baixa (org, sale, kind, row, amount) and may not target an estorno (`FXS02`).
There is no database guard against a future `paid_on`; the API and UI own that rule.
Synthetic baixas use `origin = 'manual'` and `actor_user_id = 'system'`, unlike Finance's dedicated `migracao` origin.
`removed_at` for sale items and professionals ships in the same `0024` migration, so the feature has exactly one migration.

04-update-sale-in-place:
Items and professionals that leave the payload are soft-removed with `removed_at`, never voided or deleted.
`PUT /sales/:id` never wins and never leaves `won` through this endpoint; a won proposta is saved back with `status: 'won'`.
On `draft|open` an edit does not touch the payable set; legacy `paid` payables there stay as they are.
A void receivable or payable is never revived by an edit.
One-shot payables keep their stored due date on an edit; a newly created one uses the São Paulo day of `won_at`.
The edit lock treats `status = 'paid'` as settled even without an active baixa, failing closed.
Pre-0018 `professional_cost` rows with a null `sale_professional_id` are healed in place by `(receivable_id, beneficiary_name)`.
A cadastro referenced only by a removed item or professional stays unpurgeable; history wins over cleanup.
Row labels for the C5 lock error are the stored receivable label and `<beneficiário> (<N/M>)` for payables.

05-wizard-row-ids:
A regenerated plan keeps ids by row index (positional), never by label, date or amount.
The wizard gained no way to zero a parcela; the zeroed-row id guarantee lives at the payload layer.
There is no client-side pre-check of settled rows; the API's 409 renders after the save attempt and keeps the edits on screen.
Swapping the produto of an item row keeps the item id.
A won proposta has no `Salvar rascunho`.
The recurring block sends at most `cycles` receivable ids; shrinking the recorrência voids the unlisted `M` rows.

06-settlements-api:
Reversing an estorno or any non-baixa id answers `404 not_found`.
A baixa's `paidOn` has no lower bound, not even the won date.
The estorno's `paid_on` is the São Paulo day of the reversal and never comes from the body.
The estorno reason is optional, trimmed, empty means null, capped at 500 characters.
Settlement bodies are `.strict()`; an unknown key is a 400.
`cancel-contract`'s lock checks non-void rows beyond the cut-off and their linked non-void payables.
The settlement history carries no row label; the UI describes rows from the bootstrap.
Settlement writes lock the sale `FOR SHARE` before the target row `FOR UPDATE`.

Parked without execution (plans complete, decisions already recorded for when they run):

07-admin-gate-and-brl: `POST /sales` refuses `status: 'won'` from a non-admin on the raw body, before validation.
The settings currency is shown read-only as `Real (BRL)` rather than removed outright.
There is no data migration and no DB CHECK for legacy non-BRL currency values.
A 403 on a financial mutation renders an in-page banner, never `ForbiddenPanel`.
`finder` and a missing role are treated exactly like `seller` on every gated route.

08-settlements-ui: Settlement actions appear only for `admin` in `operacional`; `meus-dados` stays read-only for everyone.
`Estornar` reverses the newest active baixa of the row, read from the sale history on demand.
The UI always sends `paidOn` explicitly.
A `paid` row with `paidOn === null` shows only the `Paga` badge and offers no `Estornar`.
The settlement history is admin-only in the UI.

09-sale-deep-link: `meus-dados/vendas/:saleId` exists but stays unpublished, because `SalesView` is one component; the Finance link is only `/operacional/vendas/:saleId`.
A non-admin following the Finance link gets the existing role default, not a re-map into `meus-dados`.
Unknown and other-org ids share one `Proposta não encontrada` state with no id shown.
The lead board's converted-card link now opens the proposta detail.
