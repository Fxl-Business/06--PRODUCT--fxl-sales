# Exec report - 02 no blank bearer token

Branch: `feat/02-no-blank-bearer-token`
Status: PASS
Scope respected: no file under `apps/api/**` and no file under `apps/web/src/auth/**` was touched.

## What changed, file by file

### Created

- `apps/web/src/lib/require-token.ts`
  New dependency-free module, verbatim from the plan's D1 content: `AuthTokenUnavailableError`, `isAuthTokenUnavailableError`, `isAuthFailure`, `assertBearerToken`, `requireToken`.
  It imports nothing, so `api-client.ts` can import it without forming a cycle.

- `apps/web/src/sales-ops/__tests__/blank-bearer-token.test.tsx`
  The named oracle. Renders the real `SalesOpsApp` over the real `hooks.ts`, the real `sales-ops/api.ts` and the real `api-client.ts`; `../api` is deliberately NOT mocked.
  Only `@/auth/react` and `@/components/ui/dialog` are mocked, and `fetch` is replaced with a `vi.fn()` spy via `vi.stubGlobal`.
  Three cases: (1) `getToken` resolves `null` -> `expect(fetchMock).not.toHaveBeenCalled()` plus `expect(mocks.getToken).toHaveBeenCalled()` so the negative cannot pass vacuously; (2) same setup asserts the panel says `Sessão expirada` and NOT `A API de vendas não respondeu corretamente`; (3) the positive control - a real token produces exactly one fetch whose recorded `init.headers.Authorization` is `Bearer hub-access-token`.

- `apps/web/src/lib/__tests__/api-client-token-guard.test.ts`
  The chokepoint test, six cases as specified: empty token, whitespace-only token, empty token through `apiFetchBlob` (all three reject with `AuthTokenUnavailableError` and never call `fetch`), a real token producing the Bearer header, `requireToken` rejecting on a null reader, and `isAuthFailure` accepting a duck-typed 401 while rejecting a 500.

### Modified

- `apps/web/src/lib/api-client.ts`
  Added `import { assertBearerToken } from './require-token';`.
  Replaced the stale template usage comment and the "Auth" lines.
  `apiFetch` and `apiFetchBlob` both went from `init?: RequestInit & { token?: string }` to `init: RequestInit & { token: string }`, from `= init ?? {}` to `= init`, gained an `assertBearerToken(token)` call before `fetch`, and their conditional `...(token ? { Authorization } : {})` spread became an unconditional `Authorization`.
  None of the ~40 API objects at the bottom needed edits; every one already passed `token`.

- `apps/web/src/sales-ops/hooks.ts`
  Deleted the local `requireToken` wrapper (`return (await getToken()) ?? '';`) and imported the shared one from `@/lib/require-token`. The 11 existing `await requireToken(getToken)` call sites in this file are textually unchanged; only the binding they resolve to changed.

- The 10 call-site files, 37 sites total, uniformly `(await getToken()) ?? ''` -> `await requireToken(getToken)` plus one `import { requireToken } from '@/lib/require-token';` placed after the existing `@/lib/query-keys` import (alphabetical, and all 10 files had that exact anchor line):
  `admin/apps/useApps.ts` (6), `admin/audit/useAuditLog.ts` (2), `admin/commissions/useAdminCommissions.ts` (3), `admin/conversions/useConversions.ts` (1), `admin/finders/hooks/useFinders.ts` (4), `admin/payouts/usePayouts.ts` (5), `admin/products/useProducts.ts` (6), `admin/sellers/hooks/useSellers.ts` (2), `finder/clicks/useClicks.ts` (2), `finder/links/useLinks.ts` (6).

- `apps/web/src/sales-ops/SalesOpsApp.tsx`
  Added `import { isAuthFailure } from '@/lib/require-token';` above the existing `@/lib/utils` import.
  Replaced the single `bootstrapQuery.isError` `EmptyPanel` with the plan's ternary between a `Sessão expirada` panel and the existing generic API-fault panel. `EmptyPanel` itself is untouched.

- `apps/web/eslint.config.js`
  Appended the fifth `no-restricted-syntax` entry with the plan's selector and message. The existing four entries are byte-identical.

- `CLAUDE.md`
  Appended the four-line bullet to the end of `## Auth Model`, one sentence per line.

## Red evidence

`pnpm exec vitest run src/sales-ops/__tests__/blank-bearer-token.test.tsx`, before any implementation existed:

```
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
 ❯ src/sales-ops/__tests__/blank-bearer-token.test.tsx:127:27
    127|     expect(fetchMock).not.toHaveBeenCalled();

 FAIL  ... > renders a session-expired panel, not the generic API fault
AssertionError: expected 'FXLVendasWorkspaceTáticoVisão geralA …' to contain 'Sessão expirada'
Received: "... Não foi possível carregarA API de vendas não respondeu corretamente. Verifique o servidor local e tente novamente."

 Test Files  1 failed (1)
      Tests  2 failed | 1 passed (3)
```

This is the defect verbatim: a real HTTP request WAS issued to the bootstrap endpoint carrying a `headers` object with `Content-Type` and **no `Authorization` key at all**, and the operator was shown the server-fault copy.
Case 3 (the positive control) passed in the Red run, which is correct - it is the control, and it proves the spy observes a fetch when one happens, so cases 1 and 2 failing is a real signal.

`pnpm exec vitest run src/lib/__tests__/api-client-token-guard.test.ts` failed to collect at all:

```
Error: Cannot find module '../require-token' imported from '.../src/lib/__tests__/api-client-token-guard.test.ts'
 Test Files  1 failed (1)
      Tests  no tests
```

## Green evidence

Both new test files:

```
 ✓ src/lib/__tests__/api-client-token-guard.test.ts (6 tests) 2ms
 ✓ src/sales-ops/__tests__/blank-bearer-token.test.tsx (3 tests) 47ms

 Test Files  2 passed (2)
      Tests  9 passed (9)
```

`pnpm --filter @fxl-sales/web test`:

```
 Test Files  43 passed (43)
      Tests  435 passed (435)
   Start at  12:30:37
   Duration  4.35s
```

`pnpm --filter @fxl-sales/web lint`:

```
> @fxl-sales/web@1.0.0 lint /Users/.../apps/web
> eslint src/
```

(no output, exit 0)

`pnpm run type-check`:

```
packages/shared-types type-check: Done
packages/shared-utils type-check: Done
apps/api type-check: Done
apps/web type-check: Done
```

## Eslint selector proof

The plan flagged `AwaitExpression.left` as the single most fragile line in the slice. The selector as written DOES fire; the fallback was not needed.

Positive probe (the banned form), via stdin so no file is left behind:

```
$ printf 'export async function t(getToken: () => Promise<string | null>) {\n  return (await getToken()) ?? "";\n}\n' \
  | pnpm exec eslint --stdin --stdin-filename src/scratch-token-guard.ts

/Users/.../apps/web/src/scratch-token-guard.ts
  2:17  error  A missing access token must never be defaulted. Use `await requireToken(getToken)` from @/lib/require-token; `(await getToken()) ?? ""` sends an anonymous request that surfaces as a generic server fault  no-restricted-syntax

✖ 1 problem (1 error, 0 warnings)
```

Negative probe (the migrated form must NOT fire) - no output, exit 0:

```
$ printf 'import { requireToken } from "@/lib/require-token";\nexport async function t(getToken: () => Promise<string | null>) {\n  return await requireToken(getToken);\n}\n' \
  | pnpm exec eslint --stdin --stdin-filename src/scratch-ok.ts
exit=0
```

Breadth probe (the rule bans EVERY fallback, not only `?? ''`, per D5):

```
$ printf 'export async function t(getToken: () => Promise<string | null>) {\n  return (await getToken()) ?? undefined;\n}\n' \
  | pnpm exec eslint --stdin --stdin-filename src/scratch2.ts
  2:17  error  A missing access token must never be defaulted. ...  no-restricted-syntax
✖ 1 problem (1 error, 0 warnings)
```

`git status` afterwards shows no scratch file.

## Verification checklist

1. `grep -rn "getToken()) ?? ''" apps/web/src` - prints nothing. PASS
2. `grep -rn "token?: string" apps/web/src/lib/api-client.ts` - prints nothing. PASS
3. Eslint stdin probe reports the new error. PASS (above)
4. `pnpm --filter @fxl-sales/web test`, `lint`, `pnpm run type-check` all pass. PASS. (`pnpm run build` and `pnpm test` at the repo root were not part of the assigned fast per-slice verify and were not run; the orchestrator's Gate 2 covers them.)
5. Both new test files pass, including case 3 of the named oracle. PASS
6. No em dash in any added line (`git diff -U0 | grep '^+.*—'` is empty). PASS
7. Nothing under `apps/api/**` or `apps/web/src/auth/**` is modified. PASS

## Deviations, all minor and noted

1. **The two doc comments do not carry the literal `?? ''`.**
   The plan's verbatim content for the `require-token.ts` header and the `api-client.ts` "Auth" comment both spell the old pattern as `` `(await getToken()) ?? ''` ``, but checklist item 1 requires `grep -rn "getToken()) ?? ''" apps/web/src` to print NOTHING.
   Those two are mutually exclusive. I kept the checklist - a guard grep that matches its own documentation is noise that will be ignored the next time it fires - and spelled the pattern in both comments as `` `(await getToken()) ?? ""` ``, which is exactly the spelling the plan itself uses in the eslint message. Meaning is unchanged; the grep is now clean.

2. **Four migrated lines were hand-wrapped to stay inside `printWidth: 100`.**
   The plan says "let prettier decide whether the shortened lines re-wrap", but `prettier` is not installed in this workspace (`pnpm exec prettier` reports `Command "prettier" not found`) and is not in the pre-commit hook, so there is nothing to run.
   The migration made four lines 101-103 characters that were <=100 at HEAD: `admin/products/useProducts.ts:219`, `finder/links/useLinks.ts:72`, `finder/clicks/useClicks.ts:28`, and `admin/apps/useApps.ts:27` and `:61`. I wrapped each after the arrow, the way prettier would, so the diff introduces no new over-width line. `apps/web/src/sales-ops/SalesOpsApp.tsx` is not prettier-formatted in this repo at all (hundreds of pre-existing >100 lines) and was left alone; `sales-ops/hooks.ts:174` was already 101 characters at HEAD and is untouched.

3. **A self-inflicted intermediate mangling, caught and fixed before any gate was claimed.**
   My first bulk `perl` invocation was written inside a single-quoted shell string containing `''`, which zsh collapsed, so the search pattern lost its trailing quotes and all 37 sites were rewritten to `await requireToken(getToken)''`. `pnpm --filter @fxl-sales/web test` caught it immediately as an esbuild parse error (`Expected ")" but found "''"`, 1 test file failed).
   The repair matched exactly 37 occurrences, which independently confirms the plan's call-site count. All gates above were run AFTER the repair. Nothing about this is present in the final diff.

## Notes for the reviewer

- `App.tsx` `retry: 1` was left unchanged, per D4. The oracle test builds its own `QueryClient` with `retry: false`, so `getToken` is called once per case there; production still gets its one free retry.
- The admin and finder trees now reject instead of firing an anonymous request, and surface their existing generic error UI rather than a session-expired panel. That is the documented D-level scope limit, not an oversight.
- No long-running process was started during this slice, so none was left behind.
