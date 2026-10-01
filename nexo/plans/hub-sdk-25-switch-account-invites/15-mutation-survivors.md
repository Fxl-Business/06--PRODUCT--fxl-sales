---
id: 15-mutation-survivors
milestone: v4.1.0
status: todo
depends_on: [10-verify-findings-polish]
files_modified:
  - apps/web/src/sales-ops/MissingEntitlementPanel.tsx
  - apps/web/src/sales-ops/__tests__/missing-entitlement-panel.test.tsx
  - apps/web/src/pages/errors/NoRolePage.tsx
  - apps/web/src/__tests__/no-role-redirect.test.tsx
  - apps/web/src/auth/react.tsx
  - apps/web/src/auth/__tests__/react.test.tsx
  - apps/api/src/domains/sellers/__tests__/invitations-client.test.ts
acceptance: "given the feature mutation battery's survivors X22, X25, X19, X18, when this slice lands, then two clicks inside one act on MissingEntitlementPanel's Trocar conta call switchAccount once (ref guard like NoRolePage), NoRolePage renders an email-only account's email once, the switchAccount seam treats an empty organization hint as absent, and getInvitationsClient returns null (never throws) when createHubInvitations throws."
goal: "Close the actionable mutation survivors that do not touch the sellers routes (X14, X29, X37 ride slice 14's seller-invite.test.ts and AdminSellersPage tests instead)."
verifier_focus: "Each fix has its own RED-first test; re-apply each original mutant and confirm it is now KILLED."
must_not_break:
  - "Slices 02, 04, 05, 07, 10 oracles."
rules:
  - "Added at Execute from mutation.result.json (engine adapt)."
---

# Slice 15 - mutation survivors (web panels, seam, client)

## Oracle

- `missing-entitlement-panel.test.tsx`, `no-role-redirect.test.tsx`, `react.test.tsx`, `invitations-client.test.ts`.
