---
id: 05-trocar-conta-no-role
milestone: v4.1.0
status: todo
depends_on: [02-web-switchaccount-seam]
files_modified:
  - apps/web/src/pages/errors/NoRolePage.tsx
  - apps/web/src/i18n/pt-BR.json
  - apps/web/src/i18n/en.json
  - apps/web/src/__tests__/no-role-redirect.test.tsx
acceptance: "given a person whose entire account has no FXL Sales role (the no-role page), when they click 'Trocar conta', then the provider switchAccount is called once, the button sits beside 'Sair', the copy resolves from i18n in both pt-BR and en, and the page names the active account."
goal: "Add 'Trocar conta' (i18n) to NoRolePage and show the active account."
verifier_focus: "This surface uses react-i18next: add errors.noRole.switchAccount to BOTH pt-BR.json and en.json (keys-resolve.test.ts enforces sync). switchAccount goes through the provider wrapper."
must_not_break:
  - "keys-resolve.test.ts (both locale files must stay in sync)."
  - "NoRoleGuard redirect behavior (getVisibleWorkspaces(roles).length > 0)."
rules:
  - "pt-BR: 'Trocar conta'; en: 'Switch account'."
  - "Active account name/email/avatar display-only; tolerate absence."
---

# Slice 05 - "Trocar conta" in NoRolePage

## Context (from investigation)

`apps/web/src/pages/errors/NoRolePage.tsx` (~13-25): uses `useTranslation()`; renders `t('errors.noRole.title')`, `t('errors.noRole.body')`, and a `Button variant="outline"` calling `logout()` with `t('errors.noRole.signOut')`. This is the one surface here that uses i18n.

`apps/web/src/i18n/pt-BR.json` and `en.json` have parallel `errors.noRole` blocks (~lines 18-22). `apps/web/src/i18n/__tests__/keys-resolve.test.ts` enforces both files stay in sync.

## Steps (TDD)

1. **no-role-redirect.test.tsx (red):** assert NoRolePage renders a "Trocar conta" button beside "Sair" and that clicking it calls a mocked `switchAccount` once. (The suite imports `@/i18n`.)
2. **i18n:** add `"switchAccount": "Trocar conta"` to `pt-BR.json` under `errors.noRole`, and `"switchAccount": "Switch account"` to `en.json` under `errors.noRole`.
3. **NoRolePage.tsx (green):**
   - Read `switchAccount` (and the active org + profile identity) from the auth hooks (`useOrganizations` / `useAuthProfile`).
   - Add a second `Button` beside "Sair" using `t('errors.noRole.switchAccount')`, wired to `switchAccount({ organization: active?.id })`.
   - Optionally show the active account name/email near the body (display-only) so the person can see which account has no role.

## Acceptance / oracle

- Named oracle: `apps/web/src/__tests__/no-role-redirect.test.tsx` + `apps/web/src/i18n/__tests__/keys-resolve.test.ts`.
