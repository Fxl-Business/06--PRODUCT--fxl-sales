# Verify 09-sale-deep-link (attempt 1)

Verdict: PASS.
Branch `feat/20260925-09-sale-deep-link`, head `d1f3443`, base `80d425c`.
Verifier did not write the code, read no exec notes, modified no tracked file; tree clean at the end.

## Gates (run-once, in the worktree)

- Named oracles (10 files): 151 tests passed; every new file reported by name (`sale-deep-link.test.tsx` 8, `sale-deep-link-route.test.ts` 3, `session-journey.test.tsx` 8, `navigation.test.ts` 17, `session-recovery.test.ts` 71, `board-write-surface.test.ts` 10).
- ESLint on changed files: 0.
- `pnpm run lint`: 0.
- `pnpm run type-check`: 0.
- `CI=true pnpm test`: 0 (api 680, web 1069, shared-utils 155, auth-fake 35, node guard suites green).
- `pnpm run build`: 0.
- `node scripts/assert-web-bundle-clean.mjs`: clean.

## Acceptance

- `buildSalesOpsPath` with `saleId` and `buildSaleDetailPath` produce `/operacional/vendas/<encoded id>`: implemented, asserted.
- `resolveSalesOpsRoute` keeps `saleId` only on `vendas` of a visible workspace, drops it elsewhere with redirect, drops it on role default fallback: implemented, asserted.
- `router.tsx` serves `SALES_OPS_ROUTE_PATTERN` inside `Protected`, one route object, `*` still catches 4+ segments: asserted by `sale-deep-link-route.test.ts`.
- Detail opens from URL with no click; push on row click, pop on close, replace after cold entry; Back never reopens: asserted and seen in the browser.
- Unknown and other-org id: `Proposta não encontrada`, `Voltar para a lista`, id never rendered: asserted and seen in the browser.
- Detail or not-found renders over the filtered-empty and org-empty branches: asserted.
- Cold entry with no session: login once, returnTo `/operacional/vendas/<id>`, lands there with the detail open: asserted in `session-journey.test.tsx`.
- Stale returnTo cannot hijack: `is not hijacked by a stale returnTo left by an abandoned login` plus `overwrites a stale slot when a proposta deep link is captured`.
- Converted lead card link opens the proposta detail and closing returns to the board: asserted.
- CLAUDE.md Sales Ops Routing and `nexo/knowledge/reference/sales-ops-routing.md` updated in the same commit; no em dash.
- BOARD-WRITE-FENCE sentinels intact; `openSaleFromBoard` stays inside the fence and calls no transition; `board-write-surface.test.ts` green.
- Auth code (`react.tsx`, `session-recovery.ts`) unchanged; legacy trees and `/no-role` guard untouched.

## Mutation probes (each restored with `git checkout -- <file>`)

| Probe | Result |
| --- | --- |
| `SALES_OPS_ROUTE_PATTERN` drops `:saleId?` | RED: both cold-entry journey tests, route tests, 8 deep-link tests |
| `router.tsx` path back to `/:workspace/:view` | RED: both route tests |
| `sanitizeReturnTo` keeps only two path segments (returnTo loses the id) | RED: 3 session-recovery tests + both cold-entry journey tests |
| `captureReturnTo` keeps an existing (stale) slot | RED: stale-slot unit test + `is not hijacked by a stale returnTo...` |
| Raw id rendered beside not-found | RED: not-found deep-link test + org-empty not-found test |
| Id interpolated into the not-found title (via `useParams`) | RED: not-found deep-link test |
| `closeSaleDetail` does nothing (URL not updated) | RED: 4 deep-link tests |
| Close always pushes the list | RED: push/pop, cold-entry replace, board return |
| Close always `navigate(-1)` | RED: cold-entry replace, not-found |
| `{detailLayer}` dropped from filtered-empty branch | RED |
| `{detailLayer}` dropped from org-empty branch | RED |
| Not-found renders `null` | RED |
| Detail id not taken from URL (local-state equivalent) | RED: 6 deep-link tests |
| Id kept on `comissoes` | RED |
| `encodeURIComponent` removed | RED |
| Fallback carries the id | RED (`drops a proposta id for an operator who cannot see the workspace`) |
| Board link back to bare list | RED |

## Security

- Probe of `sanitizeReturnTo` (temporary untracked test, deleted): `/auth/callback`, `/AUTH`, `/no-role`, `/No-Role/`, `/`, `//evil.com`, `/\evil.com`, newline, `../../auth/login`, `%2e%2e/%2e%2e/auth`, absolute foreign URL are all `null`.
- Encoded ids such as `%2F%2Fevil.com` stay inside one path segment under `/operacional/vendas/`, same-origin, so no open redirect; `buildSaleDetailPath('//evil.com')` encodes to `/operacional/vendas/%2F%2Fevil.com`.
- Lookup is `===` against the org-scoped bootstrap; no API call carries the id; other-org id (browser: a seeded `org_fake_sul` proposta while in Norte) shows the identical not-found, no existence leak; id never in `innerText`.
- `location.state` read only as a boolean marker; it never selects a destination.

## Browser E2E (make dev-fake, local DB `localhost:5006`, no migrate)

- Fresh tab straight to `/operacional/vendas/<seeded Norte won proposta>`: detail `Proposta 0001-1` opened with no click. Close with X: URL replaced by `/operacional/vendas`, `history.length` unchanged.
- From `/operacional/comissoes`, nav to Propostas, row click pushes `/operacional/vendas/<id>`, X pops to `/operacional/vendas`, browser Back lands on `/operacional/comissoes` with no dialog.
- Other-org id: loading panel first, then `Proposta não encontrada`, no id on screen; Escape returns to the list.
- Unknown uuid: not-found, `Voltar para a lista` goes to `/operacional/vendas`.
- `/operacional/comissoes/<id>` rewritten to `/operacional/comissoes`.
- `/meus-dados/vendas/<id>` opens the read-only detail (no settlement buttons).
- Pixel: not-found dialog centred (467/467 px margins at 1374, 32/32 at 375 in an iframe), no horizontal scroll at 375, X clear of the title text, button right padding matches header left padding (24px).
- No-session Hub round trip is impossible in dev-fake (stand-in always mints a token); covered by the journey oracle and its mutations, as the plan states.
- Process groups 53213, 54859, 54862 (the ones started) were killed; ports 3006 and 8006 free afterwards.

## Notes (non-blocking)

- A cold entry to plain `/` still leaves any stale returnTo in the slot (pre-existing behaviour of `captureReturnTo`); it does not affect this deep link, which always captures and overwrites.
- The browser window could not be resized to 375px (maximized window); the narrow check ran in a same-origin 375px iframe.
