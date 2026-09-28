---
id: 04-trocar-conta-entitlement-panel
milestone: v4.1.0
status: todo
depends_on: [02-web-switchaccount-seam]
files_modified:
  - apps/web/src/sales-ops/MissingEntitlementPanel.tsx
  - apps/web/src/sales-ops/missing-entitlement-copy.ts
  - apps/web/src/sales-ops/__tests__/missing-entitlement-panel.test.tsx
acceptance: "given the 402 buy screen (person likely signed in with the wrong account), when the operator clicks 'Trocar conta', then the provider switchAccount is called once (with the active org when one exists), the action is a distinct control from the per-org switch and the Hub checkout, and the panel names the active account."
goal: "Add 'Trocar conta' to MissingEntitlementPanel and show which account is active."
verifier_focus: "Copy comes from MISSING_ENTITLEMENT_COPY (this panel does not use i18n; the oracle asserts exact literals). The panel still passes no onRetry and never reloads the page. switchAccount goes through the provider wrapper."
must_not_break:
  - "Existing org-switch section (data-organization-switch) and Hub checkout section (data-hub-checkout) behavior."
  - "The panel passes no onRetry and never reloads (organization-context rule)."
rules:
  - "Add the copy key to MISSING_ENTITLEMENT_COPY (e.g. switchAccount: 'Trocar conta'); the oracle imports these literals."
  - "Active account name/email/avatar are display-only; tolerate absence."
---

# Slice 04 - "Trocar conta" in MissingEntitlementPanel

## Context (from investigation)

`apps/web/src/sales-ops/MissingEntitlementPanel.tsx`:
- `const { active, activeName, others, setActive, client } = useOrganizations();` (~line 68). Add `switchAccount` here.
- Header/active-org naming ~168-189 (`data-active-organization`).
- Switch section ~203-244 (`data-organization-switch`), only when `others.length > 0`.
- Hub checkout section ~246-284 (`data-hub-checkout`).
- All copy from `MISSING_ENTITLEMENT_COPY` in `apps/web/src/sales-ops/missing-entitlement-copy.ts` (~16-41), hardcoded pt-BR object.

This panel is exactly where a person who signed in with the wrong account lands (they have no Sales access on this account), so "Trocar conta" is high-value here.

## Steps (TDD)

1. **missing-entitlement-panel.test.tsx (red):** assert a "Trocar conta" control renders (import the copy literal), that clicking it calls a mocked `switchAccount` once (with the active org id when present), and that the active account identity (name/email) is shown. Keep asserting no `onRetry`/no reload.
2. **missing-entitlement-copy.ts:** add `switchAccount: 'Trocar conta'` (and any label/aria strings needed) to `MISSING_ENTITLEMENT_COPY`.
3. **MissingEntitlementPanel.tsx (green):**
   - Add `switchAccount` to the `useOrganizations()` destructure.
   - Render a distinct "Trocar conta" action (a full-account switch when none of this account's orgs carry Sales) - place it after the checkout section or alongside the switch section, visibly separate from the per-org rows. Wire to `switchAccount({ organization: active?.id })`.
   - Show the active account name/email (and avatar if available) near the header, using the profile/claims (read via the existing hooks; display-only).

## Acceptance / oracle

- Named oracle: `apps/web/src/sales-ops/__tests__/missing-entitlement-panel.test.tsx`. Keep `entitlement-dead-end.test.tsx` green (do not change the 402 routing contract).
