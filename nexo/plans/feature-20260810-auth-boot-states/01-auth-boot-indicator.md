---
id: 01-auth-boot-indicator
milestone: v2.8.0
status: todo
depends_on: []
files_modified: [apps/web/src/auth/react.tsx, apps/web/src/auth/__tests__/react.test.tsx]
acceptance: While `HubProtected` has no resolved session it renders a `role="status"` panel naming what is happening in pt-BR instead of the blank full-viewport `Skeleton`, the panel is revealed by a 400ms-delayed CSS animation rather than by any JavaScript timer, and `vi.getTimerCount()` is still `0` while it is on screen and after unmount.
---

# 01 - Auth boot indicator

## Context

`apps/web/src/auth/react.tsx:595-597` is the whole waiting state:

```tsx
if (!isLoaded || !isSignedIn) {
  return <Skeleton className="h-screen w-full" />;
}
```

`Skeleton` is `div.animate-pulse.rounded-md.bg-muted`.
At `h-screen w-full` that is one pulsing grey rectangle covering the viewport, which reads as a page that failed to load rather than as work in progress.
It is what the operator stared at for about a minute during the `v2.7.1` outage (`nexo/milestones/v2.7.1/SUMMARY.md`), and it is feature acceptance criterion 1 in `00-OVERVIEW.md`.

This slice replaces that one branch and nothing else.

## Boundary

IN: the waiting state, meaning `!isLoaded` (cold start, session not yet resolved) and `isLoaded && !isSignedIn` (resolved as signed out, and `HubProtected`'s login effect is about to hand the browser to the Hub).

OUT, owned by slice 03: the terminal states.
`logoutIntent` (`SignedOutPanel`) and `loginBlocked` (`SessionRecoveryPanel`) already return above this branch and are untouched here.
Slice 03 adds not-signed-in / not-entitled / wrong-workspace and will return them above the boot branch in the same way.

OUT, owned by slice 02: refresh classification.
Nothing in this slice reads `HubTokenResult`, `failure`, or a status code.

The component this slice introduces, `AuthBootIndicator`, is a WAITING panel.
Slice 03 must not reuse it for a terminal state: a terminal state is not delayed, is not a live region, and carries an action button.
What slice 03 may reuse is the layout string `flex h-screen flex-col items-center justify-center gap-4 px-6 text-center`, which `SessionRecoveryPanel`, `SignedOutPanel` and `AuthBootIndicator` all already share verbatim.
If slice 03 wants to extract that shared shell it may; this slice deliberately does not, because extracting a shell from three call sites one slice before three more arrive is the wrong moment.

## Design decisions

### 1. What it looks like

A centred `h-screen` panel matching the two panels already in the file: spinner, `h1` heading, muted supporting line.

A spinner IS warranted.
A heading alone still cannot be told apart from a page that rendered once and stopped; a moving spinner is the only element on the screen that proves the app is alive.

Do not invent an animation primitive and do not add a dependency.
There is no `Spinner` in `apps/web/src/components/ui/**`.
The established idiom in this codebase is `Loader2` from `lucide-react` with `animate-spin`, used at thirteen call sites (`apps/web/src/sales-ops/SalesOpsApp.tsx`, `apps/web/src/sales-ops/CadastroHistoryPanel.tsx`), and `lucide-react` is already imported at the top of `react.tsx` for `LogOut`.
Extend that import; add nothing.

### 2. Do not flash it - CSS delay, NOT a JavaScript timer

The delay is **400ms**, expressed entirely in CSS by the already-installed `tailwindcss-animate` plugin, with no `setTimeout`, no `useEffect`, no state and therefore no cleanup:

```
animate-in fade-in-0 duration-200 delay-[400ms] fill-mode-both
```

How that composes, verified against `node_modules/.pnpm/tailwindcss-animate@1.0.7*/.../index.js`:

- `.animate-in` sets `animation-name: enter` and seeds the `--tw-enter-*` custom properties.
- `fade-in-0` sets `--tw-enter-opacity: 0`, so the `enter` keyframe's `from` is `opacity: 0` and its `to` is `opacity: 1`. Every `--tw-enter-translate/scale/rotate` stays at its identity value, so nothing moves - the reveal is a pure opacity crossfade with no transform.
- `duration-200` sets `animation-duration: 200ms`.
- `delay-[400ms]` sets `animation-delay: 400ms`. `matchUtilities({delay: ...})` in that plugin takes arbitrary values, so the bracket form is supported.
- `fill-mode-both` sets `animation-fill-mode: both`. **This is the load-bearing token.** The backwards half of `both` is what applies the `from` keyframe - `opacity: 0` - during the 400ms delay. Without it the panel is fully opaque during the delay and the flash is back.

The same five tokens are already used together throughout `apps/web/src/components/ui/dialog.tsx`, `alert-dialog.tsx`, `select.tsx` and `dropdown-menu.tsx`, so this is the file-local idiom, not a new mechanism.
No `tailwind.config.ts` change is needed and none may be made: every token comes from the installed plugin, and the class literals sit inside `apps/web/src/**/*.tsx`, which the `content` glob already scans.

Note that core Tailwind also emits `.duration-200` and `.delay-[400ms]` for `transition-duration` / `transition-delay`.
That is not a collision: the two plugins write different CSS properties, the element declares no transition, and this is exactly how the four shadcn primitives above already behave.

`prefers-reduced-motion` is deliberately not branched on.
The reveal animates opacity only, with no transform, which is not a vestibular trigger, and the `animate-spin` on `Loader2` follows the unguarded convention of all thirteen existing call sites.
Adding a `motion-reduce` variant here would also be a trap: killing the animation without also removing the fill would pin the panel at `opacity: 0` forever.

**Why CSS and not `setTimeout` + `useState`.**
Three independent reasons, and the second is the decisive one:

1. A timer that does not exist cannot leak. The file's `mountedRef` / `clearRevalidateTimer` discipline exists because the ladder genuinely needs a timer; this does not, and the cheapest way to honour that discipline is to have nothing to clean up. It also removes a state update, a re-render, and a StrictMode double-mount question.
2. **It preserves the `vi.getTimerCount()` oracle.** `apps/web/src/auth/__tests__/react.test.tsx:542-549` documents that oracle in as many words: *"The ladder is the only thing in `react.tsx` that schedules a timer, so a count of `0` after a `401` is proof that no rung EXISTS"*, explicitly citing the CLAUDE.md note about a happy-dom test passing with a real bug present. A second timer source inside `HubProtected` would break the assertions at lines 566, 611 and 634 outright and would permanently blunt the oracle for every future ladder test, because `Protected` is what those tests render. The revalidation ladder is the most safety-critical machinery in this file; degrading its only trustworthy oracle to save a CSS class would be a bad trade.
3. The reveal becomes a pure function of wall-clock time since mount, computed by the compositor. It cannot desynchronise from React, cannot be delayed by a busy main thread, and needs no interaction with `act`.

The anti-flash guarantee is therefore STRUCTURAL, not observed: the panel is at `opacity: 0` for its first 400ms of existence, so a panel that unmounts before 400ms was never visible, for every possible resolve latency.
That is the invariant-that-makes-the-failure-impossible form CLAUDE.md asks for, in place of trying to observe a 30ms race in an environment that computes no animation.

### 3. First load versus re-auth - the copy DOES differ

The distinction is one ternary on a value already in scope, and the two situations are genuinely different facts, so state each one:

- `!isLoaded` - the session has not been resolved yet. We are asking the BFF.
- `isLoaded && !isSignedIn` - it HAS been resolved, the answer was "no session", and the login effect two hooks above is calling `client.login()`, which navigates the whole browser to the Hub.

Collapsing both into one message would reproduce, in miniature, the exact ambiguity this feature exists to remove.
During the `v2.7.1` redirect loop the operator cycled through both states four times and the screen said nothing either way.

The two states share ONE element at ONE position, so React reconciles them onto the same DOM node and only the text changes.
The 400ms reveal clock therefore measures total time waiting, from the first mount, and does NOT restart when `isLoaded` flips - which is right, because what the operator is enduring is the total wait, not each sub-state.
Render it as a single `<AuthBootIndicator state={...} />`, never as two sibling branches returning two different elements.

### 4. Accessibility

`role="status"` on the container.
That is an implicit `aria-live="polite"` plus `aria-atomic="true"`, so a screen reader announces the panel's text, and announces it again when the text changes from the verifying copy to the redirecting copy.
Do not also write `aria-live="polite"` - it is redundant with the role.
`aria-hidden="true"` on the `Loader2` icon, matching the `LogOut` icon at `react.tsx:652`.

No focus management, no focus trap, no `aria-busy` on an ancestor.
The task limit is one live region and this is it.
The panel contains no interactive element, so there is nothing to focus.

Accepted and deliberate: `opacity: 0` does not remove an element from the accessibility tree, so an assistive technology may announce the panel during the invisible 400ms window.
That is the right asymmetry - the delay exists to prevent a VISUAL flash, and an AT user benefits from immediate feedback.

## Implementation

### `apps/web/src/auth/react.tsx`

**a. Imports.**

- Line 4: `import { LogOut } from 'lucide-react';` becomes `import { Loader2, LogOut } from 'lucide-react';`.
- Line 19: DELETE `import { Skeleton } from '@/components/ui/skeleton';`. It has exactly one use in this file (line 596) and leaving it fails `pnpm run lint`. Do NOT delete `apps/web/src/components/ui/skeleton.tsx`; it has other consumers.

**b. New component**, placed immediately after `SignedOutPanel` (ends line 496) and before `HubProtected`, so the three panels stay adjacent in the file:

```tsx
/**
 * The WAITING state, and the only thing `HubProtected` renders while no session has
 * been resolved. It replaces a full-viewport `Skeleton`, which rendered as one pulsing
 * grey rectangle and read as a page that had failed rather than as work in progress -
 * the blank minute reported in `nexo/milestones/v2.7.1/SUMMARY.md`.
 *
 * The reveal is delayed 400ms so a session that resolves from cache in 30ms cannot
 * flash a spinner, and it is delayed in CSS rather than by a `setTimeout` for two
 * reasons. A timer that does not exist cannot leak, and - decisively - the ladder tests
 * in this file use `vi.getTimerCount()` as their oracle for "did this outcome enter the
 * ladder", which is only sound while the ladder is the ONLY thing in this module that
 * schedules a timer. See `01-auth-boot-indicator.md`.
 *
 * `fill-mode-both` is the load-bearing token: its backwards half is what holds the
 * panel at the `fade-in-0` keyframe's `opacity: 0` DURING the delay. Drop it and the
 * flash is back, fully visible for 400ms.
 *
 * `role="status"` implies `aria-live="polite"` and `aria-atomic="true"`, so a screen
 * reader announces the panel and announces it again when the copy changes. Strings are
 * hardcoded pt-BR to match the rest of this file (`Sair`, `Entrar`).
 */
function AuthBootIndicator({ state }: { state: 'verifying' | 'redirecting' }) {
  const verifying = state === 'verifying';

  return (
    <div
      className="flex h-screen flex-col items-center justify-center gap-4 px-6 text-center animate-in fade-in-0 duration-200 delay-[400ms] fill-mode-both"
      role="status"
    >
      <Loader2 aria-hidden="true" className="h-8 w-8 animate-spin text-muted-foreground" />
      <h1 className="text-2xl font-semibold">
        {verifying ? 'Entrando na sua conta' : 'Redirecionando para o login'}
      </h1>
      <p className="max-w-md text-muted-foreground">
        {verifying
          ? 'Estamos verificando sua sessão com o FXL Hub. Isso costuma levar alguns segundos.'
          : 'Sua sessão não está ativa. Estamos te levando para a tela de entrada do FXL Hub.'}
      </p>
    </div>
  );
}
```

Exact copy, for the executor to reproduce character for character including accents:

| state | heading | supporting line |
| --- | --- | --- |
| `verifying` (`!isLoaded`) | `Entrando na sua conta` | `Estamos verificando sua sessão com o FXL Hub. Isso costuma levar alguns segundos.` |
| `redirecting` (`isLoaded && !isSignedIn`) | `Redirecionando para o login` | `Sua sessão não está ativa. Estamos te levando para a tela de entrada do FXL Hub.` |

No raw account or workspace id appears, per CLAUDE.md "UI Identifiers".
No picker, input or `<select>` appears, so CLAUDE.md "UI Controls" is trivially satisfied.

**c. The call site**, replacing lines 595-597:

```tsx
  /*
    ONE element at ONE position for both states, so React reconciles them onto the same
    DOM node and the 400ms reveal clock measures the TOTAL wait rather than restarting
    when `isLoaded` flips. Two sibling branches returning two different elements would
    remount and re-hide the panel mid-wait.
  */
  if (!isLoaded || !isSignedIn) {
    return <AuthBootIndicator state={isLoaded ? 'redirecting' : 'verifying'} />;
  }
```

**d. Stale comments** that name the removed Skeleton and must be reworded in the same commit, or they drift:

- `react.tsx:275-277` - "which renders a Skeleton until `isSignedIn`" becomes "which renders the boot indicator until `isSignedIn`".
- `react.tsx:314-316` - "`HubProtected` holds its Skeleton rather than flashing a signed-out screen" becomes "`HubProtected` holds the boot indicator rather than flashing a signed-out screen".

### `apps/web/src/auth/__tests__/react.test.tsx`

Same stale-comment rule: lines 165-168, 195-198 and 603-609 all say "renders a Skeleton".
Reword to "renders the boot indicator"; the surrounding reasoning is unchanged and still correct.

## RED tests

All in `apps/web/src/auth/__tests__/react.test.tsx`, in a new `describe('auth boot indicator', ...)` placed after the existing `SessionRecoveryPanel` / logout describes.

Query the panel by `container.querySelector('[role="status"]')`.
Do NOT add a `data-testid` - `apps/web/src/**` currently has zero of them outside test-only probe components, and that is worth keeping.
`Probe` renders `<output data-testid="profile">`, whose `status` role is IMPLICIT, so an attribute selector cannot match it.

Helper for the tests that must hold the session unresolved:

```ts
const bootIndicator = (host: HTMLElement) => host.querySelector('[role="status"]');
```

1. **`it('names the sign-in in progress instead of rendering a blank screen', ...)`**
   `mocks.cache.getToken.mockReturnValue(deferred<HubTokenResult>().promise)` so the session never resolves; `renderProtected(['/tatico/dashboard'])`; `await flushReact()`.
   Assert `profileText(container) === 'loading'`, that `bootIndicator(container)` is non-null, that its `textContent` contains `Entrando na sua conta`, and - the mutation oracle for "the blank screen is gone" - that `container.querySelector('.animate-pulse')` is `null`.
   RED today: the branch renders `Skeleton`, which has `animate-pulse` and no `role`.

2. **`it('says it is handing the operator to the Hub login once the session resolves signed out', ...)`**
   `mocks.cache.getToken.mockResolvedValue(expired)`; `renderProtected(['/tatico/dashboard'])`; `await flushReact()`.
   Assert `profileText(container) === 'signed-out:'`, `mocks.client.login` was called once (the existing behaviour, unchanged), and that the indicator's `textContent` contains `Redirecionando para o login` and NOT `Entrando na sua conta`.
   This is the test that fails if the executor collapses the two copies into one.

3. **`it('holds the indicator hidden for the first 400ms, so a fast resolve cannot flash it', ...)`**
   Same unresolved mount as test 1.
   Read `bootIndicator(container)!.className.split(/\s+/)` and assert it contains every one of `animate-in`, `fade-in-0`, `duration-200`, `delay-[400ms]` and `fill-mode-both`.
   Write the reasoning into the test as a comment: happy-dom runs no CSS animation and computes no opacity, so a rendered-pixel assertion here would be exactly the false positive CLAUDE.md records; what is asserted instead is the declaration that makes the flash impossible for EVERY resolve latency. Each token is individually load-bearing - dropping `fill-mode-both` makes the panel opaque during the delay, dropping `delay-[400ms]` removes the delay, dropping `fade-in-0` makes the `enter` keyframe start at `opacity: 1` - so no assertion in the list is decoration.

4. **`it('schedules no timer at all, so the ladder stays the only timer source in this module', ...)`**
   `vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })` (the same shape as `useLadderTimers`); mount unresolved as in test 1 so `observeToken` never runs and the ladder is provably not involved.
   Assert `bootIndicator(container)` is non-null and `vi.getTimerCount() === 0` while it is on screen.
   Then unmount through the `act(() => root?.unmount())` idiom used at lines 740-745, assert `vi.getTimerCount() === 0` again, and `await vi.advanceTimersByTimeAsync(60_000)` inside `act` and assert `mocks.cache.getToken` was called exactly once (the mount read) - nothing woke up.
   This is the "no timer survives unmount" requirement in its strongest available form: it proves no timer was ever created, which is what keeps the `vi.getTimerCount()` oracle at lines 566, 611 and 634 meaning what its comment says it means.
   RED today for a reason worth stating: with the current `Skeleton` there is no `[role="status"]` element, so the first assertion fails. It is ALSO the test that turns red if a future executor "fixes" the delay with a `setTimeout`.

5. **`it('replaces the indicator with the protected tree once the session resolves', ...)`**
   `mocks.cache.getToken.mockResolvedValue(ok(profileToken('Alpha')))`; `renderProtected(['/cadastros/produtos'])`; `await flushReact()`.
   Assert `profileText(container) === 'signed-in:Alpha'`, `bootIndicator(container)` is `null`, and `locationText(container) === '/cadastros/produtos'` (the protected children really did render).
   Guards against a panel that renders unconditionally or lingers over the app.

Existing tests that must stay green untouched, and are the regression surface for this slice: `holds a cold start on a transient failure instead of signing out` (line 596), `signs out at cold start when the BFF says the session expired` (line 624) and `signs out at once when the BFF says the session expired, without entering the ladder` (line 550).
All three assert `vi.getTimerCount()`; if any of them goes red, the executor has added a timer and must go back to CSS.

## Verification

Run once, never in watch mode:

```bash
pnpm --filter @fxl-sales/web exec vitest run src/auth/__tests__/react.test.tsx
pnpm --filter @fxl-sales/web test
pnpm run lint
pnpm run type-check
pnpm test
pnpm run build
```

`apps/web`'s `test` script is already `vitest run`, so `pnpm --filter @fxl-sales/web test` is run-once by construction; do not invoke a bare `vitest`.

Mutation checks the verifier should perform, each expected to turn exactly the named test red:

- delete `fill-mode-both` from the class string -> test 3.
- delete `delay-[400ms]` -> test 3.
- collapse the ternary so both states render `Entrando na sua conta` -> test 2.
- restore `return <Skeleton className="h-screen w-full" />` -> tests 1, 3, 4.
- replace the CSS delay with a `useState` + `setTimeout` reveal -> test 4, plus lines 611 and 634 of the existing ladder tests.

Optional, not required for Gate 2 but cheap and worth one look given `.claude` memory note "Standalone component harness": load the app in a real browser with the network throttled and confirm by eye that a warm reload shows no spinner flash while a cold or throttled load fades the panel in.
happy-dom cannot see this and the tests deliberately do not claim to.

## Risks

- **The class-token assertions in test 3 are the only thing pinning the delay.** Deliberate. Changing 400ms to any other value is a design change and should require touching the test. The cost is that a purely cosmetic class reorder is safe (the test splits on whitespace and uses containment) but a token rename is not, which is the correct sensitivity.
- **`delay-[400ms]` depends on `tailwindcss-animate`'s `matchUtilities` accepting arbitrary values.** Verified against the installed `1.0.7` source, and the identical bracket idiom already ships in `dialog.tsx` (`slide-in-from-top-[48%]`). If a future Tailwind v4 migration lands, this is one of the call sites that needs re-checking, alongside the four shadcn primitives that use the same plugin.
- **A screen reader may announce the panel during the invisible window.** Accepted, argued above. If it ever proves noisy in practice the fix is `role="status"` on an inner element that mounts late, which is a bigger change than this slice should make speculatively.
- **Two copies to maintain rather than one.** Accepted: they describe two genuinely different facts, and slice 03 will very likely reuse the `redirecting` copy's boundary when it decides where "not signed in" stops being a wait and starts being terminal.
- **Slice 03 conflicts on the same file.** Known and priced in by `00-OVERVIEW.md`, which chose serial execution precisely because all three slices touch `apps/web/src/auth/**`. Slice 03 returns its terminal panels ABOVE the boot branch; it must not modify `AuthBootIndicator` itself.
- **`Skeleton` looks unused after this.** It is not - it has consumers elsewhere in `apps/web/src`. Remove only the import from `react.tsx`.
