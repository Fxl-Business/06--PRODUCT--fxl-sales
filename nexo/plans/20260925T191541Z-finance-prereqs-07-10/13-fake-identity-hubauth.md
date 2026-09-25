---
id: 13-fake-identity-hubauth
milestone: v4.1.0
status: done
depends_on: []
files_modified: [apps/api/src/middleware/app-auth.ts, apps/api/src/auth/__tests__/dev-identity-no-hub.test.ts, nexo/knowledge/reference/development-identity-mode.md]
goal: "In development identity mode the request context carries hubAuth exactly like the real Hub path, so the baixa author name and the seller lead scope (email) work under make dev-fake"
acceptance: ["applyHubAuthContext sets c.set('hubAuth', auth) before the legacy keys, so both the real and the fake path expose c.get('hubAuth')", "Under the fake adapter with x-fake-identity: team-owner, a probe route returning getHubActorDisplayName(c.get('hubAuth')) answers the roster profile name (not null)", "Under the fake adapter with x-fake-identity: seller, c.get('hubAuth')?.claims?.email is the roster email (the value leadScope reads in apps/api/src/domains/sales-ops/leads/lead-routes.ts)", "Deleting the new c.set line makes both oracles fail", "No per-request branch on SALES_AUTH_FAKE is added; the real path is unchanged (the SDK already set hubAuth, the set is idempotent)", "nexo/knowledge/reference/development-identity-mode.md records that applyHubAuthContext is the one seam that sets hubAuth for both paths", "CI=true pnpm test, lint and type-check green"]
---

# 13 - Development identity mode: carry hubAuth on the request

## Context

Found while building slice 08: a baixa recorded under `make dev-fake` shows `Autor não identificado`.
Diagnosis (orchestrator run, 2026-09-25):
- `toHubClaims` in `packages/auth-fake/src/index.ts:368-369` already emits `name` and `email`.
- The fake middleware ends with `appAuth.applyHubAuthContext(c, auth, next)` (`apps/api/src/auth/select.ts:203`).
- `applyHubAuthContext` (`apps/api/src/middleware/app-auth.ts:255-266`) sets `userId`, `orgId`, `userRole`, `userRoles` but never `hubAuth`.
  On the real path the SDK's `hubAuth()` middleware sets `hubAuth` first, so the gap exists only in fake mode.
- Consumers that therefore read `undefined` in fake mode: `getHubActorDisplayName(c.get('hubAuth'))` (`apps/api/src/domains/sales-ops/routes.ts:79`, helper `app-auth.ts:39-45`) for settlement/archive actor names, and `leadScope` (`apps/api/src/domains/sales-ops/leads/lead-routes.ts:50`), which reads `c.get('hubAuth')?.claims?.email`, so a dev-fake seller's lead scope has a null email.

## Steps

1. Red: in `apps/api/src/auth/__tests__/dev-identity-no-hub.test.ts`, follow the file's existing harness (how it installs the fake adapter and mounts routes) and add two cases:
   `exposes the verified hub auth context to handlers, so the actor name resolves` (probe route returns `getHubActorDisplayName(c.get('hubAuth'))`, expect the `team-owner` roster profile name, read it from the roster rather than hard-coding if the roster exports it)
   and `exposes the identity email to handlers, so the seller lead scope resolves` (probe route returns `c.get('hubAuth')?.claims?.email` for `x-fake-identity: seller`, expect the roster email).
   Both fail on master.
2. Green: first line of `applyHubAuthContext`: `c.set('hubAuth', auth);` with a one-line comment that the SDK already set it on the real path and the fake path relies on this seam.
3. Docs: one sentence in `nexo/knowledge/reference/development-identity-mode.md`.
4. Mutation: delete the line, both oracles red; restore.

## Scope limits

No change to `packages/auth-fake`, `select.ts` logic, or any consumer.
