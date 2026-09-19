# exec 04-web-data-layer

Branch `feat/20260918-04-web-data-layer`, commit `5b5530d`.
Status: PASS.

## What shipped

Ten files, exactly the plan's `files_modified` list and nothing else:

- `apps/web/src/lib/query-keys.ts` - ONE added top-level `leads` group plus a local
  `LeadBoardFilters` alias. Every existing entry is byte-unchanged.
- `apps/web/src/sales-ops/leads/types.ts`
- `apps/web/src/sales-ops/leads/api.ts`
- `apps/web/src/sales-ops/leads/calculations.ts`
- `apps/web/src/sales-ops/leads/optimistic.ts`
- `apps/web/src/sales-ops/leads/hooks.ts`
- the four `__tests__/` files

`git diff --stat` against the base shows one modified file (`query-keys.ts`, +35) plus the
untracked `leads/` directory.
`navigation.ts`, `SalesOpsApp.tsx` and `sales-ops/{types,api,hooks,optimistic}.ts` are byte-unchanged.
No `.tsx` source file, no component, no JSX anywhere in the slice.

## Reconciliation with the SHIPPED slice 03 API

The plan's section 1 was a stated contract. The shipped API is the wire contract and it WON on
every point below. Each one is documented in place on the field or the payload type.

| plan | shipped | resolution |
|---|---|---|
| `LeadWire.orgId` | `LeadView` projects no `orgId` | dropped from `SalesOpsLead` |
| `companyName: string \| null` | `clientNameSnapshot: string` (NOT NULL) | renamed and made non-nullable |
| `sellerNameSnapshot: string \| null` | `sellerNameSnapshot: string` | non-nullable |
| `LeadProductWire = {id, productId, productNameSnapshot}` | `{productId, productNameSnapshot}` | `id` dropped rather than modelled as a field nobody can read |
| `LeadStageWire` without `archivedAt` | the stage row carries `archived_at` | `archivedAt: string \| null` added |
| `SaveLeadPayload.stageId: string` | `CreateLeadSchema` declares NO `stageId` | removed; a new lead lands in the first active `kind='normal'` stage by position |
| `SaveLeadPayload` with `companyName` | `clientName` is REQUIRED (min 1, max 200) | `clientName: string` is required on the payload |
| `SaveLeadProductPayload = {productId, productNameSnapshot}` | the WRITE schema is `{productId?, productName?}` | write shape modelled; the read shape stays `productNameSnapshot` |
| `POST /leads` -> 200 | -> 201 | no client change needed |

One correction to the plan's own code block, load-bearing: the plan's `moveLead` snippet passes
`body: {…}` as an object. `apiFetch` forwards `body` into `fetch` unchanged, and every existing
`salesOpsApi` writer passes `JSON.stringify(...)`. An object there would be serialized as
`[object Object]`. The implementation uses `JSON.stringify`, and the api-contract test parses
the body back out, so this is pinned.

## The contract points the orchestrator named

- `LeadStageKind = 'normal' | 'conversion' | 'lost'`. No `'converted'`, no `stageIsReadOnly`.
- `leadIsConverted(lead) === lead.saleId !== null` is the ONLY read-only predicate, and the
  calculations oracle asserts a NON-converted lead sitting in the `kind: 'conversion'` stage is
  not converted, so a stage-keyed implementation goes red.
- R7: `useLeadsBoard(stages, filters?)` fans out one `listLeads` per active column inside a
  single `useInfiniteQuery` `queryFn` and merges the answers into ONE flat `LeadsPage`. The
  board-wide cursor is a `Record<stageId, string|null>` map carried in `LeadsPage.nextCursor`'s
  slot (cast at exactly the two places the plan names) and is `null` only when every column is
  done. `enabled: stages.length > 0`.
- The `boardKey` rule: there is no module-level constant. `useMoveLead(filters?)` computes
  `const boardKey = queryKeys.leads.board(filters)` in its own body and uses it at all four call
  sites. A sixth oracle test pins this directly.
- R8: `leadsApi.moveLead` builds `{stageId, position, reason?, saleId?}` explicitly, key by key,
  never spreading the payload; both optional keys are conditional, and `reason` is dropped when
  it is `null`, `undefined` or `''`.
- Rollback writes `patch.previous` WHOLE, so stage, position and `stageChangedAt` all revert by
  construction.
- Nothing reads or writes `queryKeys.salesOps.bootstrap()`; test 5 is the standing guard.
- Every request takes its token from `requireToken(getToken)` and the required-token `apiFetch`.
  No `(await getToken()) ?? ''`.
- Every mutation is `useAppMutation` with `invalidates: [queryKeys.leads.all]`. No `useMutation`
  import.

## The oracle, proven decisive by mutation

`restores the lead's exact previous index inside its own column when a reorder fails`, in
`apps/web/src/sales-ops/leads/__tests__/leads-move-rollback.test.ts`. Three mutations applied to
`hooks.ts` and reverted afterwards:

1. `onError` deleted entirely -> 3 failed / 3 passed. The named oracle is RED.
2. `onError` weakened to restore only the moved lead's `stageId` (rebuilding the cache row by row
   and writing back only `stageId`) -> 3 failed / 3 passed. The named oracle is RED, which is the
   point: on a reorder the stage was never wrong, so a column-membership-only assertion would
   still pass; the ORDER and the `position` integers are what go red.
3. `boardKey` hardcoded to `queryKeys.leads.board(undefined)` -> 1 failed / 5 passed. Only
   `patches the cache entry the board with the SAME filters is reading` catches it, which is why
   that test exists.

`hooks.ts` was restored from a backup after each mutation and the suite re-ran green.

## Commands actually run, with their real output

```
pnpm --filter @fxl-sales/web test src/sales-ops/leads
  Test Files  4 passed (4)
  Tests  28 passed (28)

pnpm --filter @fxl-sales/web test
  Test Files  60 passed (60)
  Tests  812 passed (812)

pnpm run lint
  apps/api lint: Done
  apps/web lint: Done

pnpm run type-check
  packages/shared-types, packages/shared-utils, apps/api, apps/web: all Done

pnpm run build
  built in 1.72s (web bundle emitted)
```

`pnpm run build:packages` was run once on entry, per the contract's armadilha 1.

One intermediate red worth recording: `apps/web` compiles with checked indexed access, so
`calls()[0]` and `pages[0].leads[1]` in the two new test files were type errors even while the
tests passed. Fixed with a throwing `call(index)` helper and `.at()`, not with non-null
assertions.

## Open items handed to later slices

- Nothing blocking, and no question was left for `AUDIT.md`.
- Slice 05/06/08 consume `useLeadStages`, `useLeadsBoard`, `useSaveLead`, `useMoveLead`,
  `useSaveLeadStage`, `useSetLeadStageStatus`, `useReorderLeadStages`, plus every pure helper in
  `calculations.ts` and `optimistic.ts`. None of them needs to edit a file in this slice.
- Slice 05's lead dialog must send `clientName` (required free text) and must NOT send a
  `stageId` on create; slice 06 must pass `useMoveLead` the SAME `filters` object it passed to
  `useLeadsBoard`.
