# Planning evidence: 01-session-refresh-serialization

## Verdict

PASS.

The executor-ready TDD plan is saved at `nexo/plans/20260805-release-blocker-repair/01-session-refresh-serialization.md`.

## Evidence inspected

- Read the root and API `AGENTS.md` instructions, the approved release-blocker design, the batch Frame, and the generated context pack.
- Inspected `apps/api/src/auth/hub-session-store.ts`, `apps/api/src/auth/hub-session-scope.ts`, the focused auth unit tests, the real Postgres integration suite, database client setup, Vitest configuration, and package commands.
- Read the failed `v2.4.0` release verification reproduction proving that two independent stores hydrate `token-old`, the later stale delete removes the rotated row, and the SDK clears the shared browser cookie.
- Confirmed Drizzle 0.45 exposes `.for('update')` and the repository already uses it inside transactions.

## Executor contract

The declared production seam is limited to `apps/api/src/auth/hub-session-store.ts`.
The locked Red oracle is `serializes a stale refresh rejection behind a committed token rotation across replicas` in `apps/api/test/rls/hub-bff-session-store.test.ts`.
It uses two independent durable-store instances, two real Hono request paths, the live integration database, a stale SDK-shaped delete and cookie clear, a separately progressing session, and a fresh-store final read.
The expected Red evidence is `401`, cookie clearing, stale observation before release, and a final `null` session.
The minimal Green design uses one admin transaction per `withRequest`, `SELECT FOR UPDATE` on only the matching live session row, transaction-bound login consumption, direct ordered flush through the same handle, and local hydrate, handler, and flush phase classification.

## Scope control

Exact modified files are the durable store, its focused unit test, and its Postgres integration test.
No public interface, middleware, route, SDK, schema, migration, dependency, encryption, TTL, cleanup, or browser code is included.
The plan names focused Red and Green commands, separate-agent Gate 2 commands, integrated wave verification, bounded refactor limits, and the atomic commit `fix(api): serialize durable session refreshes`.
