---
id: 08-seller-invite-server
milestone: v4.1.0
status: todo
depends_on: [06-sellers-invitation-schema, 07-invitations-client-seam]
files_modified:
  - apps/api/src/domains/sellers/admin-service.ts
  - apps/api/src/domains/sellers/admin-routes.ts
  - apps/api/src/domains/sellers/__tests__/seller-invite.test.ts
acceptance: "given an admin creates a seller, when createSellerAndInvite runs, then the seller row is inserted AND invitations.create is called with the admin's Authorization bearer as accessToken, email = contactEmail, appRoles = ['seller'], no organizationId in the body; the invitation id + status are persisted; an invite failure keeps the seller and returns the code; and list/resend/revoke routes operate on the stored invitation id."
goal: "Wire createSellerAndInvite to actually send the Hub invite (admin token, seller role, no org in body), persist state, and add list/resend/revoke."
verifier_focus: "accessToken is the raw Authorization bearer threaded from the route handler (NOT body, NOT hubAuth). No organizationId in the invite body. Invite failure does NOT roll back the seller insert - the row persists and the response carries the HubInvitationError code + warnings. appRoles is exactly ['seller']. Routes stay under the inherited requireAdmin (no re-applied auth)."
must_not_break:
  - "Existing POST / create contract still returns the seller; now augmented with invite outcome."
  - "requireAdmin gating inherited from admin/index.ts (do not re-apply)."
  - "reduzirLiquidacao/settlements and other domains untouched."
rules:
  - "appRoles MUST be exactly ['seller'] (human decision 2)."
  - "invited_org_id is set from the admin's token workspaceId (c.get('orgId'))."
  - "acceptUrl and warnings go in the HTTP response; acceptUrl is never logged."
  - "Use mapInvitationError (slice 07) for every HubInvitationError; key on code."
  - "PINNED (plan-check C3): the revoke route is POST /:id/revoke (matches slice 09). Do NOT use DELETE."
  - "PINNED (plan-check C4): locale defaults to 'pt-BR'; the create/resend route accepts an OPTIONAL body field `locale` validated to z.enum(['pt-BR','en']) and passes it through; absent => 'pt-BR'."
  - "PINNED (plan-check C2): GET / reconciles invitation state. When getInvitationsClient() is present, the list route calls client.list({ accessToken }) and, for sellers with a stored invitationId, updates the persisted invitation_status to the Hub's current state (pending|accepted|expired|revoked) before returning; persisted status is the fallback when list() is unavailable. This is the ONLY place accepted/expired can appear (create writes pending, revoke writes revoked)."
  - "Update the admin-service.ts header comment (plan-check C6): it currently says 'Hub account provisioning is operator-owned, so account_id remains nullable.' Keep the account_id/provisioning point, but add that invitation DELIVERY is now owned by Sales via createHubInvitations (account provisioning still operator-owned). Reference the Capture ADR."
---

# Slice 08 - seller invitations on the server

## Context (from investigation)

- Service stub: `apps/api/src/domains/sellers/admin-service.ts:21-40` `createSellerAndInvite(input, _adminUserId)` inserts `sellers` with `accountId:null` and invites no one. `listSellers()` (~16-19), `setSellerStatus()` (~42-53).
- Routes: `apps/api/src/domains/sellers/admin-routes.ts` - `GET /`, `POST /` (calls `createSellerAndInvite(parsed.data, c.get('userId'))`), `PATCH /:id/status`. Mounted under `appAuthMiddleware + requireAdmin` via `admin/index.ts` (do not re-apply auth).
- The admin's raw bearer is NOT on context; read `c.req.header('Authorization')` and strip `Bearer ` in the route handler, then pass down. `c.get('orgId')` is the admin's active workspace id (the invite target org).
- Seam + mapper from slice 07 (`getInvitationsClient`, `mapInvitationError`). Columns from slice 06 (`invitationId`, `invitationStatus`, `invitedOrgId`).

## Steps (TDD)

1. **seller-invite.test.ts (red):** using an injected fake invitations client (slice 07 seam) and the `hubAuthContext` fixture / a tiny Hono app:
   - POST create calls `fake.create` once with `{ accessToken: '<the exact bearer>', email: contactEmail, appRoles: ['seller'], locale }` and **no** `organizationId`; persists `invitationId` + `invitationStatus='pending'` + `invitedOrgId=<orgId>`; response carries `invitation`, `acceptUrl`, `emailDelivery`, `warnings`.
   - A `HubInvitationError` from create leaves the seller row inserted and returns the mapped code/status (assert the row still exists).
   - `POST /:id/resend` calls `fake.resend({ accessToken, invitationId, locale })`; `POST /:id/revoke` (or DELETE, match repo REST style) calls `fake.revoke({ accessToken, invitationId })` and sets `invitationStatus='revoked'`.
   - `GET /` reconciles: with the fake present, it calls `fake.list({ accessToken })` and updates each stored seller's `invitationStatus` to the Hub's current state (assert an `accepted`/`expired` from the fake surfaces on the row); persisted status is the fallback when list is unavailable.
2. **admin-service.ts (green):**
   - Change `createSellerAndInvite(input, ctx)` to accept the admin `accessToken` + `orgId` (thread from the route). Insert seller (unchanged), then `const client = getInvitationsClient()`; if present call `client.create({ accessToken, email: input.contactEmail, appRoles: ['seller'], locale })`; on success update the row `invitationId`, `invitationStatus='pending'`, `invitedOrgId=orgId`; return `{ seller, invitation, acceptUrl, emailDelivery, warnings }`. On `HubInvitationError` return `{ seller, inviteError: mapInvitationError(err) }` WITHOUT rolling back. If no client (config absent, e.g. dev), return the seller with a legible `network_error`/`discovery_missing_api_url`-style outcome (spec section 8) and do not throw.
   - Add `listSellerInvitations` / `resendInvitation(sellerId, accessToken)` / `revokeInvitation(sellerId, accessToken)` using the stored `invitationId`.
3. **admin-routes.ts (green):**
   - In `POST /`, read the bearer: `const authz = c.req.header('Authorization') ?? ''; const accessToken = authz.replace(/^Bearer\s+/i, '')`; pass `{ accessToken, orgId: c.get('orgId') }` into the service. Return 201 with the invite outcome. Map `inviteError` to the HTTP status from `mapInvitationError`.
   - Add `POST /:id/resend` and `POST /:id/revoke` (admin-inherited), threading the bearer the same way; use `mapInvitationError` for failures.

## Acceptance / oracle

- Named oracle: `apps/api/src/domains/sellers/__tests__/seller-invite.test.ts`.

## Notes

- Idempotency / re-invite semantics (spec section 2: re-inviting the same email replaces the pending invite) are the Hub's; Sales just stores the returned id.
- Never send `organizationId` in the invite body (400 on the Hub). The org is the admin token's.
