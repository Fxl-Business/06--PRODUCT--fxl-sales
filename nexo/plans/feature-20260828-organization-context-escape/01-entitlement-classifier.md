---
id: 01-entitlement-classifier
milestone: v2.8.0
status: done
depends_on: []
files_modified: [apps/web/src/lib/api-client.ts, apps/web/src/lib/require-token.ts, apps/web/src/lib/__tests__/api-client-token-guard.test.ts]
acceptance: "given the API answers 402 {error: 'payment_required', code: 'missing_entitlement'}, when apiFetch or apiFetchBlob rejects, then the thrown ApiError carries that code and isEntitlementFailure(error) is true while isAuthFailure(error) is false"
goal: Make a 402 missing_entitlement classifiable in the web app, distinctly from a transport failure, a server fault, and an auth failure.
must_not_break:
  - isAuthFailure stays true for a 401 and for AuthTokenUnavailableError
  - isAuthFailure stays FALSE for the 402, so the "Sessao expirada" copy is unreachable for it
  - the empty-token chokepoint in apiFetch and apiFetchBlob (assertBearerToken before fetch)
  - require-token.ts keeps importing NOTHING, so no import cycle with api-client.ts
  - every existing test in apps/web
rules:
  - no em dash and no en dash on any added line, plain hyphen only
  - do not change the API, the 402 status, or the 402 body
  - do not upgrade @fxl-business/hub-sdk
  - do not touch apps/web/src/auth/react.tsx or apps/web/src/sales-ops/SalesOpsApp.tsx, they belong to other slices
  - do not import ApiError (or anything else) into require-token.ts
verifier_focus: that isEntitlementFailure keys on status 402 alone and stays narrow, and that the oracle genuinely fails when the code field is dropped from the ApiError construction in EITHER apiFetch or apiFetchBlob
---

# 01 - Classify the entitlement 402

## Context

An operator whose active Hub Organization does not carry FXL Sales gets `402 {error: 'payment_required', code: 'missing_entitlement'}` on every API call, and the shell renders that as "A API de vendas nao respondeu corretamente. Verifique o servidor local e tente novamente." The frame is in `00-OVERVIEW.md`.

Before any panel can be built, the failure has to be nameable. Today it is not. `ApiError` in `apps/web/src/lib/api-client.ts` keeps only `{error, message, status}` and DROPS the body's `code`, so nothing downstream of `apiFetch` can even see `missing_entitlement`. And there is no predicate that separates a 402 from a 500.

This slice is the classifier and nothing else. It renders nothing, changes no copy, and adds no dependency. Slices 03 and 04 consume what it produces.

### Verified facts this plan is built on

- `apps/api/src/middleware/app-auth.ts:172` is the ONLY place in the whole of `apps/api/src` that emits a 402. Verified with `grep -rn "402\|payment_required\|missing_entitlement" apps/api/src`, which returns exactly one line. So status 402 and `missing_entitlement` are the same event, and keying on the status loses no precision.
- `apps/web/src/lib/require-token.ts` documents, in its module header, that it imports NOTHING and must keep importing nothing, because `api-client.ts` imports `assertBearerToken` from it. That is why `isAuthFailure` duck-types the 401 instead of importing `ApiError`. The new predicate obeys the same rule.
- `isAuthFailure` today is `isAuthTokenUnavailableError(error) || status === 401`. It checks 401 and only 401, so it is ALREADY false for a 402. Nothing about it needs to change; it needs to be pinned, so a later "helpful" widening to "any 4xx is an auth problem" fails a test instead of silently restoring the wrong copy.
- `apiFetch` and `apiFetchBlob` carry byte-identical error-construction blocks. Both must change, and must stay identical.
- The web test runner is vitest 3.2.7 with `apps/web/vitest.config.ts`, `environment: 'node'`, include `src/**/__tests__/**/*.test.ts(x)`. The existing tests stub fetch with `vi.stubGlobal('fetch', vi.fn())` in `beforeEach` and `vi.unstubAllGlobals()` in `afterEach`.

## The design decision

**Status 402 is sufficient. `code` is NOT required.**

The predicate is exactly:

```ts
export function isEntitlementFailure(error: unknown): boolean {
  return (
    typeof error === 'object' && error !== null && (error as { status?: unknown }).status === 402
  );
}
```

Why `code` is corroborating rather than required:

- There is exactly one 402 in this API, verified by grep above. Requiring `code` buys zero additional discrimination today.
- It costs real robustness. A web build talking to an older API build, or any path where the 402 body fails to parse (the error branch does `res.json().catch(() => ({}))`, so a body-less or non-JSON 402 yields `{}` and `body.code` is `undefined`), would classify as NOT an entitlement failure and fall straight back to the "verifique o servidor local" panel. That is the exact defect this feature exists to remove, reappearing silently and with a green suite.
- The failure modes are asymmetric. Requiring `code` fails CLOSED into a lie about the server being down. Keying on status fails, at worst, by showing the entitlement panel for some hypothetical future 402 that does not exist yet; and if such a 402 is ever added, the grep above is the guard that will notice.

Why the predicate is still narrow: `status === 402`, nothing else. No `>= 400`, no `error === 'payment_required'` alternative, no "or code is missing_entitlement without a status". Only a 402 may reach the missing-entitlement panel. The `code` is preserved on `ApiError` so that a later slice, a log line, or a human debugging in the console can read it, not so that the classifier can branch on it.

Why `isAuthFailure` is left alone: it is already correct for this case. Changing it is the only way to break it, so the change is a test, not a code edit.

## Implementation

### Step 1 - `apps/web/src/lib/api-client.ts`

1a. Add the optional field to the `ApiError` type. It goes directly after `error`, and carries this comment verbatim:

```ts
export type ApiError = {
  error: string;
  /**
   * The API's machine-readable sub-reason, when it sends one. Today the only
   * one that matters is `missing_entitlement` on a 402. Optional because an
   * older API build, or a 402 whose body does not parse, sends no `code` at
   * all - classification therefore keys on `status`, never on this field. See
   * `isEntitlementFailure` in ./require-token.
   */
  code?: string;
  message?: string;
  status: number;
};
```

1b. In `apiFetch`, in the `if (!res.ok)` branch, add `code: body.code,` between `error:` and `message:` so the constructed object reads:

```ts
    const err: ApiError = {
      error: body.error ?? 'request_failed',
      code: body.code,
      message: body.message,
      status: res.status,
    };
```

1c. Make the IDENTICAL edit in `apiFetchBlob`'s `if (!res.ok)` branch. The two blocks are duplicated on purpose and must stay character-for-character the same; a payout CSV download hitting the entitlement gate has to classify exactly like a JSON read.

No other change to this file. Do not refactor the two blocks into a shared helper in this slice: that is a second, unrelated change, and it would put the extraction on the critical path of a wave-1 slice that four later slices depend on.

### Step 2 - `apps/web/src/lib/require-token.ts`

Add `isEntitlementFailure` immediately BELOW `isAuthFailure` and ABOVE `assertBearerToken`, so the two classifiers sit together. Add no imports. The file header's closing paragraph ("This module imports NOTHING, and must keep importing nothing") already states the rule that governs this addition and needs no edit.

The exported function, with this doc comment verbatim:

```ts
/**
 * True for the entitlement gate's 402, and for nothing else.
 *
 * `apps/api/src/middleware/app-auth.ts` answers
 * `402 {error: 'payment_required', code: 'missing_entitlement'}` when the active
 * Hub Organization does not carry FXL Sales. That 402 is CORRECT; what was wrong
 * was that nothing could tell it apart from a dead server, so it rendered as
 * "verifique o servidor local".
 *
 * It keys on the STATUS alone. That 402 is the only 402 this API emits, so `code`
 * adds no discrimination, and requiring it would fail closed: an older API build,
 * or a 402 whose body does not parse, carries no `code` and would silently land
 * back on the server-fault copy. `ApiError.code` is preserved for reading, not
 * for branching. The predicate stays deliberately narrow - `status === 402` and
 * nothing looser - because only this one failure may reach the entitlement panel.
 *
 * Duck-typed rather than `instanceof ApiError`, for the reason given at the top
 * of this file: importing api-client.ts back would be a cycle.
 */
export function isEntitlementFailure(error: unknown): boolean {
  return (
    typeof error === 'object' && error !== null && (error as { status?: unknown }).status === 402
  );
}
```

Do NOT touch `isAuthFailure`, `isAuthTokenUnavailableError`, `assertBearerToken` or `requireToken`.

### Step 3 - the oracle

**Chosen file: EXTEND `apps/web/src/lib/__tests__/api-client-token-guard.test.ts`.** No sibling file is created.

Reason: the load-bearing new assertion is a NEGATIVE one about `isAuthFailure`, which lives in that file's `describe('require-token helpers')` block. Splitting the 402 story across two files puts the "402 is not an auth failure" pin away from the 401 pin it constrains, and the next person widening `isAuthFailure` would read only one of them. The existing fetch stubbing harness (`beforeEach` / `afterEach` with `vi.stubGlobal`) is also reused as-is.

3a. Extend the import line to bring in the new predicate:

```ts
import { AuthTokenUnavailableError, isAuthFailure, isEntitlementFailure, requireToken } from '../require-token';
```

3b. Append ONE new `describe` block at the end of the file. These five test names are the locked oracle and must appear exactly as written:

```
describe('402 missing_entitlement classification')
  it('isEntitlementFailure recognises the 402 missing_entitlement ApiError')
  it('isEntitlementFailure is false for a 401, a 500, an AuthTokenUnavailableError and a non-object')
  it('isEntitlementFailure is true for a 402 that carries no code at all')
  it('isAuthFailure is false for the 402 missing_entitlement ApiError')
  it('apiFetch surfaces the body code on the thrown ApiError for a 402')
  it('apiFetchBlob surfaces the body code on the thrown ApiError for a 402')
```

What each asserts:

1. `isEntitlementFailure({ error: 'payment_required', code: 'missing_entitlement', status: 402 })` is `true`.
2. `false` for each of: `{ error: 'unauthorized', status: 401 }`, `{ error: 'request_failed', status: 500 }`, `new AuthTokenUnavailableError()`, and a non-object (assert on `null`, `undefined` and the string `'402'`; the string case is what pins that the check is `===` and not `==` or a coercion).
3. `isEntitlementFailure({ error: 'payment_required', status: 402 })` is `true`. This is the regression pin for the design decision above: it goes red the moment someone makes `code` mandatory.
4. `isAuthFailure({ error: 'payment_required', code: 'missing_entitlement', status: 402 })` is `false`. Add the one-line comment `// The 402 must never render "Sessao expirada" either.` above it.
5. Stub `fetchMock.mockResolvedValue({ ok: false, status: 402, json: async () => ({ error: 'payment_required', code: 'missing_entitlement' }) })`, then `await expect(apiFetch('/x', { method: 'GET', token: 'abc' })).rejects.toMatchObject({ error: 'payment_required', code: 'missing_entitlement', status: 402 })`. Assert `code` explicitly; a bare `rejects.toThrow` passes on the unfixed code.
6. Same stub shape for `apiFetchBlob('/x', { method: 'GET', token: 'abc' })`, same `toMatchObject`. This is what keeps the two duplicated error blocks from drifting.

Note on the stub: the existing passing-response test already stubs `{ ok: true, json: async () => ... }`, so a plain object literal is the established idiom here and no `Response` construction is needed. For the two error cases only the `ok`, `status` and `json` members are read before the throw, so nothing else has to be stubbed.

## Sequencing and dependencies

`depends_on: []`. This is wave 1 and shares no file with `02-organization-seam`. Steps 1 and 2 are independent of each other; step 3 needs both. Slices 03 and 04 consume `isEntitlementFailure`, so this must land first.

## Anticipated challenges

- `body` in the error branch is the untyped result of `res.json().catch(() => ({}))`, so `body.code` type-checks without a cast, exactly as `body.message` already does. If `tsc --noEmit` complains, the fix is NOT to add a cast at the call site but to check that nothing has narrowed `body`; the existing `body.error ?? ...` proves the shape is open.
- `code: body.code` writes `code: undefined` onto the object when the API sends no code. That is intentional and harmless: the field is optional, `exactOptionalPropertyTypes` is not in play in this tsconfig, and no test asserts key absence. Do not add a conditional spread to avoid it; that is noise.
- The temptation to also fix the sales-ops panel in this slice must be resisted. `SalesOpsApp.tsx` belongs to slice 04, and touching it here breaks parallel safety.

## Verification

Named locked oracle, RUN-ONCE:

```
pnpm --filter @fxl-sales/web exec vitest run src/lib/__tests__/api-client-token-guard.test.ts
```

(Confirmed working against this tree: 1 file, 6 tests passing before the change; 12 after.)

Plus lint on the changed files:

```
pnpm --filter @fxl-sales/web exec eslint src/lib/api-client.ts src/lib/require-token.ts src/lib/__tests__/api-client-token-guard.test.ts
```

Plus, since `ApiError` is a shared type:

```
pnpm --filter @fxl-sales/web type-check
```

A non-vacuity check the Verify agent should run by hand: delete `code: body.code,` from `apiFetchBlob` ONLY and re-run the oracle. Test 6 must go red on its own. If it does not, the blob path is untested and the slice is not done.
