---
id: 02-dialog-no-outside-close
milestone: v2.3.0
status: todo
depends_on: []
files_modified:
  - apps/web/src/components/ui/dialog.tsx
  - apps/web/src/components/ui/alert-dialog.tsx
  - apps/web/src/components/ui/__tests__/dialog-outside-close.test.tsx
  - apps/web/src/components/ui/__tests__/dialog-close-affordances.test.tsx
acceptance: "given any open dialog rendered through the shared DialogContent primitive, when a pointer goes down anywhere outside the dialog content, then the dialog stays open and keeps its typed state, while Esc, the X affordance and Cancelar/Voltar still close it"
---

# Dialogs never close on outside click

## Goal

A stray click outside an open dialog must never discard typed work.
Make outside-click dismissal impossible app-wide by fixing it once in the shared `DialogContent` primitive, in a way no call site can opt back into - neither by passing a prop (blocked at the type level) nor by prop ordering (blocked at runtime).
`Esc` and the explicit close affordances (`X`, `Cancelar`, `Voltar`) are deliberately left working, because the user asked only for outside-click dismissal to go away.
Along the way, fix the English `"Close"` screen-reader label leaking into this pt-BR app.

## Current state

### The shared primitives

`apps/web/src/components/ui/dialog.tsx` is 120 lines of shadcn-style wrapper over `@radix-ui/react-dialog` (import at `dialog.tsx:2`).
Exports at `dialog.tsx:109-120`: `Dialog` (raw Radix `Root`, `:7`), `DialogTrigger` `:9`, `DialogPortal` `:11`, `DialogClose` `:13`, `DialogOverlay` `:15`, `DialogContent` `:30`, `DialogHeader` `:54`, `DialogFooter` `:68`, `DialogTitle` `:82`, `DialogDescription` `:97`.

`DialogContent` at `dialog.tsx:30-52` is the single choke point.
It is typed `React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content>` (`dialog.tsx:32`) and spreads `{...props}` at `dialog.tsx:42`, so `onPointerDownOutside` and `onInteractOutside` are already accepted and already typed but never set.
It renders `<DialogOverlay />` unconditionally at `dialog.tsx:35` and a hardcoded close button at `dialog.tsx:45-48` whose `sr-only` text is the English `"Close"` at `dialog.tsx:47`.

Verified upstream behaviour of `@radix-ui/react-dialog@1.1.18` (resolved in `pnpm-lock.yaml`):
`DialogContentModal` composes `onPointerDownOutside` with `composeEventHandlers(props.onPointerDownOutside, ...)` (`dist/index.mjs:152`), and `DismissableLayer` only calls `onDismiss()` when `!event.defaultPrevented` (`@radix-ui/react-dismissable-layer@1.1.14/dist/index.mjs:216`).
So a `preventDefault()`ing handler is the correct and sufficient central fix.
The same `DismissableLayer` handles `Escape` through a separate `onEscapeKeyDown` path (`dist/index.mjs:84-95`) - untouched by this slice, which is exactly why `Esc` keeps working.

`apps/web/src/components/ui/alert-dialog.tsx` is Radix-based too (`AlertDialogContent` at `alert-dialog.tsx:28-44`).
**Decision: an alert dialog is a confirmation surface, so the same rule applies - and it is already guaranteed upstream, non-overridably, so this slice makes no functional change there.**
Two verified upstream facts:

1. `@radix-ui/react-alert-dialog@1.1.18/dist/index.mjs:67-68` hardcodes `onPointerDownOutside: (event) => event.preventDefault()` and `onInteractOutside: (event) => event.preventDefault()` **after** spreading `contentProps`, so a call site cannot override them at runtime.
2. `@radix-ui/react-alert-dialog@1.1.18/dist/index.d.mts:23` declares `interface AlertDialogContentProps extends Omit<DialogContentProps, 'onPointerDownOutside' | 'onInteractOutside'>`, so a call site cannot even pass them.

This was empirically confirmed: adding the two handlers to `alert-dialog.tsx` fails `pnpm run type-check` with `TS2322 ... Property 'onInteractOutside' does not exist on type 'IntrinsicAttributes & AlertDialogContentProps & RefAttributes<HTMLDivElement>'`.
So the only change `alert-dialog.tsx` gets in this slice is a comment recording the guarantee, so a future reader does not "fix" what is already correct.

### Dialog inventory - every modal surface in `apps/web/src`

All 12 `Dialog` surfaces below go through `@/components/ui/dialog`, so they **inherit the fix with zero call-site changes**.
None of them passes `onPointerDownOutside` or `onInteractOutside` today (grep across `apps/web/src` returns zero hits outside `node_modules`), so the type narrowing in step 1 breaks nothing.

| # | Surface | Anchor |
| --- | --- | --- |
| 1 | `SaleDetailDialog` (defined `:1580`) | `apps/web/src/sales-ops/SalesOpsApp.tsx:1616-1810` |
| 2 | `ProductDialog` / `ProductDialogBody` (`:2583` / `:2605`) | `apps/web/src/sales-ops/SalesOpsApp.tsx:2675-3109` |
| 3 | `ClientDialog` / `ClientDialogBody` (`:3161` / `:3179`) | `apps/web/src/sales-ops/SalesOpsApp.tsx:3214-3289` |
| 4 | `AreaDialog` / `AreaDialogBody` (`:3294` / `:3312`) | `apps/web/src/sales-ops/SalesOpsApp.tsx:3333-3365` |
| 5 | `PersonDialog` / `PersonDialogBody` (`:3370` / `:3388`) | `apps/web/src/sales-ops/SalesOpsApp.tsx:3423-3467` |
| 6 | `SaleWizardDialog` / `SaleWizardDialogBody` (`:3632` / `:3654`) - the highest-value one, it holds the whole proposta wizard | `apps/web/src/sales-ops/SalesOpsApp.tsx:4134-5204` |
| 7 | Admin app create/edit | `apps/web/src/admin/apps/AppDialog.tsx:30-35` |
| 8 | Key reveal | `apps/web/src/admin/apps/KeyRevealModal.tsx:109-153` |
| 9 | Finder suspend | `apps/web/src/admin/finders/AdminFinderDetailPage.tsx:135-171` |
| 10 | Legacy product dialog | `apps/web/src/admin/products/ProductDialog.tsx:32-41` |
| 11 | Seller invite | `apps/web/src/admin/sellers/AdminSellersPage.tsx:45-93` |
| 12 | Finder link generate | `apps/web/src/finder/links/LinksPage.tsx:100-106` |

The 5 `AlertDialog` surfaces below are **already immune** through the upstream guarantee documented above, and need no change:

| # | Surface | Anchor |
| --- | --- | --- |
| 13 | Proposta transition confirm (inside `SalesView` `:1394`; `AlertDialogCancel` `Voltar` at `:1563`) | `apps/web/src/sales-ops/SalesOpsApp.tsx:1551-1568` |
| 14 | Commission reverse confirm (`AlertDialogCancel` `common.cancel` at `:156`) | `apps/web/src/admin/commissions/CommissionsPage.tsx:142-161` |
| 15 | Payout mark-paid confirm | `apps/web/src/admin/payouts/PayoutBatchesPage.tsx:115-127` |
| 16 | Key-not-copied confirm (`AlertDialogCancel` `back` at `:163`) | `apps/web/src/admin/apps/KeyRevealModal.tsx:156-168` |
| 17 | Link revoke confirm | `apps/web/src/finder/links/LinkCard.tsx:82-104` |

### The dialog-vs-popover line - do NOT apply the change to these

A dialog is a **committed, modal surface holding user work** and must survive a stray click.
A popover, dropdown menu or select listbox is a **transient, non-committed surface** whose entire dismissal contract is "click anywhere else and I go away".
Removing outside-click there would trap the user, so these keep their current behaviour and get **no change**:

- `apps/web/src/components/ui/dropdown-menu.tsx:63-81` - `DropdownMenuContent` over `@radix-ui/react-dropdown-menu`. A menu, not a dialog. **Keeps outside-click close.**
- `apps/web/src/components/ui/select.tsx:70-100` - `SelectContent` over `@radix-ui/react-select`. A listbox popup. **Keeps outside-click close.**
- `apps/web/src/sales-ops/SalesOpsApp.tsx:735-742` - the hand-rolled workspace-switcher scrim, `<button aria-label="Fechar workspaces" className="fixed inset-0 z-[55] cursor-default" onClick={() => setWorkspaceMenuOpen(false)}>`. This is the outside-click affordance of a **menu**, not of a dialog. **Leave it exactly as is.**
- There is no `popover.tsx`, `sheet.tsx`, `drawer.tsx`, `command.tsx` or `tooltip.tsx` in this repo.
  `apps/web/src/components/ui/` contains only: `alert-dialog.tsx`, `badge.tsx`, `button.tsx`, `card.tsx`, `dialog.tsx`, `dropdown-menu.tsx`, `empty-state.tsx`, `input.tsx`, `kpi-card.tsx`, `label.tsx`, `select.tsx`, `skeleton.tsx`, `table.tsx`, `tabs.tsx`.
  So the inventory above is complete: `fixed inset-0` appears in only three places in `apps/web/src` (`dialog.tsx:22`, `alert-dialog.tsx:19`, `SalesOpsApp.tsx:739`), and there is no other hand-rolled backdrop.

### Existing tests that depend on outside-click dismissal

**None.** Verified two ways:

1. Grep for `pointerdown|pointerDownOutside|interactOutside|overlay|outside` across every `apps/web/src/**/*.test.ts(x)` returns zero hits.
2. Every dialog-bearing test replaces the primitive with plain `div`s, so it never exercises Radix dismissal at all:
   `vi.mock('@/components/ui/dialog', ...)` at `areas-view.test.tsx:9`, `client-dialog-legal-fields.test.tsx:9`, `product-commission-editor.test.tsx:9`, `routing.test.tsx:85`, `sale-wizard-edit.test.tsx:10`, `sales-view.test.tsx:10`, `sales-transition-actions.test.tsx:10` (all under `apps/web/src/sales-ops/__tests__/`), and the sibling `sale-wizard-*.test.tsx` files.
   `vi.mock('@/components/ui/alert-dialog', ...)` at `sales-view.test.tsx:43` and `sales-transition-actions.test.tsx:43`; their `CloseCtx` wires only the explicit `AlertDialogCancel` button to `onOpenChange(false)`.

So no existing test has to be updated. The whole suite (21 files, 122 tests) was run against a prototype of this change and stayed green.

### Test harness reality

There is **no `@testing-library/*`** in this repo.
`apps/web/vitest.config.ts` sets `environment: 'node'`; each component test opts in with `// @vitest-environment happy-dom` on line 1, renders via `createRoot` from `react-dom/client` plus `React.act` reached through a cast, and queries the DOM by hand (see `apps/web/src/sales-ops/__tests__/client-dialog-legal-fields.test.tsx:1-101` for the canonical shape).

**Measured harness limit, and it decides the Red strategy.**
A prototype test that mounted the *real* Radix dialog and dispatched `new PointerEvent('pointerdown', { bubbles: true, button: 0 })` on an element outside the portal was written and run.
The event provably reached `document` with the right `target` and `button`, and Radix's `pointerdown` listener was provably registered (`document.addEventListener` spy captured `"pointerdown"` after the `setTimeout(…, 0)` in `usePointerDownOutside`), yet Radix never dispatched `dismissableLayer.pointerDownOutside` and `onOpenChange` was never called - **outside-click dismissal simply does not happen in happy-dom**, before or after the fix.
Such a test can therefore never go Red and would be a vacuous oracle. It is not planned.

The oracle is instead a **prop-contract test with the Radix primitive mocked to capture the props our wrapper passes to `DialogPrimitive.Content`**.
This was prototyped end to end: it fails Red on today's code with `expected 'undefined' to be 'function'`, and passes Green after the implementation below.
Escape and the X affordance *are* driveable in happy-dom (both verified working against the real primitive), so they get a second, separate real-primitive test file.

## Red

Two new files. Both use `// @vitest-environment happy-dom` on line 1 and the repo's `createRoot` + `React.act` idiom.

### File 1 (the real Red): `apps/web/src/components/ui/__tests__/dialog-outside-close.test.tsx`

`describe('DialogContent outside-interaction contract')` with 5 tests:

1. `it('passes a preventDefault-ing onPointerDownOutside to the Radix content')`
   Renders `<Dialog open><DialogContent><DialogTitle>Titulo</DialogTitle></DialogContent></Dialog>`, reads the captured props, asserts `typeof captured.onPointerDownOutside === 'function'`, calls it with a fake event and asserts `preventDefault` was called.
   **Red today:** the prop is `undefined`.
2. `it('passes a preventDefault-ing onInteractOutside to the Radix content')`
   Same for `onInteractOutside` (this is the handler the non-modal path and the focus-outside path go through).
   **Red today:** the prop is `undefined`.
3. `it('does not intercept the Escape key')`
   Asserts `'onEscapeKeyDown' in captured === false`, pinning the deliberate decision that `Esc` stays on the Radix default.
   Green today and after - a guard against a future over-correction.
4. `it('labels the close affordance in pt-BR')`
   Asserts the rendered text contains `'Fechar'` and does not contain `'Close'`.
   **Red today:** the label is `Close` (`dialog.tsx:47`).
5. `it('ignores a call-site attempt to re-enable outside dismissal')`
   Renders `<DialogContent {...({ onPointerDownOutside: spy } as never)}>`, asserts the captured handler still calls `preventDefault` and that `spy` was **not** called - proving the guard wins at runtime regardless of prop ordering, not only at the type level.
   **Red today:** the caller's handler is the only one there.

Mechanics the executor must copy exactly, because they were verified and the obvious alternatives break:

- Declare `const captured: { props: Record<string, unknown> | null } = { props: null }` **before** `vi.mock`.
- `vi.mock('@radix-ui/react-dialog', () => { ... })` returning `Root`, `Trigger`, `Portal`, `Close`, `Overlay`, `Content`, `Title`, `Description`.
  Every one of those needs a `displayName`, because `dialog.tsx:28`, `:52`, `:95` and `:107` read `DialogPrimitive.<X>.displayName`.
  `Content` must do `captured.props = props` (after destructuring `children` out) and render `<div>{children}</div>`; `Close` must render `<button type="button">{children}</button>`.
- Import the module under test with **`const { Dialog, DialogContent, DialogTitle } = await import('../dialog');`** at top level, *after* the `const captured` declaration.
  A static `import` is hoisted above the `const`, the mock factory then runs inside the TDZ of `captured`, and the test dies with a `ReferenceError`. Top-level `await import` is the verified working form and it type-checks.
- The fake event is `{ defaultPrevented: false, preventDefault: vi.fn() }` cast through `as unknown as Event & { preventDefault: ReturnType<typeof vi.fn> }`.
- Reset `captured.props = null` in `beforeEach`.
- No `console.*` and no `eslint-disable` comments: `no-console` is not enabled in this repo's eslint config, so a disable directive is itself reported as an unused-directive warning.

### File 2 (behaviour guard for the affordances we keep): `apps/web/src/components/ui/__tests__/dialog-close-affordances.test.tsx`

No mocks - this one drives the **real** `@radix-ui/react-dialog`, which does render in happy-dom.
`describe('dialog close affordances stay working')` with 2 tests, both green before and after (they exist so the next person cannot silently kill `Esc` or the `X`):

1. `it('closes on Escape')` - mount `<Dialog onOpenChange={onOpenChange} open>` with `DialogContent` + `DialogTitle`, then `document.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Escape' }))` inside `act`, then `expect(onOpenChange).toHaveBeenCalledWith(false)`.
2. `it('closes on the X affordance')` - same mount, then click `document.body.querySelector('[role="dialog"] button')` with `new MouseEvent('click', { bubbles: true })` inside `act`, then `expect(onOpenChange).toHaveBeenCalledWith(false)`.

Both need the Radix `DismissableLayer` listeners registered first, so after mounting await one macrotask inside `act`:

```ts
await act(async () => {
  await new Promise((resolve) => {
    setTimeout(resolve, 5);
  });
});
```

Because the real primitive portals into `document.body`, query `document.body`, not the `createRoot` container, and remember `document.body.style.pointerEvents` becomes `"none"` while a modal dialog is open (harmless for `dispatchEvent`).

### ORACLE

```bash
CI=true pnpm --filter @fxl-sales/web exec vitest run src/components/ui/__tests__/dialog-outside-close.test.tsx src/components/ui/__tests__/dialog-close-affordances.test.tsx
```

Use the `exec vitest run <path>` form. `pnpm --filter @fxl-sales/web test -- --run <path>` was measured and does **not** filter - pnpm swallows the positional argument and all 21 web test files run. That still proves the slice, it is just slower and noisier.

Full gate:

```bash
pnpm run lint
pnpm run type-check
CI=true pnpm test
```

## Green

1. **`apps/web/src/components/ui/dialog.tsx`** - narrow the prop type so no call site can opt back in.
   Immediately above `const DialogContent = React.forwardRef<` (currently `dialog.tsx:30`), insert:

   ```tsx
   /**
    * Outside-click dismissal is removed app-wide: a stray click must never
    * discard typed work. `onPointerDownOutside` / `onInteractOutside` are
    * omitted from the public props so no call site can opt back in, and the
    * handlers below are applied after `{...props}` so ordering cannot defeat
    * them either. `Esc`, the `X` affordance and `Cancelar` / `Voltar` are
    * deliberately left working.
    */
   type DialogContentProps = Omit<
     React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content>,
     "onPointerDownOutside" | "onInteractOutside"
   >
   ```

2. Same file - use it as the `forwardRef` props type. Replace the second type argument at `dialog.tsx:32`, `React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content>`, with `DialogContentProps`.
   Leave the destructure `({ className, children, ...props }, ref)` untouched.

3. Same file - add the two guards **after** the `{...props}` spread (currently `dialog.tsx:42`), so they are the last writers and win at runtime:

   ```tsx
         {...props}
         onInteractOutside={(event) => event.preventDefault()}
         onPointerDownOutside={(event) => event.preventDefault()}
       >
   ```

   Keep that exact alphabetical order (`onInteractOutside` before `onPointerDownOutside`) - it matches the prop ordering the repo's eslint config is happy with, verified by a clean `pnpm run lint`.
   Do **not** add `onEscapeKeyDown`, and do **not** touch `DialogOverlay` (`dialog.tsx:15-28`) - the overlay carries no click handler; dismissal came purely from `DismissableLayer`.

4. Same file - fix the pt-BR defect at `dialog.tsx:47`: `<span className="sr-only">Close</span>` becomes `<span className="sr-only">Fechar</span>`.
   Hardcode the string rather than wiring `useTranslation` into a shadcn primitive: there is no `common.close` key (`apps/web/src/i18n/pt-BR.json` `common` has only `loading`, `error`, `retry`, `save`, `saving`, `cancel`, `edit`, `previous`, `next`), the only existing `close` key is the scoped `admin.apps.keyReveal.close` at `pt-BR.json:278`, and the batch overview lists "no i18n extraction work" as a scope limit.

5. **`apps/web/src/components/ui/alert-dialog.tsx`** - comment only, no behaviour change.
   Immediately above `const AlertDialogContent = React.forwardRef<` (currently `alert-dialog.tsx:28`), insert:

   ```tsx
   /**
    * No outside-click guard is needed here: `@radix-ui/react-alert-dialog`
    * already hardcodes `onPointerDownOutside` / `onInteractOutside` to
    * `preventDefault()` after spreading `contentProps`, and omits both props
    * from `AlertDialogContentProps`, so a call site can neither override nor
    * pass them. Adding the handlers here is a TS2322 compile error.
    * `Esc` and `AlertDialogCancel` (`Cancelar` / `Voltar`) stay working.
    */
   ```

   Do not change the props type or the JSX in this file.

6. Write the two test files described under **Red**.

7. Run the ORACLE, then the full gate (`pnpm run lint`, `pnpm run type-check`, `CI=true pnpm test`).
   Expect 23 test files / 129 tests green (21 files / 122 tests today, plus 5 + 2 new).

8. Commit as one atomic commit, for example:
   `fix(web): keep dialogs open on outside click`

## Refactor

Nothing further. The change is deliberately confined to one choke point plus one comment; the 17 enumerated surfaces need no edits, which is the whole point of fixing it in the primitive.

Two things explicitly **not** done as cleanup here, to keep the commit atomic:

- `dropdown-menu.tsx` and `select.tsx` are untouched. They are on the popover side of the line.
- The hand-rolled workspace-switcher scrim at `SalesOpsApp.tsx:735-742` stays. It belongs to slice `03-combobox-primitive` / `06-combobox-adoption` territory if it is ever revisited, and it is a menu affordance, not a dialog one.

## Out of scope

- Any change to `Esc`, the `X` affordance, `Cancelar`, `Voltar`, or `AlertDialogCancel`. The user asked only for outside-click dismissal.
- Any "unsaved changes - confirm before closing?" interstitial. Not requested, and it would change the meaning of `Esc` and `X`.
- Outside-click behaviour of dropdown menus, selects, and the workspace-switcher scrim.
- Introducing `@testing-library/*` or changing `apps/web/vitest.config.ts`.
- i18n extraction of the `Fechar` string, or any other i18n work.
- The other 11 slices in this batch, including query-cache refresh, the Combobox primitive, and the payment-plan builder.

## Risks

- **The oracle could be vacuous.** An outside-pointerdown DOM test cannot go Red in happy-dom - measured, not assumed (Radix's listener registers, the event lands on `document` with the right `target`/`button`, and no dismissal fires). *Avoided by* making the oracle a prop-contract test against a mocked `DialogPrimitive.Content`, prototyped to fail Red on today's code and pass Green after step 3, plus test 5 which specifically proves runtime non-overridability.
- **A call site silently opts back in later.** *Avoided twice over:* `Omit` in step 1 makes it a `tsc` error caught by `pnpm run type-check`, and the post-spread ordering in step 3 makes it a no-op even if the type is bypassed with a cast. Test 5 locks the runtime half in place.
- **`Omit` breaks an existing call site.** *Avoided:* grep found zero `onPointerDownOutside` / `onInteractOutside` usages in `apps/web/src`, and a prototype of steps 1-4 passed `pnpm run type-check` across all four workspace projects.
- **Over-applying the change to menus, trapping the user.** *Avoided:* the dialog-vs-popover line is drawn explicitly above, with the three keep-as-is surfaces named by file and line and an explicit "no change" instruction.
- **Someone "helpfully" mirrors the guard into `alert-dialog.tsx`.** *Avoided:* it is a hard `TS2322` compile error (measured), and step 5 leaves a comment saying exactly that with the upstream citation.
- **Killing `Esc` or the `X` as collateral damage.** *Avoided:* `onEscapeKeyDown` is never passed (asserted by test 3) and the second test file drives the real primitive to prove `Esc` and `X` still call `onOpenChange(false)`.
- **A future Radix upgrade drops the alert-dialog guarantee.** Accepted, low: it is a documented part of the WAI-ARIA alertdialog pattern that Radix implements deliberately, and `type-check` would immediately surface the type-level half of the change. Not worth a vacuous test today.
- **Radix's overlay also had a click handler we missed.** *Avoided:* `DialogOverlay` (`dialog.tsx:15-28`) is a bare styled `DialogPrimitive.Overlay` with no `onClick`; dismissal came solely from `DismissableLayer`, and `fixed inset-0` exists in only three places in `apps/web/src`, all enumerated.
