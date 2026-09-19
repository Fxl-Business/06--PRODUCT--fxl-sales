# Verify - 04-web-data-layer

Verdict: **PASS**

Worktree `.worktrees/20260918T000000Z-kanban-pipeline-leads/04-web-data-layer`, branch
`feat/20260918-04-web-data-layer`, one commit `5b5530d` ahead of `master`.
Diff reviewed: `git diff master...HEAD`. 10 files, +1595 / -0.

---

## 1. Named oracles - real output

```
$ pnpm --filter @fxl-sales/web test src/sales-ops/leads
 RUN  v3.2.7
 ✓ src/sales-ops/leads/__tests__/leads-calculations.test.ts  (6 tests) 8ms
 ✓ src/sales-ops/leads/__tests__/leads-optimistic.test.ts   (10 tests) 4ms
 ✓ src/sales-ops/leads/__tests__/leads-api-contract.test.ts  (6 tests) 19ms
 ✓ src/sales-ops/leads/__tests__/leads-move-rollback.test.ts (6 tests) 23ms
 Test Files  4 passed (4)
      Tests  28 passed (28)
```

Full gates, all green:

| command | result |
|---|---|
| `pnpm --filter @fxl-sales/web test` | `Test Files 60 passed (60)` / `Tests 812 passed (812)` |
| `pnpm run lint` | `apps/api lint: Done` / `apps/web lint: Done` |
| `pnpm run type-check` | all four projects `Done` |
| `pnpm run build` | `✓ built in 5.47s` |

No watcher was started; every run was `vitest run` / one-shot. Nothing left running.

---

## 2. Wire-contract agreement with the SHIPPED slice 03 API

Read directly: `apps/api/src/domains/sales-ops/leads/lead-schemas.ts`, `schemas.ts`,
`lead-routes.ts`, `stage-routes.ts`, `lead-service.ts` (`LeadView`, `toLeadView`),
`stage-service.ts` (`listLeadStages` returns the raw `$inferSelect` row) and
`apps/api/src/db/schema.ts` (`sales_ops_lead_stages`).

**Move body.** Shipped `MoveLeadSchema` is
`z.object({stageId: uuid, position: int 0..100000, reason?: string, saleId?: uuid}).strict()`.
`leadsApi.moveLead` destructures `{leadId, toStageId, toIndex, reason, saleId}` and builds the
body key by key, never spreading, with BOTH optional keys conditional so a `null`/`''` `reason`
or an absent `saleId` never reaches a `.strict()` schema. `leadId` is the path segment only.
Pinned by `moveLead posts to the lead own move path and never to a transition path`, which uses
`toEqual({stageId:'S2', position:3})` - an exact match, so any extra key fails.

**`ListLeadsQuerySchema` really requires `stageId`.** Confirmed: `stageId: uuid` non-optional.
`ListLeadsParams.stageId` is required in TypeScript and `listLeadsQuery` always `set`s it. There
is no board-wide list call anywhere in the slice.

**Create/update.** Shipped `CreateLeadSchema = LeadFieldsSchema.strict()` requires
`contactName` + `clientName`, defaults `estimatedValueBrl` and `products`, `nullish`es
`clientId` / `description` / `sellerPersonId`, and declares **no** `stageId` and **no** `saleId`.
`SaveLeadPayload` matches exactly: no `stageId` key exists on it, `clientName` is required,
`id` is destructured out of the body before the request. `UpdateLeadSchema` is
`.partial().strict()`, so the same payload is a legal PATCH.
`SaveLeadProductPayload = {productId?, productName?}` matches `LeadProductSchema.strict()`
(write shape), which is correctly distinguished from the READ shape in the comment.

**Read rows.** Shipped `toLeadView` projects exactly:
`id, stageId, stageChangedAt, position, contactName, clientId, clientNameSnapshot,
estimatedValueBrl, description, sellerPersonId, sellerNameSnapshot, saleId, saleStatus,
lostReason, products[], createdAt, updatedAt`. `SalesOpsLead` declares exactly that set.
Three reconciliations away from the plan are **correct and the shipped API wins each time**,
and each is documented on the field:

- the plan's `companyName: string | null` does not exist; the wire field is
  `clientNameSnapshot` and it is NOT NULL. Client declares `clientNameSnapshot: string`. Correct.
- the plan had `sellerNameSnapshot: string | null`; shipped is NOT NULL. Client matches.
- the plan gave `LeadProductWire` an `id`; `toLeadView` emits `{productId, productNameSnapshot}`
  with **no row id**. The client dropped it rather than modelling a field nobody can read. Correct.
- the plan's `orgId` on the lead does not exist on `LeadView`. Correctly absent from `SalesOpsLead`.
- the stage row IS the raw table row, so it does carry `archivedAt`, which the plan omitted.
  `SalesOpsLeadStage` models it. Correct.

`total` is returned by `GET /leads` and deliberately not modelled; an extra wire key is harmless.
`POST /leads` answers `201` (not the plan's `200`); `apiFetch` keys on `res.ok`, so this is inert.

Stage writes: `LeadStageSchema` / `UpdateLeadStageSchema` / `ReorderLeadStagesSchema` are
deliberately NOT `.strict()` (they strip `kind`/`isSystem`), and the client sends only
`{name, status?}`, `{status}` and `{stageIds}` respectively. Agreement holds.

**No disagreement found between client and shipped server schema.**

## 3. `apiFetch` body serialization

`apiFetch` does `const {token, headers, ...rest} = init` and spreads `rest` straight into
`fetch`, so a non-string `body` would serialize as `[object Object]`. Every one of the four
body-carrying calls in `api.ts` uses `JSON.stringify`.

**Mutation D** - `moveLead`'s body changed to a raw object (`as unknown as string`):

```
× leadsApi > moveLead posts to the lead own move path and never to a transition path
  Tests  1 failed | 27 passed (28)
```

Red, because `bodyOf` does `JSON.parse(entry[1].body ?? '{}')`, which throws on an object.
The string body is genuinely pinned.

## 4. The `boardKey` rule

`grep` finds no module-level `BOARD_KEY` constant anywhere. `useMoveLead(filters?)` computes
`const boardKey = queryKeys.leads.board(filters);` in its own body (hooks.ts:172), and all three
phases (`onMutate` read + write, `onError` write, `onSuccess` read + write) use that one value.
`useLeadsBoard` derives its `queryKey` from the same `queryKeys.leads.board(filters)`.

**Mutation A** - `const boardKey = queryKeys.leads.board(undefined);`:

```
× useMoveLead > patches the cache entry the board with the SAME filters is reading
  Tests  1 failed | 27 passed (28)
  - Expected: ["L2","L1","L3"]   + Received: ["L1","L2","L3"]
```

Red on a named test. Non-vacuous.

## 5. Optimistic rollback (acceptance 10)

**Mutation B** - `onError` deleted entirely:

```
× restores the lead's exact previous index inside its own column when a reorder fails
× restores the previous stage and the previous index when a cross-column move fails
× patches the cache entry the board with the SAME filters is reading
  Tests  3 failed | 25 passed (28)
```

**Mutation C (the important one)** - `onError` weakened to restore ONLY the moved lead's
`stageId` (a real reimplementation: find the prior row in `patch.previous`, write back only
`stageId` onto the current snapshot):

```
× restores the lead's exact previous index inside its own column when a reorder fails
× restores the previous stage and the previous index when a cross-column move fails
× patches the cache entry the board with the SAME filters is reading
  Tests  3 failed | 25 passed (28)
```

The reorder oracle is decisive against (b) because it asserts the ID ORDER `['L1','L2','L3']`
and the `position` integers `[0,1,2]`, neither of which a stage-only revert can restore on a
same-column reorder where the stage was never wrong. It also asserts the optimistic write really
happened first (`['L2','L1','L3']`), so it cannot pass by never writing at all, and it asserts
`stageChangedAt` came back as the original string.

The implementation satisfies this by construction, not by a field list: `onError` writes
`patch.previous` WHOLE.

## 6. D1 / D3 contract

`LeadStageKind = 'normal' | 'conversion' | 'lost'` - exactly three literals.
`grep -rn "converted"` over the ten shipped files finds the string only inside prose comments
explaining why the kind does not exist and in `leadIsConverted` / `lead_already_converted`
(the API's own 409 reason); there is no `'converted'` stage literal.

`leadIsConverted(lead) { return lead.saleId !== null; }` is the ONLY read-only predicate.
`stageIsReadOnly` does not exist anywhere in the tree.

The test is pinned to the CARD: it asserts a `saleId: null` lead sitting in stage `'CONV'` is
NOT converted, and that a `saleId`-carrying lead in stage `'S1'` IS. A stage-keyed
implementation (`stageId === 'CONV'`) fails both of those assertions.

**Mutation F** - `conversionStage`/`lostStage` rewritten to match on `name`:

```
× leads calculations > conversionStage and lostStage find the stage by kind, never by name
```

**Mutation E** - `stageChangedAt: now` unconditionally:

```
× moveLeadInList > leaves stageChangedAt byte-identical when the move is a reorder inside the same column
```

Both red. Acceptance 7 and 8 are genuinely held.

## 7. R7 fan-out

`useLeadsBoard(stages: readonly SalesOpsLeadStage[], filters?)` - `stages` is the LEADING
argument. One `useInfiniteQuery`; inside the single `queryFn` it filters `boardStages(stages)`
to the columns whose cursor is still non-null (`cursors === null` on the first page means "all"),
issues one `leadsApi.listLeads` per column under `Promise.all`, and returns ONE merged
`LeadsPage` (`answered.flatMap(({page}) => page.leads)`). That is the single flat cache entry
`useMoveLead` patches - both sides call `queryKeys.leads.board(filters)`.

Pagination survives: the per-stage `nextCursor` map rides in `LeadsPage.nextCursor`'s slot and
is handed back through `getNextPageParam`, going `null` exactly when every column is exhausted,
which is also what `leadsHasMore` reads. `enabled: stages.length > 0` keeps a `stageId`-less
`400` from ever being issued.

Nothing was added to `/bootstrap`: `SalesOpsBootstrap` is untouched and no shipped source file
mentions it (see §8).

## 8. `must_not_break`

| rule | result |
|---|---|
| `navigation.ts` byte-unchanged | SAME blob vs `master` |
| `SalesOpsApp.tsx` byte-unchanged | SAME blob vs `master` |
| `sales-ops/{types,api,hooks,optimistic}.ts` byte-unchanged | SAME blob for all four |
| existing `query-keys.ts` entries byte-unchanged | diff is additive only: one `LeadBoardFilters` alias plus one `leads` group |
| nothing reads/writes `queryKeys.salesOps.bootstrap()` | no source reference; the ONLY reference is the guard test `never writes into the sales-ops cache entry`, which seeds a sentinel and asserts `toBe` identity after a failing AND a succeeding move |
| no lead value reaches `getSalesOpsSummary` / dashboard / `computeSaleFinancials` | those names appear only inside a doc comment on `estimatedValueBrl` saying it must not |
| no `useMutation` outside `app-mutation.ts` | `grep` clean; all six mutations go through `useAppMutation` with a non-empty `invalidates: [queryKeys.leads.all]`. Lint (which bans the direct import) passes. |
| `requireToken` everywhere, no `?? ''` | every `mutationFn`/`queryFn` uses `await requireToken(getToken)`; lint's `no-restricted-syntax` passes; the `refuses a blank bearer token before any request is built` test drives the REAL `apiFetch` with a stubbed `fetch` and asserts `AuthTokenUnavailableError` plus `fetch` never called |
| no native `<select>` / `<option>` / `<datalist>` / raw `<input type="number">` | none - the slice ships no `.tsx` and no JSX at all |

## 9. Files touched vs `files_modified`

Exactly the ten files the plan lists, and nothing else:

```
apps/web/src/lib/query-keys.ts
apps/web/src/sales-ops/leads/{types,api,calculations,optimistic,hooks}.ts
apps/web/src/sales-ops/leads/__tests__/{leads-calculations,leads-optimistic,leads-move-rollback,leads-api-contract}.test.ts
```

Nothing outside. No `.tsx`.

## 10. Judging the tests themselves

Non-vacuous, proven by mutation: the rollback oracle (2 independent mutations), the board-key
oracle, the `stageChangedAt` reorder oracle, the by-kind stage lookup oracle, and the
body-serialization assertion. Six mutations run, six named tests red, all restored.

The harness is honest: the rollback file drives the REAL `useMoveLead` through
`renderToString` + a real `QueryClient`, mocking only `@/auth/react` and `../api`, so the
optimistic patch, the cache key, the rollback and `useAppMutation`'s `onSettled` invalidation are
all live code. `never writes into the sales-ops cache entry` uses `toBe` identity, so it cannot
pass by coincidence. `invalidates the leads root on failure as well as on success` spies on the
real `queryClient`.

**Gaps I am naming rather than hiding, none of which I read as a FAIL of this slice's
acceptance:**

1. **`useLeadsBoard` has no test at all.** No oracle references it, and the plan's §8 table names
   none, so this is a planned gap rather than a missed one - but it means the R7 fan-out, the
   cursor-map round trip through `getNextPageParam`, the `enabled: stages.length > 0` guard and
   the archived-column drop-out are verified by reading and by `type-check` only. The two
   `as unknown as string` casts carrying the cursor MAP in a `string | null` slot are exactly the
   kind of thing a test would pin. Slice 06 mounts this; it should bring a fan-out oracle with it.
   Likewise `useSaveLead`, `useSaveLeadStage`, `useSetLeadStageStatus` and `useReorderLeadStages`
   have no test; they are thin and their `invalidates` is type-enforced non-empty.
2. **Every fixture is hand-written, and nothing structurally couples `apps/web`'s lead types to
   `apps/api`'s.** There is no shared package for the lead wire shape, so a future slice-03 field
   rename would type-check and test green on both sides while 400ing or rendering `undefined` in
   production. TypeScript does keep the FIXTURES honest to the WEB types (the `lead()` builder is
   typed `SalesOpsLead`), so the drift risk is exactly web-type-vs-server-schema, not
   fixture-vs-web-type. I closed it for this slice by reading `lead-schemas.ts`, `schemas.ts` and
   `toLeadView` field by field (§2) and found no disagreement; the exposure remains structural.
3. The plan itself contains three factual errors about the shipped code, all of which the
   executor caught and corrected: `companyName` (does not exist), a lead-product row `id` (not
   emitted), and `body: {…}` as an object in the `moveLead` snippet (would have become
   `[object Object]`). The shipped code follows the real API and the real `apiFetch`, not the plan.

## Cleanliness

All six mutations restored with `git checkout --`. Final `git status --porcelain` is empty.
Nothing committed, nothing amended, no process left running.
