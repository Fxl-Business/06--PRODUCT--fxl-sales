# Run: Sidebar account menu

- Milestone: `v2.2.0`
- Branch: `feat/sidebar-account-menu`
- Slice commit: `b2be701e07e3caebcd049dff6fb6dae0ac2260b0`
- Status: Gate 2 PASS

## Frame

Move the signed-in identity and existing logout action from the Sales Ops header to one account menu anchored in the sidebar footer.
Keep the initials trigger accessible and functional when the sidebar is collapsed.

## Plan and test contract

The approved scope moved only account identity and logout, with no new account, organization, or authorization destinations.
The locked oracle was `pnpm --filter @fxl-sales/web test -- src/sales-ops/__tests__/routing.test.tsx`.
It asserts that identity lives in the sidebar, the header has no identity or logout control, the menu exposes email and `Sair`, and choosing `Sair` invokes the existing logout adapter.

## Red evidence

Commit `b2be701` adds the user-facing routing oracle `keeps account identity and logout inside the sidebar account menu`.
The initial Red run failed at the missing `button[aria-label="Abrir menu da conta"]` assertion because the shell had no sidebar account trigger and still rendered identity plus logout in the header.
The run reported 1 failed routing test and 74 passing tests before implementation.

## Green evidence

The slice moved the shared account trigger into the sidebar footer, added the menu above it, reused `useLogout()`, and removed the former header controls.
The independent verifier confirmed that the committed routing oracle passed as part of the full repository test run at the exact slice commit.

## Gate 2

Independent verifier verdict: PASS.

- `pnpm test`: 33 files and 256 tests passed, including the account-menu routing oracle.
- `pnpm lint`: passed with zero errors.
- `pnpm type-check`: passed with zero errors.
- `pnpm build`: passed, including the production web build of 1,810 modules.
- `pnpm audit --prod`: passed with no known vulnerabilities.
- `git diff --check` and `git show --check b2be701`: passed.

The verifier recorded only existing React Router future-flag notices, which did not affect the verdict.

## Files and commit

Commit `b2be701e07e3caebcd049dff6fb6dae0ac2260b0` is `feat(sales-ops): move account menu to sidebar footer`.

- `apps/web/src/components/ui/dropdown-menu.tsx`
- `apps/web/src/sales-ops/SalesOpsApp.tsx`
- `apps/web/src/sales-ops/__tests__/routing.test.tsx`
- `nexo/plans/20260716-sidebar-account-menu.md`

## Visual verification limitation

The verifier started and stopped a temporary Vite server, but no in-app browser backend was available for live visual inspection.
Rendered-DOM coverage and direct component evidence support the PASS verdict, while pixel-level inspection remains unperformed.
The committed oracle also does not explicitly collapse the sidebar and reopen the account menu, although the same accessible trigger and dropdown structure serve both states.

## Learning

When one trigger serves expanded and collapsed navigation states, keep its semantics shared and add an explicit collapse-and-open oracle to protect layout-specific behavior.
