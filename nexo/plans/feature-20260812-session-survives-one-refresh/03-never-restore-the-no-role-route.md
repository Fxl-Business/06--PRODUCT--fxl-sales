---
id: 03-never-restore-the-no-role-route
milestone: v2.8.0
status: todo
depends_on: []
files_modified:
  - apps/web/src/auth/session-recovery.ts
  - apps/web/src/auth/__tests__/session-recovery.test.ts
acceptance: "given a stored returnTo of /no-role or any path that normalizes to it, when sanitizeReturnTo runs, then it returns null so no restore happens"
goal: Make a terminal auth screen structurally impossible to restore as a post-login returnTo.
must_not_break:
  - the existing off-origin rejection and dot-segment normalization checks
  - ordinary routes such as /tatico/dashboard still restoring unchanged
  - the consume-before-validate property that destroys a stored path exactly once
rules:
  - the new refusal must be asserted on the NORMALIZED path, not only the raw input
  - do not touch SalesOpsApp.tsx or router.tsx
  - no em dashes anywhere
verifier_focus: that the refusal cannot be bypassed by dot-segment normalization, and that it does not over-block legitimate routes
---

# 03 - Never restore the `/no-role` route

## Why this slice exists

`/no-role` renders `NoRolePage`, which says `Acesso não autorizado` and offers one button, `Sair`.
It is where a failed authorization ENDS.
It is never a place an operator asked to be, so it is never a legitimate answer to "where was this
operator before we sent them to the Hub".

Today it can be both stored and restored.
`SalesOpsApp` returns `<Navigate to="/no-role" replace />` whenever `roles === []`, which is exactly
what the `liveSessionLoss` branch produces while it deliberately keeps `children` mounted under the
overlay.
`captureReturnTo` then stores `/no-role`, and `HubProtected`'s restore effect navigates straight
back to it after a perfectly good login.
That is the reported "I click Entrar and get Acesso não autorizado".

Slice 02 stops the most common way `/no-role` reaches the URL in the first place.
This slice is the defence in depth behind it: even if some other writer puts that path into the
slot later, it can never come back out.

## Scope

Two files, and only two.

- `apps/web/src/auth/session-recovery.ts`
- `apps/web/src/auth/__tests__/session-recovery.test.ts`

Explicitly NOT this slice: `apps/web/src/sales-ops/SalesOpsApp.tsx` belongs to slice 02,
`apps/web/src/router.tsx` belongs to slice 04, and `apps/web/src/auth/react.tsx` is not touched by
any of the three.

## Design decisions, all settled here

### 1. The set of refused paths

One member: `/no-role`.

It is the only TERMINAL screen in the route table.
`apps/web/src/pages/errors/` holds exactly two components, and the other one, `RouteErrorPage`, is
an `errorElement` rather than a route, so it has no path that could ever be captured.

The legacy trees `/admin/*`, `/finder/*` and `/seller/*` deliberately do NOT join it.
They are CONTENT routes, not error screens.
Their `RoleGuard` bounces an operator who lacks the role to `/no-role`, while an operator who holds
the role lands on a real page with real data, so refusing them would break a legitimate restore for
the only person who can reach them.
CLAUDE.md's "Sales Ops Routing" section also says to keep those trees unchanged, and blocking their
restore is a behavioural change to them in all but name.

`/auth` and `/auth/*` already have their own check one line above, and it stays exactly where it is.
It exists for a different reason: those paths are proxied to the API BFF, so restoring one bounces
the operator back into the login flow.
Folding it into the new constant would merge two unrelated rules and would silently change its
matching semantics, so it is left alone.

The set is expressed ONCE, as a named constant, with a comment saying why the one member is in it
and why the obvious candidates are not.

### 2. Matching rules

Each rule is chosen so the guard refuses exactly the set of strings React Router renders as
`NoRolePage`, no more and no less.
Anything looser leaves a spelling the guard permits and the router still honours.
Anything tighter costs a legitimate restore.

- **Exact path match, never a prefix match.** `/no-role/extra` does not match the `/no-role` route
  at all: `compilePath` produces `^\/no\-role\/*$`, so that URL falls through to `/:workspace/:view`
  and renders `SalesOpsApp`. `/no-roles` falls through to the `*` redirect. Refusing either would
  protect nothing and cost a restore.
- **Case-insensitive.** `compilePath` in `node_modules/@remix-run/router` ends with
  `new RegExp(regexpSource, caseSensitive ? undefined : 'i')`, and no route in `router.tsx` sets
  `caseSensitive`, so `/NO-ROLE` really does render `NoRolePage`. A case-sensitive refusal would be
  bypassed by holding down shift. Use `toLowerCase` and not `toLocaleLowerCase`, because the
  comparison must not depend on the operator's locale.
- **Trailing slashes stripped before comparing.** The same function appends `\/*$` when matching to
  the end, so `/no-role/` and `/no-role//` both render `NoRolePage`. Strip ALL trailing slashes, not
  just one.
- **Percent-decoded per segment before comparing.** `matchRoutesImpl` calls `decodePath(pathname)`
  BEFORE matching, and `decodePath` is
  `value.split('/').map(v => decodeURIComponent(v).replace(/\//g, '%2F')).join('/')`.
  `new URL('/%6Eo-role', origin).pathname` is `/%6Eo-role` verbatim, so a raw string compare would
  let that spelling through while the router still renders the terminal screen. Mirror `decodePath`
  exactly, including the `/` re-encoding, so an encoded slash cannot manufacture a segment boundary
  that the router would not see. Mirror its `catch` too: on a malformed escape it returns the
  original value, so compare the original value, which cannot equal `/no-role`. That keeps the
  guard from over-blocking a path like `/caf%E9` that the router itself answers with the `*`
  redirect.
- **The query string is not consulted.** `/no-role?x=1` renders the same terminal screen, because
  the matcher only ever sees the pathname. So the pathname alone decides, and `?x=1` is refused with
  everything else. The hash never reaches the decision: `sanitizeReturnTo` already drops it, since
  `normalized` is built from `url.pathname` and `url.search` only.

### 3. What a refused path returns

`null`, the same as every other rejection in this function.

No caller changes are needed, and that was confirmed by reading every caller rather than assumed.
`sanitizeReturnTo` has exactly two callers in the repository, both inside its own module:

- `captureReturnTo` (line 153) returns early on `null` and writes nothing.
- `consumeReturnTo` (line 169) returns the `null` straight through.

`consumeReturnTo` in turn has exactly two call sites, both in `apps/web/src/auth/react.tsx`:

- line 539, inside `logout()`, which discards the return value entirely.
- line 723, the restore effect, whose body is `if (target && target !== currentPath) navigate(...)`,
  so a `null` is already "no restore".

`captureReturnTo` has one call site, `react.tsx` line 769, in the login effect.

None of the three needs to change, and none of them may be changed in this slice.

### 4. The consume-once property is unchanged

`consumeReturnTo` reads, then calls `dropItem`, and only THEN calls `sanitizeReturnTo`.
The new refusal lives entirely inside `sanitizeReturnTo`, which runs after the `removeItem`, so a
stored `/no-role` is still destroyed on the very read that rejects it.
It cannot be retried on a later mount, and a `StrictMode` double effect still finds an empty slot.
This is pinned by a new test rather than left as a claim.

## The exact change

### `apps/web/src/auth/session-recovery.ts`

Insert the constant and its matcher between `dropItem` (ends line 92) and the `sanitizeReturnTo`
docstring (starts line 94).

```diff
 function dropItem(storage: StorageLike | null, key: string): void {
   if (!storage) return;
   try {
     storage.removeItem(key);
   } catch {
     // Same as above: an unwritable storage is an empty storage.
   }
 }
 
+/**
+ * Routes that are TERMINAL auth screens. Reaching one is the END of a failed
+ * authorization, never a place the operator asked to be, so none of them is ever a
+ * legitimate post-login `returnTo`: restoring one turns `Entrar` into
+ * `Acesso não autorizado` while the session it just created is perfectly good.
+ *
+ * - `/no-role` renders `NoRolePage`. `SalesOpsApp` navigates here whenever `roles === []`,
+ *   which is exactly what a live session loss produces underneath the `SignedOutPanel`
+ *   overlay, so this is the value most likely to be sitting in the slot at the one moment
+ *   it matters.
+ *
+ * Deliberately NOT members: `/admin/*`, `/finder/*` and `/seller/*`. Those are legacy
+ * CONTENT trees rather than error screens. Their `RoleGuard` bounces an unentitled
+ * operator to `/no-role`, while an entitled one lands on a real page, so refusing them
+ * would strand a legitimate restore for the only operator who can reach them. `/auth` and
+ * `/auth/*` keep their own separate check below, for an unrelated reason: they are proxied
+ * to the API BFF.
+ */
+const TERMINAL_AUTH_ROUTES: readonly string[] = ['/no-role'];
+
+/**
+ * Matches a NORMALIZED pathname against `TERMINAL_AUTH_ROUTES` the way React Router
+ * matches it against the route table, because anything looser leaves a spelling this
+ * guard permits and the router still renders as the terminal screen.
+ *
+ * - Per-segment percent-decoding, mirroring `decodePath` in `@remix-run/router`, which
+ *   `matchRoutesImpl` applies BEFORE matching: `new URL('/%6Eo-role', origin).pathname`
+ *   keeps the escape verbatim, so a raw compare would miss it. The `/` re-encoding is
+ *   copied from there too, so an encoded slash cannot manufacture a segment boundary the
+ *   router would not see. A malformed escape falls back to the undecoded value, exactly
+ *   as `decodePath` does, so nothing is over-blocked.
+ * - Case-insensitive, because `compilePath` builds its matcher with the `i` flag unless a
+ *   route opts into `caseSensitive` and no route in `router.tsx` does, so `/NO-ROLE`
+ *   renders `NoRolePage`. `toLowerCase` and not `toLocaleLowerCase`: this comparison must
+ *   not depend on the operator's locale.
+ * - Trailing slashes stripped, because `compilePath` ends the pattern with `\/*$`, so
+ *   `/no-role/` and `/no-role//` render `NoRolePage` too.
+ *
+ * The query string is deliberately not consulted: the matcher never sees it, so
+ * `/no-role?x=1` is the same terminal screen and the pathname alone decides.
+ */
+function isTerminalAuthRoute(pathname: string): boolean {
+  let decoded: string;
+  try {
+    decoded = pathname
+      .split('/')
+      .map((segment) => decodeURIComponent(segment).replace(/\//g, '%2F'))
+      .join('/');
+  } catch {
+    decoded = pathname;
+  }
+  return TERMINAL_AUTH_ROUTES.includes(decoded.replace(/\/+$/, '').toLowerCase());
+}
+
 /**
  * The open-redirect guard. A value is honoured only as a same-origin RELATIVE path.
```

Extend the numbered contract in the `sanitizeReturnTo` docstring, inserting the new rule as item 8
so the list stays in code order and renumbering the old item 8 to 9.

```diff
  *    but what leaves this function is the normalized path, so the normalized path is
  *    what has to be validated;
- * 8. the normalized result is not `/`, the default landing route - nothing to restore.
+ * 8. the NORMALIZED pathname is not a TERMINAL auth screen. Same placement as check 7 and
+ *    for the same reason: `/foo/../no-role` has `.` as its second character and resolves
+ *    same-origin, so it walks past every raw check and only BECOMES `/no-role` here. A
+ *    refusal written against the raw input is bypassed by one dot segment;
+ * 9. the normalized result is not `/`, the default landing route - nothing to restore.
```

Add the check itself inside the post-normalization block, beside the other re-asserted checks and
before the `/` check.

```diff
   const normalized = `${url.pathname}${url.search}`;
   // The invariant is on the RETURNED string, so re-assert it on the value being
   // returned rather than trusting the raw check above to still describe it.
   if (normalized[0] !== '/') return null;
   if (normalized[1] === '/' || normalized[1] === '\\') return null;
+  // Same place and same reason: what this function hands back is the NORMALIZED path, so
+  // that is the string the terminal-route refusal has to be asserted on. Checking the raw
+  // input instead is bypassed by `/foo/../no-role`.
+  if (isTerminalAuthRoute(url.pathname)) return null;
   return normalized === '/' ? null : normalized;
 }
```

Nothing else in the file changes.
No export is added: the constant stays module-private so the oracle pins literal paths rather than
whatever the implementation happens to contain, which is what keeps the test able to fail if the set
is ever emptied.

## The oracle

All additions go into `apps/web/src/auth/__tests__/session-recovery.test.ts`, in the existing style:
hoisted tables driven by `it.each`, plus named `it` blocks for the assertions that carry reasoning.

### Table additions

Append to `ACCEPTED_RETURN_TO`, after the existing dot-segment entry.

```diff
   // Benign dot-segment normalization still resolves and is still honoured. The guard
   // rejects what normalization PRODUCES, never the fact that it happened.
   ['/a/../cadastros', '/cadastros'],
+  // No over-blocking. The terminal-route refusal is an EXACT pathname match, so an
+  // ordinary Sales Ops route is untouched, and so is a legacy content tree whose
+  // `RoleGuard` merely redirects to `/no-role` when the operator lacks the role.
+  ['/tatico/dashboard', '/tatico/dashboard'],
+  ['/admin/finders', '/admin/finders'],
 ];
```

Append to `REJECTED_RETURN_TO`, after the dot-segment family.

```diff
   '/.//evil.example',
   '/a/../..//evil.example',
+  /**
+   * The terminal-screen family. `/no-role` is where a failed authorization ENDS, so
+   * restoring it after a login is the reported "I click Entrar and get Acesso não
+   * autorizado". Every spelling here is one React Router renders as `NoRolePage`: the
+   * matcher never sees the query string, `compilePath` eats trailing slashes with `\/*$`
+   * and carries the `i` flag, and `matchRoutes` percent-decodes the pathname before
+   * matching. A guard that refuses only the literal `/no-role` leaves all of them open.
+   */
+  '/no-role',
+  '/no-role/',
+  '/no-role//',
+  '/no-role?x=1',
+  '/no-role#frag',
+  '/NO-ROLE',
+  '/No-Role/',
+  '/%6Eo-role',
 ];
```

### Named tests inside `describe('sanitizeReturnTo')`

Add both after the existing `rejects null and undefined` test and before the off-origin invariant.

```ts
  /**
   * THE assertion this slice exists for, and the only one that separates a refusal
   * written against the NORMALIZED path from one written against the raw input. Every
   * value here has `.` as its second character and resolves same-origin, so it walks past
   * every raw structural check and only BECOMES `/no-role` inside `new URL`. A refusal
   * placed on the raw string passes every other test in this file and fails exactly this.
   */
  it('refuses a terminal route that only appears after dot-segment normalization', () => {
    const bypasses = ['/foo/../no-role', '/./no-role', '/a/b/../../no-role', '/foo/../no-role?x=1'];

    for (const value of bypasses) {
      expect({ value, result: sanitizeReturnTo(value, ORIGIN) }).toEqual({ value, result: null });
    }
  });

  /**
   * The refusal is an EXACT pathname match, never a prefix one. Neither of these matches
   * the `/no-role` route: `compilePath` produces `^\/no\-role\/*$`, so the first falls
   * through to `/:workspace/:view` and the second to the `*` redirect. Refusing them would
   * cost a restore while protecting nothing.
   */
  it('does not over-block routes that merely start with a terminal route', () => {
    expect(sanitizeReturnTo('/no-role/extra', ORIGIN)).toBe('/no-role/extra');
    expect(sanitizeReturnTo('/no-roles', ORIGIN)).toBe('/no-roles');
  });
```

### Named tests inside `describe('captureReturnTo / consumeReturnTo')`

Add after `writes nothing when the captured path is hostile`.

```ts
  it('writes nothing when the captured path is the terminal /no-role screen', () => {
    const { map, storage } = fakeStorage();
    captureReturnTo('/no-role', ORIGIN, storage);

    expect(map.has(RETURN_TO_KEY)).toBe(false);
  });

  /**
   * The consume-before-validate property, asserted for the new refusal too. The slot is
   * emptied on the read that rejects it, so a `/no-role` written by anything else is
   * consumed exactly once and cannot be retried on a later mount or by a StrictMode
   * double effect.
   */
  it('destroys a stored terminal route on the read that rejects it', () => {
    const { map, storage } = fakeStorage({ [RETURN_TO_KEY]: '/no-role' });

    expect(consumeReturnTo(ORIGIN, storage)).toBeNull();
    expect(map.has(RETURN_TO_KEY)).toBe(false);
  });
```

No import changes are needed: `captureReturnTo`, `consumeReturnTo`, `sanitizeReturnTo` and
`RETURN_TO_KEY` are all already imported by this file.

### Which of these fail on current code

Fail today, and are the proof the slice landed:

- `rejects "/no-role"`
- `rejects "/no-role/"`
- `rejects "/no-role//"`
- `rejects "/no-role?x=1"`
- `rejects "/no-role#frag"`
- `rejects "/NO-ROLE"`
- `rejects "/No-Role/"`
- `rejects "/%6Eo-role"`
- `refuses a terminal route that only appears after dot-segment normalization`
- `writes nothing when the captured path is the terminal /no-role screen`
- `destroys a stored terminal route on the read that rejects it` (its first assertion fails;
  `consumeReturnTo` currently answers `/no-role`, while the `map.has` assertion already passes)

Pass today and must keep passing, so they are guards rather than proof:

- `accepts "/tatico/dashboard" as "/tatico/dashboard"`
- `accepts "/admin/finders" as "/admin/finders"`
- `does not over-block routes that merely start with a terminal route`
- every existing off-origin, dot-segment, length, control-character and `/auth` case
- `never returns a value that resolves off-origin`, whose corpus now also covers the new entries

## Execution order

1. Add the new tests first and run the oracle. Confirm the eleven failures listed above, and
   confirm nothing else in the file went red.
2. Add `TERMINAL_AUTH_ROUTES` and `isTerminalAuthRoute`.
3. Add the single call inside the post-normalization block, and update the docstring numbering.
4. Re-run the oracle. Everything green.
5. Run the full web suite, lint and type-check.

A deliberate mid-step check for the executor: temporarily moving the new call above the
`new URL(...)` block, so it tests the raw `value`, must turn
`refuses a terminal route that only appears after dot-segment normalization` red while every other
new test stays green. That is what proves the oracle really pins the placement. Revert it
immediately.

## Commands

Oracle for this slice:

```bash
pnpm --filter @fxl-sales/web exec vitest run src/auth/__tests__/session-recovery.test.ts
```

Full gate before handing off:

```bash
pnpm --filter @fxl-sales/web test
pnpm --filter @fxl-sales/web lint
pnpm --filter @fxl-sales/web type-check
```

## Risks and non-risks

- **Over-blocking.** The only real risk. It is bounded by exact-match semantics and pinned by two
  accepted-table entries plus a named test. A future member added to the constant needs the same
  treatment.
- **Under-blocking through a spelling nobody thought of.** Mitigated by deriving every matching rule
  from `compilePath` and `decodePath` rather than from intuition, and by pinning the case, trailing
  slash, query and percent-encoded spellings individually.
- **Not a risk: caller breakage.** Every caller was read; `null` already means "no restore" at all
  three consumption points in `react.tsx`.
- **Not a risk: the consume-once property.** The refusal runs strictly after `dropItem`, and a test
  now says so.

## Observations filed, not fixed here

`url.pathname === '/auth'` and `startsWith('/auth/')` are case-sensitive, so `/Auth/login` walks
past check 6.
That path is a server proxy target rather than a React route, so nothing in the router renders it
and the impact is limited to one wasted navigation.
It is out of scope for this slice, which must not change the `/auth` check, and belongs in
`nexo/ROADMAP.md` if anyone judges it worth a line.

CLAUDE.md's `sanitizeReturnTo` bullet (the three lines beginning "re-asserts its structural checks
on the NORMALIZED value") should gain a sentence during Capture, along the lines of: the same
normalized value is refused outright when it names a terminal auth screen such as `/no-role`,
matched the way React Router matches it, so a dead end can never be restored as a returnTo.
This slice does not edit CLAUDE.md, because `files_modified` names two files and only two.
