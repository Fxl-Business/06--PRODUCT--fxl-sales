# A guard test must carry its own positive control, inside the test

**Date:** 2026-09-19
**Surfaced by:** slice 06 of `feature-20260918-kanban-pipeline-leads`, verifying the `useInlineLayer` Escape guard

## The old trap, and its second costume

`CLAUDE.md` already records that a regression test for the inline-layer Escape guard must render the component inside a REAL Radix `Dialog` and assert on `onOpenChange`, because a spy on a React sibling's `onKeyDown` passes even with the protection deleted.
Radix registers `useEscapeKeydown` on `document` with `{capture: true}`, so it runs before the event reaches React's root and no synthetic-event sibling can observe it.
That false positive shipped once.

The Kanban board's move dialog obeyed the recorded rule and rendered a real dialog.
The verifier then mutated one level up: replace `DialogContent` with a plain `<div role="dialog">`.

**With a hand-rolled div there is no Radix capture-phase listener at all.**
Escape does nothing, `onOpenChange` is never called, and a bare `expect(onOpenChange).not.toHaveBeenCalled()` passes - for exactly the wrong reason.
Same vacuity, new costume: the first version was a test that could not OBSERVE the mechanism, this one is a test that no longer HAS the mechanism.

The shipped test survived, because every guard case ends with an in-test positive control:

```
// with nothing inner open, Escape must still close the dialog
expect(onOpenChange).toHaveBeenCalledWith(false)
```

Against the hand-rolled div that assertion fails and the mutation reddens two named tests.
Against the real dialog with the registration disabled (`useInlineLayer(open)` to `useInlineLayer(false)`), a different two named tests redden.
Proven both ways.

## The generalisation

Every assertion of the form "this did NOT happen" is satisfied by two different worlds: the feature worked, and the machinery that could have made it happen was never there.
The test cannot tell them apart, and neither can a reader.

The cure is not a better `not.toHaveBeenCalled()`.
It is a second assertion, **in the same test**, that demands the machinery FIRE in the case where it should:

- guarding "Escape does not close the dialog while a picker is open"? Then assert, right after, that Escape DOES close it with nothing open.
- guarding "no request was issued"? Then drive the case that should issue one and assert it was.
- guarding "the button stays disabled"? Then supply the missing field and assert the same button becomes enabled.

That last one is not hypothetical: it is how the same feature's ghost-card oracle was proved live.
Forcing `draftValid` to `false` - which would make the "stays disabled" half pass forever - reddened the test on its enabling half.

## The rule

A negative assertion is half a test.
Pair it, in the same test body, with the positive case that proves the mechanism under test is present and live in this exact rendering.

A sibling-level or environment-level positive control is not enough, because the mutation that matters is usually the one that removes the mechanism from THIS render.
Put the control where the mutation lands.
