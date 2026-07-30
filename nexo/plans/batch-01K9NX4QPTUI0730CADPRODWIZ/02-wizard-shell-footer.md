---
id: 02-wizard-shell-footer
milestone: v2.3.0
status: todo
depends_on: []
files_modified:
  - apps/web/src/sales-ops/SalesOpsApp.tsx
  - apps/web/src/sales-ops/__tests__/sale-wizard-ui-contract.test.ts
  - apps/web/src/sales-ops/__tests__/sale-wizard-shell-layout.test.tsx
acceptance: "given the proposta wizard is open at any step and the step body is taller than the dialog, when the operator scrolls, then only the body scrolls and the footer's Voltar / Salvar rascunho / Avançar buttons stay fully visible and fully clickable at every viewport height."
---

# 02 - proposta wizard shell: the footer must never be clipped

## Confirmed diagnosis

The defect is in `SaleWizardDialogBody` in `apps/web/src/sales-ops/SalesOpsApp.tsx`.
The shell is a CSS **grid** (inherited from the base `DialogContent`) with a hard height cap and `overflow-hidden`, and the scroll body's height is a hand-computed magic number that under-estimates the chrome.

Shell line map as it stands today:

| Element | Lines | Role |
| --- | --- | --- |
| `DialogContent` | 5840 | shell, `max-h-[92vh] ... overflow-hidden` |
| `DialogHeader` | 5841-5848 | title + description |
| stepper `div` | 5850-5891 | the 4 numbered steps |
| scroll body `div` | 5893-7137 | `max-h-[calc(92vh-210px)] overflow-y-auto` |
| footer `div` | 7139-7171 | Voltar / Passo N de 4 / Salvar rascunho / Avançar |
| `</DialogContent>` | 7172 | |

Two facts combine into the bug.

1. `apps/web/src/components/ui/dialog.tsx:52` gives every `DialogContent` `grid` as its display.
   The wizard's own className never overrides it (unlike `ProductDialogBody`, which prepends `flex`), so the four blocks are four auto-sized grid rows.
   Auto grid rows do not shrink to honour the parent's `max-height`; they overflow past the bottom edge, and `overflow-hidden` on line 5840 then slices whatever crosses it - which is the last row, the footer.
2. `210px` on line 5893 is therefore load-bearing: the layout is only correct while `header + stepper + footer <= 210px`. It is not.

Measured against the real classNames:

- header (5841): `py-5` 40 + title `text-[19px] leading-none` 19 + `space-y-1.5` 6 + description `text-[13px]` at inherited `leading-normal` ~19.5 + `border-b` 1 = **~85.5px**
- stepper (5850): `py-4` 32 + step circle `h-[26px]` 26 + `border-b` 1 = **59px**
- footer (7139): `py-4` 32 + button (`py-[11px]` 22 + `text-sm` line-box 20 + 2 x 1px border) 44 + `border-t` 1 = **77px**

Total **~221.5px** against a 210px budget, so the footer overflows the shell by roughly **11-12px** and `overflow-hidden` cuts it - exactly the horizontal slice through the button row in the screenshot, with the body still visibly scrolled behind it.
The stepper also carries `overflow-x-auto`, so on a platform with classic (non-overlay) scrollbars it grows another ~15px and the clip gets worse.

The fix is not to re-tune `210`. Any constant is wrong the moment the description wraps, the font metrics differ, or a scrollbar appears. Delete the constant and make the footer a flex sibling that cannot be clipped.

## The pattern to copy

`ProductDialogBody` in this same file already solved this:

- `apps/web/src/sales-ops/SalesOpsApp.tsx:3476` - `flex h-[92vh] max-h-[92vh] ... flex-col gap-0 overflow-hidden`
- `apps/web/src/sales-ops/SalesOpsApp.tsx:3509` - body `flex min-h-0 flex-1 flex-col ... overflow-y-auto`
- `apps/web/src/sales-ops/SalesOpsApp.tsx:4030` - footer `flex flex-none ...`

`cn` is `twMerge(clsx(...))` (`apps/web/src/lib/utils.ts`), and `flex` / `grid` live in the same `display` group, so a leading `flex` in the call-site className deterministically beats the base `grid`.
That is already proven by the produto dialog rendering correctly today.

A fixed `h-[92vh]` (rather than `max-h` alone) is deliberate here and buys a second thing beyond robustness: the four wizard steps have wildly different content heights, so an auto-height shell makes the dialog jump size on every `Avançar`. Pinning the height holds the footer and the stepper still across all four steps.

## Exact edits

### 1. Shell - `apps/web/src/sales-ops/SalesOpsApp.tsx:5840`

Before:

```
className="max-h-[92vh] w-[calc(100vw-48px)] max-w-[940px] gap-0 overflow-hidden rounded-[22px] border-none bg-[#f4f4f6] p-0 shadow-[0_30px_80px_rgba(0,0,0,.3)] sm:rounded-[22px] [&>button]:right-[26px] [&>button]:top-[31px] [&>button]:flex [&>button]:h-9 [&>button]:w-9 [&>button]:items-center [&>button]:justify-center [&>button]:rounded-[10px] [&>button]:border [&>button]:border-[#dcdce2] [&>button]:bg-white [&>button]:opacity-100 [&>button]:shadow-none"
```

After (only `flex h-[92vh]` prepended and `flex-col` inserted; every other token is byte-identical and in the same order):

```
className="flex h-[92vh] max-h-[92vh] w-[calc(100vw-48px)] max-w-[940px] flex-col gap-0 overflow-hidden rounded-[22px] border-none bg-[#f4f4f6] p-0 shadow-[0_30px_80px_rgba(0,0,0,.3)] sm:rounded-[22px] [&>button]:right-[26px] [&>button]:top-[31px] [&>button]:flex [&>button]:h-9 [&>button]:w-9 [&>button]:items-center [&>button]:justify-center [&>button]:rounded-[10px] [&>button]:border [&>button]:border-[#dcdce2] [&>button]:bg-white [&>button]:opacity-100 [&>button]:shadow-none"
```

### 2. Header - `apps/web/src/sales-ops/SalesOpsApp.tsx:5841`

Before: `className="border-b border-[#e8e8ec] bg-white px-[26px] py-5 pr-[78px] text-left"`

After: `className="shrink-0 border-b border-[#e8e8ec] bg-white px-[26px] py-5 pr-[78px] text-left"`

### 3. Stepper - `apps/web/src/sales-ops/SalesOpsApp.tsx:5850`

Before: `className="flex items-center gap-1 overflow-x-auto border-b border-[#e8e8ec] bg-white px-[26px] py-4"`

After: `className="flex shrink-0 items-center gap-1 overflow-x-auto border-b border-[#e8e8ec] bg-white px-[26px] py-4"`

### 4. Scroll body - `apps/web/src/sales-ops/SalesOpsApp.tsx:5893`

Before: `className="max-h-[calc(92vh-210px)] overflow-y-auto px-[26px] py-6"`

After: `className="min-h-0 flex-1 overflow-y-auto px-[26px] py-6"`

The magic number is gone. Keep this element a **block** container - do not add `flex flex-col`.
Its step children already own their own `flex flex-col gap-[18px]` wrappers, and `flex-1` works on a block flex item, so adding a nested flex context here would only add risk for no gain.
`min-h-0` is mandatory: a column flex item's `min-height` defaults to `auto`, which would refuse to shrink below the content height and put the overflow back.

### 5. Footer - `apps/web/src/sales-ops/SalesOpsApp.tsx:7139`

Before: `className="flex items-center justify-between border-t border-[#e8e8ec] bg-white px-[26px] py-4"`

After: `className="flex shrink-0 items-center justify-between border-t border-[#e8e8ec] bg-white px-[26px] py-4"`

No JSX structure changes anywhere - only these five className strings. Do not move, wrap, or reorder any element.

## What must survive the restructure (verify each by eye after editing)

- `max-w-[940px]` and `w-[calc(100vw-48px)]` - the wizard's width identity, and the only remaining `calc(` on this shell.
- `rounded-[22px]` **and** `sm:rounded-[22px]` - the base sets `sm:rounded-lg`, so dropping the `sm:` twin squares the corners above 640px.
- `bg-[#f4f4f6]` on the shell - the grey body tone the header/stepper/footer's own `bg-white` reads against. If this is lost the scroll body goes white and the section cards lose their separation.
- `overflow-hidden` - still required so the corner radius clips the header and footer. It is safe now precisely because nothing can overflow anymore.
- `gap-0` - the base `DialogContent` ships `gap-4`. Under `flex flex-col` that would inject a 16px gap between all four blocks and break every border seam. This token is *more* load-bearing after the change than before it.
- `p-0` - base ships `p-6`.
- The whole `[&>button]:*` run - twelve arbitrary variants that restyle the Radix close affordance (`apps/web/src/components/ui/dialog.tsx:60`), which is a **direct child** of `DialogContent`. The restructure keeps the child list as header / stepper / body / footer / Close, so the selector keeps matching. Two consequences to respect: the close button is `absolute` (from the base class), so it is out of flow and never becomes a flex item; and **no new direct-child `<button>` may be introduced under `DialogContent`**, or it would silently inherit the close-button skin. Every footer button is nested inside the footer `div`, which is why the footer must not be flattened.

## Other dialogs checked - deliberately out of scope

`grep -rn "vh\]" apps/web/src` returns exactly four shells, and only the wizard has the bug.

- **`SaleDetailDialog`, line 1870** (`max-h-[92vh] ... gap-0 overflow-y-auto ... p-0`): **not affected, leave alone.** It has no footer at all - the JSX is header (1871-1881) then one content block (1883-2062) and then `</DialogContent>` (2063). The container itself is `overflow-y-auto`, not `overflow-hidden`, so every pixel of content is reachable by scrolling and nothing can be clipped. It carries no `calc(...vh-...)` body height. Its only quirk is that the header scrolls away with the content, which is a different, cosmetic concern and not this defect. Converting it would be scope creep with no reported symptom behind it.
- **`ProductDialogBody`, line 3476**: already the reference implementation. Untouched. (Slice 08 rebuilds this dialog; slice 02 must not pre-empt it.)
- **`ClientDialog`, line 4190** (`max-h-[85vh] ... overflow-y-auto`): not affected. Its action row (`border-t pt-4`) sits *inside* the scrolling form, so it is scrolled to, never pinned, never clipped.
- **`AreaDialog` (4309), `FuncaoDialog` (4394), `PessoaDialog` (4547)**: no `max-h` and no fixed footer - same in-flow action row as `ClientDialog`. They are short dialogs. (`PessoaDialog` with a very long função list on a short viewport could in principle exceed the viewport with no cap, which is a *different* latent bug with no reported symptom and no fixed footer involved; recorded here, not fixed here.)

## Oracle tests

Both must fail before the edit and pass after. Run with `pnpm --filter @fxl-sales/web test` (or `pnpm test` from the root).

### 1. `apps/web/src/sales-ops/__tests__/sale-wizard-shell-layout.test.tsx` (NEW - the primary oracle)

A DOM test, because the honest claim is "these classes are on *these* elements", not "these characters exist somewhere in a 7k-line file".

Harness: copy the setup from `sale-wizard-payment-plan.test.tsx` verbatim - `// @vitest-environment happy-dom` first line, the `vi.mock('@/components/ui/dialog', ...)` block (its `DialogContent` and `DialogHeader` mocks both pass `className` straight through to a `div`, which is what makes the assertion possible), the `IS_REACT_ACT_ENVIRONMENT` / `createRoot` / `act` scaffold, and its `bootstrap` fixture. Render `<SaleWizardDialog bootstrap={bootstrap} editSale={null} onClose={vi.fn()} onSave={vi.fn()} open saving={false} />`.

Test name: `it('pins the wizard shell to a flex column so the footer can never be clipped')`

```ts
const shell = container.querySelector('div[class*="max-w-[940px]"]');
const [header, stepper, body, footer] = Array.from(shell!.children) as HTMLElement[];

// positive controls: prove we grabbed the right four nodes before asserting on them
expect(header.textContent).toContain('Nova proposta');
expect(stepper.textContent).toContain('Pagamento');
expect(body.textContent).toContain('Cliente e responsáveis');
expect(footer.textContent).toContain('Salvar rascunho');
expect(footer.textContent).toContain('Avançar');

// the shell is a flex column with a real height
for (const token of ['flex', 'flex-col', 'h-[92vh]', 'overflow-hidden', 'gap-0']) {
  expect(shell!.className.split(' ')).toContain(token);
}
// preserved identity
for (const token of ['max-w-[940px]', 'rounded-[22px]', 'sm:rounded-[22px]', 'bg-[#f4f4f6]', 'p-0']) {
  expect(shell!.className.split(' ')).toContain(token);
}
expect(shell!.className).toContain('[&>button]:right-[26px]');

// only the body scrolls, and it absorbs all the free space
for (const token of ['min-h-0', 'flex-1', 'overflow-y-auto']) {
  expect(body.className.split(' ')).toContain(token);
}
expect(body.className).not.toContain('max-h-');

// chrome never shrinks
expect(header.className.split(' ')).toContain('shrink-0');
expect(stepper.className.split(' ')).toContain('shrink-0');
expect(footer.className.split(' ')).toContain('shrink-0');
expect(footer.className).not.toContain('absolute');
```

Pre-edit failure mode: `body.className` contains `max-h-[calc(92vh-210px)]` and no `flex-1`, and the shell has no `flex`. Exact-token matching via `.split(' ')` is used on purpose so `flex-col` cannot satisfy an assertion about `flex`.

### 2. `apps/web/src/sales-ops/__tests__/sale-wizard-ui-contract.test.ts` (EXTEND - the regression guard)

Append one `it` in the file's existing source-string idiom, so the magic number cannot creep back in under a different element:

```ts
it('keeps the wizard shell free of a hand-computed body height', () => {
  // Positive control: the flex-column shell really is there, so the negative below
  // is about a constant that was removed rather than one that never existed.
  expect(source).toContain('flex h-[92vh] max-h-[92vh] w-[calc(100vw-48px)] max-w-[940px] flex-col');
  expect(source).toContain('min-h-0 flex-1 overflow-y-auto px-[26px] py-6');
  // A `calc()` against the viewport HEIGHT is always a guess about chrome height.
  expect(source).not.toContain('calc(92vh-');
  expect(source).not.toContain('vh-210px');
});
```

`calc(92vh-` currently occurs exactly once in the file (line 5893) and nowhere else in `apps/web/src`, and `w-[calc(100vw-48px)]` is a *width* calc that this guard deliberately does not match. Both assertions fail today.

Do not weaken the existing assertions in that file; slice 02 changes no copy, so every current string must still pass untouched.

## Risk notes

- **twMerge ordering.** `flex` must beat the base `grid`. It does, because both are in tailwind-merge's `display` group and the call-site className is merged last - and `ProductDialogBody` has depended on this in production since it shipped. If the shell ever renders as a grid again, the symptom is instant and visual (16px-free but mis-stacked blocks), not subtle.
- **Fixed `h-[92vh]` makes short states tall.** The one short state is the `Cadastro incompleto` `EmptyPanel` at line 5895, which will now sit in a full-height dialog. That is the accepted trade for a footer that never moves between steps, and it matches the produto dialog's existing behaviour. Do not "fix" it by dropping to `max-h` only; that reintroduces intrinsic-sizing ambiguity for a `flex-basis: 0` child.
- **Extremely short viewports.** If `header + stepper + footer` alone exceed 92vh (roughly a viewport under ~240px tall), the body collapses to 0 and the chrome clips again. No layout can do better without hiding chrome, and it is far outside any real browser window.
- **Slice 08 overlap.** Slice 08 rewrites the produto/serviço dialog into a stepped wizard and will likely reuse this exact shell recipe. Slice 02 must touch only `SaleWizardDialogBody`; leave lines 3476 / 3509 / 4030 alone so slice 08 rebases cleanly.
- **Verification.** `pnpm run lint`, `pnpm run type-check` and `pnpm test` all apply. This is a className-only change, so type-check is a formality, but the two oracle tests must be seen failing on the unmodified file first.
