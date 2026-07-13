---
id: 20260713-canonical-sales-ops-routing
milestone: null
status: complete
mode: autopilot
---

# Canonical Sales Ops routing

## Frame

The Sales Ops shell currently stores workspace and page selection only in React state while the browser remains at `/`.
Every workspace page must have a canonical URL composed from its workspace and page, such as `/operacional/vendas`.

The three canonical workspaces are `tatico`, `operacional`, and `cadastros`.
Their canonical pages are:

- `tatico`: `dashboard`, `vendedores`, and `finders`.
- `operacional`: `vendas` and `comissoes`.
- `cadastros`: `produtos`, `clientes`, and `geral`.

## Why

Canonical URLs make page refresh, direct links, browser Back and Forward, bookmarks, and support references behave correctly.
The current local-state navigation cannot provide those browser guarantees.

## Acceptance criteria

1. Given an authorized user opens `/operacional/vendas`, when the Sales Ops shell renders, then the Operacional workspace and Vendas page are selected from the URL.
2. Given a user clicks a workspace or page inside the Sales Ops shell, when navigation completes, then the browser URL changes to that canonical workspace and page without a full reload.
3. Given a user navigates between Sales Ops pages, when browser Back or Forward is used, then the visible workspace and page follow the history entry.
4. Given `/` or an invalid Sales Ops workspace-page combination is opened, when the user's available role view is known, then the app replaces it with the first valid canonical route for that role.
5. Given a non-admin role attempts to open `/cadastros/*`, when authorization is resolved, then the app redirects to that role's first valid tactical route.
6. Given the existing `/admin/*`, `/finder/*`, `/seller/*`, and `/no-role` routes are opened, when routing resolves, then those legacy application areas remain unchanged.

## Design

The URL is the single source of truth for workspace and page selection.
Pure navigation helpers own workspace slugs, page membership, canonical path generation, and role-aware route resolution.
The router mounts the shared Sales Ops shell at the root and explicit canonical workspace paths.
The shell derives its active state from route parameters and uses React Router navigation for every workspace, page, dashboard, and role transition.

Invalid combinations are replaced with a role-valid canonical path.
The internal `config` workspace name is replaced with `cadastros` so the domain model, visible workspace, and URL use one vocabulary.
Local UI state remains only for menus, filters, dialogs, and other non-route concerns.

## Rejected approaches

Mirroring local workspace and page state into the URL with effects was rejected because it creates two sources of truth and can cause stale history or synchronization loops.
Creating a separate page route component for every Sales Ops view was rejected because all views share one shell and the current view renderer, so it would duplicate authorization and bootstrap logic.

## Scope limits

This feature changes only client-side Sales Ops routing and its tests.
It does not redesign the UI, change API endpoints, alter authentication roles, modify database schemas, rename the existing separate admin/finder/seller route trees, or promote a release.

## Slice index

| Slice | Intent | Dependency |
| --- | --- | --- |
| `01-canonical-workspace-routes` | Make canonical Sales Ops URLs the source of truth for deep links, navigation, redirects, and history. | None |

## Gate 1

Skipped by the user's explicit Autopilot instruction on 2026-07-13.
