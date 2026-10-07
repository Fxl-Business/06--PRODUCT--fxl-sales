# Plan check - leads-sem-vendedor (wave 1)

Verdict: PASS

## Coverage
- AC1-AC8 each map to a numbered test case in 01 (1 to 11); AC9 is covered by the 02 oracle (list, card, Lista, claimed-row reconcile).
- AC10 is deferred to Capture, as the overview says.

## Design vs code (lead-service.ts)
- Predicate is applied on every path: listLeads (count and page share `conditions`, lines 594-602), getLead (669), applyLeadUpdate (921, covers full and contact), moveLead (1004). Org stays first, `or()` parenthesizes, finder and deactivated vendedor keep `seller = me` only (resolveCallerPersonId has no status filter, so a deactivated vendedor still resolves, matching test 11).
- Claim is placed after FOR UPDATE and after already_converted; in moveLead it is after every validation throw, so refused or thrown writes never claim (transaction rollback covers the product_not_found-after-UPDATE case).
- seller_scope rule for pool leads (absent, null, '' via the contact preprocess, own id claim; other id refuses) is sound; the owned-lead branch and admin branch are byte-identical to today.
- Race: READ COMMITTED re-check after the lock wait gives the loser no row, so not_found. The test holds a real row lock on the admin connection and proves the wait with pg_blocking_pids, so it is deterministic and goes red if the claim or predicate is wrong.
- Only lead-service.ts reads salesOpsLeads; lead-routes.ts only mentions the gate in a comment, so the widened gate type breaks no consumer.

## Oracle quality and commands
- 01: every case except 11 fails on the old code (old board returns [] for the pool); the rewritten seller-scope case also fails on old code. Commands match package.json (`test:integration` = VITEST_INTEGRATION=1 vitest run, include test/rls/**; `test` = vitest run unit). Lint note about src/ and scripts/ only is correct.
- 02: 16 of 20 red before the implementation per the plan; commands match apps/web (`vitest run`, `eslint src/`, `tsc --noEmit`).

## Files
- 01 files_modified: lead-service.ts, lead-schemas.ts (comment), db/schema.ts (comment), two test files. 02: five web files plus its test. Disjoint, no depends_on needed, wave 1 parallel is safe.

## Rules
- No em dash in the plans (checked by byte). No raw ids in UI, no Combobox, no BOARD-WRITE-FENCE region touched (only a Lista cell and card footer), seller scoping stays server-side, no client-side claim.

## Notes (non-blocking)
1. 02 narrows AC9: a CONVERTED lead with no vendedor does NOT show the marker (overview AC9 says any `sellerPersonId === null`). Justified (it can never be claimed, AC7) and tested; scribe should word AC10/docs accordingly.
2. 02 also adds shrink-0/whitespace-nowrap to `daysBadgeClass` (pre-existing pixel defect). Harmless, in line with the user's pixel rule.
3. 01 edits two docblocks in db/schema.ts and lead-schemas.ts: comment-only, no migration (plan checks `git diff --stat -- apps/api/drizzle`).
4. Pre-existing 40P01 deadlock risk in moveLead/renumberStage is correctly flagged as a follow-up, not fixed.
5. Test 5 relies on `UpdateLeadSchema.parse({ products: [{ productId: randomUUID() }] })` parsing and resolveLeadProducts throwing product_not_found; consistent with the schema (productId alone satisfies the superRefine).
