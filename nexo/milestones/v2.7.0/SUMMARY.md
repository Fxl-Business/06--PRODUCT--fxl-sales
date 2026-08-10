# v2.7.0 - Hub SDK 1.3.1 and session-layer hardening

Tag: `v2.7.0` at `a2511b4`
Cut: 2026-08-10
Flow: `/nexo-ship-prod-ready`
Chain: `master -> staging -> production`, all three at `a2511b4`

Production moved from `v2.5.0`, not `v2.6.0`: `v2.6.0` had been cut to `staging` on 2026-08-07 and never promoted, so this release carried it forward too.

## What shipped

### Session layer (this milestone's own work)

Driven by a follow-up from the FXL Hub team about the auth outage fixed in `batch-20260803-auth-session`.
Run record: `nexo/runs/feature-20260807-hub-sdk-130-session-hardening/`.

- `@fxl-business/hub-sdk` moved to `1.3.1`, and the store was ported to the SDK's async transactional `withSession` contract. The hydrate-around-the-handler bridge and `hub-session-scope.ts` are gone.
- A commit failure in the session store now surfaces as `503` instead of being swallowed and returned as success. That hole would have let the Hub rotate a refresh token while Postgres still held the old one, trip `reuse_detected` on the next refresh, and force-log-out the user.
- Sessions gained a 90-day ABSOLUTE ceiling that a rotation cannot extend. The 30-day sliding TTL stays.
- `/auth/refresh` failures are now classified: only a `401` tears the session down; `503` and `502` preserve it and retry on the existing bounded ladder.
- An explicit `Sair` writes a durable logout intent, so the app no longer re-captures the route it just cleared and no longer auto-logs the operator back in.
- The TanStack query cache is flushed on logout, on an in-page signed-out to signed-in transition, and on workspace switch. The switch case was a cross-tenant data leak: `setActive` never invalidated, so switching workspace rendered the previous tenant's data in-page.
- A login supersedes the session id that browser presented at `/auth/callback`, deleting it in the same transaction that inserts the new one.

### Carried from v2.6.0

- Archived cadastro rows hidden from the four lists and every picker.
- A nightly job that hard-deletes unreferenced archived rows after 30 days.

## Migrations applied to production

- `0020_cadastro_archived_at` - adds `archived_at` to four cadastro tables and backfills already-archived rows with `now()`.
- `0021_hub_session_absolute_ttl` - adds `absolute_expires_at NOT NULL` to `hub_bff_sessions`, backfilled `created_at + 90 days`.

## Verification

Gate 2 ran per slice by a separate Verify agent that never saw the implementer's notes.
Twenty-nine mutations were applied across the six slices; every one turned red on its predicted oracle and every one was reverted.

Release-verify (`release-verify-v2.7.0.md`) added, on top of the full suite, lint and build:

- A clean-clone deploy simulation running the literal `vercel.json` build command, because `v2.3.0` passed locally and then failed the Vercel deploy on a workspace subpath.
- Both migrations applied to a throwaway database restored to the real `v2.5.0` schema, owned by a `NOSUPERUSER NOBYPASSRLS` role so FORCE RLS was genuinely in play.
- The nightly purge EXECUTED against that freshly-migrated database rather than reasoned about: all zeros on day one, 29 days gives 0, 31 days gives 4 with correct ledger entries, and the system `vendedor` função untouched.

## Two corrections this milestone produced

- **The upgrade does NOT log every user out.** `MIGRATION.md` says a session-store change costs one forced re-login, and that was carried as an assumption for most of the run. Release-verify checked it: the schema change is additive, cookie names are unchanged, the sealer and key derivation are untouched, and the `created_at + 90 days` backfill lands in November for every realistic row. Sessions survive the deploy.
- **Acceptance criterion 8 was narrowed mid-run**, deliberately and on the record. The Hub's invariant 3 ("supersede the prior session for that account") is unimplementable under 1.3.x because `store.create` is never passed an `accountId`, so `hub_bff_sessions.account_id` is unconditionally NULL. Account keying would also fail to close the one-browser-two-identities case while logging operators out of every other device. Session-id keying replaced it.

## Reported back to the Hub

`nexo/runs/feature-20260807-hub-sdk-130-session-hardening/HUB-RESPONSE.md`.
The load-bearing one: `1.3.0` was published with `main`/`types`/`exports` pointing at `./src/*.ts` while `files` shipped only `dist`, so it installed cleanly and then failed to resolve at first import. We bridged it with a `pnpm patch`, reported it, and the Hub republished `1.3.1`; the patch is deleted.
Their `MIGRATION.md` now carries a caveat, credited to a consumer, confirming that `HubClient.getToken()` still collapses every failure to `null` and recommending exactly the direct-fetch pattern `apps/web/src/auth/refresh.ts` implements.

## Operational notes for this deploy

- **Rolling-deploy window.** The API container migrates then serves, and `0021` adds a `NOT NULL` column with no default. Between the new container finishing its migration and the old `v2.5.0` container retiring, a NEW login can fail with a `23502` on `hub_bff_sessions`. Existing sessions are unaffected because refresh is an `UPDATE` that never touches the column. A retry after rollover succeeds. Watch for `23502` in the first minutes; if Coolify stops before starting, the window does not exist.
- **The purge is now armed** and runs at 03:30 UTC, third of three nightly tasks. It is inert for the first 30 days by construction. A healthy first month logs all zeros; a non-zero `failed` count is a real fault and is never folded into `skipped`.

## Residuals

- Slice 06 has no manual two-profile browser click-through. `apps/api/.env` points `DATABASE_URL` at staging, so a manual login would have written there; a real cookie-jar integration test covers the path instead. Worth doing once against a local database.
- The purge scan is unindexed on `(status, archived_at)`. Negligible at cadastro scale; revisit past six figures.
- `0021`'s backfill safety argument expires around 2026-11-01. Shipped well inside it.
- Workspace-scoped query keys remain a follow-up in `nexo/ROADMAP.md`.
