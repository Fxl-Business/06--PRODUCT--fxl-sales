---
id: 09-admin-sellers-invite-ui
milestone: v4.1.0
status: todo
depends_on: [08-seller-invite-server]
files_modified:
  - apps/web/src/admin/sellers/AdminSellersPage.tsx
  - apps/web/src/admin/sellers/hooks/useSellers.ts
  - apps/web/src/lib/api-client.ts
  - apps/web/src/i18n/pt-BR.json
  - apps/web/src/i18n/en.json
  - apps/web/src/admin/sellers/__tests__/AdminSellersPage.test.tsx
acceptance: "given the admin sellers page, when an admin creates a seller the invite outcome (success, warnings, or error code) is shown, each row shows invitation state (pending/accepted/expired/revoked) with resend and revoke actions, and every warning/error is rendered by code (application_url_missing informs operator; email_not_configured shows a copyable acceptUrl; email_failed offers resend)."
goal: "Surface invitation state + resend/revoke + create-result warnings in the admin sellers UI, messaged by code."
verifier_focus: "Warnings and errors are rendered by code, never by raw message; acceptUrl appears on screen (copyable) for email_not_configured, never logged; resend/revoke call the new endpoints; i18n keys added to BOTH locale files."
must_not_break:
  - "keys-resolve.test.ts locale sync."
  - "Existing create dialog validation (displayName >= 2, contactEmail includes @)."
rules:
  - "Reuse existing components (Table, Dialog, Badge, Button); no parallel style."
  - "Messages by code per spec section 5.8; acceptUrl copyable, never logged."
  - "PINNED (plan-check C3): revoke calls POST /api/v1/admin/sellers/:id/revoke (matches slice 08)."
  - "PINNED (plan-check C2): the four invitation states (pending/accepted/expired/revoked) come from SellerRow.invitationStatus, which slice 08's GET / reconciles from the Hub. The UI renders whatever status the list returns; it does not compute accepted/expired itself."
  - "RECONCILED 2026-10-01: an invite outcome or resend/revoke error with code `hub_auth_not_configured` (no Hub configured, or make dev-fake) renders an operator-item message on the create result and keeps the new seller row visible; it is never a generic failure. Add it to the code->copy map in BOTH locale files."
---

# Slice 09 - admin sellers invitation UI

## Context (from investigation)

- Page: `apps/web/src/admin/sellers/AdminSellersPage.tsx` (~135 lines). Create dialog (~45-94) with `displayName` + `contactEmail`; on success just closes the dialog. List (~97-131) is a 3-column table (Name/Email/Status) with no invite column, no per-row actions.
- Hooks: `apps/web/src/admin/sellers/hooks/useSellers.ts` - `useSellers()` (list), `useInviteSeller()` (create, invalidates the list).
- API client: `apps/web/src/lib/api-client.ts:237-251` - `adminSellersApi.list/create/setStatus`. Add `resendInvitation` + `revokeInvitation` calls to the new endpoints from slice 08.
- Types: `apps/web/src/admin/types.ts` `SellerRow` now carries `invitationId/invitationStatus/invitedOrgId` (slice 06).
- Analog error copy already in the finders path: 502 "Convite nao enviado, tente reenviar." is a template.

## Steps (TDD)

1. **AdminSellersPage.test.tsx (red):**
   - After create, the invite outcome renders: with `warnings: ['email_not_configured']` a copyable `acceptUrl` is shown; with `email_failed` a resend affordance is offered; with `application_url_missing` an operator note is shown; with an error code (e.g. `application_not_granted`) the mapped message renders.
   - The list shows an invitation-state cell per row (pending/accepted/expired/revoked) and per-row Resend/Revoke actions that call mocked API functions.
2. **api-client.ts:** add `adminSellersApi.resendInvitation(id, token)` and `revokeInvitation(id, token)` hitting `POST /api/v1/admin/sellers/:id/resend` and `/revoke`.
3. **useSellers.ts:** add `useResendSellerInvitation()` and `useRevokeSellerInvitation()` mutations invalidating the list; ensure `useInviteSeller` surfaces the invite outcome (return the response body so the page can show warnings/errors/acceptUrl).
4. **AdminSellersPage.tsx (green):**
   - Add an "Convite" column rendering `invitationStatus` as a Badge (map each state to a label + variant).
   - Add per-row Resend/Revoke buttons wired to the new mutations (guard by state where sensible: resend for pending/expired/failed; revoke for pending).
   - After create, show the invite outcome inline: warnings by code (copyable `acceptUrl` for `email_not_configured`; resend for `email_failed`; operator note for `application_url_missing`) and error codes via the mapped messages.
5. **i18n:** add the new labels/messages to `pt-BR.json` and `en.json` (keep in sync).

## Acceptance / oracle

- Named oracle: `apps/web/src/admin/sellers/__tests__/AdminSellersPage.test.tsx` + `apps/web/src/i18n/__tests__/keys-resolve.test.ts`.
