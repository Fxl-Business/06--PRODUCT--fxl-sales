# Verify 03 - never restore the `/no-role` route

**Verdict: PASS**

Branch under test: `fix/03-never-restore-the-no-role-route` at `6e333d2`.
Baseline: `master` at `c2c1ee6`.
I did not read `slice-03-notes.md`.
I changed nothing except this report, and the one mutation described in section 3, which was restored byte-exactly.

## Acceptance criterion

> Given a stored returnTo of `/no-role` or any path that normalizes to it, when `sanitizeReturnTo` runs, then it returns null so no restore happens.

Met, and met on the normalized path rather than on the raw input.

---

## 1. The gate, run first-hand

All run-once. No watcher was started, so nothing was left running.

### 1.1 Slice oracle

```
$ pnpm --filter @fxl-sales/web exec vitest run src/auth/__tests__/session-recovery.test.ts

 ✓ src/auth/__tests__/session-recovery.test.ts (65 tests) 6ms

 Test Files  1 passed (1)
      Tests  65 passed (65)
   Duration  247ms
```

### 1.2 Full web suite

```
$ pnpm --filter @fxl-sales/web test

 Test Files  50 passed (50)
      Tests  682 passed (682)
   Duration  5.17s
```

Exit code 0.

### 1.3 Lint

```
$ pnpm run lint

packages/shared-types lint: no lint for shared-types
packages/shared-utils lint: no lint for shared-utils
apps/api lint$ eslint src/      -> Done
apps/web lint$ eslint src/      -> Done
```

Clean. No warnings.

### 1.4 Type-check

```
$ pnpm run type-check

packages/shared-types type-check$ tsc --noEmit  -> Done
packages/shared-utils type-check$ tsc --noEmit  -> Done
apps/api type-check$ tsc --noEmit               -> Done
apps/web type-check$ tsc --noEmit               -> Done
```

Clean.

---

## 2. Cross-checking the matching rules against the real router

I did not take the author's account of React Router on trust. I read the resolved package,
`node_modules/.pnpm/@remix-run+router@1.23.3/node_modules/@remix-run/router/dist/router.cjs.js`.

**`decodePath`, line 1152.**

```js
function decodePath(value) {
  try {
    return value.split("/").map(v => decodeURIComponent(v).replace(/\//g, "%2F")).join("/");
  } catch (error) { ...; return value; }
}
```

`isTerminalAuthRoute` reproduces this character for character, including the `/` re-encoding and the
fall-back-to-original `catch`. That matters in both directions: the re-encoding is what stops
`/%2Fno-role` from manufacturing a segment boundary, and the `catch` is what stops a malformed
escape such as `/caf%E9` from being over-blocked.

**Where it is applied, `matchRoutesImpl`, line 792.**

```js
let pathname = stripBasename(location.pathname || "/", basename);
...
let decoded = decodePath(pathname);
for (...) { matches = matchRouteBranch(branches[i], decoded, allowPartial); }
```

So the decode is applied once to the whole pathname, before matching. The guard's placement mirrors
that. `basename` is `/` here: `apps/web/src/router.tsx:165` is a bare
`createBrowserRouter(routes)` with no options, so `stripBasename` is a no-op and there is no
`/prefix/no-role` spelling to worry about.

**`compilePath`, line 1111.**

```js
} else if (end) {
  regexpSource += "\\/*$";        // trailing slashes ignored
}
let matcher = new RegExp(regexpSource, caseSensitive ? undefined : "i");
```

`apps/web/src/router.tsx:145` declares `{ path: '/no-role', ... }` with no `caseSensitive`, so the
`i` flag is live and `\/*$` eats any run of trailing slashes. The guard's `toLowerCase()` and
`.replace(/\/+$/, '')` are the right mirrors.

One thing I checked that the plan did not raise: whether `toLowerCase` could diverge from the regex
`i` flag on non-ASCII input. It cannot bite here. A non-`u` regex canonicalizes with `toUpperCase`
and explicitly refuses to fold a non-ASCII code point onto an ASCII one, so the router's `i` flag is
ASCII-only for this pattern; and no non-ASCII character lowercases to any of `n`, `o`, `r`, `l`, `e`.
So neither over-blocking nor under-blocking is reachable through case folding. The empirical fuzz in
section 4 covers this too.

Route table facts that make the non-over-blocking claim true:
`/no-role/extra` matches `/:workspace/:view` (`SalesOpsApp`), and `/no-roles` falls through to
`{ path: '*' }`. Neither renders `NoRolePage`, so neither may be refused.

---

## 3. Mutation: is the placement pinned?

**Mutation applied.** Moved the refusal above the `new URL(...)` block so it tests the raw input.

```diff
   if (value[1] === '/' || value[1] === '\\') return null;
 
+  if (isTerminalAuthRoute(value)) return null;
+
   let url: URL;
   try {
     url = new URL(value, origin);
@@
   if (normalized[1] === '/' || normalized[1] === '\\') return null;
-  // Same place and same reason: what this function hands back is the NORMALIZED path, so
-  // that is the string the terminal-route refusal has to be asserted on. Checking the raw
-  // input instead is bypassed by `/foo/../no-role`.
-  if (isTerminalAuthRoute(url.pathname)) return null;
   return normalized === '/' ? null : normalized;
```

**Result: 3 tests go red.** Exactly and only these:

```
× sanitizeReturnTo > rejects "/no-role?x=1"
× sanitizeReturnTo > rejects "/no-role#frag"
× sanitizeReturnTo > refuses a terminal route that only appears after dot-segment normalization

 Test Files  1 failed (1)
      Tests  3 failed | 62 passed (65)
```

Representative failure output:

```
FAIL  sanitizeReturnTo > refuses a terminal route that only appears after dot-segment normalization
AssertionError: expected { value: '/foo/../no-role', ...(1) } to deeply equal { ... }

- Expected
+ Received
  {
-   "result": null,
+   "result": "/no-role",
    "value": "/foo/../no-role",
  }
```

```
FAIL  sanitizeReturnTo > rejects "/no-role#frag"
AssertionError: expected '/no-role' to be null
```

The named dot-segment test is red, which is what the brief required. The two `it.each` cases that
also fell are the query-string and fragment spellings, which likewise only become a bare `/no-role`
after `new URL` strips them. The placement is genuinely pinned, and by three independent oracles
rather than one.

**Restored byte-exactly.**

```
$ shasum -a 256 apps/web/src/auth/session-recovery.ts
794030cd6ad010c7e3c549f40a42349e256be4ecf3ef98bf6952e843dca12b99   (identical to the pre-mutation hash)

$ git diff -- apps/web/src/auth/session-recovery.ts
<no diff>

$ pnpm --filter @fxl-sales/web exec vitest run src/auth/__tests__/session-recovery.test.ts
 Tests  65 passed (65)
```

---

## 4. My own bypass hunt

I did not re-run the author's list and call it done. I built a throwaway harness that imports
`sanitizeReturnTo` and drives the **real** `matchRoutes` from `react-router-dom` against a route
table mirroring `apps/web/src/router.tsx`, so the oracle is "would React Router actually render
`NoRolePage` for the value this function handed back", not "does it look like `/no-role`". Both
scratch files were deleted afterwards; `git status` is back to its starting state.

The leak condition is: `sanitizeReturnTo` returns non-null **and** `matchRoutes` resolves that
returned value to the `/no-role` route.

### 4.1 Hand-built corpus - 85 inputs, 0 leaks

`BLOCK` = returned `null`. `ok` = returned a value, and the router resolves it to something that is
not `NoRolePage` (the resolved route id is shown). No row came back `LEAK`.

**Literal and trivial spellings** - all BLOCK:
`/no-role`, `/no-role/`, `/no-role//`, `/no-role///`, `/no-role?x=1`, `/no-role#frag`,
`/no-role/?x=1`, `/no-role//?a=b#c`

**Mixed case** - all BLOCK:
`/NO-ROLE`, `/No-Role`, `/nO-rOlE/`, `/NO-ROLE//?q=1`

**Dot segments, many shapes** - all BLOCK:
`/foo/../no-role`, `/./no-role`, `/a/b/../../no-role`, `/foo/../no-role?x=1`, `/foo/./../no-role`,
`/a/../../no-role`, `/no-role/extra/..`, `/no-role/./`, `/x/../NO-ROLE`, `/x/../no-role/`,
`/.././no-role`, `/a/b/c/../../../no-role`, `/no-role/../no-role`, `/no-role/.././no-role//`

`/no-role/..` also BLOCKs, but via the pre-existing `normalized === '/'` rule rather than the new one.

**Percent-encoded dot segments.** This is a case the plan did not name, and it is a real one: the
WHATWG URL parser treats `%2e` as a dot segment, so these resolve to `/no-role` inside `new URL`
without ever containing a literal `.`. All BLOCK, because the check runs on `url.pathname`:
`/%2e%2e/no-role`, `/%2E%2E/no-role`, `/%2e/no-role`, `/.%2e/no-role`, `/%2e./no-role`,
`/foo/%2e%2e/no-role`

**Percent-encoding of each character of the name, not only the `n` the author tested** - all BLOCK:
`/%6Eo-role`, `/n%6F-role`, `/no%2Drole`, `/no-%72ole`, `/no-r%6Fle`, `/no-ro%6Ce`, `/no-rol%65`,
`/%6E%6F%2D%72%6F%6C%65`, `/%4E%4F%2D%52%4F%4C%45`, `/no-role/%2e`

**Double encoding** - correctly NOT blocked, and correctly harmless. `decodePath` decodes once, so
the router does not render these either:
`/%256Eo-role` -> `/%256Eo-role` (router: `*`), `/%252e%252e/no-role` -> `/%252e%252e/no-role`
(router: `/:workspace/:view`). `/%25 2Eno-role` BLOCKs on the whitespace rule.

**Slashes and backslashes:**
BLOCK: `//no-role`, `///no-role`, `/\no-role`, `/no-role\` (backslash normalizes to `/`, so the
pathname is `/no-role/`), `/no-role\\`, `/foo\..\no-role`, `/..\no-role`.
Not blocked and correctly so: `/no\-role` -> `/no/-role` (router: `/:workspace/:view`),
`/%2Fno-role` and `/no%2Frole` (router: `*` in both cases; the `%2F` re-encoding in `decodePath` is
what keeps guard and router agreeing).

**Absolute URL forms** - all BLOCK, on the pre-existing relative-path rules:
`https://sales.fxl.test/no-role`, `http://sales.fxl.test/no-role`, `//sales.fxl.test/no-role`.
Note these resolve to pathname `/no-role`, so they would have rendered the terminal screen had the
relative-path rules not caught them first. `/https://sales.fxl.test/no-role` is accepted verbatim and
the router resolves it to `*`, which is correct.

**Whitespace** - all BLOCK on `hasUnsafeReturnToChars`:
`/no-role `, ` /no-role`, `/no -role`, `/no-role\t`, `/no-role\n`, `/\tno-role`, `/%20/../no-role`.
Encoded whitespace inside the name is accepted and harmless: `/no%09-role`, `/no%20-role` (router:
`*` for both).

**Unicode and homoglyphs** - none get through as the terminal screen. Each is percent-encoded by
`new URL` and resolves to `*`:
`/nо-role` (Cyrillic o U+043E) -> `/n%D0%BE-role`, `/no-rolе` (Cyrillic e U+0435) ->
`/no-rol%D0%B5`, `/ｎo-role` (fullwidth n) -> `/%EF%BD%8Eo-role`, `/no-role​` (zero-width space) ->
`/no-role%E2%80%8B`, `/Åno-role` (Angstrom sign U+212B) -> `/%E2%84%ABno-role`, `/no-role／`
(fullwidth solidus) -> `/no-role%EF%BC%8F`. `/no-role ` BLOCKs on the control-character rule.

**Separators and misc** - accepted, all resolve to `*`, none render `NoRolePage`:
`/no-role;x=1`, `/no-role%00`, `/no-role%3F`, `/no-role%23`, `/no-role%2F`.

### 4.2 Generative fuzz - 98,560 inputs, 0 leaks

Because a hand list can only cover what I thought of, I generated the cross product of:

- **440 spellings of the name**: every one of the `2^7` subsets of character positions
  percent-encoded, times uppercase / lowercase / capitalized maskings of each;
- **8 prefixes**: `''`, `/foo/..`, `/.`, `/a/b/../..`, `/%2e%2e`, `/%2E.`, `/.%2e`, `/x/./..`;
- **7 suffixes**: `''`, `/`, `//`, `///`, `/.`, `/x/..`, `\`;
- **4 tails**: `''`, `?x=1`, `#f`, `?a=b#c`.

```
FUZZ: 98560 inputs from 440 name spellings x 8 prefixes x 7 suffixes x 4 tails
  blocked (null): 98560
  inputs whose resolved pathname the real router renders as NoRolePage: 98560
  leaks: 0
```

The middle line is the important one. It is an independently computed control: for every one of
those 98,560 inputs the real `matchRoutes` confirms the resolved pathname really would render
`NoRolePage`. So this is not 98,560 easy inputs - it is 98,560 genuine attacks, and the guard caught
every single one. Blocked count equals attack count exactly.

### 4.3 Random fuzz - 300,000 inputs, 0 leaks

A seeded PRNG over an alphabet biased toward the dangerous characters
(`no-roleNORLE/\.%2e2E?#;: \t` plus a few fillers), lengths 1 to 18.

```
RANDOM FUZZ: 300000 inputs, 221266 accepted, 0 leaks
```

221,266 inputs were accepted by the sanitizer and not one of them resolves to the `/no-role` route.

**I found no bypass.**

---

## 5. Over-blocking

Every path below returns unchanged. Verified in my harness, and the first two plus the last are also
pinned in the repo suite via `ACCEPTED_RETURN_TO`.

| input | returned |
| --- | --- |
| `/tatico/dashboard` | `/tatico/dashboard` |
| `/cadastros/produtos` | `/cadastros/produtos` |
| `/operacional/vendas` | `/operacional/vendas` |
| `/admin/finders` | `/admin/finders` |
| `/finder/dashboard` | `/finder/dashboard` |
| `/seller/deals` | `/seller/deals` |
| `/meus-dados/vendedores?f=1` | `/meus-dados/vendedores?f=1` |
| `/a/../cadastros` | `/cadastros` |
| `/no-role/extra` | `/no-role/extra` |
| `/no-roles` | `/no-roles` |
| `/no-role-x` | `/no-role-x` |

```
OVER-BLOCK CHECK: all accepted unchanged
```

`/no-role/extra` and `/no-roles` are the two the brief singled out, and refusing either would have
been a bug: per section 2 they resolve to `/:workspace/:view` and `*` respectively, never to
`NoRolePage`. The repo suite pins both in the named test
`does not over-block routes that merely start with a terminal route`.

The legacy content trees are untouched, which is right: `RoleGuard` bounces an unentitled operator
from `/admin/finders` to `/no-role`, but an entitled one lands on real data, so the path itself is a
legitimate restore target.

---

## 6. Pre-existing security guarantees

The whole diff to `apps/web/src/auth/` contains exactly **one** deleted line:

```
$ git diff master..HEAD -- apps/web/src/auth/ | grep -E "^-[^-]"
- * 8. the normalized result is not `/`, the default landing route - nothing to restore.
```

That is the docstring item renumbered from 8 to 9. The test file is `67 insertions, 0 deletions` -
nothing was removed or weakened. Every pre-existing case is still in the file and still passing:
`https://evil.example/`, `//evil.example/x`, `/\evil.example`, `/auth`, `/auth/login`, and the whole
dot-segment family `/..//evil.example`, `/./\evil.example`, `/..\\evil.example`, `/../\evil.example`,
`/..//user@evil.example/`, `/.//evil.example`, `/a/../..//evil.example`, plus the length and
control-character cases. The property test `never returns a value that resolves off-origin` now runs
over the enlarged corpus, which includes the new terminal-route entries.

The new check is additive and terminal-only: it is one `if` at the end of the post-normalization
block, and it can only ever turn an accept into a reject, never the reverse.

**Consume-before-validate is intact.** `consumeReturnTo` reads, then `dropItem`, and only then calls
`sanitizeReturnTo`:

```ts
const raw = readItem(storage, RETURN_TO_KEY);
dropItem(storage, RETURN_TO_KEY);
return sanitizeReturnTo(raw, origin);
```

The new refusal lives entirely inside `sanitizeReturnTo`, strictly after the `removeItem`, so a
stored `/no-role` is destroyed on the read that rejects it. The new test
`destroys a stored terminal route on the read that rejects it` asserts both halves - `null` returned
**and** `map.has(RETURN_TO_KEY) === false` - so a StrictMode double effect or a later mount finds an
empty slot. `writes nothing when the captured path is the terminal /no-role screen` covers the write
side.

---

## 7. Scope and rules

**Files changed** - three, all permitted:

```
$ git diff --numstat master..HEAD
67   0   apps/web/src/auth/__tests__/session-recovery.test.ts
63   1   apps/web/src/auth/session-recovery.ts
158  0   nexo/runs/feature-20260812-session-survives-one-refresh/slice-03-notes.md
```

No change to `SalesOpsApp.tsx`, `router.tsx`, `react.tsx` or `CLAUDE.md`, matching the plan's
`files_modified` and its explicit exclusions.

**Constant not exported.** `const TERMINAL_AUTH_ROUTES` at line 112 has no `export`, and a repo-wide
grep finds it in no file other than its own:

```
$ grep -rn "TERMINAL_AUTH_ROUTES" apps/ packages/
apps/web/src/auth/session-recovery.ts:112, 115 (comment), 145
```

`isTerminalAuthRoute` is likewise module-private. The test pins literal path strings, so emptying
the constant would fail the oracle rather than silently passing it.

**No em dash.** Zero occurrences of U+2014 in the diff and zero in the commit message.

**No agent attribution.** No `Co-Authored-By`, no `Generated with`, no model or vendor name in
`6e333d2`.

**Tree left as found.** Both scratch harnesses deleted. `git status` shows only what was there when
I started: a modified `budget.json`, an untracked `agents/execute-03.result.json`, and an untracked
`.vscode/`. None of those are mine.

---

## Observations, filed not fixed

Neither affects this verdict and neither is in this slice's scope.

1. **`/Auth/login` still walks past check 6.** The `/auth` check is case-sensitive
   (`url.pathname === '/auth' || url.pathname.startsWith('/auth/')`), so `/Auth/login` is accepted.
   The new terminal-route check is case-insensitive, so the two guards in the same function now use
   different case semantics. Impact is one wasted navigation - those paths are BFF proxy targets, not
   React routes, so nothing renders and the `*` route redirects to `/`. The plan already identified
   this and correctly declined to touch the `/auth` check. Worth a `nexo/ROADMAP.md` line.
2. **A future member of `TERMINAL_AUTH_ROUTES` needs the same treatment.** The matcher generalizes
   correctly, but the non-over-blocking argument was made per-path against the route table. Adding a
   member whose route has a dynamic segment or a `caseSensitive` flag would need re-derivation. The
   constant's comment says why `/no-role` is in and why `/admin/*` and friends are out, which is the
   right guardrail.

---

## Verdict

**PASS.**

The gate is green first-hand (65/65 slice, 682/682 web, lint clean, type-check clean). The placement
mutation bites, taking down the dot-segment oracle plus two more. I could not bypass the guard: 85
hand-built adversarial inputs, 98,560 generated inputs every one of which the real React Router
confirms would render `NoRolePage`, and 300,000 random inputs - zero leaks across all of them.
Nothing is over-blocked. Every pre-existing security guarantee survives, and the consume-once
property is asserted for the new refusal. Scope, export, em dash and attribution rules all hold.
