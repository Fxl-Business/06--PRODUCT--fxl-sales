# feat(sales-ops): move account controls to the sidebar footer

Milestone: v2.2.0

## Frame

The sales workspace currently repeats the signed-in identity and a standalone logout button in the page header.
The account identity should instead anchor the bottom of the navigation sidebar and expose account actions from a single user menu, matching the supplied reference.

## Acceptance Criteria

Given an authenticated user is viewing the expanded sales workspace, when the shell renders, then the sidebar footer shows the user's initials, name, and role summary while the header shows no account identity or logout control.
Given the sidebar account control is closed, when the user opens it, then a menu appears above the footer with the user's name, email, role summary, and a "Sair" action.
Given the account menu is open, when the user chooses "Sair", then the existing logout operation runs.
Given the sidebar is collapsed, when the shell renders, then the footer retains an accessible initials control that opens the same account menu without widening the sidebar.

## Scope Limits

This slice moves only the account identity and the existing logout action.
It does not add account-management, organization-management, or authorization destinations that the sales app does not currently expose.
It preserves the existing sales workspace palette, typography, spacing system, and responsive behavior.

## Test Contract

Red test: `pnpm --filter @fxl-sales/web test -- src/sales-ops/__tests__/routing.test.tsx` with a user-facing assertion that the account control lives in the sidebar, opens the account menu, is absent from the header, and invokes logout from the menu.
Green proof: the same test passes after the shell layout and account menu are implemented.
