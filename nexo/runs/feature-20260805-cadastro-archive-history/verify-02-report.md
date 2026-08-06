# Verify (Gate 2) - slice 02 org-scoped-history-read

- Verdict: **PASS**
- Branch: `feat/02-history-read` (uncommitted)
- Auditor: independent Verify sub-agent (did not write this code)
- Date: 2026-08-06

## 1. Commands - real output

Each run exactly once, run-once mode, no watchers.

### `pnpm --filter @fxl-sales/api test`

```
 Test Files  36 passed (36)
      Tests  362 passed (362)
   Duration  1.42s
```

### `pnpm --filter @fxl-sales/api test:integration`

```
 ✓ test/rls/audit-history-org-scope.test.ts (11 tests) 96ms
 ✓ test/rls/cadastro-archive-audit.test.ts (9 tests) 176ms
 ...
 Test Files  23 passed (23)
      Tests  150 passed (150)
   Duration  13.61s
```

### `pnpm --filter @fxl-sales/api lint`

```
> @fxl-sales/api@1.0.0 lint
> eslint src/
```

Exit 0, no output.

### `pnpm run type-check`

```
packages/shared-types type-check: Done
packages/shared-utils type-check: Done
apps/api type-check: Done
apps/web type-check: Done
```

All four re-run once more on the fully restored tree after every mutation was reverted; identical results (36/362, 23/150, lint 0, type-check Done).

## 2. Mutation testing

Every mutation was applied to the working tree, run, then reverted and byte-compared against a
pre-mutation backup (`diff` returned empty in each case).

### Mutation 1 (PRIMARY) - delete the `actorOrgId` predicate

`const conditions: SQL[] = [eq(auditLog.actorOrgId, orgId)];` -> `const conditions: SQL[] = [];`

Result: **RED**, `Tests 5 failed | 6 passed (11)`. Failures:

| assertion | failure |
| --- | --- |
| 1 and 2 (isolation) | received org B rows in an org A read |
| 4 (NULL-org) | system row surfaced |
| 5 (a filter cannot widen) | `expect(byOrgBEntityType).toEqual({entries:[],nextCursor:null})` failed |
| 5b (action SET) | `expected ... to have a length of 5 but got 6` |
| 7 (keyset paging) | `expected [ '1647', '1649', '1651' ] to not include '1651'` |

The failure diff printed the leaked fixture verbatim, which is the leak itself rendered as test output:

```
+       "entityId": "entity_b1_1785987484992_d033b4c1",
+       "entityLabel": "Nao deve vazar 1",
+       "entityType": "payout_1785987484992_d033b4c1",
+       "id": "1647",
```

Restored: `RESTORED IDENTICAL`, then `Tests 11 passed (11)`.

**The isolation is guarded, not decorative.**

### Non-vacuity of the oracle

Assertion 3 is the anti-vacuity control and it is genuine. Independently confirmed against the local
Docker test DB that the premise it rests on is true:

```
audit_log RLS:            relrowsecurity=f | relforcerowsecurity=f
roles:                    postgres        super=true  bypassrls=true
                          fxl_sales_test  super=false bypassrls=false
fxl_sales_test grants on audit_log:  INSERT, SELECT, UPDATE, DELETE
```

So the non-superuser connection every assertion is made over really can read org B's rows, and does
(assertion 3 selects them raw over `appClient` and gets 3). "Org B absent" therefore cannot be true
for the wrong reason, and mutation 1 proved it empirically by leaking exactly those rows.

Seeds are also proven to land: the positive control (assertion 1) asserts the full org A id list
`toEqual` the sorted expectation, derived from `ORG_A_ROWS.length`, never a hard-coded count.

### Mutation 2 - route trusts a query-string org

`listOrgAuditHistory(getDb(), c.get('orgId')` -> `listOrgAuditHistory(getDb(), c.req.query('orgId') ?? c.get('orgId')`

Result: **RED**.

```
FAIL src/domains/sales-ops/__tests__/history-route.test.ts > GET /history >
     ignores a smuggled orgId or actorOrgId in the query string
AssertionError: expected 'other-org' to be 'verified-org'
Tests  1 failed | 16 passed (17)
```

Restored, green.

### Mutation 3 - id projected as a BigInt

`id: String(row.id)` -> `id: row.id as unknown as string`

Result: **RED**, `Tests 5 failed | 6 passed (11)`, with the exact hazard the plan predicted:

```
FAIL ... serializes without a BigInt hazard (assertion 8)
AssertionError: expected 'bigint' to be 'string'
FAIL ... exposes exactly the eight contract keys (assertion 9)
TypeError: Do not know how to serialize a BigInt
FAIL ... extracts entityLabel by name and never ships the blob (assertion 11)
TypeError: Do not know how to serialize a BigInt
```

Restored, green.

### Mutation 4 - actor label falls back to the raw Hub account id

`actorDisplayName: names.get(row.id) ?? null` -> `?? row.actorUserId`

Result: **RED**.

```
FAIL ... resolves the actor name through all four branches (assertion 10)
AssertionError: expected 'acct_finder_b_1785987562147_10d3c462' to be null
Tests  1 failed | 10 passed (11)
```

Restored, green. The "never a bare account id as a label" rule is genuinely pinned.

### Mutation 5 - drop the explicit `finders` org predicate

`.where(and(eq(finders.orgId, orgId), inArray(...)))` -> `.where(inArray(...))`

Result: **GREEN** (`Tests 11 passed`). Not a defect. `finders` is `FORCE ROW LEVEL SECURITY` and the
read runs inside `setTenantContext(tx, orgId)`, so the database itself blocks org B's finder row. The
explicit predicate is the CLAUDE.md-mandated belt over that suspender, and is correctly present. Its
absence of a failing mutation is a property of `finders` having real RLS, not of the test being weak -
which is precisely the contrast that makes the `audit_log` filter the one thing that had to be
mutation-proven, and it was.

## 3. Audit findings, in the requested priority order

### 1. Isolation is real - PASS

Covered above. Five mechanisms all present and verified in source:

1. `listOrgAuditHistory(db, orgId, opts)` - `orgId` positional and required, no default, no overload,
   one exported read, no unscoped variant.
2. Fail-closed guard is the first statement: `if (typeof orgId !== 'string' || orgId.trim() === '')
   throw new Error('org_id_required')`. Pinned by assertion 6 for `''` and `'   '`.
3. The predicate is the array literal's first element.
4. No `getAdminDb` anywhere in the module (see point 3 below).
5. Org comes only from the verified token (see point 2 below).

### 2. The org can only come from the verified token - PASS

`HistoryQuerySchema` declares exactly four keys: `limit`, `cursor`, `entityType`, `action`. No org key
of any spelling. The route reads only `c.req.query(...)` for those four and `c.get('orgId')` for the
org.

Trust chain audited to its root: `appAuthMiddleware` sets `c.set('orgId', legacy.orgId)` where
`getHubLegacyAuthContext` returns `orgId: auth.workspaceId` from the `requireHubAuth`-verified token.
Nothing client-supplied reaches it.

I wrote and ran an independent smuggling probe beyond the shipped tests (16 assertions, all passed,
file deleted afterwards):

- Query keys tried: `orgId`, `actorOrgId`, `workspaceId`, `org_id`, `actor_org_id`, `org`, `tenantId`,
  `accountId`. Every one returned 200 with the service still called with `'verified-org'`, and the
  attacker value appeared nowhere in the serialized call arguments.
- Headers tried: `x-org-id`, `x-actor-org-id`, `x-workspace-id`, `x-fxl-org`, `x-tenant-id`. Same
  result.
- Body vector: `POST /history` with `{"orgId":"attacker-org"}` returns **404** - there is no POST route
  at all - and the service is never called.
- Schema source scan: the `HistoryQuerySchema` block matches no `/orgId|workspaceId|org_id|tenant/i`.

### 3. No `getAdminDb` in the read path - PASS

`apps/api/src/domains/audit/history-service.ts` imports only `drizzle-orm`, `../../db/client.js`
(type-only `import type { getDb }`), `../../db/schema.js` and `../../middleware/auth.js`. The string
`getAdminDb` does not occur, comments included. A source-reading assertion in
`history-route.test.ts` pins this.

`apps/api/src/domains/audit/routes.ts` (the cross-tenant admin reader) is **untouched**:
`git diff master --name-only -- apps/api/src/domains/audit/routes.ts` is empty. It still has
`getAdminDb()` at lines 40 and 70 and `entries: rows` at line 62.

### 4. NULL-org rows - PASS

`eq(auditLog.actorOrgId, orgId)` cannot match NULL. Asserted directly (assertion 4: the seeded
`actor_org_id IS NULL` row appears in neither org A's nor org B's result), and mutation 1 flipped that
assertion red, so it is load-bearing. The 0019 index is `WHERE actor_org_id IS NOT NULL`, consistent
with the same fact.

### 5. BigInt - PASS

`id: String(row.id)` and `nextCursor = hasMore && page.length > 0 ? String(page[page.length-1]!.id) : null`.
Assertion 8 pins `typeof id === 'string'`, `typeof nextCursor` in `{'string','object'}` (never
`'bigint'`), and `JSON.stringify(result)` does not throw, on both a paged and a final-page result.
Mutation 3 proved the pin.

The pre-existing `/api/v1/admin/audit` BigInt bug is **left alone**, correctly: that router still does
`c.json({ entries: rows })` on raw rows. Reminder for capture: the plan's section 8 makes logging it in
`nexo/ROADMAP.md` a required capture-step action.

### 6. Actor label - PASS

Resolution chain: write-time `after_jsonb ->> 'actorLabel'` snapshot, then self-from-verified-token,
then org-scoped `finders`, then `null`. There is no branch that assigns `actorUserId` to
`actorDisplayName`. Assertion 10 exercises all four branches, includes a blanket
`expect(entry.actorDisplayName).not.toBe(entry.actorUserId)` over every entry, and mutation 4 proved it
red. The API emits `actorUserId` and `actorDisplayName` as two separate fields and never concatenates,
so the web cannot accidentally promote the id into a label.

`getHubActorDisplayName` falls back to the token's `email` before `null`. That is the caller's own
verified e-mail used only for self-attributed rows, not an account id, so the CLAUDE.md rule holds.

### 7. Migration 0019 - PASS

- Content, one statement, no phased header, no `CONCURRENTLY`:
  ```sql
  CREATE INDEX "audit_log_actor_org_id_id_idx" ON "audit_log" USING btree ("actor_org_id","id" DESC NULLS LAST) WHERE "audit_log"."actor_org_id" IS NOT NULL;
  ```
- No collision: `0018_professional_payable_identity` is the previous tag; `0019_...` is new on disk.
- Journal chain: appended `{"idx": 19, "version": "7", "when": 1785987120113, "tag": "0019_audit_log_org_history_idx", "breakpoints": true}` after `idx: 18`, no reordering.
- Snapshot chain intact: `0019_snapshot.prevId === 0018_snapshot.id`
  (`f62e40c6-9ef3-4dfc-89ec-6149fb8867b9`).
- Strictly additive, verified by programmatic snapshot diff 0018 -> 0019:
  ```
  table set identical: true
  column changes: []
  index changes: [ 'public.audit_log' ]
  other-key changes: []
  enums/schemas/sequences/policies/views/roles identical: true
  ```
- Applies cleanly to a DB at 0018: the local Docker test DB was at 0018; the integration
  `globalSetup` applied 0019 and the index is now present:
  ```
  CREATE INDEX audit_log_actor_org_id_id_idx ON public.audit_log USING btree (actor_org_id, id DESC NULLS LAST) WHERE (actor_org_id IS NOT NULL)
  ```
- **Nothing was run against staging.** `apps/api/.env` has
  `DATABASE_URL=postgresql://***@fxl-db-server:5432/fxl_sales_stg_db` (staging), but
  `test/rls/global-setup.ts` resolves the migrate URL as
  `TEST_MIGRATE_DATABASE_URL ?? TEST_DATABASE_URL ?? DATABASE_URL`, and `.env` sets
  `TEST_MIGRATE_DATABASE_URL=postgresql://***@localhost:5006/fxl_sales`, so the first branch always
  wins. `test/rls/setup-env.ts` additionally hard-overrides `process.env.DATABASE_URL = appUrl`
  (localhost:5006) so the app under test cannot reach staging either. Every DB query I made in this
  audit went through `docker exec` into the local `06--product--fxl-sales-db-1` container. I opened no
  connection to staging.

  Minor note, not a slice defect: the index is present but on the ~1600-row local table the planner
  still prefers a backward `audit_log_pkey` scan for a selective org. That is a cost decision on a tiny
  table, and the index shape is exactly right for the production query.

### 8. Pagination - PASS

Keyset on `bigserial id`: `WHERE actor_org_id = $1 [AND id < $cursor] ORDER BY id DESC LIMIT limit+1`.
`id` is strictly monotonic in append order and the bound is exclusive, so a concurrent append at the
head cannot shift a page - no skip, no duplicate.

`limit + 1` probe is correct: `hasMore = rows.length > limit`, `page = hasMore ? rows.slice(0, limit) : rows`,
`nextCursor = hasMore && page.length > 0 ? String(last.id) : null`. Since `limit >= 1` after clamping,
`hasMore` implies `page.length === limit >= 1`, so the `page.length > 0` guard is redundant but
harmless. The important consequence is pinned by assertion 7: an **exactly full** last page still
reports `nextCursor === null`, which is what makes slice 04's truncation footer honest.

Assertion 7 also walks the cursor to exhaustion at `limit: 2`, asserting no repeat
(`expect(seen).not.toContain(entry.id)`), no org B id on any page, the union equalling the full
descending org A id list, and a final `nextCursor === null`. Mutation 1 broke it.

Limit is clamped twice: `.max(HISTORY_MAX_LIMIT)` at the route (a present-but-out-of-range value is a
loud 400, not a silent clamp) and `Math.min(200, Math.max(1, Math.trunc(...)))` in the service, so a
future non-HTTP caller cannot ask for 100000 rows.

Empty `actions` cannot degrade into `inArray(..., [])`: guarded by `opts.actions?.length` in the
service and rejected at the route; assertion 5b pins that `actions: []` behaves as no filter at all.

### 9. CLAUDE.md compliance - PASS

- No DELETE verb added. `grep '\.delete('` over the new route file and the service: none.
- No em dash (U+2014) anywhere in the slice, confirmed by byte-level scan
  (`LC_ALL=C grep -c $'\xe2\x80\x94'`) over all six slice files: `0` in every one. The `-` separators in
  the comments are plain hyphens; the `─` in the section banners is a box-drawing character matching
  the file's existing house style.
- No CHANGELOG or generated-file hand-edits. `meta/_journal.json` and `meta/0019_snapshot.json` are
  drizzle-kit output, appended consistently (chain verified above), not hand-authored.
- Scope confined to `apps/api/**`. `git diff master --name-only | grep '^apps/web'` returns nothing -
  correct for an API-only slice.
- Tenancy: every query in the new module carries its explicit org predicate, including the `finders`
  lookup, per the "every tenant query must filter by `eq(table.orgId, ...)`" rule.
- No raw account id is ever rendered as a label (point 6).

## 4. Acceptance criterion

> given entries for org A and org B, when an org A admin calls the new history endpoint over the
> non-superuser tenant connection, only org A's entries come back - newest first, keyset paginated,
> each naming its actor by display name or an explicit null and NEVER by a bare account id - and org
> B's entries are absent even though that same connection could read them with the filter removed.

**Met, and proven rather than asserted.** Each clause maps to a passing assertion, and the load-bearing
ones were shown to fail under mutation:

| clause | assertion | mutation-proven |
| --- | --- | --- |
| only org A's entries | 1, 2 | yes (mutation 1) |
| newest first | 1 (`toEqual` sorted desc) | yes (mutation 1) |
| keyset paginated | 7 | yes (mutation 1) |
| actor by name or explicit null, never a bare id | 10 | yes (mutation 4) |
| org B absent, though the connection could read them | 2 + 3 | yes (mutation 1 leaked exactly those rows) |

Plus, beyond the stated acceptance: `entityLabel` extracted by name with the blob never crossing the
wire (assertion 11), an eight-key payload with no `afterJsonb`/`prevHash`/`entryHash`/`requestId`/
`actorOrgId`/`actorLabelSnapshot` (assertion 9), and BigInt-safe serialization (assertion 8, mutation 3).

## 5. Tree restoration and hygiene

Every mutated file was restored from a scratchpad backup and byte-compared:
`diff` empty for both `history-service.ts` and `routes.ts`. The temporary smuggling probe file was
deleted. `git status --porcelain` matches the pre-audit snapshot exactly:

```
 M apps/api/drizzle/meta/_journal.json
 M apps/api/src/db/schema.ts
 M apps/api/src/domains/sales-ops/routes.ts
?? .vscode/
?? apps/api/drizzle/0019_audit_log_org_history_idx.sql
?? apps/api/drizzle/meta/0019_snapshot.json
?? apps/api/src/domains/audit/history-service.ts
?? apps/api/src/domains/sales-ops/__tests__/history-route.test.ts
?? apps/api/test/rls/audit-history-org-scope.test.ts
?? nexo/runs/feature-20260805-cadastro-archive-history/exec-02-report.md
```

(`.vscode/` was already untracked before this audit began and is unrelated to the slice.)

The oracle's `afterAll` cleanup is verified effective:
`select count(*) from audit_log where actor_org_id like 'org_hist_%'` returns `0`, and
`select count(*) from audit_log where length(entry_hash) <> 64` returns `0`, so the shared integration
ledger's hash chain is intact for the conversion suites.

No long-running process was started. All test invocations were run-once (`vitest run`); DB inspection
was via `docker exec` into a container I did not start. Nothing to kill.

## 6. Observations - non-blocking, no action required for Gate 2

1. `getHubActorDisplayName` falls back to the token `email` when `name` is absent, so a self-attributed
   row can render the caller's own e-mail as their display name. That is the caller's own verified
   identity, not another party's PII and not an account id, so it is within the rules. Worth knowing
   before slice 04 designs that cell.
2. The explicit `eq(finders.orgId, orgId)` in the name lookup survives mutation because `finders` has
   real RLS. It is correct and required by CLAUDE.md; it is simply not the control being proven here.
3. `nextCursor`'s `page.length > 0` conjunct is unreachable given `limit >= 1`. Harmless.
4. Capture-step reminder, from the plan's own section 8: the pre-existing
   `GET /api/v1/admin/audit` BigInt 500 must be logged in `nexo/ROADMAP.md`. It was correctly not fixed
   in this slice.
