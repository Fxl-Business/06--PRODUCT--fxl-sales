# VERIFY report - slice 02-no-blank-bearer-token

- Branch: `feat/02-no-blank-bearer-token` (uncommitted)
- Auditor: independent VERIFY sub-agent (did not write the code)
- Started: 2026-08-03T15:31:00Z
- Ended: 2026-08-03T15:36:30Z
- Baseline `git diff master` sha1: `211a2545edd2b4dda64563328c46e95460beb211`
- Final `git diff master` sha1: `211a2545edd2b4dda64563328c46e95460beb211` (tree restored exactly)

## VERDICT: PASS

Every gate command passed, the named oracle was proven non-vacuous by mutation, and no audit point failed.
Four non-blocking observations are recorded at the end.

## 1. Gate commands (each run exactly once, run-once mode)

### `pnpm --filter @fxl-sales/web test`

```
 RUN  v3.2.7 /Users/cauetpinciara/Documents/fxl/projects/06--PRODUCT--fxl-sales/apps/web

 ... (43 files, all green) ...
 ✓ src/sales-ops/__tests__/blank-bearer-token.test.tsx (3 tests) 71ms
 ✓ src/lib/__tests__/api-client-token-guard.test.ts (6 tests) 3ms

 Test Files  43 passed (43)
      Tests  435 passed (435)
   Start at  12:32:52
   Duration  4.73s
```

PASS. Both new test files are collected and green. No pre-existing test regressed.

### `pnpm --filter @fxl-sales/web lint`

```
> @fxl-sales/web@1.0.0 lint /Users/.../apps/web
> eslint src/

(no output, exit 0)
```

PASS.

### `pnpm run type-check`

```
> fxl-sales@1.0.0 type-check
> pnpm run build:packages && pnpm -r type-check

Scope: 4 of 5 workspace projects
packages/shared-types type-check: Done
packages/shared-utils type-check: Done
apps/api type-check: Done
apps/web type-check: Done
```

PASS. Making `init` and `token` required broke no call site anywhere in the monorepo.

### `pnpm run lint`

```
> fxl-sales@1.0.0 lint
> pnpm -r lint

Scope: 4 of 5 workspace projects
packages/shared-types lint: no lint for shared-types
packages/shared-utils lint: no lint for shared-utils
apps/api lint: Done
apps/web lint: Done
```

PASS.

## 2. Audit point 1 - is the named oracle REAL or vacuous?

`apps/web/src/sales-ops/__tests__/blank-bearer-token.test.tsx` renders the real `SalesOpsApp` over the real
`hooks.ts`, the real `sales-ops/api.ts` and the real `api-client.ts`.
Only `@/auth/react` and `@/components/ui/dialog` are mocked; `../api` and `@/lib/api-client` are deliberately
NOT mocked (there is an explicit comment saying so).
`fetch` is replaced with a `vi.fn()` spy via `vi.stubGlobal`, so the assertions land on the ACTUAL fetch
invocation, not on a thrown error.

Assertion shapes confirmed by reading the file:

- Case 1 asserts `expect(fetchMock).not.toHaveBeenCalled()` plus `expect(mocks.getToken).toHaveBeenCalled()`
  (the second is the anti-vacuity guard proving the query really ran).
- Case 2 asserts on rendered text: contains `Sessão expirada`, does NOT contain
  `A API de vendas não respondeu corretamente`.
- Case 3 (positive control) reads `fetchMock.mock.calls[0]` and asserts the URL contains
  `/api/v1/sales-ops/bootstrap` and `init.headers.Authorization === 'Bearer hub-access-token'`.
  It genuinely produces a Bearer header - not merely "some call happened".

### Mutation experiment A - full pre-fix behaviour restored

Applied `git checkout master -- apps/web/src/lib/api-client.ts apps/web/src/sales-ops/hooks.ts`, which
restores exactly the two defects: the local `requireToken` returning `(await getToken()) ?? ''`, and
`apiFetch`'s optional token with `...(token ? { Authorization: ... } : {})`.

Confirmed the mutation landed:

```
34:async function requireToken(getToken: () => Promise<string | null>): Promise<string> {
35-  return (await getToken()) ?? '';
36-}
--- api-client header now:
28:      ...(token ? { Authorization: `Bearer ${token}` } : {}),
59:      ...(token ? { Authorization: `Bearer ${token}` } : {}),
```

`pnpm exec vitest run src/sales-ops/__tests__/blank-bearer-token.test.tsx`:

```
 FAIL  ... > does not issue a request when getToken resolves null
Received:
  1st spy call:
    Array [
      "http://localhost:3006/api/v1/sales-ops/bootstrap",
      Object {
        "headers": Object {
          "Content-Type": "application/json",
        },
        "method": "GET",
      },
    ]
Number of calls: 1

 FAIL  ... > renders a session-expired panel, not the generic API fault
AssertionError: expected 'FXLVendasWorkspaceTáticoVisão geralA …' to contain 'Sessão expirada'
Received: "...Não foi possível carregarA API de vendas não respondeu corretamente.
           Verifique o servidor local e tente novamente."

 Test Files  1 failed (1)
      Tests  2 failed | 1 passed (3)
```

RED, and the failure output reproduces the reported user-visible defect verbatim: a real fetch WAS issued,
its `headers` object carries `Content-Type` and NO `Authorization` at all, and the operator was shown the
server-outage copy.
The positive control (case 3) stayed green under the mutation, which proves the spy is not simply broken and
that `not.toHaveBeenCalled()` is a real signal.

### Mutation experiment B - only `hooks.ts` reverted, `apiFetch` guard kept

```
api-client restored:
35:      Authorization: `Bearer ${token}`,
67:      Authorization: `Bearer ${token}`,
hooks.ts still mutated:
35:  return (await getToken()) ?? '';
```

```
 ✓ src/sales-ops/__tests__/blank-bearer-token.test.tsx (3 tests) 45ms
 Test Files  1 passed (1)
      Tests  3 passed (3)
```

GREEN. This is the designed defence in depth (plan D2): `assertBearerToken` at the `apiFetch` chokepoint
catches the blank token even when a call site launders it, and it throws `AuthTokenUnavailableError`, so both
the "no fetch" and the "Sessão expirada" assertions still hold.
Recorded as observation F1 below, not a failure - the acceptance criterion is still met by this state, and the
eslint rule (audit point 3) is what pins the call-site spelling.

### Restore

Files restored from backup; `git diff master | shasum` returned `211a2545edd2b4dda64563328c46e95460beb211`,
identical to the baseline taken before any mutation.

```
 ✓ src/lib/__tests__/api-client-token-guard.test.ts (6 tests) 2ms
 ✓ src/sales-ops/__tests__/blank-bearer-token.test.tsx (3 tests) 45ms
 Test Files  2 passed (2)
      Tests  9 passed (9)
```

GREEN after restore.

**Verdict: PASS. The oracle is real, not vacuous.**

## 3. Audit point 2 - completeness of the migration

```
$ grep -rn "getToken()) ?? ''" apps/web/src
(none)

$ grep -rn "token?: string" apps/web/src
(none)

$ grep -rn "|| ''" apps/web/src
(no matches)

$ grep -rniE "token!" apps/web/src   # non-null assertions on a token
(none)

$ grep -rn "token: '" apps/web/src --include=*.ts --include=*.tsx | grep -v __tests__
(none)
```

Every remaining `?? ''` in `apps/web/src` was inspected: all are form-field / label / display defaults
(`settings?.legalName ?? ''`, `row.label ?? ''`, `rows[0]?.orgId ?? ''`, and similar). None involves a token.

All `getToken()` call sites in `apps/web/src` now resolve to exactly three groups:

- `apps/web/src/auth/**` - the token cache itself (out of scope, slice 03 owns it, untouched here).
- `apps/web/src/lib/require-token.ts:58` - the single producer.
- Comments in `api-client.ts` and `require-token.ts` quoting the banned pattern.

All 37 migrated call sites plus the 11 in `hooks.ts` now read `await requireToken(getToken)`.
`apiFetch` / `apiFetchBlob` callers resolve to `api-client.ts` and `sales-ops/api.ts` only; every one passes
`token`, and type-check proves it. The `PayoutBatchesPage.tsx` hit is a doc comment, not a call.

**Verdict: PASS. No survivor, no equivalent laundering.**

## 4. Audit point 3 - does the eslint selector actually fire?

Proven twice.

**(a) On real reverted code.** With `hooks.ts` reverted in mutation experiment B,
`pnpm --filter @fxl-sales/web lint` failed:

```
/Users/.../apps/web/src/sales-ops/hooks.ts
  35:17  error  A missing access token must never be defaulted. Use `await requireToken(getToken)` from
                @/lib/require-token; `(await getToken()) ?? ""` sends an anonymous request that surfaces as
                a generic server fault  no-restricted-syntax

✖ 1 problem (1 error, 0 warnings)
Exit status 1
```

This is stronger than a synthetic probe: the rule caught the actual historical defect at the actual line it
lived on.

**(b) Stdin probes across fallback spellings** (no file left behind, `--stdin-filename src/scratch-token-guard.ts`):

| Probe | Result |
| --- | --- |
| `(await getToken()) ?? ""` | ERROR (fires) |
| `(await getToken()) ?? undefined` | ERROR (fires) |
| `(await getToken()) ?? "anonymous"` | ERROR (fires) |
| `await requireToken(getToken)` (migrated form) | clean (correctly does not fire) |
| `(await getToken()) \|\| ""` | clean (not matched - see F2) |
| `const tk = await getToken(); return tk ?? ""` | clean (not matched - see F2) |
| `(await auth.getToken()) ?? ""` | clean (not matched - see F2) |

The plan's claimed behaviour - bans every `??` fallback on a direct `await getToken()`, leaves the migrated
form alone - is exactly what was observed. The `AwaitExpression.left` field selector does match; the
fallback selector documented in the plan's Risks section was not needed.

**Verdict: PASS. The rule is real protection, not decoration.**

## 5. Audit point 4 - the runtime assert runs before fetch, no caller broken

Read `apps/web/src/lib/api-client.ts` directly. In both functions `assertBearerToken(token)` is the statement
immediately after the destructure and strictly before `await fetch(...)`:

```ts
const { token, headers, ...rest } = init;
// Throws BEFORE fetch: an empty token must never become an anonymous request.
assertBearerToken(token);
const res = await fetch(`${baseUrl}${path}`, { ... });
```

The conditional spread is gone in both; `Authorization` is now unconditional, which is sound because the
assert has already proven the token is a non-empty string.

`api-client-token-guard.test.ts` pins this independently with `expect(fetchMock).not.toHaveBeenCalled()` for
`token: ''`, `token: '   '` (whitespace-only, exercising the `.trim()` branch), and the `apiFetchBlob` variant.

No caller was broken: `pnpm run type-check` is green across all four workspaces, and no call site was given a
placeholder to satisfy the type (`grep "token: '"` outside tests returns nothing; no `token!` non-null
assertions exist).
`require-token.ts` imports nothing, so the `api-client.ts -> require-token.ts` edge cannot become a cycle.

**Verdict: PASS.**

## 6. Audit point 5 - does the panel distinguish auth failure from a real API fault?

Verified empirically with a throwaway probe test built on the oracle's own harness (real `SalesOpsApp`, real
`api-client.ts`, stubbed `fetch`), run once and then deleted:

| Scenario | Bearer sent | Panel rendered | Result |
| --- | --- | --- | --- |
| `getToken()` resolves null | no fetch at all | `Sessão expirada` | as intended |
| API answers 401 with a real token | `Bearer stale-token` (asserted) | `Sessão expirada` | as intended |
| API answers 500 | yes | `A API de vendas não respondeu corretamente` | server fault NOT swallowed |
| API answers 404 | yes | `A API de vendas não respondeu corretamente` | server fault NOT swallowed |

```
 ✓ src/sales-ops/__tests__/zz-probe-error-panel.test.tsx (3 tests) 45ms
 Test Files  1 passed (1)
      Tests  3 passed (3)
```

The 500 case additionally asserted `not.toContain('Sessão expirada')`, so a genuine server error cannot be
mislabelled as an expired session. The 401 case additionally asserted the Authorization header was actually
present, proving that branch is the "token sent and rejected" half rather than the "no token" half.

`isAuthFailure` is a strict `status === 401` equality plus the `AuthTokenUnavailableError` name/instanceof
check, so no other status can reach the auth branch. Probe file deleted; `git status` confirms it is gone.

**Verdict: PASS. Real server errors are not swallowed.**

## 7. Audit point 6 - CLAUDE.md compliance

- **Em dashes:** `git diff master | grep '^+' | grep '—'` returns nothing. The three new untracked files were
  also grepped directly: none. The implementer correctly used a plain dash in every prose line, including the
  `- a blank token used to be laundered...` continuation in the `api-client.ts` header comment.
- **CHANGELOG / generated files:** `git diff master --name-only` matched nothing against
  `changelog|generated|\.lock|drizzle`. No auto-generated file was hand-edited.
- **One sentence per line** in the added CLAUDE.md bullet: satisfied (4 lines, 4 sentences).
- **Accuracy of the added paragraph**, claim by claim, each checked against the code:
  1. "`requireToken(getToken)` ... throws `AuthTokenUnavailableError`" - accurate (`require-token.ts:57-61`).
  2. "`apiFetch` / `apiFetchBlob` take a REQUIRED non-empty `token` and assert it before calling `fetch`" -
     accurate, verified by source reading and by the chokepoint test.
  3. "`no-restricted-syntax` ... fails lint if `(await getToken()) ?? ...` comes back" - accurate, proven by
     the real-code lint failure in mutation experiment B and by the stdin probes.
  4. "The sales-ops error panel routes `isAuthFailure` (an unavailable token, or an `ApiError` with
     `status: 401`) to `Sessão expirada`" - accurate, proven by the probe table above.

No overclaim found. The paragraph does not, for example, claim the admin/finder trees got the same panel,
which they did not.

**Verdict: PASS.**

## 8. Audit point 7 - scope

```
$ git diff master --name-only | grep -vE "^(apps/web/|CLAUDE\.md$)"
(none)

$ git diff master --name-only | grep -E "^(apps/web/src/auth/|apps/api/)"
(none)
```

All 15 modified files are under `apps/web/**` or are `CLAUDE.md`. The 3 new untracked source files are all
under `apps/web/src/**`.
`apps/web/src/auth/**` (slice 03's territory) and `apps/api/**` (slice 01's) are untouched.

Untracked files present that are not this slice's source: `.vscode/` (pre-existing at session start, per the
session's own git snapshot) and `nexo/runs/batch-20260803-auth-session/verify-02-exec-report.md` (the
implementer's run record, deliberately not read by this auditor).

**Verdict: PASS. No scope violation.**

## 9. Tree restoration

- `git diff master | shasum` = `211a2545edd2b4dda64563328c46e95460beb211`, identical to the pre-audit baseline.
- `diff` against the pre-mutation backups of `api-client.ts`, `hooks.ts` and `SalesOpsApp.tsx`: all identical.
- Probe test file `zz-probe-error-panel.test.tsx` deleted; `git status --porcelain` matches the state found at
  the start exactly.
- No long-running process was started; all vitest and eslint invocations were run-once and exited on their own.

## 10. Non-blocking observations

**F1 - the oracle does not independently pin the call-site migration.**
Mutation experiment B showed all three cases stay green with `hooks.ts` reverted, because the `apiFetch`
chokepoint alone satisfies them. That is the intended defence in depth (plan D2) and the eslint rule covers
the call-site spelling with a hard lint failure, so the combination is sound. Worth knowing if someone ever
weakens the chokepoint and assumes the oracle still guards the hooks.

**F2 - eslint selector gaps.**
The selector does not match `(await getToken()) || ''`, a two-step launder (`const tk = await getToken();
tk ?? ''`), or a method-call form (`(await auth.getToken()) ?? ''`). The first two produce `''` and are caught
at runtime by `assertBearerToken`; only a two-step launder to a non-empty fake string would slip both, which
is a contrived case. Not worth widening the selector now, but recording it so nobody reads the rule as total.

**F3 - admin and finder trees have no auth-failure panel.**
Those hooks now reject instead of firing an anonymous request, and surface their existing generic error UI.
The plan documents this in its Risks section as an accepted out-of-scope limit, and it is still strictly
better than the previous misleading 401. Worth a follow-up doubt if those screens matter.

**F4 - pre-existing em dash outside this diff.**
`apps/web/src/admin/payouts/PayoutBatchesPage.tsx:41` contains an em dash in a comment. It predates this
branch and is not part of this diff, so it is not a compliance failure for this slice, but it is a house-style
violation sitting in the tree.
