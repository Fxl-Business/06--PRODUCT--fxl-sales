# Verify 08: client-legal-web

Slice: `08-client-legal-web` (final slice of feature `20260729-propostas-areas`).
Branch under test: `feat/08-client-legal-web` @ `f92bdb777872e1e1692134337e8a0dd5701eac9f`.
Base compared against: `d20c9f1` (main tip the branch forked from).
Verified in an isolated worktree, checked out detached at the branch SHA because the branch ref was already locked to another worktree (`agent-acf94e217ebe6eea7`).

Note: this report was written to the worktree's `nexo/runs/` path, not the main repo, because the Write tool is sandboxed to this worktree.

## Verdict: PASS

## 1. Change surface vs plan

`git diff --stat d20c9f1..f92bdb7` shows exactly the 6 files listed in `files_modified`:

```
apps/api/src/domains/sales-ops/__tests__/service.test.ts    |  62 +++++++++
apps/api/src/domains/sales-ops/service.ts                   |  34 ++++-
apps/api/test/rls/client-legal-fields.test.ts                |  94 +++++++++++++
apps/web/src/sales-ops/SalesOpsApp.tsx                       |  71 +++++++++-
.../__tests__/client-dialog-legal-fields.test.tsx            | 153 +++++++++++++++++++++
apps/web/src/sales-ops/types.ts                              |   5 +
6 files changed, 412 insertions(+), 7 deletions(-)
```

No other files touched. `routes.ts` and `db/schema.ts` show empty diffs, confirmed with explicit `git diff` on each path — matching the plan's "no route changes, no migration" scope. The five Drizzle columns (`legalName`, `document`, `address`, `legalRepName`, `legalRepDocument`, all nullable `text`) were already present on `salesOpsClients` in `schema.ts` before this slice (shipped by slice 02), so the precondition guard did not need to fire.

## 2. Diff content vs plan

a. `ClientSchema` (service.ts) — matches the plan's exact replacement: `contact` moved from `.optional().or(z.literal(''))` to `.nullish()`, and the five new fields added with `.nullish()` and matching `max()` lengths (200/32/400/200/32).

b. `updateClient` — new `clearableText` helper (`undefined` -> `undefined`, else `value || null`) applied to `contact` and all five legal fields; `name` is only included in `.set()` when `data.name !== undefined`. This is real PATCH semantics: an omitted field is skipped by Drizzle's `.set()` (left untouched in the DB), while `''`/`null` explicitly clears it. Verified this is a genuine behavior change from the old code (`contact: data.contact || null` unconditionally, which wiped `contact` on any PATCH that omitted it) — the new RLS integration test pins exactly this regression fix (see 3c below).

c. `createClient` — every optional field (`contact` plus the five legal fields) explicitly normalizes `'' | undefined -> null` via `data.field || null`, matching the plan verbatim.

d. `ClientDialog` (SalesOpsApp.tsx) — exported (`export function ClientDialog`), gained five `useState` hooks seeded from `modal.client?.<field> ?? ''`, submit payload sends `field.trim() || null` for `contact` and all five legal fields, dialog description text and `max-h-[85vh] ... overflow-y-auto` class added, and a new "Dados para contrato" section with 5 `Field`+`Input` pairs with `aria-label`s matching their visible labels, inserted between the Contato field and the footer — all matching the plan's exact JSX.

e. `ClientsView` table (Nome / Contato / Nº vendas / Receita total / Ações) is byte-for-byte unchanged; confirmed no legal field is rendered there or anywhere outside `ClientDialog`. No other views touched.

f. Tenancy — every `salesOpsClients` query site in `service.ts` (`listClients`, `createClient`, `updateClient`, `getSalesOpsSnapshot`) is wrapped in `withTenant(db, orgId, ...)` and filters `eq(salesOpsClients.orgId, orgId)`. `routes.ts` untouched (no diff). No `user_id`/`org_id`/`account_id`/`workspace_id` trusted from request bodies in this diff.

## 3. Verification commands (all green)

Environment: copied `apps/api/.env` into the worktree (pins `TEST_DATABASE_URL` to local docker `fxl_sales` on port 5006, confirmed NOT staging); local docker DB container `06--product--fxl-sales-db-1` was already running; built `@fxl-sales/shared-utils` and `@fxl-sales/shared-types` dist artifacts before running checks.

- `pnpm run lint` -> `apps/api lint: Done`, `apps/web lint: Done`. No errors.
- `pnpm run type-check` -> `apps/api type-check: Done`, `apps/web type-check: Done`, `packages/*` done. No errors.
- `CI=true pnpm test` -> exit code 0. `apps/api test`: 23 files / 215 tests passed (includes `service.test.ts` 14 tests, up from 11, covering the new `describe('client schema legal fields', ...)` block). `apps/web test`: 21 files / 122 tests passed, including the new `client-dialog-legal-fields.test.tsx` (3/3 tests: submit-with-legal-fields, rehydrate-on-edit, clear-sends-null). Tracked-file legacy-auth guard (`node scripts/no-legacy-auth.mjs`) ran as part of the chain and did not fail.
- `pnpm --filter @fxl-sales/api test:integration` -> `VITEST_INTEGRATION=1 vitest run`: 13 files / 47 tests passed, including `test/rls/client-legal-fields.test.ts (1 test)` which exercises create -> partial PATCH (asserts `document` changes while `legalName`/`address`/`legalRepName`/`legalRepDocument`/`contact` are preserved, proving the omitted-field-preserved fix) -> null-clear PATCH -> `listClients` round-trip.

## 4. Security lens

CNPJ/CPF and address are stored as plain `text` columns with no formatting/validation added beyond `max()` length caps, per plan (acceptable, explicitly out of scope). Searched `service.ts`, `routes.ts`, and `SalesOpsApp.tsx` for `console.`/`logger.` calls referencing the new fields: none found — the fields are never logged. Searched all renders in `SalesOpsApp.tsx`: the five legal fields are only read/written inside `ClientDialogBody` (state hooks, the "Dados para contrato" `Input`s, and the submit payload); `ClientsView`'s table and every other view were confirmed unchanged and do not reference `legalName`/`document`/`address`/`legalRepName`/`legalRepDocument` on the client object. (Two unrelated pre-existing lines at `SalesOpsApp.tsx:314-315,2237-2246` reference `legalName`/`document` on the separate `sales_ops_settings` org profile form, not on `SalesOpsClient` — out of scope for this slice and untouched by the diff.)

## Conclusion

All six contract points proven, full verification suite green, tenancy and security lens both clean. Verdict: **PASS**.
