---
id: 03-trocar-conta-account-menu
milestone: v4.1.0
status: todo
depends_on: [02-web-switchaccount-seam]
files_modified:
  - apps/web/src/sales-ops/SalesOpsApp.tsx
  - apps/web/src/sales-ops/__tests__/shell-organization-switcher.test.tsx
acceptance: "given the account menu is open, when the operator clicks 'Trocar conta', then the provider switchAccount is called once (with the active organization when one exists), the action sits in the account-level group (near 'Sair'), separate from the per-org rows, and the menu shows the active account's name and email (and avatar when present)."
goal: "Add 'Trocar conta' to the SalesOps account dropdown and show the active account identity."
verifier_focus: "'Trocar conta' is distinct from the AccountOrganizationSection per-org rows (switch account != switch org); it calls the provider wrapper, not client.switchAccount directly; pt-BR copy is hardcoded here (this shell does not use i18n)."
must_not_break:
  - "AccountOrganizationSection guard `if (others.length === 0) return null` stays."
  - "The 'Sair' item and logout flow stay intact."
rules:
  - "Hardcoded pt-BR copy 'Trocar conta' (this file does not use react-i18next)."
  - "Active account name/email/avatar are display-only: tolerate any being absent without breaking."
---

# Slice 03 - "Trocar conta" in the account menu

## Context (from investigation)

`apps/web/src/sales-ops/SalesOpsApp.tsx`:
- Account menu trigger "Abrir menu da conta" ~lines 1904-1982, controlled by `accountMenuOpen`.
- `DropdownMenuLabel` ~1946-1963 already shows initials + `userName` + `profile.email` (guarded) + `roleLabel`.
- `<AccountOrganizationSection onSwitched={...} />` ~line 1965 renders the per-org switch rows (guarded `others.length === 0`).
- `DropdownMenuGroup` ~1966-1980 holds the single "Sair" item.
- `profile` from `useAuthProfile()` (~1224); `userName = profile.name ?? 'FXL'` (~1582). `profile.avatarUrl` exists but is not yet rendered.
- Icons from `lucide-react` already imported (~3-26): `Building2`, `Check`, `ChevronUp`, `LogOut`, etc. Use a suitable one (e.g. `Users` / `UserRoundCog` / `Repeat` - pick one already imported or add to the import).

## Steps (TDD)

1. **shell-organization-switcher.test.tsx (red):** extend the oracle - open the menu, assert a "Trocar conta" item exists in the account-level group (not among the org rows), and clicking it calls a mocked `switchAccount` once with `{ organization: <activeId> }`. Assert the active account name + email render.
2. **SalesOpsApp.tsx (green):**
   - Pull `switchAccount` (and `active`) from `useOrganizations()` where the menu already reads org data.
   - Add a `DropdownMenuItem` "Trocar conta" inside the `DropdownMenuGroup` (near "Sair", ~1966-1980), calling `switchAccount({ organization: active?.id })` then closing the menu. Give it an icon + `aria-label`.
   - Optionally render `profile.avatarUrl` as the avatar image in the label when present (fallback to initials) - display-only, guarded.

## Acceptance / oracle

- Named oracle: `apps/web/src/sales-ops/__tests__/shell-organization-switcher.test.tsx`.
