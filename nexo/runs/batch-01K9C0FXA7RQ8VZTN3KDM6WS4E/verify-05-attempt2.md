# Verify (Gate 2) - slice 05-pessoas-funcoes-api - attempt 2

Verdict: **PASS**

Branch `feat/05-pessoas-funcoes-api`, one commit `69feb51` on `master` (`d93fce1`).
Attempt 1 was `866d6ca`.
This pass was run adversarially and independently; the previous report was read only after forming the findings below, and every previously-verified property was re-derived rather than assumed, because `service.ts` genuinely changed between attempts.

## 1. Gates

All four run on a clean tree at `69feb51`, after every probe and mutation was reverted.

| Gate | Exit |
| --- | --- |
| `pnpm run lint` | 0 |
| `pnpm run type-check` | 0 |
| `CI=true pnpm test` | 0 |
| `pnpm --filter @fxl-sales/api test:integration` | 0 |

Counts against the stated branch-point baseline:

| Suite | Baseline | Branch | Delta |
| --- | --- | --- | --- |
| api unit | 23 files / 215 tests | 24 / 248 | +1 file, +33 tests |
| api integration | 13 / 47 | 16 / 73 | +3 files, +26 tests |
| web | 28 / 181 | 28 / 181 | unchanged |
| shared-utils | 1 / 17 | 1 / 17 | unchanged |

Nothing was removed. Only additions.
The `pnpm test` tracked-file guard for the removed auth provider ran green.

`apps/api/test/rls/setup-env.ts` is byte-identical to `master` and the hard override is intact: `process.env.DATABASE_URL = appUrl` (assignment, not `??=`) at line 21.
This matters concretely here, because `apps/api/.env` `DATABASE_URL` points at `fxl-db-server/fxl_sales_stg_db` (staging) while `TEST_DATABASE_URL` points at `fxl_sales_test@localhost:5006`.
`apps/api/vitest.config.ts` and `apps/api/package.json` are also untouched, so the wiring that loads `setup-env.ts` as a `setupFile` cannot have been bypassed.

## 2. The three defects

Every fix was reproduced against the current code, then the mutation that reintroduces it was applied and watched go Red.

### Defect 1 - `createFuncao` / `updateFuncao` TOCTOU raising 23505 as HTTP 500

**Fixed.**

My own probe (not the shipped test): 90 genuinely concurrent same-name `createFuncao` calls in **one** org, pool of 24.

```
P1 unhandled=0  winners=1  duplicate=89  duplicate_slug=0  rows=["desenvolvedor"]
```

Zero unhandled errors, exactly one row written, 89 clean sentinels.
For comparison the previous pass measured 60 of 90 raising unhandled `23505`.

Both 409 reasons remain independently reachable.
Sequentially: same name gives `duplicate`; a different display name that slugifies to the same key (`"Product  Owner"`, `"product owner"` against an existing `"Product Owner"`) gives `duplicate_slug`.
Under concurrency: my 90-way rename probe produced 66 `duplicate` and 21 `duplicate_slug`, so the constraint-name mapping resolves both branches under real load, not just in the pre-check.

`updateFuncao`, 30 funções x 3 concurrent renames onto one target name:

```
P3 unhandled=0  winners=3  duplicate=66  duplicate_slug=21  rows=30  named=1  slugged=1
```

Losers are left whole, not half-renamed.

**Mutation M1** - revert `createFuncao` to the plain INSERT (`.returning(); return funcao!`):
`× resolves concurrent createFuncao calls ... expected [ ...(36) ] to deeply equal []`.
36 of 48 calls raised unhandled `23505`.
Only that one test reddened.

**Mutation M2** - remove the `SAVEPOINT` and the violation mapping from `updateFuncao`:
`× resolves concurrent updateFuncao renames ... expected [ ...(18) ] to deeply equal []`.
Only that one test reddened.
The two guards are therefore independent.

### Defect 2 - incomplete conflict arbiter on the on-demand legacy seed

**Fixed.**

I verified the implementer's empirical characterisation rather than accepting it, by running both shapes against the **mutant** (the narrow `{ target: [orgId, slug] }` arbiter restored):

| Shape | Runs reproducing | Unhandled per run |
| --- | --- | --- |
| 30 orgs x 5 parallel (150 calls) | **6 of 6** | 4, 5, 6, 6, 9, 9 |
| 4 orgs x 24 parallel (96 calls) | 3 of 6 | 0, 0, 0, 1, 2, 0 |

Every failure was exactly `23505` on `sales_ops_funcoes_org_name_idx`, which is precisely the diagnosed defect.
The directional claim is confirmed: the race window is per fresh org and closes as soon as the org has its funções, so multiplying fresh orgs reproduces far more reliably than concentrating attempts per org.
The literal "0 of 96" is slightly optimistic on my hardware (it is low-probability, not zero), which strengthens rather than weakens the case for the shipped 30 x 5 shape.

Against the **current** code, the same two shapes over 6 consecutive runs each (1476 calls total):

```
P7 (4x24=96)  unhandled=0   x6
P8 (30x5=150) unhandled=0   x6   sentinels=0
```

Zero unhandled, and zero spurious sentinels: every person was created carrying all three funções with all three mirrors true.

### Defect 3 - `PATCH /people/:id` stopped clearing `contactEmail`

**Fixed.**

I checked the client myself rather than taking the claim.
`apps/web/src/sales-ops/SalesOpsApp.tsx:3425` builds `contactEmail: contactEmail.trim() || undefined`, and `apps/web/src/sales-ops/api.ts:72` sends `JSON.stringify(body)`, which drops an `undefined` key.
The claim holds. I printed the actual serialized wire body:

```
P6 wire body = {"displayName":"Sig","status":"active","isSeller":true,"isFinder":false,"isCollaborator":false}
```

The key is absent, not present-and-empty. Driving that exact body through `UpdatePersonSchema.parse` into `updatePerson`:

```
P6 omitted-key => returned=null stored=null funcoes=["vendedor"]
P6 present-and-empty => null
```

Both the returned row and the stored `contact_email` column are cleared, and the função set is undisturbed.
Present-and-empty (`contactEmail: ''`) also clears.
A real address still round-trips.

**Mutation M4** - reinstate the conditional spread:
`× expected 'sig@example.com' to be null`, in both the shipped test and my independent probe.

## 3. Ruling on the two-test approach for defect 2

**Legitimate.**

Applying the narrow-arbiter mutation and running the shipped file five consecutive times, **both** tests fail on **all five** runs:

```
× absorbs a seed conflict on the name index, which a slug-only arbiter cannot see        (5/5)
× resolves concurrent first person writes in a freshly provisioned org ...               (5/5)
```

So the deterministic guard is not carrying the load alone.
The realistic 30-org race test is itself a deterministic reproducer of this mutant, and my independent probe reproduced it 6 of 6.
The deterministic guard is a legitimate second oracle rather than a contrivance, for two reasons:

- It exercises exactly the property the fix changes, namely whether the conflict clause can see a violation on a non-arbiter unique index. It cannot pass while the real defect returns, because the real defect *is* the narrow arbiter, and the narrow arbiter fails this test with zero timing dependence.
- The state it constructs (a row holding the seed's `name` but not its `slug`) is genuinely unreachable through the API, which is why it needs the admin client, and the test says so. I confirmed the unreachability: `slugifyFuncao` derives the slug from the name on both create and rename, so name and slug always move together, and `createFuncao` rejects the two reserved slugs outright.

The implementer's note that its *first* concurrency test survived the mutation refers to the weaker 4 x 24 shape, which my measurements independently show to be a poor reproducer. Replacing it was the right call.

## 4. Did the fixes introduce new problems?

I examined each of the three specific risks named in the brief. None is a defect.

**The `onConflictDoNothing()` plus re-probe path in `createFuncao`.**
The bare clause can only fire on `(org_id, name)`, `(org_id, slug)`, `(org_id, id)` or the pkey; the last two are fresh `gen_random_uuid()` values, so only the two meaningful indexes are reachable.
Both unique indexes include `org_id`, so a same-name row in **another org** cannot conflict. Verified empirically: two orgs both hold `"Compartilhado"`, and a cross-org rename onto a name only the other org holds succeeds (`P4`).
The re-probe runs with no `excludeId`, which is correct because nothing was inserted.
If the racing writer has not yet committed, the re-probe finds nothing and the `?? 'duplicate'` fallback still yields a 409 rather than a false success. It can never return success when nothing was written, because that branch is gated on `if (funcao) return funcao`.
There is no loop, so no re-probe storm.
The only theoretical wart is a spurious 409 if the racing transaction later aborts; that is a deliberate and correct trade against a retry loop.

**The `SAVEPOINT` in `updateFuncao`.**
I read the driver rather than assuming. drizzle-orm 0.45.2 `PostgresJsTransaction.transaction` delegates to postgres.js `sql.savepoint`, and postgres.js `scope()` issues `savepoint sN`, then on **any** throw issues `rollback to sN` and rethrows.
So the savepoint is rolled back on every failing path, including unexpected errors, and the outer transaction stays usable.
postgres.js does not emit `release savepoint` on success, but exactly one savepoint is created per `updateFuncao` call and each call is its own short `withTenant` transaction, so nothing accumulates.
Confirmed empirically over 20 rounds of forced contention: 0 backends left `idle in transaction`, both rows readable and distinct, no half-written state (`P5`).
A non-unique error is rethrown, not swallowed.

On brittleness of constraint-name matching: it **is** tightly coupled to the index names, but it is **guarded**.
**Mutation M2b** renamed the two keys in `FUNCAO_UNIQUE_VIOLATIONS` to simulate a renamed index, and the `updateFuncao` concurrency test went Red immediately. A rename therefore cannot silently turn a 409 back into a 500; it reddens `test:integration`.
I also confirmed the live catalog carries exactly `sales_ops_funcoes_org_name_idx` and `sales_ops_funcoes_org_slug_idx`.

**Restoring the unconditional `contactEmail: data.contactEmail || null`.**
This is byte-for-byte the pre-slice semantic, so it cannot regress any path relative to `master`.
It does mean a `funcaoIds`-only PATCH clears the e-mail; I confirmed that behaviour directly and the code documents it in a comment for the later slices. It does not interact badly with the funções set-replace: after a `funcaoIds`-only patch the função set and all three mirrors were correct.
Since `apps/web` is untouched by this slice, current UI behaviour equals `master` behaviour exactly.

**Flakiness.**
Four consecutive full integration runs plus one earlier run, five total, all `16 files / 73 tests` passing, exit 0 every time.
The concurrency tests are not flaky.

## 5. Previously-verified properties, re-derived

**Tenancy filters.**
- Deleting `listFuncoes`'s `eq(orgId)` reddens `scopes every funções and pessoas read by orgId even when RLS is not doing the scoping`. Red.
- Deleting `resolvePersonFuncoes`'s ids-branch `eq(orgId)`, the security-critical cross-org `funcaoId` filter, reddens the same test. Red.
- Deleting `attachPersonFuncoes`'s `salesOpsPersonFuncoes.orgId` filter survives. This is a **provably equivalent mutant**, not a gap: the composite FK `(org_id, person_id) references sales_ops_people(org_id, id)` against the UNIQUE `(org_id, id)` index means a given `person_id` can only ever pair with its own `org_id`, and the caller already org-scopes the `people` array, so filtering on `person_id` alone is equivalent. The join to `sales_ops_funcoes` still carries `eq(orgId)` in its ON clause. This is presumably the same fifth filter the previous pass classified the same way.

**Mirrors cannot drift.**
Four mutations: hardcoding `isCollaborator` false (Red, 2 tests), dropping the recompute on update (Red), and making `replacePersonFuncoes` merge instead of replace (Red, 2 tests).
One survived and is recorded as a coverage gap in section 8.

**Migration replay and `db:generate` drift.**
`drizzle-kit generate` reports `No schema changes, nothing to migrate`, and `git status apps/api/drizzle/` is empty. No drift.
Replayed all 13 migrations onto a throwaway `fxl_verify_replay` database and diffed the normalized schema-only `pg_dump` against the live test DB: **identical**, sha `28875d07e42234f2201dff4f94df9c7663ddf56c` both sides (the only raw difference was pg_dump's random `\restrict` nonce).
The throwaway database was dropped; `pg_database` is back to `fxl_sales` plus the templates.

**`is_system` protected at DB level.**
The CHECK constraint is present in the live catalog as `CHECK (NOT is_system OR slug = ANY (ARRAY['vendedor','finder']))`.
Raw superuser SQL is rejected on **both** INSERT and UPDATE.
The service-level guards are also independently guarded: removing the immutability check in `updateFuncao` reddens the rename/archive test (M7a), and removing the reserved-slug check in `createFuncao` reddens the reserved-slug test (M7b).

**Composite FK still load-bearing.**
Downgraded `sales_ops_person_funcoes_org_funcao_fk` to a single-column `FOREIGN KEY (funcao_id)` in the live test DB: the cross-org assignment test went Red.
Restored to the exact composite definition and verified against the migration text.

**Backfill.**
All 8 `funcoes-schema-migration` tests green, including the seller+finder person landing as ONE pessoa with BOTH funções, the prestador non-system bucket, the union org registry, idempotency across three replays, and every pre-existing sellers/finders/propostas FK resolving unchanged.

## 6. Anti-gaming

`git diff master..feat/05-pessoas-funcoes-api -- '*test*' | grep '^-'` returns **nothing**.
The test diff is purely additive. No line was removed from any pre-existing test file.
No `.only`, `.skip`, `.todo`, `xit`, or `xdescribe` was added.
The change to the pre-existing `apps/api/src/domains/sales-ops/__tests__/routes.test.ts` is four new service mocks, two new fixtures, and two new `describe` blocks. Every pre-existing assertion is untouched.

## 7. Scope and contract

- `git diff master.. -- 'apps/web/**'` is empty. `apps/web` untouched.
- No file matching `sellers`, `finders`, `payables`, or `receivables` is touched. The affiliate tables and routes are untouched; the `schema.ts` diff is purely additive.
- The `service.ts` diff touches only imports, `PersonFieldsSchema`, the new funções block, the people/funções functions, and an additive extension of `getSalesOpsSnapshot`. No line in the diff mentions payables, receivables, transitions, installments, recurring blocks, or the `"N/M"` / `"MN/M"` conventions.
- No DELETE verb anywhere in the sales-ops router, and there is a test pinning that.

**API contract unmoved.** Every contract-carrying file is **byte-identical** between attempt 1 (`866d6ca`) and attempt 2 (`69feb51`), verified by object hash:

```
IDENTICAL  apps/api/src/domains/sales-ops/routes.ts
IDENTICAL  apps/api/src/db/schema.ts
IDENTICAL  apps/api/drizzle/0012_sales_ops_funcoes.sql
IDENTICAL  apps/api/drizzle/meta/0012_snapshot.json
IDENTICAL  apps/api/drizzle/meta/_journal.json
IDENTICAL  apps/api/src/domains/sales-ops/__tests__/funcoes-contract.test.ts
IDENTICAL  apps/api/src/domains/sales-ops/__tests__/routes.test.ts
```

The attempt-to-attempt diff is confined to `service.ts` internals plus two test files.
Table names, column names, endpoint shapes and the five 409/400 reason codes (`funcao_name_taken`, `funcao_slug_taken`, `funcao_is_system`, `reserved_funcao_slug`, plus the person `unknown_funcao` / `funcao_required`) are unchanged.
Slices 07, 09 and 12 are safe.

## 8. Correctness review

No real defects found. Observations, none blocking:

1. **Coverage gap, shipped code correct.** Replacing `...deriveBooleanMirrors(resolved)` in `createPerson` with the raw request booleans survives the whole suite. No test asserts the derived mirrors on a `funcaoIds`-based **create**; `funcoes-rls.test.ts:337` asserts only `funcaoIds`. The `updatePerson` path is fully covered (`:386-395`), including the recompute-not-merge property. The shipped code is right, and the uncovered path is not reachable from the shipped UI, which sends booleans. Worth one assertion in a later slice.
2. **Equivalent mutant**, stated explicitly: the `attachPersonFuncoes` `orgId` filter is redundant given the composite FK plus caller-side scoping. Defense in depth, correctly kept.
3. **Guarded brittleness**: `mapFuncaoUniqueViolation` is coupled to index names and to the driver placing `constraint_name` one level down under `cause`. Both are version-coupled, and both are caught by the integration gate (M2b).
4. **Pre-existing pattern, out of scope**: `PATCH /funcoes/:id` passes `c.req.param('id')` straight to a `uuid` column, so a malformed id yields 22P02 as a 500. `master` does exactly this on `people`, `products`, `clients` and `areas`. Changing it here would be an unrequested contract change.
5. A post-0012 org has no funções until its first legacy-boolean person write, so `GET /funcoes` returns `[]` for a brand-new org. This is self-reported deviation (b) and I concur it is acceptable: `funcaoIds` cannot be a first write since it requires existing rows, and `createFuncao` cannot mint the reserved slugs, so nothing bypasses the seed.
6. Style only, not FAIL material: `getFuncao` is exported but unrouted (staged for 07/09); an empty `PATCH` on a system função bumps `updated_at` as a no-op; archived funções remain assignable.

No `any` casts in production code (the only `any` match in the diff is the word "any" inside a comment).
No swallowed errors.
`setTenantContext` uses `set_config(..., true)`, transaction-local, correct under pooling.
Hot paths are indexed: `(org_id, person_id, funcao_id)` covers the `attachPersonFuncoes` prefix, `(org_id, name)` covers `listFuncoes`, and `(org_id, funcao_id)` supports the ON DELETE RESTRICT lookup.
Zod rejects a malformed `funcaoId` (400) and the service rejects a cross-org one (`unknown_funcao`, 400), both proven by mutation.

**Commit hygiene.** One commit. Conventional Commit (`feat(sales-ops): ...`). No co-author trailer, no AI attribution, no trailers at all. No em dash in any added line or in the commit message.

## 9. Acceptance criterion

Proven, clause by clause.

| Clause | Evidence |
| --- | --- |
| Every org has the two immutable system funções | Migration 0012 seeds per org from the union of people/settings/sales; `funcoes-schema-migration` tests, including the sales-only and settings-only orgs |
| Every legacy person is ONE pessoa with the matching funções | `backfills a person who is both seller and finder as ONE pessoa with BOTH funções`; re-confirmed green |
| Seller+finder carries both | same test, asserts `['finder','vendedor']` on a single person id |
| Dynamic funções created and renamed through admin-gated CRUD | `routes.test.ts` 403 cases for `seller`/`finder`/anonymous on POST and PATCH; `funcoes-rls` CRUD tests |
| The two system funções cannot be | M7a/M7b both Red; plus the DB CHECK rejecting raw SQL on INSERT and UPDATE |
| No cross-org read or write of funções or assignments | M5a and M5c both Red; composite FK downgrade Red; raw RLS test |
| Every pre-existing FK and endpoint still resolves | `leaves the legacy boolean columns and every sales person FK intact`; full integration suite green including the finders/sellers cross-tenant files |

## 10. Restoration

- Every mutation was applied one at a time and reverted from a pristine copy taken before any edit.
- `git hash-object` on all five probed files matches the baseline recorded before any mutation, exactly.
- `git diff` against `69feb51` is empty. The working tree is clean.
- The throwaway probe file `apps/api/test/rls/zzprobe-verify.test.ts` was deleted.
- `git status` matches what I found at the start: the same four untracked paths (`.vscode/`, the two `nexo/.../agents/*.json` result files, and `nexo/.../verify-05.md`). Nothing else. Still on `feat/05-pessoas-funcoes-api`; nothing merged, pushed, committed or amended.
- Database left working and clean. The downgraded FK was restored to the exact composite definition and the normalized catalog dump re-hashes to `28875d07e42234f2201dff4f94df9c7663ddf56c`, identical to before my probes. The throwaway `fxl_verify_replay` database was dropped. All sales-ops tables are at 0 rows, no `org_vprobe%` or `org_verify_probe` fixtures remain, and `pg_roles` holds only `fxl_sales_test` and `postgres`, no probe roles.
- Every test invocation was run-once (`vitest run`, `CI=true`). No watcher, dev server or background process was left running.
