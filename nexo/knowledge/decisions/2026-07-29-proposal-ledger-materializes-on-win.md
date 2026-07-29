# Proposal Payables Materialize Only on Win, Per Receivable Row

## Context

Sales Ops used to record only finished sales, so every recorded sale already had its full commission and tax ledger generated at creation time.
The Propostas feature introduces a real lifecycle (`draft -> open -> won / lost / cancelled`): a proposta can exist, be edited, and be lost or cancelled long before any money is real.
If payables (seller commission, finder commission, tax) were generated at proposta creation, the payables table would be inflated with commitments for deals that never close, and reverting a status would require carefully unwinding partially-paid obligations.
Advisor-style contracts make this sharper: a recurring contract (for example R$ 10k/month x 3) earns its commission per month, not all at once at signature, and the client can cancel mid-contract.

## Decision

Payables are generated per receivable row, only when a proposta transitions to `won`, and only linked back to that specific row.

- `sales_ops_receivables` rows are the payment plan itself (parcelas): created with the proposta and freely replaced while the proposta is not `won`.
- At the `won` transition, `seller_commission`, `finder_commission`, and `tax` payables are generated once per receivable row, each carrying the new `receivable_id` column (nullable FK on `sales_ops_payables`), amount is a percentage of that row's value, and due date matches that row's due date.
- `professional_cost` and `other_cost` payables stay one-shot: generated once at win time, due at the win date, with no `receivable_id` link.
- Leaving `won` (revert to `open`, or transition to `lost`/`cancelled`) voids every payable with status `open` that is linked to the proposta; `paid` payables are never touched.
- Cancelling a recurring contract mid-way (the `cancel-contract` action, only valid on a `won` sale) voids the remaining `open` receivables strictly after the cutoff date, and voids only the `open` payables linked to those specific receivable rows via `receivable_id`; earlier and already-paid rows are untouched.
- `buildSaleLedger` stays a pure function that computes totals and margin from an explicit plan; materialization (writing payable rows) happens only in the service-layer transition logic, never inside the pure ledger calculation.

## Rationale

Proposals must not inflate the payables table with commitments for deals that are still open, might be lost, or might be cancelled: a payable should represent a real earned (or about-to-be-earned) obligation, not a forecast.
Generating commission per parcela, rather than as one lump sum at win, makes mid-contract cancellation claw back unearned commission naturally: voiding the still-open receivable rows and their linked payables removes exactly the unearned portion, while whatever was already paid or already due stays untouched.
This also keeps the ledger reversible: any status transition away from `won` is a pure void-open operation with no need to reconstruct or approximate what should be un-owed.

## Consequences

- Every write to `sales_ops_payables` that isn't `professional_cost`/`other_cost` must be traceable to a receivable row; a payable with a `null` receivable_id is by construction a one-shot cost, not a commission or tax line.
- The wizard's ledger preview (step 4, "Revisão") shows payables as a projection ("o que será gerado ao marcar como Ganha"), not as already-existing rows, because they do not exist yet for a `draft`/`open` proposta.
- Reverting or losing a proposta after partial payment is safe: `paid` payables from earlier parcelas are never voided, only the `open` remainder.
- Any future slice that adds a new payable kind must decide up front whether it is per-receivable (needs `receivable_id`, materializes at win, voids on revert) or one-shot (materializes at win, no receivable link), following this same split.
