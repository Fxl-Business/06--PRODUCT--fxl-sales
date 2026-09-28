---
feature: hub-sdk-25-switch-account-invites
milestone: v4.1.0
---

# Feature: upgrade to hub-sdk 2.5.0 - "Trocar conta" + real seller invitations

## What + why

Upgrade both apps from `@fxl-business/hub-sdk` **2.3.0 -> 2.5.0** to unlock two capabilities that exist only in 2.5.0:

1. **Trocar conta (switch account).** The Hub now keeps up to ten authenticated accounts per browser and offers passwordless switching via `hub.switchAccount({ organization })`. Sales exposes a "Trocar conta" action in three places where a person may be signed in with the wrong account: the account menu, the missing-entitlement (402) panel, and the no-role page. The motivating incident happened in Finance: a person signed in with the wrong account landed on the Organization chooser with no way to see which account was active and no way to switch. Sales has the same risk.
2. **Real seller invitations.** `createSellerAndInvite` in the sellers admin today inserts the row and invites no one (despite its name). It now sends a genuine Hub invitation through the SDK's server-side invitations client, stores the invitation id + state on the seller row, and the admin UI shows invitation state with resend/revoke.

This deliberately **reverses** the prior documented stance ("Hub account provisioning is operator-owned; invitation delivery lives in Hub operator workflows"). The reversal is authorized by the handoff spec and is recorded as an ADR at Capture.

## Blocking product decisions (spec section 7) - RESOLVED by the human at Frame

- **Which Organization the invited seller joins:** the **admin's own active Organization** (the `workspaceId` in the admin's verified token). There is no other-org provisioning path. The new migration stores the target org id alongside the invitation id so the row records which org the invite targeted.
- **Which `appRoles` the invite grants:** **`['seller']`** only. `seller` is the repo's clear product `AppRole` (`apps/web/src/auth/claims.ts`), distinct from the org-scoped `vendedor` funcao. No per-seller role picker in this feature.

## Non-negotiable constraints carried into every slice

- **SDK pinned EXACTLY** (no caret) in both apps, as `2.5.0`. Update the guard/pin references that assert `2.3.0` (`nexo/knowledge/reference/auth-model.md`, `CLAUDE.md`, and any tracked-file guard). The `pnpm-workspace.yaml` Hono `4.12.28` override must still resolve one Hono copy after the bump.
- **Do NOT install `@fxl-business/hub-sdk-testing`.** This repo does not use `createDevHubClient`; the dev client is hand-rolled in `apps/web/src/dev/install-dev-identity.ts` and `satisfies HubClient`, so it only needs a `switchAccount` shim to keep compiling. Per spec section 8 the dev `switchAccount` never navigates and behaves like the dev client's `login` (reload).
- **The admin's access token for an invite comes from `c.req.header('Authorization')`** in the route handler (Bearer, already verified by `appAuthMiddleware`), threaded into the service. **Never** from the request body, **never** from `hubAuth`. Never send `organizationId` in the invite body (the org is the token's).
- **Invite failure never rolls back the seller row.** Save the seller, attempt the invite, return the invite outcome (success / `warnings` / `HubInvitationError.code`) so the admin can resend later.
- **`HubInvitationError` is handled by `code`, never by message.** `acceptUrl` may reach the screen, never a log.
- Invite routes stay under `appAuthMiddleware + requireAdmin` (inherited from `apps/api/src/domains/admin/index.ts`); do not re-apply auth in the sub-router.
- **Delivery stops at `master`.** No push, no promotion to staging/production (spec section 10 + repo rules). Gate 3 is not part of this flow.
- Copy lives per-surface: hardcoded pt-BR in `SalesOpsApp.tsx`; the `MISSING_ENTITLEMENT_COPY` object for the panel; i18n JSON (`errors.noRole.*`, both `pt-BR.json` and `en.json`, kept in sync by `keys-resolve.test.ts`) for `NoRolePage`.

## Slice index

| # | slice | goal | depends_on | wave |
|---|---|---|---|---|
| 01 | sdk-bump-2.5.0 | Bump SDK 2.3.0->2.5.0 in both apps, install, fix pins/guards, prove suite still green, confirm 2.5.0 surface (`switchAccount`, `createHubInvitations`, `HubInvitationError`, `prompt=select_account` relay) | - | 1 |
| 02 | web-switchaccount-seam | Add `switchAccount` through the auth provider seam + dev-client shim + guard test that no route hand-builds `prompt=` | 01 | 2 |
| 03 | trocar-conta-account-menu | "Trocar conta" in the SalesOps account menu; show active account name/email/avatar | 02 | 3 |
| 04 | trocar-conta-entitlement-panel | "Trocar conta" in `MissingEntitlementPanel`; show active account | 02 | 3 |
| 05 | trocar-conta-no-role | "Trocar conta" in `NoRolePage` (i18n) + show active account | 02 | 3 |
| 06 | sellers-invitation-schema | Migration 0025 + schema: `sellers` gains invitation id/status + invited org id; web `SellerRow` type gains the fields | 01 | 2 |
| 07 | invitations-client-seam | Sales-side invitations interface wrapping `createHubInvitations(config)` (single instance) + `HubInvitationError` code->response mapper + injectable fake for tests | 01 | 2 |
| 08 | seller-invite-server | `createSellerAndInvite` sends the invite (accessToken from header, appRoles `['seller']`, no org in body), persists id/state; add list/resend/revoke routes+service; failures keep the seller | 06, 07 | 3 |
| 09 | admin-sellers-invite-ui | Admin sellers page shows invitation state per row + resend/revoke + create-result warnings (`application_url_missing`/`email_not_configured` show `acceptUrl`/`email_failed` offers resend); messages by `code` | 08 | 4 |

## Waves (derived from depends_on; verified by waves.sh)

- **Wave 1:** 01 (foundation - everything depends on the SDK bump).
- **Wave 2:** 02, 06, 07 (disjoint files: web auth seam / db schema / new api invitations module).
- **Wave 3:** 03, 04, 05, 08 (disjoint files: three web surfaces + server invite service).
- **Wave 4:** 09 (admin UI, needs the server routes from 08).

## Verification posture

- Gate 2 per slice: the slice's named oracle test(s) + lint on the diff, by a **separate** Verify agent (never the implementer).
- Per-wave: full suite + full lint + security on integrated `master`, by a separate Verify agent.
- Merge queue runs **serially** on `master`: `nexo-wave-exec.sh` hardcodes the `main` trunk and pnpm worktrees lack per-worktree `node_modules`, so (as the last two runs did) slices build on `feat/*` branches off `master`, verify, and merge `--no-ff` serially; wave-verify runs separately. Gate 2 is not weakened.
- No mutation tool is configured in this repo; the feature-boundary mutation pass closes honestly as `skip / not_applicable` (per-slice oracle + wave-verify carry test-quality assurance).
