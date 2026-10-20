---
id: 01-navigation
milestone: v4.8.0
status: todo
depends_on: []
files_modified:
  - apps/web/src/sales-ops/navigation.ts
  - apps/web/src/sales-ops/SalesOpsApp.tsx
  - apps/web/src/sales-ops/leads/LeadSidebarNavigation.tsx
  - apps/web/src/sales-ops/leads/LeadsBoardContainer.tsx
  - apps/web/src/sales-ops/leads/LeadsBoard.tsx
  - apps/web/src/sales-ops/__tests__/leads-stage-navigation.test.tsx
  - apps/web/src/sales-ops/__tests__/leads-routing.test.tsx
acceptance: "The expanded sidebar shows Prospecção with every active stage in server order, and a separate Funil entry. Each stage has a direct URL that opens only its list rows; Funil opens the complete Kanban. No Lista/Quadro/Funil selector appears inside the app content. Existing proposal detail routes, workspace permissions, seller scoping, lead writes, and archived-stage handling remain correct."
oracle: apps/web/src/sales-ops/__tests__/leads-stage-navigation.test.tsx
---

# 01 Navigation and stage lists

## Scope and decisions

- Keep this slice within seven files and approximately 450 changed lines.
- `Prospecção` is an expandable sidebar group in either visible leads workspace.
- `Funil` is a sibling sidebar destination and means the complete Kanban, not the old analytical chart view.
- The active stages are the same `boardStages(stages)` set and ordering used by the board, including active conversion and lost stages.
- Stage links use a stable stage ID in the URL, so renaming or reordering a stage never changes a bookmark.
- The bare legacy `/operacional/leads` and `/meus-dados/leads` URLs redirect to the Funil route.
- Preserve the older analytical funnel calculations and component in code for later product placement; remove its in-content tab from the routed application.
- Keep the full edition's `Propostas` and other navigation entries and all role visibility rules.
- The seller workspace must use the same route behavior and server-enforced scope as the admin workspace.

## Implementation

1. In `navigation.ts`, add a `funil` view and canonical lead routes.
   Keep the single React Router route object and its existing `:saleId?` segment so proposal detail URLs and component lifetime are unchanged.
   Treat the optional segment as a stage ID only for a `leads` view, exposing it as `stageId` on the resolved route, and continue to expose it as `saleId` only for `vendas`.
   Add `buildLeadStagePath(workspace, stageId)` and `buildLeadFunnelPath(workspace)` helpers, encode IDs, and canonicalize unknown extra segments on every other view.
   The `funil` view must be allowed only in workspaces where `leads` is already allowed.
   Keep existing landing behavior for each workspace by making its first leads destination `funil` or redirecting the old `leads` landing route to `funil` consistently.
2. Add `LeadSidebarNavigation.tsx` for the expandable group.
   It reads stages with the existing `useLeadStages()` TanStack query and applies `boardStages()`.
   Reuse the query cache shared with `LeadsBoardContainer`; do not add an API call or local stage model.
   Render loading, empty, error, and loaded states without hiding the rest of the sidebar.
   Give the group button `aria-expanded`, its child links clear accessible names, and a visible current-route indication.
   On a collapsed sidebar, the Prospecção button may expand the rail first; stage links must remain reachable by keyboard once expanded.
   Opening an active stage shows its list; Funil is a separate sibling button.
   Keep the expansion open while a stage is active, including direct navigation and refresh.
3. In `SalesOpsApp.tsx`, render the new group in place of the flat Prospecção item and the separate Funil item beside it.
   Pass the selected stage ID or board mode into `LeadsBoardContainer` from the resolved route.
   Keep the board height behavior only on the Funil page; the stage list can scroll normally.
   Keep the create lead action, seller picker, and dialogs in both routes.
   Do not broaden lead visibility to finder-only roles.
4. In `LeadsBoardContainer.tsx` and `LeadsBoard.tsx`, add controlled routed mode and selected stage props.
   Routed Funil renders the full Kanban and routed stage renders the list filtered to that stage from the shared board query.
   The selected stage is derived from the URL, not a component-state chip.
   A deleted or archived stage URL should show a clear unavailable-stage state or redirect to Funil once stage data loads, rather than silently displaying all leads.
   Hide the in-content Lista/Quadro/Funil segmented selector and list stage chips in routed mode.
   Preserve existing default props only for direct component consumers and existing unit tests; production shell always passes routed mode.
   Do not change the mutation/cache paths, drag/drop behavior, or server seller filtering.

## Red oracle and affected tests

Create `leads-stage-navigation.test.tsx` as the named oracle, using a realistic `MemoryRouter` shell mount, staged query fixtures, and the existing `leads-routing.test.tsx` harness pattern.
Assert direct URL navigation and sidebar clicks for an admin and seller, active stage order, stage rename persistence by ID, stage row filtering, Funil board rendering, absence of the in-content selector, loading/empty/error states, and inaccessible stage URLs.
Cover keyboard operation and `aria-expanded` on the group.
Assert a finder-only user cannot reach either route.
Keep a proposal detail route regression assertion with its `saleId` and a full-edition navigation assertion.
Update `leads-routing.test.tsx` mocks for the new sidebar query and its expected new route behavior.
Run existing lead board/list, lead funnel, route, and role tests as affected suites.

## Run-once verification

```bash
pnpm run build:packages
pnpm --filter @fxl-sales/web test -- src/sales-ops/__tests__/leads-stage-navigation.test.tsx
pnpm --filter @fxl-sales/web test -- src/sales-ops/__tests__/leads-routing.test.tsx src/sales-ops/__tests__/navigation.test.ts src/sales-ops/__tests__/navigation-edition.test.ts src/sales-ops/leads/__tests__/leads-list-view.test.tsx src/sales-ops/leads/__tests__/lead-funnel.test.tsx
pnpm --filter @fxl-sales/web type-check
pnpm --filter @fxl-sales/web lint
```

The feature wave runs the full suite, full lint, security checks, and mutation testing under the Nexo engine.
Save visual captures under the run's project-owned `.nexo/tmp/` location when available; a visual access blocker becomes a Revisão item and does not override green automated gates.
Do not push, deploy, or promote branches.

## Coordination with later slices

Slice 02 may extend `LeadsBoard.tsx` and `LeadsBoardContainer.tsx` for search and move controls after this slice is integrated.
Slice 04 may extend the same files for undo.
Keep these slices sequential at that seam.
