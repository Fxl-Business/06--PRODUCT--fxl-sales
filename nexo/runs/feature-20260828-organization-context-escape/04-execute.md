# 04 - Route the shell's 402 to the entitlement panel (execute)

Branch: `feat/04-shell-entitlement-branch`, cut from `master`.
Method: red first, then green. No refactor beyond the plan.

## What changed

Exactly two files, both owned by this slice.

### `apps/web/src/sales-ops/SalesOpsApp.tsx`

1. Widened the existing import: `import { isAuthFailure, isEntitlementFailure } from '@/lib/require-token';`
2. Added `import { MissingEntitlementPanel } from './MissingEntitlementPanel';` in the local-module group, between `CadastroHistoryPanel` and `ProfessionalSplitPanel`. No reorder needed.
3. Turned the `bootstrapQuery.isError` block into a three-way chain with the entitlement test FIRST, carrying the plan's verbatim "why" comment plus the paragraph explaining why no `onRetry` is passed.

`<MissingEntitlementPanel />` is rendered with NO props. `setActive` already runs `queryClient.clear()`, which destroys the query, so the mounted observer re-subscribes at `status: 'pending'` and `LoadingPanel` takes over on its own. A `refetch()` would leave `status: 'error'` and keep the panel on screen naming the OLD Organization.

Untouched, as required: the `{bootstrapQuery.isLoading ? <LoadingPanel /> : null}` line above it, the `Sessão expirada` and `Não foi possível carregar` copy to the character, and the `{!bootstrapQuery.isLoading && !bootstrapQuery.isError ? (` success gate below it. No sidebar chrome, no account dropdown, no Organization switcher (that is slice 05). No `window.location.reload` anywhere.

### `apps/web/src/sales-ops/__tests__/entitlement-dead-end.test.tsx` (new)

Shaped on `blank-bearer-token.test.tsx`: real `SalesOpsApp` in a real `QueryClientProvider` and `MemoryRouter`, `retry: false` on queries and mutations, stubbed global `fetch`, and `../api` / `@/lib/api-client` / `../hooks` deliberately NOT mocked, so the 402 travels the real `apiFetch` error path.

Four cases, all passing:

1. `renders the entitlement panel for a 402 missing_entitlement` - asserts `[data-missing-entitlement]` is present AND `MISSING_ENTITLEMENT_COPY.title` is in the text (imported from `missing-entitlement-copy.ts`, so a copy edit moves the assertion with it), then `not.toContain('Verifique o servidor local')` and `not.toContain('Sessão expirada')`.
2. `still renders the generic API fault for a 500` - asserts the generic copy IS there and the panel marker is absent.
3. `still renders Sessão expirada for a 401` - asserts the session copy, the absence of the generic copy, and the absence of the panel marker.
4. `renders the skeleton and no error panel while the bootstrap is loading` - a fetch that never settles; asserts `Carregando dados comerciais` and the absence of all three error markers.

I did NOT need to edit any of the five existing files that mock `@/auth/react` with a closed factory. None of them was touched.

#### One trap found beyond the briefed one

The briefed trap was real and handled: the factory needs `useOrganizations` with `client.checkoutUrl`, since the panel calls it from a mount effect.

A second one showed up on the first green run and cost the case a 5-second timeout rather than an assertion failure. Returning a fresh object literal from `useOrganizations: () => ({ ..., client: { checkoutUrl } })` allocates a NEW `client` on every render, and the panel's checkout effect has `client` in its dependency array, so the effect re-ran forever and the render never settled. The real `useHubOrganizations` returns a stable client. The stub now allocates the seam object, the organizations array and the client ONCE at module scope, and the hook just hands the same reference back. The reason is written into the test file as a comment so the next author does not re-introduce it.

## Test results (all RUN-ONCE, no watchers)

Red, before the implementation (the arm absent):

```
Tests  1 failed | 3 passed (4)
x renders the entitlement panel for a 402 missing_entitlement -> expected null not to be null
```

That is the non-vacuity evidence the plan asks for: with the entitlement arm removed, case 1 fails on the panel marker, and the `not.toContain('Verifique o servidor local')` line below it would fail on the same run, because the shell rendered the generic API-fault panel instead. Cases 2, 3 and 4 were already green BEFORE the implementation landed, which is what proves the must-not-break arms are not being propped up by the change.

Green, after:

| command | result |
| --- | --- |
| `pnpm --filter @fxl-sales/web exec vitest run src/sales-ops/__tests__/entitlement-dead-end.test.tsx` | 4 passed (4) |
| `pnpm --filter @fxl-sales/web exec vitest run` | 54 files, 758 passed (758), 0 failed |
| `pnpm --filter @fxl-sales/web lint` | clean, no output |
| `pnpm --filter @fxl-sales/web type-check` | clean, no output |

The full web suite was 754 before this slice and is 758 now, i.e. the four new cases and nothing regressed.

## Confirmation that the 401 and 500 branches are still reached by their own cases

Yes, and by their own dedicated cases rather than by inference.

- 401: case 3 drives a real `{ok:false, status:401}` response through `apiFetch`, and the document contains `Sessão expirada` while `[data-missing-entitlement]` is null. The new FIRST branch does not swallow it, because `isEntitlementFailure` keys on `status === 402` alone.
- 500: case 2 drives a real `{ok:false, status:500}` response, and the document contains `Verifique o servidor local` while the panel marker is null.
- The pre-existing `blank-bearer-token.test.tsx` case `renders a session-expired panel, not the generic API fault` (the unavailable-token half of `isAuthFailure`) still passes untouched, as does the rest of the suite.

`bootstrapQuery.isLoading` still renders `LoadingPanel` and never an empty state or an error panel; case 4 is the oracle for that.

## Verbatim diff hygiene

`git diff` grepped for U+2014 and U+2013 on added lines: none.

## ROADMAP line for the orchestrator to file (I did NOT edit ROADMAP.md)

```
- chore: `apps/web/src/sales-ops/CadastroHistoryPanel.tsx` still classifies only `isAuthFailure` vs generic, so a `402 missing_entitlement` there would read as "não foi possível carregar o histórico". Unreachable today - the section renders only inside the bootstrap's success branch, and a 402 fails the bootstrap first - so `feature-20260828-organization-context-escape` slice 04 deliberately left it alone. Close it if that panel ever gains a route that does not sit behind a successful bootstrap.
```

## Status

PASS.
