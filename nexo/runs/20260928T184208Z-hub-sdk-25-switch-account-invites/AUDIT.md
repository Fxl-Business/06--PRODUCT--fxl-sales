# AUDIT - 20260928T184208Z-hub-sdk-25-switch-account-invites

Discuss-mode run, resumed on 2026-10-01 after a pause at Gate 1.
This file records decisions taken without the human, deviations from the plan, and findings left open.

## Resume and reconciliation

- The run was paused on 2026-09-28 before Gate 1, with no slice executed.
- Run `20260928T220106Z-sales-finance-control-plane` merged afterwards and took migration `0025_integration_transport`.
- Reconciliation (commit `3eb642c`): slice 06 renumbered to `0026_seller_invitation_state`; slice 01 gained the `hub-sdk-pin` guard; slices 07, 08 and 09 pinned the no-Hub outcome to the existing `503 hub_auth_not_configured` body.
- Plan-check round 2 FAILED on a real defect the reconciliation introduced: with a valid local Hub config, `make dev-fake` keeps a non-null `getHubSdkConfig()`, so the invite client would have sent the fake bearer to the real Hub. Fixed by gating on `isAppAuthAdapterInstalled()`. Round 3 passed.
- Gate 1 approved by the owner on 2026-10-01. The owner also chose to keep `apps/api/Dockerfile` running `migrate.js` at container start (see Part 2 note below).

## Execution topology

- The session ran from the Main checkout as the standalone orchestrator, building each slice in its own worktree under `.worktrees/hub25/<slice>` (the playbook-from-Main precedent), with `pnpm install --offline` per worktree.
- Within a wave, slices built in parallel; merges into `master` were serial and `--no-ff`; every wave was verified on a detached worktree of the integrated commit by a separate agent.
- Execute and Verify were always separate agents; Verify agents never received execute notes.

## Slices added at Execute (engine adapt, 6 of the 24-slice budget)

- `10-verify-findings-polish`: the non-blocking findings of Gate 2 on slices 03, 04, 05, 08 and the wave verifies (shared `AccountAvatar`, header never renders `workspaceId`, no-`onRetry` lock, act() warning, cross-org 404, admin-gate test on the real router, NoRolePage double click, `retryAfterSeconds` in bodies, integration setup refusing superuser and non-local hosts).
- `11-invite-locale-and-429-body`: invite emails follow the UI language; body-only 429 test.
- `12-integration-test-hygiene`: a PRE-EXISTING flaky test (`producer-emission.integration.test.ts` ordered by `position`, which is NULL before the publisher runs; 18 of 20 runs failed in isolation) fixed at its cause; dead `postgres:postgres` fallbacks removed.
- `13-integration-env-docs`: `.env.dev.example` documents the now-required integration URLs; a guard keeps them in sync; the root `test` script now fails on a listed-but-missing or unlisted guard file; the never-committed `dev-identity-docs-reconciliation.test.mjs` (ROADMAP item, AUDIT P11 of `finance-prereqs-07-10`) was written from its original spec.
- `14-send-invite-to-uninvited-seller`: found by the orchestrator's browser check under `make dev-fake`. A failed create left the seller with no invitation and no action, contradicting "invite failure never rolls back the seller ... so the admin can resend later". Added `POST /:id/invite` and the `Enviar convite` row action.
- `15-mutation-survivors`: a real double-click bug in `MissingEntitlementPanel` plus three test gaps found by the mutation battery.

- `16-api-image-builds`: added after the v4.1.0 release-verify FAILED. The production API image did not build from a clean archive (`TS2307 @fxl-business/fxl-contracts/testing`): `tsc` follows `select.ts`'s dynamic import into `packages/auth-fake`, whose dependencies the Dockerfile deps stage never installed. Introduced by `430cc96` in the contract run; invisible locally because the workspace already had `packages/auth-fake/node_modules`. Fixed with two COPY lines plus a guard that every `workspace:` dependency of `apps/api` is installed in the image; the Verify built the real image before (fail) and after (pass).

## Gate 2 record

- Verify FAIL then PASS: slice 06 (brittle last-migration assertion), slice 04 (missing no-`onRetry` assertion), slice 11 (raw-language probe survived). No slice needed a third attempt.
- Wave verifies 1 to 4, the feature-boundary verify and the closing verify are in `agents/`.
- Mutation battery (manual, no tool configured): 52 of 59 killed at 65fbec0; the actionable survivors were then killed by slices 14 and 15 (each re-applied and confirmed RED by their Verify).

## Deviations

- Slice 01 touched `install-dev-identity.ts` and four test mocks outside its file list: 2.5.0 made `switchAccount` a required `HubClient` member, so the bump was not purely additive for an implementer of the type.
- Slice 10 also touched `global-setup.ts`, `CLAUDE.md` (Testing) and `propostas.md`; slice 12 placed its helper in `apps/api/src/db/__tests__/` because `rootDir: ./src` forbids importing `test/rls` from `src`.
- The orchestrator re-indented eight lines of i18n JSON after slice 14's Verify (whitespace only, `keys-resolve` re-run green).

## Open findings (not fixed here)

- `apps/api` `tsc` emits `src/**/__tests__/**` into `dist/`, so test code ships in the API image. Filed on `nexo/ROADMAP.md` next to the existing Dockerfile hardening item.
- 36 "not configured to support act(...)" warnings from `leads-board-dropzones.test.tsx`, pre-existing and unrelated.
- Each `GET /admin/sellers` makes four Hub `list()` calls; fine at today's scale.
- The app has no language switcher today, so invite emails go out in pt-BR in practice.

## Part 2 note (release)

- `apps/api/Dockerfile` runs `node dist/db/migrate.js && exec node dist/server.js`. The owner chose to keep it. Migrations therefore apply at container start; a Coolify pre-deploy step would be redundant.
- `origin/production` lacks migrations `0022` to `0026`, not only `0025` and `0026`.
