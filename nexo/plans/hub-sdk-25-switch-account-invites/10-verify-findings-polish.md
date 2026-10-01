---
id: 10-verify-findings-polish
milestone: v4.1.0
status: todo
depends_on: [03-trocar-conta-account-menu, 04-trocar-conta-entitlement-panel, 05-trocar-conta-no-role, 08-seller-invite-server]
files_modified:
  - apps/web/src/sales-ops/AccountAvatar.tsx
  - apps/web/src/sales-ops/SalesOpsApp.tsx
  - apps/web/src/sales-ops/MissingEntitlementPanel.tsx
  - apps/web/src/pages/errors/NoRolePage.tsx
  - apps/web/src/sales-ops/__tests__/account-avatar.test.tsx
  - apps/web/src/sales-ops/__tests__/shell-organization-switcher.test.tsx
  - apps/web/src/sales-ops/__tests__/entitlement-dead-end.test.tsx
  - apps/web/src/__tests__/no-role-redirect.test.tsx
  - apps/api/src/domains/sellers/admin-service.ts
  - apps/api/src/domains/sellers/__tests__/seller-invite.test.ts
  - apps/api/test/rls/setup-env.ts
  - apps/api/test/rls/assert-test-role.ts
  - apps/api/src/domains/sellers/__tests__/seller-routes-admin-gate.test.ts
acceptance: "given the non-blocking findings Gate 2 raised on slices 03, 04, 05, 08 and the wave-1 verify, when this slice lands, then one shared AccountAvatar renders on all three account surfaces, the shell header never renders workspaceId, SalesOpsApp never passes onRetry to MissingEntitlementPanel (locked by a test), the no-role English test emits no act() warning, resend/revoke refuse a seller whose invitedOrgId is not the admin's org, and the integration suite refuses to run as a Postgres superuser or against a non-local host."
goal: "Close the Gate 2 follow-ups of this run in one atomic polish slice, added at Execute (engine adapt), so nothing is left as a known gap on master."
verifier_focus: "Each item has its own RED-first test. AccountAvatar is ONE module imported by SalesOpsApp, MissingEntitlementPanel and NoRolePage, importing neither of them (no cycle). The setup-env refusal is proven by pointing it at a superuser URL and at a non-local host and observing a loud failure, and by the normal local run still passing as fxl_sales_test."
must_not_break:
  - "Every existing oracle of slices 03, 04, 05, 08."
  - "The visual result of the three avatars (same classes, same initials fallback, same onError behaviour)."
  - "CLAUDE.md Local database guard rules; apps/api/src/db/local-database-guard.ts stays pure."
rules:
  - "AccountAvatar: extract the existing component verbatim into apps/web/src/sales-ops/AccountAvatar.tsx (it may import `initials` from ./calculations only). Keep the panel's behaviour of hiding the account line when name and email are both missing; the shell keeps its 'FXL' fallback. Delete the copy in MissingEntitlementPanel.tsx and whatever NoRolePage uses, so exactly one implementation remains."
  - "Shell header: add a test that sets profile.workspaceId and asserts it never renders; if it renders today, fix the fallback (never show raw ids, CLAUDE.md UI Identifiers)."
  - "entitlement-dead-end.test.tsx gains an assertion that SalesOpsApp renders MissingEntitlementPanel with no onRetry (CLAUDE.md Organization context)."
  - "no-role English test: wrap i18n.changeLanguage in act() so no 'not wrapped in act' warning prints; assert the warning is absent if feasible."
  - "resend/revoke: when the stored invitedOrgId is non-null and differs from c.get('orgId'), answer 404 (same as unknown seller, no existence leak) without calling the Hub. Test-first."
  - "setup-env: never fall back to DATABASE_URL (it may be remote) and never default to the postgres superuser. Resolve TEST_DATABASE_URL and ADMIN_DATABASE_URL; when absent, fail with a message naming the variables and the documented local values. Every resolved URL must be a local host per apps/api/src/db/local-database-guard.ts (reuse it, do not re-implement). Add assert-test-role.ts, run once per integration run (global setup or the existing setup file), that connects with the app URL and refuses `rolsuper = true` or `rolbypassrls = true`. Keep the hard DATABASE_URL override the file already has."
  - "Added from wave3-verify: a test mounts the REAL admin router (apps/api/src/domains/admin/index.ts) and proves a non-admin token gets the requireAdmin 403 on GET /, POST /, POST /:id/resend and POST /:id/revoke of the sellers routes, with the Hub never called."
  - "Added from wave3-verify: NoRolePage 'Trocar conta' ignores a second click (disabled + guard), matching MissingEntitlementPanel."
---

# Slice 10 - Gate 2 follow-ups (polish)

Added at Execute on 2026-10-01 by the orchestrator (engine adapt, `total_slices` consumed) from the non-blocking findings of these Verify results in `.nexo/runs/20260928T184208Z-hub-sdk-25-switch-account-invites/agents/`: `wave1-verify`, `03-verify`, `04-verify`, `04-verify-2`, `05-verify`, `08-verify`.

It runs in wave 4 beside slice 09; the two share no file.

## Oracle

- `apps/web/src/sales-ops/__tests__/account-avatar.test.tsx` (new), `shell-organization-switcher.test.tsx`, `missing-entitlement-panel.test.tsx`, `entitlement-dead-end.test.tsx`, `no-role-redirect.test.tsx`.
- `apps/api/src/domains/sellers/__tests__/seller-invite.test.ts`.
- `pnpm --filter @fxl-sales/api test:integration` passes locally as `fxl_sales_test`, and fails loudly with a superuser URL or a non-local host.
