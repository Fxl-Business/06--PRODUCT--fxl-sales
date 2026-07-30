---
id: 10-info-hints
milestone: v2.3.0
status: todo
depends_on: ["03-wizard-itens-row", "04-wizard-plano-layout", "08-produto-wizard"]
files_modified:
  - apps/web/src/components/ui/info-hint.tsx
  - apps/web/src/components/ui/__tests__/info-hint.test.tsx
  - apps/web/src/sales-ops/SalesOpsApp.tsx
  - apps/web/src/sales-ops/__tests__/sale-wizard-ui-contract.test.ts
  - apps/web/src/sales-ops/__tests__/product-service-dialog.test.tsx
acceptance: "given the produto/serviço dialog or the proposta wizard is opened fresh, when the operator looks at any step, then no first-run explanatory yellow banner occupies layout space - each one is reachable through an ⓘ button beside the heading it belongs to, opened by click or Enter/Space, closed by a second click, by Escape or by an outside click - while the state indicators (`Definido na venda`, `Sem área`, `Alterado manualmente`) and the `planDirty` `Aplicar` / `Manter parcelas` bar still render inline exactly as they do today."
---

# 10 - persistent yellow banners become on-demand info hints

## Frame

The operator's words, verbatim:

> "This is about both dialogs: I don't like this much yellow warnings across the whole dialog, because those are important just when it's the first time of someone using, then it's just taking screen space, because the user already will know this"

and, for the produto dialog specifically:

> "put the yellow texts inside an info popover or something like this"

The complaint is about **first-run explanatory copy that never goes away**.
It is not about every amber pixel.
Three of the amber blocks in these dialogs are load-bearing UI - one is a field's current value, one is a data warning, one is an action-required bar that `CLAUDE.md` pins by name - and hiding any of them behind a popover would be a regression dressed up as a fix.

So this slice needs a classification rule before it needs a component.

## The classification rule

> An amber block is an **explanatory tip** - and therefore moves behind an `InfoHint` - if and only if
>
> **(a)** it renders unconditionally for the screen or mode it belongs to, i.e. its presence carries no information because it is always there once you are on that step, **and**
> **(b)** its text contains no value, count, name or field state that the operator has to read in order to decide what to do next.
>
> A block that fails **(a)** is a **state indicator**: its very appearance is the message.
> A block that fails **(b)** and additionally offers buttons is a **live warning**: it is an interrupt, not a lesson.
> A block that fails **(b)** without buttons, and that sits in a per-row helper slot, is **field helper text**: it stays inline, but it loses the warning skin, because a per-row popover would be strictly more noise than the sentence it hides.

Only the first category moves.
The fourth category is why this slice is not a pure find-and-replace: two of the four blocks the operator pointed at are helper text, not banners, and the honest fix for those is tone, not concealment.

## Inventory

Line numbers are from `apps/web/src/sales-ops/SalesOpsApp.tsx` at **7175 lines**, the state of the file at the time this plan was written (commit `ee249b2`, before slices 02-09 land).
**They will have moved.** See "Re-verify before editing" below - the strings, not the numbers, are the addresses.

The sweep that produced this table:

```
grep -rn "fbf6ea\|dcc98f\|9c7210\|amber\|fef3c7\|fde68a\|f59e0b\|92400e\|b45309\|d97706\|fffbeb\|yellow" apps/web/src/
grep -n "bg-\[#fdf0cf\]\|bg-\[#fbf3e0\]\|bg-\[#fbf6ea\]\|border-\[#f0dfae\]\|border-\[#f0e2bd\]\|border-\[#dcc98f\]\|border-\[#d8cdb0\]" apps/web/src/sales-ops/SalesOpsApp.tsx
```

`#9c7210` is the app's **gold accent**, not a warning colour: it paints the `Total` figure, the `editar` links, icon-button hovers, the KPI gradient and the `Combobox` create row.
Matching it alone yields 30 hits, of which the overwhelming majority are ordinary accented text.
The table below therefore lists only the hits that render as a **filled or dashed amber container** (or as amber inline copy in a helper slot), which is what the operator can actually see as "yellow".

| # | Line | Where | Text / role | Container class | Verdict | Action |
| --- | --- | --- | --- | --- | --- | --- |
| A | 3527 | ProductDialog, top, under the `Produto \| Serviço` segmented bar | "Tudo aqui é padrão: dentro da proposta você pode alterar qualquer valor sem mexer no cadastro." | `border-[#f0dfae] bg-[#fdf0cf]` | **Tip** | → `InfoHint` beside the dialog title |
| B | 3569 | ProductDialog, only when `isService` | "Serviços têm valor variável, definido em cada proposta." | `border-[#f0e2bd] bg-[#fbf3e0]` | **Tip** | → `InfoHint` beside the segmented bar |
| C | 6609 | Wizard step 3, top | "Aloque os profissionais do projeto e ajuste os percentuais - a margem líquida e as comissões são calculadas em tempo real." | `border-[#f0dfae] bg-[#fdf0cf]` | **Tip** | → `InfoHint` beside `Profissionais alocados` |
| D | 6943 | Wizard step 4, top | "Esta é uma previsão - nada é lançado no financeiro até a proposta ser marcada como Ganha." | `border-[#f0dfae] bg-[#fdf0cf]` | **Tip** | → `InfoHint` beside `Previsão de contas a pagar` |
| E | 3185 | `DefinedOnSaleNotice`, rendered into `Setup (R$)` / `Valor da mensalidade (R$)` for a serviço | "Definido na venda" | dashed `border-[#dcc98f] bg-[#fbf6ea]` | **State indicator** | **leave alone** |
| F | 6190 | Wizard step 1, per item, when the chosen produto has no `areaId` | "Sem área" | pill `bg-[#fdf0cf]` | **State indicator** | **leave alone** |
| G | 5243 | `overrideMarker`, step 3 commission fields | "Alterado manualmente" + `Restaurar padrão` | pill `bg-[#fdf0cf]` | **State indicator** | **leave alone** |
| H | 6772 | Step 3, per profissional, when `costManual` | "Alterado manualmente" + restore link | pill `bg-[#fdf0cf]` | **State indicator** | **leave alone** |
| I | 6498 | Wizard step 2, when `planPendingRegeneration` | "Você ajustou as parcelas manualmente. Aplicar … vai substituir as parcelas editadas." + `Aplicar` / `Manter parcelas` | `border-[#f0dfae] bg-[#fdf0cf]` | **Live warning** | **leave alone - out of scope** |
| J | 6131-6134 | Wizard step 1, per free item, in the `showItemErrors` else-branch | `AlertTriangle` + "Item avulso - informe a área, a descrição e o valor" | inline `text-[#9c7210]` | **Field helper** | demote tone, keep inline |
| K | 6268-6271 | Wizard step 1, per variable-value item, same slot | `AlertTriangle` + `descriptionHint`, e.g. `Serviço com valor variável - sem descrição, o item aparece como "FXL Custom"` | inline `text-[#9c7210]` | **Field helper** | demote tone, keep inline |

### Why each non-tip stays

- **E, `DefinedOnSaleNotice`.** It is not advice, it is the field's *value slot*.
  It replaces the `<Input>` in the `Setup (R$)` and `Valor da mensalidade (R$)` fields when the kind is serviço, so hiding it would leave two labelled fields with nothing under them.
  It fails **(b)**: it states the current value of that field.
  `product-service-dialog.test.tsx:351` counts exactly two occurrences and `:356` asserts zero for a produto; both assertions must keep passing byte-for-byte.
  Slice 07 (`servico-base-value`) may already have changed *when* this renders - it does not change that it is a value, not a tip.
- **F, `Sem área`.** A data warning about the selected produto, and the operator's cue that the item will fail validation.
  Fails **(a)**: it renders only when `product.areaId` is falsy, and it alternates with the área-name pill in the same slot.
- **G / H, `Alterado manualmente`.** `CLAUDE.md` ("Propostas domain") pins this: it "renders only when a field is pinned AND diverges from the current default".
  Fails **(a)** by construction, and it carries the `Restaurar padrão` action.
  `sale-wizard-ui-contract.test.ts:45-46` pins both strings.
- **I, the `planDirty` confirm bar.** An interrupt with two buttons and a live count in its copy (`entrada + {restanteCount} x`).
  `CLAUDE.md` ("Propostas domain") pins the whole `Aplicar` / `Manter parcelas` behaviour, and `sale-wizard-ui-contract.test.ts:35` plus `sale-wizard-payment-plan.test.tsx:414-428` pin the copy and the two buttons.
  **Do not touch this element at all, not even its className.**
  Note this bar shares the exact class string `border-[#f0dfae] bg-[#fdf0cf]` with tips A, C and D, so a careless search-and-replace across that class would take it out.
  Address it by its text, never by its class.
- **J / K, the per-item helper lines.** These sit in the *else* branch of `showItemErrors ? <errors/> : <hint/>`, i.e. they are the non-error state of a validation slot, one per item row.
  K fails **(b)** outright - it names the fallback label the item will carry (`o item aparece como "FXL Custom"`), which changes per row and is exactly the fact the operator needs before deciding whether to type a description.
  J names the three fields to fill.
  Putting a popover trigger on every item row would multiply the affordance by the row count and be *worse* than the sentence.
  The complaint is "yellow warnings", so the fix is to stop them being yellow warnings: drop the `AlertTriangle` and move to the muted helper tone this file already uses for field hints (`text-[11.5px] text-[#8b8b92]`, the same tone as `Deixe em branco para prazo indeterminado`).
  The **text is unchanged**, which is deliberate: `sale-wizard-service-description.test.tsx:376/383/395/423` asserts on these exact strings and must keep passing with no edit.

### Deliberately not in the inventory

- `bg-[#fdf0cf]` **status badges** (356, 1857, 1862, 2191, 2370, 2601, 5510, 5518) - `Aberta`/`Aberto`/`Vendedor`/`Sistema` chips in tables and detail views. Not in either dialog, not explanatory.
- The dashed `Essa proposta teve um finder` button (5991) and the `Cadastrar produto` button (6019) - affordances with gold accents, not notices.
- `bg-[#f3f6fa]` `Final do código da venda` (3543) - a blue field card, not amber; slice 09 owns it.
- `border-[#cfe4cf] bg-[#e2efe2]` plan summary (`planSummary()`, ~3843) - green, a live derived summary, not a tip.
- `border-[#f0dcd5] bg-[#fbeee9]` blocks (6597, 6819) - red validation errors.
- `apps/web/src/admin/apps/KeyRevealModal.tsx:136` (`amber-400`/`amber-50`) - legacy admin tree, a genuine one-shot security warning, not in scope.

## The shared affordance

### Dependency decision: **no new dependency.**

Confirmed facts:

- `apps/web/src/components/ui/` contains `alert-dialog, badge, button, card, combobox, combobox-filter, dialog, dropdown-menu, empty-state, input, kpi-card, label, select, skeleton, table, tabs`. **There is no `popover.tsx`.**
- `apps/web/package.json` has `@radix-ui/react-alert-dialog`, `-avatar`, `-dialog`, `-dropdown-menu`, `-label`, `-select`, `-slot`, `-tabs`. **Neither `@radix-ui/react-popover` nor `@radix-ui/react-tooltip` is installed.**
- `lucide-react@0.475.0` exports `Info` (verified in its `.d.ts`); it is not yet in the `SalesOpsApp.tsx` import block and must be added.

The house already made this call once and wrote the reason down, in the doc comment on `Combobox` (`apps/web/src/components/ui/combobox.tsx:52-58`):

> "The panel is inline, non-portalled and absolutely positioned inside the component's own `relative` wrapper. That is deliberate: it keeps the whole control reachable from a plain DOM query, both for assistive tech and for the test harness, and **it avoids pulling in a popover dependency**."

`InfoHint` is a strictly smaller problem than `Combobox` - one static paragraph, no listbox, no roving focus, no filtering.
Adding a Radix package to render it would be a heavier dependency than the thing it renders.
**Build it by hand, mirroring `Combobox`'s open/dismiss machinery line for line.**

### New file: `apps/web/src/components/ui/info-hint.tsx`

House conventions to follow, taken from `combobox.tsx`: `import * as React from 'react'`, `import { cn } from '@/lib/utils'`, an exported prop type, a doc comment stating the design decision, `React.useId()` for ids, named export at the bottom of the declaration.

```tsx
import * as React from 'react';
import { Info } from 'lucide-react';
import { cn } from '@/lib/utils';

export type InfoHintProps = {
  /** The hint body. Plain text in every current call site. */
  children: React.ReactNode;
  /**
   * What the hint is about, e.g. 'Profissionais alocados'. Used to build the
   * trigger's accessible name: `Mais informações sobre ${label}`. Required,
   * because four unlabelled `ⓘ` buttons on one screen are four identical
   * announcements.
   */
  label: string;
  /**
   * Panel edge alignment. 'start' pins the panel's left edge to the trigger,
   * 'end' its right edge. Use 'end' whenever the trigger sits in the right
   * half of its container, or the panel will overflow the dialog.
   */
  align?: 'start' | 'end';
  /** Merged onto the trigger through `cn`. */
  className?: string;
};

/**
 * On-demand explanatory hint: a small `ⓘ` button that discloses one paragraph.
 *
 * Deliberately a click/keyboard DISCLOSURE and not a hover tooltip. Hover alone
 * is unreachable by touch and by keyboard, and a hover-opened panel inside a
 * scrolling dialog body flickers as the pointer crosses it. A real `<button>`
 * gets Enter/Space, focus-visible and touch for free.
 *
 * The panel is inline, non-portalled and absolutely positioned inside the
 * component's own `relative` wrapper, exactly like `Combobox` and for the same
 * two reasons: it stays reachable from a plain DOM query, and it needs no
 * popover dependency.
 */
export function InfoHint({ children, label, align = 'start', className }: InfoHintProps) {
  const [open, setOpen] = React.useState(false);
  const wrapperRef = React.useRef<HTMLSpanElement>(null);
  const triggerRef = React.useRef<HTMLButtonElement>(null);
  const panelId = `${React.useId()}-hint`;

  // Outside dismissal. `mousedown` rather than `pointerdown` so this never
  // races Radix's own pointerdown dismissal machinery in a surrounding Dialog.
  React.useEffect(() => {
    if (!open) return;
    const handleDocumentMouseDown = (event: MouseEvent) => {
      const target = event.target;
      if (target instanceof Node && wrapperRef.current?.contains(target)) return;
      setOpen(false);
    };
    document.addEventListener('mousedown', handleDocumentMouseDown);
    return () => document.removeEventListener('mousedown', handleDocumentMouseDown);
  }, [open]);

  return (
    <span className="relative inline-flex" ref={wrapperRef}>
      <button
        aria-controls={open ? panelId : undefined}
        aria-expanded={open}
        aria-label={`Mais informações sobre ${label}`}
        className={cn(
          'inline-flex h-[18px] w-[18px] flex-none items-center justify-center rounded-full text-[#b0b0b8] transition hover:text-[#9c7210] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#eaa81a] focus-visible:ring-offset-1',
          open && 'text-[#9c7210]',
          className,
        )}
        onClick={() => setOpen((current) => !current)}
        onKeyDown={(event) => {
          if (event.key !== 'Escape' || !open) return;
          // Stop only our own Escape, so it never closes the surrounding Dialog.
          event.preventDefault();
          event.stopPropagation();
          setOpen(false);
          triggerRef.current?.focus();
        }}
        ref={triggerRef}
        type="button"
      >
        <Info aria-hidden="true" className="h-[15px] w-[15px]" />
      </button>
      {open ? (
        <span
          className={cn(
            'absolute top-full z-50 mt-1.5 block w-[min(280px,calc(100vw-64px))] rounded-[10px] border border-[#f0dfae] bg-[#fdf0cf] px-3 py-2 text-[12.5px] font-medium leading-snug text-[#57575f] shadow-[0_10px_30px_rgba(0,0,0,.12)]',
            align === 'end' ? 'right-0' : 'left-0',
          )}
          id={panelId}
        >
          {children}
        </span>
      ) : null}
    </span>
  );
}
```

Notes the executor must not "improve" away:

- `<span>` wrapper, not `<div>`: every call site drops this inside a heading row, and two of them are inside a `<label>`-adjacent flex line where a block child would break the baseline.
- The panel keeps the amber skin. It is still a tip; the change is *when* it occupies space, not *what* it looks like when open.
- No `role="tooltip"` and no `role="note"`. This is the ARIA **disclosure** pattern: `aria-expanded` + `aria-controls` on a real button, content in DOM order right after it.
- `aria-controls` is set only while open, matching how `Combobox` does it (`combobox.tsx:296`), because pointing at an absent id is invalid.
- Escape `stopPropagation()` is mandatory. Without it the Radix `Dialog` above would close the whole wizard. `Combobox` carries the same guard with the same comment (`combobox.tsx:220-221`).
- `focus-visible:ring-[#eaa81a]` is the app's focus gold, matching `formInputClass`.

## Placement rules

Every tip's trigger goes **immediately after the text of the heading that owns it**, inside that heading's existing flex row.
Never in a row of its own - a row of its own is the thing being deleted.

| Tip | Delete | Add |
| --- | --- | --- |
| A | The whole `<div className="rounded-[11px] border border-[#f0dfae] bg-[#fdf0cf] …">` wrapping "Tudo aqui é padrão…" (3527-3530). The `flex flex-col gap-[11px]` wrapper it shared with the segmented bar (3510) then has one child; collapse it and let the segmented bar sit directly in the body stack. | Wrap `<DialogTitle>`'s content row so the title and the trigger sit on one line: `<div className="flex items-center gap-1.5">{<DialogTitle …/>}<InfoHint label="valores padrão">Tudo aqui é padrão: dentro da proposta você pode alterar qualquer valor sem mexer no cadastro.</InfoHint></div>`. The tip is about the whole dialog, so it belongs to the dialog's title, not to any one section. Keep `DialogTitle` itself and its className untouched - Radix needs it for the dialog's accessible name. |
| B | The whole `{isService ? <div …>Serviços têm valor variável…</div> : null}` block (3568-3572). | Inside the `Produto \| Serviço` segmented-bar row, after the two `SegmentedButton`s and outside the `rounded-[11px] bg-[#f2f2f4] p-1` track: `{isService ? <InfoHint label="serviços">Serviços têm valor variável, definido em cada proposta.</InfoHint> : null}`. Keep the `isService` condition exactly as it is - the trigger is a property of the mode. Put the segmented track and the trigger in a shared `flex items-center gap-2` row. |
| C | The whole banner `<div>` (6609-6611). Step 3's outer `flex flex-col gap-[18px]` then starts with the `Profissionais alocados` card, which is correct. | Into the card's existing header row (`<div className="mb-3 flex items-center justify-between">`, 6614): wrap the `Profissionais alocados` title in `<div className="flex items-center gap-1.5">` and append `<InfoHint label="Profissionais alocados">Aloque os profissionais do projeto e ajuste os percentuais - a margem líquida e as comissões são calculadas em tempo real.</InfoHint>`. `align="start"` (default): the heading is on the left. |
| D | The whole banner `<div>` (6943-6945). | Into the `Previsão de contas a pagar` header block (7078-7082), which already stacks a title over a grey subtitle: wrap the title line in `<div className="flex items-center gap-1.5">` and append `<InfoHint label="Previsão de contas a pagar">Esta é uma previsão - nada é lançado no financeiro até a proposta ser marcada como Ganha.</InfoHint>`. This is the right anchor because the sentence is *about* the payables preview, and that block already owns the neighbouring sentence "Estes lançamentos serão gerados quando a proposta for marcada como Ganha." (leave that one alone - it is grey, in-flow subtitle copy, not a yellow banner). |
| J | The `<AlertTriangle className="h-[13px] w-[13px]" />` and the amber class. | `<span className="pl-0.5 text-[11.5px] text-[#8b8b92]">Item avulso - informe a área, a descrição e o valor</span>` - text byte-identical, `flex items-center gap-1.5` no longer needed once the icon is gone. |
| K | Same. | `<span className="pl-0.5 text-[11.5px] text-[#8b8b92]">{descriptionHint}</span>` - `descriptionHint` and all three of its branches unchanged. |

After J and K, check whether `AlertTriangle` still has any other use in the file (`grep -n "AlertTriangle" apps/web/src/sales-ops/SalesOpsApp.tsx`).
If not, remove it from the `lucide-react` import block, or `@typescript-eslint/no-unused-vars` fails the build.
Add `Info` to that same import block, alphabetically between `Folder` and `LayoutGrid`.

## Re-verify before editing - mandatory

**The line numbers above are stale by construction.**
Slices 02, 03, 04 and 08 all land in this same file before this one:

- **02** restructures the wizard shell (header / stepper / body / footer classNames) - shifts nothing but proves the file moves.
- **03** reshapes the step-1 item rows, which is exactly where **J** and **K** live. It may already have moved, merged or deleted those helper lines.
- **04** relays out the step-2 `Plano de pagamento` header, adjacent to the `planDirty` bar (**I**).
- **08** rebuilds `ProductDialog` into a stepped wizard, which is where **A**, **B** and **E** live. Tip A may end up belonging to the produto wizard's *header* rather than to a body block; the placement rule above already anchors it to `DialogTitle`, which survives either shape.
- **07** (wave 3) may change or delete the copy behind **B** if a Serviço gains a base value.

Before the first edit, re-run both greps from the "Inventory" section and reconcile.
The **strings are the addresses**, not the numbers.

Reconciliation rules, so no judgement call is left open:

- A tip string that still exists → apply its row of the placement table at wherever it now lives.
- A tip string that no longer exists (an earlier slice deleted it) → skip that row. Do not resurrect it.
- A tip string whose wording changed → move the **new** wording behind the `InfoHint`, keeping the same anchor.
- A **new** amber container that appears in either dialog and was not in this table → run it through the classification rule and treat it accordingly; if it is a tip, give it an `InfoHint` at its nearest heading.
- Rows E, F, G, H, I are never edited under any reconciliation.

## Oracle tests

All three must be seen **failing on the unmodified file first**.
Run with `pnpm --filter @fxl-sales/web test`.

### 1. `apps/web/src/components/ui/__tests__/info-hint.test.tsx` (NEW - the primary oracle)

Behavioural, in the idiom of the sibling `combobox.test.tsx`: `// @vitest-environment happy-dom` as the first line, the `IS_REACT_ACT_ENVIRONMENT` / `createRoot` / `act` scaffold copied verbatim, plain DOM queries with nothing mocked.

```tsx
describe('InfoHint', () => {
  it('renders a labelled trigger and keeps the hint out of the layout until asked', async () => {
    await renderHint();
    const trigger = container.querySelector('button');
    expect(trigger?.getAttribute('aria-label')).toBe('Mais informações sobre Profissionais alocados');
    expect(trigger?.getAttribute('aria-expanded')).toBe('false');
    expect(trigger?.getAttribute('type')).toBe('button');
    // The whole point of the slice: the sentence is not on screen on first paint.
    expect(container.textContent).not.toContain(HINT_TEXT);
  });

  it('reveals the hint on click and wires aria-controls to the panel it opened', async () => {
    await renderHint();
    const trigger = container.querySelector('button')!;
    await click(trigger);
    expect(container.textContent).toContain(HINT_TEXT);
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    const panelId = trigger.getAttribute('aria-controls');
    expect(panelId).toBeTruthy();
    expect(container.querySelector(`#${CSS.escape(panelId!)}`)?.textContent).toContain(HINT_TEXT);
  });

  it('dismisses on a second click, on Escape and on an outside click', async () => {
    await renderHint();
    const trigger = container.querySelector('button')!;

    await click(trigger);
    await click(trigger);
    expect(container.textContent).not.toContain(HINT_TEXT);

    await click(trigger);
    await keyDown(trigger, 'Escape');
    expect(container.textContent).not.toContain(HINT_TEXT);
    expect(document.activeElement).toBe(trigger);

    await click(trigger);
    await mouseDown(document.body);
    expect(container.textContent).not.toContain(HINT_TEXT);
  });

  it('opens from the keyboard, because a mouse is not the only pointer', async () => {
    await renderHint();
    const trigger = container.querySelector('button')!;
    trigger.focus();
    // A real <button> turns Enter/Space into a click event; asserting the click
    // path from a focused trigger is the honest keyboard assertion here.
    await click(trigger);
    expect(container.textContent).toContain(HINT_TEXT);
  });

  it('does not let Escape escape into a surrounding dialog', async () => {
    const onEscape = vi.fn();
    await renderHint({ wrapper: onEscape }); // outer div with onKeyDown={onEscape}
    const trigger = container.querySelector('button')!;
    await click(trigger);
    await keyDown(trigger, 'Escape');
    expect(onEscape).not.toHaveBeenCalled();
  });
});
```

`keyDown` dispatches a `KeyboardEvent('keydown', { key, bubbles: true })` inside `act`; `mouseDown` dispatches `MouseEvent('mousedown', { bubbles: true })`.
`HINT_TEXT` is the step-3 sentence, so the test also documents a real call site.

### 2. `apps/web/src/sales-ops/__tests__/sale-wizard-ui-contract.test.ts` (EXTEND)

Source-string idiom, matching the file. Append one `it`:

```ts
it('keeps first-run explanatory copy behind an info hint and live UI inline', () => {
  // Positive control: the tips still exist as copy - they moved, they were not deleted.
  expect(source).toContain('InfoHint');
  expect(source).toContain(
    'Aloque os profissionais do projeto e ajuste os percentuais - a margem líquida e as comissões são calculadas em tempo real.',
  );
  expect(source).toContain(
    'Esta é uma previsão - nada é lançado no financeiro até a proposta ser marcada como Ganha.',
  );
  // ...but no longer inside a standalone amber banner div.
  expect(source).not.toContain(
    'className="rounded-[11px] border border-[#f0dfae] bg-[#fdf0cf] px-[14px] py-[11px] text-[13px] text-[#57575f]"',
  );
  // The per-item helper lines lost the warning skin but not a single character of copy.
  expect(source).toContain('Item avulso - informe a área, a descrição e o valor');
  expect(source).not.toContain('<AlertTriangle className="h-[13px] w-[13px]" />');
  // Untouchable: the action-required bar and the state indicators.
  expect(source).toContain('Você ajustou as parcelas manualmente. Aplicar');
  expect(source).toContain('Manter parcelas');
  expect(source).toContain('Alterado manualmente');
  expect(source).toContain('Definido na venda');
  expect(source).toContain('Sem área');
});
```

The banner-className negative currently matches **three** occurrences (3527, 6609, 6943) and must reach zero.
Note tip B's className differs (`border-[#f0e2bd] bg-[#fbf3e0]`), which is why B is covered by test 3 instead.
Do not weaken any existing assertion in this file; this slice changes no wizard copy, so all of them must still pass untouched.

### 3. `apps/web/src/sales-ops/__tests__/product-service-dialog.test.tsx` (EXTEND + retarget two existing tests)

This file already renders `ProductDialog` into happy-dom with `@/components/ui/dialog` mocked, so it can assert on first paint directly.

Retarget the two tests that currently assert the tips are inline:

- `it('states that every value here is only a default')` (:392-397) - replace `expect(text()).toContain('Tudo aqui é padrão…')` with the pair below. Keep the `expect(text()).toContain('Comissionamento padrão')` line; that heading is unaffected.
- `it('replaces every own-value input with the definido na venda notice for a serviço')` (:345-358) - **remove only** the `expect(text()).toContain('Serviços têm valor variável, definido em cada proposta.')` line at :349. Every other assertion in it, including the two `Definido na venda` counts, must survive unmodified.

Then append:

```tsx
it('keeps the default-values explanation behind an info hint instead of a banner', async () => {
  await renderDialog({ productKind: 'service' });

  const tip = 'Tudo aqui é padrão: dentro da proposta você pode alterar qualquer valor sem mexer no cadastro.';
  const servicoTip = 'Serviços têm valor variável, definido em cada proposta.';
  expect(text()).not.toContain(tip);
  expect(text()).not.toContain(servicoTip);

  // Positive control: the state indicators are NOT hidden, they are still inline.
  expect(text().match(/Definido na venda/g)?.length).toBe(2);

  const triggers = [...container.querySelectorAll('button')].filter((button) =>
    button.getAttribute('aria-label')?.startsWith('Mais informações sobre'),
  );
  expect(triggers.length).toBeGreaterThanOrEqual(2);

  await click(triggers[0]);
  expect(text()).toContain(tip);
});
```

Both new assertions fail today: the tips are inline on first paint, and no element carries an `aria-label` starting with `Mais informações sobre`.

**Check, do not edit:** `apps/web/src/sales-ops/__tests__/sale-wizard-service-description.test.tsx:376/383/395/423` asserts the exact `descriptionHint` strings.
The tone demotion changes no character of them, so that file needs no edit and must keep passing as-is.
If it fails, the executor changed copy it was not supposed to change.

## Risk notes

- **`sale-wizard-ui-contract.test.ts` is a substring test over a 7k-line file.** Its negatives are only as strong as the exactness of the className strings quoted. If slice 02/03/08 reformatted those classNames (prettier reflow, token reorder), the negative assertion passes vacuously. The executor must confirm each `not.toContain` string is present in the file *before* editing, exactly as written.
- **Discoverability.** Four sentences that used to be unavoidable are now one click away. That is the requested trade. The mitigation is anchoring: every trigger sits beside the heading of the thing it explains, so an operator who wonders about `Profissionais alocados` finds the `ⓘ` in the same visual line. Do not batch the triggers into a single dialog-level help button.
- **Panel overflow.** The panel is `absolute` inside a `relative` wrapper with `w-[min(280px,calc(100vw-64px))]`. The step-3 and step-4 anchors sit on the left of their cards, so `align="start"` is safe; the produto dialog title is also left-anchored. If slice 08 moves any anchor to the right half of its container, pass `align="end"` - that prop exists exactly for that case and requires no component change.
- **Clipping.** The panel is `z-50` but still inside whichever ancestor carries `overflow-y-auto` (the wizard scroll body, after slice 02: `min-h-0 flex-1 overflow-y-auto`). A tall panel opened at the very bottom of the scroll body will be clipped by that scroller rather than escaping the dialog. All four hint texts are one or two lines, so the panel is ~60px and this cannot bite in practice. If a future hint is long enough to matter, that is the point to reconsider a portalled popover - and only then.
- **Escape ordering.** `stopPropagation` on the trigger's `keydown` only intercepts Escape while focus is *on the trigger*. Focus never moves into the panel (it holds no focusable content), so that is the complete set of cases. If a future hint gains a link inside it, the handler must move to the wrapper.
- **`react-refresh/only-export-components`.** `info-hint.tsx` exports one component plus a type. Types are erased, so the rule is satisfied without adding to the `allowExportNames` list in `apps/web/eslint.config.js`.
- **Verification.** `pnpm run lint`, `pnpm run type-check`, `pnpm test`. Lint matters here: this slice adds and removes `lucide-react` imports, and `no-unused-vars` is `error`.
