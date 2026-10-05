---
id: 02-api-edition-gate
milestone: v4.3.0
status: todo
depends_on: [01-edition-contract]
files_modified:
  - apps/api/src/middleware/require-capability.ts
  - apps/api/src/middleware/app-auth.ts
  - apps/api/src/middleware/auth.ts
  - apps/api/src/domains/sales-ops/routes.ts
  - apps/api/src/domains/commissions/routes.ts
  - apps/api/src/domains/payouts/routes.ts
  - apps/api/src/domains/finder/routes.ts
  - apps/api/src/domains/links/routes.ts
  - apps/api/src/middleware/__tests__/require-capability.test.ts
  - apps/api/src/middleware/__tests__/edition-gate-map.test.ts
  - apps/api/src/middleware/__tests__/app-auth.test.ts
  - apps/api/src/auth/__tests__/dev-identity-no-hub.test.ts
  - nexo/knowledge/reference/auth-model.md
  - CLAUDE.md
acceptance: "applyHubAuthContext sets c.get('salesEdition') from resolveSalesEdition(auth.entitlements?.modules) on both the Hub path and the development adapter path; requireCapability answers 403 with the byte-exact body {\"error\":\"forbidden\",\"code\":\"edition_capability\"} only when the edition lacks the capability and treats a missing edition as 'full'; through the REAL SDK verifier and the server.ts mount shapes, a token carrying modules ['sales.edition.leads'] gets that 403 on every route of the gate map and never gets it on any open route, while a token with modules [] or an unrelated add-on module never gets it on any route; every route registered on the seven gated routers is enumerated by the oracle (no unclassified route)."
goal: "Resolve the Sales edition once per request in applyHubAuthContext, type it on the Hono context, and guard every route group of the SEAM-CONTRACT gate map with requireCapability, a CAPABILITY gate that sits behind the one ACCESS gate (requireHubAuth) and is invisible to the full edition, so FXL changes nothing."
must_not_break:
  - "pnpm --filter @fxl-sales/api test (whole unit suite, unchanged files stay green)"
  - "pnpm --filter @fxl-sales/api lint"
  - "pnpm --filter @fxl-sales/api type-check (tsconfig.json, tsconfig.scripts.json, tsconfig.test.json)"
  - apps/api/src/middleware/__tests__/app-auth-access-gate.test.ts
  - apps/api/src/domains/sellers/__tests__/seller-routes-admin-gate.test.ts
  - apps/api/src/domains/sales-ops/__tests__/financial-admin-gate.test.ts
  - apps/api/src/domains/sales-ops/__tests__/routes.test.ts
  - apps/api/src/domains/sales-ops/__tests__/history-route.test.ts
  - apps/api/src/domains/sales-ops/__tests__/transition-routes.test.ts
  - apps/api/src/domains/import/__tests__/import-routes.test.ts
  - scripts/__tests__/auth-fake-isolation.test.mjs
  - scripts/__tests__/hub-sdk-pin.test.mjs
  - "pnpm --filter @fxl-sales/api test:integration (wave level; settlements and import route integration files mount salesOpsRouter with no salesEdition and must stay green)"
oracle: apps/api/src/middleware/__tests__/edition-gate-map.test.ts
rules:
  - "requireHubAuth stays the ONE access gate. Do not touch its call, its options, allowWithoutAccess, requiredModule, or hubAppAuthMiddleware. requireCapability is a capability gate mounted BEHIND appAuthMiddleware and never decides access."
  - "applyHubAuthContext is the ONLY place in apps/api that reads entitlements.modules. No route, service or middleware other than it may read modules or call resolveSalesEdition."
  - "Import the edition module ONLY through the subpath '@fxl-sales/shared-utils/sales-edition', never the package root."
  - "Never read the edition from a body, a query string, a header or process.env."
  - "requireCapability treats c.get('salesEdition') === undefined as 'full'."
  - "Every gate registration must come BEFORE the first route handler of its router (Hono runs matched handlers in registration order; a use() registered after a handler never runs before it, verified while planning)."
  - "server.ts is NOT edited. The gates live on the routers so they travel with every mount."
  - "No em dash in any file; relative imports use the `.js` extension (NodeNext)."
verifier_focus: "That the gate map in edition-gate-map.test.ts is enumerated from router.routes (set equality), so a route nobody classified fails the suite; that tokens are signed and verified by the REAL SDK (no stubbed requireHubAuth); that the full-edition pass covers every gated route; that open routes in the leads edition really reach their handler or validation (not a vacuous pass); that PUT /settings is gated while GET /settings is not; and that applyHubAuthContext is reached by the dev adapter (select.ts calls appAuth.applyHubAuthContext)."
---

# Slice 02 - API edition gate

## Objective

After this slice every authenticated request carries `c.get('salesEdition')`, resolved once from the verified token, and every proposta-, comissão-, baixa-, catálogo-, importação-, histórico- and finder-shaped route answers `403 {"error":"forbidden","code":"edition_capability"}` for a leads-edition organization.
For an organization whose token carries no edition module (FXL today) nothing changes: the gate passes on every route, proven by an oracle that drives the real SDK verifier.

## Code facts (verified while planning)

- `applyHubAuthContext(c, auth, next)` in `apps/api/src/middleware/app-auth.ts` sets `hubAuth`, `userId`, `orgId`, `userRole`, `userRoles`, then `await next()`.
  It is called by `hubAppAuthMiddleware` (real Hub path) AND by the development adapter: `buildFakeAuthMiddleware` in `apps/api/src/auth/select.ts` ends with `await appAuth.applyHubAuthContext(c, auth, next);` where `auth = fake.toHubAuthContext(identity, ...)`, whose `entitlements` is `{ access, modules: [...identity.modules] }`.
  So setting the edition inside `applyHubAuthContext` covers both adapters with no change to `select.ts`.
- SDK 2.5.0 `HubAuthContext` has a REQUIRED top-level `entitlements: { access: boolean; modules: string[] }` (same object as `claims.entitlements`).
  `requireHubAuth` without `requiredModule` ignores `modules`, so a token with `modules: ['sales.edition.leads']` and `access: true` passes the access gate unchanged.
- The Hono context variables `userId`, `orgId`, `userRole`, `userRoles` are declared in ONE place: the `declare module 'hono' { interface ContextVariableMap { ... } }` block in `apps/api/src/middleware/auth.ts`.
  (`app-auth.ts` declares only `hubAuth?`; `conversions/hmac-middleware.ts` declares its own unrelated key.)
- `tsconfig.base.json`: `exactOptionalPropertyTypes: false`, `noUncheckedIndexedAccess: true`, NodeNext.
  ESLint is the non-type-checked recommended set plus `no-explicit-any: error`, so `c.get('salesEdition') ?? 'full'` on a non-optional type is legal.
- `@fxl-sales/shared-utils` is already a `workspace:*` dependency of `apps/api`; its subpaths resolve to `packages/shared-utils/dist` (gitignored), built by `pnpm run build:packages`.
- Mounts in `apps/api/src/server.ts` (unchanged by this slice):
  - `app.use('/api/v1/admin/commissions/*', appAuthMiddleware, requireAdmin); app.route('/api/v1/admin/commissions', commissionsAdminRouter);`
  - `app.use('/api/v1/commissions/*', appAuthMiddleware); app.route('/api/v1/commissions', commissionsRouter);`
  - `app.use('/api/v1/admin/payouts/*', appAuthMiddleware, requireAdmin); app.route('/api/v1/admin/payouts', payoutsAdminRouter);`
  - `app.use('/api/v1/payouts/*', appAuthMiddleware); app.route('/api/v1/payouts', payoutsRouter);`
  - `app.use('/api/v1/sales-ops/*', appAuthMiddleware); app.route('/api/v1/sales-ops', salesOpsRouter);`
  - `app.use('/api/v1/links/*', appAuthMiddleware); app.route('/api/v1/links', linksRouter);`
  - `app.use('/api/v1/finder/*', appAuthMiddleware); app.route('/api/v1/finder', finderRouter);`
  - Each of those routers is mounted exactly once, only in `server.ts`.
- `salesOpsRouter` (`apps/api/src/domains/sales-ops/routes.ts`) registers, in this order: `GET /bootstrap`, `GET /summary`, `GET|POST /people`, `PATCH /people/:id`, `GET|POST /products`, `PATCH /products/:id`, `GET|POST /clients`, `PATCH /clients/:id`, `GET|POST /areas`, `PATCH /areas/:id`, `GET|POST /funcoes`, `PATCH /funcoes/:id`, `route('/', leadStagesRouter)`, `route('/leads', leadsRouter)`, `route('/import', importRouter)`, `GET|POST /sales`, `POST /sales/:id/transition`, `POST /sales/:id/cancel-contract`, `PUT /sales/:id`, `POST /settlements`, `POST /settlements/:id/reverse`, `GET /sales/:id/settlements`, `GET /settings`, `PUT /settings`, `GET /history`.
  - `leadStagesRouter`: `GET /lead-stages`, `POST /lead-stages/reorder`, `POST /lead-stages`, `PATCH /lead-stages/:id`.
  - `leadsRouter` (mounted at `/leads`): `GET /`, `POST /`, `GET /:id`, `PATCH /:id`, `POST /:id/move`, which appear in `salesOpsRouter.routes` as `/leads`, `/leads/:id`, `/leads/:id/move`.
  - `importRouter`: `GET /template`, `POST /preview`, `POST /commit` (each with `requireAdmin` inline).
- Other gated routers: `commissionsRouter` `GET /`; `commissionsAdminRouter` `GET /`, `POST /promote-locked`, `POST /:commissionId/lock`, `POST /:commissionId/reverse`; `payoutsRouter` `GET /`; `payoutsAdminRouter` `GET /`, `POST /`, `POST /:payoutId/mark-paid`, `GET /finders-ready`, `POST /batches`, `GET /batches/:id/csv`; `finderRouter` `GET /apps`, `GET /apps/:appId/products`, `GET /clicks`, `GET /clicks/stats`; `linksRouter` `POST /`, `GET /`, `DELETE /:linkId`.
- Hono 4.12.28 path semantics (probed while planning):
  - `use('/sales/*')` matches `/sales`, `/sales/x/y`, and does NOT match `/sales-x`.
  - `use('*')` on a sub-router mounted at `/api/v1/links` matches `/api/v1/links` and `/api/v1/links/...` only.
  - A `use()` registered AFTER a handler for the same path never runs before that handler.
  - `router.routes` lists one entry per handler (`{ method, path }`); `use()` entries have `method: 'ALL'`; a route with two handlers appears twice; sub-router mounts are flattened (`route('/leads', r)` with `r.get('/')` lists `GET /leads`).
- Existing test patterns reused here:
  - Real verifier: `app-auth-access-gate.test.ts` and `seller-routes-admin-gate.test.ts` generate an RS256 keypair, stub `fetch` for `${HUB_API_URL}/.well-known/oauth-authorization-server` and `/.well-known/jwks.json`, stub the Hub env, `vi.resetModules()`, then dynamically import the modules.
  - DB mock: `vi.mock('<rel>/db/client.js', () => ({ getAdminDb, getDb, closeDb, resolveAdminDatabaseUrl }))` (the four exports of `db/client.ts`).
  - `apps/api/src/auth/__tests__/hub-auth-context-fixture.ts` exports `hubAuthContext(overrides)` with deep `entitlements` overrides.
  - `app-auth.test.ts` blanks the six Hub names in `vi.hoisted` and imports `../app-auth.js` at module scope.
  - `dev-identity-no-hub.test.ts` installs the real dev adapter (`SALES_AUTH_FAKE=1`) and exposes a `/probe` route that echoes context variables.
- Unit tests that mount `salesOpsRouter` (or other gated routers) behind a hand-built context set no `salesEdition`; with the missing-means-full rule they keep passing unchanged, which is itself evidence for that rule.

## Step 0 - prerequisites

Slice 01 must be merged: `packages/shared-utils/src/sales-edition.ts` exists and `package.json` exports `./sales-edition`.
Build it once so `apps/api` can resolve the subpath:

```bash
pnpm run build:packages
```

## Step 1 - `apps/api/src/middleware/auth.ts` (context typing)

Add a type-only import at the top and one member to the existing `ContextVariableMap`:

```ts
import { sql, type SQL } from 'drizzle-orm';
import type { SalesEdition } from '@fxl-sales/shared-utils/sales-edition';

declare module 'hono' {
  interface ContextVariableMap {
    userId: string;
    orgId: string;
    userRole: string | undefined;
    userRoles: Array<'admin' | 'seller' | 'finder'>;
    /**
     * The Sales edition of the ACTIVE organization, resolved once per request by
     * `applyHubAuthContext` from the verified token's add-on modules. Read it
     * through `requireCapability` or `leadFieldSet`, never by re-reading modules.
     */
    salesEdition: SalesEdition;
  }
}
```

Nothing else in this file changes.

## Step 2 - `apps/api/src/middleware/app-auth.ts`

1. Add the import directly below the existing `import { env } from '../env.js';` line:

```ts
import { resolveSalesEdition } from '@fxl-sales/shared-utils/sales-edition';
```

2. In `applyHubAuthContext`, add one line after `c.set('userRoles', legacy.userRoles);` and before `await next();`, and extend the doc comment above the function with the paragraph shown:

```ts
/**
 * (existing paragraph unchanged)
 *
 * It is also the ONE place the Sales edition is resolved. `entitlements.modules`
 * is read here for an ADD-ON capability set, never for access: baseline access
 * is `entitlements.access`, decided by `requireHubAuth` (or the development
 * adapter's mirror of it) BEFORE this function runs, and nothing here can turn
 * a denied request into an allowed one. Absent, empty or unknown modules
 * resolve to 'full', which is today's product, so an organization the Hub never
 * marked keeps every capability. `requireCapability` reads the value this sets.
 */
export async function applyHubAuthContext(
  c: Context,
  auth: MinimalHubAuthContext,
  next: Next,
): Promise<void> {
  // The SDK already set this on the real path; the development adapter relies on this seam.
  c.set('hubAuth', auth);
  const legacy = getHubLegacyAuthContext(auth);
  c.set('userId', legacy.userId);
  c.set('orgId', legacy.orgId);
  c.set('userRole', legacy.userRole);
  c.set('userRoles', legacy.userRoles);
  c.set('salesEdition', resolveSalesEdition(auth.entitlements?.modules));
  await next();
}
```

Do not touch `hubAuthMiddleware`, `hubAppAuthMiddleware`, `requireHubAuth(hubSdkConfig)` or any BFF code.

## Step 3 - new file `apps/api/src/middleware/require-capability.ts`

Write exactly:

```ts
import type { MiddlewareHandler } from 'hono';
import { hasCapability, type SalesCapability } from '@fxl-sales/shared-utils/sales-edition';

/**
 * The one 403 body an edition-gated route answers. Distinct from the SDK's
 * `{"error":"forbidden"}` and from `ADMIN_ROLE_REQUIRED_BODY` so a client and a
 * log line can tell "your edition does not include this" from "you lack a role".
 */
export const EDITION_CAPABILITY_BODY = { error: 'forbidden', code: 'edition_capability' } as const;

/**
 * A CAPABILITY gate, not an ACCESS gate.
 *
 * Access (may this organization use FXL Sales at all) is decided by exactly one
 * gate, `requireHubAuth` inside `appAuthMiddleware`, from
 * `entitlements.access`, and this middleware never replaces, duplicates or
 * relaxes it: it is mounted BEHIND `appAuthMiddleware` and only ever narrows an
 * already-authenticated, already-entitled request.
 *
 * What it narrows is the product surface of the organization's edition, which
 * `applyHubAuthContext` resolved once from the token's add-on modules. A
 * missing `salesEdition` (impossible behind `appAuthMiddleware`, possible in a
 * test that hand-builds the context) is treated as 'full', so this gate can
 * never take a capability away from the full product.
 */
export function requireCapability(capability: SalesCapability): MiddlewareHandler {
  return async (c, next) => {
    const edition = c.get('salesEdition') ?? 'full';
    if (!hasCapability(edition, capability)) {
      return c.json(EDITION_CAPABILITY_BODY, 403);
    }
    return next();
  };
}
```

## Step 4 - mount the gate map

### 4a. `apps/api/src/domains/sales-ops/routes.ts`

1. Add the import directly below the `require-admin.js` import block:

```ts
import { requireCapability } from '../../middleware/require-capability.js';
```

2. Immediately after `export const salesOpsRouter = new Hono();` and BEFORE `salesOpsRouter.get('/bootstrap', ...)`, insert this block verbatim:

```ts
// ─────────────────────────────────────────────────────────────────────────────
// Edition capability gates (edicao-leads). They MUST stay above every route in
// this file: Hono runs matched handlers in registration order, so a gate
// registered below a handler never runs before it. `/x/*` also matches `/x`.
// Open in every edition, deliberately: /bootstrap, GET /settings, /people,
// /lead-stages and /leads. The capability set per edition lives in
// `@fxl-sales/shared-utils/sales-edition`; the full edition passes every gate.
// PUT /settings is gated inline on its route below because GET /settings stays open.
// ─────────────────────────────────────────────────────────────────────────────
salesOpsRouter.use('/summary/*', requireCapability('proposals'));
salesOpsRouter.use('/sales/*', requireCapability('proposals'));
salesOpsRouter.use('/settlements/*', requireCapability('proposals'));
salesOpsRouter.use('/products/*', requireCapability('catalog'));
salesOpsRouter.use('/clients/*', requireCapability('catalog'));
salesOpsRouter.use('/areas/*', requireCapability('catalog'));
salesOpsRouter.use('/funcoes/*', requireCapability('catalog'));
salesOpsRouter.use('/import/*', requireCapability('import'));
salesOpsRouter.use('/history/*', requireCapability('history'));
```

3. Change the PUT /settings route head from `salesOpsRouter.put('/settings', requireAdmin, async (c) => {` to:

```ts
salesOpsRouter.put('/settings', requireCapability('history'), requireAdmin, async (c) => {
```

The capability check runs before `requireAdmin` so the leads-edition answer does not depend on the caller's role.
Nothing else in this file changes; `GET /settings`, `/bootstrap`, `/people*` and the lead mounts get no gate.

### 4b. `apps/api/src/domains/commissions/routes.ts`

Add `import { requireCapability } from '../../middleware/require-capability.js';` to the import block, and directly after the two lines `export const commissionsRouter = new Hono();` / `export const commissionsAdminRouter = new Hono();` insert:

```ts
// Edition capability gate (edicao-leads). Registered before every route so it runs first.
commissionsRouter.use('*', requireCapability('commissions'));
commissionsAdminRouter.use('*', requireCapability('commissions'));
```

### 4c. `apps/api/src/domains/payouts/routes.ts`

Same import; directly after `export const payoutsRouter = new Hono();` / `export const payoutsAdminRouter = new Hono();` insert:

```ts
// Edition capability gate (edicao-leads). Registered before every route so it runs first.
payoutsRouter.use('*', requireCapability('commissions'));
payoutsAdminRouter.use('*', requireCapability('commissions'));
```

### 4d. `apps/api/src/domains/finder/routes.ts`

Same import; directly after `export const finderRouter = new Hono();` insert:

```ts
// Edition capability gate (edicao-leads). Registered before every route so it runs first.
finderRouter.use('*', requireCapability('finders'));
```

### 4e. `apps/api/src/domains/links/routes.ts`

Same import; directly after `export const linksRouter = new Hono();` insert:

```ts
// Edition capability gate (edicao-leads). Registered before every route so it runs first.
linksRouter.use('*', requireCapability('finders'));
```

`server.ts`, the admin router, the conversions routers, `/r`, `/health`, `/auth/*`, the public finders signup, sellers/invitations and audit are NOT touched, so they stay open in both editions.

## Step 5 - tests

### 5a. New `apps/api/src/middleware/__tests__/require-capability.test.ts`

No env, no Hub: it imports only `hono`, `../require-capability.js`, `../require-admin.js` and the edition subpath.

```ts
import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import type { SalesCapability, SalesEdition } from '@fxl-sales/shared-utils/sales-edition';
import { ADMIN_ROLE_REQUIRED_BODY } from '../require-admin.js';
import { EDITION_CAPABILITY_BODY, requireCapability } from '../require-capability.js';

const ALL_CAPABILITIES: readonly SalesCapability[] = [
  'proposals', 'commissions', 'catalog', 'import', 'finders', 'history', 'leadFullFields',
];

function appFor(edition: SalesEdition | undefined, capability: SalesCapability) {
  const app = new Hono();
  app.use('*', async (c, next) => {
    if (edition !== undefined) c.set('salesEdition', edition);
    await next();
  });
  app.get('/probe', requireCapability(capability), (c) => c.json({ reached: true }));
  return app;
}
```

Exact cases:

1. `EDITION_CAPABILITY_BODY serializes byte-exactly`: `expect(JSON.stringify(EDITION_CAPABILITY_BODY)).toBe('{"error":"forbidden","code":"edition_capability"}')`.
2. `it.each(ALL_CAPABILITIES)('the leads edition is refused %s with the byte-exact 403')`: status `403`, `await res.text()` equals `'{"error":"forbidden","code":"edition_capability"}'`, `res.headers.get('content-type')` contains `application/json`.
3. `it.each(ALL_CAPABILITIES)('the full edition passes %s')`: status `200`, json `{ reached: true }`.
4. `it.each(ALL_CAPABILITIES)('a missing salesEdition is treated as full for %s')`: `appFor(undefined, cap)` answers `200` `{ reached: true }`.
5. `the denial never reaches the handler`: with a `vi.fn` handler on a leads app, the handler mock is not called.
6. `the body is not the admin body and carries no reason`: `expect(EDITION_CAPABILITY_BODY).not.toEqual(ADMIN_ROLE_REQUIRED_BODY)` and `expect('reason' in EDITION_CAPABILITY_BODY).toBe(false)`.

### 5b. New `apps/api/src/middleware/__tests__/edition-gate-map.test.ts` (THE ORACLE)

Header comment states: it drives the REAL `appAuthMiddleware` and the REAL SDK verifier with tokens signed by an in-process keypair, mirrors the `server.ts` mount shapes for the seven gated routers, and enumerates every registered route so an unclassified route fails.

Setup, copied from `seller-routes-admin-gate.test.ts` with these differences:

```ts
import { randomUUID } from 'node:crypto';
import { exportJWK, generateKeyPair, SignJWT, type JWK } from 'jose';
import { Hono } from 'hono';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const HUB_CLIENT_ID = 'pk_fxl-sales_development_unit-test-only-0123456789';
const HUB_CLIENT_SECRET = 'sk_fxl-sales_development_unit-test-only-not-a-real-secret-0123456789';
const HUB_API_URL = 'http://localhost:9016';
const HUB_ISSUER = 'https://auth.fxlbusiness.test';
const AUDIENCE = 'app.fxl-sales';
const EDITION_BODY_TEXT = '{"error":"forbidden","code":"edition_capability"}';
const HANDLER_REACHED = { error: 'handler_reached' };

const dbCalls = vi.hoisted(() => ({ count: 0 }));

vi.mock('../../db/client.js', () => {
  // Any use of the database is a handler having been reached. It throws so the
  // test app's onError turns it into the HANDLER_REACHED marker.
  const fakeDb = new Proxy({}, {
    get: () => { throw new Error('edition-gate-map: fake database reached'); },
  });
  return {
    getDb: () => { dbCalls.count += 1; return fakeDb; },
    getAdminDb: () => { dbCalls.count += 1; return fakeDb; },
    closeDb: async () => undefined,
    resolveAdminDatabaseUrl: () => undefined,
  };
});
```

`beforeAll`: identical keypair, `signToken` (with `.setJti(randomUUID())`), `fetch` stub and `vi.stubEnv` list as `seller-routes-admin-gate.test.ts` (database name `fxl_sales_edition_gate_test`), then:

```ts
const { appAuthMiddleware } = await import('../app-auth.js');
const { requireAdmin } = await import('../require-admin.js');
const { salesOpsRouter } = await import('../../domains/sales-ops/routes.js');
const { commissionsAdminRouter, commissionsRouter } = await import('../../domains/commissions/routes.js');
const { payoutsAdminRouter, payoutsRouter } = await import('../../domains/payouts/routes.js');
const { linksRouter } = await import('../../domains/links/routes.js');
const { finderRouter } = await import('../../domains/finder/routes.js');

app = new Hono();
// Mirrors server.ts mount shapes and order for these seven routers.
app.use('/api/v1/admin/commissions/*', appAuthMiddleware, requireAdmin);
app.route('/api/v1/admin/commissions', commissionsAdminRouter);
app.use('/api/v1/commissions/*', appAuthMiddleware);
app.route('/api/v1/commissions', commissionsRouter);
app.use('/api/v1/admin/payouts/*', appAuthMiddleware, requireAdmin);
app.route('/api/v1/admin/payouts', payoutsAdminRouter);
app.use('/api/v1/payouts/*', appAuthMiddleware);
app.route('/api/v1/payouts', payoutsRouter);
app.use('/api/v1/sales-ops/*', appAuthMiddleware);
app.route('/api/v1/sales-ops', salesOpsRouter);
app.use('/api/v1/links/*', appAuthMiddleware);
app.route('/api/v1/links', linksRouter);
app.use('/api/v1/finder/*', appAuthMiddleware);
app.route('/api/v1/finder', finderRouter);
app.onError((_error, c) => c.json(HANDLER_REACHED, 500));
routers = { salesOps: salesOpsRouter, commissions: commissionsRouter, commissionsAdmin: commissionsAdminRouter,
  payouts: payoutsRouter, payoutsAdmin: payoutsAdminRouter, links: linksRouter, finder: finderRouter };
```

Tokens, minted once in `beforeAll` after `signToken` exists:

```ts
function claims(modules: string[], roles: Record<string, unknown> = { workspace: 'owner' }) {
  return {
    workspaceId: 'org_edition_gate',
    contractVersion: 1,
    entitlements: { access: true, modules },
    roles,
  };
}
tokens = {
  leadsOwner: await signToken(claims(['sales.edition.leads'])),
  leadsSeller: await signToken(claims(['sales.edition.leads'], { workspace: 'member', productRoles: ['seller'] })),
  fullOwner: await signToken(claims([])),
  addonOwner: await signToken(claims(['sales.some-other-addon'])),
};
```

`beforeEach(() => { dbCalls.count = 0; })`; `afterAll` unstubs globals and envs and resets modules.

Route table (`type RouterKey = 'salesOps' | 'commissions' | 'commissionsAdmin' | 'payouts' | 'payoutsAdmin' | 'links' | 'finder'`).
Each case is `{ router, method, pattern, url }`, where `pattern` is the path exactly as `router.routes` lists it and `url` is the full concrete URL.
Use `const ID = '55555555-5555-4555-8555-555555555555'` for every `:param`.

GATED (every one must answer the edition 403 for `leadsOwner`):

| router | method | pattern | url |
| --- | --- | --- | --- |
| salesOps | GET | /summary | /api/v1/sales-ops/summary |
| salesOps | GET | /sales | /api/v1/sales-ops/sales |
| salesOps | POST | /sales | /api/v1/sales-ops/sales |
| salesOps | POST | /sales/:id/transition | /api/v1/sales-ops/sales/ID/transition |
| salesOps | POST | /sales/:id/cancel-contract | /api/v1/sales-ops/sales/ID/cancel-contract |
| salesOps | PUT | /sales/:id | /api/v1/sales-ops/sales/ID |
| salesOps | GET | /sales/:id/settlements | /api/v1/sales-ops/sales/ID/settlements |
| salesOps | POST | /settlements | /api/v1/sales-ops/settlements |
| salesOps | POST | /settlements/:id/reverse | /api/v1/sales-ops/settlements/ID/reverse |
| salesOps | GET | /products | /api/v1/sales-ops/products |
| salesOps | POST | /products | /api/v1/sales-ops/products |
| salesOps | PATCH | /products/:id | /api/v1/sales-ops/products/ID |
| salesOps | GET | /clients | /api/v1/sales-ops/clients |
| salesOps | POST | /clients | /api/v1/sales-ops/clients |
| salesOps | PATCH | /clients/:id | /api/v1/sales-ops/clients/ID |
| salesOps | GET | /areas | /api/v1/sales-ops/areas |
| salesOps | POST | /areas | /api/v1/sales-ops/areas |
| salesOps | PATCH | /areas/:id | /api/v1/sales-ops/areas/ID |
| salesOps | GET | /funcoes | /api/v1/sales-ops/funcoes |
| salesOps | POST | /funcoes | /api/v1/sales-ops/funcoes |
| salesOps | PATCH | /funcoes/:id | /api/v1/sales-ops/funcoes/ID |
| salesOps | GET | /import/template | /api/v1/sales-ops/import/template |
| salesOps | POST | /import/preview | /api/v1/sales-ops/import/preview |
| salesOps | POST | /import/commit | /api/v1/sales-ops/import/commit |
| salesOps | PUT | /settings | /api/v1/sales-ops/settings |
| salesOps | GET | /history | /api/v1/sales-ops/history |
| commissions | GET | / | /api/v1/commissions |
| commissionsAdmin | GET | / | /api/v1/admin/commissions |
| commissionsAdmin | POST | /promote-locked | /api/v1/admin/commissions/promote-locked |
| commissionsAdmin | POST | /:commissionId/lock | /api/v1/admin/commissions/ID/lock |
| commissionsAdmin | POST | /:commissionId/reverse | /api/v1/admin/commissions/ID/reverse |
| payouts | GET | / | /api/v1/payouts |
| payoutsAdmin | GET | / | /api/v1/admin/payouts |
| payoutsAdmin | POST | / | /api/v1/admin/payouts |
| payoutsAdmin | POST | /:payoutId/mark-paid | /api/v1/admin/payouts/ID/mark-paid |
| payoutsAdmin | GET | /finders-ready | /api/v1/admin/payouts/finders-ready |
| payoutsAdmin | POST | /batches | /api/v1/admin/payouts/batches |
| payoutsAdmin | GET | /batches/:id/csv | /api/v1/admin/payouts/batches/ID/csv |
| links | POST | / | /api/v1/links |
| links | GET | / | /api/v1/links |
| links | DELETE | /:linkId | /api/v1/links/ID |
| finder | GET | /apps | /api/v1/finder/apps |
| finder | GET | /apps/:appId/products | /api/v1/finder/apps/ID/products |
| finder | GET | /clicks | /api/v1/finder/clicks |
| finder | GET | /clicks/stats | /api/v1/finder/clicks/stats |

OPEN (never the edition 403, in any edition):

| router | method | pattern | url |
| --- | --- | --- | --- |
| salesOps | GET | /bootstrap | /api/v1/sales-ops/bootstrap |
| salesOps | GET | /settings | /api/v1/sales-ops/settings |
| salesOps | GET | /people | /api/v1/sales-ops/people |
| salesOps | POST | /people | /api/v1/sales-ops/people |
| salesOps | PATCH | /people/:id | /api/v1/sales-ops/people/ID |
| salesOps | GET | /lead-stages | /api/v1/sales-ops/lead-stages |
| salesOps | POST | /lead-stages/reorder | /api/v1/sales-ops/lead-stages/reorder |
| salesOps | POST | /lead-stages | /api/v1/sales-ops/lead-stages |
| salesOps | PATCH | /lead-stages/:id | /api/v1/sales-ops/lead-stages/ID |
| salesOps | GET | /leads | /api/v1/sales-ops/leads |
| salesOps | POST | /leads | /api/v1/sales-ops/leads |
| salesOps | GET | /leads/:id | /api/v1/sales-ops/leads/ID |
| salesOps | PATCH | /leads/:id | /api/v1/sales-ops/leads/ID |
| salesOps | POST | /leads/:id/move | /api/v1/sales-ops/leads/ID/move |

Helpers:

```ts
async function send(route: RouteCase, token: string): Promise<Response> {
  const hasBody = route.method !== 'GET' && route.method !== 'DELETE';
  return app.request(`http://localhost${route.url}`, {
    method: route.method,
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: hasBody ? '{}' : undefined,
  });
}

/** True only for the exact edition denial: status 403 AND the byte-exact body. */
async function isEditionDenial(res: Response): Promise<boolean> {
  if (res.status !== 403) return false;
  return (await res.text()) === EDITION_BODY_TEXT;
}

function registeredKeys(key: RouterKey): Set<string> {
  return new Set(routers[key].routes.filter((r) => r.method !== 'ALL').map((r) => `${r.method} ${r.path}`));
}
function classifiedKeys(key: RouterKey): Set<string> {
  return new Set([...GATED, ...OPEN].filter((r) => r.router === key).map((r) => `${r.method} ${r.pattern}`));
}
```

Exact cases:

1. `describe('the gate map is exhaustive')`:
   - `it.each(ROUTER_KEYS)('every route registered on %s is classified as gated or open')`: `expect(classifiedKeys(key)).toEqual(registeredKeys(key))`.
   - `it.each(['commissions','commissionsAdmin','payouts','payoutsAdmin','links','finder'])('%s registers its capability gate before any route')`: `expect(routers[key].routes[0]).toMatchObject({ method: 'ALL', path: '/*' })`.
   - `it('no open route belongs to a whole-router gated group')`: every OPEN case has `router === 'salesOps'`.
2. `describe('the leads edition')`:
   - `it.each(GATED)('$method $url answers the edition 403 to a leads-edition owner')`: `res.status === 403`, `await res.text()` equals `EDITION_BODY_TEXT`, and `dbCalls.count === 0`.
   - `it.each(GATED.filter((r) => r.router === 'salesOps'))('$method $url answers the edition 403 to a leads-edition seller too')`: same assertions with `tokens.leadsSeller` (proves the gate is role-independent, including `PUT /settings` where the capability runs before `requireAdmin`).
   - `it.each(OPEN)('$method $url is not edition-gated for a leads-edition owner')`: `expect(await isEditionDenial(res)).toBe(false)`.
   - `it('GET /bootstrap reaches its handler for a leads-edition owner (non-vacuity)')`: status `500`, json equals `HANDLER_REACHED`, `dbCalls.count > 0`.
   - `it('GET /settings reaches its handler while PUT /settings is gated')`: GET answers `HANDLER_REACHED` with `dbCalls.count > 0`; PUT answers the edition 403.
3. `describe('the full edition (FXL oracle)')`:
   - `it.each([...GATED, ...OPEN])('$method $url never answers the edition 403 with modules []')`: `expect(await isEditionDenial(await send(route, tokens.fullOwner))).toBe(false)`.
   - `it.each([...GATED, ...OPEN])('$method $url never answers the edition 403 with an unrelated add-on module')`: same with `tokens.addonOwner`.
   - `it('GET /summary reaches its handler for a full-edition owner (non-vacuity)')`: status `500`, json `HANDLER_REACHED`, `dbCalls.count > 0`.
   - `it('GET /api/v1/admin/commissions reaches its handler for a full-edition owner (non-vacuity)')`: same assertions.
4. `describe('the access gate is unchanged')`:
   - `it('a leads-edition token without access still answers 402 no_org_access')`: token with `entitlements: { access: false, modules: ['sales.edition.leads'] }` on `GET /api/v1/sales-ops/bootstrap` answers `402` and json `{ error: 'payment_required', code: 'no_org_access' }` (the access gate runs first and the edition never turns a 402 into a 403).
   - `it('a request with no token answers 401 before any edition gate')`: `GET /api/v1/sales-ops/summary` with no `authorization` answers `401`.

### 5c. `apps/api/src/middleware/__tests__/app-auth.test.ts` (extend)

Add `import { Hono } from 'hono';`, add `applyHubAuthContext` to the existing `from '../app-auth.js'` import, and append:

```ts
describe('applyHubAuthContext resolves the sales edition once', () => {
  async function probe(entitlements: { access?: boolean; modules?: string[] }) {
    const app = new Hono();
    app.use('*', (c, next) => applyHubAuthContext(c, hubAuthContext({ entitlements }), next));
    app.get('/', (c) => c.json({ salesEdition: c.get('salesEdition'), orgId: c.get('orgId') }));
    return (await app.request('http://localhost/')).json();
  }
  ...
});
```

The parameter type matches the fixture's `Partial<HubEntitlements>` override, so no cast is needed.
Exact cases:

1. `modules [] resolves full`: `{ modules: [] }` gives `salesEdition: 'full'`.
2. `the leads module resolves leads`: `{ modules: ['sales.edition.leads'] }` gives `'leads'`.
3. `an unrelated add-on resolves full`: `{ modules: ['sales.some-other-addon'] }` gives `'full'`.
4. `the leads module beside another add-on resolves leads`: `{ modules: ['sales.some-other-addon', 'sales.edition.leads'] }` gives `'leads'`.
5. `a near-miss spelling resolves full`: `{ modules: ['SALES.EDITION.LEADS'] }` and `{ modules: ['sales.edition.leads '] }` each give `'full'`.
6. `absent modules resolve full`: `{ modules: undefined }` gives `'full'`.
7. `tenancy is unchanged`: case 2's body also has `orgId: 'org_active_1'` (the fixture default).

### 5d. `apps/api/src/auth/__tests__/dev-identity-no-hub.test.ts` (extend)

1. In the `/probe` handler JSON add `salesEdition: c.get('salesEdition'),`.
2. Append inside the existing `describe`:

```ts
it('resolves the sales edition through applyHubAuthContext for every entitled roster identity', async () => {
  const fake = await import('@fxl-sales/auth-fake');
  const { resolveSalesEdition } = await import('@fxl-sales/shared-utils/sales-edition');
  let served = 0;
  for (const identity of fake.IDENTITIES) {
    const res = await app.request('http://localhost/probe', { headers: { 'x-fake-identity': identity.id } });
    if (res.status !== 200) continue;
    served += 1;
    const body = await res.json();
    expect(body.salesEdition).toBe(resolveSalesEdition(identity.modules));
  }
  expect(served).toBeGreaterThan(0);
});

it('serves today\'s roster as the full edition', async () => {
  const res = await app.request('http://localhost/probe', { headers: { 'x-fake-identity': 'team-admin' } });
  expect(res.status).toBe(200);
  expect((await res.json()).salesEdition).toBe('full');
});
```

The loop is written so slice 08's new `leads-owner` / `leads-seller` identities are covered automatically with no edit here.
Dynamic import of `@fxl-sales/auth-fake` matches the file's existing rule (never a static import).

## Step 6 - rules documentation (the rule moves in this change)

### 6a. `nexo/knowledge/reference/auth-model.md`

Replace the single sentence `` `requireHubAuth`'s own `requiredModule` is now the only seam that may read `modules`, for a paid add-on, and no route mounts it today. `` with these lines (one sentence per line):

```markdown
  `requireHubAuth`'s own `requiredModule` is the only seam that may read `modules` for an ACCESS decision on a paid add-on, and no route mounts it today.
  The one other reader is `applyHubAuthContext`, which resolves the Sales edition (`resolveSalesEdition`, `@fxl-sales/shared-utils/sales-edition`) into `c.get('salesEdition')` once per request on both the Hub and the development adapter path (edicao-leads, v4.3.0).
  The edition is a CAPABILITY set, not access: `requireCapability` (`apps/api/src/middleware/require-capability.ts`) is mounted BEHIND `appAuthMiddleware`, answers `403 {"error":"forbidden","code":"edition_capability"}`, and treats a missing edition as `full`.
  Absent, empty or unknown modules resolve to `full`, so an organization the Hub never marked keeps today's whole product; the fail-open direction is deliberate.
  The gate map lives on the routers themselves (top of `domains/sales-ops/routes.ts`, first line of the commissions, payouts, finder and links routers) and its oracle is `apps/api/src/middleware/__tests__/edition-gate-map.test.ts`.
```

### 6b. `CLAUDE.md`, section `## Auth Model`, sub-list `Access gate:`

Replace the bullet text `` `modules` is for paid add-ons only, via `requireHubAuth`'s `requiredModule`. `` (the end of the first bullet) with:

```markdown
`modules` is for paid add-ons via `requireHubAuth`'s `requiredModule`, plus the Sales edition, resolved ONLY in `applyHubAuthContext` into `c.get('salesEdition')`.
```

and append one bullet at the end of the `Access gate:` sub-list:

```markdown
- `requireCapability` (`apps/api/src/middleware/require-capability.ts`) is a CAPABILITY gate behind the access gate, never an access gate: `403 {"error":"forbidden","code":"edition_capability"}`, a missing edition is `full`, and gates are registered above every route of their router. Oracle: `apps/api/src/middleware/__tests__/edition-gate-map.test.ts`.
```

Keep every other line of `CLAUDE.md` byte-identical.

## Step 7 - verification (run-once only)

```bash
pnpm run build:packages
pnpm --filter @fxl-sales/api exec vitest run \
  src/middleware/__tests__/require-capability.test.ts \
  src/middleware/__tests__/edition-gate-map.test.ts \
  src/middleware/__tests__/app-auth.test.ts \
  src/auth/__tests__/dev-identity-no-hub.test.ts \
  src/middleware/__tests__/app-auth-access-gate.test.ts \
  src/domains/sellers/__tests__/seller-routes-admin-gate.test.ts \
  src/domains/sales-ops/__tests__/financial-admin-gate.test.ts
pnpm --filter @fxl-sales/api test
pnpm --filter @fxl-sales/api lint
pnpm --filter @fxl-sales/api type-check
node --test scripts/__tests__/auth-fake-isolation.test.mjs scripts/__tests__/hub-sdk-pin.test.mjs
```

Mutation sanity checks the executor runs by hand and reverts (record the result in the exec notes):

1. Delete `salesOpsRouter.use('/import/*', ...)`: the three import cases in `the leads edition` must fail.
2. Move the sales-ops gate block below `GET /summary`: `GET /summary` leads case must fail.
3. Change `?? 'full'` to `?? 'leads'` in `require-capability.ts`: `require-capability.test.ts` case 4 must fail, and so must `financial-admin-gate.test.ts`.
4. Remove the `c.set('salesEdition', ...)` line: the leads-edition cases in `edition-gate-map.test.ts` and `app-auth.test.ts` case 2 must fail.
5. Add a dummy `salesOpsRouter.get('/zz-unclassified', ...)`: the exhaustiveness case must fail.

## Out of scope

- Edition-aware lead schemas, projection, people-as-vendedor and the reused `no_open_stage` refusal (SEAM A1) (slice 04 reads `c.get('salesEdition')` this slice provides).
- Any web change (slices 05 to 07).
- The fake roster's leads identities and seed (slice 08).
- `server.ts`, `select.ts` and every `requireHubAuth` option.
