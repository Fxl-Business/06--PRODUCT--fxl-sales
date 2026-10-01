# Sales owns seller invitation delivery; Hub account provisioning stays with the Hub

**Date:** 2026-10-01
**Surfaced by:** run `20260928T184208Z-hub-sdk-25-switch-account-invites` (milestone v4.1.0)

## Context

`createSellerAndInvite` in `apps/api/src/domains/sellers/admin-service.ts` inserted a `sellers` row and invited no one, despite its name.
The documented stance was that invitation delivery lived in Hub operator workflows.
`@fxl-business/hub-sdk` 2.5.0 added a server-side invitations client (`createHubInvitations`, `HubInvitationError`), and the Hub handoff `16--INTERNAL--fxl-hub/nexo/plans/multi-conta-estilo-google/handoffs/sales-sdk-2-5-0.md` asks each Application to send its own invitations.

## Decision

Sales sends the Hub invitation itself when an admin creates a seller, and stores the invitation state on the seller row.
Hub ACCOUNT provisioning is unchanged: `sellers.account_id` stays nullable and is filled only by the Hub side.

The product decisions were taken by the owner at Frame:
- The invited seller joins the admin's own active Organization, the `workspaceId` of the admin's verified token. The invite body never names an Organization; the Hub reads it from the actor token, and `invited_org_id` records it locally.
- The invite grants exactly `appRoles: ['seller']`.

The rules that make it safe:
- The actor token is the raw `Authorization` bearer, read in the route handler, never from a body and never from `hubAuth`.
- An invite failure never rolls back the seller. `POST /` answers `201` with the outcome in the body (`inviteError` by code, or the delivery fields with `warnings`).
- `POST /:id/invite` sends a new invitation to a seller with none or a revoked one, through the SAME helper as `POST /` (`inviteSellerRow`). `POST /:id/resend` and `POST /:id/revoke` act on the stored invitation id.
- A stored `invited_org_id` that differs from the admin's org answers the unknown-seller `404` before the Hub is called.
- `HubInvitationError` is mapped by `code` only (`mapInvitationError`); `acceptUrl` may reach the admin's screen and never a log.
- With no Hub configuration, or with the development identity adapter installed, the invitations client is null and the outcome is the existing `503 {"error":"unavailable","code":"hub_auth_not_configured"}` body. A valid local Hub config under `make dev-fake` must not reach the real Hub with a fake bearer, which is why the gate is `isAppAuthAdapterInstalled()` and not only the absence of config.
- `GET /` reconciles each stored status from `invitations.list()` called once per status, because the SDK's default is `pending` only. A failing status call leaves its rows at the stored value.

## Consequences

- The Hub's `apps/auth` must have `API_PUBLIC_URL` set, or every invite fails with `discovery_missing_api_url`.
- Migration `0026_seller_invitation_state` adds three nullable text columns to `sellers`; the table stays cross-org with no RLS.
- `seller` in `appRoles` is the Hub `AppRole`, unrelated to the org-scoped `vendedor` função.
