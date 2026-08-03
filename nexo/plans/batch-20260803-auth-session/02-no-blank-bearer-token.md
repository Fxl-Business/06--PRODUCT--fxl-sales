---
id: 02-no-blank-bearer-token
milestone: v2.4.0
status: todo
depends_on: []
files_modified: [apps/web/src/lib/require-token.ts, apps/web/src/lib/api-client.ts, apps/web/src/sales-ops/hooks.ts, apps/web/src/sales-ops/SalesOpsApp.tsx, apps/web/src/admin/apps/useApps.ts, apps/web/src/admin/audit/useAuditLog.ts, apps/web/src/admin/commissions/useAdminCommissions.ts, apps/web/src/admin/conversions/useConversions.ts, apps/web/src/admin/finders/hooks/useFinders.ts, apps/web/src/admin/payouts/usePayouts.ts, apps/web/src/admin/products/useProducts.ts, apps/web/src/admin/sellers/hooks/useSellers.ts, apps/web/src/finder/clicks/useClicks.ts, apps/web/src/finder/links/useLinks.ts, apps/web/eslint.config.js, apps/web/src/lib/__tests__/api-client-token-guard.test.ts, apps/web/src/sales-ops/__tests__/blank-bearer-token.test.tsx, CLAUDE.md]
acceptance: "given the Hub BFF session record is gone so getToken() resolves null, when the sales-ops bootstrap query runs, then no fetch is issued at all (never one with an absent or blank Authorization header) and the operator sees a session-expired panel instead of the generic 'A API de vendas não respondeu corretamente' server-fault panel."
---

# 02 - no blank bearer token

## Scope

This slice fixes Defect A from `nexo/runs/batch-20260803-auth-session/FRAME.md`: a null access token is laundered into a header-less HTTP request, the API answers 401, and the operator is told the server is broken.

Hard constraints for this slice:

- Do NOT touch `apps/web/src/auth/**`. Slice 03 owns `react.tsx` and `token.ts`.
- Do NOT touch `apps/api/**`. Slice 01 owns the BFF session store.
- Do NOT edit `CHANGELOG.md` or any auto-generated file.
- No em dash anywhere in code, comments, or docs; use a plain dash.

## Design decision

### D1 - a shared `requireToken` that throws a typed error

A new dependency-free module `apps/web/src/lib/require-token.ts` owns three exports:

- `AuthTokenUnavailableError`, an `Error` subclass with `name = 'AuthTokenUnavailableError'`.
- `requireToken(getToken)`, which awaits the reader and throws `AuthTokenUnavailableError` when the result is not a non-empty string.
- `assertBearerToken(token)`, the same non-empty check as a standalone assertion, used at the `apiFetch` chokepoint.

Plus one classifier, `isAuthFailure(error)`, used by the UI to tell an auth failure from an API fault.

The module imports nothing.
That is load-bearing: `apps/web/src/lib/api-client.ts` will import from it, so it must never import back from `api-client.ts`, or the two form a cycle.
This is why `isAuthFailure` duck-types the 401 case (`typeof error === 'object' && error.status === 401`) instead of importing the `ApiError` type.

Rejected: returning a sentinel such as `null` and making every call site branch.
That reproduces the current bug in a new spelling - 37 call sites each get a fresh opportunity to forget the branch, and the type system does not force any of them to handle it.
A throw is the only shape that is correct by default at an unmigrated call site.

Rejected: throwing the existing `ApiError` shape with `status: 401`.
The failure never reached the network, so calling it an HTTP 401 is a lie that would confuse anyone reading a stack trace or a log, and it would make the "did we send an anonymous request" question unanswerable from the error alone.

### D2 - `token` becomes REQUIRED at the type level, non-empty at runtime

`apiFetch` and `apiFetchBlob` change from

```ts
init?: RequestInit & { token?: string }
```

to

```ts
init: RequestInit & { token: string }
```

and each calls `assertBearerToken(token)` before touching `fetch`.

Justification for making it required:

- Every existing call site already passes `token`. All of them live in exactly two files, `apps/web/src/lib/api-client.ts` (the ~40 typed API objects at the bottom of that file, plus `adminPayoutsApi.downloadCsv` for the blob variant) and `apps/web/src/sales-ops/api.ts` (12 call sites, all `{ ..., token }`). There is no anonymous endpoint in this app; the only public route (`/r/:code`) is served by the API and is never fetched from the SPA. So requiring it costs zero migration and permanently removes the "forgot the token entirely" failure mode from the type checker's blind spot.
- The old optionality was vestigial. The header comment on the file still says "In the template, no pages call this", which is why the parameter was ever optional. That template is long gone.
- With `token` optional, `apiFetch('/x', { method: 'GET' })` type-checks and silently sends an anonymous request. That is the same class of defect as the one this slice is fixing, one layer down.

Justification for NOT going further to a branded token type:

- TypeScript cannot express "non-empty string", so a brand (`type BearerToken = string & { readonly __bearer: unique symbol }`) is the only way to move the emptiness check to compile time.
- It would be viral: every one of the ~52 `token: string` / `token: Token` parameters in `api-client.ts` and `sales-ops/api.ts` would have to change, and any `as BearerToken` cast anywhere would defeat it silently.
- It buys nothing the runtime guard does not already buy, because `requireToken` is the single producer of tokens in the app after this slice, and the runtime guard at the chokepoint catches every path including a cast.

So: required at the type level (what TS can prove), non-empty at runtime (what it cannot).

### D3 - the panel distinguishes an auth failure from an API fault

`apps/web/src/sales-ops/SalesOpsApp.tsx` line 1334 currently renders one `EmptyPanel` for every `isError`.
It gains one ternary, inside the existing shape, selecting between two `EmptyPanel` prop sets.
No new component, no new layout, no change to `EmptyPanel` itself.

`isAuthFailure` deliberately covers TWO cases, not one:

- `AuthTokenUnavailableError` - the fix in this slice, no token was available.
- an `ApiError` with `status === 401` - a token WAS sent but the API rejected it.

Covering only the first would leave the exact same misleading message on the stale-token path, which is the other half of S1.
The second case costs a two-property duck-type check and no extra branch in the UI.

### D4 - query retry stays at `retry: 1`

`apps/web/src/App.tsx` sets `retry: 1` for queries.
An `AuthTokenUnavailableError` therefore triggers one retry, which calls `getToken()` a second time.
This is left unchanged on purpose: after slice 01 and slice 03 land, a second read can legitimately succeed once an in-flight refresh completes, so the retry is a free recovery attempt, and `App.tsx` is shared surface this slice has no other reason to touch.
Recorded here so a reviewer does not read the omission as an oversight.

### D5 - the eslint ban: YES

Recommend adding it, for the same reason the native-picker ban exists: this is a pattern that reads as harmless at every individual call site and is catastrophic in aggregate, and it was copy-pasted into 37 places precisely because nothing stopped it.
Without a rule, the next hook written by pattern-matching a neighbour reintroduces it, and the failure mode is silent (an anonymous request that looks like a server outage), so nobody notices until a partner reports it.

The selector bans `await getToken()` on the left of ANY `??`, not just `?? ''`:

```
LogicalExpression[operator='??'] > AwaitExpression.left > CallExpression[callee.name='getToken']
```

Banning every fallback rather than only the empty string is deliberate.
There is no legitimate default for a missing access token - `?? undefined`, `?? 'anonymous'` and `?? ''` are all the same defect - and matching an empty-string literal through esquery's attribute syntax is the one part of the selector that could silently fail to match.
`await requireToken(getToken)` does not match, so the migrated form is unaffected.

## Files

### 1. CREATE `apps/web/src/lib/require-token.ts`

New file. Full intended content:

```ts
/**
 * The one door between "the auth layer may not have a token" and "this request
 * carries a bearer token".
 *
 * Before this module, `(await getToken()) ?? ''` was copy-pasted at 37 call
 * sites. `apiFetch` treats `''` as falsy and omits the Authorization header
 * entirely, so a missing token produced an anonymous request, a 401, and a
 * generic "the API is broken" panel - an auth failure displayed as a server
 * fault. A missing token now throws before any request is built.
 *
 * This module imports NOTHING, and must keep importing nothing: `api-client.ts`
 * imports it, so any import back the other way is a cycle. That is why the 401
 * branch of `isAuthFailure` duck-types instead of importing `ApiError`.
 */

const AUTH_TOKEN_UNAVAILABLE = 'AuthTokenUnavailableError';

export class AuthTokenUnavailableError extends Error {
  constructor(message = 'Nenhum token de acesso do Hub disponível para esta requisição.') {
    super(message);
    this.name = AUTH_TOKEN_UNAVAILABLE;
  }
}

/**
 * Name-based as well as `instanceof`, so a duplicated module instance (HMR, a
 * second bundle chunk) cannot make a real auth failure read as an API fault.
 */
export function isAuthTokenUnavailableError(error: unknown): error is AuthTokenUnavailableError {
  if (error instanceof AuthTokenUnavailableError) return true;
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { name?: unknown }).name === AUTH_TOKEN_UNAVAILABLE
  );
}

/**
 * True for both halves of an auth failure: no token was available (this slice),
 * and a token was sent but rejected (a stale access token). Both must read as
 * "your session ended", never as "the server is down".
 */
export function isAuthFailure(error: unknown): boolean {
  if (isAuthTokenUnavailableError(error)) return true;
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { status?: unknown }).status === 401
  );
}

/** TypeScript cannot express "non-empty string", so emptiness is a runtime check. */
export function assertBearerToken(token: unknown): asserts token is string {
  if (typeof token !== 'string' || token.trim() === '') {
    throw new AuthTokenUnavailableError();
  }
}

export async function requireToken(getToken: () => Promise<string | null>): Promise<string> {
  const token = await getToken();
  assertBearerToken(token);
  return token;
}
```

Note on `this.name = ...` in the constructor rather than a class field: `apps/web/tsconfig.json` sets `useDefineForClassFields: true`, and constructor assignment has no `[[Define]]` versus `[[Set]]` subtlety to reason about.
`target` is `ES2022`, so `extends Error` keeps a working prototype chain and `instanceof` is sound.

### 2. MODIFY `apps/web/src/lib/api-client.ts`

Three changes.

a. Add the import at the top of the file, above `const baseUrl`:

```ts
import { assertBearerToken } from './require-token';
```

Use the relative `./require-token`, not `@/lib/require-token`: this file already sits in `src/lib`, and the `@` alias is reserved in this file for the cross-tree type imports lower down.

b. Fix the stale usage comment. Line 5 currently reads

```
 *   useQuery({ queryKey: ['items'], queryFn: () => apiFetch<Item[]>('/items') })
```

Replace that line, and the "Auth" lines under it, with:

```
 *   useQuery({ queryKey: ['items'], queryFn: async () => apiFetch<Item[]>('/items', {
 *     method: 'GET', token: await requireToken(getToken),
 *   }) })
 *
 * Auth: `token` is REQUIRED and must be non-empty. It comes from
 * requireToken(getToken) in ./require-token, never from `(await getToken()) ?? ''`
 * - a blank token used to be laundered into a header-less anonymous request.
```

c. Change both signatures and add the guard.

`apiFetch`:

```ts
export async function apiFetch<T>(
  path: string,
  init: RequestInit & { token: string },
): Promise<T> {
  const { token, headers, ...rest } = init;
  // Throws BEFORE fetch: an empty token must never become an anonymous request.
  assertBearerToken(token);
  const res = await fetch(`${baseUrl}${path}`, {
    ...rest,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      ...headers,
    },
  });
  // ... rest of the body unchanged
```

`apiFetchBlob`:

```ts
export async function apiFetchBlob(
  path: string,
  init: RequestInit & { token: string },
): Promise<{ blob: Blob; filename: string | null }> {
  const { token, headers, ...rest } = init;
  assertBearerToken(token);
  const res = await fetch(`${baseUrl}${path}`, {
    ...rest,
    headers: {
      Authorization: `Bearer ${token}`,
      ...headers,
    },
  });
  // ... rest of the body unchanged
```

Note that `const { token, headers, ...rest } = init ?? {}` becomes `= init` in both, since `init` is no longer optional.
The conditional spread `...(token ? { Authorization: ... } : {})` is replaced by an unconditional `Authorization` in both, because the guard above has already proven the token is a non-empty string.
Nothing else in the file changes; none of the ~40 API objects at the bottom need edits, because every one of them already passes `token`.

### 3. MODIFY `apps/web/src/sales-ops/hooks.ts`

Delete the local helper at lines 34-36:

```ts
async function requireToken(getToken: () => Promise<string | null>): Promise<string> {
  return (await getToken()) ?? '';
}
```

Replace it with an import, placed with the other `@/lib` imports (after `import { useAppMutation } from '@/lib/app-mutation';`):

```ts
import { requireToken } from '@/lib/require-token';
```

Every existing `await requireToken(getToken)` call in this file (13 of them, in `useSalesOpsBootstrap` and the nine mutation hooks) is unchanged - only the binding it resolves to changes.
Delete, do not delegate: a one-line local wrapper around the shared helper is a second name for the same thing and the next reader has to check whether they differ.

### 4. MODIFY the 10 call-site files

Uniform mechanical transformation, everywhere:

```
(await getToken()) ?? ''      ->      await requireToken(getToken)
```

plus, once per file, the import:

```ts
import { requireToken } from '@/lib/require-token';
```

placed in the existing `@/`-prefixed import group, alphabetically among the other `@/lib/...` imports where one exists.

Full list of the 37 call sites, verified by `grep -rn "getToken()) ?? ''" apps/web/src`:

| File | Lines |
| --- | --- |
| `apps/web/src/admin/apps/useApps.ts` | 18, 26, 35, 47, 60, 72 |
| `apps/web/src/admin/audit/useAuditLog.ts` | 16, 24 |
| `apps/web/src/admin/commissions/useAdminCommissions.ts` | 19, 28, 37 |
| `apps/web/src/admin/conversions/useConversions.ts` | 15 |
| `apps/web/src/admin/finders/hooks/useFinders.ts` | 18, 27, 35, 47 |
| `apps/web/src/admin/payouts/usePayouts.ts` | 21, 30, 39, 48, 65 |
| `apps/web/src/admin/products/useProducts.ts` | 163, 172, 182, 201, 218, 227 |
| `apps/web/src/admin/sellers/hooks/useSellers.ts` | 16, 25 |
| `apps/web/src/finder/clicks/useClicks.ts` | 18, 27 |
| `apps/web/src/finder/links/useLinks.ts` | 25, 34, 43, 53, 62, 71 |

All 37 sit inside an `async` arrow that is already a TanStack `queryFn` or `mutationFn`, so the throw propagates into query/mutation error state with no further wiring.
The only site whose formatting is not a single inline expression is `usePayouts.ts:65`, inside `useDownloadPayoutCsv`, which reads:

```ts
      const { blob, filename } = await adminPayoutsApi.downloadCsv(
        payoutId,
        (await getToken()) ?? '',
      );
```

and becomes:

```ts
      const { blob, filename } = await adminPayoutsApi.downloadCsv(
        payoutId,
        await requireToken(getToken),
      );
```

Let prettier decide whether the shortened lines re-wrap; run `pnpm run lint` after and fix whatever it reports.

After the migration, `grep -rn "getToken()) ?? ''" apps/web/src` must print nothing.

### 5. MODIFY `apps/web/src/sales-ops/SalesOpsApp.tsx`

Add to the existing `@/lib/...` import group near the top:

```ts
import { isAuthFailure } from '@/lib/require-token';
```

Replace the block at lines 1334-1339:

```tsx
            {bootstrapQuery.isError ? (
              <EmptyPanel
                text="A API de vendas não respondeu corretamente. Verifique o servidor local e tente novamente."
                title="Não foi possível carregar"
              />
            ) : null}
```

with:

```tsx
            {bootstrapQuery.isError ? (
              isAuthFailure(bootstrapQuery.error) ? (
                /*
                  An expired or unrenewable Hub session used to render as the API-fault
                  panel below, so a logged-out operator was told the server was broken.
                  Covers both halves: no token was available, and a token the API rejected.
                */
                <EmptyPanel
                  text="Sua sessão do FXL Hub expirou ou não pôde ser renovada. Atualize a página para entrar novamente."
                  title="Sessão expirada"
                />
              ) : (
                <EmptyPanel
                  text="A API de vendas não respondeu corretamente. Verifique o servidor local e tente novamente."
                  title="Não foi possível carregar"
                />
              )
            ) : null}
```

Nothing else in this file changes.
`EmptyPanel` is untouched.
Note the copy contains no em dash.

### 6. MODIFY `apps/web/eslint.config.js`

Append a fifth entry to the existing `no-restricted-syntax` array, after the `input[type=number]` entry:

```js
        {
          selector:
            "LogicalExpression[operator='??'] > AwaitExpression.left > CallExpression[callee.name='getToken']",
          message:
            'A missing access token must never be defaulted. Use `await requireToken(getToken)` from @/lib/require-token; `(await getToken()) ?? ""` sends an anonymous request that surfaces as a generic server fault.',
        },
```

Keep the existing four entries exactly as they are.

### 7. MODIFY `CLAUDE.md`

Append one bullet at the end of the `## Auth Model` section, immediately after the existing "Browser Hub access tokens are memory-only..." bullet (currently line 26), before the blank line and `## Tenancy`:

```markdown
- A missing access token is never defaulted.
  `requireToken(getToken)` in `apps/web/src/lib/require-token.ts` throws `AuthTokenUnavailableError`, and `apiFetch` / `apiFetchBlob` take a REQUIRED non-empty `token` and assert it before calling `fetch`, so a null token can never become an anonymous request that reads as a server outage.
  `no-restricted-syntax` in `apps/web/eslint.config.js` fails lint if `(await getToken()) ?? ...` comes back.
  The sales-ops error panel routes `isAuthFailure` (an unavailable token, or an `ApiError` with `status: 401`) to `Sessão expirada` rather than to the generic API-fault copy.
```

One sentence per line, per the house Markdown convention.

## Oracle tests

### Named oracle: `apps/web/src/sales-ops/__tests__/blank-bearer-token.test.tsx`

This is THE test for the slice.
It renders the real `SalesOpsApp` over the real `hooks.ts`, the real `sales-ops/api.ts` and the real `api-client.ts` - only `@/auth/react` and `@/components/ui/dialog` are mocked - and it observes the actual `fetch`.
It must NOT mock `../api`; mocking it removes exactly the code path under test.

Harness, copied from `apps/web/src/sales-ops/__tests__/cadastros-refresh.test.tsx`:

- File starts with `// @vitest-environment happy-dom`.
- `vi.hoisted` holds `{ getToken: vi.fn(), logout: vi.fn(async () => undefined) }`.
- `vi.mock('@/auth/react', () => ({ useAuthProfile: () => ({ isLoaded: true, isSignedIn: true, roles: ['admin'], name: 'Test User', email: 'test.user@fxl.example' }), useLogout: () => mocks.logout, useAccessToken: () => ({ getToken: mocks.getToken }) }))`. Those three are the only members `SalesOpsApp` (`useAuthProfile`, `useLogout`) and `hooks.ts` (`useAccessToken`) import from that module.
- `vi.mock('@/components/ui/dialog', ...)` with the same five passthrough stubs as `cadastros-refresh.test.tsx`.
- `import { SalesOpsApp } from '../SalesOpsApp';` AFTER the mock calls.
- `const act = (React as typeof React & { act: ... }).act;`
- `beforeEach` sets `IS_REACT_ACT_ENVIRONMENT = true`, creates the container, and installs `fetchMock = vi.fn()` via `vi.stubGlobal('fetch', fetchMock)`.
- `afterEach` unmounts the root, removes the container, `vi.unstubAllGlobals()`, `vi.clearAllMocks()`.
- `renderApp(path)` builds `new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })` and renders `<QueryClientProvider><MemoryRouter initialEntries={[path]}><Routes><Route element={<SalesOpsApp />} path="/:workspace/:view" /></Routes></MemoryRouter></QueryClientProvider>`, then flushes with `await act(async () => { await new Promise((r) => setTimeout(r, 0)); })` twice.
- Path used: `/tatico/dashboard`.

Three cases:

1. `it('does not issue a request when getToken resolves null')`
   - `mocks.getToken.mockResolvedValue(null)`.
   - `await renderApp('/tatico/dashboard')`.
   - `expect(fetchMock).not.toHaveBeenCalled()` - this is the primary assertion, and it is asserted against the real `fetch` spy, not against a thrown error.
   - `expect(mocks.getToken).toHaveBeenCalled()` - proves the query actually ran and the "no fetch" result is not vacuous because the component never mounted.

2. `it('renders a session-expired panel, not the generic API fault')`
   - Same setup as case 1.
   - `expect(container.textContent).toContain('Sessão expirada')`.
   - `expect(container.textContent).not.toContain('A API de vendas não respondeu corretamente')` - the misleading copy from S1 must be gone on this path.

3. `it('sends the Bearer header when a token IS available')` - the positive control.
   - `mocks.getToken.mockResolvedValue('hub-access-token')`.
   - `fetchMock.mockResolvedValue({ ok: true, json: async () => emptyBootstrapPayload })` where `emptyBootstrapPayload` is the twelve-key `SalesOpsBootstrap` shape with empty arrays and `settings: null` (same `snapshot()` helper shape as `cadastros-refresh.test.tsx`).
   - `expect(fetchMock).toHaveBeenCalledTimes(1)`.
   - Read the recorded call: `const [url, init] = fetchMock.mock.calls[0]`; assert `String(url)).toContain('/api/v1/sales-ops/bootstrap')` and `(init.headers as Record<string, string>).Authorization === 'Bearer hub-access-token'`.
   - This case is what makes case 1 meaningful: it proves the same harness DOES observe a fetch when one is issued, so `not.toHaveBeenCalled()` is a real signal rather than a broken spy.

Why case 1 asserts "no fetch at all" rather than "a fetch without a blank header": the fix makes the request never happen, which is strictly stronger than the acceptance wording "must NOT issue a fetch carrying an absent or blank Authorization header" and is not satisfiable by any implementation that still sends the request.

### Supporting test: `apps/web/src/lib/__tests__/api-client-token-guard.test.ts`

Node environment (no `// @vitest-environment` pragma needed; the config default is `node`), pinning the chokepoint on its own so a future refactor of the hooks cannot quietly remove the defence in depth.

- `beforeEach`: `fetchMock = vi.fn(); vi.stubGlobal('fetch', fetchMock);`
- `it('rejects an empty token without calling fetch')`: `await expect(apiFetch('/x', { method: 'GET', token: '' })).rejects.toBeInstanceOf(AuthTokenUnavailableError)` and `expect(fetchMock).not.toHaveBeenCalled()`.
- `it('rejects a whitespace-only token without calling fetch')`: same with `token: '   '`.
- `it('rejects an empty token in apiFetchBlob without calling fetch')`: same shape against `apiFetchBlob`.
- `it('sends Bearer for a real token')`: `fetchMock.mockResolvedValue({ ok: true, json: async () => ({ ok: 1 }) })`, call `apiFetch('/x', { method: 'GET', token: 'abc' })`, assert the recorded `init.headers.Authorization === 'Bearer abc'`.
- `it('requireToken throws when the reader resolves null')`: `await expect(requireToken(async () => null)).rejects.toBeInstanceOf(AuthTokenUnavailableError)`.
- `it('isAuthFailure recognises a 401 ApiError')`: `expect(isAuthFailure({ error: 'unauthorized', status: 401 })).toBe(true)` and `expect(isAuthFailure({ error: 'request_failed', status: 500 })).toBe(false)`.

## How to run

```bash
# the named oracle
pnpm --filter @fxl-sales/web exec vitest run src/sales-ops/__tests__/blank-bearer-token.test.tsx

# the chokepoint test
pnpm --filter @fxl-sales/web exec vitest run src/lib/__tests__/api-client-token-guard.test.ts

# full gates
pnpm run lint
pnpm run type-check
pnpm test
pnpm run build
```

Every invocation is run-once (`vitest run`), never a watcher.

Verify the new eslint rule actually fires, without leaving a file behind:

```bash
cd apps/web && printf 'export async function t(getToken: () => Promise<string | null>) {\n  return (await getToken()) ?? "";\n}\n' \
  | pnpm exec eslint --stdin --stdin-filename src/scratch-token-guard.ts
```

That must report the `no-restricted-syntax` error with the new message.
If it reports nothing, the esquery selector did not match and must be fixed before the slice is done - a rule that never fires is worse than no rule, because it reads as protection.
Confirm `git status` is clean of stray files afterwards.

## Verification checklist

1. `grep -rn "getToken()) ?? ''" apps/web/src` prints nothing.
2. `grep -rn "token?: string" apps/web/src/lib/api-client.ts` prints nothing.
3. The eslint stdin probe above reports the new error.
4. All four gate commands pass.
5. Both new test files pass, and case 3 of the named oracle (the positive control) passes - if it does not, cases 1 and 2 prove nothing.

## Risks

- **`init` becoming required breaks a call site this plan missed.** Mitigated: `grep -rn "apiFetch" apps/web/src` resolves to `api-client.ts` and `sales-ops/api.ts` only, and every call in both already passes `token`. `pnpm run type-check` catches any survivor immediately, and the fix is to pass the token.
- **The esquery field selector `AwaitExpression.left` does not match.** This is the single most fragile line in the slice. The stdin probe above is a required step precisely because of it. If the field syntax fails, fall back to `LogicalExpression[operator='??'][left.argument.callee.name='getToken']`, re-run the probe, and keep whichever matches.
- **`SalesOpsApp.tsx` merge conflict with slice 03.** Slice 03 owns `apps/web/src/auth/**` and may also want to change how a signed-out state renders. This slice touches exactly one JSX block in `SalesOpsApp.tsx` and no auth file, so a conflict is textual and local rather than semantic. Slices are sequenced, so the later one rebases.
- **Existing tests that mock `@/auth/react` without `useAccessToken`.** `routing.test.tsx` mocks only `useAuthProfile` and `useLogout`; if it ever reaches `hooks.ts` it would already be broken today, so nothing changes. If `pnpm test` surfaces one, the fix is to add `useAccessToken: () => ({ getToken: async () => 'test-token' })` to that file's mock factory, matching `cadastros-refresh.test.tsx`.
- **A user-visible behaviour change on the admin and finder trees.** Those hooks now reject instead of firing an anonymous request. They have no `isAuthFailure` panel branch, so they surface their existing generic error UI. That is still strictly better than a misleading 401, and adding branches to eight more screens is out of scope for this slice per the FRAME's "no redesign of the sales-ops error panel" limit.
- **Retry doubles the `getToken()` calls on the failure path.** By design (D4). `getToken` is memoised and shares one in-flight refresh per provider (CLAUDE.md, Auth Model), so the second read is cheap and may legitimately succeed.
