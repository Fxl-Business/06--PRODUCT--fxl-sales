# UI Controls - full reference

Moved verbatim from `CLAUDE.md` on 2026-09-22 so the standing context stays short.
`CLAUDE.md` keeps the rules; this file keeps the reasoning, history and oracle names.

- Native `<select>`, `<option>` and `<datalist>` are banned everywhere in `apps/web/src`, and `no-restricted-syntax` in `apps/web/eslint.config.js` fails lint if one comes back.
  A browser picker cannot be searched and cannot offer to create the item the operator just typed, which is why this is an enforced rule and not a preference.
- Every single-select picker in `apps/web/src/sales-ops/**`, plus the workspace switcher in `apps/web/src/auth/react.tsx` and every data-driven picker in the legacy `admin/**` and `finder/**` trees, uses `Combobox` from `@/components/ui/combobox`.
  It is the only searchable picker in the app.
- Documented exception, and the only one: `apps/web/src/admin/products/ProductDialog.tsx` (product status) and `apps/web/src/admin/products/CommissionRuleForm.tsx` (commission basis) keep the shadcn `Select`.
  Both are two-option closed enums that never grow, so search buys nothing, and a Radix `Select` is not a browser-native picker, so both already satisfy the ban above.
  Convert them to `Combobox` whenever those two screens are next worked on, and do not add a third such site.
- Numeric fields use `<Input type="number">` from `@/components/ui/input`; the OS spin buttons are suppressed by a base-layer rule in `apps/web/src/index.css`.
  A raw `<input type="number">` is banned by the same ESLint rule.
- `<input type="date">` is the one browser-native picker still allowed, by explicit decision.
- Any component that opens an inline layer inside a dialog - `Combobox`'s panel, `InfoHint`'s disclosure - MUST call `useInlineLayer(open)` from `@/components/ui/inline-layer`.
  Radix registers `useEscapeKeydown` on `document` with `{capture: true}`, so it runs before the event reaches React's root container and **no** handler inside the React tree can pre-empt it - `stopPropagation` and `stopImmediatePropagation` are both inert against it.
  Without the registry, Escape aimed at an open picker closes the whole wizard and discards the operator's typed work.
  `DialogContent` owns the registry and `preventDefault`s `onEscapeKeyDown` while any layer is open; the open count is a ref, so a picker opening does not re-render the dialog, and release is idempotent so a StrictMode double cleanup cannot strand the count negative and silently disarm the guard.
  A regression test for this must render the component inside a REAL `Dialog` and assert `onOpenChange` was not called. A spy on a React sibling's `onKeyDown` passes even with the protection deleted - that exact false positive already shipped once.
- Picker geometry has exactly two canonical sizes in sales-ops: `formSelectClass` (44px, matching `formInputClass` so a picker and the `Input` beside it line up) and `comboboxTriggerClass` (40px, the compact `Filtros` bar only).
  Call sites pass only non-geometry extras.
- `onCreate` is wired only where an inline create yields a complete, valid record: cliente, área and função create through the API, and profissional accepts the typed name verbatim.
  Produto opens `ProductDialog` prefilled instead, because a produto is invalid without an área.
  The `Custos padrão por função` picker inside `ProductDialog` gets no create row, because creating a função is admin-gated and belongs to `cadastros/funcoes`; its empty state points there.
  The vendedor and finder pickers get no create row, because a pessoa is invalid without a função; the função picker inside the Pessoa dialog does have one, because a função needs only a name.
  The proposta wizard's `FUNÇÃO NO PROJETO` picker has one too, for the same reason as the Pessoa dialog's; the two deliberate exclusions above are unchanged.
- A picker's copy promises creation only where `onCreate` is wired (2026-10-08, construbom-leads-ajustes).
  The lead dialogs' cliente picker reads `clientPickerCopy(canCreate)` from `apps/web/src/sales-ops/leads/client-picker-copy.ts` on BOTH the trigger placeholder and `searchPlaceholder` (which is also the search input's accessible name): `Buscar ou criar novo cliente` in `ContactLeadDialog` while `onCreateClient` is wired, otherwise `Buscar cliente cadastrado` (always in the full edition's `LeadDialog`).
  One boolean drives both the create row and the copy, so they cannot disagree.
  The `Combobox` defaults (`Selecionar...`, `Buscar...`) are unchanged and still pinned by `combobox.test.tsx`.
  Oracles: `client-picker-copy.test.ts`, `contact-lead-dialog.test.tsx`, `lead-dialog.test.tsx` (the Escape tests find the search field by its new accessible name inside the REAL `Dialog`).
- A `Combobox` with no matching option and a create row renders ONE divider.
  The end-to-end pass of construbom-leads-ajustes saw two lines 8px apart above `+ Criar novo cliente "..."`: the search field's `border-b`, the empty scroll area (`p-1`) and the create section's `border-t`.
  `listHasRows = filtered.length > 0 || !showCreate` now decides whether the scroll area renders at all, and the create section carries `border-t` only when options are listed above it.
  With no match and no `onCreate` the empty message still renders; keyboard navigation (`createIndex`, `activeRow`, `scrollIntoView` on `panelRef`) is untouched.
  Oracle: `combobox.test.tsx` `renders a single divider above the create row when nothing matches`, plus the `border-t` assertion in `keeps the create row visible below the filtered options when some match`.
- An inline action button that sits on a form field's row (`Limpar` beside a cliente picker, `Adicionar` beside the produto picker, `+ Adicionar item livre` beside the free product input) carries `self-stretch`.
  The row is `flex items-center gap-2` and `secondaryButtonClass` sizes by padding (`py-2`, 38px), so the button was 6px shorter than the 44px field; `self-stretch` takes the row's height, which is the tallest child, so it follows the field whatever its height becomes.
  `secondaryButtonClass` itself is shared across the app and stays unchanged, and footer buttons (`Cancelar`, `Salvar`, `Excluir lead`) get nothing.
  A button that must not wrap also carries `shrink-0 whitespace-nowrap` (`+ Adicionar item livre` wrapped to two lines, 55px tall, before).
  The Combobox panel is `absolute`, so an open picker never grows the row the button stretches to.
  Oracles: `stretches the inline action buttons to the field height` in `lead-dialog.test.tsx` and `contact-lead-dialog.test.tsx`, and `keeps + Adicionar item livre on one line`; happy-dom has no layout, so they assert the classes and the height was measured in Chrome (44.0 against 44.0).
- A wizard's primary button carries `type="button"` on EVERY step, and the final step saves through `onClick`.
  Never derive that attribute from the step (`type={step < 4 ? 'button' : 'submit'}`), because the click that advances the step would then also be the click that changes the element's own activation behaviour.
  A click runs in two phases - the event dispatch, then the browser's activation behaviour for the element - and React 18 flushes a discrete event's state update synchronously, so the re-render lands BETWEEN them.
  The browser then asks "is this a submit button?" of an element React has already rewritten to `submit`, submits the form, and persists a record the operator never reviewed.
  That was the produto dialog's step 3 to 4 autosave; the proposta wizard never had it because its primary button was always `type="button"`.
- A DOM-level click test CANNOT catch that regression: happy-dom's `dispatchEvent` never runs activation behaviour, so `advances from step 3 to step 4 without saving` passes with the bug fully present.
  The oracle is the invariant `keeps one activation behaviour on every step` in `apps/web/src/sales-ops/__tests__/product-service-dialog.test.tsx`, which was the only one of 537 web tests to go red on the mutation.
  Anything of this class has to be proven in a real browser; assert the invariant that makes the race impossible rather than trying to observe the race in jsdom or happy-dom.
