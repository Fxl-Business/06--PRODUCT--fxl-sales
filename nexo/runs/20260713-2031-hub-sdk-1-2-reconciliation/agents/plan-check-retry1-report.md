# Plan check retry 1 - Hub SDK 1.2 reconciliation

## Verdict

PASS for the executable subset consisting of slices `01-sdk-contract-baseline` and `03-transactional-server-sessions`.
Slice `02-browser-resume-and-workspaces` remains parked and is not part of this verdict.
The active subset is coherent, but it is sequential rather than parallel: slice 03 depends on slice 01 and overlaps several of its API auth and environment files.
Slice 03 is independent of slice 02 and may execute after slice 01 without importing or claiming the parked browser contract.

## Evidence boundary

This retry used only `AGENTS.md`, the feature overview, all three slice plans, and the completed planner result and report files for slices 01 and 03.
The slice 02 planner result and report were deliberately not used because their verdict was lost and the slice must remain parked.
No repository context pack was read.
No product code was changed.

## User-goal and acceptance coverage

Slice 01 covers feature acceptance 1, 2, 11, and 12 with a concrete dependency, SDK ownership, audience, verifier-claims, route-composition, environment, and operator-documentation contract.
Slice 03 covers feature acceptance 7 through 10 with request-scoped awaited persistence, same-session serialization, cross-session independence, recoverable-cookie preservation, permanent-session invalidation, restart hydration, and production fail-closed storage.
Feature acceptance 3, 5, and 6 remains parked in full with slice 02.
Feature acceptance 4 also remains parked at the browser level.
Slice 03 may prove that recoverable server failures preserve the durable record and opaque cookie, but it may not claim that the current browser provider preserves the signed-in profile.
The overview states this distinction explicitly and forbids claiming silent resume, read replay, complete workspace selection, or completion of the full feature.

The active slices each deliver real value without slice 02.
Slice 01 replaces product-owned auth interpretation with an executable SDK 1.2.0 integration and operator handoff contract.
Slice 03 makes the SDK-backed BFF durable and transactionally safe for the repository's declared single-instance API topology.
Neither value depends on browser focus listeners, browser lifecycle state, automatic read replay, optional display claims, or workspace pagination.

## RED oracle and command contract

Slice 01 names three RED oracle groups and exact test names before implementation.
Its RED commands are run-once invocations, and its plan states that the observed tests and expectations become immutable to the implementer.
Its locked Gate 2 command combines the API contract, config, middleware, and real SDK route tests with the browser config test, followed by explicit run-once type-check, lint, and diff checks.

Slice 03 requires the end-user-aligned in-process Hono HTTP journey through the real published SDK router as the first RED.
It names the exact test files, 21 HTTP journey cases, focused unit contracts, the exact run-once oracle command, and the expected absent-module or compile RED.
It explicitly forbids weakening assertions, changing statuses, deleting cases, adding skips, mocking the SDK router, or replacing SDK store calls after RED.
Its execution and separate verification commands are exact run-once commands and include lint, type-check, build, migration-history validation, secret inspection, root integration gates, audit, and diff checks.

The plans distinguish per-slice oracles from the integrated wave gate.
Because slice 02 is parked, any mutation check performed after slice 03 proves only the active server subset.
It must not be described as proof of the parked browser acceptance or as completion of the full feature.

## Dependency and file-shape check

The dependency graph is acyclic.
The executable order is `01-sdk-contract-baseline` followed by `03-transactional-server-sessions`.
Slice 02 also depends on slice 01 but remains excluded from scheduling.

All `files_modified` entries are canonical repository-relative paths.
Slice 01 lists every file its mechanical sequence creates or edits, including both package manifests, the lockfile, product config adapters and tests, auth middleware and tests, environment examples, the operator document, README, and `CLAUDE.md`.
Its references to `apps/api/src/server.ts` are inspection and preservation assertions, not planned edits.

Slice 03 lists every file its mechanical sequence creates or edits, including the eight new test files, request scope, coordinator, compatibility adapter, encrypted store and persistence modules, schema, generated `0010` migration artifacts, environment validation, auth composition, server startup, environment examples, and `CLAUDE.md`.
The existing `0009` SQL and snapshot are read-only baseline artifacts and correctly do not appear in `files_modified`.
Generated snapshot and journal files are listed but are explicitly generator-owned and may not be edited manually.

Slices 01 and 03 overlap `CLAUDE.md`, the API environment examples, `app-auth.ts`, and `app-auth.test.ts`.
That overlap is safe only because slice 03 depends on slice 01 and must execute after it.
The two active slices must not be built concurrently.

## SDK and ownership boundaries

The active plans keep OAuth, PKCE, login, callback, refresh, switch, logout, discovery, JWKS lookup, bearer verification, and Hub web-origin construction inside `@fxl-business/hub-sdk` 1.2.0.
Slice 01 prohibits product imports of `jose` and Hub auth internals, product-owned discovery or JWKS values, hard-coded OAuth endpoints, and Hub web URL construction.
Its real-router oracle locks all five SDK BFF routes at the same-origin root mount and the SDK verifier on protected routes.

Slice 03 uses only the SDK's documented `sessionStore` and `fetchImpl` seams plus outer Hono middleware.
Its compatibility code may observe SDK-initiated refresh and switch backchannel outcomes, persist rotated credentials, apply a bounded timeout, and normalize the product response.
It may not synthesize or replace any OAuth, callback, refresh, switch, logout, discovery, JWKS, or verifier route or request.
This is a narrow SDK 1.2.0 compatibility boundary, not product ownership of the auth protocol.

Slice 01 assigns day-one entitlement seeding, account and workspace membership, Hub invitations, registrable-domain and auth-origin invariants, periodic reconciliation, and operator incident checks to Hub operators or Hub-owned automation.
It explicitly forbids product-owned Hub Admin trials, grants, organizations, invitations, reconciliation workers, and invitation delivery.
Slice 03 is limited to product BFF session durability and excludes those operator surfaces as well as deployment migration, secret rotation, release cutting, and branch promotion.

## Scope and execution decision

Slice 01 is a bounded SDK contract baseline and explicitly defers browser lifecycle, request replay, large-workspace behavior, and durable session storage.
Slice 03 is larger, but its encryption, persistence, request scoping, keyed serialization, response compatibility, migration, and startup behavior form one deployable production-session invariant.
Its scope is constrained to the current single API instance and explicitly excludes distributed locking, cross-replica coherence, cleanup jobs, key rotation, browser behavior, operator endpoints, environment migration, and release work.
The plan's internal task order keeps RED first and makes later implementation mechanical.

No corrections to slices 01 or 03 were necessary.
The executable subset may proceed in dependency order under Autopilot Gate 1 handling, with separate Gate 2 verification still mandatory.
The run must remain open or explicitly partial after slice 03 because slice 02 is parked.
No status, summary, capture note, mutation report, or release note may state that the full Hub SDK 1.2 reconciliation, silent browser resume, browser-profile preservation, one-read replay, or large-workspace selector is delivered.
