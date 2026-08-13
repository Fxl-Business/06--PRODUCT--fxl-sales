# Verify report - slice 06, close the verifier follow-ups

**Verdict: PASS**

Branch under test: `fix/06-close-the-verifier-follow-ups`, HEAD `c04a009`, against `master`.
Nothing was fixed, switched, merged, pushed or committed by this agent.
The implementer's notes (`slice-06-notes.md`) were not read.

---

## 1. The gate, run first-hand

Every command run-once, never a watcher.

| Command | Result |
| --- | --- |
| `pnpm --filter @fxl-sales/web exec vitest run src/auth/__tests__/session-recovery.test.ts` | 1 file passed, **68/68 tests** |
| `pnpm --filter @fxl-sales/web exec vitest run src/__tests__/session-journey.test.tsx` | 1 file passed, **6/6 tests** |
| `pnpm --filter @fxl-sales/web test` | **52 files passed, 718/718 tests** |
| `pnpm --filter @fxl-sales/api test` | **41 files passed, 415/415 tests** |
| `pnpm run lint` | exit 0, `apps/api` and `apps/web` both Done |
| `pnpm run type-check` | exit 0, all four projects Done |

`app-auth-bff-wiring.test.ts` specifically: `✓ (22 tests) 223ms`.

---

## 2. Item 4 - the journey test's headline scenario. Probe run by me.

This is the item that mattered, and I ran the probe myself rather than taking the claim on trust.
I ran it TWICE: once against the branch's test file, and once against `master`'s test file under the
identical probe, so the "previously could not fail" half of the claim is verified too and not merely
asserted.

### The probe

In `apps/web/src/auth/react.tsx`, the restore effect is at lines 719-727. I neutered ONLY the
navigation, leaving `consumeReturnTo` on line 723 running:

```diff
-    if (target && target !== currentPath) navigate(target, { replace: true });
+    // VERIFIER PROBE: restore navigation neutered, consumeReturnTo above still runs.
+    if (target && target !== currentPath) void target;
```

`git diff --stat` during the probe: `apps/web/src/auth/react.tsx | 3 ++-`. One line replaced, nothing else.

### Result A - branch test file under the probe: scenario 1 is RED

```
 FAIL  src/__tests__/session-journey.test.tsx > the composed session journey >
       returns the operator to the route they were on after a lost session and a successful login
AssertionError: expected '/tatico/dashboard' to be '/operacional/vendas' // Object.is equality

Expected: "/operacional/vendas"
Received: "/tatico/dashboard"

 ❯ src/__tests__/session-journey.test.tsx:444:37
    444|       expect(locationText(next.host)).toBe(captured);

 Test Files  1 failed (1)
      Tests  3 failed | 3 passed (6)
```

Scenarios 2 and 3 went red alongside it, as before. All three now fall.

### Result B - master's test file under the SAME probe: scenario 1 stayed GREEN

I restored `master`'s `session-journey.test.tsx` with the probe still in `react.tsx`:

```
   ✓ ... returns the operator to the route they were on after a lost session and a successful login 39ms
   × ... returns the operator to a non-tatico route, where the second guard is load-bearing 15ms
   × ... consumes the returnTo exactly once, so a later mount cannot replay it 13ms
   ✓ ... never restores a returnTo of /no-role, even if one is somehow stored 4ms
   ✓ ... sends an operator who lost entitlement to /no-role and leaves them there without looping 7ms
   ✓ ... lets an entitled operator out of /no-role even when nothing is stored to restore 3ms

 Test Files  1 failed (1)
      Tests  2 failed | 4 passed (6)
```

So the defect was real and the fix closes it: 2 failures before, 3 after, and the added failure is
exactly the scenario named after the acceptance criterion.

### Is the new entry route genuinely not the operator's default landing?

Derived from source, not from the test.

- `getVisibleWorkspaces(['admin'])` (`apps/web/src/sales-ops/navigation.ts:95-105`) returns
  `['tatico', 'operacional', 'cadastros']`.
- `getDefaultSalesOpsRoute(roles)` is called with NO `preferredWorkspace` from
  `resolveSalesOpsRoute`'s fallback (`navigation.ts:191-193`), so it takes `visible[0]`, which is
  `'tatico'`, and its first nav item. `tacticalTeam` is a one-element array whose id is `'dashboard'`
  (`navigation.ts:54-56`).
- Therefore an admin entering `/` lands on **`/tatico/dashboard`**, and there is no argument by which
  the no-preference default can produce `operacional`.
- `completeHubRoundTrip` mounts the new document at `landing = '/'` (test line 363), which is exactly
  that path.
- The chosen entry route is `/operacional/vendas` - `operacional`'s first view is `vendas`
  (`navigation.ts:58-61`), so the route is legal for an admin and renders, but it is unreachable as a
  default. The three endings are now distinct: restore gives `/operacional/vendas`, no restore gives
  `/tatico/dashboard`, no login at all leaves `/`.

The suite corroborates this independently: scenario 4 at test line 498 asserts the post-login
fallthrough lands on `/tatico/dashboard`.

### Does the returnTo assertion distinguish "consumed and navigated" from "merely consumed"?

Yes. The slot is no longer asserted alone. It is asserted jointly with the URL, against `captured`,
which is the value the URL had to have come from:

```ts
const captured = sessionStorage.getItem(RETURN_TO_KEY);
expect(captured).toBe('/operacional/vendas');
...
expect(locationText(next.host)).toBe(captured);
...
expect({ slot: sessionStorage.getItem(RETURN_TO_KEY), url: locationText(next.host) }).toEqual({
  slot: null,
  url: captured,
});
```

A merely-consumed slot satisfies `slot: null` but leaves `url` at `/tatico/dashboard`, which is what
the probe demonstrated: the failure landed on the paired assertion, not on the slot. The point about
`consumeReturnTo` destroying before it validates is correctly neutralised by the pairing rather than
by dropping the slot check.

Scenarios 2 and 3 are untouched by the diff and still present.

### react.tsx restored byte-exactly

`git hash-object` before the probe and after `git checkout --`:

```
5aea3b240bd42449bd5b5e3b87c19fa0c7e1ec0d  apps/web/src/auth/react.tsx        (before)
ffae73dfd3a98c11b199f1d83e6ad06ac948dcdc  session-journey.test.tsx           (before)
5aea3b240bd42449bd5b5e3b87c19fa0c7e1ec0d  apps/web/src/auth/react.tsx        (after)
ffae73dfd3a98c11b199f1d83e6ad06ac948dcdc  session-journey.test.tsx           (after)
```

Identical blob hashes, and `git status --short` shows neither file. The full gate above was re-read
against the restored tree.

---

## 3. Item 2 - the case-insensitive `/auth` refusal. Proven monotone, not argued.

### The change is confined to one branch

Stripping comment lines from the `session-recovery.ts` diff leaves exactly three lines:

```
<   if (url.pathname === '/auth' || url.pathname.startsWith('/auth/')) return null;
>   const lowerPath = url.pathname.toLowerCase();
>   if (lowerPath === '/auth' || lowerPath.startsWith('/auth/')) return null;
```

Nothing else in the function changed. `lowerPath` is read by that one `if` and by nothing else; the
returned `normalized` still reads the original-case `url.pathname`, so an accepted value cannot be
altered by this change even in principle.

### Differential execution against master's implementation

I extracted `master`'s `session-recovery.ts` and the branch's side by side (the module is pure, with
no imports at all) and ran both over the same corpus, looking specifically for the FAIL condition:
an input REJECTED before and ACCEPTED now.

**Curated corpus, 55 inputs** - both enumerated tables verbatim, the off-origin family, the
dot-segment family, control characters, plus Unicode case-folding hazards (KELVIN SIGN, LATIN CAPITAL
I WITH DOT ABOVE, CAPITAL SHARP S, GREEK ALPHA, fullwidth `a`) and percent-encoded `%41`:

```
identical verdict + value : 44
newly rejected (allowed)  : 11
value drift (FAIL)        : 0
holes opened (FAIL)       : 0

MONOTONE: PASS
```

All 11 newly rejected inputs are the mixed-case `/auth` family and nothing else:
`/Auth/login`, `/AUTH`, `/aUtH/callback`, `/AUTH/`, `/Auth`, `/aUTH/callback?x=1`, `/AUTH#frag`,
`/AUTH?x=1`, `/a/../AUTH`, `/a/../Auth/login`.

**Exhaustive case sweep, 480 inputs** - all 16 case permutations of `auth` crossed with three
prefixes (`/`, `/a/../`, `/./`) and ten suffix shapes (`''`, `/`, `/login`, `/callback`, `?x=1`,
`#f`, `x`, `ority`, `s/x`, `/a/b?c=d#e`):

```
exhaustive case sweep: same=165 newlyRejected=315 drift=0 holes=0
EXHAUSTIVE MONOTONE: PASS
```

**Randomized fuzz, 400 000 inputs** over an alphabet seeded with the case-hazard characters:

```
fuzz n=400000  same=400000  newlyRejected=0  drift=0  holes=0
FUZZ MONOTONE: PASS
```

Across 400 535 executed inputs: **zero holes opened, zero value drift.** I could not construct an
input that was rejected before and is accepted now, which is the property the plan's
`verifier_focus` asked for. The reason it is not merely empirical: `'/auth'` and `'/auth/'` are pure
lowercase ASCII, no ASCII letter has a context-dependent lowercase mapping, so `p.startsWith('/auth/')`
implies `p.toLowerCase().startsWith('/auth/')`, and the rejected set can only grow.

### The existing tables lost nothing

`git diff --numstat` on the test file is `11 0` - **eleven added lines, zero removed.** The
`ACCEPTED_RETURN_TO` table is untouched, including `/tatico/dashboard`, `/admin/finders`, the hash-drop
case `/produtos#frag` and the benign dot-segment case `/a/../cadastros`. The off-origin family
(`https://evil.example/`, `http://app.example/cadastros`, `//evil.example/x`, `/\evil.example`,
`javascript:alert(1)`) and the dot-segment family (`/..//evil.example`) are unchanged, and 68/68 pass.

`toLowerCase` and not `toLocaleLowerCase`, as the plan required - confirmed by reading the line.

---

## 4. Item 1 - the `RoleRouter` deletion

**Nothing referenced it.** Repo-wide grep, no exclusions beyond `.git`, covering barrel files, lazy
imports, route tables and tests:

```
$ grep -rln "RoleRouter" . --exclude-dir=.git
CLAUDE.md
nexo/ROADMAP.md
nexo/plans/batch-20260813-session-followups/06-close-the-verifier-follow-ups.md
nexo/plans/feature-20260812-session-survives-one-refresh/04-no-role-redirects-when-entitled.md
nexo/runs/batch-20260813-session-followups/slice-06-notes.md
nexo/runs/batch-20260813-session-followups/agents/execute-06.result.json
nexo/runs/feature-20260812-session-survives-one-refresh/verify-04-report.md
nexo/runs/feature-20260812-session-survives-one-refresh/slice-04-notes.md
```

Zero hits under `apps/`, `packages/`, or any config. Every surviving hit is prose in Markdown or a
result JSON. No import, no JSX usage, no route table entry, no test.

**`RoleGuard` and `NoRoleGuard` are byte-unchanged.** `git diff master..HEAD -- RoleGuard.tsx` is a
single hunk of `-12` and `+0`, removing the `RoleRouter` declaration and its docstring. Both
surviving functions lie entirely outside the hunk. The file's four imports (`Navigate`, `Skeleton`,
`useAuthProfile`, `getVisibleWorkspaces`) are all still used by the two remaining components, which
is independently confirmed by lint passing.

The `NoRolePage` docstring rewrite is accurate: `RoleGuard` navigates to `/no-role` at
`RoleGuard.tsx:19`, `SalesOpsApp` at `SalesOpsApp.tsx:1275`, and `NoRoleGuard` is the way back out.

---

## 5. Item 3 - comment-only

**Diff shape:** `15 0` - fifteen added lines, zero removed.

**Every added line is a `//` comment.** Filtering the added lines for anything that is neither a
`//` comment nor blank returns nothing.

**Semantically proven, not eyeballed.** I compiled both `master`'s and the branch's version of
`app-auth-bff-wiring.test.ts` through esbuild (which strips comments) and diffed the output:

```
COMMENT-ONLY: PASS - the api test file is byte-identical after comment stripping
```

**No test name changed.** The 30 `it(` / `describe(` titles are identical between the two versions;
only their line numbers shift by the 15 added comment lines.

**Suite still green:** `app-auth-bff-wiring.test.ts ✓ (22 tests)`, and the api suite as a whole is
415/415.

---

## 6. Scope, commits and hygiene

**`git diff --stat master..HEAD` is exactly the six planned files plus `nexo/`:**

```
 apps/api/src/middleware/__tests__/app-auth-bff-wiring.test.ts |  15 ++
 apps/web/src/__tests__/session-journey.test.tsx               |  40 ++++-
 apps/web/src/auth/__tests__/session-recovery.test.ts          |  11 ++
 apps/web/src/auth/session-recovery.ts                         |  13 +-
 apps/web/src/components/auth/RoleGuard.tsx                    |  12 --
 apps/web/src/pages/errors/NoRolePage.tsx                      |   8 +-
 nexo/plans/.../06-close-the-verifier-follow-ups.md            |  49 ++++-
 nexo/runs/.../agents/execute-06.result.json                   |   1 +
 nexo/runs/.../slice-06-notes.md                               | 197 +++++++++++++++++++++
```

All six planned files, no seventh source file, and the three extras are the plan and the run notes
under `nexo/` as permitted.

**Four separate atomic commits, one per item, with no file overlap between them:**

| Commit | Item | Files |
| --- | --- | --- |
| `3d82516` `chore(auth): delete the dead RoleRouter ...` | 1 | `RoleGuard.tsx`, `NoRolePage.tsx` |
| `c76b226` `fix(auth): compare sanitizeReturnTo's /auth refusal case-insensitively` | 2 | `session-recovery.ts`, `session-recovery.test.ts` |
| `115bbb4` `docs(auth): record why the unprefixed-cookie test goes red ...` | 3 | `app-auth-bff-wiring.test.ts` |
| `e2f0507` `test(auth): let the journey test's headline scenario actually fail` | 4 | `session-journey.test.tsx` |

The remaining three commits on the branch (`90fdaa7`, `c19d732`, `c04a009`) are documentation only,
touching the plan file and the run notes. No item was combined with another.

**No em dash** anywhere in `git diff master..HEAD`, and none in any commit subject or body.

**No agent attribution**: no `Co-authored-by`, no `Claude`, no `Anthropic`, no `Generated with` in any
commit message on the branch.

---

## Tree left as found

`git status --short` at the end of verification:

```
 M nexo/runs/batch-20260813-session-followups/budget.json
?? .vscode/
```

Both were already present when I started and neither was touched by me. `budget.json` was modified
before this session began, and `.vscode/` is untracked. No tracked source file is dirty. All probe
scratch files live in the session scratchpad, outside the repository.

---

## Verdict

**PASS.**

- The gate passes first-hand on every one of the six commands.
- Item 4's probe genuinely turns scenario 1 red, and the counterfactual run proves it was green on
  `master` under the identical probe. The new entry route is provably not the admin default landing,
  and the returnTo assertion now separates a consumed-and-navigated slot from a merely consumed one.
- Item 2 opens no hole: 400 535 differential inputs, zero rejected-before-accepted-now, zero value
  drift, and the accepted table and the off-origin and dot-segment families are untouched.
- Item 1's deletion has no live referent anywhere in the repo, and both surviving guards are
  byte-unchanged.
- Item 3 is provably comment-only and the api suite is green.
- Scope, commit atomicity, em dashes and attribution all hold.
