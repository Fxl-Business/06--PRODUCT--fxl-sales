---
id: 01-sdk-bump-2.5.0
milestone: v4.1.0
status: todo
depends_on: []
files_modified:
  - apps/api/package.json
  - apps/web/package.json
  - pnpm-lock.yaml
  - nexo/knowledge/reference/auth-model.md
  - CLAUDE.md
  - package.json
  - scripts/__tests__/hub-sdk-pin.test.mjs
acceptance: "given both apps pin hub-sdk 2.3.0, when the SDK is bumped to 2.5.0 and installed, then both apps still pin EXACTLY 2.5.0 (no caret), the pin/guard references no longer assert 2.3.0, one Hono copy still resolves, the full existing suite stays green, and the 2.5.0 dist is confirmed to expose switchAccount + createHubInvitations + HubInvitationError + a prompt=select_account relay."
goal: "Bump @fxl-business/hub-sdk 2.3.0 -> 2.5.0 in both apps, install, fix the 2.3.0 pins/guards, prove the suite is still green (purely additive), and confirm the 2.5.0 surface the later slices depend on."
verifier_focus: "Exact pin (no caret) in both package.json; the Hono override still yields a single Hono; the full suite is GREEN not merely compiling; and the reference/guard files no longer claim 2.3.0."
must_not_break:
  - "pnpm-workspace.yaml Hono 4.12.28 override must still resolve exactly one Hono copy."
  - "pnpm test's tracked-file guard for the removed auth provider."
  - "The env-example-contract and local-database-guard tests."
rules:
  - "Do NOT install @fxl-business/hub-sdk-testing (this repo uses its own packages/auth-fake)."
  - "Exact version pins only, no caret, in both apps."
  - "This slice adds NO features. Only the bump + pin/guard fixes needed to keep the suite green."
  - "RECONCILED 2026-10-01 (plan-check C8): there is still NO hub-sdk pin guard, so add scripts/__tests__/hub-sdk-pin.test.mjs mirroring scripts/__tests__/fxl-contracts-pin.test.mjs (both apps pin EXACTLY 2.5.0 under dependencies, the two specifiers agree, @fxl-business/hub-sdk-testing appears in NO package.json - enumerate apps/*/package.json and packages/*/package.json from the filesystem, never a hard-coded list - and NOT in pnpm-lock.yaml) and append it to the root package.json `test` script's node --test list. Write it FIRST against 2.3.0 manifests expecting 2.5.0 so it is RED before the bump."
  - "RECONCILED 2026-10-01: the contract run added more NARRATIVE 2.3.0 hits that are history and must stay: packages/auth-fake/src/index.ts (F1 comment), scripts/no-legacy-env-names.mjs, nexo/knowledge/doubts/*, nexo/knowledge/decisions/*. packages/auth-fake has no hub-sdk dependency (only fxl-contracts 0.1.0), so it gets no pin."
  - "CRITICAL (plan-check C1): the grep for 2.3.0 will hit NARRATIVE history (comments like '2.3.0 grew X', milestone notes, past decision records). Change ONLY the strings that assert the CURRENT PIN (package.json, and reference/guard text stating the SDK IS pinned at 2.3.0). Do NOT rewrite historical narrative to 2.5.0 - that corrupts accurate history. When unsure whether a hit is a live pin or history, leave it and note it."
---

# Slice 01 - bump hub-sdk to 2.5.0

## Context

`apps/api/package.json:21` and `apps/web/package.json:19` both pin `"@fxl-business/hub-sdk": "2.3.0"` (exact). 2.5.0 and 2.5.0 of `hub-sdk-testing` are published on npm. The 2.5.0 upgrade is additive over 2.3.0 (spec section 3), so the whole suite must stay green after the bump before any other change.

`pnpm-workspace.yaml` pins `hono` to `4.12.28` via an override so only one Hono resolves; confirm this still holds after the bump.

## Steps (TDD-adapted: this is a dependency bump, so "red" is the pre-bump state and "green" is the full suite after)

1. Edit `apps/api/package.json:21` and `apps/web/package.json:19`: `"@fxl-business/hub-sdk": "2.5.0"` (exact, no caret).
2. `pnpm install` at the repo root. Confirm `pnpm-lock.yaml` updates to 2.5.0 for both apps and that the Hono override still resolves a single `hono@4.12.28` (`pnpm why hono` or inspect the lock; the transitive tree may differ from 2.3.0 - if a second Hono appears, that is a real problem to solve here, not defer).
3. Update pin/guard references that assert 2.3.0:
   - `nexo/knowledge/reference/auth-model.md`: lines 16 (`requireHubAuth` from `@fxl-business/hub-sdk@2.3.0`), 41 ("The Hub env contract is the SDK's, whole, as of 2.3.0" - state it holds unchanged through 2.5.0) and 125 (pinned EXACTLY) state the CURRENT version -> 2.5.0. Lines 57, 109, 115, 121-122, 129, 131, 136, 143 are history ("as of 2.3.0", "2.3.0 owns") and stay.
   - `CLAUDE.md` Auth Model section ("pinned EXACTLY at `@fxl-business/hub-sdk@2.3.0`") -> 2.5.0.
   - Grep the repo for `2.3.0` and `hub-sdk@2.3.0` (excluding `pnpm-lock.yaml` history and `.worktrees`): fix any tracked test or guard that hardcodes `2.3.0` as the expected pin. Search: `git grep -n "2\.3\.0"` and `git grep -n "hub-sdk@2"`.
4. **Confirm the 2.5.0 surface** (record the evidence in the run notes; the later slices depend on it):
   - Browser client exposes `switchAccount`: inspect `node_modules/.pnpm/@fxl-business+hub-sdk@2.5.0*/node_modules/@fxl-business/hub-sdk/dist/client.d.ts` for `switchAccount(options?: { organization?: string })` and note its exact signature + return type (navigates vs returns).
   - Server exposes invitations: inspect `dist/server.d.ts` for `createHubInvitations` and `HubInvitationError`; record the exact shapes of `create`/`list`/`revoke`/`resend` args and returns (`invitation`, `acceptUrl`, `emailDelivery`, `warnings`, `invitations`), the `HubInvitationError` fields (`code`, `status`, `retryAfterSeconds`), and the exact name of the roles argument (`appRoles`).
   - `/auth/login` relays `prompt`: inspect `dist/server.js` login handler for `prompt` / `select_account` forwarding to `/authorize`.
   - Write these findings to `nexo/runs/<run-id>/sdk-2.5.0-surface.md` so slices 02/07/08 build against the real signatures.
5. Run the **full suite** and lint: `pnpm run lint`, `pnpm run type-check`, `CI=true pnpm test`, `pnpm run build`. All must pass. If any test hardcoded 2.3.0 as an assertion (not just a pin), fix it here.

## Acceptance / oracle

- Named oracle (fast per-slice verify): `node --test scripts/__tests__/hub-sdk-pin.test.mjs` (new, RED on 2.3.0, GREEN on 2.5.0) plus `apps/api/src/config/__tests__/env-example-contract.test.ts` and `type-check`.
- Full green suite is the real bar (this is a foundation slice; the wave-1 wave-verify runs the whole suite anyway).

## Notes for the executor

- If `pnpm install` surfaces a peer/transitive conflict (e.g. a second Hono), resolve it in `pnpm-workspace.yaml` / overrides here - do not defer, the whole feature sits on this.
- Do not touch any feature code. This slice is the clean, revertable foundation.
