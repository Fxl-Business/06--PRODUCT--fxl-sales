# Verify (Gate 2) - slice 01, audit the cadastro lifecycle

- **Slice**: `01-audit-the-cadastro-lifecycle`
- **Branch**: `feat/01-audit-cadastro-lifecycle` (uncommitted)
- **Auditor**: independent Verify sub-agent. Nothing under `nexo/runs/` was read.
- **Verdict**: **PASS**, with one pre-existing defect in unchanged code flagged for `nexo/ROADMAP.md`.

---

## 1. Required command runs

Each run exactly once, never in watch mode. Real output.

### `pnpm --filter @fxl-sales/api test`

```
 Test Files  35 passed (35)
      Tests  345 passed (345)
   Duration  1.49s
```

### `pnpm --filter @fxl-sales/api test:integration`

```
 ✓ test/rls/cadastro-archive-audit.test.ts (9 tests) 203ms
 Test Files  22 passed (22)
      Tests  139 passed (139)
   Duration  13.76s
```

### `pnpm --filter @fxl-sales/api lint`

```
> @fxl-sales/api@1.0.0 lint
> eslint src/
(exit 0, no output)
```

### `pnpm run type-check`

```
packages/shared-types type-check: Done
packages/shared-utils type-check: Done
apps/api type-check: Done
apps/web type-check: Done
(exit 0)
```

All four gates pass. A final re-run after every mutation experiment was restored produced identical results (35/345, 22/139, lint 0, type-check 0).

---

## 2. Mutation experiments

Every experiment mutated the working tree, ran the suite, recorded the observed result, and then restored from a byte-exact backup. The final `git diff master --stat` is identical to the pre-audit snapshot (`10 files changed, 631 insertions(+), 97 deletions(-)`).

### M1 - THE ATOMICITY MUTATION (audit point 1)

Replaced all four `await auditCadastroLifecycle(tx, {` call sites with `db`:

```
1562:    await auditCadastroLifecycle(db, {
1686:    await auditCadastroLifecycle(db, {
2043:    await auditCadastroLifecycle(db, {
2185:    await auditCadastroLifecycle(db, {
```

**First: it compiles.** `tsc --noEmit` exit 0. The plan's warning is real - the `Db` alias is applied to both handles and TypeScript catches nothing.

**Then the suite:**

```
 × cadastro archive/restore audit ledger > takes the ledger entry down with a transaction that fails at COMMIT 45ms
   → the ledger entry outlived its own transaction - auditCadastroLifecycle was handed `db` instead of the `tx` from withTenant: expected 1 to be +0

 Test Files  1 failed | 21 passed (22)
      Tests  1 failed | 138 passed (139)
```

**RESULT: genuinely RED, with a diagnostic that names the exact defect.** Restored, re-ran, green.

**Material correction to the plan.** The plan asserted (Risks 1, assertion 8) that the `BEFORE INSERT ON audit_log` probe is what catches this. **It does not.** Under M1 the two probes the plan named - "rolls the status change back when the ledger write fails" and "leaves no ledger entry when the status write itself fails" - both stayed **green**. Neither can discriminate:

- the `BEFORE INSERT ON audit_log` probe throws before anything commits, so the second connection's transaction aborts too - identical observable;
- the `BEFORE UPDATE ON sales_ops_areas` probe throws before the audit call is even reached.

The implementer identified this independently and added a third test that does discriminate: a `CONSTRAINT TRIGGER ... DEFERRABLE INITIALLY DEFERRED` on `sales_ops_areas`, which fires at COMMIT - after both the status write and the audit write. With `tx` the entry is inside the transaction and rolls back; with `db` it is durable on a second pooled connection and survives as an orphan. That is the only assertion in the file with discriminating power for this failure mode, and its comment says so honestly. **This is a strengthening of the plan, not a deviation from it.**

### M2 - drop the `before === after` guard (audit point 5)

Removed `if (before === after) return null;` from `cadastroLifecycleEvent`.

```
 × cadastro archive/restore audit ledger > writes nothing when the status does not actually transition
   → expected [ { …(10) }, { …(10) } ] to have a length of +0 but got 2
```

**RED.** The "only the lifecycle is audited" claim is genuinely guarded: an ordinary rename and an idempotent `status:'active'` resave both produced spurious rows the moment the guard was removed.

Side observation: M2 also turned `conversion-ingest.test.ts`'s chain assertion red, because `areas-rls`/`funcoes-rls` began emitting rows their cleanup did not anticipate. That is the cross-contamination risk the plan names, and it confirms these files really do interact - under the unmutated code it passes deterministically (see point 7).

### M3 - `actorLabel: input.actor.displayName ?? input.actor.userId` (audit point 6)

```
 × cadastro archive/restore audit ledger > appends exactly one entry when an área is archived, and a NEW one when it is restored
   → expected 'acct_audit_test_1785971491385_903e7523' to be null
```

**RED.** Assertion 2b genuinely stops a raw Hub account id being smuggled into the field the history renders as a person's name.

### M4 - disable the audit write entirely (audit point 2, vacuity check)

Inserted an early `return` in `auditCadastroLifecycle` so no ledger row is ever written.

```
 × appends exactly one entry when an área is archived...   → expected [] to have a length of 1
 × covers all four entity types with one entry each...     → expected [] to have a length of 4
 × logs nothing when a system função is refused            → expected +0 to be 1   (positive control)
 × rolls the status change back when the ledger write fails → expected the write to reject, but it resolved
```

**Findings on vacuity:**

- **Rollback direction A** ("a failing ledger insert leaves the cadastro unarchived") is **not** vacuous. With no audit write, the `BEFORE INSERT` probe never fires, `updateArea` resolves, and the test fails with `expected the write to reject, but it resolved`. It genuinely requires the ledger write to happen inside the transaction.
- **Rollback direction B** ("a failing status write leaves no ledger row") **is individually vacuous-passable** - it stayed green with the audit path fully disabled, because the `BEFORE UPDATE` trigger aborts before the audit call is reached. Its premise ("an archive normally writes a row") is carried by assertion 1 in the same file, which M4 turns red. The pair is jointly sound; direction B alone proves less than it appears to. Recorded as a known-weak assertion, not a failure - it is not the assertion the atomicity claim rests on.
- The system-função test contains a **positive control** ("an org-created função does log exactly one"), which is what stops its own "logs nothing" half being vacuous. Good.

---

## 3. Verdict per audit point

### 1. Atomicity is the whole point - **PASS**

Verified by experiment, not by reading. The `db`-for-`tx` mutation compiles (`tsc` exit 0) and a test goes red with an unambiguous diagnostic. Restored, green. See M1, including the correction to the plan's claim about which assertion does the catching.

All four new call sites pass `tx` from the `withTenant` callback. Every other `writeAuditEntry` caller in the codebase (`commissions/service.ts` x2, `conversions/service.ts` x2, `payouts/service.ts` x2) also passes `tx`; none passes a bare `db`.

### 2. Rollback proven in both directions - **PASS** (one assertion is weak but backstopped)

- Ledger insert fails -> cadastro stays `active`, zero ledger rows. Not vacuous (M4).
- Status write fails -> zero ledger rows, cadastro stays `active`. Individually vacuous-passable; backstopped by assertion 1. Documented above.
- Commit-time failure -> the discriminating case, and the only one that can observe an orphan. Not vacuous (M1).

### 3. Chain integrity and append-only - **PASS** for the slice; pre-existing defect flagged separately

- After archive + restore traffic, `verifyChain` over the whole ledger (same query and same function `/api/v1/admin/audit/verify-chain` runs) returns `{valid: true, brokenAt: null}`. Asserted three times in the oracle, including once after both rollback probes.
- A restore **appends**: the test re-reads the archive row after the restore and asserts it is byte-identical (`expect(afterRestore[0]).toEqual(entry)`), and asserts `rows[1].prev_hash === rows[0].entry_hash`. Nothing is mutated or deleted in place.
- No `UPDATE`/`DELETE` against `auditLog` exists anywhere in `apps/api/src` (the single grep hit is a test fixture teardown).

### 4. Cliente deferred, no migration - **PASS**

- `git status --porcelain | grep -E "drizzle|schema\.ts"` -> **(none)**. **Zero migration files in this diff.** No scope violation.
- `git diff master -- apps/api/src | grep -E "salesOpsClients|updateClient|ClientSchema"` -> **(none)**. `updateClient` keeps its signature.
- Enforced at runtime by oracle assertion 5b: `updateClient(...)` succeeds and `count(*) FROM audit_log WHERE entity_id = client.id` is `0`.
- `CadastroEntityTypeSchema` has exactly four members.

### 5. Only the archive/restore lifecycle is audited - **PASS**

A rename (`{name:'Renomeada'}`, no status key) and an idempotent resave (`{status:'active'}` on an active row) both leave the ledger at zero rows. Guarded, per M2. Creates are not audited. `updateProduct`'s `INVALID_PRODUCT_ENTRADA_VALUE` sentinel returns before the UPDATE and before the audit call, so a rejected product write logs nothing.

### 6. Actor snapshotted from the verified token - **PASS**

- `cadastroActor(c)` reads **only** `c.get('userId')` and `c.get('hubAuth')`. Both are set inside the `requireHubAuth` callback in `apps/api/src/middleware/app-auth.ts` (line 170, `c.set('userId', legacy.userId)`), i.e. from the verified token. Nothing touches `parsed.data` or the request body.
- `getHubActorDisplayName` returns `name` -> `email` -> **`null`**. There is no `?? accountId` fallback, and M3 proves that fallback cannot be reintroduced silently.
- Unit-tested three ways in `routes.test.ts`: a name present, a name absent with email present, and neither present asserting `displayName: null` - all as **literals**, not `expect.anything()`, so they genuinely pin the verified provenance.

### 7. Test cross-contamination and determinism - **PASS**

- **`fileParallelism: false` truly exists.** Confirmed in `apps/api/vitest.config.ts`, inside the `isIntegration` branch (the only branch it needs to be in), with a comment naming `audit_log` as the shared global table.
- Both `areas-rls.test.ts` and `funcoes-rls.test.ts` gained `DELETE FROM audit_log WHERE actor_org_id = ${orgId}` in their per-org `afterAll`, each with the required comment explaining that the tail-delete is only safe under `fileParallelism: false`.
- **Three consecutive integration runs, identical:**

```
=== RUN 1 ===   Test Files  22 passed (22)   Tests  139 passed (139)
=== RUN 2 ===   Test Files  22 passed (22)   Tests  139 passed (139)
=== RUN 3 ===   Test Files  22 passed (22)   Tests  139 passed (139)
```

No order dependence, no flakiness observed. `conversion-ingest.test.ts`'s genesis-anchored chain assertion stayed green in all three.

### 8. Concurrency, lock order, deadlock - **PASS on deadlock**; separate pre-existing finding

**Lock order is consistent.** Every one of the four update functions takes locks in the order *cadastro row first, audit tail last*:

1. `SELECT ... WHERE org_id = ... AND id = ... FOR UPDATE` on the cadastro row (all four, including the one newly **added** to `updateArea`);
2. child-table writes where applicable (`replaceProductFuncaoCosts`, `replacePersonFuncoes`);
3. `writeAuditEntry` -> `SELECT entry_hash FROM audit_log ORDER BY id DESC LIMIT 1 FOR UPDATE` -> `INSERT`, as the last statement before COMMIT.

In `updateFuncao` the audit call is correctly placed **after** the nested-transaction SAVEPOINT returns and **outside** the `catch`, so the global tail lock is never taken inside a subtransaction that may roll away.

The other five `writeAuditEntry` call sites (commissions, conversions, payouts) likewise take the tail last within their own transaction, and none of them touches a `sales_ops_*` cadastro row - so no second shared lock exists between those writers and this one, and no cycle is constructible.

**Verified empirically** with a temporary probe (since removed):

- Two concurrent archives of the **same** row, same org: `0` rejections, exactly **1** ledger entry. The `FOR UPDATE` on the before-read works exactly as the plan claims - the second writer re-reads under the lock, sees `archived`, and `cadastroLifecycleEvent` returns `null`.
- Twelve concurrent archives across **twelve different orgs**: `0` rejections. **No deadlock.**

I can rule out deadlock between two concurrent cadastro archives.

**FINDING (pre-existing, NOT introduced by this slice, NOT a slice-01 failure):**

The twelve-way concurrent probe left the hash chain **broken** (`{valid: false, brokenAt: 2}`). I isolated the cause to unchanged code:

- `writeAuditEntry` is **byte-identical to master** (verified: `md5` of the function body from `git show master:...` equals the md5 of the working-tree version). The diff to `audit/service.ts` adds only two enum members and two new exports.
- A second probe called `writeAuditEntry` **directly**, with zero slice-01 code in the path:

```
SEQUENTIAL chain: {"valid":true,"brokenAt":null}
CONCURRENT rejected (deadlocks?): []
CONCURRENT chain (UNCHANGED writeAuditEntry): {"valid":false,"brokenAt":2}
```

Mechanism: under READ COMMITTED, `SELECT ... ORDER BY id DESC LIMIT 1 FOR UPDATE` serializes writers on the tail row but does **not** re-evaluate the `ORDER BY ... LIMIT` after the block releases, and locks nothing at all when the table is empty. Two writers can therefore both read the same tail and both emit rows carrying the same `prev_hash`.

This is a pre-existing property of the ledger shared by conversions, commissions and payouts. The slice's Frame explicitly scope-limits the chain algorithm as untouched, so this is correctly out of scope here. It nonetheless deserves a `nexo/ROADMAP.md` entry, because **this slice adds four new writers and therefore increases exposure** - a bulk archive, or two admins archiving at once, is a plausible concurrency source where a single human money event was not. The likely fix is an advisory lock or a `SELECT ... FROM audit_log FOR UPDATE` on a dedicated chain-head row rather than on `LIMIT 1`.

### 9. Tenant isolation - **PASS**

- Every new query filters by `orgId`: all four before-reads use `and(eq(table.orgId, orgId), eq(table.id, id))`, and `auditCadastroLifecycle` always passes `actorOrgId: input.orgId` (never null), which is what keeps the row visible to its own tenant in slice 02.
- **The isolation claim is carried on the tenant side, as required.** The oracle drives every write over `TEST_DATABASE_URL` = the `fxl_sales_test` role, confirmed non-privileged:

```
postgres|t|t                 (rolsuper, rolbypassrls)
fxl_sales_test|f|f
```

and RLS is enabled on all four cadastro tables (`sales_ops_areas|t`, `sales_ops_products|t`, `sales_ops_people|t`, `sales_ops_funcoes|t`) and off on `audit_log|f`, exactly as the plan documents. The admin `postgres.Sql` is used only for seeding, raw reads, trigger management and cleanup - never to make an isolation assertion.
- The cross-org test asserts all three halves: the write returns `null`, the área is still `active` on a raw read, and no ledger row carries that `entity_id`.

### 10. CLAUDE.md compliance - **PASS**

| Check | Result |
| --- | --- |
| No DELETE verb added | `git diff master -- apps/api/src \| grep -E "\.delete\(\|salesOpsRouter\.delete"` -> **(none)** |
| No em dash in the diff | added lines: **(none)**; new untracked test file: **(none)** |
| No CHANGELOG / auto-generated file hand-edited | **(none)** |
| Scope confined to `apps/api/**` | `git diff master --name-only \| grep -v "^apps/api/"` -> **(none)**; the only untracked additions are `apps/api/test/rls/cadastro-archive-audit.test.ts` and the nexo run report |
| No `apps/web/**` change | confirmed |
| Files touched match the plan's `files_modified` | yes, all 11, no extras |

Note: `?? .vscode/` was already untracked before this audit began (present in the starting `git status` snapshot) and is not attributable to this slice.

---

## 4. Acceptance criterion

> given an authenticated operator archiving a sales-ops cadastro (produto, pessoa, funcao or area) through its PATCH route, when the status write commits, then exactly one hash-chained audit_log row was appended IN THE SAME TRANSACTION carrying that operator's Hub account id, the caller's org id, the entity type and id, action cadastro.archived, and the before/after status plus a name snapshot - and when either half fails, neither the status change nor the ledger row survives, with verifyChain still reporting the ledger valid.

**MET.** All four entity types produce exactly one entry each with the correct `entity_type` literal, the pt-BR archived-spelling split (`pessoa` -> `inactive`, the other three -> `archived`) is asserted, the actor id and org id come from the verified context, both `label` and `actorLabel` snapshots are present, both rollback directions hold, and `verifyChain` reports the ledger valid after all of it. The atomicity guarantee is proven by an oracle that I confirmed goes red when it is broken.

---

## 5. Tree restoration

- All mutations restored from a byte-exact backup.
- Both probe files deleted (`apps/api/test/rls/zz-verify-probe-concurrency.test.ts`).
- `git diff master --stat` after the audit: `10 files changed, 631 insertions(+), 97 deletions(-)` - identical to the pre-audit snapshot.
- `git status --porcelain` shows exactly the same 10 modified files and 3 untracked entries as at the start.
- No process was left running; no long-lived server, watcher or worker was started (every test invocation was `vitest run`).
- Nothing was ever run against `DATABASE_URL` (staging). All DB access went to `localhost:5006` via `TEST_DATABASE_URL` / `ADMIN_DATABASE_URL`.

## 6. Carry-forward for the milestone

1. **`nexo/ROADMAP.md`**: the `writeAuditEntry` hash-chain race under concurrent writers (point 8). Pre-existing, in unchanged code, but this slice widens the exposure.
2. **Plan correction worth recording**: the plan's assertion 8 does *not* catch `db`-for-`tx`; the deferred constraint-trigger test the implementer added does. Slices 02-04 should not "simplify" that test away.
3. **Known-weak assertion**: the "failing status write leaves no ledger entry" test passes vacuously in isolation. Keep assertion 1 in the same file alive as its backstop.
