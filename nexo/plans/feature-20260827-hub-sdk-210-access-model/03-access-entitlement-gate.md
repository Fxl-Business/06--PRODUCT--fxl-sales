---
id: 03-access-entitlement-gate
milestone: v2.8.0
status: todo
depends_on: [02-explicit-hub-config]
files_modified:
  - apps/api/src/config/auth-provider.ts
  - apps/api/src/config/__tests__/auth-provider.test.ts
  - apps/api/src/middleware/app-auth.ts
  - apps/api/src/middleware/__tests__/app-auth.test.ts
  - apps/api/src/middleware/__tests__/app-auth-access-gate.test.ts
  - apps/api/src/middleware/__tests__/app-auth-unconfigured.test.ts
  - apps/api/src/domains/sales-ops/__tests__/routes.test.ts
  - apps/api/src/domains/sales-ops/__tests__/history-route.test.ts
  - apps/web/src/lib/api-client.ts
  - apps/web/src/lib/require-token.ts
  - apps/web/src/lib/__tests__/api-client-token-guard.test.ts
  - apps/web/src/sales-ops/CadastroHistoryPanel.tsx
  - apps/web/src/sales-ops/SalesOpsApp.tsx
  - apps/web/src/sales-ops/__tests__/no-org-access-panel.test.tsx
  - CLAUDE.md
acceptance: "given a token whose entitlements.access is true, when a protected route is called, then it is allowed; given access false the answer is 402 with a buy-screen code and the web app shows neither a login screen nor a session-expired panel; given a claim set with no access key at all the answer is a denial and never an allow"
goal: "Replace the deleted core-module entitlement gate with the required boolean entitlements.access while preserving the 401, 402 and 403 deny taxonomy"
must_not_break:
  - "the 503 hub_auth_not_configured branch"
  - "orgId remaining the active Hub workspace id and every tenant query filtering by it"
  - "a 401 continuing to reach the login screen"
rules:
  - "no em dash and no en dash on any added line"
  - "the gate must fail closed: an absent or malformed entitlements shape denies"
  - "entitlements.modules must not be read for baseline access"
verifier_focus: "that the gate cannot fail open, that a 402 is never rendered as a login or expired-session screen, and that no core module string survives"
---

# 03 - Gate baseline access on `entitlements.access`

## Context

This is the defect that locks every operator out.

`apps/api/src/middleware/app-auth.ts:171` gates every protected route on
`hasHubCoreEntitlement(hubAuth, hubAuthConfig.coreModule)`, which is
`auth.claims.entitlements.modules.includes('sales.core')`
(`app-auth.ts:111-113`). The `sales.core` module was DELETED in the Hub's
access-model-v1, and `entitlements.modules` now carries ADD-ON modules only.
That expression is therefore `false` for every user of a Hub on the new model,
and every protected route answers `402`.

Access is now the required boolean `auth.claims.entitlements.access`, which
appears in ZERO files in this repository today.

This slice does NOT bump the SDK. It stays on `@fxl-business/hub-sdk@1.3.1` and
merges green there. Slice 04 does the flip and can then delete most of what this
slice adds, because every body written here is byte-identical to the body the
2.1.0 `requireHubAuth` already returns.

### Facts this plan is built on (verified, do not re-derive)

Read out of the installed 1.3.1 tarball at
`node_modules/.pnpm/@fxl-business+hub-sdk@1.3.1_hono@4.12.28/node_modules/@fxl-business/hub-sdk/dist/server.js`
and out of the two recon reports in
`nexo/runs/feature-20260827-hub-sdk-210-access-model/`.

1. On 1.3.1, `requireHubAuth` (`dist/server.js:559`) delegates to `hubAuth`
   (`dist/server.js:232-249`), which produces EXACTLY these outcomes and nothing
   else:
   - `401 {"error":"unauthorized","code":"missing_token"}` when no bearer token
     is present;
   - `401 {"error":"unauthorized","code":"<HubAuthError.code>"}` on a verification
     failure, and `401 {"error":"unauthorized","code":"malformed"}` on any other
     throw;
   - `503 {"error":"unavailable","code":"discovery_failed"}` if OIDC discovery
     fails;
   - otherwise `c.set("hubAuth", context)` and `await next()`.
   There is NO `402` and NO entitlement gate anywhere in 1.3.1. That is why this
   slice must own the `402` locally rather than delegating.
2. On 2.1.0 the SDK answers the same question natively as
   `402 {"error":"payment_required","code":"no_org_access"}` when
   `auth.entitlements.access !== true`, and
   `403 {"error":"forbidden","code":"missing_module","module":"<m>"}` when a
   `requiredModule` is absent. This slice adopts BOTH bodies verbatim, so slice
   04 changes no web contract.
3. The Organization id claim is `workspaceId`, not `organizationId`. Tenancy is
   unchanged: `getHubLegacyAuthContext` keeps mapping `auth.workspaceId` to
   `orgId`, and every tenant query keeps filtering by it.
4. Through at least 1.3.1 the SDK's `HubEntitlements` is re-exported from an
   unshipped `@fxl-hub/hub-auth`, so under `skipLibCheck: true` it degrades to
   `any`. `MIGRATION.md` section 10 warns about exactly this: a gate written
   against the SDK's type makes `access !== true` an UNREACHABLE branch at type
   level and the compiler stops checking it. This repo already declares its own
   `MinimalHubAuthContext` in `app-auth.ts:18-33`, and that local declaration is
   where `access: boolean` goes.
5. `hasHubCoreEntitlement` has ONE production call site, `app-auth.ts:171`, and
   two test call sites, `app-auth.test.ts:94` and `:99`.
6. `coreModuleFromAudience` is module-private in
   `apps/api/src/config/auth-provider.ts:19-22` and feeds exactly one field,
   `HubAuthConfig.coreModule`.
7. On the WEB side today a `402` does NOT become a login screen, and that is an
   accident rather than a decision: `isAuthFailure`
   (`apps/web/src/lib/require-token.ts:43-48`) matches `status === 401` only, so
   a `402` falls into the GENERIC panel and the operator is told
   "A API de vendas nao respondeu corretamente" - the server is broken. That is
   the misdiagnosis this release exists to remove, one notch over from the
   session-expired one. It is fixed here, and the correct behaviour is PINNED so
   a later widening of `isAuthFailure` cannot put a paying question behind a
   login screen.
8. `apps/web/src/lib/api-client.ts:18-22` builds `ApiError` from
   `{error, message, status}` and DROPS `body.code`. So today the web half
   physically cannot branch on `no_org_access`. `code` has to be carried.
9. Nothing in `apps/web/src` spells `missing_entitlement`, `402` or
   `payment_required`, so renaming the code breaks no existing web branch.

### Assumption about slice 02

At the time this plan was written,
`nexo/plans/feature-20260827-hub-sdk-210-access-model/02-explicit-hub-config.md`
did not exist. This plan assumes only what `00-OVERVIEW.md` states about 02: the
Audience becomes explicit configured input, `parseAudienceFromPublishableKey` is
deleted, `FXL_HUB_CONFIG` is accepted, and `HubAuthConfig` keeps `apiUrl`,
`secretKey` and `audience` in some form.

Two consequences for the executor:

- If 02 has ALREADY removed `coreModule` and `coreModuleFromAudience` from
  `apps/api/src/config/auth-provider.ts`, skip step 2 below and do everything
  else unchanged.
- Wherever this plan says "copy the env stub block", copy it from the file AS IT
  EXISTS IN THE WORKING TREE after 02, never from the literals quoted here. 02
  may have retired `FXL_HUB_PUBLISHABLE_KEY` and added `FXL_HUB_ENVIRONMENT`.

## Scope

Fifteen files. Nothing else is touched: not `hub-session-store.ts`, not
`hub-rotated-cookie.ts`, not `hub-bff-origin.ts`, not any `package.json`, not
`pnpm-lock.yaml`, not any `.env` file, and no SDK version anywhere.

## Order of work: RED first

Author every test in step 5 and step 9 BEFORE touching any implementation file.
Run them and CONFIRM they fail. Those tests are immutable afterwards: if one is
red at the end, the implementation is wrong, not the test.

Expected red output before any implementation:

- `apps/api/src/middleware/__tests__/app-auth.test.ts` fails to compile because
  `classifyHubAccess`, `hasHubOrgAccess`, `hasHubModule` and `requireHubModule`
  are not exported from `../app-auth.js`.
- `apps/api/src/middleware/__tests__/app-auth-access-gate.test.ts` fails on the
  allow case with `402 {"error":"payment_required","code":"missing_entitlement"}`,
  because a fixture with `access: true` and `modules: []` does not contain
  `sales.core`. That failure IS the defect, reproduced.
- `apps/web/src/lib/__tests__/api-client-token-guard.test.ts` fails to resolve
  `isOrgAccessFailure`.
- `apps/web/src/sales-ops/__tests__/no-org-access-panel.test.tsx` fails because
  the 402 render still produces the generic panel copy.

---

## Step 1 - `apps/api/src/middleware/app-auth.ts`

### 1a. Declare `access` locally on `MinimalHubAuthContext`

Replace the `entitlements` member of the type at `app-auth.ts:18-33`:

```ts
export type MinimalHubAuthContext = {
  accountId: string;
  /**
   * The active Organization id. The CLAIM is named `workspaceId` and the Hub
   * will not rename it, so neither does this product; `getHubLegacyAuthContext`
   * maps it to `orgId` and every tenant query filters by that.
   */
  workspaceId: string;
  claims: {
    entitlements: {
      /**
       * access-model-v1 baseline access. REQUIRED, and declared HERE rather
       * than imported from the SDK on purpose: through at least 1.3.1 the
       * SDK re-exports `HubEntitlements` from an unshipped `@fxl-hub/hub-auth`,
       * so under `skipLibCheck: true` it degrades to `any` and `access !== true`
       * becomes a branch the compiler no longer checks. The SDK's own
       * MIGRATION.md section 10 says so.
       */
      access: boolean;
      /**
       * ADD-ON modules only. The `sales.core` module was DELETED from the Hub's
       * access model, so this array is NEVER read for baseline access - only by
       * `requireHubModule` for a genuine paid add-on.
       */
      modules: string[];
    };
    roles: {
      productRoles?: unknown;
      workspace: string;
    };
    isSuperAdmin?: boolean;
    /** Present on the Hub access token; the web reads the same two claims. */
    name?: string;
    email?: string;
  };
};
```

### 1b. Delete `hasHubCoreEntitlement` and add the gate

DELETE `app-auth.ts:111-113` in full. In its place:

```ts
/** The exact 2.1.0 bodies, so slice 04 changes no contract when it deletes this. */
const MISSING_HUB_CONTEXT = { error: 'unauthorized', code: 'missing_hub_context' } as const;
const NO_ORG_ACCESS = { error: 'payment_required', code: 'no_org_access' } as const;

export type HubAccessVerdict =
  | { allowed: true; auth: MinimalHubAuthContext }
  | { allowed: false; status: 401 | 402; body: { error: string; code: string } };

/**
 * Baseline access, and the ONLY question that decides it.
 *
 * Fails CLOSED by construction: the comparison is `=== true`, so `false`,
 * `undefined`, `'true'`, `1` and a missing `entitlements` object all deny. The
 * optional chaining is not decoration - the type says `access: boolean`, but the
 * value arrives from a token, and a gate that trusts a claim shape it did not
 * build is a gate that can be opened by a malformed one.
 *
 * `entitlements.modules` is deliberately NOT read here. It carries add-on
 * modules only; reading it for baseline access is the defect this slice removes.
 */
export function hasHubOrgAccess(auth: MinimalHubAuthContext | undefined): boolean {
  return auth?.claims?.entitlements?.access === true;
}

/**
 * The single authority for the 401 and 402 halves of the deny taxonomy.
 *
 * Returns a DISCRIMINATED verdict rather than a nullable denial so the allow
 * path carries the narrowed context and the caller needs no cast: a cast here
 * would be the one place a future edit could hand an unchecked context to
 * `getHubLegacyAuthContext`.
 */
export function classifyHubAccess(auth: MinimalHubAuthContext | undefined): HubAccessVerdict {
  if (!auth) {
    return { allowed: false, status: 401, body: { ...MISSING_HUB_CONTEXT } };
  }
  if (!hasHubOrgAccess(auth)) {
    return { allowed: false, status: 402, body: { ...NO_ORG_ACCESS } };
  }
  return { allowed: true, auth };
}

/**
 * The ONE seam that may read `entitlements.modules`, for a paid ADD-ON module.
 * No route mounts it today, because this product sells no add-on yet; it exists
 * so the 403 half of the taxonomy has a real implementation and a real oracle,
 * and its body is byte-identical to the 2.1.0 `requiredModule` denial, so slice
 * 04 replaces it with `requireHubAuth`'s own option and deletes this.
 */
export function hasHubModule(auth: MinimalHubAuthContext | undefined, module: string): boolean {
  const modules = auth?.claims?.entitlements?.modules;
  return Array.isArray(modules) && modules.includes(module);
}

export function requireHubModule(module: string): MiddlewareHandler {
  return async (c, next) => {
    if (!hasHubModule(c.get('hubAuth'), module)) {
      return c.json({ error: 'forbidden', code: 'missing_module', module }, 403);
    }
    return next();
  };
}
```

### 1c. Rewrite the middleware body

Replace `app-auth.ts:164-174` (the `if (!hubAuth)` block through the
`hasHubCoreEntitlement` block) with:

```ts
    const verdict = classifyHubAccess(c.get('hubAuth'));
    if (!verdict.allowed) {
      blockedResponse = c.json(verdict.body, verdict.status);
      return;
    }

    const legacy = getHubLegacyAuthContext(verdict.auth);
```

Everything else in `appAuthMiddleware` stays byte-identical, including the
`503 hub_auth_not_configured` early return, the `blockedResponse ?? authResponse`
return, and the four `c.set` calls. `hubAuthConfig` is no longer read inside the
middleware body; leave the module-level `const hubAuthConfig` alone, it is still
read by `hubAuthMiddleware` and `createAppAuthBff`.

## Step 2 - `apps/api/src/config/auth-provider.ts`

Skip this step if slice 02 already did it.

- Delete `coreModuleFromAudience` in full.
- Delete `coreModule: string;` from `HubAuthConfig`.
- Delete `coreModule: coreModuleFromAudience(audience),` from the object
  `loadHubAuthConfig` returns.

Nothing else in that file changes in this slice.

## Step 3 - the five existing fixtures that carry a core module

Every one of these is UPDATED, never weakened. Each gains `access: true` and
loses `'sales.core'`, so each fixture keeps proving exactly what it proved
before while no longer depending on a module that no longer exists.

| # | file:line | today | after |
|---|---|---|---|
| 1 | `apps/api/src/middleware/__tests__/app-auth.test.ts:15` | `entitlements: { modules: ['sales.core'] },` | `entitlements: { access: true, modules: [] },` |
| 2 | `apps/api/src/middleware/__tests__/app-auth.test.ts:102` | `entitlements: { modules: [] }` inside the `hasHubCoreEntitlement` reject test | the whole `describe('hasHubCoreEntitlement')` block (`:92-108`) is DELETED and replaced by step 5's blocks, which cover strictly more |
| 3 | `apps/api/src/domains/sales-ops/__tests__/routes.test.ts:88` | `entitlements: { modules: ['sales.core'] },` | `entitlements: { access: true, modules: [] },` |
| 4 | `apps/api/src/domains/sales-ops/__tests__/history-route.test.ts:53` | `entitlements: { modules: ['sales.core'] },` | `entitlements: { access: true, modules: [] },` |
| 5 | `apps/api/src/config/__tests__/auth-provider.test.ts:12-15` | `toMatchObject({ audience: 'product.fxl-sales', coreModule: 'sales.core' })` | `toMatchObject({ audience: 'product.fxl-sales' })` plus a new assertion below |

`modules: []` and not `modules: ['sales.core']` on 1, 3 and 4 is deliberate: an
empty add-on list is now the ORDINARY shape of an entitled Organization, and
leaving the string in would keep a dead module alive in three fixtures and let a
future accidental module read pass.

For fixture 5 also add, inside the same `it`, an assertion that the key is gone
rather than merely unasserted:

```ts
    expect(config).not.toHaveProperty('coreModule');
```

`toMatchObject` ignores extra keys, so without this line the deletion is not
actually pinned. If slice 02 rewrote this test file, keep whatever shape it
asserts and add only the `not.toHaveProperty` line.

## Step 4 - do not touch `app-auth-bff-wiring.test.ts`

It does not spell `coreModule` or `sales.core` (verified by grep). Leave it
alone. Its `product.fxl-sales` audience pins belong to slices 02 and 04.

## Step 5 - the API oracles

### 5a. `apps/api/src/middleware/__tests__/app-auth.test.ts`

Delete `describe('hasHubCoreEntitlement')` (`:92-108`) and its import of
`hasHubCoreEntitlement`. Import `classifyHubAccess`, `hasHubOrgAccess`,
`hasHubModule` and `requireHubModule` instead. Add these blocks, with these
exact `it` names.

```ts
describe('classifyHubAccess', () => {
  it('allows a context whose entitlements.access is true', () => {
    expect(classifyHubAccess(baseHubAuth)).toEqual({ allowed: true, auth: baseHubAuth });
  });

  it('denies with 402 and the buy-screen code when entitlements.access is false', () => {
    expect(
      classifyHubAccess({
        ...baseHubAuth,
        claims: { ...baseHubAuth.claims, entitlements: { access: false, modules: [] } },
      }),
    ).toEqual({
      allowed: false,
      status: 402,
      body: { error: 'payment_required', code: 'no_org_access' },
    });
  });

  it('denies a claim set with no access key at all rather than allowing it', () => {
    /*
      The cast is the point of the test. The TYPE says `access: boolean`, but the
      value comes off a token, and a Hub or a fixture that omits the key must
      never be defaulted to true. Absent is a denial.
    */
    const noAccessKey = {
      ...baseHubAuth,
      claims: { ...baseHubAuth.claims, entitlements: { modules: [] } },
    } as unknown as MinimalHubAuthContext;
    expect(classifyHubAccess(noAccessKey).allowed).toBe(false);
    expect(classifyHubAccess(noAccessKey)).toMatchObject({ status: 402 });
  });

  it('denies when the entitlements object is missing entirely', () => {
    const noEntitlements = {
      ...baseHubAuth,
      claims: { roles: { workspace: 'member' } },
    } as unknown as MinimalHubAuthContext;
    expect(classifyHubAccess(noEntitlements).allowed).toBe(false);
  });

  it('denies a non-boolean access claim rather than coercing it', () => {
    for (const access of ['true', 1, {}, null]) {
      const coerced = {
        ...baseHubAuth,
        claims: { ...baseHubAuth.claims, entitlements: { access, modules: [] } },
      } as unknown as MinimalHubAuthContext;
      expect(classifyHubAccess(coerced).allowed).toBe(false);
    }
  });

  it('denies with 401 missing_hub_context when the SDK produced no auth context', () => {
    expect(classifyHubAccess(undefined)).toEqual({
      allowed: false,
      status: 401,
      body: { error: 'unauthorized', code: 'missing_hub_context' },
    });
  });

  it('never reads entitlements.modules for baseline access', () => {
    /*
      The exact shape of the defect, inverted: a workspace carrying every module
      string this product has ever spelled, and no access, is still denied.
    */
    expect(
      classifyHubAccess({
        ...baseHubAuth,
        claims: {
          ...baseHubAuth.claims,
          entitlements: { access: false, modules: ['sales.core', 'sales', 'core'] },
        },
      }).allowed,
    ).toBe(false);
    /* And the mirror: access alone is enough, with no module at all. */
    expect(hasHubOrgAccess(baseHubAuth)).toBe(true);
    expect(hasHubModule(baseHubAuth, 'sales.core')).toBe(false);
  });
});

describe('requireHubModule', () => {
  function probe(auth: MinimalHubAuthContext | undefined) {
    const app = new Hono();
    app.use('/probe', async (c, next) => {
      if (auth) c.set('hubAuth', auth);
      await next();
    });
    app.use('/probe', requireHubModule('sales.forecasting'));
    app.get('/probe', (c) => c.json({ ok: true }));
    return app.request('http://localhost/probe');
  }

  it('answers 403 missing_module when the add-on module is absent', async () => {
    const res = await probe(baseHubAuth);
    expect(res.status).toBe(403);
    await expect(res.json()).resolves.toEqual({
      error: 'forbidden',
      code: 'missing_module',
      module: 'sales.forecasting',
    });
  });

  it('calls through when the add-on module is present', async () => {
    const res = await probe({
      ...baseHubAuth,
      claims: {
        ...baseHubAuth.claims,
        entitlements: { access: true, modules: ['sales.forecasting'] },
      },
    });
    expect(res.status).toBe(200);
  });

  it('answers 403 rather than throwing when there is no auth context at all', async () => {
    expect((await probe(undefined)).status).toBe(403);
  });
});
```

This file needs `import { Hono } from 'hono';` added. The existing
`getHubLegacyAuthContext` describe block and the three redirect-resolver describe
blocks are untouched.

### 5b. NEW `apps/api/src/middleware/__tests__/app-auth-access-gate.test.ts`

The end-to-end oracle for `appAuthMiddleware` itself, which nothing covers today.
Model it on `apps/api/src/middleware/__tests__/app-auth-bff-memory-path.test.ts`:
`vi.resetModules()`, `vi.stubEnv` for the whole Hub env, `vi.doMock`, then
`await import('../app-auth.js')` inside `beforeAll`.

Copy the `vi.stubEnv` block VERBATIM from `app-auth-bff-memory-path.test.ts` as
it stands in the working tree after slice 02, except keep `DATABASE_URL` set to
the wiring test's value
`postgresql://postgres:postgres@localhost:5006/fxl_sales_wiring_test` so no
memory-store warning is emitted. No database connection is opened, because
`createAppAuthBff()` is never called in this file.

The SDK is stubbed so no token is ever verified and no discovery request is made:

```ts
type StubOutcome =
  | { kind: 'context'; auth: unknown }
  | { kind: 'no-context' }
  | { kind: 'reject'; code: string };

/** Mutated per test; read by the stub middleware on every request. */
let outcome: StubOutcome = { kind: 'no-context' };

vi.doMock('@fxl-business/hub-sdk/server', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@fxl-business/hub-sdk/server')>();
  return {
    ...actual,
    /*
      Stands in for the REAL 1.3.1 requireHubAuth, whose only outcomes are
      `401 {error:'unauthorized', code}` (dist/server.js:236,243,245) and
      `c.set('hubAuth', ctx)` then `next()` (dist/server.js:240,247). Stubbing it
      keeps this file offline: the real one calls `discover()` over HTTP on its
      first request.
    */
    requireHubAuth: () => async (c: Context, next: Next) => {
      if (outcome.kind === 'reject') {
        return c.json({ error: 'unauthorized', code: outcome.code }, 401);
      }
      if (outcome.kind === 'context') {
        c.set('hubAuth', outcome.auth as MinimalHubAuthContext);
      }
      await next();
    },
  };
});
```

Two apps are mounted in `beforeAll`, after the dynamic import:

```ts
  const appAuth = await import('../app-auth.js');
  const { requireAdmin } = await import('../require-admin.js');

  app = new Hono();
  app.use('/probe', appAuth.appAuthMiddleware);
  app.get('/probe', (c) => c.json({ ok: true, orgId: c.get('orgId'), userId: c.get('userId') }));
  app.use('/admin-probe', appAuth.appAuthMiddleware, requireAdmin);
  app.get('/admin-probe', (c) => c.json({ ok: true }));
```

Fixtures:

```ts
const entitled = {
  accountId: 'hub-account-1',
  workspaceId: 'org_active_1',
  claims: {
    entitlements: { access: true, modules: [] },
    roles: { workspace: 'member' },
  },
};
```

The exact `it` names and assertions:

```ts
describe('appAuthMiddleware access gate', () => {
  it('allows a protected route when entitlements.access is true', async () => {
    outcome = { kind: 'context', auth: entitled };
    const res = await app.request('http://localhost/probe');
    expect(res.status).toBe(200);
    /*
      Tenancy, pinned in the same breath: orgId is the ACTIVE HUB WORKSPACE ID
      off the `workspaceId` claim, not an `organizationId` claim, which the Hub
      does not mint.
    */
    await expect(res.json()).resolves.toEqual({
      ok: true,
      orgId: 'org_active_1',
      userId: 'hub-account-1',
    });
  });

  it('answers 402 payment_required with no_org_access when entitlements.access is false', async () => {
    outcome = {
      kind: 'context',
      auth: { ...entitled, claims: { ...entitled.claims, entitlements: { access: false, modules: [] } } },
    };
    const res = await app.request('http://localhost/probe');
    expect(res.status).toBe(402);
    /* toEqual, not toMatchObject: the web half branches on this exact body. */
    await expect(res.json()).resolves.toEqual({
      error: 'payment_required',
      code: 'no_org_access',
    });
  });

  it('answers 402 rather than allowing when the claim set has no access key', async () => {
    outcome = {
      kind: 'context',
      auth: { ...entitled, claims: { ...entitled.claims, entitlements: { modules: [] } } },
    };
    const res = await app.request('http://localhost/probe');
    expect(res.status).toBe(402);
  });

  it('answers 402 for a workspace that still carries the deleted core module but no access', async () => {
    outcome = {
      kind: 'context',
      auth: {
        ...entitled,
        claims: { ...entitled.claims, entitlements: { access: false, modules: ['sales.core'] } },
      },
    };
    expect((await app.request('http://localhost/probe')).status).toBe(402);
  });

  it('answers 401 when the token is missing or invalid', async () => {
    for (const code of ['missing_token', 'malformed', 'expired']) {
      outcome = { kind: 'reject', code };
      const res = await app.request('http://localhost/probe');
      expect(res.status).toBe(401);
      await expect(res.json()).resolves.toEqual({ error: 'unauthorized', code });
    }
  });

  it('answers 401 missing_hub_context when the SDK calls next without a context', async () => {
    outcome = { kind: 'no-context' };
    const res = await app.request('http://localhost/probe');
    expect(res.status).toBe(401);
    await expect(res.json()).resolves.toEqual({
      error: 'unauthorized',
      code: 'missing_hub_context',
    });
  });

  it('answers 403 for a role the route requires but the entitled token does not carry', async () => {
    /*
      An entitled ordinary member: 402 is not the answer to "you may not do
      THIS", and 401 is not the answer to "we know exactly who you are".
    */
    outcome = { kind: 'context', auth: entitled };
    const res = await app.request('http://localhost/admin-probe');
    expect(res.status).toBe(403);
  });

  it('lets an entitled workspace owner through the same admin route', async () => {
    outcome = {
      kind: 'context',
      auth: { ...entitled, claims: { ...entitled.claims, roles: { workspace: 'owner' } } },
    };
    expect((await app.request('http://localhost/admin-probe')).status).toBe(200);
  });
});
```

`afterAll` does `vi.doUnmock('@fxl-business/hub-sdk/server')`, `vi.unstubAllEnvs()`
and `vi.resetModules()`, exactly as the memory-path file does.

### 5c. NEW `apps/api/src/middleware/__tests__/app-auth-unconfigured.test.ts`

Its own file, because it needs a DIFFERENT module graph (no Hub env at all) and
vitest isolates per file. Same reason `app-auth-bff-memory-path.test.ts` is its
own file, and its header comment should say so.

`beforeAll`: `vi.resetModules()`, stub `NODE_ENV=test`, `CORS_ORIGIN`,
`DATABASE_URL` and `ADMIN_DATABASE_URL` as usual, then stub EVERY `FXL_HUB_*`
variable the post-02 `loadHubAuthConfig` reads to `''` so `tryLoadHubAuthConfig`
returns `null`. Then import `../app-auth.js` and mount `appAuthMiddleware`.

```ts
describe('appAuthMiddleware without Hub configuration', () => {
  it('answers 503 hub_auth_not_configured and never a 401, 402 or an allow', async () => {
    const res = await app.request('http://localhost/probe');
    expect(res.status).toBe(503);
    await expect(res.json()).resolves.toEqual({
      error: 'unavailable',
      code: 'hub_auth_not_configured',
    });
  });
});
```

## Step 6 - `apps/web/src/lib/api-client.ts`

Carry the server's code. Two three-line edits, nothing else in the file changes.

```ts
export type ApiError = {
  error: string;
  /**
   * The server's machine-readable sub-reason, e.g. `no_org_access` on a 402.
   * Dropped before this change, which is why the web half could not tell a
   * "your Organization has not bought this" apart from "the API fell over".
   */
  code?: string;
  message?: string;
  status: number;
};
```

and in BOTH `apiFetch` (`:42-46`) and `apiFetchBlob` (`:73-77`), add
`code: body.code,` beneath `error: body.error ?? 'request_failed',`.

## Step 7 - `apps/web/src/lib/require-token.ts`

This module imports NOTHING and must keep importing nothing. Append below
`isAuthFailure`:

```ts
/**
 * The 402 half of the taxonomy, and deliberately NOT part of `isAuthFailure`.
 *
 * A 402 means the operator is signed in and correctly identified, and their
 * Organization has not bought access. Routing it to `Sessao expirada` or to a
 * login redirect tells them to fix the one thing that is not broken, and a
 * re-login answers it with another 402 forever. It is also not an API fault:
 * before this it fell into the generic panel and read as "the server is down".
 *
 * Keyed on the STATUS. `code: 'no_org_access'` rides along on `ApiError` for
 * copy and for telemetry, but 402 has exactly one producer in this API, and a
 * body that failed to parse must not be able to hide the buy screen.
 */
export function isOrgAccessFailure(error: unknown): boolean {
  return (
    typeof error === 'object' && error !== null && (error as { status?: unknown }).status === 402
  );
}

/**
 * The buy-screen copy, declared here rather than in either panel because both
 * panels must say the same thing and `SalesOpsApp.tsx` imports
 * `CadastroHistoryPanel.tsx`, so a shared constant cannot live in either. No URL
 * is invented: this product does not know the Hub's billing address.
 */
export const NO_ORG_ACCESS_TITLE = 'Acesso nao contratado';
export const NO_ORG_ACCESS_TEXT =
  'Sua organizacao ainda nao tem acesso ao FXL Sales. Fale com quem administra a conta no FXL Hub para contratar o acesso. Voce continua conectado, nao e preciso entrar novamente.';
```

NOTE FOR THE EXECUTOR: the two copy strings above are written here without
Portuguese accents only because this plan file is ASCII. Write them in the
source file with the correct accents, matching the surrounding pt-BR copy:
`Acesso nao contratado` becomes the properly accented form, and likewise for the
body text. Follow the accentuation already used in the neighbouring panels.

`isAuthFailure` itself is NOT changed. It already matches `401` only, and step 9
pins that it keeps doing so.

## Step 8 - the two web panels

Both get the 402 branch AHEAD of the auth branch. Ahead is not strictly required
today, since `isAuthFailure` is 401-only, but a paying question must not be
reachable through a widened auth check, and the order documents the priority.

### 8a. `apps/web/src/sales-ops/CadastroHistoryPanel.tsx`

Import `isOrgAccessFailure`, `NO_ORG_ACCESS_TEXT` and `NO_ORG_ACCESS_TITLE`
alongside the existing `isAuthFailure` import (`:23`), and change the `isError`
ternary (`:118-133`) so that the 402 branch is tested FIRST, then the 401 branch
exactly as it reads today, then the existing generic branch. Keep every existing
string byte-identical; only the new branch is added.

### 8b. `apps/web/src/sales-ops/SalesOpsApp.tsx`

Same shape at `:1666-1682`, using `EmptyPanel` and `bootstrapQuery.error`, with
the rest of the existing ternary and both existing comments preserved verbatim.
Extend the import at `:75` to bring in `isOrgAccessFailure`,
`NO_ORG_ACCESS_TEXT` and `NO_ORG_ACCESS_TITLE` from `@/lib/require-token`.

Nothing in `apps/web/src/auth/` is touched. `HubProtected`, `SignedOutPanel`,
`SessionRecoveryPanel`, the revalidation ladder and `requestHubAccessToken` all
key on `/auth/refresh`'s status and never see a `402` from `/sales-ops`, so a
402 provably cannot become a login redirect.

## Step 9 - the web oracles

### 9a. `apps/web/src/lib/__tests__/api-client-token-guard.test.ts`

Add `isOrgAccessFailure` to the import and append a
`describe('no-org-access classification')` block with these exact `it` names:

- `isAuthFailure does not classify a 402 as an auth failure`
- `isOrgAccessFailure recognises a 402 ApiError`
- `isOrgAccessFailure rejects a 401, a 403 and a 500`
- `apiFetch carries the server code onto ApiError`

The first is the guard on the whole slice: widening `isAuthFailure` to `>= 401`
would put a billing answer behind a login screen, which is the release's whole
point.

### 9b. NEW `apps/web/src/sales-ops/__tests__/no-org-access-panel.test.tsx`

`CadastroHistoryPanel` is pure and prop-driven, so this needs no
`QueryClientProvider`, no api mock and no auth mock. Start the file with
`// @vitest-environment happy-dom`, render with `createRoot` inside `act`, and
read `container.textContent`.

Exact `it` names:

- `renders the buy screen for a 402 and never the login or session-expired copy`
  asserts the buy-screen title and the "no need to sign in again" sentence are
  present, and that `Sessao expirada`, `expirou`, `Entrar` and
  `Nao foi possivel carregar` are all ABSENT (match the accented source strings).
- `still renders the session-expired panel for a 401`
- `still renders the generic API-fault panel for a 500`

`emptyBootstrap` is the minimum `SalesOpsBootstrap` the panel needs; copy the
smallest existing builder from
`apps/web/src/sales-ops/__tests__/cadastro-history.test.tsx` rather than
inventing one, and do not modify that file.

The negative assertion on `Entrar` is the one that would fail if a later change
routed a 402 into `SignedOutPanel` or `SessionRecoveryPanel`, both of which
render an `Entrar` button.

## Step 10 - `CLAUDE.md`

In the `Auth Model` section, replace the two bullets that read
"Feature gates check `auth.claims.entitlements.modules`." and
"The core module for this product is `sales.core`." with a block recording:

- Baseline access is the REQUIRED boolean `auth.claims.entitlements.access`, and
  nothing else. `entitlements.modules` carries ADD-ON modules only and must NEVER
  be read for baseline access: the `sales.core` module was deleted in the Hub's
  access-model-v1, so the old `modules.includes('sales.core')` gate was false for
  every user and answered 402 to the entire product.
- `classifyHubAccess` in `apps/api/src/middleware/app-auth.ts` is the single
  authority, allows only on `access === true`, and fails CLOSED: absent, false,
  non-boolean, or a missing `entitlements` object all deny.
- `MinimalHubAuthContext` declares `access: boolean` LOCALLY and never imports the
  SDK's `HubEntitlements`, which through at least 1.3.1 is re-exported from an
  unshipped package and degrades to `any` under `skipLibCheck`, making the deny
  branch unreachable at type level. The SDK's own MIGRATION.md section 10 says so.
- `requireHubModule` is the only seam that may read `modules`, for a paid add-on,
  and no route mounts it today.
- The deny taxonomy is exact and the web half branches on it: `401` is a missing
  or invalid token and reaches the login screen; `402`
  `{"error":"payment_required","code":"no_org_access"}` is an Organization
  without access and MUST render the buy screen, never a login screen, never the
  expired-session panel, and never the generic API-fault panel where it landed
  before v2.8.0; `403` is authenticated but without the membership, Seat, module
  or role the route requires; `503`
  `{"error":"unavailable","code":"hub_auth_not_configured"}` is the API having no
  Hub configuration at all. Every body is byte-identical to the one
  `@fxl-business/hub-sdk@2.1.0`'s `requireHubAuth` returns natively, so the SDK
  flip changes no contract.
- `isAuthFailure` is 401-only and `isOrgAccessFailure` is 402-only, both in
  `apps/web/src/lib/require-token.ts`, and both panels branch 402 first. Widening
  `isAuthFailure` to a range puts a billing answer behind a login screen that
  answers it with another 402 forever; `isAuthFailure does not classify a 402 as
  an auth failure` is the test that catches it.
- `ApiError` in `apps/web/src/lib/api-client.ts` now carries `code`.

## Verification

Run all of these and require green:

```
pnpm --filter @fxl-sales/api test
pnpm --filter @fxl-sales/web test
pnpm run type-check
pnpm run lint
pnpm run build
```

Then the two grep gates, both of which must print NOTHING:

```
git grep -n -i "sales\.core" -- apps packages scripts
git grep -n "coreModule\|hasHubCoreEntitlement\|coreModuleFromAudience" -- apps packages scripts
```

`nexo/` and `CLAUDE.md` are excluded from the first gate on purpose: the string
survives there only as the prose record of what was removed.

Then the fail-open probe, which the verifier runs by hand: temporarily change
`hasHubOrgAccess` to `auth?.claims?.entitlements?.access !== false` and confirm
that `denies a claim set with no access key at all rather than allowing it` and
`answers 402 rather than allowing when the claim set has no access key` BOTH go
red. Revert. A gate whose fail-open mutation stays green is not a gate.

## Commits

Conventional, atomic, in this order. The tests of step 5 and step 9 are written
FIRST and confirmed red, then folded into the commit that makes them green, so
no red commit lands on the branch.

1. `feat(api)!: gate baseline access on entitlements.access, not sales.core`
   Steps 1, 2, 3, 5. Breaking-change footer: the 402 code changes from
   `missing_entitlement` to `no_org_access`, and `HubAuthConfig.coreModule` and
   `hasHubCoreEntitlement` are removed.
2. `feat(web): show a buy screen for a 402 instead of an API fault`
   Steps 6, 7, 8, 9.
3. `docs: record the access-model-v1 gate and the 401/402/403 taxonomy`
   Step 10.

## What this slice deliberately does not do

- It does not touch any SDK version. `@fxl-business/hub-sdk@^1.3.1` stays in both
  `package.json` files. Slice 04 owns the flip.
- It does not adopt `RequireHubAuthOptions.requiredModule` or
  `allowWithoutAccess`; neither exists on 1.3.1.
- It does not mount `requireHubModule` on any route. There is no add-on module to
  sell yet, and mounting one would be a product decision, not a migration.
- It does not change tenancy, the session store, the origin shim, the rotated
  cookie wrapper, the renewal timer, the revalidation ladder or the logout intent.
