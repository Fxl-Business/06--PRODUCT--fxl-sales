# Verify report, round 2 - slice 01 durable BFF session store

- Slice: `01-durable-bff-session-store`
- Branch: `feat/01-durable-bff-session-store` (staged, uncommitted)
- Auditor: independent Nexo VERIFY sub-agent, round 2
- Started: 2026-08-03T15:12:40Z
- Ended: 2026-08-03T15:22:36Z
- **Verdict: PASS**

All four repairs called out by the round-1 audit were verified independently by experiment.
Every experiment was a mutation test: the repair was broken on purpose, the suite was observed RED, the file was restored byte for byte, and the suite was observed GREEN again.
No claim in the implementer's own reports was read or relied on; `nexo/runs/` was not opened.

---

## Summary table

| # | Repair | Method | Result |
| --- | --- | --- | --- |
| A | Blank `HUB_SESSION_ENCRYPTION_KEY` no longer breaks boot | 4 real server boots + 1 pre-fix control | PASS |
| B | session-crypto tamper test is deterministic | 20 consecutive runs of the file | **20/20 PASS** |
| C | Deleting `sessionStore: session.store` is caught | 2 mutations of `app-auth.ts` | PASS (RED then GREEN) |
| D | `hub-session-scope.ts` 503 rule is pinned | 7 mutations of the middleware | PASS, non-vacuous |
| - | Core acceptance still holds | 3 mutations of the store + external DB probes | PASS |
| - | Full gate, 4 commands | run once each on the restored tree | PASS |

---

## A. Blank `HUB_SESSION_ENCRYPTION_KEY` must not break boot

The fix under audit is one line in `apps/api/src/middleware/app-auth.ts:178`, which now reads the validated `env` rather than raw `process.env`:

```ts
encryptionIkm: env.HUB_SESSION_ENCRYPTION_KEY ?? hubAuthConfig.secretKey,
```

`apps/api/src/env.ts:41` maps the key through `emptyToUndefined`, so `''` becomes `undefined` and the `??` fallback fires.

### Method

Not a unit test.
The **real** `apps/api/src/server.ts` was booted with `node --import tsx ./src/server.ts`, which is the entrypoint that calls `createAppAuthBff()` at module top level (`server.ts:31`).
`DATABASE_URL` and `ADMIN_DATABASE_URL` were overridden to the local Docker database so nothing could reach the staging database that `apps/api/.env` points at.

Two `hub_bff_sessions` rows were seeded directly into Postgres by an **independent** re-implementation of the sealed format (`scratchpad/seal.mjs`, pure `node:crypto`, deliberately not importing `session-crypto.ts`):

- `probe_default_key`, sealed with `FXL_HUB_SECRET_KEY`
- `probe_override_key`, sealed with a 43-char override

`POST /auth/refresh` then discriminates cleanly.
`401 {"error":"no_session"}` means the store could **not** open the row (`hub-sdk@1.2.0 dist/server.js:381-384`).
Anything else means it **did** open it, and the handler went on to `discover()` against the local Hub, which is not running, hence `500`.

### Observed

```
### boot [blank] HUB_SESSION_ENCRYPTION_KEY='' port=3106
pid=45691
BOOT_RESULT=BOOTED
health: {"ok":true,"service":"fxl-sales-api","env":"development",...}
  /auth/refresh cookie=probe_default_key  -> HTTP 500 body=Internal Server Error
  /auth/refresh cookie=probe_override_key -> HTTP 401 body={"error":"no_session"}
killed pid=45691
```

```
### boot [override] HUB_SESSION_ENCRYPTION_KEY='override-ikm-for-verify-round2-0123456789ab' port=3107
pid=45713
BOOT_RESULT=BOOTED
health: {"ok":true,"service":"fxl-sales-api","env":"development",...}
  /auth/refresh cookie=probe_default_key  -> HTTP 401 body={"error":"no_session"}
  /auth/refresh cookie=probe_override_key -> HTTP 500 body=Internal Server Error
```

The two boots are exact mirror images.
The blank value really does fall back to `FXL_HUB_SECRET_KEY`, and a real 32+ char override really does replace it.

### Negative control 1, the 32-char floor is still live

```
### boot [shortkey] HUB_SESSION_ENCRYPTION_KEY='too-short-key' port=3108
BOOT_RESULT=FAILED_TO_BOOT
Error: hub session encryption key must be at least 32 characters
    at createSessionSealer (.../src/auth/session-crypto.ts:44:11)
    at createHubSessionStore (.../src/auth/hub-session-store.ts:333:17)
    at createAppAuthBff (.../src/middleware/app-auth.ts:168:19)
    at <anonymous> (.../src/server.ts:31:17)
```

This matters: it proves the blank-key boot succeeds because `''` is normalised away, **not** because the length floor was quietly removed.

### Negative control 2, the pre-fix code still fails

`app-auth.ts:178` was temporarily reverted to `process.env.HUB_SESSION_ENCRYPTION_KEY ?? hubAuthConfig.secretKey` and the blank boot re-run:

```
### boot [mutantA] HUB_SESSION_ENCRYPTION_KEY='' port=3109
BOOT_RESULT=FAILED_TO_BOOT
Error: hub session encryption key must be at least 32 characters
    at createAppAuthBff (.../src/middleware/app-auth.ts:168:19)
    at <anonymous> (.../src/server.ts:31:17)
```

The unit suite also went red on the same mutation:

```
 Test Files  1 failed | 32 passed (33)
 FAIL  src/middleware/__tests__/app-auth-bff-wiring.test.ts
```

The repair is load-bearing and it is covered by a test.
Restored, suite green again.

**A: PASS.**

---

## B. session-crypto tamper test determinism

Round 1 failed this because the test flipped a base64url **character** whose low bits are padding, so roughly a quarter of runs decoded to byte-identical ciphertext.
The repaired test flips a **byte** of the decoded component and re-encodes (`withFlippedByte`, `session-crypto.test.ts:26-36`), and carries its own inline non-vacuity assertion that the decoded bytes really changed.

### Method

`npx vitest run src/auth/__tests__/session-crypto.test.ts` run **20 consecutive times**, run-once mode, never a watcher.

### Observed

```
PASS=20 FAIL=0
run 1: PASS ... run 20: PASS
```

Exact pass count: **20 / 20**.

Under the old ~25% flake rate the probability of 20 clean runs is about 0.3%, so this is decisive.
The mechanism is deterministic by construction: byte 0 of the IV (12 bytes), the auth tag (16 bytes) and the ciphertext are all fully significant, with no padding bits involved.

**B: PASS.**

---

## C. Deleting `sessionStore: session.store` must be caught

This is the literal production bug.
Without the option, `createHubBff` does `options.sessionStore ?? new InMemoryHubSessionStore()` (verified at `hub-sdk@1.2.0 dist/server.js:300`).

### Mutation C1, the option deleted outright

```
##### UNIT SUITE WITH sessionStore DELETED #####
unit exit=1
     -> expected undefined to be defined
 FAIL  src/middleware/__tests__/app-auth-bff-wiring.test.ts > createAppAuthBff wiring > hands the durable session store to createHubBff
 Test Files  1 failed | 32 passed (33)
      Tests  1 failed | 322 passed (323)
```

### Mutation C2, the option present but pointing at the SDK default

`sessionStore: new InMemoryHubSessionStore()`:

```
     -> expected InMemoryHubSessionStore{ ...(2) } to not be an instance of InMemoryHubSessionStore
 FAIL  src/middleware/__tests__/app-auth-bff-wiring.test.ts > createAppAuthBff wiring > hands the durable session store to createHubBff
      Tests  1 failed | 322 passed (323)
```

The test asserts **identity** (`toBe(durableStore)`), not merely "some object", so handing the SDK a different durable-looking store would also be caught.

### Restore

```
##### RE-RUN AFTER RESTORE (expect GREEN) #####
 Test Files  33 passed (33)
      Tests  323 passed (323)
exit=0
```

Noted for the record: the **integration** suite stays green under C1 (`20 passed / 109 passed`).
That is expected and is stated in the test file's own header, because the oracle constructs the durable store directly and never goes through `createAppAuthBff`.
`pnpm --filter @fxl-sales/api test` is the suite that catches it, which is what the requirement asked for.

**C: PASS.**

---

## D. The 503-without-cookie-deletion rule

`apps/api/src/auth/__tests__/hub-session-scope.test.ts` mounts the **real** middleware in a **real** Hono app, behind a route that reproduces the SDK's own cookie-deleting 401 (`dist/server.js:381-384`).
Seven mutations were applied to `hub-session-scope.ts` to attack the test from every direction.

| Mutation | Expectation | Observed |
| --- | --- | --- |
| D1 degrade to `await next()` instead of 503 | RED | `expected 401 to be 503` |
| D2 503 returned, but downstream also allowed to run | RED | `expected 401 to be 503` |
| D3 status 503 -> 500 | RED | `expected 500 to be 503` |
| D4 body `code` renamed to `db_down` | RED | `expected { error: 'unavailable', ...(1) } to deeply equal ...` |
| D5 swallow **every** error as 503 | RED | `expected 503 to be 500` on the rethrow test |
| D6 correct 503 + body + downstream skipped, but the middleware deletes the cookie itself | RED | `expected 'fxl_hub_session=; Max-Age=0; Path=/' to be null` |
| D7 correct 503 + body, downstream let through un-awaited | RED | `expected 401 to be 503` |

Every one of the four required facts is pinned and each was made to fail on its own where the framework permits:

- **503 status** - isolated by D3.
- **body `{error:'unavailable', code:'session_store_unavailable'}`** - isolated by D4.
- **no `Set-Cookie`** - isolated by D6, which is the decisive one: correct status, correct body, downstream never ran, and the test still went red purely on the cookie header.
- **downstream never ran** - D1/D2/D7 all show that any downstream execution flips the status to 401, so this assertion is a redundant second guard rather than an independently falsifiable one under Hono's response model. That is a property of Hono, not a weakness in the test: the two facts the assertion protects (the 401 and the cookie teardown) are both asserted directly.

### Vacuity attempts, all failed

- Is the `downstream` spy reachable at all? Yes. D1 produced a `401` from `app.all('/auth/*')`, which is that exact handler, so the spy is over a route that genuinely runs.
- Does the middleware actually run on the requested path? Yes. D5 shows the catch block is on the live path for `/auth/refresh`, and the two hydrate-input tests record real `withRequest` inputs.
- Does the rest of the file matter? Yes. D5 proves the `instanceof HubSessionStoreUnavailableError` narrowing is load-bearing: widening it to catch everything turns a genuine 500 into a 503 and the second test fails.

Restored, file green (`4 passed`), `git diff` clean.

**D: PASS.**

---

## Core acceptance, re-confirmed independently

> given a Hub BFF session created through one store instance backed by Postgres, when a second, independent store instance is constructed against the same database, then that second instance resolves the session and its most recently rotated Hub refresh token, while the SDK's `InMemoryHubSessionStore` resolves null for the same session id

### The named oracle is non-vacuous

Three mutations of the implementation, each run against `test/rls/hub-bff-session-store.test.ts`:

| Mutation | Observed |
| --- | --- |
| O1 hydrate never loads a session row (the in-memory failure mode) | 2 failed / 6 passed. The named oracle: `expected null to deeply equal { Object (hubRefreshToken) }` |
| O2 flush never persists anything | 7 failed / 1 passed |
| O3 `seal()` stores plaintext | 5 failed / 3 passed, including `expected 'v1.plain.refresh-token-alpha' not to contain 'refresh-token-alpha'` |

Restored: `8 passed`.

The oracle's own inline control (`memA.get(memSid)` is not null while `memB.get(memSid)` is null) correctly attributes the in-memory null to the restart rather than to a broken `create`.

### The refresh token is encrypted at rest with the row id as AEAD additional data

This was proven **from outside the module**, through the running API, rather than by reading `session-crypto.ts`.

A byte-identical copy of `probe_default_key`'s ciphertext was inserted under a **different** row id:

```
           id           | same_ciphertext
------------------------+-----------------
 probe_default_key      | t
 probe_moved_ciphertext | t
```

Then the real server was booted and both cookies presented:

```
  cookie=probe_default_key      -> HTTP 500 body=Internal Server Error
  cookie=probe_moved_ciphertext -> HTTP 401 body={"error":"no_session"}
```

The same ciphertext opens under its own id and refuses to open under any other.
That is the AEAD additional-data binding, confirmed end to end.
The at-rest secrecy is separately confirmed by O3 above and by the raw column read in the shipped test (`starts with 'v1.'`, does not contain the plaintext).

### The new tables are genuinely invisible to the ordinary tenant connection

The round-1 caveat is real and I confirmed it.
`ADMIN_DATABASE_URL` in `apps/api/.env` connects as `postgres`:

```
    rolname     | rolsuper | rolbypassrls
----------------+----------+--------------
 postgres       | t        | t
 fxl_sales_test | f        | f
```

So the test's `adminClient` **bypasses RLS entirely**, and its "the admin context sees the row" line proves only that the row exists.
It is a valid positive control, but it is not an RLS proof.

The assertion carrying the weight is the tenant side, and it is sound:

- `appClient` connects on `TEST_DATABASE_URL` as `fxl_sales_test`, which is **not** superuser and **not** `BYPASSRLS`.
- That role **holds** `SELECT / INSERT / UPDATE / DELETE` on both tables, so a zero-row read is RLS filtering and not a missing grant.

Reproduced directly as that role:

```
  current_user  | is_super
----------------+----------
 fxl_sales_test | f

 visible_rows        -> 0
 visible_login_txns  -> 0

INSERT INTO hub_bff_sessions ...
ERROR:  new row violates row-level security policy for table "hub_bff_sessions"
```

while the superuser saw `admin_visible = 2` at the same moment.
The rejection message is the RLS policy, not `permission denied`, which is exactly the distinction that makes this test meaningful.

Schema state confirmed directly:

```
      relname       | relrowsecurity | relforcerowsecurity
--------------------+----------------+---------------------
 hub_bff_login_txns | t              | t
 hub_bff_sessions   | t              | t
```

with one `PERMISSIVE ... FOR ALL` policy per table on `current_setting('app.fxl_admin', true) = 'true'` for both `USING` and `WITH CHECK`.

### SDK coupling re-verified against the installed package

Read directly from `node_modules/.pnpm/@fxl-business+hub-sdk@1.2.0_hono@4.12.25/.../dist/server.js`:

- lines 271-273: `SESSION_COOKIE = "fxl_hub_session"`, `SESSION_COOKIE_SECURE = "__Host-fxl_hub_session"`, `LOGIN_TX_COOKIE = "fxl_hub_login"` - matches `hub-session-scope.ts:18-20` and the unit test.
- line 275: `LOGIN_TX_MAX_AGE_SECONDS = 600` - matches `LOGIN_TX_TTL_MS = 600_000`.
- line 300: `const store = options.sessionStore ?? new InMemoryHubSessionStore();` - the fallback this slice removes.
- lines 381-384: `/auth/refresh` does `deleteCookie(...)` then `401 no_session` - the cookie teardown that the 503 rule exists to prevent.

**Core acceptance: PASS.**

---

## Full gate, run once each on the restored tree

```
##### 1. pnpm --filter @fxl-sales/api test #####
exit=0
 Test Files  33 passed (33)
      Tests  323 passed (323)

##### 2. pnpm --filter @fxl-sales/api test:integration #####
exit=0
 Test Files  20 passed (20)
      Tests  109 passed (109)

##### 3. pnpm --filter @fxl-sales/api lint #####
exit=0

##### 4. pnpm run type-check #####
exit=0
 apps/api type-check: Done
 apps/web type-check: Done
```

All four run-once, no watch mode anywhere.

---

## CLAUDE.md compliance

| Rule | Result |
| --- | --- |
| No em dash characters in added lines | PASS. `git diff --cached master \| grep '^+' \| grep -- '<em dash>'` returns nothing, across the whole staged diff, not just `apps/api`. |
| No hand edits to `CHANGELOG.md` or auto-generated files | PASS. No changelog is touched. `drizzle/meta/0016_snapshot.json` and `_journal.json` are drizzle-kit output, added by `db:generate`, not hand-authored. |
| Scope confined to `apps/api/**` | PASS for code. The only staged paths outside `apps/api/` are `nexo/runs/batch-20260803-auth-session/verify-01-exec-report.md` and `verify-01-report.md`, which are Nexo process artefacts rather than product code. No `apps/web/**`, `packages/**` or `CLAUDE.md` change, matching the slice's stated out-of-scope list. |
| Run-once test invocations only | PASS. Every run used `vitest run` / the `test` script; no watcher was ever started. |
| Kill every process started this turn, by exact PID | PASS. PIDs 45691, 45713, 45749, 45788, 47186 were each killed by exact PID and confirmed gone. No `pkill` or name-pattern kill was used. `lsof` on ports 3106-3110 shows nothing listening. |

---

## Tree restoration

The tree is byte-identical to how it was found.

```
=== working tree vs index (must be EMPTY) ===
(end)
=== git status --porcelain ===
M  apps/api/.env.dev.example
A  apps/api/drizzle/0016_hub_bff_session_store.sql
A  apps/api/drizzle/meta/0016_snapshot.json
M  apps/api/drizzle/meta/_journal.json
A  apps/api/src/auth/__tests__/hub-session-scope.test.ts
A  apps/api/src/auth/__tests__/hub-session-store.test.ts
A  apps/api/src/auth/__tests__/session-crypto.test.ts
A  apps/api/src/auth/hub-session-scope.ts
A  apps/api/src/auth/hub-session-store.ts
A  apps/api/src/auth/session-crypto.ts
M  apps/api/src/db/schema.ts
M  apps/api/src/env.ts
M  apps/api/src/jobs/nightly-job.ts
A  apps/api/src/middleware/__tests__/app-auth-bff-wiring.test.ts
M  apps/api/src/middleware/app-auth.ts
A  apps/api/test/rls/hub-bff-session-store.test.ts
A  nexo/runs/batch-20260803-auth-session/verify-01-exec-report.md
A  nexo/runs/batch-20260803-auth-session/verify-01-report.md
?? .vscode/
```

18 staged paths, unchanged from the state at the start of this audit.
`?? .vscode/` was already untracked when the audit began.
Every probe row written to the local Docker database was deleted; `hub_bff_sessions` and `hub_bff_login_txns` are both back to `0` rows.
All scratch scripts live in the session scratchpad, outside the repository.

---

## Observations, none blocking

1. **The RLS test's admin client is a superuser.**
   `ADMIN_DATABASE_URL` is `postgres`, so `it('is invisible to the ordinary tenant connection')` derives all of its real force from the `appClient` half.
   The test is correct as written and the tenant half is genuinely non-vacuous (verified above), but the `adminClient` line reads as an RLS assertion and is not one.
   Worth a one-line comment in the test, or a follow-up doubt, so a future reader does not over-trust it.

2. **`expect(downstream).not.toHaveBeenCalled()` cannot fail on its own** under Hono, because letting the downstream handler run always flips the status to 401 first.
   It is a harmless redundant guard, not a defect.

3. **The integration suite is blind to the `sessionStore` wiring** by design; only the unit suite catches it.
   That is documented in `app-auth-bff-wiring.test.ts`'s header and is a fair split, but it means a future refactor that moves the wiring assertion out of the unit suite would silently reopen the original bug.

---

## Verdict

**PASS.**

All four round-1 repairs are independently proven by mutation experiment, not by claim.
The core acceptance criterion holds and its oracle is demonstrably non-vacuous.
All four gate commands pass on the restored tree.
The tree was restored exactly, every probe process was killed by exact PID, and the local database was left clean.
