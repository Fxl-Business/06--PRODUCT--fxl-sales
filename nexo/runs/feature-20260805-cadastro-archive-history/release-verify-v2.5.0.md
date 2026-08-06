# Release verify - v2.5.0

- Commit verified: `281bc5baa2d1445284cea04c1426870ae382dfaa` on `master` (`git rev-parse HEAD`).
- Previous tag: `v2.4.0`. Proposed tag: `v2.5.0`.
- Working tree at start and at end: clean apart from the pre-existing untracked `.vscode/`.
- Verdict: **PASS**.

This agent wrote none of the code under review and read nothing else under `nexo/runs/`.

---

## 1. Gate commands

Every command was run on `281bc5b`, once each in run-once mode (`vitest run` via the package scripts; no watcher was started).
`pnpm test` and `pnpm --filter @fxl-sales/api test:integration` were each run a second time, deliberately, to capture a full log and to satisfy audit point 6 (determinism).

### `pnpm run lint` - PASS

```
> fxl-sales@1.0.0 lint /Users/cauetpinciara/Documents/fxl/projects/06--PRODUCT--fxl-sales
> pnpm -r lint

Scope: 4 of 5 workspace projects
packages/shared-types lint$ echo 'no lint for shared-types'
packages/shared-utils lint$ echo 'no lint for shared-utils'
packages/shared-utils lint: no lint for shared-utils
packages/shared-utils lint: Done
packages/shared-types lint: no lint for shared-types
packages/shared-types lint: Done
apps/api lint$ eslint src/
apps/web lint$ eslint src/
apps/api lint: Done
apps/web lint: Done
```

Zero warnings. The `no-restricted-syntax` rules that ban native `<select>`/`<option>`/`<datalist>` and raw `<input type="number">` in `apps/web/src` are part of this run, so the new `CadastroHistoryPanel.tsx` and the new archive controls in `SalesOpsApp.tsx` are covered by that ban.

### `pnpm run type-check` - PASS

```
Scope: 4 of 5 workspace projects
packages/shared-types type-check$ tsc --noEmit
packages/shared-utils type-check$ tsc --noEmit
packages/shared-types type-check: Done
packages/shared-utils type-check: Done
apps/api type-check$ tsc --noEmit
apps/web type-check$ tsc --noEmit
apps/api type-check: Done
apps/web type-check: Done
```

### `pnpm test` - PASS (exit 0)

```
> pnpm run build:packages && pnpm -r --if-present test && node scripts/no-legacy-auth.mjs && node scripts/build-contract.mjs
packages/shared-utils test:  Test Files  3 passed (3)
packages/shared-utils test:       Tests  80 passed (80)
apps/api test:  Test Files  36 passed (36)
apps/api test:       Tests  362 passed (362)
apps/web test:  Test Files  48 passed (48)
apps/web test:       Tests  575 passed (575)
build-contract: ok
```

Tail:

```
apps/web test:  Test Files  48 passed (48)
apps/web test:       Tests  575 passed (575)
apps/web test:    Start at  08:25:36
apps/web test:    Duration  5.72s (...)
apps/web test: Done
build-contract: ok
```

1017 tests, zero failures, zero skipped, zero todo. The tracked-file guard (`no-legacy-auth.mjs`) and `build-contract.mjs` both passed.

### `pnpm --filter @fxl-sales/api test:integration` - PASS (exit 0, twice)

Run 1 tail:

```
 Test Files  23 passed (23)
      Tests  150 passed (150)
   Start at  08:25:50
   Duration  14.41s (transform 172ms, setup 43ms, collect 2.85s, tests 9.43s, environment 1ms, prepare 485ms)
```

Run 2 tail:

```
 Test Files  23 passed (23)
      Tests  150 passed (150)
   Start at  08:26:14
   Duration  13.84s (transform 186ms, setup 43ms, collect 2.91s, tests 8.82s, environment 1ms, prepare 489ms)
```

Identical file count, identical test count, no flake, no skip. Pinned to the local Docker DB via `TEST_DATABASE_URL` / `TEST_MIGRATE_DATABASE_URL` as documented; the staging `DATABASE_URL` was never used.

### `pnpm run build` - PASS from a genuinely clean tree

Artifacts deleted first:

```
rm -rf packages/shared-types/dist packages/shared-utils/dist \
       packages/shared-types/tsconfig.tsbuildinfo packages/shared-utils/tsconfig.tsbuildinfo \
       apps/web/dist apps/api/dist
find . -name "*.tsbuildinfo" -not -path "*/node_modules/*" -delete
```

Verified afterwards that no `dist/` and no `*.tsbuildinfo` remained anywhere outside `node_modules`.

```
> fxl-sales@1.0.0 build
> pnpm run build:packages && pnpm --filter @fxl-sales/api build && pnpm --filter @fxl-sales/web build
> @fxl-sales/shared-types@1.0.0 build -> tsc --build --force
> @fxl-sales/shared-utils@1.0.0 build -> tsc --build --force
> @fxl-sales/api@1.0.0 build -> tsc && tsc-alias
...
dist/assets/index-v4X1CxDB.js                              250.77 kB │ gzip:  62.97 kB │ map:   872.83 kB
dist/assets/vendor-CGCwpBq_.js                             413.08 kB │ gzip: 127.19 kB │ map: 1,597.90 kB
✓ built in 1.60s
```

**What the web build actually emitted** (this is the specific failure mode being guarded against - a stale tsbuildinfo making `tsc` print `Done`, exit 0 and emit nothing):

- `apps/web/dist/index.html`, referencing 6 hashed assets: `index-v4X1CxDB.js`, `vendor-CGCwpBq_.js`, `vendor-query--pa_gVR2.js`, `vendor-radix-B5Uit9Xh.js`, `vendor-DUrBTMtq.css`, `index-o061lAXH.css`.
- `apps/web/dist/assets/` with 67 files, 4.1 MB total.
- The new feature is genuinely in the bundle: `apps/web/dist/assets/index-v4X1CxDB.js` contains the `Histórico` panel strings.
- `packages/shared-types/dist` and `packages/shared-utils/dist` both re-emitted `.js` + `.d.ts` + maps.
- `apps/api/dist` re-emitted the full tree (`auth/ config/ db/ domains/ jobs/ middleware/ ...`).

**Vercel-exact repro.** `vercel.json` sets `"buildCommand": "pnpm --filter @fxl-sales/web build"`, `"outputDirectory": "apps/web/dist"`. Artifacts were deleted a second time and that exact command was run alone:

```
> @fxl-sales/web@1.0.0 build
> pnpm --filter @fxl-sales/web^... build && tsc --noEmit && vite build

Scope: 2 of 5 workspace projects
../../packages/shared-types build$ tsc --build --force
../../packages/shared-utils build$ tsc --build --force
../../packages/shared-types build: Done
../../packages/shared-utils build: Done
vite v6.4.3 building for production...
✓ 1826 modules transformed.
✓ built in 1.61s
```

Exit 0, 67 assets, 4.1 MB, byte-identical chunk hashes to the full build. The two hotfixes that made this safe are both present and load-bearing: `packages/*` build with `tsc --build --force` (so a tsbuildinfo can never short-circuit an emit), and `apps/web`'s build script builds its workspace dependencies first via `pnpm --filter @fxl-sales/web^... build` before `tsc --noEmit`. The TS2307 class of deploy failure is not reproducible on this commit.

---

## 2. Audit point 1 - MIGRATION SAFETY

**The migration**, `apps/api/drizzle/0019_audit_log_org_history_idx.sql`, is one statement:

```sql
CREATE INDEX "audit_log_actor_org_id_id_idx" ON "audit_log" USING btree ("actor_org_id","id" DESC NULLS LAST) WHERE "audit_log"."actor_org_id" IS NOT NULL;
```

Additive and non-destructive: zero occurrences of `DROP`, `TRUNCATE`, `ALTER` or `DELETE`. No column, table, constraint or data is touched.

**Applies cleanly from 0018 - proven, not assumed.** A throwaway database `fxl_sales_verify_0019` was created on the local Docker cluster (`localhost:5006`) using the localhost `TEST_MIGRATE_DATABASE_URL` DSN. The staging `DATABASE_URL` from `apps/api/.env` was never used; the probe refuses any DSN that is not localhost. The runner's own `throughTag` option gave an exact 0018 baseline:

```
--- STEP 1: migrate through 0018 only ---
applied migrations at 0018: 19
audit_log indexes at 0018: [ 'audit_log_pkey' ]
--- STEP 2: apply 0019 ---
0019 wall time ms: 17
applied migrations after 0019: 20
IDX: CREATE INDEX audit_log_actor_org_id_id_idx ON public.audit_log USING btree (actor_org_id, id DESC NULLS LAST) WHERE (actor_org_id IS NOT NULL)
IDX: CREATE UNIQUE INDEX audit_log_pkey ON public.audit_log USING btree (id)
index validity: [ { relname: 'audit_log_actor_org_id_id_idx', indisvalid: true } ]
audit_log RLS: [ { relrowsecurity: false, relforcerowsecurity: false } ]
audit_log rows preserved: 5000
rows covered by partial index: 3334
--- STEP 3: re-run migrate (idempotency) ---
applied migrations after re-run: 20
--- scratch database dropped ---
```

5000 pre-seeded ledger rows (a third of them with a NULL org, to exercise the partial predicate) survived untouched; the index is `indisvalid = true`; a second `migrate` run is a no-op. The scratch database was dropped. The probe scripts lived in the session scratchpad, never in the repo, and are deleted.

**Journal and snapshot chain.**

- `_journal.json` gains exactly one entry: `idx 19`, `tag 0019_audit_log_org_history_idx`, `when 1785987120113`, monotonic after 0018's `1785941449505`.
- `0019_snapshot.json.prevId === 0018_snapshot.json.id === f62e40c6-9ef3-4dfc-89ec-6149fb8867b9`. The whole `prevId` chain across all snapshot files is intact.
- The snapshot's `audit_log` index entry matches the emitted SQL exactly: `actor_org_id` asc/nulls-last, `id` desc/nulls-last, `isUnique: false`, `concurrently: false`, `where: "audit_log"."actor_org_id" IS NOT NULL`.
- `drizzle-kit check` -> `Everything's fine`.
- Pre-existing, not introduced here: `meta/` has no `0005/0006/0008_snapshot.json`. `drizzle-kit check` is satisfied and the runner keys on the journal, not on snapshots, so this is inert. Flagging it only so it is not mistaken for new damage.

**The plain `CREATE INDEX` (not CONCURRENTLY) - assessment.**

The lock is real: `CREATE INDEX` takes `ACCESS EXCLUSIVE` on `audit_log` for the whole build, and the migration runner wraps ordinary migrations in a plain transaction with **no `lock_timeout`** (the 5s `lock_timeout` path in `migration-runner.ts` is reserved for the phased 0018 migration).

The mitigating facts, and where they stop:

- `apps/api/Dockerfile` runs `CMD ["sh","-c","node dist/db/migrate.js && exec node dist/server.js"]`, so the **new** container migrates before it serves. That is real but it is not the whole story: during a rolling deploy the **old** container is still serving and still writing to `audit_log`, so the lock is taken against live writers, not against an idle database.
- `audit_log` is low-volume in this product. It is written only on finder state transitions, commission approve/reverse, payout mark-paid and - as of this release - cadastro archive/restore. A btree build over 5000 rows measured 17 ms; even a million-row table is a small number of seconds.
- Migration failure aborts container start (`&&`), so a wedged build cannot yield a half-migrated server.

**Verdict: safe to ship, with one thing worth telling the human.** The residual risk is not the build duration, it is that with no `lock_timeout` on this path, a long-running transaction already holding a conflicting lock on `audit_log` would make the migration wait indefinitely - and while it waits, its queued `ACCESS EXCLUSIVE` request blocks every subsequent reader and writer behind it. Given the row count and write rate this is very unlikely; it is a one-line hardening (`SET lock_timeout` on the ordinary path, or `CREATE INDEX CONCURRENTLY` outside the transaction) that the human may want to schedule, but it is not a reason to hold v2.5.0.

Informational: on the freshly-loaded, never-`ANALYZE`d scratch table the planner chose `Bitmap Index Scan` + `Sort` rather than an ordered index scan for `WHERE actor_org_id = $1 ORDER BY id DESC LIMIT 51`. The index is used and the shape is correct; with real statistics the ordered scan is the expected plan. No action.

---

## 3. Audit point 2 - CROSS-SLICE INTEGRATION

Both sides compared directly, not through their tests.

**Field names.** `listOrgAuditHistory` in `apps/api/src/domains/audit/history-service.ts` returns exactly:
`id, ts, action, entityType, entityId, entityLabel, actorUserId, actorDisplayName`, plus a sibling `nextCursor`.
`CadastroHistoryEntryWire` in `apps/web/src/sales-ops/cadastro-history.ts` declares exactly those eight keys, and `CadastroHistoryResponse` declares `entries` + `nextCursor`. **Match, key for key.**

**Entity type literals.** API: `CadastroEntityTypeSchema = z.enum(['produto','pessoa','funcao','area'])`, and the four `auditCadastroLifecycle` call sites in `apps/api/src/domains/sales-ops/service.ts` pass `'pessoa'` (updatePerson), `'funcao'` (updateFuncao), `'produto'` (updateProduct), `'area'` (updateArea) - all four typed `CadastroEntityType`, so a typo cannot compile.
Web: `ENTITY_KINDS = ['produto','pessoa','funcao','area']`, matched exactly after `trim().toLowerCase()` by `normalizeHistoryEntityKind`. **Match.**

**Action literals.** API: `cadastroLifecycleEvent` returns only `'cadastro.archived'` / `'cadastro.restored'`, and both are in `AuditActionSchema`.
Web: `normalizeHistoryVerb` matches those two strings exactly, and `CADASTRO_HISTORY_ACTIONS` (sent as the `?action=` set) is the same pair. **Match.**

**The request the web actually sends** is `GET /api/v1/sales-ops/history?limit=50&action=cadastro.archived%2Ccadastro.restored`. `HistoryQuerySchema` accepts `limit` (1..200), `cursor` (`^\d+$`), `entityType`, and a comma-separated `action` set of 1..10 non-empty parts. 50 and a 2-element set are both well inside those bounds. **Compatible.**

**The restore round trip.** `restoreStateFor` maps kind -> resource via `RESTORE_RESOURCE = {produto:'products', pessoa:'people', funcao:'funcoes', area:'areas'}` and `salesOpsApi.setCadastroStatus` issues `PATCH /api/v1/sales-ops/{resource}/{id}` with body `{status}`. All four routes exist: `patch('/people/:id')`, `patch('/products/:id')`, `patch('/areas/:id')`, `patch('/funcoes/:id')`.

I did not take the "the schemas are `.partial()` so it must work" claim on faith - a status-only body is the one shape no per-slice test necessarily exercises through every schema. Probed directly against the four real schemas:

```
people   archive: OK  parsedKeys=[status]     (status: 'inactive')
people   restore: OK  parsedKeys=[status]
products archive: OK  parsedKeys=[status]     (status: 'archived')
products restore: OK  parsedKeys=[status]
areas    archive: OK  parsedKeys=[status]
areas    restore: OK  parsedKeys=[status]
funcoes  archive: OK  parsedKeys=[status]
funcoes  restore: OK  parsedKeys=[status]
planPersonFuncoes(update, status-only) = {"kind":"unchanged"}
SCHEMA GATE: PASS
```

All eight parse to `{status}` and nothing else, so no stale cached name or função set can be written back as a side effect, and the pessoa path does not trip `funcao_required`. The pessoa/other-cadastro status-spelling split (`inactive` vs `archived`) is consistent on both sides: `ArchivedStatus` in the API's `auditCadastroLifecycle` call sites, `CadastroStatus` and the `archived: row.status !== 'active'` reads in the web.

**Verdict: PASS.** The history panel is not silently read-only; every literal it matches on is a literal the API actually emits.

One honest caveat, which the code's own comments already admit: nothing machine-enforces the pair across the boundary. The web side pins its two action strings in `cadastro-history.test.tsx:600`. On the API side `CADASTRO_LIFECYCLE_ACTIONS` is exported as the contract anchor but is referenced by nothing in `apps/api/src` - the writer uses the bare literals via `cadastroLifecycleEvent`. So renaming an action means editing three places, and only two of them are pinned by a test. Cosmetic today (I verified the current values match); worth a follow-up, not a blocker.

---

## 4. Audit point 3 - TENANT ISOLATION

Confirmed against the live database that `audit_log` has **no RLS at all**: `relrowsecurity = false, relforcerowsecurity = false`. The `WHERE` clause really is the only control, exactly as the module documents.

- `salesOpsRouter.get('/history', requireAdmin, ...)` sits under `app.use('/api/v1/sales-ops/*', appAuthMiddleware)` in `server.ts`, so the token is verified before the handler runs, and the endpoint is additionally admin-gated - tighter than the read routes beside it.
- The org comes only from `c.get('orgId')`, set by `appAuthMiddleware` from the verified Hub token. `HistoryQuerySchema` declares `limit`, `cursor`, `entityType`, `action` and nothing else, and the handler builds its input from four explicit `c.req.query(...)` calls, so a smuggled `?orgId=` is never read. No request body is involved (it is a GET).
- `eq(auditLog.actorOrgId, orgId)` is the first element of the `conditions` array, created together with the array. The three optional filters (`cursor` -> `lt`, `entityType` -> `eq`, `actions` -> `inArray`) are `push`ed and combined with `and(...)`, so every one of them can only narrow. There is no code path that produces a `where` without the org predicate, and no unscoped export in the module.
- Fails closed: a blank or non-string `orgId` throws `org_id_required` rather than degrading to an unfiltered read.
- Actor-name resolution cannot leak across the boundary either: the `finders` lookup is `and(eq(finders.orgId, orgId), inArray(finders.accountId, actorIds))`, which is what stops a globally-unique `finders.account_id` from naming another org's actor. `sellers.account_id` was explicitly rejected for having no `org_id`.
- Only named scalars are projected out of the jsonb (`after_jsonb ->> 'label'`, `->> 'actorLabel'`); the unbounded `before_jsonb` / `after_jsonb` blobs are never shipped.
- `apps/api/test/rls/audit-history-org-scope.test.ts` proves this over the `app.fxl_admin` BYPASSRLS connection (assertion 3 explicitly demonstrates that the same connection *can* see org B's rows, which is what makes assertion 1 meaningful rather than an artifact of RLS), and covers narrowing-only filters, the NULL-org system row, keyset paging, blank-org fail-closed, the eight contract keys, and the no-blob projection.
- `writeAuditEntry` is always given `actorOrgId: input.orgId`, never null, for cadastro entries - so no tenant's own row can fall out of its own history.

**Verdict: PASS.**

---

## 5. Audit point 4 - NO DELETE VERB, NO DESTRUCTIVE OPERATION

- `salesOpsRouter` still exposes only `get`/`post`/`patch`/`put`. No `salesOpsRouter.delete(...)` exists. `routes.test.ts:625` asserts a `DELETE` request is refused.
- Every `DELETE` string added in `v2.4.0..HEAD` across `apps/api/src` and `apps/web/src` is either a comment saying there must not be one or the web guard test `never issues a DELETE and never sends a body key other than status`.
- Archiving is a status change and nothing else: `PATCH {status:'archived'|'inactive'}`, reversed by `PATCH {status:'active'}`. Both directions go through the identical code path; `useSetSalesOpsCadastroStatus` is one hook with a full status union rather than an `archive()` verb.
- The ledger records both directions (`cadastro.archived` / `cadastro.restored`) and `cadastroLifecycleEvent` writes nothing when the status does not actually transition, so a plain rename does not pollute the history.
- Migration 0019 contains no destructive DDL (section 2).
- The pre-existing `.delete(...)` calls in `service.ts` (person-função rows, product-função costs, sale child rows) are untouched by this release.

**Verdict: PASS.**

---

## 6. Audit point 5 - SECURITY SWEEP of `v2.4.0..HEAD`

- **Secrets/tokens/credentials:** none. Swept the added lines across `apps/`, `packages/` and `scripts/` for `sk_live`/`sk_test`, `SECRET_KEY=`, inline passwords, PEM private-key headers, long bearer literals and `api_key`-shaped assignments. Zero hits. No `.env` file is tracked or added.
- **Raw Hub account / workspace ids as user-facing labels:** none. `CadastroHistoryPanel.tsx` has three mutually exclusive actor branches - `Sistema` badge, or `userLabel({id, name})` when a name resolved, or the pt-BR primary line `Autor não identificado` with the id demoted to secondary `font-mono text-xs text-muted-foreground`. That is the sanctioned operator-screen fallback. The entity cell does the same: `entityLabelIsId` switches the row to muted monospace when neither a live name nor a snapshot exists. On the API side `resolveActorNames` returns `null` rather than falling back to the account id.
- **New endpoints missing auth:** none. The one new endpoint, `GET /api/v1/sales-ops/history`, is behind `appAuthMiddleware` (mount-level) plus `requireAdmin` (route-level).
- **New write capability:** none. `status` was already accepted by all four update schemas at `v2.4.0` (`git show v2.4.0:.../service.ts` confirms the same four `z.enum` status fields). This release adds the UI affordance and the ledger entry, not the ability to write the column. The `/products/:id` and `/areas/:id` PATCH routes remain non-admin-gated exactly as they were before the release - unchanged, and the archive affordances live under the admin-only `cadastros` workspace.
- **Logging of sensitive data:** none. Zero `console.*` or `logger.*` calls added anywhere in `apps/api/src` or `apps/web/src` in this range.
- **One observation for the human, not a defect.** `getHubActorDisplayName` (`apps/api/src/middleware/app-auth.ts`) falls back to the token's `email` when it carries no `name`, and that value is snapshotted into `audit_log.after_jsonb.actorLabel`, which is append-only and never pruned. This is the actor's own e-mail, shown to workspace admins in their own org's audit trail, and it is not an id - so it satisfies the UI-identifier rule. It is still PII entering a permanent ledger, and the human should be aware of it. There is a test (`routes.test.ts`) pinning both the null case and the e-mail fallback, so the behaviour is deliberate.

**Verdict: PASS.**

---

## 7. Audit point 6 - SKIPPED, QUARANTINED, NON-DETERMINISTIC TESTS

- Repo-wide grep over `*.test.ts` / `*.test.tsx` in `apps/` and `packages/` for `.skip(`, `.todo(`, `.only(`, `skipIf`, `runIf`: **zero hits**.
- Vitest summaries report only `passed` counts - no `skipped`, no `todo` line - in every one of the four suites.
- Integration suite run twice back to back: `23 passed (23)` / `150 passed (150)` both times, identical file and test counts. Durations 14.41s and 13.84s.
- Unit suite also run twice: `80 / 362 / 575` both times.
- The release adds 5 new test files and grows several existing ones (`cadastro-archive-audit.test.ts`, `audit-history-org-scope.test.ts`, `history-route.test.ts`, `cadastro-archive.test.tsx`, `cadastro-history.test.tsx`). The concurrency-sensitive ones are covered by real `FOR UPDATE` row locks in `updatePerson` / `updateFuncao` / `updateProduct` / `updateArea` rather than by timing, and the ledger tests include rollback oracles (ledger-write failure, status-write failure, COMMIT failure) plus a whole-chain verifiability assertion after both rollbacks.

**Verdict: PASS.**

---

## 8. Audit point 7 - CLAUDE.md COMPLIANCE

- **No em dash in new code.** Grep for U+2014 over added lines in `apps/` and `packages/`: zero hits (the grep pattern was self-tested against a known em dash to confirm it matches). The `─` characters in `schema.ts` are U+2500 box-drawing section rules, a different character and a pre-existing house style.
- **No CHANGELOG or auto-generated file hand-edited.** `git diff --name-only v2.4.0..HEAD` contains no `CHANGELOG`, no `*.lock`, no `pnpm-lock.yaml`. `drizzle/meta/0019_snapshot.json` and `_journal.json` are drizzle-kit generated, added by the generator, and `drizzle-kit check` validates them.
- **Every tenant query filtered by `orgId`.** The new/changed queries are: `listOrgAuditHistory` (`eq(auditLog.actorOrgId, orgId)` first in the conditions array), its `finders` lookup (`eq(finders.orgId, orgId)`), and the four new `FOR UPDATE` pre-reads in `updatePerson` / `updateFuncao` / `updateProduct` / `updateArea`, each `and(eq(<table>.orgId, orgId), eq(<table>.id, id))`. Every `auditCadastroLifecycle` call passes `orgId` through to `actorOrgId`. No request body supplies an org.
- **UI controls.** No native `<select>`/`<option>`/`<datalist>` and no raw `<input type="number">` were introduced - enforced by the ESLint rule that ran green above.
- **Actor / entity identifiers** rendered per the UI-identifier rule (section 6).
- **No DELETE verb** (section 5), and the archived-not-deleted invariant for áreas and funções is preserved.
- **Auth model** unchanged: bearer token, `c.get('hubAuth')`, `c.get('orgId')` as the Hub workspace id, `requireAdmin` for the admin surface.

**Verdict: PASS.**

---

## 9. Housekeeping

- Probe scripts (`probe-0019.mts`, `probe-statusonly.mts`) and the captured DSN lived only in the session scratchpad, never in the repository, and were deleted.
- The scratch database `fxl_sales_verify_0019` was dropped by the probe itself.
- No dev server, watcher or long-running process was started, so none was left running. The Docker containers on the machine were already up and were not touched.
- Final `git status --porcelain`: `?? .vscode/` only. No tracked file was modified. `dist/` and `*.tsbuildinfo` are gitignored and were regenerated by the builds.

---

## Verdict

**PASS.** All five gate commands pass on `281bc5b`, the web build genuinely emits from a fully clean tree under Vercel's exact command, and all seven audit points pass.

Two items to relay to the human, neither blocking:

1. Migration 0019's plain `CREATE INDEX` runs with no `lock_timeout` on the ordinary migration path, and the `ACCESS EXCLUSIVE` lock is taken while the previous container is still serving. Low real-world risk given `audit_log`'s row count and write rate (17 ms over 5000 rows), but a hung lock would queue all traffic behind it. Candidate for a follow-up hardening.
2. `audit_log.after_jsonb.actorLabel` will now persist the actor's e-mail address, permanently, whenever the Hub token carries no `name`.
