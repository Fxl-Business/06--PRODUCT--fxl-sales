# Verify 07-admin-gate-and-brl (attempt a1)

Verdict: FAIL.
Branch `feat/20260925-07-admin-gate-and-brl`, head `d30cc86`, base master `2f1f406`.
Worktree left clean (`git status --short` empty after every probe).

## Commands

| Command | Exit |
| --- | --- |
| `pnpm --filter @fxl-sales/api exec vitest run financial-admin-gate.test.ts transition-routes.test.ts routes.test.ts` | 0 (87/87) |
| `pnpm --filter @fxl-sales/web exec vitest run mutation-error-banner settings-currency-brl financial-mutation-forbidden entitlement-dead-end sales-transition-actions sale-save-error` | 0 (28/28) |
| `pnpm --filter @fxl-sales/web exec vitest run src/sales-ops` (used for probes W4/W5) | 0 (671/671) |
| `pnpm run lint` | 0 |
| `pnpm run type-check` | 0 |

Diff scope: 18 files, no `nexo/runs` or `nexo/plans` files, no em dash in added text.

## Acceptance criteria

1. Four routes answer 403 `{error:'forbidden',reason:'admin_role_required'}` for seller, finder, undefined and never call the service: PASS.
   `requireAdmin` is the second argument of all four routes; 12 table rows in `financial-admin-gate.test.ts`; probe M1 turns 3 rows red.
2. Same four routes answer 2xx for admin with the verified org: PASS.
   `lets an admin through %s` asserts `[mockedDb, 'verified-org']`; probe M2 (`hasAdminRole` returns false) turns 37 tests red.
3. `POST /sales` with `won` from a non-admin is 403 before validation, createSale never called, even for an invalid body: PASS.
   Check runs on the raw body before `CreateSaleSchema.safeParse`; probe M3 turns 4 tests red.
4. `POST /sales` `draft`/`open` from a seller is 201: PASS (probe M5, `requireAdmin` on `POST /sales`, turns 5 red).
5. `POST /sales` `won` from an admin is 201: PASS (asserted).
6. `PUT /settings` `USD` is 400 validation_error with no upsert; omitted currency persisted as BRL: PASS.
   `z.literal('BRL').default('BRL')`; probe M4 (`z.string()`) turns the USD test red.
7. Configurações renders no picker, no USD/Dólar, `Real (BRL)` read-only, always submits BRL over a legacy USD row: PASS.
   Probe W2 (echo `settings?.currency`) turns `saves BRL even when the stored currency is a legacy USD` red.
   The read-only box reuses `formSelectClass`'s `h-11`, `rounded-[10px]` and `#dcdce2` border, so it lines up with the input beside it.
8. A 403 on saving settings AND on transition or cancel-contract keeps the screen, renders the pt-BR alert, never ForbiddenPanel: FAIL (half asserted).
   Settings: implemented and asserted; probe W1 (drop `reportMutation` from `saveSettings.mutate`) turns the shell test red.
   Transition and cancel-contract: implemented (`reportMutation` passed to both `mutate` calls in `SalesOpsApp.tsx`) but NOT asserted.
   Probe W4 removed `reportMutation` from both `cancelContract.mutate(sale.id, reportMutation)` and `transitionSale.mutate({ saleId: sale.id, status }, reportMutation)`: the six named web oracles stayed 28/28 green and the whole `src/sales-ops` web suite stayed 671/671 green.
   A regression that silently swallows a 403 on transition or cancel-contract (the exact pre-slice behaviour) would ship unnoticed.
9. `SalesView` gets `canManage` only for operacional AND admin: PASS with note.
   Implemented; probe W5 (drop the `profile.roles.includes('admin')` term) stays green, but that is an equivalent mutation: `resolveSalesOpsRoute` never resolves `operacional` without `admin` (`getVisibleWorkspaces`), so the term is defence in depth with no observable difference. Not counted against the slice.
10. CLAUDE.md, propostas.md, auth-model.md carry the PC23 gate and BRL lock: PASS.
    CLAUDE.md gains the Access gate bullet and the `Financial role gate (PC23):` block; propostas.md gains the PC23 section (correctly updated for the `won` edit path now going through admin-only `PUT /sales/:id`); auth-model.md gains the mutation-403 bullet.
    Nit: the last CLAUDE.md bullet holds two sentences on one line, as the plan's own text did and as the surrounding bullets do.

## Mutation probes (all restored with `git checkout --`, tree clean after each)

| Id | Mutation | Result |
| --- | --- | --- |
| M1 | drop `requireAdmin` from `PUT /settings` | 3 failed (killed) |
| M2 | `hasAdminRole` returns `false` | 37 failed (killed) |
| M3 | delete the `isWonRequest && !hasAdminRole` branch | 4 failed (killed) |
| M4 | `currency: z.string().default('BRL')` | 1 failed (killed) |
| M5 | `requireAdmin` on `POST /sales` | 5 failed (killed) |
| W1 | `saveSettings.mutate(payload)` without `reportMutation` | 1 failed (killed) |
| W2 | `activeSettings` echoes the stored currency | 1 failed (killed) |
| W3 | 403 keyed on body `error === 'forbidden'` | 1 failed (killed) |
| W4 | transition and cancel-contract `mutate` without `reportMutation` | 0 failed of 671 (SURVIVED) |
| W5 | `canManage` without the admin term | 0 failed (equivalent mutation) |

## Security

- Fails closed: role `undefined` gets 403 on all four routes and on `POST /sales` `won` (asserted).
- `requireAdmin` runs before the `:id` uuid check, so a non-admin cannot probe ids through 404 versus 409.
- Org scoping unchanged; the admin rows assert the service receives `'verified-org'` from context.
- The only `admin_role_required` literal in `apps/api/src` production code is `require-admin.ts` (the `lead-routes.ts` hit is a comment).
- The banner copy names no role id or raw id; 403 is keyed on status via `isForbiddenFailure`.

## Defects to fix

1. Add a shell oracle (in `financial-mutation-forbidden.test.tsx` or beside it) that renders `/operacional/vendas` with one sale in the bootstrap, stubs `POST .../sales/:id/transition` (and separately `POST .../sales/:id/cancel-contract`) to answer 403 `{error:'forbidden',reason:'admin_role_required'}`, triggers the action through the real `SalesView` button, and asserts `MUTATION_ERROR_COPY.adminRequired` is rendered, the vendas table is still mounted, and `[data-forbidden]` is null.
   It must go red under probe W4 for each of the two calls independently.
