# Planning evidence: 02-professional-payable-identity

Status: PASS

The executor-ready TDD plan is saved at `nexo/plans/20260805-release-blocker-repair/02-professional-payable-identity.md`.

## Evidence inspected

- Read the root and API `AGENTS.md` instructions, the approved repair design, the batch frame, and the generated context pack.
- Inspected `salesOpsSaleProfessionals` and `salesOpsPayables` in `apps/api/src/db/schema.ts`.
- Inspected `PayableDraft`, `ExistingPayableRef`, `MaterializeWonPayablesInput`, and `materializeWonPayables` in `apps/api/src/domains/sales-ops/service.ts`.
- Traced both production materializer call sites in `createSale` and `transitionSale`.
- Confirmed that `createSale` currently discards inserted professional row IDs and that `transitionSale` already loads the full professional rows.
- Confirmed that current professional idempotency matches beneficiary display name plus receivable and therefore collapses same-name professionals.
- Inspected migration `0017`, the Drizzle journal and snapshots, migration contract tests, executable backfill tests, RLS integration setup, and the relevant unit and PostgreSQL integration suites.
- Confirmed that existing tenant-safe FK conventions use composite target indexes and composite foreign keys rather than relying on RLS during FK validation.

## Planned contract

- Migration `0018` adds nullable `sale_professional_id`, a direct lookup index, a unique `(org_id, sale_id, id)` target index, and a composite `(org_id, sale_id, sale_professional_id)` foreign key.
- The backfill sets an ID only when organization, sale, and beneficiary snapshot resolve to exactly one professional row.
- Ambiguous rows remain null and are handled by a consumable runtime multiset keyed by beneficiary snapshot, receivable, and amount.
- Current non-void rows match by durable professional ID plus receivable before any legacy count is consumed.
- The Red oracle executes the real won to open to won sequence through `transitionSale` and PostgreSQL and fails with one active payable instead of two before the fix.
- The plan separately proves direct-won creation, migration replay safety, cross-organization and cross-sale FK rejection, explicit null identity for other payable kinds, and exact totals.

## Self-review

- Frontmatter contains the requested slice ID, milestone, todo status, empty dependencies, exact executor file set, and given/when/then acceptance string.
- The writing-plans agentic-worker header is present.
- The plan contains exact interfaces, test names, commands, Red failure, minimal Green steps, refactor limits, verification commands, and atomic commit guidance.
- Placeholder and em dash scans returned no findings.
- No production code or test file was modified during planning.
