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
  - apps/web/src/lib/require-token.ts
  - apps/web/src/lib/__tests__/api-client-token-guard.test.ts
  - apps/web/src/sales-ops/forbidden-copy.ts
  - apps/web/src/sales-ops/ForbiddenPanel.tsx
  - apps/web/src/sales-ops/CadastroHistoryPanel.tsx
  - apps/web/src/sales-ops/SalesOpsApp.tsx
  - apps/web/src/sales-ops/__tests__/forbidden-panel.test.tsx
  - apps/web/src/sales-ops/__tests__/entitlement-dead-end.test.tsx
  - CLAUDE.md
acceptance: "given a token whose entitlements.access is true, when a protected route is called, then it is allowed; given access false the answer is 402 with a buy-screen code and the web app shows neither a login screen nor a session-expired panel; given a 403 the web app tells the operator to ask an administrator rather than reporting a server fault; given a claim set with no access key at all the answer is a denial and never an allow"
goal: "Replace the deleted core-module entitlement gate with the required boolean entitlements.access while preserving the 401, 402 and 403 deny taxonomy, and give the 403 half a web owner"
must_not_break:
  - "the 503 hub_auth_not_configured branch"
  - "orgId remaining the active Hub workspace id and every tenant query filtering by it"
  - "a 401 continuing to reach the login screen"
  - "the 402 entitlement panel and its dead-end oracle, which landed in v2.8.0"
rules:
  - "no em dash and no en dash on any added line"
  - "the gate must fail closed: an absent or malformed entitlements shape denies"
  - "entitlements.modules must not be read for baseline access"
verifier_focus: "that the gate cannot fail open, that a 402 is never rendered as a login or expired-session screen, that a 403 is never rendered as a server fault, and that no core module string survives outside a test fixture"
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

### This slice's API gate is a DELIBERATE ONE-WAVE BRIDGE

Settled by `nexo/runs/feature-20260827-hub-sdk-210-access-model/replan-decisions.md`
decision D2, which is binding.

`classifyHubAccess`, `hasHubOrgAccess`, `hasHubModule`, `requireHubModule` and the
402 branch inside `appAuthMiddleware` are a DELIBERATE ONE-WAVE BRIDGE that keeps
master green on 1.3.1, which exports no access gate at all. This is the same
device slice 02 uses for its vendored copy of `loadHubConfig`, and it is written
down for the same reason: a bridge that is not labelled as one gets defended by
the next reader instead of deleted.

Slice 04 DELETES the bridge and delegates to 2.1.0's `requireHubAuth`, which
answers `402 payment_required / no_org_access` by default because
`allowWithoutAccess` defaults to false. After that flip `appAuthMiddleware`
reaches its own body only through the SDK's `next` callback, so a second local
gate would be unreachable dead code with a green suite over it. One live gate,
and it is the SDK's.

Slice 04 also DELETES
`apps/api/src/middleware/__tests__/app-auth-access-gate.test.ts` and replaces its
live claim, "a workspace without access gets 402", with a WIRING pin asserting
that `requireHubAuth` is called with the loaded config and with options that do
not set `allowWithoutAccess`. That is recorded here so nobody later reads the
deletion as a weakening: the claims about `classifyHubAccess` die with the
function they describe, and the one claim that outlives it is carried over by
name.

The `describe('requireHubModule')` block in step 5a is BRIDGE COVERAGE on code
with a known removal date, and it is KEPT rather than dropped. The argument for
keeping it: the 403 half of the taxonomy is a feature acceptance criterion in
`00-OVERVIEW.md`, this slice is the only place in the whole set where a 403 is
produced by code this repository owns, and an unexercised deny path is exactly
the kind of thing that is written wrong and never noticed. It costs three tests
for one wave, and slice 04 deletes them with the function under D2's
name-every-claim rule. The block carries a header comment saying it is bridge
coverage, so its deletion in slice 04 needs no argument beyond that comment.

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
7. The WEB half of the 402 ALREADY LANDED, in v2.8.0's Organization-context work,
   after this plan was first drafted. Read against the working tree, not against
   the three superseded facts this plan originally carried here:
   - `isEntitlementFailure` exists in `apps/web/src/lib/require-token.ts`, keys on
     `status === 402` ALONE, and is pinned by
     `isEntitlementFailure is true for a 402 that carries no code at all`.
   - `ApiError` in `apps/web/src/lib/api-client.ts` ALREADY carries `code`, set
     from `body.code` in both `apiFetch` and `apiFetchBlob`.
   - `apps/web/src/sales-ops/MissingEntitlementPanel.tsx` and its
     `missing-entitlement-copy.ts` render the buy screen, and
     `SalesOpsApp.tsx`'s `isError` chain is already
     `isEntitlementFailure`, then `isAuthFailure`, then generic, pinned by
     `apps/web/src/sales-ops/__tests__/entitlement-dead-end.test.tsx`.
   So this slice writes NO new 402 web code and renames NO web predicate. The
   402 web contract is unchanged by this slice, and the stale
   `missing_entitlement` literals in that web code are corrected by SLICE 04,
   under decision D2, when the API body actually changes to `no_org_access`.
   Doing it here would leave the tree documenting a code the API still sends.
8. What is STILL missing on the web is the 403. A `403` today is neither an
   entitlement failure nor an auth failure, so it falls into the GENERIC panel and
   the operator is told "A API de vendas nao respondeu corretamente" - the server
   is broken. That is the same misdiagnosis the 402 work removed one release ago,
   one notch over. This slice owns it, under decision D3.
9. `isAuthFailure` (`apps/web/src/lib/require-token.ts`) matches `status === 401`
   and the unavailable-token error, and nothing else. It is NOT widened here, and
   step 9 pins that it keeps refusing a 402 and a 403.

### Relationship to slice 02

`02-explicit-hub-config.md` now exists and this slice `depends_on` it, so it runs
against a tree where 02 has already merged.

- 02 explicitly KEEPS `coreModuleFromAudience` alive so that THIS slice deletes it,
  and widens its prefix strip to `/^(?:app|product)\./` so `app.fxl-sales` does not
  become `app.fxl-sales.core` in the interim. Step 2 below is therefore DO NOT SKIP.
  Its own rules list says "coreModuleFromAudience is NOT deleted in this slice".
- After 02 the field is returned as
  `return { ...config, coreModule: coreModuleFromAudience(config.audience), healthToken };`
  rather than from the literal this plan quoted, and `HubAuthConfig` is
  `HubConfig & { coreModule, healthToken }`. Deleting `coreModule` here leaves it
  as `HubConfig & { healthToken }`, which is the end state decision D1 records.
- Wherever this plan says "copy the env stub block", copy it from the file AS IT
  EXISTS IN THE WORKING TREE after 02, never from the literals quoted here. 02
  retires `FXL_HUB_PUBLISHABLE_KEY` and adds `FXL_HUB_ENVIRONMENT`,
  `FXL_HUB_CLIENT_ID`, `FXL_HUB_CLIENT_SECRET`, `FXL_HUB_CONFIG` and
  `FXL_HUB_HEALTH_TOKEN`.
- 02 DROPPED `CLAUDE.md` from its `files_modified` under decision D5, because two
  slices in one wave declaring one file is a structural merge conflict. Its
  documentation bullet lands HERE instead, in step 10, where this slice is the sole
  member of its wave.

## Scope

Sixteen files. Nothing else is touched: not `hub-session-store.ts`, not
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
  `isForbiddenFailure`.
- `apps/web/src/sales-ops/__tests__/forbidden-panel.test.tsx` fails to resolve
  `../ForbiddenPanel`.
- the new 403 case in
  `apps/web/src/sales-ops/__tests__/entitlement-dead-end.test.tsx` fails because
  the 403 render still produces the generic panel copy.

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
       * ADD-ON modules only. The old per-product core module was DELETED from the
       * Hub's access model, so this array is NEVER read for baseline access - only
       * by `requireHubModule` for a genuine paid add-on. CLAUDE.md's Auth Model
       * section records which module string that was and why it is gone.
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

/*
  BRIDGE COVERAGE, with a known removal date. `requireHubModule` exists only while
  this repo is on 1.3.1, which exports no access gate; slice 04 deletes the function
  and this whole describe block with it, in favour of `requireHubAuth`'s own
  `requiredModule` option. It is written anyway because the 403 half of the taxonomy
  is a feature acceptance criterion and an unexercised deny path is where a wrong
  status code hides.
*/
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

## Step 6 - `apps/web/src/lib/api-client.ts` is ALREADY DONE

No edit. When this plan was first drafted, `ApiError` dropped `body.code` and the
web half physically could not read a server sub-reason. v2.8.0's
Organization-context work already added `code?: string` to `ApiError` and sets it
from `body.code` in BOTH `apiFetch` and `apiFetchBlob`. Verified in the working
tree. The file is NOT in `files_modified`, and re-adding the field would be a
duplicate declaration.

The 402 predicate, the 402 panel and the 402 branch of the shell's error chain are
likewise already in the tree (see "Facts this plan is built on" item 7). This slice
therefore writes NO new 402 web code and renames NO web predicate. The web work
below is the 403 half, and only that.

## Step 7 - `apps/web/src/lib/require-token.ts`

This module imports NOTHING and must keep importing nothing: `api-client.ts`
imports IT, so any import back the other way is a cycle. That is why
`isAuthFailure` and `isEntitlementFailure` duck-type on `status` instead of
importing `ApiError`, and the new predicate does the same.

`isAuthFailure` and `isEntitlementFailure` are NOT changed. `isEntitlementFailure`
keeps its current body and its current docstring verbatim, stale
`missing_entitlement` prose included. Be clear about WHY, because the obvious reason
is the wrong one: this slice's own commit 1 already flips the wire body to
`no_org_access`, through step 1b's `NO_ORG_ACCESS` constant and step 5b's `toEqual`
assertion, so from this slice onward the API sends `no_org_access` and this docstring
is stale the moment the commit lands. The prose is nevertheless left alone because
slice 04 owns the whole `missing_entitlement` literal sweep under decision D2, in one
pass over a listed set of files, and splitting that sweep across two waves would give
two slices a claim on the same lines. The division is exactly this: slice 03 flips the
BODY, slice 04 deletes the local gate that emits it and corrects every literal
describing it, which is slice 04's section 23.6. `isEntitlementFailure` keys on
`status === 402` alone and never reads the code, so the one-wave staleness is prose
only and no predicate, no test and no rendered copy is wrong in the meantime.

Append below `isEntitlementFailure`:

```ts
/**
 * True for the 403 half of the deny taxonomy, and for nothing else.
 *
 * A 403 means the token is valid and the operator is correctly identified, and
 * they do not hold the membership, Seat, module or role the route requires. That
 * is neither a dead session nor a dead server, so it must reach neither
 * `Sessao expirada` nor "verifique o servidor local". `@fxl-business/hub-sdk@2.1.0`
 * answers `403 {error: 'forbidden', code: 'missing_module'}` and
 * `403 {error: 'forbidden', code: 'missing_role'}`; this repo's own
 * `requireHubModule` and `requireAdmin` answer 403 today.
 *
 * Keyed on the STATUS ALONE, exactly as `isEntitlementFailure` is, and for the same
 * asymmetry: `apiFetch` builds its error from `await res.json().catch(() => ({}))`,
 * so a 403 whose body does not parse - a proxy error page, a truncated response, a
 * gateway that rewrites the payload - carries no `code` at all. Requiring the code
 * would classify exactly that response as NOT forbidden and route it back onto the
 * server-outage copy this predicate exists to remove. Keying on the code fails
 * CLOSED onto that lie; keying on the status fails OPEN onto a panel that says
 * "ask an administrator", which is true of every 403 this API can send.
 *
 * The predicate stays narrow otherwise: no `>= 400`, no error-string alternative,
 * strict `===`, and `null` and `undefined` handled by the object guard.
 */
export function isForbiddenFailure(error: unknown): boolean {
  return (
    typeof error === 'object' && error !== null && (error as { status?: unknown }).status === 403
  );
}
```

`isAuthFailure` itself is NOT changed. It already matches 401 and the unavailable
token error only, and step 9 pins that it keeps refusing both a 402 and a 403.

## Step 8 - the 403 panel and the two hosts that render it

### 8a. NEW `apps/web/src/sales-ops/forbidden-copy.ts`

Its OWN module, for the same reason `missing-entitlement-copy.ts` is one: the repo
configures `react-refresh/only-export-components` with `allowConstantExport`, and
that option covers a primitive literal only, so an exported `as const` OBJECT beside
a component still trips the rule. Read `missing-entitlement-copy.ts` first and follow
its header comment, its export shape and its register.

```ts
export const FORBIDDEN_COPY = {
  title: 'Permissao insuficiente',
  body: 'Voce esta conectado, mas esta conta nao tem a permissao necessaria para esta acao nesta Organizacao. Peca a quem administra a Organizacao no FXL Hub para liberar o seu acesso.',
  note: 'Voce continua conectado, nao e preciso entrar novamente.',
} as const;
```

NOTE FOR THE EXECUTOR: the strings above are written here without Portuguese
accents only because this plan file is ASCII. Write them in the source file with
the correct accents, matching the accentuation of `MISSING_ENTITLEMENT_COPY` in
the neighbouring module.

The copy NAMES NO MODULE AND NO ROLE, deliberately. A 403 body is not something
this app can render trustworthily: the `code` is a machine token, the `module`
field is a Hub-internal identifier, and the identifier law in `CLAUDE.md` forbids
putting raw ids in user-facing copy. "Ask an administrator" is the whole of what
this app actually knows.

### 8b. NEW `apps/web/src/sales-ops/ForbiddenPanel.tsx`

Follow the SHAPE and the REGISTER of
`apps/web/src/sales-ops/MissingEntitlementPanel.tsx`; read that file first. Take
from it the local `mutedPanelClass` and `mutedStateClass` style constants with the
same "intentional local copies" comment, the `<section>` wrapper carrying a data
marker, and the docstring convention that explains why the panel exists rather
than what it renders.

Differences from that panel, each deliberate:

- It takes NO props and reads NO hook. `MissingEntitlementPanel` reads
  `useOrganizations` because it offers a switch; a 403 offers nothing this app can
  act on, so there is nothing to read and nothing to await. That also makes it
  renderable with no `QueryClientProvider` and no auth mock, which step 9c relies on.
- Its marker is `data-forbidden`, the counterpart of the existing
  `data-missing-entitlement`. Step 9's decisive mutation keys on it, so it is
  load-bearing and not decoration.
- No anchor, no checkout, no retry button. There is no URL this product could send
  the operator to that would grant a role, and a dead affordance on a dead-end screen
  is the defect class this whole release exists to remove.

```tsx
export function ForbiddenPanel() {
  return (
    <section className={`${mutedPanelClass} flex min-h-[154px] flex-col gap-3 p-6`} data-forbidden>
      <h3 className="text-sm font-bold text-[#201f24]">{FORBIDDEN_COPY.title}</h3>
      <p className="text-[13px] leading-5 text-[#57575f]">{FORBIDDEN_COPY.body}</p>
      <p className={`${mutedStateClass} leading-5`}>{FORBIDDEN_COPY.note}</p>
    </section>
  );
}
```

### 8c. `apps/web/src/sales-ops/SalesOpsApp.tsx`

The `bootstrapQuery.isError` chain becomes, in this exact order:

1. `isEntitlementFailure` to `MissingEntitlementPanel`, unchanged and STILL FIRST
2. `isForbiddenFailure` to `ForbiddenPanel`, NEW
3. `isAuthFailure` to the existing `Sessao expirada` `EmptyPanel`, unchanged
4. the existing generic `EmptyPanel`, unchanged

Extend the existing import from `@/lib/require-token` to bring in
`isForbiddenFailure`, and add an import of `./ForbiddenPanel` beside the existing
`./MissingEntitlementPanel` import.

Every existing string, every existing comment and both existing panels stay
BYTE-IDENTICAL. The only edits are one new ternary arm, two import lines, and one
added sentence inside the existing comment block above the chain.

That existing comment block already records the invariant, and it must keep saying
it after the new arm is inserted: the generic "Verifique o servidor local" copy is
reachable ONLY for an error that is none of the classified kinds. Extend the
sentence "reachable ONLY for an error that is neither an entitlement failure nor an
auth failure" to name the forbidden case too, and extend the sentence naming
`entitlement-dead-end.test.tsx` as the oracle "for all three arms" to say all four.

The entitlement branch stays FIRST for the reason the comment already gives, and the
new branch sits above `isAuthFailure` for the same reason: `isAuthFailure` is false
for a 403 today, so the order is not what makes the branch reachable now, it is what
keeps it reachable if `isAuthFailure` is ever widened. A widened predicate placed
above it would silently steal every 403 into `Sessao expirada` and tell the operator
to sign in again to fix a permission they do not hold.

### 8d. `apps/web/src/sales-ops/CadastroHistoryPanel.tsx`

The same insertion, one arm smaller. Its `isError` ternary today is
`isAuthFailure(error)` then the generic `Nao foi possivel carregar` block. Add the
403 branch AHEAD of the 401 branch, rendering `ForbiddenPanel`, and extend the
import at `:23` to bring in `isForbiddenFailure` beside `isAuthFailure`.

`ForbiddenPanel` renders its own `<section>` rather than the local `MutedBlock`, so
the marker and the copy are identical in both hosts and a copy edit cannot
desynchronise them. Importing it here is not a cycle: `ForbiddenPanel.tsx` imports
only `./forbidden-copy`.

No 402 branch is added here. `CadastroHistoryPanel` renders INSIDE the sales ops
shell, whose own bootstrap query is behind the same gate and classifies first, so a
402 already reaches `MissingEntitlementPanel` at the shell level. The 403 branch is
added anyway because `useCadastroHistory` hits `/sales-ops/history`, which
`requireAdmin` can 403 on its own while the shell's bootstrap succeeds. That is the
case this branch exists for, and it has no shell-level equivalent.

## Step 9 - the web oracles

### 9a. `apps/web/src/lib/__tests__/api-client-token-guard.test.ts`

Add `isForbiddenFailure` to the existing import and append a
`describe('forbidden classification')` block with these exact `it` names:

- `isForbiddenFailure recognises a 403 ApiError`
- `isForbiddenFailure is true for a 403 that carries no code at all`
- `isForbiddenFailure is false for a 401, a 402, a 500, an AuthTokenUnavailableError and a non-object`
- `isAuthFailure does not classify a 403 as an auth failure`

The second is the asymmetry pin, and it is the one that fails the day someone makes
`code === 'missing_module'` mandatory. It is the exact counterpart of the existing
`isEntitlementFailure is true for a 402 that carries no code at all`, which stays
verbatim.

The fourth is the guard on the whole web half of this slice: widening `isAuthFailure`
to a range would put a permission answer behind a login screen that answers it with
another 403 forever.

Every existing `it` in this file keeps its title and its assertions.

### 9b. `apps/web/src/sales-ops/__tests__/entitlement-dead-end.test.tsx`

EXTEND the existing file. Do not create a parallel one, and do not touch any of its
four existing `it` blocks: they are the 402, 500, 401 and loading arms and they stay
verbatim.

Keep the file's existing discipline exactly as it stands, because it is what makes
the oracle worth having: `../api`, `@/lib/api-client` and `../hooks` stay UNMOCKED,
so the 403 travels the REAL `apiFetch` error path and the test proves the status
survives into the `ApiError` the shell classifies rather than merely pinning a
ternary. Reuse the file's existing `renderApp`, `flushReact`, `text()` and
`entitlementPanel()` helpers and its `GENERIC_API_FAULT` and `SESSION_EXPIRED`
constants.

Add beside `entitlementPanel()`:

```ts
function forbiddenPanel() {
  return container.querySelector('[data-forbidden]');
}
```

Add one `it`, with this exact title:

- `renders the forbidden panel for a 403 and never the server-fault or session-expired copy`

It sets `fetchMock` to
`{ok: false, status: 403, json: async () => ({error: 'forbidden', code: 'missing_role'})}`,
renders `/tatico/dashboard`, and asserts:

```ts
    expect(forbiddenPanel()).not.toBeNull();
    expect(text()).toContain(FORBIDDEN_COPY.title);
    expect(text()).not.toContain(GENERIC_API_FAULT);
    expect(text()).not.toContain(SESSION_EXPIRED);
    // Keeps the 402 arm non-vacuous in the other direction too.
    expect(entitlementPanel()).toBeNull();
```

importing `FORBIDDEN_COPY` from `../forbidden-copy` beside the file's existing
`MISSING_ENTITLEMENT_COPY` import, so a copy edit moves the assertion with it.

Then add `expect(forbiddenPanel()).toBeNull();` to the existing 402, 500 and 401
blocks, in the same position their `expect(entitlementPanel()).toBeNull();` lines
already occupy in the 500 and 401 blocks. That is an added assertion on an existing
test, never a change to one: no title moves, no existing `expect` is edited or
removed.

THE DECISIVE MUTATION, which the verifier runs by hand: replace `ForbiddenPanel`'s
returned `<section>` with an empty fragment. `expect(forbiddenPanel()).not.toBeNull()`
goes red on the `[data-forbidden]` marker, so the 403 case cannot pass by rendering
nothing. That is the same shape as the existing 402 case's `[data-missing-entitlement]`
marker, and it is why the panel carries a data attribute at all. Revert.

### 9c. NEW `apps/web/src/sales-ops/__tests__/forbidden-panel.test.tsx`

The panel-level oracle, covering what 9b's shell-level test cannot reach: the second
host. Start the file with `// @vitest-environment happy-dom`, render with
`createRoot` inside `act`, and read `container.textContent`, following
`apps/web/src/sales-ops/__tests__/missing-entitlement-panel.test.tsx` for the
harness.

Exact `it` names:

- `renders the ask-an-administrator copy and no sign-in affordance`
  asserts `FORBIDDEN_COPY.title` and `FORBIDDEN_COPY.body` are present and that
  `Entrar`, `Sessao expirada` and `Nao foi possivel carregar` are all ABSENT (match
  the accented source strings). The negative on `Entrar` is the one that would fail
  if a later change routed a 403 into `SignedOutPanel` or `SessionRecoveryPanel`,
  both of which render an `Entrar` button.
- `names no module, no role and no raw identifier`
  asserts the rendered text contains none of `missing_module`, `missing_role`,
  `forbidden` or `403`. This is the pin on the copy decision in step 8a, and it is
  what fails the day someone tries to be helpful by interpolating the body's `code`.
- `renders the same forbidden panel from the cadastro history panel`
  renders `CadastroHistoryPanel` with `isError` true and a `{status: 403}` error and
  asserts `container.querySelector('[data-forbidden]')` is not null. This is the
  second host, and it is what proves the two do not drift apart.

A CORRECTION to what an earlier draft of this plan claimed about that third case.
It said `CadastroHistoryPanel` "is pure and prop-driven, so this needs no
`QueryClientProvider`, no api mock and no auth mock". The EXPORTED component really
is prop-driven, so the claim holds for RENDER. But the MODULE imports `./hooks`,
which pulls in `@tanstack/react-query` and `@/auth/react` transitively, and the
existing `apps/web/src/sales-ops/__tests__/cadastro-history.test.tsx` mocks
`@/auth/react` and `@/components/ui/alert-dialog` for exactly that reason. Copy
those two `vi.mock` calls from that file. Expect to need at least the alert-dialog
one. This is a time-sink, not a red, and the executor should not discover it the
hard way.

`emptyBootstrap` is the minimum `SalesOpsBootstrap` the panel needs; copy the
smallest existing builder from `cadastro-history.test.tsx` rather than inventing
one, and do not modify that file.

### 9d. this slice is alone in its wave

Slice 03 is the ONLY slice in wave 2, so the web growth in steps 7 through 9
creates no merge hazard: no other slice in this wave declares any of these files,
and the wave merges serially to trunk on its own.

## Step 10 - `CLAUDE.md`

This slice is the wave-2 `CLAUDE.md` owner and the ONLY slice in its wave, so
every `CLAUDE.md` edit for this wave lands here. That includes slice 02's
documentation bullet, carried below under decision D5.

### 10a. The access gate and the deny taxonomy

In the `Auth Model` section, replace the two bullets that read
"Feature gates check `auth.claims.entitlements.modules`." and
"The core module for this product is `sales.core`." with a block recording:

- Baseline access is the REQUIRED boolean `auth.claims.entitlements.access`, and
  nothing else. `entitlements.modules` carries ADD-ON modules only and must NEVER
  be read for baseline access: the `sales.core` module was deleted in the Hub's
  access-model-v1, so the old `modules.includes('sales.core')` gate was false for
  every user and answered 402 to the entire product. This is the ONE place in the
  tree that still spells that string, deliberately, as the prose record of what was
  removed; `CLAUDE.md` is outside the grep gate's pathspec for exactly that reason.
- `classifyHubAccess` in `apps/api/src/middleware/app-auth.ts` is the single
  authority, allows only on `access === true`, and fails CLOSED: absent, false,
  non-boolean, or a missing `entitlements` object all deny.
- `MinimalHubAuthContext` declares `access: boolean` LOCALLY and never imports the
  SDK's `HubEntitlements`, which through at least 1.3.1 is re-exported from an
  unshipped package and degrades to `any` under `skipLibCheck`, making the deny
  branch unreachable at type level. The SDK's own MIGRATION.md section 10 says so.
- `classifyHubAccess`, `hasHubOrgAccess`, `hasHubModule`, `requireHubModule` and the
  402 branch inside `appAuthMiddleware` are a DELIBERATE ONE-WAVE BRIDGE while this
  repo is on 1.3.1, which exports no access gate at all. The SDK bump deletes them
  and delegates to 2.1.0's `requireHubAuth`, whose `allowWithoutAccess` defaults to
  false, because two gates would mean one live gate and one unreachable one with a
  green suite over it. `requireHubModule` is meanwhile the only seam that may read
  `modules`, for a paid add-on, and no route mounts it today.
- The deny taxonomy is exact and EXHAUSTIVE, and the web half branches on it:
  `401 {"error":"unauthorized"}` is a missing or invalid token and reaches the
  login screen, which is the correct destination for every one of its codes,
  `contract_version_mismatch` included - that code is new in
  `@fxl-business/hub-sdk@2.1.0` and means the token's `contractVersion` is not 1,
  an absent one included, so it is a token this app cannot use and a fresh login is
  the only answer; `402 {"error":"payment_required","code":"no_org_access"}` is an
  Organization without access and MUST render the buy screen, never a login screen,
  never the expired-session panel, and never the generic API-fault panel where it
  landed before v2.8.0; `403 {"error":"forbidden"}`, with `missing_module` or
  `missing_role`, is authenticated but without the membership, Seat, module or role
  the route requires, and MUST render the ask-an-administrator panel, never the
  generic API-fault panel; `503 {"error":"unavailable","code":"hub_auth_not_configured"}`
  is the API having no Hub configuration at all. Every body is byte-identical to the
  one 2.1.0's `requireHubAuth` returns natively, so the SDK flip changes no contract.
- `isAuthFailure` is 401-only, `isEntitlementFailure` is 402-only and
  `isForbiddenFailure` is 403-only, all three in
  `apps/web/src/lib/require-token.ts`, and all three key on the STATUS ALONE. The
  402 and 403 predicates deliberately do not also require a `code`: `apiFetch`
  builds its error from `await res.json().catch(() => ({}))`, so a response whose
  body does not parse carries no code at all, and requiring one would fail CLOSED
  back onto the server-outage copy both predicates exist to remove.
  `isEntitlementFailure is true for a 402 that carries no code at all` and
  `isForbiddenFailure is true for a 403 that carries no code at all` are the pins.
  The classification chain in `SalesOpsApp` is `isEntitlementFailure`, then
  `isForbiddenFailure`, then `isAuthFailure`, then generic, and the INVARIANT is
  that the generic `Verifique o servidor local` copy is reachable ONLY for an error
  that is none of the classified kinds. The order matters not because
  `isAuthFailure` is true for a 402 or a 403 today - it is false for both - but
  because a later widening of it placed above them would silently steal a billing
  or a permission answer into `Sessao expirada`, telling the operator to sign in
  again to fix the one thing that is not broken, and a re-login answers it with the
  same status forever. `apps/web/src/sales-ops/__tests__/entitlement-dead-end.test.tsx`
  is the oracle for all four arms, drives the REAL `apiFetch` error path with
  `../api`, `@/lib/api-client` and `../hooks` unmocked, and its decisive mutations
  are the `[data-missing-entitlement]` and `[data-forbidden]` markers, so neither
  panel case can pass by rendering nothing.
- `ForbiddenPanel` names no module and no role, and its
  `names no module, no role and no raw identifier` test pins that. A 403 body is not
  something this app can render trustworthily: the `code` is a machine token and the
  `module` field is a Hub-internal identifier that the identifier law keeps out of
  user-facing copy. "Ask an administrator" is the whole of what this app knows.

**A ONE-WAVE INTERNAL DISAGREEMENT INSIDE `CLAUDE.md`, DATED HERE RATHER THAN
DISCOVERED.** After this slice, the `Auth Model` block above says the 402 body is
`no_org_access`, while the `Organization context` section further down still says
`402 {error: 'payment_required', code: 'missing_entitlement'}` and still names
`apps/api/src/middleware/app-auth.ts` as its producer. The `Auth Model` block calls
its taxonomy "exact and EXHAUSTIVE", so one file disagreeing with itself is not
something a later reader may be left to find. It is deliberate and it is bounded:
slice 04 rewrites the `Organization context` line under its own section 23.6, in the
same pass that sweeps every other stale `missing_entitlement` literal out of the tree.
Do NOT fix the `Organization context` section here. It is slice 04's under decision
D2, and editing it in this slice would make wave 2 a second owner of text slice 04
also edits. The wave-3 merge closes the gap.

### 10b. Slice 02's explicit-Hub-configuration bullet, carried

Slice 02 dropped `CLAUDE.md` from its own `files_modified` under decision D5,
because two slices in one wave declaring one file is a structural merge conflict.
Its documentation bullet lands here instead, appended to the same `Auth Model`
list, and slice 02's plan says its docs land in wave 2 so a reader of a
wave-1-only tree does not read the omission as an oversight.

TAKE THE WORDING VERBATIM from the clearly labelled block in
`nexo/plans/feature-20260827-hub-sdk-210-access-model/02-explicit-hub-config.md`.
If that plan carries no such labelled block by the time this slice runs, write the
bullet from 02's section 6, which states the same facts and is what the block is
drawn from:

- The Hub Audience and environment are EXPLICIT validated configuration, read off
  the validated `env` object through `hubEnvBag` and never off raw `process.env`.
  The Audience is `app.<slug>` and must equal `app.` plus the Client's slug;
  nothing derives it from a key. The environment must equal the segment inside
  `pk_<slug>_<environment>_<random>` and is never inferred from `NODE_ENV`.
  `FXL_HUB_CONFIG` is this repo's documented form, and setting it beside any
  discrete `FXL_HUB_*` variable is a BOOT FAILURE that names the offenders.
  `FXL_HUB_REDIRECT_URI` is its own variable because 2.x's `HubConfig` has no
  `redirectUri` and `createHubBff`'s default points at the Hub's origin.
  `FXL_HUB_HEALTH_TOKEN` is operator-generated and required outside development.

Slice 02 also rewrites the `Environments` table and the required-API-vars dotenv
block in this same file. Those edits belong to 02's own wave-1 work only if 02
still declares them; under D5 it does not declare `CLAUDE.md` at all, so carry
them here too, verbatim from 02's section 6 second bullet: the
`product.fxl-sales` client column becomes `app.fxl-sales`, and the required API
vars block takes the new names with every credential left EMPTY.

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
git grep -n -i "sales\.core" -- apps packages scripts ':!*__tests__*'
git grep -n "coreModule\|hasHubCoreEntitlement\|coreModuleFromAudience" -- apps packages scripts
```

The first gate is NARROWED to exclude `__tests__`, under decision D6, and slice
04's precondition 4 is narrowed the same way so the two agree. The exclusion is not
a loophole, it is the point: the two surviving occurrences are both TEST FIXTURES,
both of them the defect inverted, and both must stay VERBATIM.

- `apps/api/src/middleware/__tests__/app-auth.test.ts`, inside
  `never reads entitlements.modules for baseline access`:
  `modules: ['sales.core', 'sales', 'core']`. It proves a workspace carrying every
  module string this product ever spelled, and no access, is still denied.
- `apps/api/src/middleware/__tests__/app-auth-access-gate.test.ts`, inside
  `answers 402 for a workspace that still carries the deleted core module but no access`:
  `modules: ['sales.core']`.

Deleting either to satisfy a wider gate would delete the only proof that the
deleted module cannot grant access. Everything the gate is actually for - a
production read of the string - lives outside `__tests__` and is caught.

`nexo/` and `CLAUDE.md` are outside the pathspec on purpose: the string survives
there only as the prose record of what was removed, which step 10a requires.

The executor must therefore write NO `sales.core` literal into any non-test source
file. Step 1a's `modules` doc comment says the same thing without the literal and
points at `CLAUDE.md` for the string.

Then the fail-open probe, which the verifier runs by hand: temporarily change
`hasHubOrgAccess` to `auth?.claims?.entitlements?.access !== false` and confirm
that `denies a claim set with no access key at all rather than allowing it` and
`answers 402 rather than allowing when the claim set has no access key` BOTH go
red. Revert. A gate whose fail-open mutation stays green is not a gate.

Then the 403 render probe, also by hand: replace `ForbiddenPanel`'s returned
`<section>` with an empty fragment and confirm
`renders the forbidden panel for a 403 and never the server-fault or session-expired copy`
goes red on the `[data-forbidden]` marker. Revert. A panel case that passes by
rendering nothing is not a panel case.

## Commits

Conventional, atomic, in this order. The tests of step 5 and step 9 are written
FIRST and confirmed red, then folded into the commit that makes them green, so
no red commit lands on the branch.

1. `feat(api)!: gate baseline access on entitlements.access, not sales.core`
   Steps 1, 2, 3, 5. Breaking-change footer: the 402 code changes from
   `missing_entitlement` to `no_org_access`, and `HubAuthConfig.coreModule` and
   `hasHubCoreEntitlement` are removed.
2. `feat(web): tell the operator to ask an administrator on a 403`
   Steps 7, 8, 9. Step 6 contributes nothing: the 402 web half already landed in
   v2.8.0.
3. `docs: record the access-model-v1 gate and the 401/402/403 taxonomy`
   Step 10, both halves.

## What this slice deliberately does not do

- It does not touch any SDK version. `@fxl-business/hub-sdk@^1.3.1` stays in both
  `package.json` files. Slice 04 owns the flip.
- It does not adopt `RequireHubAuthOptions.requiredModule` or
  `allowWithoutAccess`; neither exists on 1.3.1.
- It does not mount `requireHubModule` on any route. There is no add-on module to
  sell yet, and mounting one would be a product decision, not a migration.
- It does not change tenancy, the session store, the origin shim, the rotated
  cookie wrapper, the renewal timer, the revalidation ladder or the logout intent.
- It does not rename `isEntitlementFailure`, does not touch
  `MissingEntitlementPanel.tsx` or `missing-entitlement-copy.ts`, and does not
  correct the stale `missing_entitlement` literals in the web tree. They go stale in
  THIS slice, not in slice 04: commit 1 flips the wire body to `no_org_access`. Slice
  04 still owns them under decision D2, because it deletes the local gate that emits
  the body and corrects every literal describing it in one listed sweep (its section
  23.6); doing half of that sweep here would put two slices on the same lines. Nothing
  breaks in the interval, because `isEntitlementFailure` keys on `status === 402` alone
  and never reads the code.
- It does not add a 402 branch to `CadastroHistoryPanel`. The shell's own bootstrap
  query is behind the same gate and classifies first, so a 402 already reaches
  `MissingEntitlementPanel` one level up. The 403 branch has no such equivalent,
  because `requireAdmin` can 403 the history route on its own.
