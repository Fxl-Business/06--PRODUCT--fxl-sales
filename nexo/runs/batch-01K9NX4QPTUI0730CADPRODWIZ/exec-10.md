# exec-10 - persistent yellow banners become on-demand info hints

Slice: `10-info-hints`.
Branch: `feat/10-info-hints`.
Plan: `nexo/plans/batch-01K9NX4QPTUI0730CADPRODWIZ/10-info-hints.md`.

This slice ran LAST in the batch, so the plan's line numbers and its inventory were stale by construction.
The inventory below was rebuilt by re-running the plan's own greps against the file as it actually is after slices 02, 03, 04, 07, 08 and 09 landed.

## Re-grepped inventory

`apps/web/src/sales-ops/SalesOpsApp.tsx` is now **7844 lines**, not the 7175 the plan was written against.
Sweep re-run:

```
grep -rn "fbf6ea\|dcc98f\|9c7210\|amber\|fef3c7\|fde68a\|f59e0b\|92400e\|b45309\|d97706\|fffbeb\|yellow\|fdf0cf\|fbf3e0\|f0dfae\|f0e2bd\|d8cdb0" apps/web/src/
```

| # | Line (today) | Where | Text / role | Classification | Action taken |
| --- | --- | --- | --- | --- | --- |
| A | 3801 | `ProductDialog`, wizard step 1 (Identificação), under the `Produto \| Serviço` bar | "Tudo aqui é padrão: dentro da proposta você pode alterar qualquer valor sem mexer no cadastro." | **Tip** - unconditional for the screen, no value in its text | moved to an `InfoHint` beside `DialogTitle` in the dialog header |
| B | *gone* | `ProductDialog`, `isService` only | "Serviços têm valor variável, definido em cada proposta." | n/a | **skipped.** Slice 07 deleted this string; per the plan's reconciliation rule it was not resurrected |
| C | 7233 | Proposta wizard step 3, top | "Aloque os profissionais do projeto e ajuste os percentuais - a margem líquida e as comissões são calculadas em tempo real." | **Tip** | moved to an `InfoHint` beside the `Profissionais alocados` card heading |
| D | 7612 | Proposta wizard step 4, top | "Esta é uma previsão - nada é lançado no financeiro até a proposta ser marcada como Ganha." | **Tip** | moved to an `InfoHint` beside the `Previsão de contas a pagar` heading |
| E' | 3893 / 3924 | `ProductDialog` step 2, serviço | `placeholder={isService ? 'Definido na venda' : '0'}` | **State indicator** - it states the field's current (absent) value | **untouched** |
| F | 6808 | Wizard step 1, per item, produto with no `areaId` | `Sem área` pill | **State indicator** | **untouched** |
| G | 5650 | `overrideMarker`, step 3 commission fields | `Alterado manualmente` + `Restaurar padrão` | **State indicator** | **untouched** |
| H | 7453 | Step 3, per profissional, `costManual` | `Alterado manualmente` + restore link | **State indicator** | **untouched** |
| I | 7122 | Step 2, `planPendingRegeneration` | "Você ajustou as parcelas manualmente…" + `Aplicar` / `Manter parcelas` | **Live warning / action required** | **untouched, including its className** (pinned by a new positive assertion) |
| J | 6689-6692 | Step 1, per free item, `showItemErrors` else-branch | `AlertTriangle` + "Item avulso - informe a área, a descrição e o valor" | **Field helper** | icon dropped, tone demoted to `text-[11.5px] text-[#8b8b92]`, **copy byte-identical** |
| K | 6889-6892 | Step 1, per variable-value item, same slot | `AlertTriangle` + `{descriptionHint}` | **Field helper** | same treatment; `descriptionHint` and all its branches untouched |

Rechecked and deliberately still out of scope: the `bg-[#fdf0cf]` status/role chips (408, 1951, 1956, 2285, 2464, 2706, 5934, 5942), the dashed `Essa proposta teve um finder` / `Cadastrar produto` affordances (6532, 6560), the green plan summary, the red `#fbeee9` validation blocks, and `apps/web/src/admin/apps/KeyRevealModal.tsx:136`.
No **new** amber container had appeared in either dialog from slices 02-09, so nothing extra needed classifying.

### Divergences from the plan's stale inventory

1. **Tip B is gone.** Slice 07 gave a Serviço an editable base value and deleted the `Serviços têm valor variável` banner. Row B of the placement table was skipped, and the plan's test-3 instruction to "remove the `Serviços têm valor variável` assertion at :349" was already satisfied by slice 07 - that assertion is now a `not.toContain`, which is correct and was left alone.
2. **`DefinedOnSaleNotice` no longer exists as an element.** `Definido na venda` survives as an input `placeholder`, so the plan's `expect(text().match(/Definido na venda/g)?.length).toBe(2)` positive control is not expressible on `textContent`. It was replaced with a placeholder-based positive control (`moneyInput('Valor base (R$)').placeholder`), which asserts the same fact against today's DOM.
3. **`Info` is NOT added to `SalesOpsApp.tsx`'s lucide import.** The plan said to add it alphabetically between `Folder` and `LayoutGrid`, but the icon lives inside `InfoHint`; importing it at the call site would be an unused import and `no-unused-vars` is `error`. `AlertTriangle` was removed from that block as planned (it had no other use in the file).
4. **`InfoHint`'s Escape handler calls `event.nativeEvent.stopImmediatePropagation()` as well**, matching `Combobox`'s guard verbatim rather than the plan's two-call sketch. `preventDefault` + `stopPropagation` alone leaves a native document-level listener (which is exactly how Radix `DismissableLayer` listens) reachable in some orderings; `Combobox` already made this call for the same reason and wrote the same comment.
5. **The step-1 helper comments are `/* */`, not `{/* */}`.** A JSX comment in a ternary's else-branch parens is a second child and does not parse; this was caught by a real esbuild transform failure and fixed.
6. **One slice-08 test needed retargeting that the plan did not foresee.** `product-service-dialog.test.tsx > the produto wizard shell` used `Tudo aqui é padrão` as the positive control proving it had grabbed the wizard *body* node. The tip now lives in the header, so that control was re-pointed at `Final do código da venda`, which is genuinely step-1 body copy.
7. **Tip A's source assertion is a contiguous head, not the whole sentence.** The JSX soft-wraps that sentence, so a whole-sentence substring test over the source would fail on the newline. The whole sentence is pinned in the DOM instead, by `product-service-dialog.test.tsx`.

## What changed

**New: `apps/web/src/components/ui/info-hint.tsx`.**
No new dependency: there is still no `popover.tsx`, and neither `@radix-ui/react-popover` nor `-tooltip` is installed.
`InfoHint` is built by hand mirroring `Combobox`: inline non-portalled panel inside its own `relative` wrapper, `React.useId()` for the panel id, `cn` for class merging, doc comment stating the decision.
It is the ARIA **disclosure** pattern - a real `<button type="button">` with `aria-expanded`, `aria-controls` set only while open, an accessible name of `Mais informações sobre ${label}`, and no `role="tooltip"`.
Dismissal: second click, Escape (with the three-call guard so it never reaches the surrounding Radix `Dialog`), and a document `mousedown` outside the wrapper.
An `align` prop exists for right-half anchors; all three current call sites are left-anchored, so all use the `start` default.

**`apps/web/src/sales-ops/SalesOpsApp.tsx`.**
- `AlertTriangle` removed from the lucide import (no remaining use); `InfoHint` imported.
- Tip A: banner deleted; the now-single-child `flex flex-col gap-[11px]` wrapper collapsed so the segmented bar sits directly in the step card's `gap-[15px]` stack. `DialogTitle` and its className are untouched; it is wrapped in a `flex items-center gap-1.5` row with the trigger.
- Tip C: banner deleted; trigger appended to the `Profissionais alocados` card header.
- Tip D: banner deleted; trigger appended to the `Previsão de contas a pagar` heading, above the existing grey subtitle (which was left alone - it is in-flow subtitle copy, not a banner).
- J / K: `AlertTriangle` and the amber tone dropped, copy unchanged.
- The `planDirty` bar, `Sem área`, both `Alterado manualmente` markers and the `Definido na venda` placeholders were not edited.

**Tests.**
- NEW `apps/web/src/components/ui/__tests__/info-hint.test.tsx` - 7 behavioural tests in the `combobox.test.tsx` idiom.
- `sale-wizard-ui-contract.test.tsx` - one new `it`; no existing assertion weakened.
- `product-service-dialog.test.tsx` - the default-values test retargeted, two new tests, one slice-08 positive control re-pointed.
- `sale-wizard-service-description.test.tsx` - checked, not edited, still passing: the tone demotion changed no character of `descriptionHint`.

## Red then green

### Red

```
$ pnpm exec vitest run src/components/ui/__tests__/info-hint.test.tsx \
    src/sales-ops/__tests__/sale-wizard-ui-contract.test.tsx \
    src/sales-ops/__tests__/product-service-dialog.test.tsx

Error: Failed to resolve import "../info-hint" from "src/components/ui/__tests__/info-hint.test.tsx". Does the file exist?
AssertionError: expected 'Novo serviçoValor variável, custos po…' not to contain 'Tudo aqui é padrão: dentro da propost…'
 ❯ src/sales-ops/__tests__/product-service-dialog.test.tsx:534:24
AssertionError: expected 'import {\n  AlertTriangle,\n  Calenda…' to contain 'InfoHint'
 ❯ src/sales-ops/__tests__/sale-wizard-ui-contract.test.tsx:496:20

 Test Files  3 failed | 37 passed (40)
```

Three real reasons: the component does not exist, the produto tip is inline on first paint, and the source has no `InfoHint`.

### Green

```
$ pnpm exec vitest run src/components/ui/__tests__/info-hint.test.tsx \
    src/sales-ops/__tests__/sale-wizard-ui-contract.test.tsx \
    src/sales-ops/__tests__/product-service-dialog.test.tsx \
    src/sales-ops/__tests__/sale-wizard-service-description.test.tsx

 ✓ src/components/ui/__tests__/info-hint.test.tsx (7 tests) 25ms
 ✓ src/sales-ops/__tests__/sale-wizard-ui-contract.test.tsx (7 tests) 57ms
 ✓ src/sales-ops/__tests__/sale-wizard-service-description.test.tsx (10 tests) 132ms
 ✓ src/sales-ops/__tests__/product-service-dialog.test.tsx (53 tests)
```

## Definition of done

| Gate | Result |
| --- | --- |
| `pnpm test` (web) | **40 files / 419 tests passed** (baseline 39 / 409; +1 file, +10 tests, none lost) |
| `pnpm test` (api) | **29 files / 300 tests passed** - unchanged |
| `pnpm test` (shared-utils) | 2 files / 23 tests passed |
| `pnpm run lint` | clean |
| `pnpm run type-check` | clean |
| `pnpm run build` | clean (`✓ built in 1.58s`) |

No `npx prettier` was run.
No process was left running.

---

# Cycle 2 - Gate 2 findings

Gate 2 failed cycle 1 with one blocking finding and two minor ones.
The classification, placement and dependency decision were confirmed correct and were not redone.

## Finding 1 (blocking) - Escape closed the whole dialog, and the test could not catch it

Both halves confirmed and fixed.

**The test was a false positive.** `does not let Escape escape into a surrounding dialog` rendered `<div onKeyDown={spy}>` around the hint. That only exercises React's synthetic bubbling, which plain `stopPropagation()` already satisfies, so deleting `event.nativeEvent.stopImmediatePropagation()` left all seven tests green.

**The behaviour was genuinely wrong.** Radix's `useEscapeKeydown` registers `document.addEventListener('keydown', handler, { capture: true })`. A document capture listener runs before the event reaches React's root container, so no handler inside the React tree can pre-empt it - `stopImmediatePropagation` included. The comment in `info-hint.tsx` claiming those three calls made Escape close "only the hint" was factually wrong.

It blocked despite being pre-existing (untouched `Combobox` has the identical hole on `master`) because this slice creates a NEW path into it: a static banner has no dismissal gesture, an on-demand disclosure invites Escape as the "put this away" reflex, and `dialog.tsx` documents Escape as a live dialog-close affordance, so that reflex discarded the operator's typed work.

### What changed

**New `apps/web/src/components/ui/inline-layer.ts`** - the seam, at the `DialogContent` level, which is the only place upstream of a document capture listener.
`InlineLayerContext` + `useInlineLayerHost()` (host) + `useInlineLayer(open)` (layer).
The open count is a **ref**, not state: opening a picker inside a dialog must not re-render the dialog, and the value is only ever read inside an event handler where a ref is always current.
The release is idempotent, so a StrictMode double cleanup cannot strand the count below zero and silently disarm the guard for every later layer.
It is a `.ts` file with no component export, so `react-refresh/only-export-components` is satisfied without touching `allowExportNames`.

**`dialog.tsx`** - `DialogContent` owns one registry, provides it around `children`, and passes `onEscapeKeyDown={(e) => { if (inlineLayers.hasOpenLayer()) e.preventDefault(); }}` after `{...props}`, exactly like the two existing outside-interaction guards.
`onEscapeKeyDown` was added to the `DialogContentProps` `Omit` list, so this stays internal and no call site can opt back in - the public prop shape the file's header comment describes is preserved, and no new prop was exposed.

**`info-hint.tsx` and `combobox.tsx`** - both call `useInlineLayer(open)`. Both Escape comments were rewritten to state what those calls actually do (stop React-level bubbling only) and to point at `inline-layer.ts` for what actually guards the dialog. `stopImmediatePropagation` was dropped from `InfoHint` as provably inert; `Combobox`'s existing three calls were left as they were, with only the comment corrected.

`AlertDialogContent` was checked and deliberately left alone: it hosts confirmations only, with no inline layer inside.

### Red then green - the REAL Escape test

New `apps/web/src/components/ui/__tests__/inline-layer-escape.test.tsx` drives the **real** `@radix-ui/react-dialog`, with `InfoHint` and `Combobox` mounted inside a real `DialogContent`, asserting on `onOpenChange`.

Red, against cycle-1 code:

```
 × closes an open InfoHint and leaves the dialog open
   → expected "spy" to not be called at all, but actually been called 1 times
 × still closes the dialog on the next Escape, once the hint is away
   → expected "spy" to not be called at all, but actually been called 1 times
 ✓ closes the dialog on the first Escape when no hint was ever opened
 × closes an open Combobox panel and leaves the dialog open
   → expected "spy" to not be called at all, but actually been called 1 times
 × still closes the dialog on the next Escape, once the Combobox panel is away
   → expected "spy" to not be called at all, but actually been called 1 times

 Tests  4 failed | 1 passed (5)
```

The one passing test is the control: it proves Escape genuinely reaches Radix, so the four failures are a real hole and not an inert probe.

Green after the fix: `✓ inline-layer-escape.test.tsx (5 tests)`.

**Mutation-checked, because a green-under-mutation test is exactly what failed cycle 1:**

| Mutant | Result |
| --- | --- |
| `if (inlineLayers.hasOpenLayer())` → `if (false)` in `dialog.tsx` | **4 failed / 1 passed** - killed |
| `useInlineLayer(open)` deleted from `info-hint.tsx` | **2 failed / 3 passed** - killed, and precisely: only the two `InfoHint` tests, the `Combobox` pair still green |

Both mutants were reverted and the suite re-run green.

The cycle-1 wrapper test was kept but **renamed and rescoped** to `does not bubble its Escape to a React handler above it`, with a doc comment saying in so many words that it cannot see a Radix dialog and that `inline-layer-escape.test.tsx` is what does.

`dialog-outside-close.test.tsx`'s `does not intercept the Escape key` had to be retargeted, since `onEscapeKeyDown` now exists. It became two tests: the handler exists and does **not** `preventDefault` with no inline layer open (so the guard is not a blanket disable), and a call site's own `onEscapeKeyDown` is dropped rather than composed - the same property the file already pins for `onPointerDownOutside`.

## Finding 2 (minor) - step-4 hint panel clipped

The `Previsão de contas a pagar` card was `overflow-hidden rounded-[14px] border ...`, so the ~62px panel was cut at the card's bottom edge whenever the preview under it was short or empty.
`overflow-hidden` only ever existed to round the last table row's bottom corners, so it moved off the card and onto a new wrapper around the `<Table>` alone: `overflow-hidden rounded-b-[13px]`, `13px` being `14px` less the 1px border, i.e. the same inner curve the card was clipping to before.
The header, and therefore the hint, now has no clipping ancestor. The produto header hint and the step-3 hint were already clear and were not touched.

## Finding 3 (minor) - trigger contrast

`text-[#b0b0b8]` on white is 2.15:1, under WCAG 1.4.11's 3:1 floor for a meaningful non-text graphic.
Now `text-[#8b8b92]`, the app's existing muted helper tone, at **3.39:1** - still visually secondary, and the hover/open `#9c7210` and the focus ring are unchanged.
The reason is recorded inline so the value does not get lightened back.

## Cycle 2 definition of done

| Gate | Result |
| --- | --- |
| `pnpm test` (web) | **41 files / 425 tests passed** (cycle 1: 40 / 419; +1 file, +6 tests, none lost) |
| `pnpm test` (api) | **29 files / 300 tests passed** - unchanged |
| `pnpm test` (shared-utils) | 2 files / 23 tests passed |
| `pnpm run lint` | clean |
| `pnpm run type-check` | clean |
| `pnpm run build` | clean |

No `npx prettier` was run. No process was left running.
