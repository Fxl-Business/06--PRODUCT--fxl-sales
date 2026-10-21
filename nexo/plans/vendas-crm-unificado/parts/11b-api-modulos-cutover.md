# Part 11b-api-modulos-cutover of slice 11-api-modulos-org

Original frontmatter (for reference, not a slice):

```yaml
id: 11b-api-modulos-cutover
milestone: v4.8.0
status: todo
depends_on: ["11a-api-modulos-nucleo"]
files_modified: ["apps/api/src/middleware/require-capability.ts", "apps/api/src/middleware/app-auth.ts", "apps/api/src/middleware/auth.ts", "apps/api/src/domains/sales-ops/routes.ts", "apps/api/src/domains/sales-ops/leads/lead-routes.ts", "apps/api/src/middleware/__tests__/require-capability.test.ts", "apps/api/src/middleware/__tests__/edition-gate-map.test.ts", "apps/api/src/middleware/__tests__/app-auth.test.ts", "apps/api/src/auth/__tests__/dev-identity-no-hub.test.ts", "apps/api/src/domains/sales-ops/leads/__tests__/lead-routes-edition.test.ts", "apps/api/src/domains/sales-ops/__tests__/people-routes-edition.test.ts", "apps/api/src/domains/import/__tests__/import-routes.integration.test.ts"]
affected_tests: [
  {path: apps/api/src/middleware/__tests__/edition-gate-map.test.ts, impact: "the gate now reads modules through the loader; the fake DB must stay unreachable so the loader is mocked", update: "add one vi.mock; no route list or assertion weakened", command: "pnpm --filter @fxl-sales/api exec vitest run src/middleware/__tests__/edition-gate-map.test.ts", owner: builder},
  {path: apps/api/src/middleware/__tests__/require-capability.test.ts, impact: "hand-built context sets orgModules instead of salesEdition", update: "rewrite appFor; keep every case", command: "pnpm --filter @fxl-sales/api exec vitest run src/middleware/__tests__/require-capability.test.ts", owner: builder},
  {path: apps/api/src/middleware/__tests__/app-auth.test.ts, impact: "applyHubAuthContext no longer resolves an edition", update: "replace the describe at lines ~178-216", command: "pnpm --filter @fxl-sales/api exec vitest run src/middleware/__tests__/app-auth.test.ts", owner: builder},
  {path: apps/api/src/auth/__tests__/dev-identity-no-hub.test.ts, impact: "its probe read c.get('salesEdition')", update: "probe awaits getSalesEdition with the loader mocked", command: "pnpm --filter @fxl-sales/api exec vitest run src/auth/__tests__/dev-identity-no-hub.test.ts", owner: builder},
  {path: apps/api/src/domains/sales-ops/leads/__tests__/lead-routes-edition.test.ts, impact: "sets salesEdition on a hand-built context", update: "set orgModules", command: "pnpm --filter @fxl-sales/api exec vitest run src/domains/sales-ops/leads/__tests__/lead-routes-edition.test.ts", owner: builder},
  {path: apps/api/src/domains/sales-ops/__tests__/people-routes-edition.test.ts, impact: "sets salesEdition on a hand-built context", update: "set orgModules", command: "pnpm --filter @fxl-sales/api exec vitest run src/domains/sales-ops/__tests__/people-routes-edition.test.ts", owner: builder},
  {path: apps/api/src/domains/import/__tests__/import-routes.integration.test.ts, impact: "sets salesEdition on a hand-built context", update: "set orgModules", command: "pnpm --filter @fxl-sales/api exec env VITEST_INTEGRATION=1 vitest run src/domains/import/__tests__/import-routes.integration.test.ts", owner: builder}
]
acceptance: "given the leads token module and no module rows, when any capability-gated route is called, then the gate answers exactly today's 403 for proposals/commissions/catalog/finders/history and passes clients/import, with one modules query per request; a full token is unchanged"
goal: "Cut requireCapability and every c.get('salesEdition') reader over to the per-org modules, with the token read only by the one-time backfill, and keep every edition oracle green"
must_not_break: ["edition-gate-map.test.ts stays exhaustive and un-weakened: every GATED/OPEN/LEADS_GRANTED case and the byte-exact 403 body", "EDITION_CAPABILITY_BODY is byte-identical", "the access gate (requireHubAuth, 401/402/403 taxonomy) is untouched", "app-auth-access-gate.test.ts still drives the REAL verifier", "no-legacy-*, hub-sdk-pin, fxl-contracts-pin guards"]
rules: ["Never use the em dash; use '-'", "A missing modules value is never a reason to deny: a context with neither orgModules nor hubAuth is all modules (fail to full), a store error THROWS (fail closed)", "No service reads the Hono context; routes pass the edition or modules as an argument", "Do not mock getDb in a test to dodge the loader; preset orgModules or mock the loader module", "No migration"]
verifier_focus: "Run edition-gate-map, require-capability, app-auth, dev-identity, the whole API unit suite, and the import integration test; grep that nothing reads c.get('salesEdition') or imports resolveSalesEdition outside the org-modules service and tests; confirm the 403 body is unchanged"
oracle: "apps/api/src/middleware/__tests__/edition-gate-map.test.ts"
```

# 11b - Cutover: requireCapability and edition readers on per-org modules (phase 3, API)

## Context (verified against the tree before phase 2; RE-GREP after slice 10a/10b)

- `apps/api/src/middleware/require-capability.ts`: `requireCapability(capability)` reads `c.get('salesEdition') ?? 'full'` and `hasCapability(edition, capability)`; body `EDITION_CAPABILITY_BODY = { error: 'forbidden', code: 'edition_capability' }`.
- `apps/api/src/middleware/app-auth.ts:13` imports `resolveSalesEdition`; `applyHubAuthContext` (~line 270-277) ends with `c.set('salesEdition', resolveSalesEdition(auth.entitlements?.modules));`. Its doc comment (lines ~253-263) describes the edition resolution.
- `apps/api/src/middleware/auth.ts:2,15` declares `salesEdition: SalesEdition` on `ContextVariableMap`.
- Readers of `c.get('salesEdition')`: `domains/sales-ops/routes.ts` (POST `/people` ~line 129, PATCH `/people/:id` ~line 145), `domains/sales-ops/leads/lead-routes.ts` (`leadScope` ~line 88, `usesContactFields` ~line 98, called from ~9 handlers). Phase 2 (10a) rewrites `lead-routes.ts`: re-run `grep -rn "salesEdition" apps/api/src | grep -v __tests__` and convert EVERY hit by the rule in Design 3.
- The gated routers: `salesOpsRouter.use('/summary/*' ... '/history/*', requireCapability(...))` (routes.ts lines 82-92) plus inline `PUT /settings`, and `commissions`, `payouts`, `payoutsAdmin`, `commissionsAdmin`, `links`, `finder` routers (`router.use('*', requireCapability(...))` as their first registration). They are NOT edited.
- Tests that set the edition by hand: `require-capability.test.ts:31,74`, `lead-routes-edition.test.ts:82`, `people-routes-edition.test.ts:66`, `import-routes.integration.test.ts:115` (`c.set('salesEdition', ...)`), probes in `app-auth.test.ts:182-214` and `dev-identity-no-hub.test.ts:73,230-271`.
- `edition-gate-map.test.ts` mocks `../../db/client.js` with a Proxy that throws on first use and asserts `dbCalls.count === 0` for every gated denial; it mounts the real `appAuthMiddleware` with real signed tokens whose `entitlements.modules` is `['sales.edition.leads']`, `[]` or `['sales.some-other-addon']`, workspace `org_edition_gate`.

## Design (decided)

1. `requireCapability(capability)`: `const modules = await getOrgModules(c); if (!modulesAllowCapability(modules, capability)) return c.json(EDITION_CAPABILITY_BODY, 403); return next();`. The code `edition_capability` and the body are KEPT byte for byte (the web and the logs key on it); its meaning becomes "the organization's modules do not include this".
2. `applyHubAuthContext` stops resolving anything about the edition. The token's `entitlements.modules` is read by exactly one place: `loadOrgModules` (the backfill). `resolveSalesEdition` is still exported from shared-utils and used by the backfill only.
3. Readers: every `c.get('salesEdition') ?? 'full'` becomes `await getSalesEdition(c)` (the projection `orcamentos off => 'leads'`). A synchronous helper that read it (`leadScope`, `usesContactFields`) becomes `async` and its call sites `await` it; pass the awaited value down exactly as before - no service reads the context.
4. `ContextVariableMap` drops `salesEdition` and gains `orgModules: OrgModules` (set lazily by `getOrgModules`, or by a test).
5. One query per request: the first `getOrgModules(c)` memoizes on the context; later gates and readers reuse it.
6. `edition-gate-map.test.ts` keeps the Proxy DB (so a handler reached is still detectable) and adds ONE module mock for the loader that reproduces what the real loader returns for a never-seen org: `modulesForEdition(resolveSalesEdition(tokenModules))`. Gated denials still cost zero DB calls; this is the "update the source of truth, never weaken" rule.

## Steps (TDD)

1. Edit the tests first (Tests below). Run them: `require-capability`, `app-auth`, `dev-identity` and the three set-by-hand tests fail to compile/run against the old code (expected RED).
2. Production edits:
   a. `middleware/auth.ts`: replace the import `import type { SalesEdition } from '@fxl-sales/shared-utils/sales-edition';` with `import type { OrgModules } from '@fxl-sales/shared-utils/crm-model';` and the `salesEdition: SalesEdition;` member (with its doc comment) by:
      ```ts
      /**
       * The ACTIVE organization's module flags, loaded lazily (one query per request) by
       * `getOrgModules` in `domains/org-modules/context.ts` from `sales_ops_org_modules`.
       * Read it through `requireCapability` or `getSalesEdition`, never from the token.
       */
      orgModules: OrgModules;
      ```
   b. `middleware/app-auth.ts`: delete the import line 13 and the `c.set('salesEdition', ...)` line; rewrite the paragraph of the `applyHubAuthContext` doc comment that says "It is also the ONE place the Sales edition is resolved ..." to: "It resolves NO edition and NO modules. `entitlements.modules` is read only by `loadOrgModules` (domains/org-modules/service.ts), once per organization, to seed `sales_ops_org_modules`; after that the database decides. Baseline access is still `entitlements.access`, decided by `requireHubAuth` before this function runs."
   c. `domains/org-modules/context.ts`: replace the `Loose` accessor by the typed one: `const preset = c.get('orgModules'); if (preset) return preset;` ... `c.set('orgModules', state.modules);` and read `c.get('hubAuth')` / `c.get('orgId')` typed. Delete `Loose` and `KEY`.
   d. `middleware/require-capability.ts`: replace the body per Design 1; imports `modulesAllowCapability` from `@fxl-sales/shared-utils/crm-model` and `SalesCapability` type from `@fxl-sales/shared-utils/sales-edition`, `getOrgModules` from `../domains/org-modules/context.js`. Replace the doc comment's last paragraph ("What it narrows is the product surface of the organization's edition...") with: "What it narrows is the product surface of the organization's MODULES, read from `sales_ops_org_modules` through `getOrgModules` (one query per request, backfilled once from the token for an org with no rows). A context that never loaded modules and carries no Hub context is all modules, so this gate can never take a capability away from an unmarked org."
   e. `domains/sales-ops/routes.ts`: add `import { getSalesEdition } from '../org-modules/context.js';` and in the two people handlers replace `const edition = c.get('salesEdition') ?? 'full';` by `const edition = await getSalesEdition(c);`. Update the comment block above the gates (lines ~70-78): "The capability set per org lives in `sales_ops_org_modules`; `CAPABILITY_MODULES` in `@fxl-sales/shared-utils/crm-model` maps each capability to its modules."
   f. `domains/sales-ops/leads/lead-routes.ts` (and any other hit of the grep): make `leadScope` `async` (`const edition = await getSalesEdition(c);` then the same object), `usesContactFields` `async`, and `await` them at every call site (`const scope = await leadScope(c)`; `leadScope(c).isAdmin` becomes `(await leadScope(c)).isAdmin`). Keep every service call otherwise byte-identical.
3. Run RED tests, now GREEN. Then the whole API unit suite: `pnpm --filter @fxl-sales/api test`. For any other unit test that mounts a router with a `hubAuth` on the context and now reaches the loader (and so a real `getDb()`), preset `c.set('orgModules', ALL_MODULES_ENABLED)` (or `modulesForEdition(...)`) in its hand-built middleware. Never mock `getDb` for this.
4. Run integration import test, lint, type-check, guards.

## Tests

- `require-capability.test.ts`: change `appFor(edition, capability)` so the middleware does `if (edition !== undefined) c.set('orgModules', modulesForEdition(edition))` (import `modulesForEdition` from `@fxl-sales/shared-utils/crm-model`) and the second hand-built context at line ~74 likewise. Every existing case keeps its name and assertion (byte-exact body, leads refused 6 capabilities and granted `clients`/`import`, full passes all, missing edition treated as full). Add:
  - `it('a toggled flag changes the answer: leads modules plus comissoes passes commissions')`: `{...modulesForEdition('leads'), comissoes: true}` -> 200 for `commissions`, 403 for `proposals`.
  - `it('a capability needing two modules is refused when one is off')`: no such capability exists today, so assert instead `{...ALL_MODULES_ENABLED, catalogo:false}` refuses `catalog` and `leadFullFields` and passes `proposals`.
  - `it('loads the modules once per request even behind two gates')`: `vi.mock('../../domains/org-modules/service.js', () => ({ loadOrgModules: vi.fn(async () => ({ modules: ALL_MODULES_ENABLED, sources: {} })) }))` (use `vi.hoisted` for the shared fn); a Hono app with a middleware setting `hubAuth = { entitlements: { modules: [] } }` and `orgId = 'org_x'`, then `app.get('/p', requireCapability('proposals'), requireCapability('clients'), handler)`; request once; `loadOrgModules` toHaveBeenCalledTimes(1).
  - `it('a store failure is not a denial and not a pass')`: `loadOrgModules` rejects; the request answers 500 (app `onError` returns 500) and the handler is not reached.
- `edition-gate-map.test.ts`: add after the existing `vi.mock('../../db/client.js', ...)`:
  ```ts
  vi.mock('../../domains/org-modules/service.js', async () => {
    const { CRM_MODULE_KEYS, modulesForEdition } = await import('@fxl-sales/shared-utils/crm-model');
    const { resolveSalesEdition } = await import('@fxl-sales/shared-utils/sales-edition');
    return {
      // What the real loader returns for a never-seen org: the one-time token backfill.
      loadOrgModules: async (_orgId: string, tokenModules: readonly unknown[] | undefined) => {
        const modules = modulesForEdition(resolveSalesEdition(tokenModules));
        return {
          modules,
          sources: Object.fromEntries(CRM_MODULE_KEYS.map((key) => [key, 'token_backfill'])),
        };
      },
      updateOrgModules: async () => {
        throw new Error('edition-gate-map: updateOrgModules reached');
      },
    };
  });
  ```
  Change the header comment's first paragraph by one sentence: "The module loader is mocked (it would otherwise be the first database use) with the token backfill it performs for a never-seen org." Do NOT touch GATED, OPEN, LEADS_GRANTED or any assertion.
- `app-auth.test.ts`: replace the `describe('applyHubAuthContext resolves the sales edition once', ...)` block (lines ~178-216) by `describe('applyHubAuthContext resolves no edition and no modules', ...)` with the same `probe` helper but the handler returns `{ orgModules: c.get('orgModules') ?? null, orgId: c.get('orgId') }`; cases: modules `[]`, `['sales.edition.leads']`, `['sales.some-other-addon']` and `undefined` each give `orgModules === null` (lazy: nothing loaded, no DB touched); `tenancy is unchanged` keeps `orgId === 'org_active_1'`. The token-to-edition table that used to live here is now covered by `test/rls/org-modules.test.ts` case 3 (11a).
- `dev-identity-no-hub.test.ts`: at the top add `vi.mock('../../domains/org-modules/service.js', async () => { ...same factory as the gate-map mock, loadOrgModules only... })` (ensure `vi` is imported from vitest). In the `/probe` handler (line ~64-75) make the callback `async (c) =>` and replace `salesEdition: c.get('salesEdition')` by `salesEdition: await getSalesEdition(c)` with `const { getSalesEdition } = await import('../../domains/org-modules/context.js');` resolved in `beforeAll` next to `appAuth`. Test names and assertions (`resolveSalesEdition(identity.modules)`, `'full'` for the roster, `'leads'` for the two leads identities) stay unchanged: they now prove the dev identity's module claim reaches the backfill.
- `lead-routes-edition.test.ts:82`, `people-routes-edition.test.ts:66`, `import-routes.integration.test.ts:115`: replace `c.set('salesEdition', X)` by `c.set('orgModules', modulesForEdition(X))` (add the import). The comment at the top of `lead-routes-edition.test.ts` that says "the `salesEdition` the auth middleware resolves from the VERIFIED token" becomes "the modules the loader resolves for the organization".

## Commands

- Oracle: `pnpm --filter @fxl-sales/api exec vitest run src/middleware/__tests__/edition-gate-map.test.ts`
- Focused: the `affected_tests` commands above; then `pnpm --filter @fxl-sales/api test` (whole unit suite) and the import integration command.
- `grep -rn "salesEdition'" apps/api/src | grep -v __tests__` must print nothing; `grep -rn "resolveSalesEdition" apps/api/src | grep -v __tests__` prints only `domains/org-modules/service.ts`.
- `pnpm --filter @fxl-sales/api lint`, `pnpm --filter @fxl-sales/api type-check` (also compiles the tests via `tsconfig.test.json`).
- Guards: `node --test scripts/__tests__/hub-sdk-pin.test.mjs scripts/__tests__/fxl-contracts-pin.test.mjs scripts/__tests__/no-legacy-auth.test.mjs scripts/__tests__/no-legacy-env-names.test.mjs scripts/__tests__/auth-fake-isolation.test.mjs`.

## Risks

- Latency: every authenticated sales-ops request now pays one extra tenant transaction. Accepted (the request asked for per-request, not cross-request, caching so a toggle needs no redeploy and no invalidation).
- A forgotten reader that still calls `c.get('salesEdition')` would be a TypeScript error after step 2a (the member is gone); that is the intended net.
- dev-fake: the `leads-owner`/`leads-seller` identities backfill into the LOCAL database on their first request; `make db-reset` clears it. Document in 11c.
