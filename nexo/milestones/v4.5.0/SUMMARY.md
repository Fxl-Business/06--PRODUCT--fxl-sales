# v4.5.0 - Pool de leads sem vendedor e funil Acumulado

Tag: `v4.5.0` at `b457400`
Cut: 2026-10-07
Flow: `/nexo-ship-prod-ready` (Gate 3 approved by the owner in chat as one approval for cut, staging and production)
Chain: `master == staging == production == b457400`
Release-verify: PASS at `026462e`; `b457400` differs only in `nexo/state.json` (the gate-3 record).
Vercel Production deployment for `b457400`: success.

## Accomplishments

- Leads sem vendedor (run `20261007T181210Z-leads-sem-vendedor`, 3 slices): a non-admin active vendedor sees own plus unassigned leads and takes an unassigned lead on the first move or edit, in the same transaction.
- The race loser of a claim answers `not_found` and writes nothing; an admin never claims.
- The card and the Lista show `Sem vendedor - disponível` for an open lead with no vendedor.
- A per-org transaction advisory lock (`lockLeadBoard`) in `insertLead` and `moveLead` removes a pre-existing deadlock (`40P01`, a 500) between concurrent moves in one column and duplicate positions on concurrent creates.
- Funil Acumulado vs Composição (run `20261007T185127Z-leads-funnel-cumulative`, 1 slice): the Funil view gained an `Acumulado`/`Composição` toggle, `Acumulado` by default, with Perdido reported apart.

## Key decisions

- Only an ACTIVE vendedor sees and claims the pool; a finder-only or deactivated vendedor keeps own leads only.
- One per-org advisory lock over a `40P01` retry, stage-row locks (they collide with `reorderLeadStages`) or per-stage locks (`nexo/knowledge/decisions/2026-10-07-unassigned-lead-pool-and-board-lock.md`).
- The two features were built by two parallel agents and both shipped in this cut at the owner's request.

## Open items

- Construbom still needs the Hub module grant `sales.edition.leads` before its prospect import.
- Optional: bound the board-lock wait with a `lock_timeout` during long imports (pool of 10 API connections).
- Copy: `Minha prospecção` still says "Seus leads em negociação" although it now also lists the unassigned pool.
- Milestones `v4.4.0` and `v4.4.1` were cut without a close; their runs stay under `nexo/runs/`.

References: `nexo/milestones/v4.5.0/RELEASE-NOTES.md`, `CLAUDE.md` `## Kanban de leads` and `## Edição Leads`.
