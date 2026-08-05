# exec-01 - audit the cadastro lifecycle

Slice: `01-audit-the-cadastro-lifecycle`
Branch: `feat/01-audit-cadastro-lifecycle` (no switch, no merge, no commit)
Status: **PASS**

## What was built

The four status-bearing sales-ops cadastros now enroll in the existing hash-chained `audit_log`.
Archiving or restoring a produto, pessoa, função or área appends exactly one entry, in the same transaction as the status write, carrying the operator's Hub account id, the caller's org id, the entity type and id, the before/after status, an entity name snapshot and an actor display-name snapshot.
Ordinary renames and edits write nothing.
No migration was needed and none was added.

## File by file

### `apps/api/src/domains/audit/service.ts`

- `AuditActionSchema` grew from five members to seven: `cadastro.archived` and `cadastro.restored` appended **after** the existing five, which are untouched byte for byte.
- Added the exported `CadastroEntityTypeSchema` (`produto | pessoa | funcao | area`), its `CadastroEntityType` type, and `CADASTRO_LIFECYCLE_ACTIONS`, with the comment recording that these eight literals are the wire contract slice 04 matches on.
- `writeAuditEntry`, `computeEntryHash`, `canonicalJson` and `verifyChain` are untouched.

### `apps/api/src/middleware/app-auth.ts`

- Purely additive: `MinimalHubAuthContext['claims']` widened with optional `name` and `email`, and one pure exported helper `getHubActorDisplayName` (name, then email, then `null` - never the account id).
- No existing signature, middleware behaviour or role derivation changed. `src/middleware/__tests__/app-auth.test.ts` stayed green **unmodified** (14 tests).

### `apps/api/src/domains/sales-ops/service.ts`

- New exported `CadastroActor = { userId: string; displayName: string | null }`.
- New private `cadastroLifecycleEvent(before, after, archived)` - the one place the transition rule lives; returns `null` when `before === after`.
- New private `auditCadastroLifecycle(tx, input)` - the single writer, with the "hand it `tx`, never `db`" contract in its doc comment.
- `updateProduct`, `updatePerson`, `updateFuncao`, `updateArea` each gained an `actor: CadastroActor` parameter, a `.for('update')` on their "before" read, and one `auditCadastroLifecycle` call as the last statement of the `withTenant` body.
  - `updateArea` gained the `current` select it did not have; it returns `null` early for an unknown or cross-org id, which preserves today's behaviour (the UPDATE matched nothing).
  - `updatePerson`'s two return paths were restructured to converge into one local so the audit call happens exactly once, after `replacePersonFuncoes`.
  - `updateFuncao`'s audit call sits **after** the savepoint `try`/`catch` returns, never inside the nested transaction and never inside the `catch`.
- `updateClient` and `ClientSchema` are **not** modified. Cliente is deferred out of this feature.

### `apps/api/src/domains/sales-ops/routes.ts`

- One local `cadastroActor(c)` helper reads `c.get('userId')` and `getHubActorDisplayName(c.get('hubAuth'))` from the **verified** context, never the body.
- Threaded into the four PATCH handlers (`/people/:id`, `/products/:id`, `/areas/:id`, `/funcoes/:id`). `/clients/:id` unchanged.
- No new route, no new middleware, no DELETE verb, no response-body change.

### `apps/api/test/rls/cadastro-archive-audit.test.ts` (new)

The oracle: 8 tests covering assertions 1, 2, 2b, 3, 4, 5, 5b, 6, 7, 8, 9, 10 from the plan, plus one added discriminator (see Deviations).
`beforeAll` runs `DELETE FROM audit_log WHERE length(entry_hash) = 64` for a deterministic genesis; `afterAll` deletes the ledger rows and cadastro rows per org and drops the probe triggers defensively.

### Existing tests updated

- `test/rls/areas-rls.test.ts` - 2 `updateArea` call sites + `DELETE FROM audit_log WHERE actor_org_id = ...` in `afterAll`.
- `test/rls/funcoes-rls.test.ts` - 17 `updateFuncao`/`updatePerson` call sites + the same `afterAll` cleanup.
- `test/rls/product-funcao-costs-rls.test.ts` (15), `test/rls/product-commission-contract.test.ts` (2), `test/rls/funcoes-concurrency.test.ts` (1) - call sites only. None touches `status`, so none writes a ledger row and none got cleanup it does not need.
- `test/rls/client-legal-fields.test.ts` - **not** touched; `updateClient` kept its signature.
- `src/domains/sales-ops/__tests__/routes.test.ts` - the fake context now sets `hubAuth`; the `updatePerson` / `updateFuncao` assertions gained the literal fifth argument, a new `updateArea` archive case was added, plus a `displayName: null` case (no `name`, no `email`) and an e-mail-fallback case.

The `fileParallelism: false` dependency behind every ledger delete is stated in a comment on each `afterAll` that touches `audit_log`.

## Red evidence

The oracle was written first and run against unmodified production code:

```
 FAIL  test/rls/cadastro-archive-audit.test.ts > appends exactly one entry when an área is archived...
 AssertionError: expected [] to have a length of 1 but got +0
 FAIL  test/rls/cadastro-archive-audit.test.ts > covers all four entity types with one entry each...
 AssertionError: expected [] to have a length of 4 but got +0
 FAIL  test/rls/cadastro-archive-audit.test.ts > logs nothing when a system função is refused
 AssertionError: expected +0 to be 1 // Object.is equality
 FAIL  test/rls/cadastro-archive-audit.test.ts > rolls the status change back when the ledger write fails
 AssertionError: promise resolved "{ …(6) }" instead of rejecting
 FAIL  test/rls/cadastro-archive-audit.test.ts > leaves no ledger entry when the status write itself fails
 AssertionError: expected [Function] to throw error matching /fxl_audit_rollback_probe/ but got 'Failed query: update "sales_ops_areas…'

 Test Files  1 failed | 21 passed (22)
      Tests  5 failed | 133 passed (138)
```

Failing for the right reason: no ledger rows were being written at all.

## The `db`-vs-`tx` review point - actually verified, and the plan's oracle did NOT hold

The plan names assertion 8 (a `BEFORE INSERT` probe on `audit_log`) as the assertion that fails if the executor passes `db` instead of the `tx` from `withTenant`.
**That is not true, and it was proven empirically rather than assumed.**

With the implementation complete and green, `updateArea`'s audit call was deliberately sabotaged to `auditCadastroLifecycle(db, {...})` and the whole integration suite was re-run:

```
 Test Files  22 passed (22)
      Tests  138 passed (138)
```

The suite passed with the bug in place. The reason: the audit call is the **last** statement in the transaction, so a `BEFORE INSERT` probe on `audit_log` throws before anything commits (and the exception still propagates out of the `await`, rolling the outer transaction back), while a `BEFORE UPDATE` probe on `sales_ops_areas` throws before the audit call is even reached. Both roll back either way.

Passing `db` opens a second pooled connection in autocommit, so the entry is durable the instant it is written. The only way to observe that is to fail the transaction **after** the entry exists. A `DEFERRABLE INITIALLY DEFERRED` constraint trigger does exactly that - it fires at COMMIT, after the status write and after the audit write:

- with `tx`: the entry is inside the transaction, rolled back, 0 rows
- with `db`: the entry committed on its own connection, 1 orphan row

That test was added and both directions were verified. Sabotaged again with the new test present:

```
 FAIL  test/rls/cadastro-archive-audit.test.ts > takes the ledger entry down with a transaction that fails at COMMIT
 AssertionError: the ledger entry outlived its own transaction - auditCadastroLifecycle was handed
 `db` instead of the `tx` from withTenant: expected 1 to be +0
 Test Files  1 failed | 21 passed (22)
      Tests  1 failed | 138 passed (139)
```

The sabotage was reverted from a pristine backup and all four `auditCadastroLifecycle` call sites were re-verified as `tx` (`grep -c "auditCadastroLifecycle(tx, {"` = 4, `grep -c "auditCadastroLifecycle(db"` = 0).

## Green evidence

```
$ pnpm --filter @fxl-sales/api test
 Test Files  35 passed (35)
      Tests  345 passed (345)

$ pnpm --filter @fxl-sales/api test:integration
 Test Files  22 passed (22)
      Tests  139 passed (139)

$ pnpm --filter @fxl-sales/api lint
> eslint src/
(no output, exit 0)

$ pnpm run type-check
packages/shared-types type-check: Done
packages/shared-utils type-check: Done
apps/api type-check: Done
apps/web type-check: Done
(exit 0)
```

The `fileParallelism: false` setting the ledger cleanup depends on was confirmed present in `apps/api/vitest.config.ts` before relying on it.
`conversion-ingest.test.ts` and `conversion-webhook-contract.test.ts` both stayed green, so the genesis-anchored chain assertion survived the three new ledger-writing files.
No `permission denied for table audit_log` - the `fxl_sales_test` role can INSERT and take `FOR UPDATE` on the tail, which the oracle exercises over the app connection by design.

Post-run the test DB was checked clean: zero `fxl_%probe%` triggers, zero `fxl_%probe%` functions, zero `audit_log` rows.

## Deviations from the plan

1. **One test added beyond the plan's assertion list**: `takes the ledger entry down with a transaction that fails at COMMIT`. The plan's assertions 8 and 9 are both kept verbatim in intent, but neither discriminates `db` from `tx` (proven above). This is a strengthening, not a substitution.
2. **The rejection matcher walks the `cause` chain** instead of `rejects.toThrow(/fxl_audit_rollback_probe/)` as literally written. Drizzle wraps a postgres.js error in a `DrizzleQueryError` whose own message is `Failed query: ...`, so the probe's `RAISE EXCEPTION` text only ever appears on `cause`. The helper `expectRollbackProbeRejection` matches the whole chain, which keeps the assertion specific (an unrelated failure still fails it) without depending on which layer surfaces the text.
3. **`routes.test.ts` gained two extra cases** the plan did not name: an `updateArea` archive assertion (the plan says the `updateArea` assertion gains a fifth argument, but no such assertion existed in the file) and an e-mail-fallback case alongside the required `displayName: null` one.
4. **The actor is built by a small local `cadastroActor(c)` helper** in `routes.ts` rather than four inline object literals. Same values, same source, one place to read.
5. **Test files were run through prettier** with the repo config. They are outside `eslint src/` and outside any format gate, so this is cosmetic only.

## Scope

`apps/api/**` only. No `apps/web/**` change, no `CLAUDE.md` change, no migration, no change to `apps/api/src/db/schema.ts` or `apps/api/drizzle/**`, no DELETE verb, and no change to the five existing Phase-05 audit actions or the chain algorithm.

## Notes for later slices

- `CadastroEntityTypeSchema` and `CADASTRO_LIFECYCLE_ACTIONS` are exported and currently have no importer inside `apps/api`. Slice 02 consumes them.
- `getHubActorDisplayName` lives in slice 01 as decided at plan-check. Slice 02 must **import** it and must not re-add it.
- A behaviour nuance in `updateArea`: patching an unknown or cross-org id whose new name collides with an existing área now returns `null` (404) instead of `'duplicate'` (409), because the existence check moved ahead of the duplicate probe. This is what the plan prescribes and no test asserted the old ordering.
