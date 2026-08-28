# Verify - slice 01-entitlement-classifier (Gate 2, fast tier)

Branch: `feat/01-entitlement-classifier`
Diff under test: `git diff master...HEAD`
Date: 2026-08-28

## Verdict

**PASS**

All three required commands are green, all four required mutations go RED, the
scope is exactly the four permitted files, the diff contains no em dash or en
dash, `require-token.ts` still imports nothing, and the full `apps/web` suite is
green at 724 tests.

## Commands run (run-once, no watchers)

### 1. Named oracle

```
pnpm --filter @fxl-sales/web exec vitest run src/lib/__tests__/api-client-token-guard.test.ts
```

```
 ✓ src/lib/__tests__/api-client-token-guard.test.ts (12 tests) 4ms
 Test Files  1 passed (1)
      Tests  12 passed (12)
```

Six tests existed before the slice; six were added.

### 2. Lint on the changed package

```
pnpm --filter @fxl-sales/web lint
```

Exit 0, no output. Clean.

### 3. Type-check

Script name confirmed from `apps/web/package.json`: `"type-check": "tsc --noEmit"`.

```
pnpm --filter @fxl-sales/web type-check
```

Exit 0, no output. Clean.

### 4. Full web suite (not required, run to prove "every existing test in apps/web")

```
pnpm --filter @fxl-sales/web test
```

```
 Test Files  52 passed (52)
      Tests  724 passed (724)
   Duration  5.43s
```

## Mutation table (non-vacuity)

Each mutation applied alone, oracle re-run, then `git checkout --` on the file
before the next.

| # | Mutation | Expected | Actual | Failing test |
| --- | --- | --- | --- | --- |
| M1 | delete `code: body.code,` from `apiFetch`'s `ApiError` construction only (`api-client.ts:52`) | RED | **RED** (1 failed, 11 passed) | `apiFetch surfaces the body code on the thrown ApiError for a 402` - diff showed `- "code": "missing_entitlement"` |
| M2 | delete `code: body.code,` from `apiFetchBlob`'s `ApiError` construction only (`api-client.ts:84`) | RED | **RED** (1 failed, 11 passed) | `apiFetchBlob surfaces the body code on the thrown ApiError for a 402` |
| M3 | `isEntitlementFailure` additionally requires `code === 'missing_entitlement'` | RED | **RED** (1 failed, 11 passed) | `isEntitlementFailure is true for a 402 that carries no code at all` |
| M4 | `isEntitlementFailure` returns `status === 402 \|\| status === 401` | RED | **RED** (1 failed, 11 passed) | `isEntitlementFailure is false for a 401, a 500, an AuthTokenUnavailableError and a non-object` |

Note that M1 and M2 each red exactly ONE test, and they are different tests. The
two error-construction sites are therefore independently covered, not covered by
one shared assertion that a single fix would satisfy. That is the specific thing
the verifier focus asked to be proven, and it holds.

M3 and M4 together pin the predicate from both directions: it may not narrow onto
the `code` field (fail-closed onto the "verifique o servidor local" copy this
work removes), and it may not widen to swallow the 401 (which belongs to
`isAuthFailure` and the "Sessao expirada" copy).

## Read-level checks

### Acceptance criterion

Satisfied. `ApiError` gains `code?: string`; both `if (!res.ok)` blocks populate
it from `body.code`; `isEntitlementFailure` returns true for `status === 402`;
`isAuthFailure` checks 401 and only 401, so it is false for the 402. The last
fact is now pinned by a dedicated test rather than left implicit.

### Must-not-break list

- `isAuthFailure` true for a 401 and for `AuthTokenUnavailableError`: the
  function body is **byte-unchanged** in the diff (the only additions to
  `require-token.ts` sit below it), and its pre-existing tests still pass.
- `isAuthFailure` FALSE for the 402: verified by the new pin
  `isAuthFailure is false for the 402 missing_entitlement ApiError`, and by M4
  which proves the 402/401 boundary is genuinely asserted.
- Empty-token chokepoint: `assertBearerToken(token)` is still present at
  `api-client.ts:38` (`apiFetch`) and `:72` (`apiFetchBlob`), both before
  `fetch`. Untouched by the diff.
- `require-token.ts` imports nothing: `grep -c '^import '` returns **0**. The new
  predicate is duck-typed on `status`, so no import back to `api-client.ts` was
  introduced and no cycle exists.
- Every existing test in `apps/web`: 724/724 pass across 52 files.

### Dash check

```
git diff master...HEAD | grep -nP '[\x{2014}\x{2013}]'
```

No match. **No em dash (U+2014) and no en dash (U+2013) anywhere in the diff.**
Prose in the new comments uses a plain hyphen.

### Scope

`git diff master...HEAD --stat`:

```
 apps/web/src/lib/__tests__/api-client-token-guard.test.ts   | 66 +++++++++++-
 apps/web/src/lib/api-client.ts                              | 10 +++
 apps/web/src/lib/require-token.ts                           | 25 ++++++
 nexo/runs/feature-.../01-execute.md                         | 74 ++++++++++++++
 4 files changed, 174 insertions(+), 1 deletion(-)
```

Exactly the three permitted source files plus the run note. **No scope violation.**

### Commit message trailers

Single commit `c2e6c82`. Trailers:

```
Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01SPY9R3AFFgJ2LrCwaAxtyU
```

Both required trailers present, and there is no other co-author trailer.

## Judgement on the design choice I did not write

The one debatable call is that `isEntitlementFailure` keys on the status alone
and ignores `code`. I checked the reasoning rather than accepting it: the error
branch really is `await res.json().catch(() => ({}))`, so a 402 whose body does
not parse yields `code === undefined`. Requiring the code would then classify
that response as NOT an entitlement failure and route it to the generic API-fault
copy - which is the exact string this feature exists to make unreachable for this
case. The failure modes are asymmetric and the implementer picked the safe one.
The predicate is also genuinely narrow: no `>= 400`, no error-string alternative,
strict `===` (pinned by the `'402'` string case), and `null`/`undefined` handled.
I found no way for a non-402 to reach it.

## Working tree

Every mutation reverted. `git status` shows only the pre-existing
`budget.json` modification, the pre-existing untracked
`agents/execute-01.result.json`, the untracked `.vscode/`, and this report.
Nothing was committed.
