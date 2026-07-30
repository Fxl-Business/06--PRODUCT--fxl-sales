# Escape scoping for inline layers inside a Radix dialog

**Date:** 2026-07-30
**Surfaced by:** slice 10 of `batch-01K9NX4QPTUI0730CADPRODWIZ` (Gate 2 FAIL, then fixed)

## The problem

Radix's `useEscapeKeydown` registers its listener as:

```js
document.addEventListener('keydown', handler, { capture: true })
```

A document capture-phase listener runs **before** the event reaches React's root
container. So no handler anywhere in the React tree can pre-empt it - neither
`event.stopPropagation()` nor `event.nativeEvent.stopImmediatePropagation()`.

`Combobox` had carried that idiom, with a comment claiming it scoped Escape to the
panel, since long before this batch. The comment was simply wrong: pressing Escape at
an open picker inside the proposta wizard closed the entire wizard. `dialog.tsx`
deliberately keeps Escape working as an app-wide close affordance (only outside-click
was removed), so the cost was the operator's whole form of typed work.

## Why it went unnoticed

The test asserting the protection was a **false positive**. It rendered
`<div onKeyDown={spy}>` around the component and asserted the spy was not called - which
plain `stopPropagation()` satisfies on its own. Deleting the only protecting line left
every test green.

That is the general trap: **a synthetic-event sibling spy cannot observe a document
capture listener.** Any test of this behaviour must mount the component inside a REAL
`Dialog` and assert on `onOpenChange`.

## The fix

`apps/web/src/components/ui/inline-layer.ts` - a registry provided by `DialogContent`,
which then `preventDefault`s `onEscapeKeyDown` while any inner layer is open. Layers opt
in with `useInlineLayer(open)`.

Two details that are load-bearing rather than incidental:

- the open count is a **ref, not state**, so opening a picker does not re-render the
  surrounding dialog;
- release is **idempotent**, so a StrictMode double cleanup cannot drive the count
  negative and silently disarm the guard for the rest of the session.

`onEscapeKeyDown` joined the existing `Omit` on `DialogContentProps`, so no new public
prop was exposed and no call site can defeat the guard.

## The rule

Escape must still close the dialog when nothing inner is open - a fix that simply
disables Escape is a worse bug than the one it replaces. Pin both halves: one Escape
closes the layer and leaves the dialog, the next closes the dialog.
