# Release verification: v2.4.0

- Verdict: **FAIL**
- Candidate: `5162d4dc65cf89d748513807a1b6a07072b56529`
- Branch: `master`
- Base tag: `v2.3.1` at `8863b723ab16921296dc2bd85ec3c7697cb9482f`
- Started: `2026-08-05T12:24:52Z`
- Verifier role: independent release verifier

## Candidate identity and baseline

`git branch --show-current` returned `master`.

`git rev-parse HEAD` returned `5162d4dc65cf89d748513807a1b6a07072b56529`.

`git rev-parse origin/master` returned `5162d4dc65cf89d748513807a1b6a07072b56529`.

`git merge-base --is-ancestor v2.3.1 5162d4dc65cf89d748513807a1b6a07072b56529` exited 0.

The proposed `v2.4.0` tag was absent during verification.

The pre-existing status was:

```text
## master...origin/master
?? .vscode/
```

The untracked `.vscode/` path predated verification and was not inspected or modified.

The release range contains 137 changed files, 25,919 insertions, and 243 deletions.

Excluding `nexo/`, the range contains 66 changed files.

## Required release gate

| Command | Exit | Evidence |
|---|---:|---|
| `CI=true pnpm run lint` | 0 | Four workspace projects completed; API and web ESLint completed with no reported errors or warnings. |
| `CI=true pnpm run type-check` | 0 | Shared packages built, and all four workspace TypeScript checks completed. |
| `CI=true pnpm test` | 0 | 82 test files passed with 942 tests: shared utils 3 files and 80 tests, API 33 files and 328 tests, and web 46 files and 534 tests. The no-legacy-auth check was silent-success and `build-contract: ok` was reported. |
| `CI=true pnpm --filter @fxl-sales/api test:integration` | 0 | 20 integration files passed with 113 tests, including RLS, migration, professional payment, and durable Hub BFF session-store coverage. |
| `CI=true pnpm run build` | 0 | Shared packages, API, and web built; Vite transformed 1,824 modules and completed the production bundle. |
| `pnpm audit --prod --audit-level high` | 0 | Eight production dependency findings, all moderate; zero high-or-worse production findings. |
| `pnpm audit --audit-level high` | 1 | Fifteen findings: 9 moderate and 6 high. This is a mandatory release failure. |
| `git diff --check v2.3.1..5162d4dc65cf89d748513807a1b6a07072b56529` | 2 | Four whitespace errors were reported across two added Nexo context-pack files. This is a mandatory release failure. |

All required commands were run once and no watcher mode was used.

## Blocking findings

### B1: Full dependency audit has six high-severity findings

`pnpm audit --audit-level high` exited 1 with 15 total findings, including 6 high-severity findings.

The high findings were:

- `brace-expansion <1.1.16` through `apps__api>eslint>minimatch>brace-expansion`, advisory `GHSA-3jxr-9vmj-r5cp`.
- `postcss <=8.5.17` through `apps__web>postcss`, advisory `GHSA-r28c-9q8g-f849`.
- `brace-expansion <1.1.17` through `apps__api>eslint>minimatch>brace-expansion`, advisory `GHSA-mh99-v99m-4gvg`.
- `brace-expansion >=4.0.0 <5.0.8` through `apps__api>typescript-eslint>@typescript-eslint/typescript-estree>minimatch>brace-expansion`, advisory `GHSA-mh99-v99m-4gvg`.
- `brace-expansion >=4.0.0 <5.0.9` through the same TypeScript ESLint path, advisory `GHSA-rgw5-rvv9-x895`.
- `brace-expansion <1.1.18` through the ESLint path, advisory `GHSA-rgw5-rvv9-x895`.

The production-only audit had no high findings, but the release contract rejects any high-or-worse dependency vulnerability in the full audit.

### B2: Diff hygiene gate fails

`git diff --check` exited 2.

It reported trailing whitespace and a new blank line at end of file in each of these added files:

- `nexo/runs/batch-20260803-auth-session/context-pack.md`
- `nexo/runs/batch-20260804-props-costs/context-pack.md`

The required command reported four violations in total.

No context pack was opened or otherwise read during manual verification.

### B3: Concurrent durable-session refresh can delete a successfully rotated session

The durable store hydrates a session row before the BFF handler and flushes mutations after the handler.

The hydration read is not serialized across requests, and the later delete is unconditional by session id.

Two tabs or replicas can therefore hydrate the same rotating Hub refresh token.

One request can rotate and persist a new token while the stale request receives a Hub 401 and then deletes the same session row.

The Hub SDK also deletes the shared browser session cookie on that stale 401 response.

A direct candidate-code reproduction used two independent store instances over the integration database.

Both instances read `token-old`; one issued `update(sessionId, "token-new")`; the delayed stale instance issued `delete(sessionId)`; a third store then read `null`.

The reproduction output was:

```json
{"aBefore":{"hubRefreshToken":"token-old"},"bBefore":{"hubRefreshToken":"token-old"},"after":null}
```

The reproduction cleaned up its database row in a `finally` block and exited 0.

This defeats the release's durable multi-replica session objective and can log out users with concurrent tabs or requests.

### B4: Same-name professionals collide during re-win payable materialization

Professional payable idempotency uses `(kind, receivableId, beneficiaryName)`.

`beneficiaryName` is a display snapshot, not a unique professional identifier.

The API schema and UI permit two allocated professional rows with the same display name.

On a won-to-open-to-won flow, a surviving paid payable for one such professional suppresses the other same-name professional's payable for the same receivable.

A direct candidate-code reproduction passed two `Alex Silva` professional rows with costs 10,000 and 20,000 and one surviving paid row for `Alex Silva`.

`materializeWonPayables` returned `[]`, although the other professional still required a payable.

The reproduction exited 0 and printed:

```json
[]
```

This is a material financial correctness blocker.

## Independent release-risk review

### Migrations 0016 and 0017

Migration `0016_hub_bff_session_store.sql` creates two new tables and expiry indexes, then enables and forces RLS with admin-context-only policies.

Refresh tokens and PKCE verifiers are stored as AES-256-GCM ciphertext with the row id as additional authenticated data.

The ordinary tenant connection was proven unable to read or insert session rows by the integration suite.

Migration `0017_professional_payment_split.sql` adds one nullable `jsonb` column with no default and no backfill.

Existing rows retain the documented `NULL` default behavior, and the existing table RLS policies cover the new column.

Both migrations applied successfully in the 113-test integration run.

The production API container runs `node dist/db/migrate.js` before `node dist/server.js`, so the new tables are ordered before application startup.

No unresolved migration safety action was found.

### Configuration

`HUB_SESSION_ENCRYPTION_KEY` is optional and must be at least 32 characters when set.

When absent or blank, the key is derived from `FXL_HUB_SECRET_KEY` with HKDF-SHA256.

All replicas must use the same stable key material.

Changing either effective key logs out all stored sessions, which is an operational release note but not an additional unresolved migration action.

Production already requires `DATABASE_URL` for the durable store, and the container migrates that database before serving.

### Tenant isolation and security

The integration suite passed RLS and cross-tenant coverage, including the new session tables and professional split persistence.

New sales-domain reads and writes remain inside tenant-context transactions with explicit `orgId` predicates.

The non-tenant session tables use only the admin database context and forced RLS.

Session ids use 256 bits of randomness, stored secrets are authenticated-encrypted, expired rows are rejected on read, and login transactions are consumed with a deleting return.

No additional material tenant-isolation leak was found.

The concurrent refresh race in B3 remains a material auth security and availability blocker.

### Professional payment splitting

The arithmetic implementation preserves exact sums and validates authored basis-point arrays to total 10,000.

Payables bind to eligible installment receivables and recurring rows are excluded by the documented label rule.

Integration tests cover persistence, RLS, reversion, cancellation, and exact payable totals.

The same-name idempotency collision in B4 remains a material financial release blocker.

## Worktree and process integrity

After all required gates and direct reproductions, `HEAD` and `origin/master` still matched the candidate SHA.

Before writing this report, `git diff --name-status` was empty and status still showed only the pre-existing untracked `.vscode/` path.

No production code, test, configuration, existing Nexo artifact, git ref, tag, branch, or remote was modified.

Every test, build, audit, and reproduction process started by this verifier exited.

Repository dev-server processes owned by pre-existing process groups were observed and left untouched.

## Verdict

**FAIL**.

The release must not be tagged or promoted while the full audit, diff hygiene, durable-session concurrency, and same-name professional payable blockers remain unresolved.
