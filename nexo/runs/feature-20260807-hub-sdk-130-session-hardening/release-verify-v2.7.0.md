# Release verify - v2.7.0

VERDICT: **PASS**

Release commit `df0590dac8252834a8593b2a508fad3c8a79e611` on `master`, proposed tag `v2.7.0`.
Production currently runs `v2.5.0`, so this promotion carries the unpromoted `v2.6.0` cadastro archive/purge work together with the `v2.7.0` session hardening.
Every gate below was run against the release commit and every one of them passed.
Nothing in this release blocks the promotion.
The risks worth knowing before you press the button are in the last section, and one of them is a rolling-deploy ordering hazard that is real but transient.

## Command results

All six commands were run once, never in watch mode, with the exit code captured directly.

| Command | Exit code | Result |
| --- | --- | --- |
| `pnpm install --frozen-lockfile` | 0 | Lockfile up to date, resolution step skipped |
| `pnpm run type-check` | 0 | All 5 workspace projects clean |
| `pnpm run lint` | 0 | Clean |
| `pnpm test` | 0 | web 641 tests / 49 files, api unit suite, plus the `no-legacy-auth` guard and `build-contract` |
| `pnpm run build` | 0 | packages, api and web all built |
| `pnpm --filter @fxl-sales/api test:integration` | 0 | 25 files / 169 tests against the local Docker DB on port 5006 |

No failures, so there is no failure output to reproduce.

## Clean-clone deploy simulation

This is the check that v2.3.0 failed, so it was run the same way Vercel runs it rather than the way the monorepo runs it.

- Cloned the repo to a temp directory and checked out `df0590d` exactly.
- Confirmed zero `*.tsbuildinfo` files survived (`find -delete`, then a recount returning 0).
- `pnpm install --frozen-lockfile` in the clone: exit 0.
- `pnpm --filter @fxl-sales/web build` - the literal `buildCommand` from `vercel.json` - exit 0.
  This is the path that exercises the workspace subpath resolution, because the web `build` script itself first runs `pnpm --filter @fxl-sales/web^... build` to build `shared-types` and `shared-utils`, then `tsc --noEmit`, then `vite build`.
  All three stages passed from a cold clone with no prior build artifacts.
- `pnpm --filter @fxl-sales/api build` in the clone: exit 0, and `apps/api/dist/server.js` exists.

The clone was deleted afterwards.

One incidental finding from the clone, which is also the answer to check 5 below: the clone's `node_modules/.pnpm` contains exactly four relevant entries - `hono@4.12.28`, `@fxl-business+hub-sdk@1.3.1_hono@4.12.28`, `@hono+node-server@1.19.14_hono@4.12.28` and `@hono+zod-validator@0.5.0_hono@4.12.28_zod@3.25.76`.
The developer machine's store still holds stale unpruned directories from earlier installs (`hub-sdk@1.2.0`, `hub-sdk@1.3.0`, two `hub-sdk@1.3.0_patch_hash=...` variants, `hono@4.12.25`).
Those are store garbage, not graph members - `pnpm ls -r --depth 0` on the developer machine resolves 1.3.1 for both apps, and the clean clone proves a fresh install produces none of them.
No action needed, but do not be alarmed by them.

## Migration safety from a real v2.5.0 database

Not tested against the already-migrated dev database.
A throwaway database `fxl_rv_v270` was created on the local Docker instance, owned by a purpose-made `fxl_rv_owner` role created `NOSUPERUSER NOBYPASSRLS`.
That role choice matters: `sales_ops_areas`, `sales_ops_funcoes`, `sales_ops_people`, `sales_ops_products` and `hub_bff_sessions` all carry FORCE ROW LEVEL SECURITY (verified: `relforcerowsecurity = t` on all five), so a superuser connection would silently bypass the exact policy path both backfills are written to survive.
Running as a non-superuser owner is the honest reproduction of a production migration role.

Sequence:

1. `runDatabaseMigrations({ throughTag: '0019_audit_log_org_history_idx' })`, which is the migration head at `v2.5.0`. Exit 0, 20 migrations applied including the phased `0018`.
2. Seeded realistic pre-existing production rows: an área, a função, a pessoa and a produto all archived long ago (`created_at` 400 to 700 days back), an active área and the system `vendedor` função as controls, plus two `hub_bff_sessions` rows - one created 5 days ago and one created 200 days ago as an adversarial case.
3. `runDatabaseMigrations()` with no `throughTag`. Exit 0. Both `0020_cadastro_archived_at` and `0021_hub_session_absolute_ttl` applied as `ordinary-commit` phases. Journal count went from 20 to 22.

The runner applies every statement of an ordinary migration inside ONE transaction, so the transaction-local `SELECT set_config('app.fxl_admin', 'true', true)` that both migrations issue really does cover the `UPDATE` statements that follow it across the `--> statement-breakpoint` boundaries.
That is why both backfills matched rows rather than silently matching zero under FORCE RLS.

### 0021 - `absolute_expires_at`

Confirmed as required:

- Column definition after migration: `is_nullable = NO`, `column_default = NULL`, type `timestamp with time zone`.
  NOT NULL with no default is what makes an uncapped session unrepresentable, exactly as the migration's own comment claims.
- The backfill cannot fail on pre-existing rows. `created_at` has been `NOT NULL DEFAULT now()` since `0016`, so `created_at + interval '90 days'` is never NULL for any row that can exist, and the `SET NOT NULL` that follows therefore cannot find a NULL to reject.
  Both seeded rows received a value exactly 90 days after their own `created_at`.
- `hub_bff_sessions_absolute_expires_at_idx` was created, which is the index the sweeper's `expires_at <= now OR absolute_expires_at <= now` needs for its second branch.

The one nuance worth stating plainly.
The 200-day-old adversarial row was backfilled to a timestamp in the PAST and would die on its next access.
That is the shelf-life caveat the migration documents in its own header, and it does not apply here: `0016_hub_bff_session_store` is stamped `2026-08-03`, production reached `v2.5.0` on `2026-08-06`, and today is `2026-08-10`.
The oldest session row that can exist in production is therefore about four days old and will be backfilled to roughly `2026-11-03`, months in the future.
No production session is logged out by this backfill.
The migration's warning to re-check if it slips past `2026-11-01` is accurate and is being shipped comfortably inside its window.

### 0020 - `archived_at`

Confirmed as required.
All four pre-existing archived rows - including a produto archived 690 days ago - were stamped with the identical migration-time `now()` value, and the active rows were left NULL.
Ages measured immediately after the migration were 13 seconds, not 690 days.

## Purge day-one analysis

The retention predicate in `apps/api/src/domains/sales-ops/purge-service.ts` is `pastRetention`, which emits `archived_at < now() - make_interval(days => 30)` with `ARCHIVED_CADASTRO_RETENTION_DAYS = 30`.
It reads the DATABASE clock, not the app clock, and it is stated in exactly one place that all four specs and the under-lock re-check share, so a scan and its re-check cannot disagree.

I did not take this on trust.
Against the freshly-migrated database described above, I ran the real `purgeArchivedCadastros` through the real Drizzle admin-style connection:

```
REPORT {"produto":{"purged":0,"skipped":0,"failed":0},
        "pessoa": {"purged":0,"skipped":0,"failed":0},
        "funcao": {"purged":0,"skipped":0,"failed":0},
        "area":   {"purged":0,"skipped":0,"failed":0}}
```

Zero purged and zero even considered, on a database whose archived rows are 400 to 700 days old in real terms.
That is the property that makes the destructive job safe to ship: `0020` resets every existing row's clock to deploy time.

To prove the predicate is live rather than inert, I then walked the boundary on the same database:

- `archived_at = now() - 29 days` - all four counts still zero.
- `archived_at = now() - 31 days` - one produto, one pessoa, one função and one área purged, each with a `cadastro.purged` ledger entry carrying `actor_user_id = 'system'` and `actor_org_id = 'org-a'`, which is the purged row's own org and not NULL.
  The system `vendedor` função survived, as its `is_system = false` filter requires.

I could not construct a case where a row is immediately purgeable in a freshly-migrated production database. The three routes I looked for are all closed:

- A NULL `archived_at` makes the SQL comparison NULL, which is not true, so the row is never selected. Verified directly - the active área and the system função were absent from every candidate set.
- An archived row can only acquire a past `archived_at` through `archivedAtPatch` in the sales-ops service, which writes `new Date()` on the archive transition and NULL on restore. It is derived from the same `cadastroLifecycleEvent` classification the ledger uses, so a rename that resubmits the current status is not a transition and leaves the stamp untouched - re-saving an archived cadastro cannot restart or backdate its window.
- A row inserted directly in the archived state carries a NULL stamp and is therefore permanently unpurgeable, which is the safe direction.

The only theoretical path to an instantly-purgeable row is a container clock running more than 30 days behind the database, because `archivedAtPatch` uses the app clock while the predicate uses the database clock.
On NTP-synced containers that is not a real scenario, and it is called out here for completeness rather than as a concern.

The first purge cannot run before 03:30 UTC on the night after deploy anyway, and the FK topology remains the second safety net (see below).

## Security findings

Nothing found. Each item checked explicitly against `v2.5.0^{}..df0590d`.

- **No secret, key, token or credential added.** A pattern scan over added source, config and JSON lines returned only Drizzle snapshot column NAMES for tables that already existed (`secret_key_hash`, `secret_key_prefix`, `webhook_signing_secret`). No values.
- **No new env var, and no new startup requirement.** `apps/api/src/env.ts` and `.env.dev.example` are untouched by this release. The only added environment reads anywhere in non-test source are two `import.meta.env` reads in `apps/web/src/auth/react.tsx`, both feeding config loaders that already existed. Nothing new must be set in Infisical before this deploys.
- **No new raw SQL string interpolation.** Zero added `sql.raw`, `.unsafe(` or `execute(\`` occurrences in `apps/api/src`. The purge builds every predicate through Drizzle, and its one `sql` template interpolates only the numeric `ARCHIVED_CADASTRO_RETENTION_DAYS` constant into a `make_interval` parameter.
- **Tenant isolation intact.** Every `archivedAtPatch` call site sits inside an `UPDATE ... WHERE and(eq(table.orgId, orgId), eq(table.id, id))` that was already there. The purge runs cross-tenant on `getAdminDb()` by design, and its org scoping is the explicit `eq(table.orgId, target.orgId)` on every `SELECT` and every `DELETE`; the ledger entry carries the purged row's own `actor_org_id`, verified live. `apps/api/src/domains/audit/history-service.ts` still puts `eq(auditLog.actorOrgId, orgId)` first in its conditions array and still declares no org key in its query schema, so a smuggled `?orgId=` is unreadable.
- **No new `ON DELETE CASCADE`.** The diff contains the string only inside two comments. Queried live against the migrated database: `sale_items.product_id`, `sale_items.area_id`, `sale_items.sale_id`, `sales.seller_person_id`, `sales.finder_person_id`, `sales.client_id`, `sale_professionals.person_id`, `sale_professionals.sale_id` and `products.area_id` are all NO ACTION; `sale_professionals.funcao_id`, `person_funcoes.funcao_id` and `product_funcao_costs.funcao_id` are all RESTRICT. The only two CASCADE edges are `person_funcoes.person_id` and `product_funcao_costs.product_id`, which are the two CLAUDE.md already documents as the item's own configuration. The FK safety mechanism the purge relies on is fully intact.
- **`hub_bff_*` keeps FORCE RLS reached only through the admin connection.** Verified live: `hub_bff_sessions` and `hub_bff_login_txns` both report `relrowsecurity = t, relforcerowsecurity = t`, and `hub_bff_sessions` carries exactly one policy, `hub_bff_sessions_admin_context`, gated on `current_setting('app.fxl_admin', true) = 'true'`. `apps/api/src/auth/hub-session-store.ts` reaches the database only through `getAdminDb()`, and only from inside the store factory rather than at module scope. The `schema.ts` diff for these tables is purely additive - one new column and one new index, no policy change.
- **The session sealer is unchanged.** The diff moves `seal`/`open` call sites around as the store is ported to the async contract, but the sealing scheme, the row id as AEAD additional data, and the key derivation are all untouched. No key rotation is implied, so existing encrypted refresh tokens stay readable.

### Dependency patch state

Clean, on all four points asked:

- No `patches/` directory anywhere outside `node_modules`.
- No `patchedDependencies` key in `package.json`, `pnpm-workspace.yaml` or `pnpm-lock.yaml`.
- `@fxl-business/hub-sdk` resolves to `1.3.1` for both `@fxl-sales/api` and `@fxl-sales/web`.
- Exactly one `hono` resolves, `4.12.28`, held there by the `hono: 4.12.28` entry in `pnpm-workspace.yaml` overrides. The SDK declares `peerDependencies: { "hono": ">=4.12.28" }`, which `4.12.28` satisfies at the boundary.

## Version judgement

`v2.7.0` as a minor is correct.

Since `v2.6.0` there are 5 `feat` commits and no `BREAKING CHANGE` footer anywhere in the range:

- `1d0b0a0 feat(auth): port the Hub BFF session store to the SDK 1.3.0 transactional contract`
- `3303d8e feat(auth): suppress the auto re-login after an explicit Sair with a durable logout intent`
- `c5a44d6 feat(auth): bound a Hub BFF session with a 90-day absolute expiry`
- `f10668c feat(auth): classify refresh failures so only a 401 tears the session down`
- `27a5e40 feat(auth): supersede the session a browser presented when it logs in again`

Plus two `fix` commits (`1e3a20d` query-cache flush, `04bf215` hub-sdk 1.3.1 and patch removal).

I looked specifically for a breaking change the diff understates, and did not find one.

- No HTTP route was removed or changed shape. The only wire-contract movement is the new `cadastro.purged` value in `CADASTRO_LIFECYCLE_ACTIONS`, which is additive, and the web panel is updated in the same release.
- The SDK bump is internal. `apps/api/src/auth/hub-session-scope.ts` was deleted and `hub-login-scope.ts` added, but both are private modules behind `createAppAuthBff()`; `server.ts` still mounts `app.route('', authBff)`.
- The database changes are additive columns plus one index. No column dropped, no type narrowed on existing data.

**On the claim that the session-store change logs every user out once on deploy: it does not, and I checked rather than assumed.**
The `hub_bff_sessions` schema change is purely additive.
The session cookie names are unchanged (`fxl_hub_session` / `__Host-fxl_hub_session`, pinned in `hub-login-scope.ts` against the real SDK by `app-auth-bff-wiring.test.ts`).
The sealer and its key derivation are untouched, so existing sealed refresh tokens still open.
And the `0021` backfill puts every realistic production row's absolute ceiling in November, not in the past.
An existing session survives this deploy and keeps refreshing.
Since no forced logout happens, there is no forced-logout argument for going beyond a minor, and I would not inflate the bump on that basis.

The one thing in this promotion that genuinely changes an operator contract is not in the `v2.7.0` range at all: it is `v2.6.0`'s `413c97e`, which introduces the first hard delete this product has ever had.
"There is no DELETE verb" is still true of the HTTP API, but "nothing is ever deleted" stops being true of the system.
That was already cut as a minor and I am not arguing it should have been more, because the deletion is 30 days out, reversible until then, and refused by the database for anything a proposta references.
But the operator should be told about it in the release note rather than discovering it from a log line, and that is a communication item rather than a version item.

## Production risks the operator should know

Ordered by how likely they are to bite.

**1. Rolling-deploy window where old code meets new schema.** This is the sharpest edge in the release.
`apps/api/Dockerfile` ends with `CMD ["sh", "-c", "node dist/db/migrate.js && exec node dist/server.js"]`, so the NEW container applies `0021` before it starts serving.
`0021` adds `absolute_expires_at` as NOT NULL with NO default.
The `v2.5.0` code running in the OLD container inserts a session row without that column, because at `v2.5.0` the column does not exist.
So for the interval between the new container finishing its migration and the old container being retired, any user completing `/auth/callback` against the old container hits a not-null violation and fails to log in.
The blast radius is bounded and it is not data loss: only NEW logins during that window fail, existing sessions are unaffected because the refresh path is an UPDATE that never touches the column, and a retry after rollover succeeds.
If Coolify is configured to stop-then-start rather than roll, the window does not exist at all.
Worth watching the API logs for `23502` on `hub_bff_sessions` for the first few minutes after deploy, and worth telling anyone who reports "I could not log in right after the deploy" to simply try again.

**2. The nightly purge is now armed, and its first opportunity is 03:30 UTC.** It is genuinely inert on day one - proven above - but it is a destructive cross-tenant job running on a 5-connection admin pool, and it is the third of three cron tasks (03:00 hold promotion, 03:15 session sweep, 03:30 purge).
Its steady-state log line is `[nightly-job] archived cadastro purge (purged/skipped/failed): ...` and a healthy first month should read all zeros.
The first non-zero `purged` count will appear roughly 30 days after this deploy, on the first cadastro archived post-deploy that nothing references.
A non-zero `failed` count is a real fault and is deliberately never folded into `skipped`.

**3. The purge scan is unindexed.** Each of the four `due()` scans filters on `status` plus `archived_at`, and there is no index covering that pair on `sales_ops_products`, `sales_ops_people`, `sales_ops_areas` or `sales_ops_funcoes` - the existing indexes are on `(org_id, name)`, `(org_id, id)` and the code-suffix uniqueness.
So the job does four full sequential scans across every org, nightly, with no `LIMIT`.
At cadastro scale (products, people, areas, funcoes) this is negligible and it runs at 03:30, so it is a note rather than a problem. It becomes worth an index only if a tenant's cadastro tables reach six figures.

**4. `0021`'s safety argument expires.** The migration's own header says so, and it is correct: the `created_at + 90 days` backfill is safe only while the oldest `hub_bff_sessions` row is under 90 days old.
Shipping today, four days after `v2.5.0` reached production, that has months of headroom.
If this release were held past `2026-11-01`, the backfill would start writing past timestamps and would log out the longest-lived sessions.
Ship it now, or re-verify if it slips.

**5. Nothing new is required in Infisical.** Explicitly checked because a missing env var is the classic painful-in-production discovery. `env.ts` and `.env.dev.example` are untouched by this release and no new `process.env` read was added on the API side. The API's boot path did not gain a new throw.

**6. Minor and cosmetic.** The `HUB_BFF_TIMEOUT_MS = 5_000` bound added in `app-auth.ts` is a new failure mode in the sense that a Hub round-trip slower than 5s now fails fast instead of hanging - which is the intent, since the round-trip happens inside a transaction holding a session row lock on a `max: 5` pool. If the Hub is ever degraded to the point of taking over 5 seconds, users will see auth failures sooner than they used to; that is better than the old behaviour of pinning the pool, but it will look like a new symptom. The `hubBffErrorHandler` `onError` turns a store outage into a `503 session_store_unavailable` rather than a bare 500, and deliberately does NOT let it read as "no session", which would have deleted the session cookie and logged everyone out over a database blip.

## Cleanup

The temporary clone was deleted.
The throwaway database `fxl_rv_v270` and the `fxl_rv_owner` role were dropped, verified by re-listing: only `fxl_sales` and `fxl_sales_test` remain.
The working tree is exactly as found - `git status --porcelain` reports only the pre-existing untracked `.vscode/`, and HEAD is still `df0590dac8252834a8593b2a508fad3c8a79e611`.
No process started by this verification is still running.
