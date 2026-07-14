# Plan report - 03 transactional server sessions

## Verdict

PASS.

The plan is complete at `nexo/plans/20260713-hub-sdk-1-2-reconciliation/03-transactional-server-sessions.md`.
No product code or generated migration metadata was changed during planning.

## Evidence inspected

- Repository instructions in `AGENTS.md`, `CLAUDE.md`, and `apps/api/AGENTS.md`.
- Feature frame and facts-only context pack for run `20260713-2031-hub-sdk-1-2-reconciliation`.
- Parked plan and audit for the prior durable BFF session attempt.
- Published `@fxl-business/hub-sdk` 1.2.0 declarations and built runtime under `apps/api/node_modules`.
- Reference commit `9e9d26603aad1c672c9e1351029e8d6d25f3048b` through `git show` and `git diff` only.
- Current master migration journal, `0009_product_commission_scenarios.sql`, `0009_snapshot.json`, auth composition, environment schema, database boundary, and run-once scripts.

## Contract findings

SDK 1.2.0 exposes only synchronous session mutations and creates the callback session ID inside its route handler.
The parked implementation compensated with a no-argument `whenIdle()` call that observed every session's pending writes.
That made callback B wait for, or inherit failure from, unrelated session A.

The replacement plan uses `AsyncLocalStorage` to bind each synchronous SDK mutation to the request that caused it.
The callback-created ID and its exact persistence promise are captured when `store.create()` executes, so the callback awaits only its own write.
Refresh, switch, and logout use a keyed process-local coordinator around the full SDK handler and that request's persistence barrier.

SDK 1.2.0 also clears every upstream `401` and has no timeout.
The plan uses only its injectable `fetchImpl` plus an outer response normalizer to preserve unknown or malformed `401` failures, add bounded abort behavior, persist rotated credentials before classification, and allow only the five permanent codes to become unauthenticated.
The SDK remains the sole route, OAuth, discovery, JWKS, and verifier implementation.

## Migration correction

The parked branch incorrectly occupied migration `0009` and would delete the current product commission migration if reused.
The new plan requires generator output `0010_durable_bff_sessions`, locks current `0009_product_commission_scenarios` by hash and contract test, and forbids manual edits to generated snapshots or the journal.

## Verification contract

The locked RED begins with a real Hono HTTP journey through the published SDK router.
It includes the callback-B-versus-session-A regression, same-session serialization, cross-session independence, restart hydration, permanent and recoverable failure matrices, encrypted persistence, production fail-closed construction, migration history, redaction, lint, type-check, build, and wave-level repository gates.

## Scope note

The design matches the repository's current single API instance and explicitly excludes cross-replica transaction coordination.
A future SDK with a native awaited `withSession` surface can replace the compatibility seam without changing the durable data model.
