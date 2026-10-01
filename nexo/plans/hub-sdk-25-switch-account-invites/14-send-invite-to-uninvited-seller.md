---
id: 14-send-invite-to-uninvited-seller
milestone: v4.1.0
status: todo
depends_on: [11-invite-locale-and-429-body, 10-verify-findings-polish]
files_modified:
  - apps/api/src/domains/sellers/admin-service.ts
  - apps/api/src/domains/sellers/admin-routes.ts
  - apps/api/src/domains/sellers/__tests__/seller-invite.test.ts
  - apps/web/src/admin/sellers/AdminSellersPage.tsx
  - apps/web/src/admin/sellers/hooks/useSellers.ts
  - apps/web/src/lib/api-client.ts
  - apps/web/src/i18n/pt-BR.json
  - apps/web/src/i18n/en.json
  - apps/web/src/admin/sellers/__tests__/AdminSellersPage.test.tsx
acceptance: "given a seller whose invite failed at create (no invitationId) or whose invitation was revoked, when the admin clicks 'Enviar convite' on that row, then POST /api/v1/admin/sellers/:id/invite creates a NEW Hub invitation with the same rules as create (bearer from Authorization header, appRoles ['seller'], no organizationId, locale from the UI), persists invitationId + 'pending' + invitedOrgId = c.get('orgId'), and the UI shows the outcome exactly like create's (warnings, acceptUrl, errors by code). A seller with a pending or expired invitation answers 409 `seller_already_invited` and keeps using Reenviar."
goal: "Close the browser-found gap: today a failed create leaves the seller with no invitation and no action at all, contradicting the non-negotiable 'invite failure never rolls back the seller ... so the admin can resend later'."
verifier_focus: "The new route reuses the SAME create helper as POST / (one place builds the Hub create call), keeps every non-negotiable, is under the inherited requireAdmin, applies the slice-10 cross-org rule (stored invitedOrgId non-null and different => 404), validates the uuid, answers INVITATIONS_UNAVAILABLE with no client, and never rolls anything back. The UI shows 'Enviar convite' only on rows with no invitation or a revoked one, and the hub_auth_not_configured copy no longer tells the admin to 'reenviar' an invitation that does not exist (it points to this action instead)."
must_not_break:
  - "Every slice 08, 09, 10, 11 oracle."
rules:
  - "Added at Execute from the orchestrator's browser check under make dev-fake (engine adapt)."
  - "Also kill mutation survivors X14 (a non-uuid id on resend/revoke/invite answers 404 without reaching db or Hub), X37 (one failing status call in GET / reconcile does not stop the other statuses from updating), X29 (a body retryAfterSeconds of 0 is preserved) - see .nexo/runs/20260928T184208Z-hub-sdk-25-switch-account-invites/agents/mutation.result.json."
  - "Do NOT change POST /:id/resend semantics (still 409 seller_not_invited with no invitation)."
---

# Slice 14 - send an invitation to a seller without one

## Oracle

- `apps/api/src/domains/sellers/__tests__/seller-invite.test.ts`
- `apps/web/src/admin/sellers/__tests__/AdminSellersPage.test.tsx`
