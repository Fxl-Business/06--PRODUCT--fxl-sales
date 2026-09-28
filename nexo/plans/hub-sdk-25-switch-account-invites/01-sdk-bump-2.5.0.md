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
  - "CRITICAL (plan-check C1): the grep for 2.3.0 will hit NARRATIVE history (comments like '2.3.0 grew X', milestone notes, past decision records). Change ONLY the strings that assert the CURRENT PIN (package.json, and reference/guard text stating the SDK IS pinned at 2.3.0). Do NOT rewrite historical narrative to 2.5.0 - that corrupts accurate history. When unsure whether a hit is a live pin or history, leave it and note it."
---

# Slice 01 - bump hub-sdk to 2.5.0

## Context

`apps/api/package.json:20` and `apps/web/package.json:19` both pin `"@fxl-business/hub-sdk": "2.3.0"` (exact). 2.5.0 and 2.5.0 of `hub-sdk-testing` are published on npm. The 2.5.0 upgrade is additive over 2.3.0 (spec section 3), so the whole suite must stay green after the bump before any other change.

`pnpm-workspace.yaml` pins `hono` to `4.12.28` via an override so only one Hono resolves; confirm this still holds after the bump.

## Steps (TDD-adapted: this is a dependency bump, so "red" is the pre-bump state and "green" is the full suite after)

1. Edit `apps/api/package.json:20` and `apps/web/package.json:19`: `"@fxl-business/hub-sdk": "2.5.0"` (exact, no caret).
2. `pnpm install` at the repo root. Confirm `pnpm-lock.yaml` updates to 2.5.0 for both apps and that the Hono override still resolves a single `hono@4.12.28` (`pnpm why hono` or inspect the lock; the transitive tree may differ from 2.3.0 - if a second Hono appears, that is a real problem to solve here, not defer).
3. Update pin/guard references that assert 2.3.0:
   - `nexo/knowledge/reference/auth-model.md` (the line stating the SDK is pinned EXACTLY at `@fxl-business/hub-sdk@2.3.0`) -> 2.5.0.
   - `CLAUDE.md` Auth Model section ("pinned EXACTLY at `@fxl-business/hub-sdk@2.3.0`") -> 2.5.0.
   - Grep the repo for `2.3.0` and `hub-sdk@2.3.0` (excluding `pnpm-lock.yaml` history and `.worktrees`): fix any tracked test or guard that hardcodes `2.3.0` as the expected pin. Search: `git grep -n "2\.3\.0"` and `git grep -n "hub-sdk@2"`.
4. **Confirm the 2.5.0 surface** (record the evidence in the run notes; the later slices depend on it):
   - Browser client exposes `switchAccount`: inspect `node_modules/.pnpm/@fxl-business+hub-sdk@2.5.0*/node_modules/@fxl-business/hub-sdk/dist/client.d.ts` for `switchAccount(options?: { organization?: string })` and note its exact signature + return type (navigates vs returns).
   - Server exposes invitations: inspect `dist/server.d.ts` for `createHubInvitations` and `HubInvitationError`; record the exact shapes of `create`/`list`/`revoke`/`resend` args and returns (`invitation`, `acceptUrl`, `emailDelivery`, `warnings`, `invitations`), the `HubInvitationError` fields (`code`, `status`, `retryAfterSeconds`), and the exact name of the roles argument (`appRoles`).
   - `/auth/login` relays `prompt`: inspect `dist/server.js` login handler for `prompt` / `select_account` forwarding to `/authorize`.
   - Write these findings to `nexo/runs/<run-id>/sdk-2.5.0-surface.md` so slices 02/07/08 build against the real signatures.
5. Run the **full suite** and lint: `pnpm run lint`, `pnpm run type-check`, `CI=true pnpm test`, `pnpm run build`. All must pass. If any test hardcoded 2.3.0 as an assertion (not just a pin), fix it here.

## Acceptance / oracle

- Named oracle (fast per-slice verify): the SDK-pin guard test(s) that assert the exact version - after this slice they assert `2.5.0`. If a dedicated guard test exists (search `git grep -n "hub-sdk" -- '**/*.test.*' '**/*.mjs'`), that is the oracle; otherwise `apps/api/src/config/__tests__/env-example-contract.test.ts` plus `type-check` stand as the fast oracle.
- Full green suite is the real bar (this is a foundation slice; the wave-1 wave-verify runs the whole suite anyway).

## Notes for the executor

- If `pnpm install` surfaces a peer/transitive conflict (e.g. a second Hono), resolve it in `pnpm-workspace.yaml` / overrides here - do not defer, the whole feature sits on this.
- Do not touch any feature code. This slice is the clean, revertable foundation.
