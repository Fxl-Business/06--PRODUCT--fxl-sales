---
id: 04-web-visual-polish
milestone: v4.7.0
status: done
depends_on: [01-web-leads-board-parity, 02-web-client-picker-copy]
files_modified: [apps/web/src/sales-ops/leads/LeadCard.tsx, apps/web/src/components/ui/combobox.tsx, apps/web/src/sales-ops/leads/LeadDialog.tsx, apps/web/src/sales-ops/leads/__tests__/leads-contact-board.test.tsx, apps/web/src/components/ui/__tests__/combobox.test.tsx, apps/web/src/sales-ops/leads/__tests__/lead-dialog.test.tsx]
oracle: [apps/web/src/sales-ops/leads/__tests__/leads-contact-board.test.tsx, apps/web/src/components/ui/__tests__/combobox.test.tsx, apps/web/src/sales-ops/leads/__tests__/lead-dialog.test.tsx, apps/web/src/sales-ops/leads/__tests__/contact-lead-dialog.test.tsx, apps/web/src/sales-ops/leads/__tests__/leads-full-edition.test.tsx, apps/web/src/sales-ops/leads/__tests__/lead-delete.test.tsx, apps/web/src/sales-ops/leads/__tests__/lead-unassigned-marker.test.tsx, apps/web/src/sales-ops/leads/__tests__/lead-card-days-parked.test.tsx]
acceptance: ["Leads-edition card: the Cliente line ([data-lead-client]) is a full-width row of the card header, NOT inside the flex row that holds [data-lead-value] and the menu, so a client name is never cut while blank space sits under the value", "The Cliente line shows up to two lines (line-clamp-2, break-words) and carries a title attribute with the full resolved label; Sem cliente keeps the same element", "The contact name row keeps the value and the menu on its right (value and menu shrink-0, name min-w-0 and wraps); the birthday line stays under the Cliente line", "The full-edition card markup is unchanged", "Combobox: when no option matches and the create row is shown, the scrollable option area is not rendered and the create section has no border-t, so exactly one divider (the search field's border-b) sits above the create row", "Combobox: when some options match and the create row is shown, the create section keeps its border-t (unchanged)", "Combobox: with no match and no onCreate, the empty message still renders (unchanged)", "LeadDialog (full edition): the + Adicionar item livre button never wraps (whitespace-nowrap, shrink-0)", "LeadDialog: the Produto nao cadastrado block is separated from the produtos picker row by the same 16px rhythm as the other fields (pt-2.5 on top of the group's gap-1.5)", "Every listed oracle stays green; web type-check and eslint on changed files exit 0; no em dash"]
---

# 04 Visual polish found in the end-to-end run

Inserted mid-flight (beat 7) by the orchestrator after the end-to-end browser pass on the integrated run branch (`a146f13`, wave 1 green).
Each defect was seen in the real app (`make dev-fake` equivalent, Chrome at 1440x900).

## Defects (observed)

1. Leads-edition card (slice 01): the Cliente line sits in the left column of the header row, which shares the width with the value and the `...` menu.
   A long client name is cut (`VILLA CONSTRUTORA L...`, `CONSTRUTORA HORI...`) while the space under the value stays empty.
2. `Combobox` (pre-existing): with a query that matches nothing and `onCreate` wired, the empty scroll area (`p-1`, 8px) still renders between the search field's `border-b` and the create section's `border-t`, so two divider lines sit 8px apart.
   Seen in the leads-edition `Cliente` picker (`+ Criar novo cliente "..."`).
3. `LeadDialog` (pre-existing, full edition): `+ Adicionar item livre` wraps onto two lines and is taller than the input beside it; the `Produto não cadastrado` label sits only 6px under the produtos picker row (the nested group inherits `gap-1.5`), while every other field is 16px apart.

## Changes (exact)

### `apps/web/src/sales-ops/leads/LeadCard.tsx` (leads-edition branch only, `contact ? (...)`)

Replace the leads-edition header block with:

```tsx
<div className="flex flex-col gap-0.5">
  <div className="flex items-start justify-between gap-2">
    <span className="min-w-0 break-words text-[14px] font-semibold text-[#201f24]">
      {lead.contactName}
    </span>
    <div className="flex shrink-0 items-start gap-0.5">
      <span className="sales-ops-num shrink-0 text-[14px] font-bold text-[#201f24]" data-lead-value>
        {formatMoneyBrl(lead.estimatedValueBrl, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
      </span>
      {menu}
    </div>
  </div>
  <span className="line-clamp-2 break-words text-[12.5px] text-[#8b8b92]" data-lead-client title={clientLabel}>
    {clientLabel}
  </span>
  {birthday !== null ? (<span className="text-[12px] text-[#8b8b92]" data-lead-birthday>...</span>) : null}
</div>
```

`clientLabel` is `leadClientLabel(lead, lookups)` computed once at the top of the component (only used in the leads edition).
The full-edition branch is not touched.

### `apps/web/src/components/ui/combobox.tsx`

Inside the listbox div:
- `const listHasRows = filtered.length > 0 || !showCreate;` (derive next to the other render-time values).
- Render the scroll area `<div className="min-h-0 flex-1 overflow-y-auto p-1" role="presentation">` only when `listHasRows`.
- The create section's class becomes `cn('p-1', filtered.length > 0 && 'border-t border-border')`.
Nothing else changes: keyboard navigation, `createIndex`, `aria-*`, the empty message (shown only when nothing matches and there is no create row) all keep their behaviour.

### `apps/web/src/sales-ops/leads/LeadDialog.tsx`

- The nested `Produto não cadastrado` group `<div className="flex flex-col gap-1.5">` becomes `<div className="flex flex-col gap-1.5 pt-2.5">`.
- The `+ Adicionar item livre` button gets `className={`${secondaryButtonClass} shrink-0 whitespace-nowrap`}`.

## Tests (Red first)

- `leads-contact-board.test.tsx`: new test "keeps the Cliente line out of the value row so a long name is never squeezed": render a leads-edition card with a long client name; assert `[data-lead-client]` is not contained by the element that contains `[data-lead-value]`'s row (`valueEl.closest('div.justify-between')` does not contain `clientEl`), has class `line-clamp-2`, and `title` equals the full name; also for `Sem cliente`.
- `combobox.test.tsx`: new test "renders a single divider above the create row when nothing matches": open with options, type a non-matching query with `onCreate`; assert the listbox has no `.overflow-y-auto` child and `[data-combobox-create]`'s section (`parentElement`) has no `border-t` class. Extend "keeps the create row visible below the filtered options when some match" with an assertion that the create section still has `border-t`.
- `lead-dialog.test.tsx`: new test "keeps + Adicionar item livre on one line": the button has `whitespace-nowrap` and `shrink-0`, and the `Produto não cadastrado` group has `pt-2.5`.

## Constraints

- Touch only `files_modified`; no em dash; run-once commands; Conventional Commits in English with no co-author line; kill what you start.
- Layout classes only: no copy change, no behaviour change.
