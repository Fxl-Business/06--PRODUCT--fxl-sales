# 05 - shell Organization switcher - execute

Branch: `feat/05-shell-organization-switcher`, cut from `master`.

## RED first - confirmed

`shell-organization-switcher.test.tsx` was written before any change to `SalesOpsApp.tsx` and ran:

```
Tests  9 failed | 3 passed (12)
```

The decisive test, `lists the account other Organizations beside Sair`, was among the failures.
The 3 that passed before the change were the two "renders no Organization section" cases and `still logs out from the same dropdown`, which is exactly right: those are the must-not-break cases and they describe today's dropdown.

## What changed

### `apps/web/src/sales-ops/SalesOpsApp.tsx`

- Imports: `Building2` added to the `lucide-react` import; `@/auth/react` extended to `{ useAuthProfile, useLogout, useOrganizations }`; new `import { isOrgLabelFallback, orgLabel } from '@/lib/displayNames';`.
- New local, non-exported `AccountOrganizationSection({ onSwitched })` defined directly above `SalesOpsApp`, carrying the plan's verbatim doc comment and the verbatim render-guard comment.
  It calls `useOrganizations()` INSIDE itself, never at the shell top level, so Radix mounts it only while the account menu is open and the four untouched closed-factory auth mocks never see the hook.
  It returns `null` when `others.length === 0`.
  It owns no switching logic: `setActive(organization.id)` is the only call, there is no `client.setActive`, no query-cache flush and no page reload anywhere in the diff.
  In-flight state is `switchingTo` / `switchFailed` / `latestSwitch` exactly as planned; every row is disabled while a switch is in flight, the in-flight row swaps `Building2` for a spinning `Loader2` and carries `aria-busy="true"`, and a stale rejection is discarded by the `latestSwitch` ref.
  A `data-testid="account-organization-section"` sits on the section wrapper so the in-flight oracle can scope "every row in the section".
- Wired into `DropdownMenuContent` between the existing separator and the `Sair` group; the trailing separator lives inside the section, so the closed case is byte-equivalent to today's menu.
- Part B display strings only.

### `apps/web/src/sales-ops/__tests__/routing.test.tsx`

- `workspaceButton()` selector `button[title="Trocar workspace"]` becomes `button[title="Trocar painel"]`.
- The `@/auth/react` factory gains `useOrganizations`, backed by a module-scope `hubClient` and `primaryOrganization` allocated ONCE (a fresh literal per render is the slice 04 infinite-effect trap). Single Organization, so this file keeps asserting the unchanged dropdown and becomes a free pin on the empty case.

### `apps/web/src/sales-ops/__tests__/shell-organization-switcher.test.tsx` (new)

The 12 locked tests from the plan, in the plan's order and with the plan's names.

## Exact PT-BR copy shipped (verbatim)

| Element | String |
|---|---|
| Section heading | `Organização` |
| Active row accessible name | `Organização atual: <nome da Organização>` |
| Switch row accessible name | `Trocar para <nome da Organização>` |
| Switch failure line | `Não foi possível trocar de organização. Tente novamente.` |

`Sair` is unchanged, reads exactly `Sair`, and is still the only destructive item and still last.

`Trocar para ${orgLabel(organization)}` is spelled identically to `MissingEntitlementPanel.tsx:287`, which is the cross-slice agreement.

## Part B - the term chosen

`Painel` (singular, the sidebar group eyebrow) and `Painéis` (plural, the menu heading).

The five display strings changed, all in `SalesOpsApp.tsx`:

| Today | After |
|---|---|
| `title="Trocar workspace"` | `title="Trocar painel"` |
| eyebrow `Workspace` | `Painel` |
| `` aria-label={`Workspace: ...`} `` | `` aria-label={`Painel: ...`} `` |
| `aria-label="Fechar workspaces"` | `aria-label="Fechar painéis"` |
| menu heading `Workspaces` | `Painéis` |

Plus the plan's verbatim comment above the eyebrow span.
No code identifier, no type, no route path and no `navigation.ts` export was renamed; `navigation.test.ts` is untouched and green.

## Test results

| Command | Result |
|---|---|
| `vitest run shell-organization-switcher.test.tsx routing.test.tsx` | 2 files, 28 passed |
| `vitest run` (whole web suite) | 55 files, 770 passed |
| `pnpm --filter @fxl-sales/web lint` | clean |
| `pnpm --filter @fxl-sales/web type-check` | clean |
| `vitest run sale-wizard-ui-contract.test.tsx` | 9 passed (the source-text guard, re-run after part A) |

## Non-vacuity check run here

Deleting the `<AccountOrganizationSection ... />` line from `DropdownMenuContent` and re-running the new file gives `8 failed | 4 passed`: tests 1, 2, 3, 6, 8, 9, 10 and 12 go red, and the three no-section / logout tests plus the part B test stay green.
That matches the plan's expectation exactly, including test 1.
The file was restored from a backup afterwards and the oracle re-run green.

The plan's non-vacuity check 3 (`others.length > 0` becoming `organizations.length > 1`) is structurally unwritable in the shipped component: it never destructures `organizations` at all.

## Dashes

`git diff | grep -P '[\x{2014}\x{2013}]'` over added lines: no match.
