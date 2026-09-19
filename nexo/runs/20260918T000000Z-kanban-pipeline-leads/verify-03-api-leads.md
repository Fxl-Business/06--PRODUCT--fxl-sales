# Verify - slice 03-api-leads

Worktree `/.worktrees/20260918T000000Z-kanban-pipeline-leads/03-api-leads`, branch
`feat/20260918-03-api-leads`, one commit `6cc830b` ahead of `master`.
Diff under review: `git diff master...HEAD` (17 files, +7409 / -2).

**Verdict: PASS**, with two recorded findings that are follow-ups rather than acceptance failures.
Both are named in full below so they cannot be lost.

## 1. Named oracles, real output

```
$ pnpm --filter @fxl-sales/api test \
    src/domains/sales-ops/leads/__tests__/lead-contract.test.ts \
    src/domains/sales-ops/leads/__tests__/lead-routes.test.ts \
    src/domains/sales-ops/__tests__/sale-transitions.test.ts \
    src/domains/sales-ops/__tests__/routes.test.ts \
    src/domains/sales-ops/__tests__/lead-stages-routes.test.ts

 ✓ src/domains/sales-ops/leads/__tests__/lead-contract.test.ts (10 tests) 6ms
 ✓ src/domains/sales-ops/__tests__/sale-transitions.test.ts (14 tests) 7ms
 ✓ src/domains/sales-ops/__tests__/lead-stages-routes.test.ts (21 tests) 14ms
 ✓ src/domains/sales-ops/leads/__tests__/lead-routes.test.ts (10 tests) 13ms
 ✓ src/domains/sales-ops/__tests__/routes.test.ts (49 tests) 26ms
 Test Files  5 passed (5)      Tests  104 passed (104)
```

```
$ pnpm --filter @fxl-sales/api test:integration \
    test/rls/leads-seller-scope.test.ts test/rls/leads-no-financial-impact.test.ts \
    test/rls/lead-stages-rls.test.ts test/rls/sale-professional-funcoes.test.ts

 ✓ test/rls/lead-stages-rls.test.ts (11 tests) 852ms
 ✓ test/rls/sale-professional-funcoes.test.ts (16 tests) 1594ms
 ✓ test/rls/leads-seller-scope.test.ts (17 tests) 1196ms
 ✓ test/rls/leads-no-financial-impact.test.ts (1 test) 238ms
 Test Files  4 passed (4)      Tests  45 passed (45)
```

Full tiers:

```
$ pnpm --filter @fxl-sales/api test           -> Test Files  50 passed (50)   Tests  526 passed (526)
$ pnpm --filter @fxl-sales/api test:integration -> Test Files  30 passed (30)  Tests  216 passed (216)
$ pnpm run lint        -> apps/api lint: Done / apps/web lint: Done
$ pnpm run type-check  -> shared-types, shared-utils, apps/api, apps/web all Done
```

## 2. Seller scoping (acceptance 15) - the highest-stakes property

Enforced on the SERVER. Every one of `listLeads`, `getLead`, `createLead`, `updateLead` and
`moveLead` calls `resolveLeadScopePredicate(tx, orgId, scope)` as the FIRST statement inside its
own `withTenant(db, orgId, async (tx) => ...)` callback
(`apps/api/src/domains/sales-ops/leads/lead-service.ts`). There is no client filter anywhere, and
the route layer only builds the scope object from `c.get('userId')`, `c.get('userRoles')` and
`c.get('hubAuth').claims.email` - never from the body or the query.

The gate is a discriminated union and FAILS CLOSED: an unresolvable caller returns
`{ok:false, reason:'seller_person_unmapped'}` (403), never "no predicate".

The vendedor is resolved through `sales_ops_person_funcoes` joined to `sales_ops_funcoes` on
`slug = 'vendedor' AND is_system = true`, with `sales_ops_people.status = 'active'`. The deprecated
`is_seller` mirror is not referenced at all, pinned by a source read
(`lead-service.ts resolves the vendedor through person_funcoes and never through is_seller`) and by
the behavioural `seller_not_a_vendedor` / `seller_not_found` assertions inside
`writes client_name_snapshot and seller_name_snapshot from the cadastro rows, never from the body`.

### Mutation M1 - delete the seller predicate in `listLeads`

```
   × ... > serves a seller only their own leads, over the admin connection where RLS hides nothing
   × ... > ignores a sellerPersonId query parameter for a non-admin caller
   × ... > keeps an unassigned lead out of every seller's board and on the admin's
      Tests  3 failed | 14 passed (17)
```

The FIRST of those runs over `adminDb` (a `postgres` client carrying
`connection: {'app.fxl_admin': 'true'}`), where the admin policy exposes every org and RLS can hide
nothing. So the seller predicate is proved by a test RLS could not have satisfied. Non-vacuous.

### Mutation M2 - delete `eq(salesOpsLeads.orgId, orgId)` from `leadIdentityConditions`

```
   × ... > never returns another org's lead, over the admin connection
      Tests  1 failed | 16 passed (17)
```

Also over `adminDb`. The org predicate is load-bearing independently of RLS.

### Mutation M3 - make the gate fail OPEN (`return {ok:true, sellerPersonId: personId}` for a null)

```
   × ... > refuses a caller with no mapped pessoa with seller_person_unmapped and returns no rows
   × ... > binds hub_account_id once from the verified token e-mail and never to a second pessoa
      Tests  2 failed | 15 passed (17)
```

All three restored afterwards with `git checkout --`.

## 3. The `hub_account_id` self-claim path

`resolveCallerPersonId` (lead-service.ts). Judged against the AUDIT entry's "four guards, one-time".

| guard | shipped? | mutation | named test goes red? |
|---|---|---|---|
| e-mail comes from the VERIFIED token only, empty refuses | yes (`if (email === '') return null`) | removed | NO - see finding B |
| candidate set requires `hub_account_id IS NULL` | yes | removed alone | NO (masked by the UPDATE guard) |
| EXACTLY ONE candidate (`candidates.length !== 1`) | yes | `!== 1` -> `< 1` | YES - `binds hub_account_id once ...` |
| the claiming UPDATE re-asserts `hub_account_id IS NULL` | yes | removed alone | NO (masked by the candidate guard) |
| both `IS NULL` predicates removed TOGETHER | - | both removed | YES - `binds hub_account_id once ...` red with `expected { Object (ok, leads, ...) } to deeply equal { ok: false, ...(1) }` |
| partial unique index at the database | yes | proved directly | second pessoa claiming the same account is rejected by Postgres (probe) |

So the ONE-TIME binding is genuinely pinned; the two `IS NULL` predicates are mutually redundant
and each masks the other under single mutation, which is defence in depth rather than dead code.
The claim is also of the caller's OWN row, requires `status = 'active'`, and matches on
`lower(btrim(contact_email))` - the test deliberately stores `' Ana@Example.Test '` so the
normalization is load-bearing rather than incidental.

No `account_id`, `org_id`, `user_id`, `workspace_id` or `person_id` is read from any request body.
`CreateLeadSchema` / `UpdateLeadSchema` / `MoveLeadSchema` are all `.strict()`, so an `orgId` key is
a 400 rather than a silently stripped one, and the route test
`passes the VERIFIED org and never an orgId from the body or the query` asserts the service mock
received `'verified-org'` while both a body key and a query parameter carried decoys.

## 4. `PATCH /people/:id {hubAccountId}` - proved by test, but the test is MINE, not the diff's

Shipped code is CORRECT on both halves:

- `createPerson` and `updatePerson` do NOT spread `data` (the plan's §1.2 claim that they do is the
  plan's known factual error; the executor found it and wrote conditional spreads instead).
- `updatePerson` writes `...(data.hubAccountId !== undefined ? { hubAccountId: data.hubAccountId } : {})`,
  which is exactly the shape that keeps an omitting PATCH from clearing a claim.

I proved all of it with a throwaway integration probe (`test/rls/zzz-verify-probe.test.ts`, since
deleted), driving the real `updatePerson` against the local docker database:

```
 ✓ VERIFY PROBE > PATCH /people/:id {hubAccountId} really persists, and an omitting PATCH does not clear it
 ✓ VERIFY PROBE > a blank-e-mail token cannot claim a blank-contact_email pessoa
 ✓ VERIFY PROBE > the partial unique index refuses a second pessoa claiming the same hub account
      Tests  3 passed (3)
```

It asserts: (1) an admin PATCH carrying `hubAccountId` really lands in the column - NOT the
zod-strips-an-unknown-key silent 200 no-op CLAUDE.md records for
`PATCH /clients/:id {"status":"archived"}`; (2) a following ordinary Pessoa-dialog PATCH
(`{displayName, contactEmail}`) leaves the claim intact; (3) an explicit `null` clears it, which is
the documented admin repair path.

### FINDING A (HIGH, follow-up) - that property is unpinned in the shipped tree

I replaced the conditional with an unconditional `hubAccountId: data.hubAccountId ?? null` - the
exact regression an unaware future edit would make - and ran the WHOLE integration tier:

```
 Test Files  1 failed | 30 passed (31)
      Tests  1 failed | 218 passed (219)
```

The only failure was MY probe. With the probe removed, all 216 shipped integration tests and all
526 shipped unit tests stay GREEN while every Pessoa-dialog save silently wipes the one join the
leads board's server-side seller scoping depends on, sending that seller to
`403 seller_person_unmapped` forever.

Nothing about the shipped behaviour is wrong today. What is missing is the oracle. The slice's
integration test binds `hub_account_id` with raw SQL (`bindHubAccount`), so the documented admin
write path is never exercised. Recommendation: land the probe above (or its two assertions) as a
shipped test before the wave closes. It is roughly 25 lines and needs no new fixture.

### FINDING B (LOW) - the empty-e-mail guard is unpinned and not exploitable

Removing `if (email === '') return null` leaves all 17 named tests green. It is not a live hole:
both `createPerson` and `updatePerson` normalize with `contactEmail: data.contactEmail || null`, so
a `''` address cannot be written through the API, and my probe confirms that even a hand-planted
`contact_email = ''` row is NOT claimable by a token with no e-mail (`lower(btrim(NULL)) = ''` is
NULL, and the empty-string case never reaches a row). Defence in depth, worth keeping, worth a line
in a future test.

## 5. The rest of the binding contract, against SHIPPED code

| claim | verdict | evidence |
|---|---|---|
| move body is exactly `{stageId, position, reason?, saleId?}` under `.strict()` | PASS | `MoveLeadSchema` in `lead-schemas.ts`; `accepts the move body and nothing else` rejects `{toStageId, toIndex}` |
| `ListLeadsQuerySchema` requires `stageId` | PASS | mutation to `.optional()` reddened `requires stageId and caps limit at LEADS_MAX_LIMIT` AND `requires stageId on the list and never reads an orgId query parameter` |
| lost stage without a reason answers `validation_error` | PASS | deleting the guard reddened `a move into the lost stage without a reason throws lost_reason_required and writes nothing`; route body asserted with `toEqual` as `{error:'validation_error', reason:'lost_reason_required', itemIndex:-1}` |
| conversion stage without an in-org `saleId` | PASS | `if (false)` on the guard reddened `a move into the conversion stage requires a saleId that resolves in-org`; that test seeds the venda in org B and aims it at a lead in org A over `adminDb` |
| `stage_changed_at` ONLY on a real stage change | PASS | unconditional write reddened `stage_changed_at is byte-identical after a reorder inside the same stage` (and the source-read key-omission pin); never writing it reddened `stage_changed_at advances when and only when stage_id actually changes`, which also asserts an ordinary `updateLead` leaves it untouched |
| `kind` is the three literals only | PASS | `sales_ops_lead_stages_kind_check CHECK (kind in ('normal','conversion','lost'))` in 0022; no `'converted'` or `'open'` kind anywhere in the leads tree |
| `leadsRouter` and `leadStagesRouter` coexist without collision | PASS | runtime route-table probe of the real mounted `salesOpsRouter`: `GET /lead-stages`, `POST /lead-stages`, `POST /lead-stages/reorder`, `PATCH /lead-stages/:id` sit beside `GET /leads`, `POST /leads`, `GET /leads/:id`, `PATCH /leads/:id`, `POST /leads/:id/move`. Two imports, two mounts, no alias |
| NO DELETE verb | PASS | same probe: `uniq.filter(r => r.startsWith('DELETE'))` is `[]` across the entire `salesOpsRouter`; plus `exposes no DELETE verb on any lead route` |
| nothing written to `audit_log` | PASS | source read (`never reaches for the audit writer or the admin connection`) plus `moving a lead writes no audit_log row` counting rows before and after |
| leads absent from `/bootstrap`, `getSalesOpsSummary`, `computeSaleFinancials` | PASS | `leads-no-financial-impact.test.ts` deep-equals the WHOLE summary, the WHOLE snapshot and the whole persisted sale row, after asserting the three leads really exist (`count === '3'`) so the assertions cannot be vacuous. `lead-service.ts` imports none of those three symbols, pinned by source read |
| creating a lead creates no `sales_ops_clients` row and consumes no sequence/code | PASS | `creating a lead writes no sales_ops_sales row and consumes no sequence` and `creating a lead writes no sales_ops_clients row`; structurally, the file never imports `salesOpsClients` and probes the cliente with raw read-only SQL |
| `SALE_TRANSITIONS` / `EXPECTED_MATRIX` byte-unchanged | PASS | neither string appears anywhere in `git diff master...HEAD`; `service.ts` has exactly three hunks (PersonFieldsSchema, createPerson, updatePerson) |
| `withTenant` collapse | PASS | it was ALREADY exported on master by slice 02, so plan §1.1 step 1 correctly reduced to nothing; `stage-service.ts` and `stages-seed.ts` now both import from `./with-tenant.js`, and slice 02's oracles stay green |

## 6. Migration 0023 on a FRESH database

Created a brand-new `verify_fresh_0023`, ran the real `runDatabaseMigrations` from 0000 through
0023 against it:

```
RESULT  {"backendPid":36259}
COLUMN  [{"column_name":"hub_account_id","data_type":"text"}]
INDEX   [{"indexname":"sales_ops_people_org_hub_account_idx",
          "indexdef":"CREATE UNIQUE INDEX sales_ops_people_org_hub_account_idx
                      ON public.sales_ops_people USING btree (org_id, hub_account_id)
                      WHERE (hub_account_id IS NOT NULL)"}]
APPLIED [{"n":24}]
```

24 migrations applied to an empty database, the column and the PARTIAL unique index both exist, and
the database was then dropped. `meta/0023_snapshot.json` chains correctly: its `prevId` equals
0022's `id` (`fc2bd28d-...`), so a future `db:generate` will not re-emit this migration.

## 7. The three extra paths beyond the plan's declared 14

All benign and in scope:

- `apps/api/src/domains/sales-ops/leads/stages-seed.ts` - a one-line import swap to
  `./with-tenant.js`. The plan named only `stage-service.ts` for the collapse; slice 02 had left the
  same import in a second file, and leaving it behind would have defeated the "exactly one door"
  point of `with-tenant.ts`. Nothing else in the file changed.
- `apps/api/drizzle/meta/0023_snapshot.json` - generated by `drizzle-kit generate` and required for
  the journal to chain. Omitting it is the defect, not including it.
- `nexo/ROADMAP.md` - the plan's §3.1 explicitly instructs "Known gap, record it in
  `nexo/ROADMAP.md`". One added entry, accurate about both write paths and about the
  `contactEmail` full-set-replacement trap.

## 8. Judging the tests themselves

Every named oracle was driven to red by at least one mutation, except as listed in §3 and §4
(findings A and B). Specific notes:

- `writes stageChangedAt by key omission and never as a conditional value` is a source-regex pin,
  not a behavioural one. It is not vacuous (it went red on the unconditional mutation) but its value
  is anti-simplification; the behavioural proof is the pair of integration tests, both of which I
  drove red independently.
- `leads-no-financial-impact.test.ts` ships ONE test where the plan named three titles. All three
  assertions are present inside it, plus an explicit `count === '3'` non-vacuity check before them,
  so nothing was lost - only the granularity of the failure report.
- The route test asserts the 400 body as `{error, reason, itemIndex:-1}` with `toEqual`. That is a
  superset of the acceptance's quoted body, and it matches `SaleInputError`'s existing shape and the
  plan's own §4, so it is the contract rather than a drift.
- `resolveCallerPersonId` is exported but called only by `resolveLeadScopePredicate`; I used that
  export in my probe. No production caller bypasses the gate.

## 9. Cleanliness

Every mutation restored with `git checkout --`. The throwaway probe file, the route-table probe, the
fresh-migration script and the throwaway database were all deleted. No process was left running.

```
$ git status --porcelain
(empty)
```
