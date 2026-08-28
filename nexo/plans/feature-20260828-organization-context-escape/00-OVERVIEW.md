---
feature: feature-20260828-organization-context-escape
milestone: v2.8.0
---

# Organization-context dead end - the escape route

## Frame

### What

An operator whose ACTIVE Hub Organization does not carry FXL Sales lands in a dead end.
Every API call returns `402 {error: 'payment_required', code: 'missing_entitlement'}`, the sales-ops shell renders that as "A API de vendas não respondeu corretamente. Verifique o servidor local e tente novamente.", and the shell's account dropdown offers exactly one item, `Sair`.
There is no way, from inside the app, to reach an Organization that does have Sales.

### Why

The Hub deliberately gives each Application its OWN Organization context.
Switching Organization in the Hub web does not move Sales' session, and Sales anchors on the account's PRIMARY Organization at session mint.
The `402` is CORRECT; its PRESENTATION and the ABSENCE of an escape route are the defect.

### Verified facts (all re-confirmed against this tree before planning)

1. `apps/api/src/middleware/app-auth.ts:171-172` returns `{ error: 'payment_required', code: 'missing_entitlement' }` at status `402`. CONFIRMED.
2. `apps/web/src/sales-ops/SalesOpsApp.tsx:1679` renders that as the "verifique o servidor local" panel. CONFIRMED.
3. The Organization switcher lives in `HubUserControls` (`apps/web/src/auth/react.tsx:875`, exported as `UserControls`) and is rendered ONLY by `apps/web/src/components/layout/TopBar.tsx`. The sales-ops shell draws its own chrome; its account dropdown (`SalesOpsApp.tsx:1517-1557`) holds exactly one item, `Sair`. CONFIRMED.
4. The auth context already exposes `setActive(workspaceId)` and `workspaces: HubWorkspacePreview[]` (`apps/web/src/auth/react.tsx:105-106`); the installed `@fxl-business/hub-sdk` (1.3.1 in this tree, byte-identical client to 1.3.0) exposes `setActive`, `checkoutUrl(sku?)` and `manageUrl()`. CONFIRMED.
5. The sidebar "WORKSPACE / Tático" chrome (`SalesOpsApp.tsx:1353`) is a SALES-INTERNAL view group (`navigation.ts:16`), not a Hub Organization. Two concepts share the word. CONFIRMED.

Two further facts established during Frame, load-bearing for the design:

6. `ApiError` (`apps/web/src/lib/api-client.ts`) drops the response body's `code` entirely - it keeps only `error`, `message`, `status`. So today nothing downstream of `apiFetch` can even see `missing_entitlement`.
7. The web's `profileFromToken` (`apps/web/src/auth/react.tsx`) reads `claims.workspaceName` but NOT the active workspace id, even though the access token carries `workspaceId` at the top level (`apps/api/src/middleware/app-auth.ts:19` reads exactly that claim as `orgId`). `HubUserControls` therefore matches the active entry by NAME, which cannot disambiguate two Organizations with the same name and yields `''` whenever the name claim is absent.

### Acceptance criteria (feature level)

- A `402 missing_entitlement` is classified DISTINCTLY from a transport or server failure, and the "verifique o servidor" copy is unreachable for it.
- The 402 renders an honest PT-BR state that names the CURRENTLY ACTIVE Organization, offers (a) switching to another of the account's Organizations and (b) a Hub checkout link for the active one, in that order.
- Switching calls `setActive` and refetches. No `window.location.reload`, no full page reload.
- The sales-ops account dropdown itself carries the Organization switcher, beside `Sair`, driven by the SAME `setActive` + `workspaces` seam from the auth context (no duplicated switching logic).
- `workspaces` is a capped, display-only preview: empty or single-entry cases render honestly and never show an empty picker.
- `isLoading` renders a skeleton, never an empty state.
- No em dash or en dash on any added line.
- Every existing test and guard stays green; no `--no-verify`.

### Scope limits (YAGNI)

- NO `?organization=` deep link. SDK 1.3.x drops the parameter; it belongs to the parked SDK 2.1.0 migration run.
- NO change to the entitlement gate itself. The `402` stays exactly as it is - status, body, and placement.
- NO API change at all. The web already holds everything it needs: the active Organization is in the token (`workspaceId`, `workspaceName`) and the account's Organizations are in the token's `workspaces` claim. Adding fields to the 402 body would be changing the gate's response, which is explicitly out of scope, and would buy nothing.
- NO `@fxl-business/hub-sdk` upgrade, and no change under the `fxl-hub` repository.

## Slice table

| Slice | Wave | Goal |
|---|---|---|
| `01-entitlement-classifier` | 1 | `apiFetch` preserves the body `code`; `isEntitlementFailure` classifies `402 missing_entitlement` and `isAuthFailure` stays false for it |
| `02-organization-seam` | 1 | The auth context exposes the active Organization id and one exported `useOrganizations()` seam; `HubUserControls` is refactored onto it |
| `03-missing-entitlement-panel` | 2 | A new `MissingEntitlementPanel` renders the honest PT-BR state: names the active Organization, offers switch then Hub checkout, handles empty and single-entry `workspaces` |
| `04-shell-entitlement-branch` | 3 | `SalesOpsApp` routes a 402 to that panel; the "verifique o servidor" copy is unreachable for it |
| `05-shell-organization-switcher` | 4 | The sales-ops account dropdown gains the Organization section beside `Sair` on the same seam, and the sidebar's "Workspace" chrome is renamed so it stops reading as an Organization picker |
