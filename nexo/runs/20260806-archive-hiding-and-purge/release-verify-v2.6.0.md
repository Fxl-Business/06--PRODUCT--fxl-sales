# Release verify - v2.6.0

**Verdict: PASS.** Every gate command passed on the exact release commit, the clean-slate build emitted
real output, and nothing in this release can be hard-deleted on the first night after deploy.

- Release commit: `33c678eb386abf0ea52e9fbb0197d148ed562908` (merge of `feat/archive-hiding-and-purge` into `master`)
- Previous tag: `v2.5.0` -> proposed `v2.6.0`
- Feature commit: `413c97e feat(cadastros): hide archived rows and purge the unreferenced ones after 30 days`
- Verified at: 2026-08-06T16:25Z
- Working tree at start and at end: clean apart from the pre-existing untracked `.vscode/`

## 1. The gate

Each command run exactly once, in run-once mode, on the commit above.

| Command | Result |
| --- | --- |
| `pnpm run lint` | exit 0 - `apps/api` and `apps/web` eslint Done, packages have no lint |
| `pnpm run type-check` | exit 0 - `apps/web tsc --noEmit` Done, `apps/api tsc --noEmit` Done |
| `pnpm test` | exit 0 - shared-utils 3 files / 80 tests, api 37 files / 364 tests, web 48 files / 590 tests. **1034 passed, 0 skipped, 0 failed** |
| `pnpm --filter @fxl-sales/api test:integration` (run 1) | exit 0 - 24 files / 158 tests passed |
| `pnpm --filter @fxl-sales/api test:integration` (run 2) | exit 0 - 24 files / 158 tests passed |
| `pnpm run build` (after the clean below) | exit 0 |

Integration ran against the LOCAL Docker database only. `apps/api/.env` pins `TEST_DATABASE_URL`,
`TEST_MIGRATE_DATABASE_URL` and `ADMIN_DATABASE_URL` to `localhost:5006`, and
`test/rls/cadastro-purge.test.ts` additionally has an `assertLocalDb()` guard that refuses to run the
destructive suite against any host other than `localhost:5006` / `127.0.0.1:5006`. Nothing in this
verify touched the staging `DATABASE_URL`.

### The clean build

Deleted before building, exactly as instructed, so a stale incremental state could not make `tsc` exit 0
while emitting nothing:

```
rm -rf packages/*/dist packages/*/tsconfig.tsbuildinfo apps/web/dist apps/api/dist
```

The build then ran `shared-types -> shared-utils -> api -> web` from scratch.

**What the web build actually emitted** (this is the check that a previous production deploy failed):

```
vite v6.4.3 building for production...
✓ 1826 modules transformed.
dist/index.html                          0.78 kB │ gzip:  0.37 kB
dist/assets/index-B3LfMOnd.js          250.38 kB │ gzip: 63.01 kB
dist/assets/vendor-BuhlcSih.js         412.61 kB │ gzip: 127.10 kB
dist/assets/vendor-radix-C8PTsvzA.js    72.24 kB │ gzip: 21.91 kB
dist/assets/vendor-query-AtjWGwHp.js    41.37 kB │ gzip: 12.34 kB
✓ built in 1.67s
```

- `apps/web/dist`: 68 files, 4.1 MB - 30 JS chunks, 2 CSS, 5 woff2 fonts, `index.html` (780 bytes).
- The bundle contains THIS release's code, not a stale one: `index-B3LfMOnd.js` greps positive for both
  `histórico de arquivamentos` (the new confirmation copy) and `Excluiu definitivamente` (the new purge
  ledger label).
- `apps/api/dist`: 87 JS files, 2.5 MB, including the new `dist/domains/sales-ops/purge-service.js` and
  `dist/jobs/nightly-job.js`, plus the `dist/db/migrate.js` and `dist/server.js` the container CMD needs.
- `packages/shared-types/dist` (64 KB) and `packages/shared-utils/dist` (116 KB) both regenerated.

All four `dist` trees are gitignored; `git status --porcelain` after the build is still just `?? .vscode/`.

## 2. The delta since the Gate-2 verify

The three post-verify orchestrator edits. All three are correct.

### 2a. pt-BR agreement in the pessoa confirmation

`apps/web/src/sales-ops/SalesOpsApp.tsx:529` now reads:

> Ela sai desta lista e das listas de seleção de vendedor, finder e profissional, mas continua nas
> propostas que já a utilizam.

Correct. The subject of the relative clause is `as propostas` (plural), so the verb is `utilizam`; the
clitic `a` is the direct object (`a pessoa`) and stays singular. The fix brings the pessoa string into
line with the four siblings, which were already plural and are unchanged:

- produto / serviço: `nas propostas que já o utilizam` (`o` = o produto)
- área: `nos produtos e propostas que já a utilizam`
- função: `nas pessoas e propostas que já a utilizam`

No other agreement error in the five strings.

### 2b. `AreasView` `Nº produtos` filtered to `status === 'active'`

```ts
const productCount = bootstrap.products.filter(
  (product) => product.areaId === area.id && product.status === 'active',
).length;
```

Correct and internally consistent: `ProductsView` in the same release lists only
`product.status === 'active'`, so an archived produto is not listed, not in any picker and not reachable
by clicking. Counting it on the área row would print a number with nothing behind it. Same rule the
segmented `Produtos | Serviços` counts already follow in `ProductsView`.

### 2c. `FuncoesView` `Nº pessoas` filtered to `status === 'active'`

```ts
const personCount = bootstrap.people.filter(
  (person) =>
    person.status === 'active' &&
    person.funcoes.some((assigned) => assigned.id === funcao.id),
).length;
```

Correct, same reasoning, and it does NOT leak into the opposite direction: the função chips rendered on
a pessoa row are still deliberately unfiltered, so an archived função stays visible on the people who
carry it, exactly as CLAUDE.md requires. That non-regression is pinned by the new test
`still renders the chip of an archived função a listed pessoa carries`.

### Did the two count changes break or weaken a test?

No test broke - the full suite is green. But the honest answer to "is either count asserted anywhere" is
that **both count assertions exist and neither one exercises the new filter**, because in both fixtures
every counted row is already active:

| Assertion | File | Why it is insensitive to the change |
| --- | --- | --- |
| `expect(countCell).toBeTruthy()` for a `td` reading `1` | `__tests__/areas-view.test.tsx:178` (test `lists only active áreas...`) | the fixture's single produto is `status: 'active'` (the `product()` factory default), so the count is `1` with or without the filter |
| `cells('Vendedor')?.[2]).toBe('2')`, `Finder` `'0'`, `Designer` `'1'` | `__tests__/pessoas-funcoes-view.test.tsx:558-560` (test `lists funções marking predefinidas and counting assigned pessoas`) | both fixture pessoas (`Sig`, `Halland`) are `status: 'active'` (the `pessoa()` factory default), so every count is unchanged by the filter |

So: **no test pins the old inclusive count** - there was never an inclusive-count assertion to break -
and **no test needed updating that was not updated**. The index shift `[3] -> [2]` in the funções
assertion is not related to this delta; it is the `Status` column removal from the feature commit itself,
and it was updated correctly.

What that does mean is a **mutation-survivability gap**: reverting either `status === 'active'` clause
would leave the whole suite green. It is a coverage gap, not a defect, and the behaviour itself is
correct on inspection. Not a release blocker. Recommendation for a follow-up slice (not this release):
add one archived produto to the `AreasView` fixture and one inactive pessoa to the `FuncoesView` fixture
and assert the counts exclude them.

## 3. Migration 0020 is release-safe

`apps/api/drizzle/0020_cadastro_archived_at.sql`.

**Additive and nullable.** Four `ALTER TABLE ... ADD COLUMN "archived_at" timestamp with time zone`, no
`NOT NULL`, no `DEFAULT`, no index, no constraint, no drop, no type change. Confirmed against the
snapshot:

```
sales_ops_areas    {'name': 'archived_at', 'type': 'timestamp with time zone', 'notNull': False, 'primaryKey': False}
sales_ops_funcoes  (idem)   sales_ops_people (idem)   sales_ops_products (idem)
```

and `archived_at` is absent from all four tables in `0019_snapshot.json`, so nothing is redefined.

**Chain intact.**

- `_journal.json` ends at `{"idx": 20, "version": "7", "when": 1786030700588, "tag": "0020_cadastro_archived_at", "breakpoints": true}`, following `idx 19` with no gap.
- `0020_snapshot.json.prevId` = `71adaba5-d28d-4862-8553-a67e914e726a` = `0019_snapshot.json.id`. Exact match.

**Applies cleanly on top of 0019.** Proven, not assumed: the integration suite's `globalSetup`
(`test/rls/global-setup.ts`) runs `runDatabaseMigrations` over the whole `./drizzle` folder against the
local database before any RLS test connects, and it did so twice in this verify with 24/24 files green.

**The backfill is idempotent and cannot stamp a non-archived row.** Every one of the four UPDATEs is
`WHERE "status" = <archived spelling> AND "archived_at" IS NULL`:

- The `archived_at IS NULL` guard makes a replay a no-op - a second run matches zero rows, so it can
  never re-stamp and re-open a window that has already started ticking.
- The `status` guard makes stamping an active row impossible. That matters more than it looks: a stamped
  active row would become purgeable the instant someone archived it, with no window at all.
- Pessoas correctly use `'inactive'` and the other three use `'archived'`.

This is not just read - it is executed as a test. `test/rls/cadastro-purge.test.ts`
(`backfills a pre-0020 archived row onto a fresh window, and leaves active rows alone`) reads the
migration file itself, splits on `--> statement-breakpoint`, and REPLAYS the five backfill statements
against an already-migrated database, then asserts the three legacy rows are stamped, the active row is
still `NULL`, and nothing is purgeable.

**Locks.** In PostgreSQL 11+, `ADD COLUMN` with no default is a catalog-only change: it takes
`ACCESS EXCLUSIVE` but does not rewrite the table, so it is O(1). The four UPDATEs then take ordinary row
locks, and only on rows that are already archived - a set that is small by construction and, on the app
path, cannot be concurrently contended in a way that matters. Drizzle wraps the migration in one
transaction (which is also what makes the transaction-local `set_config('app.fxl_admin','true',true)`
work at all and keeps it from leaking), so the `ACCESS EXCLUSIVE` lock is held across the UPDATEs too.
**No long lock in practice**; the only scenario that would change that is an org with a genuinely huge
archived backlog, which does not exist here.

The `set_config('app.fxl_admin', 'true', true)` line is required, not incidental: all four tables are
under `FORCE ROW LEVEL SECURITY`, so without an admin session context the UPDATEs would silently match
zero rows in any deployment whose migration role is the table owner rather than a superuser. Same shape
as the 0012 system-função seed.

Runs at container start: `apps/api/Dockerfile:40` -
`CMD ["sh", "-c", "node dist/db/migrate.js && exec node dist/server.js"]`. Migrate strictly precedes
server start, and `dist/db/migrate.js` was emitted by the clean build above.

## 4. The destructive job is safe on the first night - CONFIRMED, no blocker

Reasoning the first night after deploy, end to end:

1. **Eligibility is one predicate and it is not restated anywhere.** `pastRetention()` in
   `purge-service.ts:78` is `archived_at < now() - make_interval(days => 30)`, measured by the DATABASE
   clock, and every one of the four specs calls that same function. The scan and the per-item
   `FOR UPDATE` re-check both go through the SAME `due()` builder, so they cannot disagree.
2. **Every pre-existing archived row is stamped `now()` at deploy.** The backfill above. So on the first
   night, `now() - archived_at` is at most a few hours - roughly 30 days short of eligible.
3. **Every row archived after deploy is stamped with the app clock at archive time.**
   `archivedAtPatch()` (`service.ts:88`) returns `{ archivedAt: new Date() }` on the archive transition
   and `{ archivedAt: null }` on restore, and it is derived from `cadastroLifecycleEvent` - the same
   classification the ledger entry uses - so a rename that resubmits the current status is not a
   transition and leaves the stamp alone. A restore therefore restarts the window rather than resuming
   an old one, which is the safe direction.
4. **A `NULL` stamp is never eligible.** `NULL < now() - interval` evaluates to `NULL`, which is not
   `TRUE`, so the row is not selected. Any archived row the backfill somehow missed (for example one
   inserted directly as archived by raw SQL) is unpurgeable, not instantly purgeable.
5. **No path can write a backdated stamp.** `grep archivedAt` over `apps/api/src` outside tests returns
   exactly four writer call sites, all `archivedAtPatch`, plus four reader call sites, all
   `pastRetention`. The value is only ever `new Date()` or `null`.
6. **`archived_at` cannot be injected through the API.** The spread order in each `.set()` is
   `{...data, ...archivedAtPatch(...)}`, so on a transition the patch wins outright; and on a
   non-transition `data` cannot carry the key at all, because every write schema is a plain `z.object`
   (`AreaSchema`, `UpdateAreaSchema = AreaSchema.partial()`, and their siblings) parsed with
   `safeParse`, and zod strips unknown keys. There is no `.passthrough()` anywhere in `apps/api/src` or
   `packages/shared-types/src`.
7. **Even a hypothetically eligible row is not necessarily deleted.** The job attempts the DELETE and
   treats SQLSTATE `23503` as "still referenced, skip", walking the `cause` chain up to 5 levels because
   Drizzle wraps the driver error. Anything that is not `23503` is counted `failed` and logged with its
   item, never folded into `skipped`. Each item runs in its own transaction, and the ledger entry is
   written BEFORE the DELETE inside that same transaction, so a skip rolls the entry back with it.
8. **System funções are excluded twice** - the API refuses to archive them, and the spec still filters
   `is_system = false`.
9. **Scheduling gives one more layer of slack.** The purge is the last of the three nightly tasks
   (`30 3 * * *`, after `0 3` and `15 3`), in its own try/catch, so a failure cannot cascade.

Item 2 is directly asserted by the integration oracle: after replaying the backfill,
`purgeArchivedCadastros(adminDb)` runs and all three legacy rows are still there with their original
status. The in-window case is separately pinned by `an item archived inside the window is untouched`.

**Nothing can be deleted on the first night. Not a blocker.**

## 5. Security sweep of `v2.5.0..HEAD`

- **Secrets / credentials: none.** Grepping added lines for `secret|password|api_key|token|pk_|sk_|bearer`
  hits only column NAMES in the regenerated drizzle snapshot (`secret_key_hash`, `secret_key_prefix`,
  `webhook_signing_secret`, `hub_refresh_token_enc`) - all pre-existing tables, all names, no values. No
  `.env`, no key material, no connection string with a live password.
- **Raw Hub account or workspace id as a user-facing primary label: none.** The only new actor in the
  release is the purge's `actorUserId: 'system'` sentinel, and the history read resolves it through step
  0 of its existing precedence chain (`after_jsonb ->> 'actorLabel'`, which the purge writes as
  `'Sistema'`), so the panel renders the pt-BR label and `actorLabel` falls to `''`. The new panel test
  asserts `text()).not.toContain(PRODUCT_ID)` while asserting `Sistema` IS shown. The existing
  `funções cadastro` test still asserts the org id never appears.
- **New route lacking auth: no new route at all.** No routes file appears anywhere in the release
  diffstat; the purge has no HTTP surface and is reachable only from the cron scheduler. The purge's
  cross-tenant `getAdminDb()` is scoped by an explicit `org_id` predicate on every DELETE (RLS admits
  every row under admin context, so the predicate is the only tenancy boundary and it is present on all
  four), and `purges one org without ever touching another` proves it.

## 6. Skipped, quarantined or newly non-deterministic tests

- **None skipped or quarantined.** No `it.skip` / `describe.skip` / `.only` / `.todo` / `xit` / `xdescribe`
  in the added lines, and the runner reports zero skipped across all three unit projects and the
  integration project.
- **Determinism: confirmed.** Both integration runs: 24 files passed, 158 tests passed, exit 0. The
  per-file result lists are byte-identical apart from elapsed-time figures and one entry moving in and
  out of vitest's slow-test listing (a duration threshold artifact, not a result change). No flake, no
  ordering dependency, no leaked state between runs - notable given the suite hard-deletes rows.

## 7. CLAUDE.md compliance across the diff

- **No DELETE verb added to any route.** No routes file is in the diff at all. The only
  `router.delete(` in the codebase is the pre-existing `linksRouter.delete('/:linkId')`, untouched.
  `salesOpsRouter` still has none, and the comment above the funções routes that says so is intact. The
  hard delete in this release is a scheduled job with no HTTP surface, which is the distinction the rule
  is about.
- **No em dash in new code.** Grepping added lines across the whole diff excluding `nexo/` and
  `CLAUDE.md` returns zero. The new comments consistently use ` - `.
- **No CHANGELOG or generated-file hand-edits.** No `CHANGELOG`, no lockfile, no generated file in the
  changed-name list. `0020_snapshot.json` and `_journal.json` are drizzle-kit output committed as a
  migration artifact - which is required, and their chain verifies as shown in section 2.
- Docs kept honest: `CLAUDE.md` was updated as part of the feature commit, and the new comment in
  `PessoasView` explicitly records why the função chips stay unfiltered.

## Verdict

**PASS.** Tag `v2.6.0` and promote.

One non-blocking follow-up for a later slice: the two `status === 'active'` count filters
(`Nº produtos`, `Nº pessoas`) are correct but survive mutation - no fixture contains an archived or
inactive row in the counted set, so reverting either clause leaves the suite green.
