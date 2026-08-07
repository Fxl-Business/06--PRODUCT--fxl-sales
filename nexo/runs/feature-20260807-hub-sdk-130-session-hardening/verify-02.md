# VERDICT: PASS

Slice `02-session-absolute-ttl`, branch `feat/02-session-absolute-ttl`, commit `c5a44d6`, baseline `master`.
Verified independently: the plan, the SDK's own `dist/server.js`, the diff, the live test database, and five source mutations.
Neither `notes-02.md`, `notes-01.md` nor any `agents/exec-*.result.json` was read.

## Command results

| Command | Result |
| --- | --- |
| `pnpm run type-check` | PASS (exit 0) |
| `pnpm run lint` | PASS (exit 0) |
| `pnpm test` | PASS - shared-utils 3 files / 80 tests, api 37 files / 373 tests, web 48 files / 611 tests |
| `pnpm run build` | PASS (exit 0) |
| `pnpm --filter @fxl-sales/api test:integration` | PASS - 24 files / 161 tests |

All five were run once each before any mutation, and all five were re-run once after every mutation was reverted.
Both passes were identical and green.
No watcher or persistent process was started.

## Mutation results

Every mutation was applied to `apps/api/src/auth/hub-session-store.ts` and reverted from a byte-identical backup.
The file's SHA-1 is `7d87a6ad83c9c23e31c62d7050a10cab5ae4aaab` before the first mutation and after the last one, and `git diff --stat` on the file is empty.

| # | Mutation | Expected | Observed | Reverted |
| --- | --- | --- | --- | --- |
| 1 | Add `absoluteExpiresAt: new Date(this.#now().getTime() + SESSION_ABSOLUTE_TTL_MS)` to `update`'s `.set({...})` (line 205) | Constraint-2 oracles go red | **RED at both layers.** Unit `does not extend the absolute expiry when the SDK spreads the record back into update` - `AssertionError: expected true to be false` at `hub-session-store.test.ts:275`. Integration `does not move absolute_expires_at when a rotation slides expires_at` - `expected '2026-11-06 16:22:21.154+00' to be '2026-11-05 16:22:21.151+00'` at `hub-bff-session-store.test.ts:330` | yes, verified |
| 2 | Expiry predicate reduced to `if (row && row.expiresAt.getTime() <= now)` (line 181) | Absolute-only-expiry oracles go red | **RED at both layers.** Unit `deletes the row inside the transaction and reports absent when only the absolute expiry has passed` - `expected { hubRefreshToken: 'token-old', …(2) } to be null`. Integration `treats a session past only its absolute expiry as absent and deletes the row inside the transaction` - `expected [ Array(1) ] to have a length of +0 but got 1` | yes, verified |
| 3 | Sweep `.where(...)` reduced to `lte(hubBffSessions.expiresAt, now)`, dropping the `or(...)` (line 329) | The nightly-sweep OR branch goes red | **RED.** Integration `removes rows expired by either timestamp and keeps a row expired by neither` - `expected 1 to be greater than or equal to 2` at `hub-bff-session-store.test.ts:428`, and the `cappedSid` row survives | yes, verified |
| 4 | `toSessionRecord` hands back the raw Drizzle `Date` instead of `.toISOString()` (line 89) | The constraint-6 oracle goes red | **RED, two tests.** `hands the SDK both expiries as ISO strings the SDK can Date.parse` and `does not extend the absolute expiry…` both fail with `expected 'object' to be 'string'` | yes, verified |
| 5 | Delete `absoluteExpiresAt` from `create`'s `.values({...})` (line 147) | Compile error, per the migration's own claim | **RED at the type layer.** `src/auth/hub-session-store.ts(131,45): error TS2769: No overload matches this call.` | yes, verified |

No mutation left the suite green.
Mutations 1, 2 and 4 are each killed independently at BOTH the unit and the integration layer, so neither layer is carrying the other.

## Findings against checks 1-8

### 1. Non-vacuity by mutation - PASS

Covered by the table above.
Two observations beyond the requested mutations:

- The unit oracle at `apps/api/src/auth/__tests__/hub-session-store.test.ts:275` asserts key ABSENCE (`expect('absoluteExpiresAt' in setArg!).toBe(false)`), not value equality, which is what makes mutation 1 fail even though the mutation writes a value that is *later* than the stored one rather than earlier. A value-equality assertion would have been weaker.
- Line 279 of the same test is the non-vacuity half: it asserts `setArg!.expiresAt` did move to `FROZEN + SESSION_TTL_MS`, so the test cannot be satisfied by an `update` that writes nothing at all.
- The unit test also asserts at line 269 that `get()` really did hand the operation a string `absoluteExpiresAt`, so the hazard being guarded is proven to exist rather than assumed.

### 2. Is `absoluteExpiresAt` structurally unwritable on update? - PASS

`apps/api/src/auth/hub-session-store.ts:196-215`.
The `.set({...})` object literal contains exactly four keys: `hubRefreshTokenEnc`, `accountId`, `expiresAt`, `updatedAt`.
`absoluteExpiresAt` is absent from the object entirely, not present-with-the-old-value, and there is no spread of `record` into the object that could reintroduce it.
The reason is stated in a comment at lines 206-211 in the mirror-image form the plan requires, beside the sliding rationale at 202-204.

The column is written in exactly ONE place in the repository.
A repo-wide grep for `hubBffSessions` outside tests and `schema.ts` returns only `hub-session-store.ts`; the only `insert(hubBffSessions)` is line 131 and the only raw `INSERT INTO hub_bff_sessions` statements are in the RLS test file.

### 3. The Date-versus-string boundary - PASS

Verified against the actual installed SDK rather than the plan's account.
The resolved package is `@fxl-business/hub-sdk@1.3.0` under a pnpm patch (`patch_hash=8f8d…a96e9`); the patch only rewrites `package.json` entry points from `src/*.ts` to `dist/*`, so `dist/server.js` is the real runtime.

- `dist/session-store-COrln4Ro.d.ts:1-6` types `HubSessionRecord.expiresAt?: string` and `.absoluteExpiresAt?: string`.
- `dist/server.js:424` and `:483` are the SDK's own gates and read both with `Date.parse`.
- `dist/server.js:464` (`/auth/refresh`) and `:519` (`/auth/switch`) are the `await tx.update({ ...record, hubRefreshToken: rotated })` spread the plan describes, confirmed verbatim.

The conversion happens in exactly one place, `toSessionRecord` at `hub-session-store.ts:84-91`, and `tx.get` (line 195) is its only caller.
Nothing anywhere parses an SDK string back into a `Date`, so there is no second half to drift.
It is pinned by `hands the SDK both expiries as ISO strings the SDK can Date.parse` (`hub-session-store.test.ts:336-352`), which asserts `typeof === 'string'` for both fields, `Number.isFinite(Date.parse(...))`, and round-trip equality of both parsed values.
Mutation 4 proves it is load-bearing.
I checked what the store actually hands the SDK (line 89: `row.absoluteExpiresAt.toISOString()`), not the comment.

### 4. The migration - PASS

`apps/api/drizzle/0021_hub_session_absolute_ttl.sql`.

- **Not phased.** `grep -c "fxl-migration-mode: phased\|fxl-phase:"` prints `0`. `apps/api/src/db/migration-runner.ts:71` hardcodes `const phasedTag = '0018_professional_payable_identity'`, and line 230 throws `phased migration tag is not supported` for any other tag carrying the header. 0021 therefore takes the ordinary path at `migration-runner.ts:595-603`, which runs every statement of one migration inside a single `runCheckedTransaction`. That is what makes the transaction-local `set_config` on line 44 hold across lines 45-46, and it is also why the setting cannot leak into a neighbouring migration (each migration gets its own transaction).
- **Backfill derives from `created_at`, not `now()`.** Line 45: `SET "absolute_expires_at" = "created_at" + interval '90 days'`. `now()` appears nowhere in the file.
- **`NOT NULL` cannot fail on existing rows.** The `UPDATE` on line 45 has `WHERE "absolute_expires_at" IS NULL`, which after the `ADD COLUMN` on line 43 is every row, and it precedes the `SET NOT NULL` on line 46 inside the same transaction. There is deliberately no column default, which is what makes mutation 5 a compile error rather than a silently uncapped session.
- **`app.fxl_admin` config line present.** Line 44, `SELECT set_config('app.fxl_admin', 'true', true)`, third argument `true` = transaction-local. Confirmed necessary: the live table shows `Policies (forced row security enabled): POLICY "hub_bff_sessions_admin_context" USING (current_setting('app.fxl_admin', true) = 'true') WITH CHECK (same)` and no other policy.
- **Actually applied to the test database.** Inspected live rather than inferred. `docker exec 06--product--fxl-sales-db-1 psql -U postgres -d fxl_sales -c "\d hub_bff_sessions"` shows `absolute_expires_at | timestamp with time zone | not null |` with an empty Default column, plus index `hub_bff_sessions_absolute_expires_at_idx btree (absolute_expires_at)` alongside the pre-existing `hub_bff_sessions_expires_at_idx`. `drizzle.__drizzle_migrations` carries `created_at = 1786119231814`, which matches the `when` on the journal's `idx: 21` entry exactly.
- **Journal and snapshot.** `_journal.json` ends with `{"idx": 21, "version": "7", "when": 1786119231814, "tag": "0021_hub_session_absolute_ttl", "breakpoints": true}`. `meta/0021_snapshot.json` chains correctly (`prevId` equals `0020_snapshot.json`'s `id`), lists `absolute_expires_at` with `"notNull": true` and no default, and carries both indexes - so it is generated, not hand-written, and a future `db:generate` will not emit a spurious migration.

### 5. TTL values - PASS

`hub-session-store.ts:47` `SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000`; line 63 `SESSION_ABSOLUTE_TTL_MS = 90 * 24 * 60 * 60 * 1000`.
The SDK's defaults were read from the installed bundle, not taken on trust: `dist/server.js:324-325` is `options.sessionTtlSeconds ?? 7776e3` and `options.sessionAbsoluteTtlSeconds ?? 31536e3`, i.e. 90 days sliding and 365 days absolute.
Neither default is inherited.

Both are passed to `createHubBff` at `apps/api/src/middleware/app-auth.ts:219-227` as `sessionTtlSeconds: SESSION_TTL_MS / 1000` and `sessionAbsoluteTtlSeconds: SESSION_ABSOLUTE_TTL_MS / 1000`, derived from the store's own constants so the two views cannot diverge.
Pinned twice by `wires the SDK session TTLs to the store constants so the two views cannot disagree` (`app-auth-bff-wiring.test.ts:169-180`): once against the imported constants and once against the literals `2_592_000` and `7_776_000`, so deleting either option and falling back to the SDK's `7_776_000` / `31_536_000` fails even if the first pair of assertions were reduced to a tautology.
`keeps the session TTL at 30 days and caps it with a 90-day absolute TTL` additionally asserts `SESSION_ABSOLUTE_TTL_MS > SESSION_TTL_MS`, so the pair cannot be inverted.

### 6. The nightly sweep - PASS

`deleteExpiredHubBffSessions` at `hub-session-store.ts:319-336` deletes on `or(lte(expiresAt, now), lte(absoluteExpiresAt, now))` (line 329).
`apps/api/src/jobs/nightly-job.ts:83` still delegates through `runHubSessionCleanup`, unchanged, as the plan said it would be.

The OR branch specifically is proven by the third session row in `removes rows expired by either timestamp and keeps a row expired by neither` (`test/rls/hub-bff-session-store.test.ts:408-440`): `cappedSid` is inserted with `expires_at = now() + interval '29 days'` and `absolute_expires_at = now() - interval '1 second'`, i.e. sliding expiry in the future, ceiling in the past, and is asserted gone at line 434.
Mutation 3 confirms that row is the sole thing standing between the `or(...)` term and a green suite.
The live/live row is asserted to survive, so the sweep is not simply over-deleting.

### 7. Regression on slice 01 - PASS

All of slice 01's oracles are present and green in the runs above:

- Row lock spanning read and write: `serializes two concurrent refreshes on one session id so no rotation is lost` (`test/rls/hub-bff-session-store.test.ts:135`), `does not block a different session id while one row lock is held` (:194), `rolls back the update and rejects when the operation fails after writing` (:227), and `rejects with HubSessionStoreUnavailableError when the row lock cannot be taken, and never runs the operation` (`src/auth/__tests__/hub-session-store.test.ts:169`). The `SELECT ... FOR UPDATE` at `hub-session-store.ts:164-169` is still taken before `operation` runs and the update/delete handles still use the same `tx`.
- 503-not-401 on store outage: `answers 503 with the session cookie intact when the store is unavailable, through the double route() mount server.ts uses` and `answers 503 when the router is requested directly as well` (`src/auth/__tests__/hub-bff-errors.test.ts:46, :72`), plus the anti-oracle at :123. The single `catch` at `hub-session-store.ts:223-229` is untouched.
- PKCE single-use: `consumes a login transaction exactly once across instances` and `deletes an expired login transaction on consume and returns null` (`test/rls/hub-bff-session-store.test.ts:354, :371`). `consumeLoginTransaction` (lines 251-275) is byte-unchanged by this slice; `hub_bff_login_txns` is correctly not touched by the migration.
- Sliding-TTL behaviour: `slides expires_at on update instead of persisting the expiresAt the SDK hands back` (:265) and `treats an expired session as absent and deletes the row inside the transaction` (:252) both survive unchanged, and mutation 2 shows the sliding term was not sacrificed to make the absolute one work.
- The store-instance identity and `timeoutMs` assertions in `app-auth-bff-wiring.test.ts` are all still present (:147, :152, :162); the slice added an option, it did not replace the options object.

### 8. Scope - PASS

`git diff master...HEAD --name-only` returns exactly the ten files in the plan's `files_modified`, plus `nexo/runs/.../notes-02.md`.
No web file, no job file, no schema table other than `hub_bff_sessions`.
A grep of the source diff for `supersede`, `prior session` and account-scoped deletion finds nothing in `apps/`, `packages/` or `CLAUDE.md`; the only textual hit anywhere is one prose line inside the notes file, which is not code.
`accountId` appears in the diff only as the existing column being carried through `toSessionRecord` and the test fixture.
Slice 06's behaviour is not implemented here.

The `CLAUDE.md` edit matches the plan's dictated text and correctly replaces the single-expiry sentence rather than appending beside it.

## Green but concerning

None of these blocks the verdict; all are for whoever ships and deploys.

1. **The migration's safety argument has a stated expiry date.** The comment at lines 16-19 says the `created_at + 90 days` backfill only cannot land in the past while the oldest row is under 90 days old, and names `2026-11-01` as the re-check date. Today is 2026-08-07, so the argument holds, but if this milestone slips roughly three months the backfill silently becomes a mass logout. Nothing in code enforces the date - it is a comment.
2. **The rolling-deploy window is real and unguarded.** With no column default, an old replica still running the slice-01 `create` will hit the new `NOT NULL` and fail. It surfaces as a `503` from `hubBffErrorHandler` rather than a cookie-clearing `401`, so no live session is harmed and a retry succeeds, but for the overlap window a NEW login can fail. The plan accepts this explicitly; it is worth restating in the release notes because there is no test that covers it and no runtime mitigation.
3. **90 days after deploy is a synchronized re-login wave.** Every session created around ship day reaches the ceiling within days of the others. Intended, and called out in the plan, but it means the first real exercise of this code path is a spike, not a trickle.
4. **The SDK is consumed through a pnpm patch.** The patch rewrites entry points from `src/*.ts` to `dist/*`, so every line number cited in the store's comments (`dist/server.js:324`, `:424`, `:464`, `:483`) refers to bundled output that a future SDK republish could renumber without changing behaviour. The comments would then be misleading while every test stayed green. The assertions themselves do not depend on those numbers, so this is documentation drift only.
5. **The unit test's fake `db` is untyped.** `fakeDb`'s `insert().values()` accepts `Record<string, unknown>`, so the unit suite alone would not catch a forgotten column at `create`. The compile-error guarantee rests entirely on the real call site's Drizzle inferred insert type, which mutation 5 confirms actually holds (`error TS2769` at `hub-session-store.ts(131,45)`). Worth knowing that `pnpm run type-check`, not `pnpm test`, is the thing enforcing it.

## Working tree

Left exactly as found.
`apps/api/src/auth/hub-session-store.ts` SHA-1 `7d87a6ad83c9c23e31c62d7050a10cab5ae4aaab`, matching the pre-mutation backup.
`git status --short` shows only the pre-existing `M nexo/runs/.../budget.json`, `?? .vscode/` and `?? nexo/runs/.../agents/exec-02.result.json`, none of which this verification created.
No process was left running.
