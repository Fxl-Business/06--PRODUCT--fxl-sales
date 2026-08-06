# exec-04 - History and restore in Configurações

Slice: `04-history-and-restore-in-configuracoes`
Branch: `feat/04-history-panel`
Scope: `apps/web/**` only. Nothing under `apps/api/**` and nothing in `CLAUDE.md` was touched.

## What shipped

| File | Change |
| --- | --- |
| `apps/web/src/sales-ops/cadastro-history.ts` | NEW. The whole decision surface as pure functions: `CADASTRO_HISTORY_LIMIT`, `CADASTRO_HISTORY_ACTIONS`, `normalizeHistoryEntityKind`, `normalizeHistoryVerb`, `normalizeCadastroHistory`, `formatLedgerTimestampBr`, `restoreStateFor`, `resolveHistoryRow`. No React, no import of `SalesOpsApp.tsx`. |
| `apps/web/src/sales-ops/CadastroHistoryPanel.tsx` | NEW. `CadastroHistoryPanel` (pure, prop-driven) plus `CadastroHistorySection` (query + slice 03's mutation + the `AlertDialog` confirm). |
| `apps/web/src/lib/query-keys.ts` | `salesOps.cadastroHistory(limit)` = `['sales-ops', 'cadastro-history', limit]`. |
| `apps/web/src/sales-ops/api.ts` | `SALES_OPS_HISTORY_PATH` and `salesOpsApi.cadastroHistory(limit, actions, token)`. One addition, no mutation surface. |
| `apps/web/src/sales-ops/hooks.ts` | `useCadastroHistory()`. One read hook; `select` is the hoisted `normalizeCadastroHistory`. |
| `apps/web/src/sales-ops/SalesOpsApp.tsx` | One import plus the `view === 'geral'` wrapper. `SettingsView`'s props and `key` are unchanged. |
| `apps/web/src/sales-ops/__tests__/cadastro-history.test.tsx` | NEW oracle, 16 tests. |

## Bound to the SHIPPED slice-02 contract, not the plan's guess

Read `apps/api/src/domains/audit/history-service.ts` and `apps/api/src/domains/sales-ops/routes.ts` before writing a line. Confirmed against the code:

- Route is `GET /history` on `salesOpsRouter` behind `requireAdmin`, org-scoped by `c.get('orgId')`. Web path constant is `/api/v1/sales-ops/history`.
- Envelope is `{ entries, nextCursor }`, `entries` ordered `audit_log.id DESC`, `nextCursor` a decimal string or `null` (the endpoint fetches `limit + 1`, so it is exact). The panel does not re-sort and reads `hasMore` from `nextCursor !== null`, never from `entries.length`.
- Entry carries flat `actorUserId` + `actorDisplayName` (nullable) and `entityLabel` - no `actor` object, no `email`.
- `action` is accepted as a comma-separated set of 1..10 values (`HISTORY_MAX_ACTIONS = 10`), so the mandatory `action=cadastro.archived,cadastro.restored` filter is sent on every request.

## Law compliance

- **No raw id as a primary label.** Three mutually exclusive actor branches: `Sistema` badge for `actorUserId === 'system'`; `userLabel({id, name})` when a name exists (the id is not rendered at all); otherwise the pt-BR primary label `Autor não identificado` with the account id BENEATH it as `font-mono text-xs text-muted-foreground`. Pinned in both directions by oracle test 2, which asserts the muted element's class list AND that the primary label does not carry `font-mono`.
- **Restore is not an undo.** Card subtitle and confirm body both say restoring appends a new event and does not erase the archive. The confirm body string is asserted by the write test (`restaurar não apaga o evento anterior`).
- **Restore only where it can succeed.** `restoreStateFor` requires, in order: an archive verb, a recognized kind, a non-optimistic id, a live row (else `missing`), a non-system função (else `none`), and a currently-archived entity. An already-restored entity prints the muted words `Já restaurado` - no disabled button.
- **Cadastro lifecycle rows only.** The `action` filter is sent on the request, so `commission.created` and friends never reach the card.
- **pt-BR wire literals matched exactly.** `cadastro.archived` / `cadastro.restored` and `produto|pessoa|funcao|area`, with `product`, `products`, `sales_ops_products`, `cliente`, `área`, `produto.archived` and `cadastro.archive` all pinned as unrecognized.
- **One restore implementation.** `useSetSalesOpsCadastroStatus` from slice 03 is reused verbatim; this slice adds no mutation hook and no second writer. The oracle asserts the payload with `toEqual` on the whole object, so a smuggled `name` key would fail.
- **No banned control.** The panel has no picker at all, so no `<select>` / `<option>` / `<datalist>`, and it is not inside a `DialogContent`, so `useInlineLayer` does not apply. `apiFetch` gets `await requireToken(getToken)`; no `?? ''`.

## Red -> Green

The oracle was written first and failed to even collect, for the right reason - the module under test did not exist:

```
Error: Failed to resolve import "../cadastro-history" from "src/sales-ops/__tests__/cadastro-history.test.tsx".
 Test Files  1 failed (1)
      Tests  no tests
```

After the implementation:

```
 ✓ src/sales-ops/__tests__/cadastro-history.test.tsx (16 tests) 55ms
 Test Files  1 passed (1)
      Tests  16 passed (16)
```

## Verify - all three green

```
$ pnpm --filter @fxl-sales/web test
 Test Files  48 passed (48)
      Tests  575 passed (575)
   Duration  4.77s

$ pnpm --filter @fxl-sales/web lint
> @fxl-sales/web@1.0.0 lint
> eslint src/
(no output, exit 0)

$ pnpm run type-check
packages/shared-types type-check: Done
packages/shared-utils type-check: Done
apps/api type-check: Done
apps/web type-check: Done
```

One type-check failure was hit and fixed on the way: the `vi.spyOn(queryClient, 'invalidateQueries')` handle needed `MockInstance<QueryClient['invalidateQueries']>` rather than the bare `ReturnType<typeof vi.spyOn>`, whose `unknown[]` args are not assignable to `InvalidateQueryFilters`. Test-file only.

## Notes for Gate 2

- The plan's risk 4 did not materialize: `cadastros-refresh.test.tsx` and `routing.test.tsx` never land on `cadastros/geral`, so `CadastroHistorySection` never mounts there and their `vi.mock('../api')` literals needed no `cadastroHistory` key. Full suite is green untouched.
- The E2E pass in the plan's section 4 (archive a produto, restore it from Configurações, then `Verificar cadeia`) was NOT run - it needs a local API plus the Docker database, which is outside this slice's fast verify. Flagged for the verify agent.
- The six wire literals remain unenforced across the API/web boundary; test 8 in this oracle is the web half of that pin.
