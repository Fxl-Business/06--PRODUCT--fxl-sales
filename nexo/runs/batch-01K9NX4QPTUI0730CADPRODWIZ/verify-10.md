# Verify - slice 10 `info-hints`

Branch `feat/10-info-hints`, uncommitted working tree, merge-base `f9ad914`.

## Verdict: FAIL

One critical acceptance criterion is not met, and the test written to cover it is a false positive.
Everything else in the slice is good - the amber classification in particular was done carefully and correctly, and I could not break it.

## Oracles - verbatim

| Command | Baseline | Actual | Result |
| --- | --- | --- | --- |
| `pnpm test` (web) | 409 tests / 39 files | **419 passed / 40 files** | pass, +10 tests / +1 file |
| `pnpm test` (api) | 300 tests / 29 files | **300 passed / 29 files** | pass, unchanged |
| `pnpm run lint` | clean | clean, exit 0 | pass |
| `pnpm run type-check` | clean | clean, exit 0 | pass |

The +10 web tests reconcile exactly: 7 new in `info-hint.test.tsx`, 2 new in `product-service-dialog.test.tsx`, 1 new in `sale-wizard-ui-contract.test.tsx`.
No count dropped anywhere.

Grep of the diff for added `.skip` / `.only` / `todo(`: **none**.
Grep of added lines and both new files for the em dash character: **none**.

## THE decisive check - what did NOT move

I did not take the classification on faith.
I enumerated every occurrence of the three amber palette bytes (`#fdf0cf`, `#f0dfae`, `#9c7210`) in `apps/web/src/sales-ops/SalesOpsApp.tsx` at `HEAD` and in the working tree and diffed the two lists.

**Result: the classification was genuinely applied. This is not a blanket sweep.**

Exactly five sites changed, and all five are correct:

- Three standalone explanatory banners removed and re-homed into `InfoHint` (baseline lines 3801, 7233, 7612).
- Two per-row helper spans re-skinned (baseline lines 6689, 6889).

Every other amber site - roughly 25 of them, including all badges, status pills, links and numeric emphasis - is **byte-identical**.

### 1. State indicators - all intact

| Indicator | baseline count | current count |
| --- | --- | --- |
| `Sem área` | 1 | 1 |
| `Alterado manualmente` | 3 | 3 |
| `Definido na venda` | 3 | 3 |

None was moved behind a click.
The slice even added a positive-control test (`leaves the definido na venda state indicator inline when the tip moves`) that asserts both Serviço zero-value placeholders stay inline.
That is the right instinct.

### 2. The `planDirty` amber confirm bar - untouched

Baseline line 7122, current line 7134.
The `git diff` contains **no hunk** touching it, and its className string

```
mb-2.5 flex flex-wrap items-center justify-between gap-2 rounded-[10px] border border-[#f0dfae] bg-[#fdf0cf] px-3 py-2 text-[12.5px] font-semibold text-[#9c7210]
```

is byte-for-byte what it was, as are `Aplicar`, `Manter parcelas`, `regeneratePlan` and `keepEditedRows`.
This is the palette that a careless sweep would have caught, and it did not get caught.
`sale-wizard-ui-contract.test.tsx` now pins that exact class substring, so a future sweep would fail.

### 3. Per-row live helper lines - text preserved

Both step-1 slots keep their copy character for character (`Item avulso - informe a área, a descrição e o valor` and `{descriptionHint}`).
They lost only the `AlertTriangle` icon and the amber tone, dropping to `text-[11.5px] text-[#8b8b92]`.
That matches the required outcome. They also lost `font-semibold`, which is a cosmetic consequence of the same de-warning and is fine.

## Other checks

**4. No new dependency - pass.**
`git diff` on `apps/web/package.json`, root `package.json` and `pnpm-lock.yaml` is **empty**.
No `@radix-ui/react-popover` or `@radix-ui/react-tooltip` appears anywhere in `apps/web/src` or in any manifest.
`InfoHint` is hand-built at `apps/web/src/components/ui/info-hint.tsx`, inline and non-portalled, following the `Combobox` precedent.

**6. Placement - pass.**
Step 3's hint sits beside the `Profissionais alocados` heading on step 3; step 4's sits beside `Previsão de contas a pagar` on step 4.
The produto hint is attached to the `DialogTitle` rather than to a step section, which is the right call - that sentence is global to all four steps, so no single section owns it, and the header is visible on every step.
`DialogTitle` keeps its own className so Radix's accessible name is unaffected.

**Scope creep - none.**
The diff is 146 insertions / 48 deletions across three files plus two new files, and every line is on-topic.

## Adversarial: revert the source, keep the tests

Reverting **only** `SalesOpsApp.tsx` to `HEAD` (leaving all tests and `info-hint.tsx` in place):

```
FAIL src/sales-ops/__tests__/product-service-dialog.test.tsx > keeps the default-values explanation behind an info hint instead of a banner
  AssertionError: expected 'Novo serviçoValor variável, custos po…' not to contain 'Tudo aqui é padrão: dentro da propost…'
FAIL src/sales-ops/__tests__/sale-wizard-ui-contract.test.tsx > keeps first-run explanatory copy behind an info hint and live UI inline
  AssertionError: expected 'import {\n  AlertTriangle,\n  Calenda…' to contain 'InfoHint'
Tests  2 failed | 58 passed (60)
```

Both fail, and for the right reason.
Source restored and verified by SHA-256; `git status` matches what I found at the start exactly.

## FINDING 1 (blocking) - Escape closes the whole dialog, and the test does not catch it

The acceptance criteria flagged this as critical: "Escape must close only the hint, NOT the surrounding Radix Dialog... verify there is a real test for this and that it would actually catch a regression."

**Both halves fail.**

### The test is a false positive

`info-hint.test.tsx` has `does not let Escape escape into a surrounding dialog`, which renders `<div onKeyDown={spy}>` around the hint and asserts the spy is not called.
That only exercises React's synthetic bubbling, which plain `event.stopPropagation()` already satisfies.

Mutation test - I deleted the single line `event.nativeEvent.stopImmediatePropagation();` from `info-hint.tsx`, the only line that was supposed to provide the protection:

```
Test Files  1 passed (1)
     Tests  7 passed (7)
```

All seven tests stay green with the protection removed.
The test cannot catch the regression it names.

### The behavior itself is wrong

I wrote a throwaway probe rendering `InfoHint` inside a **real** `Dialog` / `DialogContent` and asserting the dialog is still open after Escape.
Against the **shipped, unmutated** source:

```
FAIL probe: Escape inside a real Radix Dialog > closes only the hint, never the dialog
  AssertionError: expected false to be true
```

The hint does close, but so does the dialog.

Root cause: Radix's `useEscapeKeydown` registers its listener as `document.addEventListener('keydown', handler, { capture: true })`.
A document capture-phase listener runs **before** the event ever reaches React's root container, so no handler in the React tree - `stopPropagation`, `stopImmediatePropagation` or otherwise - can pre-empt it.
The comment in `info-hint.tsx` claiming those three calls make Escape close "only the hint" is factually incorrect.

And `apps/web/src/components/ui/dialog.tsx` documents that Escape is deliberately left working as a dialog-close affordance app-wide (only outside-click was removed), so this really does discard the operator's typed work.

### Mitigating context, and why it still blocks

This is architecturally pre-existing.
I ran the identical probe against the **untouched** `Combobox`, which uses the same three-call idiom with the same comment:

```
PROBE2 dialogOpen after Escape = false
```

So `Combobox` on `master` has the same hole, and slice 10 copied an existing pattern faithfully rather than inventing a new bug.

It still blocks, for two reasons.
First, the criterion was called out as critical and is simply not met.
Second, the slice creates a **new** path into the hole: before this change the tips were static text with no dismissal gesture, so there was no reason to press Escape at them.
An on-demand disclosure invites Escape as the natural "put this away" reflex, and the cost of that reflex is the whole wizard's typed work.

### Fix direction

React-level interception cannot work against a document capture listener.
The workable fix is at the `DialogContent` seam: have `InfoHint` (and `Combobox`) publish "an inner layer is open" into a context, and have `DialogContent` pass `onEscapeKeyDown={(e) => { if (innerLayerOpen) e.preventDefault(); }}`.
Whatever the fix, the regression test must be the real one - `InfoHint` inside an actual `Dialog`, asserting `onOpenChange` was not called - not a React sibling spy.

## FINDING 2 (minor) - step-4 hint panel can be clipped

The step-4 `InfoHint` at line 7760 sits inside

```
<div className="overflow-hidden rounded-[14px] border border-[#e8e8ec] bg-white">
```

The panel is `position: absolute; top: 100%` relative to the hint's own wrapper, which is inside that clipping box, so the roughly 62px panel is clipped at the card's bottom edge whenever the payables preview table below it is short or empty.
With several preview rows it paints fine.
Worth a visual check on an empty preview; the produto header hint and the step-3 card have no clipping ancestor and are fine.

## FINDING 3 (minor) - trigger contrast below the non-text minimum

The trigger is `text-[#b0b0b8]` on white, which computes to about **2.15:1** - under the 3:1 WCAG 1.4.11 floor for meaningful non-text graphics, at a 15px glyph.

## Discoverability judgement

The affordance does read as informational: it is the universal `Info` circled-i glyph, it sits immediately beside the bold heading of the section it explains, and it is a real `<button>` with focus-visible styling and an accessible name (`Mais informações sobre <label>`), so it is in the tab order and touch-reachable.
Making it a click disclosure rather than a hover tooltip was the right call for exactly the reasons the file's own comment gives.
My only reservation is Finding 3: at `#b0b0b8` it is faint enough that a hurried operator may not register it. Darkening it to roughly `#8b8b92` would fix both the contrast number and the discoverability concern at once, with no layout cost.

Separately, the step-4 hint is close to redundant - the line directly beneath it already says "Estes lançamentos serão gerados quando a proposta for marcada como Ganha." inline. Not a defect, just noted.

## What is good

Worth stating plainly, because the blocking finding is narrow: the hard part of this slice was the classification, and it was done right.
The exhaustive palette diff shows advice was separated from state with real judgement rather than by sweeping a color, the `planDirty` bar survived byte-identical, all three state indicators survived, the copy moved rather than being deleted, and the implementer added a positive-control test for the classification rule itself.
Fixing Finding 1 should not require disturbing any of that.
