---
id: 03-web-delete-ui
milestone: v4.6.0
status: done
depends_on: [01-api-lixeira]
files_modified: [apps/web/src/lib/api-client.ts, apps/web/src/lib/__tests__/api-client-no-content.test.ts, apps/web/src/sales-ops/leads/api.ts, apps/web/src/sales-ops/leads/optimistic.ts, apps/web/src/sales-ops/leads/hooks.ts, apps/web/src/sales-ops/leads/delete-copy.ts, apps/web/src/sales-ops/leads/LeadDeleteDialog.tsx, apps/web/src/sales-ops/leads/board-ui.ts, apps/web/src/sales-ops/leads/LeadCard.tsx, apps/web/src/sales-ops/leads/LeadsBoard.tsx, apps/web/src/sales-ops/leads/ContactLeadDialog.tsx, apps/web/src/sales-ops/leads/LeadDialog.tsx, apps/web/src/sales-ops/leads/LeadsBoardContainer.tsx, apps/web/src/sales-ops/leads/__tests__/lead-delete.test.tsx, apps/web/src/sales-ops/leads/__tests__/leads-api-contract.test.ts, apps/web/src/sales-ops/leads/__tests__/leads-contact-container.test.tsx, apps/web/src/sales-ops/leads/__tests__/board-write-surface.test.ts]
oracle: [apps/web/src/sales-ops/leads/__tests__/lead-delete.test.tsx, apps/web/src/lib/__tests__/api-client-no-content.test.ts, apps/web/src/sales-ops/leads/__tests__/leads-api-contract.test.ts, apps/web/src/sales-ops/leads/__tests__/board-write-surface.test.ts, apps/web/src/sales-ops/leads/__tests__/leads-contact-container.test.tsx, apps/web/src/sales-ops/leads/__tests__/leads-board-keyboard.test.tsx, apps/web/src/sales-ops/leads/__tests__/leads-board-dropzones.test.tsx, apps/web/src/sales-ops/leads/__tests__/lead-card-days-parked.test.tsx, apps/web/src/sales-ops/leads/__tests__/leads-list-view.test.tsx, apps/web/src/sales-ops/leads/__tests__/contact-lead-dialog.test.tsx, apps/web/src/sales-ops/leads/__tests__/lead-dialog.test.tsx, apps/web/src/sales-ops/leads/__tests__/leads-move-rollback.test.ts, apps/web/src/sales-ops/leads/__tests__/move-dialog-inline-layer.test.tsx, apps/web/src/sales-ops/leads/__tests__/lead-conversion.test.tsx, apps/web/src/sales-ops/leads/__tests__/leads-contact-board.test.tsx, apps/web/src/sales-ops/leads/__tests__/leads-full-edition.test.tsx, apps/web/src/sales-ops/leads/__tests__/lead-unassigned-marker.test.tsx]
acceptance: ["Every non-converted Quadro card rendered with onDelete carries one keyboard-reachable kebab button [data-lead-menu=<id>] named 'Ações do lead: <contato>' in both editions; a converted card and a card without onDelete carry none and keep zero buttons", "A pointerdown on the kebab or on the portalled menu never reaches the dnd-kit onPointerDown the card receives, while a pointerdown on the card body still does", "Clicking the kebab opens a menu whose one item [data-delete-lead=<id>] reads Excluir, and never opens the editor", "A right-click on a non-converted card prevents the browser menu and opens the same menu without opening the editor; a right-click on a converted card is left to the browser", "Picking Excluir opens the in-app LeadDeleteDialog naming the lead (window.confirm is never called), and Cancelar sends nothing and changes nothing", "Confirming sends exactly one POST /api/v1/sales-ops/leads/<id>/delete with no body and the Hub bearer, removes the card at once from every cached board entry (its column re-densified) and closes the dialog on the 204", "apiFetch resolves undefined for a 204 without reading a body, so a successful delete is never rolled back", "A refused delete (500, 403, network) puts every board entry back to its pre-delete content and keeps the dialog open with the sales-ops mutation copy inline; 409 lead_already_converted shows 'Este lead já virou proposta e não pode ser excluído.'", "A 404 resolves as success: the card stays removed and no error is shown", "While the delete is on the wire the confirm reads Excluindo…, both buttons are disabled and Escape cannot close the dialog", "The Lista shows an Excluir button [data-delete-lead=<id>] after Mover and Editar on every non-converted row only, opening the same dialog", "Both edit forms (LeadDialog and ContactLeadDialog) show the outlined Excluir lead button [data-delete-lead-form] at the left of the footer in edit mode only, never on create and never for a converted lead, and a confirmed delete closes the confirmation and the form together", "Escape on the confirmation opened from a real edit Dialog closes only the confirmation, returns focus to Excluir lead, and a second Escape closes the form", "A non-admin vendedor in the leads edition gets the same menu and delete flow on the leads his board shows", "useDeleteLead invalidates queryKeys.leads.all on settle, success and failure alike", "board-write-surface scans delete-copy.ts and LeadDeleteDialog.tsx and stays green; no BOARD-WRITE-FENCE region and no file owned by slice 04 changes", "pnpm run lint, pnpm run type-check and the full apps/web vitest suite pass"]
---

# 03 Web delete UI (card menu, Lista action, form button, one confirmation)

## Status of this plan

The whole slice was PROTOTYPED by the planner in an isolated copy of `apps/web` (never in the shared worktree) against HEAD `1501b03`.
With the patch in Appendix A applied: the 23 new oracle tests, the 340 tests under `src/sales-ops/leads` and `src/lib`, `tsc --noEmit` and `eslint src/` are green.
The full apps/web suite was green except two tests that read files outside `apps/web` (`combobox-adoption` reads the root `CLAUDE.md`, `no-hand-built-prompt` reads `apps/api/src`), which only fail in an isolated copy and pass in the worktree.
A throwaway Vite harness (Chrome, 300px columns, the company name `CENTRAIS DE ABASTECIMENTO DO ESP SANTO`) confirmed the card layout, the menu, right-click, the confirmation, the inline 409 copy, Escape over the edit form and the focus return.
A mutation spot-check of 20 mutants (every guard, the 204 fix, the key prefix, the revert, the sweep, the densify, the 404 rule, the edit-only rule, the focus return) was killed by the oracle.

The executor applies Appendix A, runs the gates, and does not redesign anything.
The sections below explain every decision so Verify can judge the code against intent.

## Seam (from SEAM-CONTRACT.md, used verbatim)

- `apps/web/src/sales-ops/leads/api.ts`: `deleteLead(token: string, id: string): Promise<void>` (token FIRST, as the contract names it, unlike the token-last `leadsApi` object; documented on the function).
- `apps/web/src/sales-ops/leads/hooks.ts`: `useDeleteLead()`, no arguments, mutation variable = the lead id (`string`).
- `apps/web/src/sales-ops/leads/delete-copy.ts`: `LEAD_DELETE_COPY` with exactly the contract keys and strings.
- `apps/web/src/sales-ops/leads/LeadDeleteDialog.tsx`: the ONE confirmation (`alert-dialog`).
- DOM hooks: `data-lead-menu` (kebab), `data-delete-lead` (menu item AND Lista row button; the two views never coexist), `data-delete-lead-form` (form button), `data-confirm-delete` (confirm button).
- API (slice 01 plan): `POST /leads/:id/delete` answers `204` via `c.body(null, 204)`, `404 {error:'not_found'}`, `409 {error:'conflict', reason:'lead_already_converted'}`, `403 {error:'forbidden', reason:'seller_person_unmapped'}`.

Additions that are NOT renames of contract names: `LEAD_DELETE_ERROR_COPY` and `leadDeleteErrorCopy(error)` in `delete-copy.ts` (the contract defines no error copy), `optimisticLeadRemoval` in `optimistic.ts`, and five class constants in `board-ui.ts`.

## Decisions (and why)

### D1. A blocking bug in `apiFetch`: a 204 is not JSON

`apiFetch` (`apps/web/src/lib/api-client.ts`) calls `res.json()` on every OK response.
A `204` has no body, so `res.json()` rejects with a SyntaxError and every successful delete would read as a failure: the hook would roll the card back and the dialog would show an error.
The fix is one guard before the parse: `if (res.status === 204) return undefined as T;`.
It also fixes a latent bug: `finderLinksApi.revoke` already hits a `204` route (`apps/api/src/domains/links/routes.ts`) and has been rejecting on success.
Oracle: `api-client-no-content.test.ts`, and end to end `lead-delete.test.tsx`, whose fake 204 throws from `json()` exactly like a browser.

### D2. The menu is the shadcn `DropdownMenu` (Radix), controlled by the card

`LeadCard` gets an optional `onDelete?: (lead) => void` prop.
When it is present and the card is not converted (`leadIsConverted`), the card renders an internal `LeadCardMenu`: a `DropdownMenu` (default modal, like the propostas table row menu in `SalesOpsApp.tsx`) whose `DropdownMenuTrigger` is the kebab and whose one `DropdownMenuItem` is `Excluir`.
Its `open` state lives in the card (`menuOpen`), so the card's `onContextMenu` can open the SAME menu: right-click calls `preventDefault()` and `setMenuOpen(true)`, and Radix anchors the menu at the kebab.
A converted card (or a card without `onDelete`) renders no menu and leaves right-click to the browser.
The item only ASKS (`onSelect={() => onDelete(lead)}`); the confirmation and the mutation belong to the container.

### D3. A guard on the card, not `stopPropagation` on the trigger

The brief suggested `stopPropagation` on the trigger's pointerdown.
The plan uses a guard instead, `startsOnCardMenu(event)` in `LeadCard.tsx`, checked first in `handlePointerDown` and `handleClick`.
It returns true when the event target is not inside the card's DOM (an event bubbling through React's tree from the PORTALLED menu) or is inside `[data-lead-menu]`.
`handlePointerDown` is the only door into dnd-kit (it overrides the spread `listeners.onPointerDown` and calls it itself), so a guarded pointerdown never activates a drag and never records the 6px pointer start; the 6px drag-vs-click guard is untouched.
Why not `stopPropagation`: React's `stopPropagation` also stops the native event at the root container, so the document-level pointerdown listener another open Radix menu uses to dismiss itself would never hear it.
`stopPropagation` would also NOT stop the trigger's click from reaching the card's `onClick` unless repeated for click and for every event of the portalled menu.

### D4. The kebab is always visible, in a quiet grey

The brief asked for "visually quiet until hover/focus".
Measured in Chrome: an `opacity-0` kebab leaves its 28px slot empty, so the card value sits 22px away from the right edge for no visible reason (it reads as a misalignment against the days badge and the converted cards), and a touch device has no hover to reveal it.
So the glyph is always rendered, light grey (`text-[#b4b4bb]`), darker while the card is hovered (`group-hover/card:text-[#6a6a72]`), chip-backed while hovered or open (`hover:bg-[#f2f2f4]`, `data-[state=open]:bg-[#f2f2f4] data-[state=open]:text-[#201f24]`), with the amber focus ring of the board (`focus-visible:ring-2 focus-visible:ring-[#eaa81a]`).
It is a constant slot, so nothing reflows on hover or open.
`-mr-1.5 -mt-1` on the 28px button (`h-7 w-7`, the board's `iconButtonClass` size) tuck the 16px glyph into the card's 12px corner padding and centre it on the 20px first line; in Chrome the dots end flush with the days badge below.
The named group `group/card` (on the `article`) is used instead of a bare `group`, so no ancestor `group` can light every kebab at once.
Placement: full edition, after the value inside a new `flex shrink-0 items-start gap-0.5` wrapper (without a menu the wrapper renders exactly today's value); leads edition, as a sibling of the name block, which becomes `min-w-0 flex-1` inside a new `flex items-start justify-between gap-2` row.
Long two-line or three-line company names wrap inside `min-w-0` and never overlap the value or the kebab (verified at 300px).
The trigger carries `title="Ações do lead"` so hovering it does not show the card tooltip `Clique para editar · arraste para mover`.
The `DragOverlay` copy also gets `onDelete`, so the lifted card keeps the kebab slot and is a pixel clone of the card it lifts.

### D5. ONE `LeadDeleteDialog`, owned by the container

`LeadsBoardContainer` holds `deleteTarget: SalesOpsLead | null` and `editingLead: SalesOpsLead | null`.
The board gets `onDeleteLead={setDeleteTarget}`; the forms get `onDelete={requestDeleteFromForm}`, which is `undefined` while creating and for a converted lead (`leadIsConverted(editingLead)`).
The dialog is mounted only while there is a target, keyed by `` `delete:${deleteTarget.id}` ``.
The `delete:` prefix is LOAD-BEARING: the edit form beside it in the same fragment is keyed by the same lead id, and the prototype showed that two siblings sharing a key make React keep a stale edit form mounted after a confirmed delete (oracle: the two "a confirmed delete closes the form" tests).
`confirmDelete(lead)` awaits `deleteLead.mutateAsync(lead.id)` and then closes the form when it is editing that lead (the edit dialog is modal, so a delete confirmed while it is open came from it).
The dialog itself awaits `onConfirm`: resolve closes it, reject keeps it open with `leadDeleteErrorCopy(error)` inline (`role="alert"`, `blockedNoticeClass`), the same pattern as `ContactLeadDialog`'s save.
The confirm is a plain `<button>`, never `AlertDialogAction`, because the Radix action closes on click before the answer exists.
While busy: the confirm reads `Excluindo…`, both buttons are disabled and `onOpenChange(false)` is ignored (Escape and Cancelar wait).

### D6. No `useInlineLayer`; Escape is Radix's layer stack

The confirmation is a Radix `AlertDialog`, a `DismissableLayer` in the same stack as the edit `Dialog` (one `@radix-ui/react-dismissable-layer@1.1.14` in the lockfile), so Escape dismisses only the top layer.
`useInlineLayer` exists for NON-Radix inline panels (`Combobox`, `InfoHint`) and must not be called here.
The oracle drives the real container with the real `Dialog` and `AlertDialog`: Escape on the confirmation closes it, the form stays, and a second Escape closes the form (the positive control).

### D7. Focus return

Radix returns focus to an `AlertDialogTrigger`, and this dialog has none, so focus fell to `<body>` even with the edit form still open (measured in Chrome).
`LeadDeleteDialog` captures `document.activeElement` at mount and passes `onCloseAutoFocus={returnFocus}`: focus goes back to that element when it is still connected (the form's `Excluir lead`, the Lista's `Excluir`), else to `[data-lead-menu="<id>"]` (the menu item that opened it is gone by then), else Radix's default.
Verified in Chrome for the form path and the card path; the oracle pins the form path.

### D8. `useDeleteLead`: sweep every board entry, exact revert, 404 is success

The hook follows `useMoveLead`'s shape with two deliberate differences.
It sweeps EVERY cached board entry (`getQueriesData` on the prefix `['leads','board']`, derived from `queryKeys.leads.board(undefined).slice(0, 2)`, never hand-typed and with no change to `query-keys.ts`, which slice 04 edits).
Removing a card can never make it appear twice (the hazard that keeps the move patch on one key), and a lead deleted under one vendedor filter must not survive in the unfiltered board.
The patch is the new pure `optimisticLeadRemoval(previous, leadId)` in `optimistic.ts`: it drops the row from every page and re-densifies its column with the existing private `densify` (an unknown id returns the identical snapshot, so untouched boards are skipped).
`onMutate` first `cancelQueries({ queryKey: queryKeys.leads.all })`; `onError` writes each patched entry's own snapshot back; `invalidates: [queryKeys.leads.all]` re-syncs on settle (board, stages, and slice 04's `['leads','deleted']` trash list).
The context is `{ boards: Array<{ key: QueryKey; previous: LeadsInfiniteData }> }`, one entry per patched board (slice 05 extends it with summary snapshots).
A `404` is caught in `mutationFn` and resolves: the lead is already gone (deleted elsewhere, or out of this viewer's scope), which is what the operator asked for, so the card stays removed and nothing scary shows.

### D9. Error copy

`leadDeleteErrorCopy(error)` maps `status 409` with `reason 'lead_already_converted'` to `LEAD_DELETE_ERROR_COPY.converted` (`Este lead já virou proposta e não pode ser excluído.`) and hands everything else to the existing `salesOpsMutationErrorMessage` (403 keyed on the status, generic otherwise).
It is structural (no import of `@/lib/api-client`), because `delete-copy.ts` joins the board-write-surface scan.
A 404 never reaches it (D8).
On a 409 the card comes back (revert) and the settle-time refetch shows it converted, with no kebab.

### D10. Styles (all in `board-ui.ts`, in the file's palette; the red is `KIND_COLORS.lost`)

- `dangerButtonClass` (confirm): `inline-flex items-center justify-center rounded-[10px] bg-[#c2413b] px-4 py-2 text-sm font-semibold text-white transition hover:bg-[#a5341c] disabled:cursor-not-allowed disabled:opacity-60`.
- `dangerOutlineButtonClass` (form `Excluir lead`, with `sm:mr-auto` at the call site and a 15px `Trash2`): `inline-flex items-center justify-center gap-1.5 rounded-[10px] border border-[#f2d6d4] bg-white px-4 py-2 text-sm font-semibold text-[#9b2f2a] transition hover:border-[#c2413b] hover:bg-[#fcf1f0] disabled:cursor-not-allowed disabled:opacity-60`.
- `leadMenuTriggerClass` (kebab): `-mr-1.5 -mt-1 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-[#b4b4bb] outline-none transition-colors hover:bg-[#f2f2f4] focus-visible:ring-2 focus-visible:ring-[#eaa81a] group-hover/card:text-[#6a6a72] data-[state=open]:bg-[#f2f2f4] data-[state=open]:text-[#201f24]`, glyph `MoreHorizontal` `h-4 w-4` (the icon the propostas row menu uses).
- `leadMenuContentClass`: `w-[180px] rounded-xl border-[#e5e5ea] bg-white p-1.5` (the propostas row menu surface, narrower).
- `leadMenuDeleteItemClass`: `cursor-pointer text-[13px] font-semibold text-[#9b2f2a] focus:bg-[#fcf1f0] focus:text-[#9b2f2a]`, with a `Trash2` icon (sized by the item's own `[&_svg]:size-4`).
- `listDangerActionButtonClass` (Lista `Excluir`, last in the actions cell after `Mover` and `Editar`): `listActionButtonClass` geometry with `text-[#9b2f2a]` and `hover:border-[#c2413b] hover:bg-[#fcf1f0]`.
- Both form footers become `<DialogFooter className="gap-2 sm:gap-0">` so the three stacked buttons get a gap on a phone (the existing footer had none); the confirmation keeps the default `AlertDialog` look of the app's other confirmations (`VendedoresView`, `LeadStagesView`, propostas).

## Step by step (what Appendix A does, file by file)

1. `apps/web/src/lib/api-client.ts`: the 204 guard (D1).
2. `apps/web/src/sales-ops/leads/api.ts`: export `deleteLead(token, id)` (`POST ${LEADS_PATH}/${id}/delete`, no body) and extend the file's "no DELETE verb" comment to name the lixeira action.
3. `apps/web/src/sales-ops/leads/optimistic.ts`: export `optimisticLeadRemoval` (D8); the `leadId` doc of `OptimisticLeadPatch` mentions a removal.
4. `apps/web/src/sales-ops/leads/hooks.ts`: import `QueryKey`, `deleteLead`, `optimisticLeadRemoval`; add `LEAD_BOARDS_PREFIX`, `LeadRemovalSnapshot`, `isNotFound`, and `useDeleteLead` between `useMoveLead` and `useSaveLeadStage` (D8).
5. `apps/web/src/sales-ops/leads/delete-copy.ts` (new): `LEAD_DELETE_COPY`, `LEAD_DELETE_ERROR_COPY`, `leadDeleteErrorCopy` (D9).
6. `apps/web/src/sales-ops/leads/LeadDeleteDialog.tsx` (new): D5, D6, D7.
7. `apps/web/src/sales-ops/leads/board-ui.ts`: the five constants of D10, inserted before `mutedStateClass`.
8. `apps/web/src/sales-ops/leads/LeadCard.tsx`: D2, D3, D4 (`onDelete` prop, `startsOnCardMenu`, `LeadCardMenu`, `menuOpen`, `handleContextMenu`, `group/card`, the two top-row layouts, doc comment).
9. `apps/web/src/sales-ops/leads/LeadsBoard.tsx`: `onDeleteLead` prop; passed as `onDelete` to the plain `LeadCard`, to `SortableLeadCard` (new `onDelete` in `SortableCardProps`) and to the `DragOverlay` copy; the Lista `Excluir` button `{!converted && onDeleteLead ? (...) : null}` after `Editar`.
10. `apps/web/src/sales-ops/leads/ContactLeadDialog.tsx` and `LeadDialog.tsx`: optional `onDelete?: () => void`; first child of the footer `{initial?.id && onDelete ? <button ... data-delete-lead-form=""> : null}` (ContactLeadDialog also disables it while `submitting`).
11. `apps/web/src/sales-ops/leads/LeadsBoardContainer.tsx`: D5 wiring (`useDeleteLead`, `editingLead`, `deleteTarget`, `requestDeleteFromForm`, `confirmDelete`, `onDeleteLead`, the keyed dialog last in the fragment); `setEditingLead(null)` on create and `setEditingLead(lead)` on edit.
12. Tests (next section).

## Tests

New `apps/web/src/sales-ops/leads/__tests__/lead-delete.test.tsx` (happy-dom, 23 tests).
The first half renders `LeadCard` alone with a spy as `dragHandleProps.onPointerDown`; the second drives the REAL `LeadsBoardContainer`, hooks, board, `Dialog`, `AlertDialog`, `DropdownMenu` and `apiFetch` against a stubbed global `fetch` router (only `@/auth/react` is mocked), because the claims are about requests and the cache.
Radix opens a menu on a primary-button `pointerdown`, so the helper `press()` dispatches `pointerdown` then `click`.

- the card menu, structurally: kebab present, a `<button>`, tab-reachable and named on a non-converted card; absent on a converted card (zero buttons) and without `onDelete`; present on the contact-edition card; a kebab pointerdown never reaches the drag spy while a card-body pointerdown does; clicking the kebab opens the menu and never edits; right-click opens the same menu with `defaultPrevented` and never edits; right-click on a converted card is left to the browser; `Excluir` calls `onDelete` with the lead, never edits, never reaches the drag spy and closes the menu; a plain card click still edits.
- deleting from the Quadro card menu: confirm names the lead, one `POST /api/v1/sales-ops/leads/<id>/delete` with `body: null` and `Bearer hub-access-token`, card gone, dialog closed, `window.confirm` never called; `Cancelar` changes nothing; a gated 500 removes the card from the rendered board AND from a second, filtered board entry (column re-densified), shows `Excluindo…` disabled, then restores the filtered entry `toEqual` its snapshot, the card returns and the generic copy shows; Escape cannot close while on the wire, and the 204 then closes it; 409 brings the card back with the converted copy; 404 keeps it removed with no error; the leads edition with a non-admin seller works the same.
- deleting from the Lista: `Excluir` beside `Mover` and `Editar` on an open row only, same confirmation, row gone.
- deleting from the edit form: for each edition, no button on create, button on edit, confirmed delete closes confirmation and form; both forms render the button in edit mode only even when handed `onDelete`; a converted lead opened from the Lista `Editar` gets no button; a refused delete keeps the form open behind the confirmation; Escape on the confirmation closes only it, focus returns to `Excluir lead` (focused first, like a keyboard operator), second Escape closes the form.
- `leadDeleteErrorCopy`: 409 converted, 409 other reason, 403, plain Error.

New `apps/web/src/lib/__tests__/api-client-no-content.test.ts`: a 204 resolves `undefined` without calling `json()`; a 200 still parses.

Updated existing tests:

- `leads-api-contract.test.ts`: `deleteLead posts the lixeira action with no body and the token it was given` (path, `POST`, token, `body` undefined).
- `leads-contact-container.test.tsx`: its `vi.mock('../hooks')` factory gains `useDeleteLead: () => ({ mutateAsync: vi.fn(), isPending: false })`; without it all 17 tests crash on `useDeleteLead is not a function`.
- `board-write-surface.test.ts`: `OWNED_FILES` gains `delete-copy.ts` and `LeadDeleteDialog.tsx` (the delete UI obeys the same bans); the size assertion derives from the list, so nothing else changes.

Existing tests that stay green UNCHANGED and are part of the oracle: `leads-board-keyboard` (its converted card still has zero buttons; boards rendered without `onDeleteLead` render no kebab), `leads-board-dropzones`, `lead-card-days-parked`, `leads-list-view`, `contact-lead-dialog`, `lead-dialog`, `leads-move-rollback`, `move-dialog-inline-layer`, `lead-conversion` (renders the real container, so real kebabs now appear on its cards; its text-based button lookups are unaffected because the kebab has no text), `leads-contact-board`, `leads-full-edition`, `lead-unassigned-marker`.

## Commands (run from the worktree root; verified)

```bash
# apply the reference patch (Appendix A)
sed -n '/^```diff slice-03-patch$/,/^```$/p' nexo/plans/lead-lixeira/03-web-delete-ui.md | sed '1d;$d' > /tmp/slice-03.patch
git apply --3way /tmp/slice-03.patch

# slice oracle (paths are relative to apps/web)
CI=true pnpm --filter @fxl-sales/web exec vitest run \
  src/sales-ops/leads/__tests__/lead-delete.test.tsx \
  src/lib/__tests__/api-client-no-content.test.ts \
  src/sales-ops/leads/__tests__/leads-api-contract.test.ts \
  src/sales-ops/leads/__tests__/board-write-surface.test.ts \
  src/sales-ops/leads/__tests__/leads-contact-container.test.tsx \
  src/sales-ops/leads/__tests__/leads-board-keyboard.test.tsx \
  src/sales-ops/leads/__tests__/leads-board-dropzones.test.tsx \
  src/sales-ops/leads/__tests__/lead-card-days-parked.test.tsx \
  src/sales-ops/leads/__tests__/leads-list-view.test.tsx \
  src/sales-ops/leads/__tests__/contact-lead-dialog.test.tsx \
  src/sales-ops/leads/__tests__/lead-dialog.test.tsx \
  src/sales-ops/leads/__tests__/leads-move-rollback.test.ts \
  src/sales-ops/leads/__tests__/move-dialog-inline-layer.test.tsx \
  src/sales-ops/leads/__tests__/lead-conversion.test.tsx \
  src/sales-ops/leads/__tests__/leads-contact-board.test.tsx \
  src/sales-ops/leads/__tests__/leads-full-edition.test.tsx \
  src/sales-ops/leads/__tests__/lead-unassigned-marker.test.tsx

# changed-file lint, then the wave gates
pnpm --filter @fxl-sales/web exec eslint src/lib src/sales-ops/leads
pnpm --filter @fxl-sales/web run type-check
CI=true pnpm --filter @fxl-sales/web test
```

If `git apply --3way` reports a conflict, the base moved under one of the listed files: re-apply that file's hunks by hand from Appendix A, keeping the other change, and never drop a hunk.

## Optional real-browser check (recommended by the user's UI standard)

The planner did this once; the executor repeats it only if the patch had to be adapted.
In `apps/web`, add a throwaway `repro.html` plus `src/repro-main.tsx` that imports `./index.css` and renders `LeadsBoard` (with `onDeleteLead`, `onEditLead`), a `ContactLeadDialog` on edit and a `LeadDeleteDialog`, with three leads (one with the long company name, one unassigned, one converted).
Run `pnpm exec vite --port 8799 --strictPort` in the background, record its PID, check hover, click, right-click, confirm, 409 copy, Escape over the form and focus return, then kill that exact PID and delete both files.

## Do not touch

- `apps/web/src/sales-ops/SalesOpsApp.tsx` (slice 04, and the BOARD-WRITE-FENCE regions), `navigation.ts`, `deleted-leads.ts`, `DeletedLeadsView.tsx`, `DeletedLeadsContainer.tsx`, `apps/web/src/lib/query-keys.ts` (slice 04 adds `queryKeys.leads.deleted()` there).
- Anything under `apps/api`.
- `CLAUDE.md` and `nexo/knowledge/` (capture, AC12; see below).

## Notes for capture (AC12) and for slice 05

- `CLAUDE.md` "Kanban de leads" says "in the Quadro a card has no buttons"; capture rewrites it to: a non-converted card has exactly one control, the kebab of its `Excluir` menu (also opened by right-click), kept out of the drag and edit paths by `startsOnCardMenu`; deletion goes through the ONE `LeadDeleteDialog` owned by `LeadsBoardContainer` (keyed `delete:<id>`); `useDeleteLead` sweeps every board entry, treats 404 as success and invalidates `queryKeys.leads.all`; `apiFetch` returns `undefined` on 204.
- Slice 05 extends `useDeleteLead` (its plan step 6c): the context is `{ boards: Array<{ key, previous }> }` with only the patched boards, `onMutate` already cancels `queryKeys.leads.all`, and `invalidates` is already `[queryKeys.leads.all]`.
- Server positions after a delete are `1..N` (slice 01); the client's `densify` writes `0..n-1`, exactly like the existing move patch: only relative order is read, and the settle refetch brings the server's integers.

## Appendix A - reference patch (verified against HEAD 1501b03; applies cleanly)

```diff slice-03-patch
diff --git a/apps/web/src/lib/__tests__/api-client-no-content.test.ts b/apps/web/src/lib/__tests__/api-client-no-content.test.ts
new file mode 100644
index 0000000..f958204
--- /dev/null
+++ b/apps/web/src/lib/__tests__/api-client-no-content.test.ts
@@ -0,0 +1,48 @@
+import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
+import { apiFetch } from '../api-client';
+
+/**
+ * A `204 No Content` carries no body, so `res.json()` rejects. `apiFetch` used to
+ * call it unconditionally, which turned every successful 204 write (the lead
+ * lixeira `POST /leads/:id/delete`, the finder link revoke) into a failure the
+ * caller would roll back.
+ */
+
+let fetchMock: ReturnType<typeof vi.fn>;
+
+beforeEach(() => {
+  fetchMock = vi.fn();
+  vi.stubGlobal('fetch', fetchMock);
+});
+
+afterEach(() => {
+  vi.unstubAllGlobals();
+  vi.clearAllMocks();
+});
+
+describe('apiFetch on 204 No Content', () => {
+  it('resolves undefined without reading a body', async () => {
+    const json = vi.fn(async () => {
+      throw new SyntaxError('Unexpected end of JSON input');
+    });
+    fetchMock.mockResolvedValue({ ok: true, status: 204, headers: new Headers(), json });
+
+    await expect(
+      apiFetch<void>('/api/v1/sales-ops/leads/L1/delete', { method: 'POST', token: 'abc' }),
+    ).resolves.toBeUndefined();
+    expect(json).not.toHaveBeenCalled();
+  });
+
+  it('still parses the body of a 200', async () => {
+    fetchMock.mockResolvedValue({
+      ok: true,
+      status: 200,
+      headers: new Headers(),
+      json: async () => ({ lead: { id: 'L1' } }),
+    });
+
+    await expect(
+      apiFetch<{ lead: { id: string } }>('/api/v1/sales-ops/leads/L1', { method: 'GET', token: 'abc' }),
+    ).resolves.toEqual({ lead: { id: 'L1' } });
+  });
+});
diff --git a/apps/web/src/lib/api-client.ts b/apps/web/src/lib/api-client.ts
index 4515974..79ddc69 100644
--- a/apps/web/src/lib/api-client.ts
+++ b/apps/web/src/lib/api-client.ts
@@ -88,6 +88,11 @@ export async function apiFetch<T>(
     throw err;
   }
 
+  // A `204 No Content` has no body to parse: `res.json()` would reject with a
+  // SyntaxError and turn a successful write into a failure. Callers of a 204
+  // route type the result `void`.
+  if (res.status === 204) return undefined as T;
+
   return res.json() as Promise<T>;
 }
 
diff --git a/apps/web/src/sales-ops/leads/ContactLeadDialog.tsx b/apps/web/src/sales-ops/leads/ContactLeadDialog.tsx
index 209c664..d68b5b7 100644
--- a/apps/web/src/sales-ops/leads/ContactLeadDialog.tsx
+++ b/apps/web/src/sales-ops/leads/ContactLeadDialog.tsx
@@ -1,4 +1,5 @@
 import * as React from 'react';
+import { Trash2 } from 'lucide-react';
 import { todayInSaoPaulo } from '@fxl-sales/shared-utils/sao-paulo-day';
 import { Combobox, type ComboboxOption } from '@/components/ui/combobox';
 import {
@@ -13,6 +14,7 @@ import { Input } from '@/components/ui/input';
 import type { SaveContactLeadPayload } from './api';
 import {
   blockedNoticeClass,
+  dangerOutlineButtonClass,
   fieldLabelClass,
   formInputClass,
   formSelectClass,
@@ -28,6 +30,7 @@ import {
   validateContactLeadDraft,
   type ContactLeadDraft,
 } from './contact-lead';
+import { LEAD_DELETE_COPY } from './delete-copy';
 
 /**
  * Create / edit a lead in the leads edition. PURELY presentational: props in,
@@ -70,6 +73,12 @@ export type ContactLeadDialogProps = {
   pending?: boolean;
   /** Injected for tests; defaults to todayInSaoPaulo() read once at mount. */
   today?: string;
+  /**
+   * Asks for this lead's delete confirmation (the container's shared
+   * `LeadDeleteDialog`). Rendered only when editing (`initial.id`); the container
+   * withholds it for a converted lead.
+   */
+  onDelete?: () => void;
 };
 
 function blockedFieldOf(message: string | null): keyof ContactLeadDraft | null {
@@ -95,6 +104,7 @@ export function ContactLeadDialog({
   onSubmit,
   pending = false,
   today,
+  onDelete,
 }: ContactLeadDialogProps) {
   const [draft, setDraft] = React.useState<ContactLeadDraft>(() => contactDraftFromSeed(initial));
   const [todayDay] = React.useState(() => today ?? todayInSaoPaulo());
@@ -307,7 +317,19 @@ export function ContactLeadDialog({
           ) : null}
         </div>
 
-        <DialogFooter>
+        <DialogFooter className="gap-2 sm:gap-0">
+          {initial?.id && onDelete ? (
+            <button
+              className={`${dangerOutlineButtonClass} sm:mr-auto`}
+              data-delete-lead-form=""
+              disabled={submitting}
+              onClick={onDelete}
+              type="button"
+            >
+              <Trash2 aria-hidden className="h-[15px] w-[15px]" />
+              {LEAD_DELETE_COPY.formButton}
+            </button>
+          ) : null}
           <button
             className={secondaryButtonClass}
             onClick={() => onOpenChange(false)}
diff --git a/apps/web/src/sales-ops/leads/LeadCard.tsx b/apps/web/src/sales-ops/leads/LeadCard.tsx
index 2abf80f..1b74c57 100644
--- a/apps/web/src/sales-ops/leads/LeadCard.tsx
+++ b/apps/web/src/sales-ops/leads/LeadCard.tsx
@@ -1,5 +1,12 @@
 import * as React from 'react';
+import { MoreHorizontal, Trash2 } from 'lucide-react';
 import type { LeadFieldSet } from '@fxl-sales/shared-utils/sales-edition';
+import {
+  DropdownMenu,
+  DropdownMenuContent,
+  DropdownMenuItem,
+  DropdownMenuTrigger,
+} from '@/components/ui/dropdown-menu';
 import { formatMoneyBrl } from '../calculations';
 import {
   CARD_TOOLTIP,
@@ -21,11 +28,15 @@ import {
   avatarClass,
   dayBadgeTone,
   avatarInitials,
+  leadMenuContentClass,
+  leadMenuDeleteItemClass,
+  leadMenuTriggerClass,
   readOnlyCardClass,
   unassignedMarkerClass,
 } from './board-ui';
 import { daysInCurrentStage, leadIsConverted, leadIsUnassigned } from './calculations';
 import { CONTACT_LEAD_COPY, leadBirthdayLabel, leadContactLine } from './contact-lead';
+import { LEAD_DELETE_COPY } from './delete-copy';
 import type { SalesOpsLead } from './types';
 
 /**
@@ -39,6 +50,11 @@ import type { SalesOpsLead } from './types';
  * the end of a drag is handled by a pointer-distance guard: a click whose
  * pointerdown-to-click movement exceeds the PointerSensor activation distance
  * is a drag, not a click.
+ *
+ * A non-converted card handed `onDelete` carries ONE control of its own: the
+ * kebab of its `Excluir` menu (lixeira), also opened by a right-click on the
+ * card. `startsOnCardMenu` keeps that menu out of both the drag and the edit
+ * paths. Its open state is the only state the card holds.
  */
 
 const MAX_PRODUCT_CHIPS = 3;
@@ -63,6 +79,12 @@ export type LeadCardProps = {
   showDaysBadge?: boolean;
   /** 'contact' in the leads edition: contact data instead of empresa, valor and produtos. */
   fieldSet?: LeadFieldSet;
+  /**
+   * Asks for this lead's delete confirmation. Present means a non-converted card
+   * renders its kebab menu (and answers a right-click with it); absent, or a
+   * converted card, renders neither.
+   */
+  onDelete?: (lead: SalesOpsLead) => void;
 };
 
 /**
@@ -78,6 +100,62 @@ export function UnassignedLeadMarker() {
   );
 }
 
+/**
+ * True for an event the card's own surface must ignore: one that started on the
+ * menu trigger, or one bubbling through React's tree from the PORTALLED menu
+ * (its target is not inside the card's DOM at all). Such an event never reaches
+ * the dnd-kit activator and never opens the editor.
+ *
+ * A guard on the card rather than `stopPropagation` on the trigger: a React
+ * `stopPropagation` also stops the NATIVE event at the root, so the document
+ * listener another open Radix menu dismisses itself with would never hear it.
+ */
+function startsOnCardMenu(event: React.SyntheticEvent<HTMLElement>): boolean {
+  const target = event.target;
+  if (!(target instanceof Node) || !event.currentTarget.contains(target)) return true;
+  return target instanceof Element && target.closest('[data-lead-menu]') !== null;
+}
+
+/**
+ * The card's one menu, `Excluir`. Opened by its kebab and, controlled through
+ * `open`, by a right-click anywhere on the card. It only ASKS: `onDelete` opens
+ * the shared `LeadDeleteDialog`, which the container owns.
+ */
+function LeadCardMenu({
+  lead,
+  open,
+  onOpenChange,
+  onDelete,
+}: {
+  lead: SalesOpsLead;
+  open: boolean;
+  onOpenChange: (open: boolean) => void;
+  onDelete: (lead: SalesOpsLead) => void;
+}) {
+  return (
+    <DropdownMenu onOpenChange={onOpenChange} open={open}>
+      <DropdownMenuTrigger
+        aria-label={`${LEAD_DELETE_COPY.menuTrigger}: ${lead.contactName}`}
+        className={leadMenuTriggerClass}
+        data-lead-menu={lead.id}
+        title={LEAD_DELETE_COPY.menuTrigger}
+      >
+        <MoreHorizontal aria-hidden className="h-4 w-4" />
+      </DropdownMenuTrigger>
+      <DropdownMenuContent align="end" className={leadMenuContentClass}>
+        <DropdownMenuItem
+          className={leadMenuDeleteItemClass}
+          data-delete-lead={lead.id}
+          onSelect={() => onDelete(lead)}
+        >
+          <Trash2 aria-hidden />
+          {LEAD_DELETE_COPY.menuLabel}
+        </DropdownMenuItem>
+      </DropdownMenuContent>
+    </DropdownMenu>
+  );
+}
+
 export function LeadCard({
   lead,
   lookups,
@@ -88,6 +166,7 @@ export function LeadCard({
   isDragging = false,
   showDaysBadge = true,
   fieldSet = 'full',
+  onDelete,
 }: LeadCardProps) {
   const contact = fieldSet === 'contact';
   const birthday = contact ? leadBirthdayLabel(lead) : null;
@@ -100,8 +179,15 @@ export function LeadCard({
   const sellerLabel = leadSellerLabel(lead, lookups);
   const unassigned = leadIsUnassigned(lead);
   const pointerDown = React.useRef<{ x: number; y: number } | null>(null);
+  const [menuOpen, setMenuOpen] = React.useState(false);
+  const menu =
+    onDelete && !readOnly ? (
+      <LeadCardMenu lead={lead} onDelete={onDelete} onOpenChange={setMenuOpen} open={menuOpen} />
+    ) : null;
 
   function handlePointerDown(event: React.PointerEvent<HTMLElement>) {
+    // The menu is never a drag handle: no pointer record, no dnd-kit activation.
+    if (startsOnCardMenu(event)) return;
     pointerDown.current = { x: event.clientX, y: event.clientY };
     (dragHandleProps?.onPointerDown as ((e: React.PointerEvent<HTMLElement>) => void) | undefined)?.(
       event,
@@ -109,6 +195,8 @@ export function LeadCard({
   }
 
   function handleClick(event: React.MouseEvent<HTMLElement>) {
+    // Opening the menu, or picking from it, never opens the editor.
+    if (startsOnCardMenu(event)) return;
     const start = pointerDown.current;
     pointerDown.current = null;
     if (start) {
@@ -122,29 +210,43 @@ export function LeadCard({
     onEdit?.(lead);
   }
 
+  /**
+   * Right-click opens the SAME menu, anchored at the kebab. Only where the menu
+   * exists: a converted card keeps the browser's own context menu.
+   */
+  function handleContextMenu(event: React.MouseEvent<HTMLElement>) {
+    if (!menu) return;
+    event.preventDefault();
+    setMenuOpen(true);
+  }
+
   return (
     <article
-      className={`${cardClass} cursor-pointer${isDragging ? ` ${cardDraggingClass}` : ''}${
+      className={`group/card ${cardClass} cursor-pointer${isDragging ? ` ${cardDraggingClass}` : ''}${
         readOnly ? ` ${readOnlyCardClass}` : ''
       }`}
       data-lead-card={lead.id}
       {...(readOnly ? { 'data-read-only-card': 'true' } : {})}
       {...(dragHandleProps ?? {})}
       onClick={handleClick}
+      onContextMenu={handleContextMenu}
       onPointerDown={handlePointerDown}
       title={readOnly ? undefined : CARD_TOOLTIP}
     >
       {contact ? (
-        <div className="flex min-w-0 flex-col gap-0.5">
-          <span className="text-[14px] font-semibold text-[#201f24]">{lead.contactName}</span>
-          <span className="truncate text-[12.5px] text-[#8b8b92]" data-lead-contact>
-            {leadContactLine(lead)}
-          </span>
-          {birthday !== null ? (
-            <span className="text-[12px] text-[#8b8b92]" data-lead-birthday>
-              {`${CONTACT_LEAD_COPY.birthdayPrefix} ${birthday}`}
+        <div className="flex items-start justify-between gap-2">
+          <div className="flex min-w-0 flex-1 flex-col gap-0.5">
+            <span className="text-[14px] font-semibold text-[#201f24]">{lead.contactName}</span>
+            <span className="truncate text-[12.5px] text-[#8b8b92]" data-lead-contact>
+              {leadContactLine(lead)}
             </span>
-          ) : null}
+            {birthday !== null ? (
+              <span className="text-[12px] text-[#8b8b92]" data-lead-birthday>
+                {`${CONTACT_LEAD_COPY.birthdayPrefix} ${birthday}`}
+              </span>
+            ) : null}
+          </div>
+          {menu}
         </div>
       ) : (
         <div className="flex items-start justify-between gap-2">
@@ -152,12 +254,15 @@ export function LeadCard({
             <span className="text-[14px] font-semibold text-[#201f24]">{lead.contactName}</span>
             <span className="text-[12.5px] text-[#8b8b92]">{leadCompanyLabel(lead, lookups)}</span>
           </div>
-          <span className="sales-ops-num shrink-0 text-[14px] font-bold text-[#201f24]">
-            {formatMoneyBrl(lead.estimatedValueBrl, {
-              minimumFractionDigits: 0,
-              maximumFractionDigits: 0,
-            })}
-          </span>
+          <div className="flex shrink-0 items-start gap-0.5">
+            <span className="sales-ops-num shrink-0 text-[14px] font-bold text-[#201f24]">
+              {formatMoneyBrl(lead.estimatedValueBrl, {
+                minimumFractionDigits: 0,
+                maximumFractionDigits: 0,
+              })}
+            </span>
+            {menu}
+          </div>
         </div>
       )}
 
diff --git a/apps/web/src/sales-ops/leads/LeadDeleteDialog.tsx b/apps/web/src/sales-ops/leads/LeadDeleteDialog.tsx
new file mode 100644
index 0000000..cee2c46
--- /dev/null
+++ b/apps/web/src/sales-ops/leads/LeadDeleteDialog.tsx
@@ -0,0 +1,118 @@
+import * as React from 'react';
+import {
+  AlertDialog,
+  AlertDialogCancel,
+  AlertDialogContent,
+  AlertDialogDescription,
+  AlertDialogFooter,
+  AlertDialogHeader,
+  AlertDialogTitle,
+} from '@/components/ui/alert-dialog';
+import { blockedNoticeClass, dangerButtonClass, secondaryButtonClass } from './board-ui';
+import { LEAD_DELETE_COPY, leadDeleteErrorCopy } from './delete-copy';
+import type { SalesOpsLead } from './types';
+
+/**
+ * THE one confirmation for deleting a lead, shared by the card menu, the Lista
+ * action and both edit forms. PURELY presentational: it names the lead and
+ * awaits `onConfirm`. Resolve closes it; a rejection keeps it open with the
+ * mapped error inline, exactly like `ContactLeadDialog`'s save.
+ *
+ * The confirm button is a plain button and NOT `AlertDialogAction`, because the
+ * Radix action closes the dialog on click, before the answer is known.
+ *
+ * It needs no `useInlineLayer`: it is a Radix layer itself, so when it opens over
+ * an edit `Dialog` Radix's own layer stack hands Escape to it alone (oracle:
+ * `lead-delete.test.tsx`).
+ *
+ * Mount-scoped (the caller keys it by the lead id), so the error and the pending
+ * state never leak from one lead to the next.
+ */
+
+export type LeadDeleteDialogProps = {
+  open: boolean;
+  onOpenChange: (open: boolean) => void;
+  lead: SalesOpsLead;
+  /** Awaited: resolve closes the dialog, reject keeps it open with an inline error. */
+  onConfirm: (lead: SalesOpsLead) => Promise<unknown>;
+};
+
+export function LeadDeleteDialog({ open, onOpenChange, lead, onConfirm }: LeadDeleteDialogProps) {
+  const [busy, setBusy] = React.useState(false);
+  const [error, setError] = React.useState<string | null>(null);
+  /*
+    Where focus goes back to on close. Radix returns it to an `AlertDialogTrigger`
+    and this dialog has none (a menu, a row or a form opens it), so without this
+    focus fell to <body>, even with the edit form still open underneath. The
+    element focused at mount when it is still in the page (the form's `Excluir
+    lead`, the Lista's `Excluir`), else this lead's kebab (the menu item that
+    opened it is gone by then), else Radix's own default.
+  */
+  const [opener] = React.useState(() =>
+    document.activeElement instanceof HTMLElement ? document.activeElement : null,
+  );
+
+  function returnFocus(event: Event) {
+    const target = opener?.isConnected
+      ? opener
+      : document.querySelector<HTMLElement>(`[data-lead-menu="${lead.id}"]`);
+    if (!target) return;
+    event.preventDefault();
+    target.focus();
+  }
+
+  async function confirm() {
+    if (busy) return;
+    setBusy(true);
+    setError(null);
+    try {
+      await onConfirm(lead);
+    } catch (failure: unknown) {
+      setError(leadDeleteErrorCopy(failure));
+      setBusy(false);
+      return;
+    }
+    setBusy(false);
+    onOpenChange(false);
+  }
+
+  return (
+    <AlertDialog
+      onOpenChange={(next) => {
+        // Escape and Cancelar wait for the answer: closing mid-request would hide
+        // the outcome of a delete that is already on the wire.
+        if (!next && busy) return;
+        onOpenChange(next);
+      }}
+      open={open}
+    >
+      <AlertDialogContent data-lead-delete-dialog="" onCloseAutoFocus={returnFocus}>
+        <AlertDialogHeader>
+          <AlertDialogTitle>{LEAD_DELETE_COPY.dialogTitle}</AlertDialogTitle>
+          <AlertDialogDescription>{LEAD_DELETE_COPY.dialogBody(lead.contactName)}</AlertDialogDescription>
+        </AlertDialogHeader>
+        {error !== null ? (
+          <p className={blockedNoticeClass} data-lead-delete-error="" role="alert">
+            {error}
+          </p>
+        ) : null}
+        <AlertDialogFooter>
+          <AlertDialogCancel className={secondaryButtonClass} disabled={busy}>
+            {LEAD_DELETE_COPY.cancel}
+          </AlertDialogCancel>
+          <button
+            className={dangerButtonClass}
+            data-confirm-delete=""
+            disabled={busy}
+            onClick={() => {
+              void confirm();
+            }}
+            type="button"
+          >
+            {busy ? LEAD_DELETE_COPY.pending : LEAD_DELETE_COPY.confirm}
+          </button>
+        </AlertDialogFooter>
+      </AlertDialogContent>
+    </AlertDialog>
+  );
+}
diff --git a/apps/web/src/sales-ops/leads/LeadDialog.tsx b/apps/web/src/sales-ops/leads/LeadDialog.tsx
index 922e358..c292970 100644
--- a/apps/web/src/sales-ops/leads/LeadDialog.tsx
+++ b/apps/web/src/sales-ops/leads/LeadDialog.tsx
@@ -1,4 +1,5 @@
 import * as React from 'react';
+import { Trash2 } from 'lucide-react';
 import { Combobox, type ComboboxOption } from '@/components/ui/combobox';
 import {
   Dialog,
@@ -13,6 +14,7 @@ import { parseCurrencyInputToCents } from '../calculations';
 import type { SaveLeadPayload, SaveLeadProductPayload } from './api';
 import {
   blockedNoticeClass,
+  dangerOutlineButtonClass,
   fieldLabelClass,
   formInputClass,
   formSelectClass,
@@ -20,6 +22,7 @@ import {
   primaryButtonClass,
   secondaryButtonClass,
 } from './board-ui';
+import { LEAD_DELETE_COPY } from './delete-copy';
 
 /**
  * Create / edit a lead. PURELY presentational: props in, one `SaveLeadPayload`
@@ -49,6 +52,12 @@ export type LeadDialogProps = {
   sellers: ComboboxOption[];
   onSubmit: (payload: SaveLeadPayload) => void;
   pending?: boolean;
+  /**
+   * Asks for this lead's delete confirmation (the container's shared
+   * `LeadDeleteDialog`). Rendered only when editing (`initial.id`); the container
+   * withholds it for a converted lead.
+   */
+  onDelete?: () => void;
 };
 
 type ProductDraft = { key: string; productId: string | null; label: string };
@@ -78,6 +87,7 @@ export function LeadDialog({
   sellers,
   onSubmit,
   pending = false,
+  onDelete,
 }: LeadDialogProps) {
   /*
     MOUNT-SCOPED, with no reset effect, for the same reason `MoveLeadDialog` is:
@@ -338,7 +348,18 @@ export function LeadDialog({
           ) : null}
         </div>
 
-        <DialogFooter>
+        <DialogFooter className="gap-2 sm:gap-0">
+          {initial?.id && onDelete ? (
+            <button
+              className={`${dangerOutlineButtonClass} sm:mr-auto`}
+              data-delete-lead-form=""
+              onClick={onDelete}
+              type="button"
+            >
+              <Trash2 aria-hidden className="h-[15px] w-[15px]" />
+              {LEAD_DELETE_COPY.formButton}
+            </button>
+          ) : null}
           <button
             className={secondaryButtonClass}
             onClick={() => onOpenChange(false)}
diff --git a/apps/web/src/sales-ops/leads/LeadsBoard.tsx b/apps/web/src/sales-ops/leads/LeadsBoard.tsx
index 84b9d6a..2b2372d 100644
--- a/apps/web/src/sales-ops/leads/LeadsBoard.tsx
+++ b/apps/web/src/sales-ops/leads/LeadsBoard.tsx
@@ -52,6 +52,7 @@ import {
   dayBadgeTone,
   daysBadgeClass,
   listActionButtonClass,
+  listDangerActionButtonClass,
   listFooterClass,
   listRowClass,
   listTableCardClass,
@@ -84,6 +85,7 @@ import {
   leadBirthdayLabel,
   leadContactLine,
 } from './contact-lead';
+import { LEAD_DELETE_COPY } from './delete-copy';
 import { LeadCard, UnassignedLeadMarker } from './LeadCard';
 import { LeadsFunnelView } from './LeadsFunnelView';
 import { MoveLeadDialog } from './MoveLeadDialog';
@@ -117,6 +119,12 @@ export type LeadsBoardProps = {
   movePending?: boolean;
   onCreateLead?: () => void;
   onEditLead?: (lead: SalesOpsLead) => void;
+  /**
+   * Asks for the delete confirmation of a NON-converted lead: the card's kebab
+   * menu (and right-click) and the Lista's `Excluir` call it. The container owns
+   * the confirmation and the mutation. Absent means no delete affordance at all.
+   */
+  onDeleteLead?: (lead: SalesOpsLead) => void;
   /**
    * Called INSTEAD of `onMoveLead` when the destination is the conversion door.
    *   resolve(saleId) -> the board then calls `onMoveLead(payload)` with it
@@ -151,6 +159,7 @@ type SortableCardProps = {
   lookups: LabelLookups;
   now: Date;
   onEdit?: (lead: SalesOpsLead) => void;
+  onDelete?: (lead: SalesOpsLead) => void;
   onOpenSale?: (saleId: string) => void;
   showDaysBadge?: boolean;
   fieldSet?: LeadFieldSet;
@@ -165,6 +174,7 @@ function SortableLeadCard({
   lookups,
   now,
   onEdit,
+  onDelete,
   onOpenSale,
   showDaysBadge,
   fieldSet,
@@ -186,6 +196,7 @@ function SortableLeadCard({
         lead={lead}
         lookups={lookups}
         now={now}
+        onDelete={onDelete}
         onEdit={onEdit}
         fieldSet={fieldSet}
         onOpenSale={onOpenSale}
@@ -250,6 +261,7 @@ export function LeadsBoard({
   movePending = false,
   onCreateLead,
   onEditLead,
+  onDeleteLead,
   onRequestConversion,
   onOpenSale,
   sellerFilter,
@@ -643,6 +655,7 @@ export function LeadsBoard({
                             lead={lead}
                             lookups={lookups}
                             now={now}
+                            onDelete={onDeleteLead}
                             onEdit={onEditLead}
                             onOpenSale={onOpenSale}
                             showDaysBadge={stageIsNormal(stage) && !leadIsConverted(lead)}
@@ -656,6 +669,7 @@ export function LeadsBoard({
                           lead={lead}
                           lookups={lookups}
                           now={now}
+                          onDelete={onDeleteLead}
                           onEdit={onEditLead}
                           onOpenSale={onOpenSale}
                           showDaysBadge={stageIsNormal(stage) && !leadIsConverted(lead)}
@@ -690,11 +704,17 @@ export function LeadsBoard({
         <DragOverlay dropAnimation={null}>
           {activeLead ? (
             <div className={dragOverlayCardClass}>
+              {/*
+                `onDelete` only so the lifted copy keeps the kebab's slot and is a
+                pixel clone of the card it lifts; nothing can reach its menu
+                mid-drag.
+              */}
               <LeadCard
                 fieldSet={fieldSet}
                 lead={activeLead}
                 lookups={lookups}
                 now={now}
+                onDelete={onDeleteLead}
                 showDaysBadge={false}
               />
             </div>
@@ -880,6 +900,16 @@ export function LeadsBoard({
                             >
                               {EDIT_LABEL}
                             </button>
+                            {!converted && onDeleteLead ? (
+                              <button
+                                className={listDangerActionButtonClass}
+                                data-delete-lead={row.id}
+                                onClick={() => onDeleteLead(row)}
+                                type="button"
+                              >
+                                {LEAD_DELETE_COPY.menuLabel}
+                              </button>
+                            ) : null}
                           </div>
                         </td>
                       </tr>
diff --git a/apps/web/src/sales-ops/leads/LeadsBoardContainer.tsx b/apps/web/src/sales-ops/leads/LeadsBoardContainer.tsx
index 7340c8a..65f6aa1 100644
--- a/apps/web/src/sales-ops/leads/LeadsBoardContainer.tsx
+++ b/apps/web/src/sales-ops/leads/LeadsBoardContainer.tsx
@@ -9,11 +9,13 @@ import type { SalesOpsClient, SalesOpsPerson, SalesOpsProduct } from '../types';
 import type { SaveContactLeadPayload, SaveLeadPayload } from './api';
 import { buildLabelLookups } from './board-labels';
 import { mutedStateClass } from './board-ui';
+import { leadIsConverted } from './calculations';
 import { ContactLeadDialog } from './ContactLeadDialog';
 import { leadToContactSeed } from './contact-lead';
+import { LeadDeleteDialog } from './LeadDeleteDialog';
 import { LeadDialog } from './LeadDialog';
 import { LeadsBoard, type LeadConversionRequest } from './LeadsBoard';
-import { useLeadsBoard, useLeadStages, useMoveLead, useSaveLead } from './hooks';
+import { useDeleteLead, useLeadsBoard, useLeadStages, useMoveLead, useSaveLead } from './hooks';
 import type { LeadBoardFilters, SalesOpsLead } from './types';
 
 /**
@@ -145,6 +147,7 @@ export function LeadsBoardContainer({
   const boardQuery = useLeadsBoard(stages, filters);
   const moveLead = useMoveLead(filters);
   const saveLead = useSaveLead();
+  const deleteLead = useDeleteLead();
 
   const lookups = React.useMemo(
     () => buildLabelLookups({ clients, people, products }),
@@ -161,6 +164,26 @@ export function LeadsBoardContainer({
 
   const [dialogOpen, setDialogOpen] = React.useState(false);
   const [dialogSeed, setDialogSeed] = React.useState<SaveLeadPayload | null>(null);
+  /** The lead the open edit form is editing; null while creating. */
+  const [editingLead, setEditingLead] = React.useState<SalesOpsLead | null>(null);
+  /** The lead whose delete confirmation is open; null when none is. */
+  const [deleteTarget, setDeleteTarget] = React.useState<SalesOpsLead | null>(null);
+
+  /*
+    The edit form offers `Excluir lead` only for a lead that can be deleted: a
+    converted one answers 409 and gets no button at all.
+  */
+  const requestDeleteFromForm =
+    editingLead !== null && !leadIsConverted(editingLead)
+      ? () => setDeleteTarget(editingLead)
+      : undefined;
+
+  async function confirmDelete(lead: SalesOpsLead) {
+    await deleteLead.mutateAsync(lead.id);
+    // The edit dialog is modal, so a delete confirmed while it is open came from
+    // it: its lead is gone, so the form closes with the confirmation.
+    if (editingLead?.id === lead.id) setDialogOpen(false);
+  }
 
   const clientOptions = React.useMemo(
     () => clients.map((row) => ({ value: row.id, label: row.name })),
@@ -202,11 +225,14 @@ export function LeadsBoardContainer({
         onCreateLead={() => {
           setDialogSeed(null);
           setContactSeed(null);
+          setEditingLead(null);
           setDialogOpen(true);
         }}
+        onDeleteLead={setDeleteTarget}
         onEditLead={(lead) => {
           setDialogSeed(leadToSeed(lead));
           setContactSeed(leadToContactSeed(lead));
+          setEditingLead(lead);
           setDialogOpen(true);
         }}
         onLoadMore={() => {
@@ -240,6 +266,7 @@ export function LeadsBoardContainer({
           // `LeadDialog` seeds its fields at MOUNT, so the identity of what is
           // being edited has to be the identity of the component.
           key={dialogSeed?.id ?? 'novo'}
+          onDelete={requestDeleteFromForm}
           onOpenChange={setDialogOpen}
           onSubmit={(payload) => saveLead.mutate(payload)}
           open
@@ -255,6 +282,7 @@ export function LeadsBoardContainer({
           initial={contactSeed}
           key={contactSeed?.id ?? 'novo'}
           onCreateClient={onCreateClient}
+          onDelete={requestDeleteFromForm}
           onOpenChange={setDialogOpen}
           // The dialog awaits the save: it closes on success and, on a rejection
           // (400 no_open_stage included), stays open with the typed values and
@@ -266,6 +294,25 @@ export function LeadsBoardContainer({
           showSellerPicker={isAdmin}
         />
       ) : null}
+
+      {/*
+        The ONE delete confirmation, for the card menu, the Lista action and both
+        forms. Rendered last so it stacks above an open edit form; keyed by the
+        lead so its error never leaks to the next one. The `delete:` prefix is
+        load-bearing: the edit form beside it is keyed by the SAME lead id, and
+        two siblings sharing a key make React keep a stale edit form mounted.
+      */}
+      {deleteTarget ? (
+        <LeadDeleteDialog
+          key={`delete:${deleteTarget.id}`}
+          lead={deleteTarget}
+          onConfirm={confirmDelete}
+          onOpenChange={(next) => {
+            if (!next) setDeleteTarget(null);
+          }}
+          open
+        />
+      ) : null}
     </>
   );
 }
diff --git a/apps/web/src/sales-ops/leads/__tests__/board-write-surface.test.ts b/apps/web/src/sales-ops/leads/__tests__/board-write-surface.test.ts
index 9ac3805..c106fc2 100644
--- a/apps/web/src/sales-ops/leads/__tests__/board-write-surface.test.ts
+++ b/apps/web/src/sales-ops/leads/__tests__/board-write-surface.test.ts
@@ -66,6 +66,10 @@ const OWNED_FILES = [
   'MoveLeadDialog.tsx',
   'contact-lead.ts',
   'ContactLeadDialog.tsx',
+  // The lixeira's delete UI: the shared confirmation and its copy. Deleting a lead
+  // is a lead write, so it obeys the same bans (no transition, no second write path).
+  'delete-copy.ts',
+  'LeadDeleteDialog.tsx',
 ];
 
 /** The one file allowed to spell the conversion kind, because it owns the question. */
diff --git a/apps/web/src/sales-ops/leads/__tests__/lead-delete.test.tsx b/apps/web/src/sales-ops/leads/__tests__/lead-delete.test.tsx
new file mode 100644
index 0000000..7767adc
--- /dev/null
+++ b/apps/web/src/sales-ops/leads/__tests__/lead-delete.test.tsx
@@ -0,0 +1,746 @@
+// @vitest-environment happy-dom
+
+import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
+import * as React from 'react';
+import { createRoot, type Root } from 'react-dom/client';
+import { MemoryRouter, Route, Routes } from 'react-router-dom';
+import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
+import { queryKeys } from '@/lib/query-keys';
+import { ContactLeadDialog } from '../ContactLeadDialog';
+import { LeadCard } from '../LeadCard';
+import { LeadDialog } from '../LeadDialog';
+import { LeadsBoardContainer } from '../LeadsBoardContainer';
+import { buildLabelLookups } from '../board-labels';
+import { MUTATION_ERROR_COPY } from '../../mutation-error-copy';
+import { LEAD_DELETE_COPY, LEAD_DELETE_ERROR_COPY, leadDeleteErrorCopy } from '../delete-copy';
+import { flattenLeadPages } from '../optimistic';
+import type { LeadsInfiniteData, SalesOpsLead, SalesOpsLeadStage } from '../types';
+
+/**
+ * THE LEAD DELETE ORACLE (lixeira slice 03): AC1 to AC5 and AC7 in the UI.
+ *
+ * Two halves. The first renders `LeadCard` alone and pins the STRUCTURE of the
+ * card menu: which cards carry it, and that neither the kebab nor the portalled
+ * menu ever reaches the dnd-kit activator or the editor. The second drives the
+ * REAL container, hooks, board, dialogs and `apiFetch` against a stubbed global
+ * `fetch`, because the claims there are about requests and the cache: a mocked
+ * hook would let a 204 that `apiFetch` cannot parse pass as a success.
+ *
+ * No drag is simulated: happy-dom runs no pointer capture, so a drag proves
+ * nothing. "Never starts a drag" is asserted at the only door dnd-kit has into a
+ * card, the `onPointerDown` it hands the card through `dragHandleProps`.
+ *
+ * `@/components/ui/dialog` and `@/components/ui/alert-dialog` are REAL on
+ * purpose: Escape on the confirmation must close only the confirmation, and that
+ * is decided by Radix's layer stack, which a mocked dialog does not have.
+ */
+
+const act = (React as typeof React & { act: typeof import('react-dom/test-utils').act }).act;
+
+const mocks = vi.hoisted(() => ({
+  edition: 'full' as 'full' | 'leads',
+  roles: ['admin', 'seller'] as string[],
+}));
+
+vi.mock('@/auth/react', () => ({
+  useAccessToken: () => ({ getToken: async () => 'hub-access-token' }),
+  useSalesEdition: () => mocks.edition,
+  useAuthProfile: () => ({
+    isLoaded: true,
+    isSignedIn: true,
+    roles: mocks.roles,
+    name: 'Gestor',
+    email: 'gestor@example.com',
+  }),
+}));
+
+// ── fixtures ────────────────────────────────────────────────────────────────
+
+const NOVO_ID = 'aaaaaaaa-0000-4000-8000-000000000001';
+const PROPOSTA_ID = 'aaaaaaaa-0000-4000-8000-000000000002';
+const PERDIDO_ID = 'aaaaaaaa-0000-4000-8000-000000000003';
+
+const ANA = 'bbbbbbbb-0000-4000-8000-00000000000a';
+const BRUNO = 'bbbbbbbb-0000-4000-8000-00000000000b';
+const CARLA = 'bbbbbbbb-0000-4000-8000-00000000000c';
+const SALE_ID = 'cccccccc-0000-4000-8000-00000000000f';
+
+function stage(id: string, name: string, kind: SalesOpsLeadStage['kind'], position: number) {
+  return {
+    id,
+    orgId: 'org-a',
+    name,
+    position,
+    kind,
+    isSystem: kind !== 'normal',
+    status: 'active',
+    archivedAt: null,
+    createdAt: '2026-09-01T12:00:00.000Z',
+    updatedAt: null,
+  } satisfies SalesOpsLeadStage;
+}
+
+const STAGES = [
+  stage(NOVO_ID, 'Novo', 'normal', 1),
+  stage(PROPOSTA_ID, 'Proposta enviada', 'conversion', 2),
+  stage(PERDIDO_ID, 'Perdido', 'lost', 3),
+];
+
+function lead(id: string, contactName: string, patch: Partial<SalesOpsLead> = {}): SalesOpsLead {
+  return {
+    id,
+    stageId: NOVO_ID,
+    position: 0,
+    contactName,
+    clientId: null,
+    clientNameSnapshot: 'CENTRAIS DE ABASTECIMENTO DO ESP SANTO',
+    estimatedValueBrl: 150_000,
+    description: null,
+    contactPhone: '(11) 98888-7777',
+    contactEmail: null,
+    contactBirthDate: null,
+    sellerPersonId: null,
+    sellerNameSnapshot: 'Marina',
+    lostReason: null,
+    stageChangedAt: '2026-09-15T12:00:00.000Z',
+    saleId: null,
+    saleStatus: null,
+    saleCode: null,
+    products: [],
+    createdAt: '2026-09-01T12:00:00.000Z',
+    updatedAt: null,
+    ...patch,
+  };
+}
+
+function seedLeads(): SalesOpsLead[] {
+  return [
+    lead(ANA, 'Ana Souza', { position: 0 }),
+    lead(BRUNO, 'Bruno Lima', { position: 1 }),
+    lead(CARLA, 'Carla Dias', {
+      stageId: PROPOSTA_ID,
+      saleId: SALE_ID,
+      saleStatus: 'draft',
+      saleCode: '0001-1',
+    }),
+  ];
+}
+
+// ── the fetch router ────────────────────────────────────────────────────────
+
+type FakeResponse = { ok: boolean; status: number; json: () => Promise<unknown> };
+
+function json(status: number, body: unknown): FakeResponse {
+  return { ok: status < 400, status, json: async () => body };
+}
+
+/** What a real 204 does: there is no body, so `json()` rejects. */
+function noContent(): FakeResponse {
+  return {
+    ok: true,
+    status: 204,
+    json: async () => {
+      throw new SyntaxError('Unexpected end of JSON input');
+    },
+  };
+}
+
+type DeleteAnswer = { kind: 'ok' } | { kind: 'fail'; status: number; body: unknown } | {
+  kind: 'gate';
+  promise: Promise<FakeResponse>;
+};
+
+let serverLeads: SalesOpsLead[];
+let deleteAnswer: DeleteAnswer;
+let deleteCalls: Array<{ url: string; method: string; body: unknown; auth: string | null }>;
+
+function route(input: string, init?: RequestInit): Promise<FakeResponse> {
+  const url = new URL(String(input));
+  const method = (init?.method ?? 'GET').toUpperCase();
+  if (url.pathname.endsWith('/sales-ops/lead-stages')) {
+    return Promise.resolve(json(200, { stages: STAGES }));
+  }
+  if (method === 'GET' && url.pathname.endsWith('/sales-ops/leads')) {
+    const stageId = url.searchParams.get('stageId');
+    return Promise.resolve(
+      json(200, { leads: serverLeads.filter((row) => row.stageId === stageId), nextCursor: null }),
+    );
+  }
+  const deleteMatch = /\/sales-ops\/leads\/([^/]+)\/delete$/.exec(url.pathname);
+  if (method === 'POST' && deleteMatch) {
+    const headers = new Headers(init?.headers);
+    deleteCalls.push({
+      url: url.pathname,
+      method,
+      body: init?.body ?? null,
+      auth: headers.get('Authorization'),
+    });
+    if (deleteAnswer.kind === 'gate') return deleteAnswer.promise;
+    if (deleteAnswer.kind === 'fail') {
+      return Promise.resolve(json(deleteAnswer.status, deleteAnswer.body));
+    }
+    serverLeads = serverLeads.filter((row) => row.id !== deleteMatch[1]);
+    return Promise.resolve(noContent());
+  }
+  return Promise.resolve(json(404, { error: 'not_found' }));
+}
+
+// ── harness ─────────────────────────────────────────────────────────────────
+
+let container: HTMLDivElement;
+let root: Root;
+let queryClient: QueryClient;
+
+beforeEach(() => {
+  (
+    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
+  ).IS_REACT_ACT_ENVIRONMENT = true;
+  mocks.edition = 'full';
+  mocks.roles = ['admin', 'seller'];
+  serverLeads = seedLeads();
+  deleteAnswer = { kind: 'ok' };
+  deleteCalls = [];
+  vi.stubGlobal('fetch', vi.fn(route));
+  container = document.createElement('div');
+  document.body.append(container);
+  root = createRoot(container);
+});
+
+afterEach(async () => {
+  await act(async () => root.unmount());
+  container.remove();
+  document.body.innerHTML = '';
+  vi.unstubAllGlobals();
+  vi.restoreAllMocks();
+});
+
+/** Lets Radix's macrotask-registered listeners and the query round trips land. */
+async function settle(times = 3) {
+  for (let i = 0; i < times; i += 1) {
+    await act(async () => {
+      await new Promise((resolve) => setTimeout(resolve, 5));
+    });
+  }
+}
+
+async function renderContainer() {
+  queryClient = new QueryClient({
+    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
+  });
+  await act(async () => {
+    root.render(
+      <QueryClientProvider client={queryClient}>
+        <MemoryRouter
+          future={{ v7_relativeSplatPath: true, v7_startTransition: true }}
+          initialEntries={['/operacional/leads']}
+        >
+          <Routes>
+            <Route
+              element={
+                <LeadsBoardContainer clients={[]} people={[]} products={[]} sellers={[]} />
+              }
+              path="/operacional/leads"
+            />
+          </Routes>
+        </MemoryRouter>
+      </QueryClientProvider>,
+    );
+  });
+  await settle();
+}
+
+function query(selector: string): Element | null {
+  return document.querySelector(selector);
+}
+
+function required(selector: string): Element {
+  const node = query(selector);
+  if (!node) throw new Error(`not found: ${selector}`);
+  return node;
+}
+
+async function click(element: Element, init: MouseEventInit = {}) {
+  await act(async () => {
+    element.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, ...init }));
+  });
+  await settle(1);
+}
+
+/** Radix opens a menu on a primary-button pointerdown, so a click alone would not. */
+async function press(element: Element) {
+  await act(async () => {
+    element.dispatchEvent(
+      new MouseEvent('pointerdown', { bubbles: true, cancelable: true, button: 0, ctrlKey: false }),
+    );
+  });
+  await click(element);
+}
+
+async function rightClick(element: Element): Promise<MouseEvent> {
+  const event = new MouseEvent('contextmenu', { bubbles: true, cancelable: true, button: 2 });
+  await act(async () => {
+    element.dispatchEvent(event);
+  });
+  await settle(1);
+  return event;
+}
+
+async function escape(element: Element) {
+  await act(async () => {
+    element.dispatchEvent(
+      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }),
+    );
+  });
+  await settle();
+}
+
+function buttonLabelled(label: string): HTMLButtonElement {
+  const node = [...document.querySelectorAll('button')].find(
+    (candidate) => candidate.textContent?.trim() === label,
+  );
+  if (!node) throw new Error(`button not found: ${label}`);
+  return node;
+}
+
+function cardIds(): string[] {
+  return [...document.querySelectorAll('[data-lead-card]')].map(
+    (node) => node.getAttribute('data-lead-card') ?? '',
+  );
+}
+
+function confirmDialog(): Element | null {
+  return query('[role="alertdialog"]');
+}
+
+function editDialog(): Element | null {
+  return query('[role="dialog"]');
+}
+
+async function openCardMenuDelete(leadId: string) {
+  await press(required(`[data-lead-menu="${leadId}"]`));
+  await click(required(`[role="menu"] [data-delete-lead="${leadId}"]`));
+}
+
+async function confirmDelete() {
+  await click(required('[data-confirm-delete]'));
+  await settle();
+}
+
+// ── the card, alone ─────────────────────────────────────────────────────────
+
+const LOOKUPS = buildLabelLookups({ clients: [], people: [], products: [] });
+const NOW = new Date('2026-09-18T12:00:00.000Z');
+
+async function renderCard(props: Partial<React.ComponentProps<typeof LeadCard>> & { lead: SalesOpsLead }) {
+  const handlers = {
+    onEdit: vi.fn(),
+    onDelete: vi.fn(),
+    dragPointerDown: vi.fn(),
+  };
+  await act(async () => {
+    root.render(
+      <LeadCard
+        dragHandleProps={{ onPointerDown: handlers.dragPointerDown }}
+        lookups={LOOKUPS}
+        now={NOW}
+        onDelete={handlers.onDelete}
+        onEdit={handlers.onEdit}
+        {...props}
+      />,
+    );
+  });
+  await settle(1);
+  return handlers;
+}
+
+describe('the card menu, structurally', () => {
+  it('a non-converted card carries a keyboard-reachable kebab; a converted card and a card without onDelete do not', async () => {
+    await renderCard({ lead: lead(ANA, 'Ana Souza') });
+    const trigger = required(`[data-lead-card="${ANA}"] [data-lead-menu="${ANA}"]`);
+    expect(trigger.tagName).toBe('BUTTON');
+    expect(trigger.getAttribute('tabindex')).not.toBe('-1');
+    expect(trigger.getAttribute('aria-label')).toBe(`${LEAD_DELETE_COPY.menuTrigger}: Ana Souza`);
+
+    await renderCard({ lead: lead(CARLA, 'Carla Dias', { saleId: SALE_ID, saleStatus: 'won' }) });
+    expect(query('[data-lead-menu]')).toBeNull();
+    expect(required(`[data-lead-card="${CARLA}"]`).querySelectorAll('button')).toHaveLength(0);
+
+    await renderCard({ lead: lead(ANA, 'Ana Souza'), onDelete: undefined });
+    expect(query('[data-lead-menu]')).toBeNull();
+  });
+
+  it('the contact-edition card carries the same kebab', async () => {
+    await renderCard({ lead: lead(ANA, 'Ana Souza'), fieldSet: 'contact' });
+    expect(query(`[data-lead-menu="${ANA}"]`)).not.toBeNull();
+  });
+
+  it('a pointerdown on the kebab never reaches the drag activator; one on the card body does', async () => {
+    const handlers = await renderCard({ lead: lead(ANA, 'Ana Souza') });
+
+    await press(required(`[data-lead-menu="${ANA}"]`));
+    expect(handlers.dragPointerDown).not.toHaveBeenCalled();
+
+    // The positive control: the guard is not a blanket block on the card.
+    await act(async () => {
+      required(`[data-lead-card="${ANA}"]`).dispatchEvent(
+        new MouseEvent('pointerdown', { bubbles: true, cancelable: true, button: 0 }),
+      );
+    });
+    expect(handlers.dragPointerDown).toHaveBeenCalledTimes(1);
+  });
+
+  it('clicking the kebab opens the menu and never the editor', async () => {
+    const handlers = await renderCard({ lead: lead(ANA, 'Ana Souza') });
+
+    await press(required(`[data-lead-menu="${ANA}"]`));
+
+    expect(query('[role="menu"]')).not.toBeNull();
+    expect(required('[role="menu"] [data-delete-lead]').textContent).toBe(
+      LEAD_DELETE_COPY.menuLabel,
+    );
+    expect(handlers.onEdit).not.toHaveBeenCalled();
+    expect(handlers.dragPointerDown).not.toHaveBeenCalled();
+  });
+
+  it('a right-click on the card opens the same menu instead of the browser one, and never the editor', async () => {
+    const handlers = await renderCard({ lead: lead(ANA, 'Ana Souza') });
+
+    const event = await rightClick(required(`[data-lead-card="${ANA}"] span`));
+
+    expect(event.defaultPrevented).toBe(true);
+    expect(query('[role="menu"] [data-delete-lead]')).not.toBeNull();
+    expect(handlers.onEdit).not.toHaveBeenCalled();
+  });
+
+  it('a right-click on a converted card keeps the browser menu', async () => {
+    await renderCard({ lead: lead(CARLA, 'Carla Dias', { saleId: SALE_ID, saleStatus: 'won' }) });
+
+    const event = await rightClick(required(`[data-lead-card="${CARLA}"]`));
+
+    expect(event.defaultPrevented).toBe(false);
+    expect(query('[role="menu"]')).toBeNull();
+  });
+
+  it('Excluir asks for this lead and neither edits nor reaches the drag activator', async () => {
+    const handlers = await renderCard({ lead: lead(ANA, 'Ana Souza') });
+
+    await press(required(`[data-lead-menu="${ANA}"]`));
+    const item = required(`[role="menu"] [data-delete-lead="${ANA}"]`);
+    await act(async () => {
+      item.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, cancelable: true, button: 0 }));
+    });
+    await click(item);
+
+    expect(handlers.onDelete).toHaveBeenCalledTimes(1);
+    expect(handlers.onDelete.mock.calls[0]?.[0]).toMatchObject({ id: ANA });
+    expect(handlers.onEdit).not.toHaveBeenCalled();
+    expect(handlers.dragPointerDown).not.toHaveBeenCalled();
+    expect(query('[role="menu"]')).toBeNull();
+  });
+
+  it('a plain click on the card body still opens the editor', async () => {
+    const handlers = await renderCard({ lead: lead(ANA, 'Ana Souza') });
+
+    await click(required(`[data-lead-card="${ANA}"]`), { clientX: 0, clientY: 0 });
+
+    expect(handlers.onEdit).toHaveBeenCalledTimes(1);
+    expect(handlers.onDelete).not.toHaveBeenCalled();
+  });
+});
+
+// ── the real flow ───────────────────────────────────────────────────────────
+
+describe('deleting from the Quadro card menu', () => {
+  it('confirms in-app, posts once with the bearer and removes the card', async () => {
+    const nativeConfirm = vi.spyOn(window, 'confirm');
+    await renderContainer();
+    expect(cardIds()).toEqual([ANA, BRUNO, CARLA]);
+
+    await openCardMenuDelete(ANA);
+
+    expect(confirmDialog()?.textContent).toContain(LEAD_DELETE_COPY.dialogBody('Ana Souza'));
+    expect(deleteCalls).toHaveLength(0);
+
+    await confirmDelete();
+
+    expect(deleteCalls).toEqual([
+      {
+        url: `/api/v1/sales-ops/leads/${ANA}/delete`,
+        method: 'POST',
+        body: null,
+        auth: 'Bearer hub-access-token',
+      },
+    ]);
+    expect(cardIds()).toEqual([BRUNO, CARLA]);
+    expect(confirmDialog()).toBeNull();
+    expect(nativeConfirm).not.toHaveBeenCalled();
+  });
+
+  it('Cancelar changes nothing', async () => {
+    await renderContainer();
+    await openCardMenuDelete(ANA);
+
+    const cancel = [...required('[role="alertdialog"]').querySelectorAll('button')].find(
+      (node) => node.textContent?.trim() === LEAD_DELETE_COPY.cancel,
+    );
+    if (!cancel) throw new Error('Cancelar not rendered');
+    await click(cancel);
+
+    expect(confirmDialog()).toBeNull();
+    expect(deleteCalls).toHaveLength(0);
+    expect(cardIds()).toEqual([ANA, BRUNO, CARLA]);
+  });
+
+  it('removes the card optimistically and puts it back exactly when the API refuses', async () => {
+    let answer!: (response: FakeResponse) => void;
+    deleteAnswer = { kind: 'gate', promise: new Promise((resolve) => (answer = resolve)) };
+    await renderContainer();
+    const filtered = queryKeys.leads.board({ sellerPersonId: 'p-1' });
+    const filteredSnapshot: LeadsInfiniteData = {
+      pages: [{ leads: seedLeads(), nextCursor: null }],
+      pageParams: [null],
+    };
+    queryClient.setQueryData(filtered, filteredSnapshot);
+
+    await openCardMenuDelete(ANA);
+    await click(required('[data-confirm-delete]'));
+
+    // Optimistic: gone from the board AND from every other cached board.
+    expect(cardIds()).toEqual([BRUNO, CARLA]);
+    expect(required('[data-confirm-delete]').textContent).toBe(LEAD_DELETE_COPY.pending);
+    expect((required('[data-confirm-delete]') as HTMLButtonElement).disabled).toBe(true);
+    const removed = flattenLeadPages(queryClient.getQueryData<LeadsInfiniteData>(filtered));
+    expect(removed.map((row) => row.id)).toEqual([BRUNO, CARLA]);
+    expect(removed.find((row) => row.id === BRUNO)?.position).toBe(0);
+
+    await act(async () => {
+      answer(json(500, { error: 'internal' }));
+    });
+    await settle(1);
+
+    // Exact revert: each board gets its own snapshot back (order and positions).
+    expect(queryClient.getQueryData(filtered)).toEqual(filteredSnapshot);
+    expect(cardIds()).toEqual([ANA, BRUNO, CARLA]);
+    expect(confirmDialog()?.querySelector('[data-lead-delete-error]')?.textContent).toBe(
+      'Não foi possível concluir a ação. Tente novamente.',
+    );
+  });
+
+  it('Escape cannot close the confirmation while the delete is on the wire', async () => {
+    let answer!: (response: FakeResponse) => void;
+    deleteAnswer = { kind: 'gate', promise: new Promise((resolve) => (answer = resolve)) };
+    await renderContainer();
+    await openCardMenuDelete(ANA);
+    await click(required('[data-confirm-delete]'));
+
+    await escape(required('[role="alertdialog"]'));
+    expect(confirmDialog()).not.toBeNull();
+
+    // The server really deleted it, so the settle-time refetch agrees.
+    serverLeads = serverLeads.filter((row) => row.id !== ANA);
+    await act(async () => {
+      answer(noContent());
+    });
+    await settle();
+    expect(confirmDialog()).toBeNull();
+    expect(cardIds()).toEqual([BRUNO, CARLA]);
+  });
+
+  it('a converted lead refused with 409 comes back and the confirmation says why', async () => {
+    deleteAnswer = {
+      kind: 'fail',
+      status: 409,
+      body: { error: 'conflict', reason: 'lead_already_converted' },
+    };
+    await renderContainer();
+    await openCardMenuDelete(ANA);
+    await confirmDelete();
+
+    expect(cardIds()).toContain(ANA);
+    expect(confirmDialog()?.querySelector('[data-lead-delete-error]')?.textContent).toBe(
+      LEAD_DELETE_ERROR_COPY.converted,
+    );
+  });
+
+  it('a 404 means already gone: the card stays removed and nothing scary shows', async () => {
+    deleteAnswer = { kind: 'fail', status: 404, body: { error: 'not_found' } };
+    await renderContainer();
+    await openCardMenuDelete(ANA);
+    serverLeads = serverLeads.filter((row) => row.id !== ANA);
+    await confirmDelete();
+
+    expect(cardIds()).toEqual([BRUNO, CARLA]);
+    expect(confirmDialog()).toBeNull();
+    expect(query('[data-lead-delete-error]')).toBeNull();
+  });
+
+  it('works the same in the leads edition', async () => {
+    mocks.edition = 'leads';
+    mocks.roles = ['seller'];
+    await renderContainer();
+
+    await openCardMenuDelete(BRUNO);
+    await confirmDelete();
+
+    expect(deleteCalls.map((call) => call.url)).toEqual([`/api/v1/sales-ops/leads/${BRUNO}/delete`]);
+    expect(cardIds()).not.toContain(BRUNO);
+  });
+});
+
+describe('deleting from the Lista', () => {
+  it('offers Excluir beside Mover and Editar on an open row only, through the same confirmation', async () => {
+    await renderContainer();
+    await click(required('[data-view-option="list"]'));
+
+    const row = required(`[data-list-row="${ANA}"]`);
+    expect(row.querySelector(`[data-move-trigger="${ANA}"]`)).not.toBeNull();
+    expect(row.querySelector(`[data-edit-lead="${ANA}"]`)).not.toBeNull();
+    expect(row.querySelector(`[data-delete-lead="${ANA}"]`)?.textContent).toBe(
+      LEAD_DELETE_COPY.menuLabel,
+    );
+    expect(query(`[data-list-row="${CARLA}"] [data-delete-lead]`)).toBeNull();
+
+    await click(required(`[data-list-row="${ANA}"] [data-delete-lead="${ANA}"]`));
+    expect(confirmDialog()?.textContent).toContain(LEAD_DELETE_COPY.dialogBody('Ana Souza'));
+    await confirmDelete();
+
+    expect(deleteCalls).toHaveLength(1);
+    expect(query(`[data-list-row="${ANA}"]`)).toBeNull();
+  });
+});
+
+describe('deleting from the edit form', () => {
+  for (const edition of ['full', 'leads'] as const) {
+    it(`${edition} edition: Excluir lead shows on edit only, and a confirmed delete closes the form`, async () => {
+      mocks.edition = edition;
+      await renderContainer();
+
+      await click(buttonLabelled('Novo lead'));
+      expect(editDialog()).not.toBeNull();
+      expect(query('[data-delete-lead-form]')).toBeNull();
+      await escape(editDialog() as Element);
+
+      await click(required(`[data-lead-card="${ANA}"]`), { clientX: 0, clientY: 0 });
+      expect(required('[data-delete-lead-form]').textContent).toContain(LEAD_DELETE_COPY.formButton);
+
+      await click(required('[data-delete-lead-form]'));
+      expect(confirmDialog()?.textContent).toContain(LEAD_DELETE_COPY.dialogBody('Ana Souza'));
+      await confirmDelete();
+
+      expect(deleteCalls).toHaveLength(1);
+      expect(confirmDialog()).toBeNull();
+      expect(editDialog()).toBeNull();
+      expect(cardIds()).not.toContain(ANA);
+    });
+  }
+
+  it('both forms render Excluir lead in edit mode only, even when handed onDelete', async () => {
+    const onDelete = vi.fn();
+    const forms = (initialId: string | undefined) => [
+      <LeadDialog
+        clients={[]}
+        initial={initialId ? { id: initialId, contactName: 'Ana Souza', clientName: 'Acme' } : null}
+        key="full"
+        onDelete={onDelete}
+        onOpenChange={vi.fn()}
+        onSubmit={vi.fn()}
+        open
+        products={[]}
+        sellers={[]}
+      />,
+      <ContactLeadDialog
+        initial={
+          initialId
+            ? {
+                id: initialId,
+                contactName: 'Ana Souza',
+                contactPhone: null,
+                contactEmail: null,
+                contactBirthDate: null,
+                description: null,
+              }
+            : null
+        }
+        key="contact"
+        onDelete={onDelete}
+        onOpenChange={vi.fn()}
+        onSubmit={vi.fn()}
+        open
+        sellers={[]}
+        today="2026-10-07"
+      />,
+    ];
+
+    for (const form of forms(undefined)) {
+      await act(async () => root.render(form));
+      await settle(1);
+      expect(editDialog()).not.toBeNull();
+      expect(query('[data-delete-lead-form]')).toBeNull();
+    }
+    for (const form of forms(ANA)) {
+      await act(async () => root.render(form));
+      await settle(1);
+      await click(required('[data-delete-lead-form]'));
+    }
+    expect(onDelete).toHaveBeenCalledTimes(2);
+  });
+
+  it('a converted lead opened from the Lista gets no Excluir lead', async () => {
+    await renderContainer();
+    await click(required('[data-view-option="list"]'));
+    await click(required(`[data-edit-lead="${CARLA}"]`));
+
+    expect(editDialog()).not.toBeNull();
+    expect(query('[data-delete-lead-form]')).toBeNull();
+  });
+
+  it('a refused delete keeps the form open behind the confirmation', async () => {
+    deleteAnswer = { kind: 'fail', status: 500, body: { error: 'internal' } };
+    await renderContainer();
+    await click(required(`[data-lead-card="${ANA}"]`), { clientX: 0, clientY: 0 });
+    await click(required('[data-delete-lead-form]'));
+    await confirmDelete();
+
+    expect(confirmDialog()?.querySelector('[data-lead-delete-error]')).not.toBeNull();
+    expect(editDialog()).not.toBeNull();
+  });
+
+  it('Escape on the confirmation closes only the confirmation, never the form under it', async () => {
+    await renderContainer();
+    await click(required(`[data-lead-card="${ANA}"]`), { clientX: 0, clientY: 0 });
+    // A keyboard operator: focus the button, then activate it (happy-dom's click
+    // does not move focus the way a browser's does).
+    const formButton = required('[data-delete-lead-form]') as HTMLButtonElement;
+    await act(async () => formButton.focus());
+    await click(formButton);
+    expect(confirmDialog()).not.toBeNull();
+
+    await escape(required('[role="alertdialog"]'));
+
+    expect(confirmDialog()).toBeNull();
+    expect(editDialog()).not.toBeNull();
+    expect(deleteCalls).toHaveLength(0);
+    // Focus goes back to the button that opened it, never to <body> under an open form.
+    expect(document.activeElement).toBe(formButton);
+
+    // The positive control: with nothing above it, Escape still closes the form,
+    // so the assertion above is about the layer stack and not a dead listener.
+    await escape(editDialog() as Element);
+    expect(editDialog()).toBeNull();
+  });
+});
+
+describe('leadDeleteErrorCopy', () => {
+  it('names the converted refusal and hands everything else to the sales-ops mutation copy', () => {
+    expect(leadDeleteErrorCopy({ status: 409, reason: 'lead_already_converted' })).toBe(
+      LEAD_DELETE_ERROR_COPY.converted,
+    );
+    expect(leadDeleteErrorCopy({ status: 409, reason: 'something_else' })).toBe(
+      MUTATION_ERROR_COPY.generic,
+    );
+    expect(leadDeleteErrorCopy({ status: 403, error: 'forbidden' })).toBe(
+      MUTATION_ERROR_COPY.adminRequired,
+    );
+    expect(leadDeleteErrorCopy(new Error('network'))).toBe(MUTATION_ERROR_COPY.generic);
+  });
+});
diff --git a/apps/web/src/sales-ops/leads/__tests__/leads-api-contract.test.ts b/apps/web/src/sales-ops/leads/__tests__/leads-api-contract.test.ts
index f68c255..edad76b 100644
--- a/apps/web/src/sales-ops/leads/__tests__/leads-api-contract.test.ts
+++ b/apps/web/src/sales-ops/leads/__tests__/leads-api-contract.test.ts
@@ -1,7 +1,7 @@
 import { afterEach, describe, expect, it, vi } from 'vitest';
 import { apiFetch } from '@/lib/api-client';
 import { queryKeys } from '@/lib/query-keys';
-import { LEADS_PATH, LEAD_STAGES_PATH, leadsApi } from '../api';
+import { LEADS_PATH, LEAD_STAGES_PATH, deleteLead, leadsApi } from '../api';
 import { buildContactLeadPayload, contactDraftFromSeed } from '../contact-lead';
 
 vi.mock('@/lib/api-client', () => ({
@@ -153,6 +153,15 @@ describe('leadsApi', () => {
     expect('id' in bodyOf(call(1))).toBe(false);
   });
 
+  it('deleteLead posts the lixeira action with no body and the token it was given', async () => {
+    await deleteLead('token-1', 'L1');
+    const [path, init] = call(0);
+    expect(path).toBe(`${LEADS_PATH}/L1/delete`);
+    expect(init.method).toBe('POST');
+    expect(init.token).toBe('token-1');
+    expect(init.body).toBeUndefined();
+  });
+
   it('the leads query keys are account- and org-agnostic', () => {
     expect(queryKeys.leads.all).toEqual(['leads']);
     expect(queryKeys.leads.stages()).toEqual(['leads', 'stages']);
diff --git a/apps/web/src/sales-ops/leads/__tests__/leads-contact-container.test.tsx b/apps/web/src/sales-ops/leads/__tests__/leads-contact-container.test.tsx
index 446fd21..b7a2244 100644
--- a/apps/web/src/sales-ops/leads/__tests__/leads-contact-container.test.tsx
+++ b/apps/web/src/sales-ops/leads/__tests__/leads-contact-container.test.tsx
@@ -59,6 +59,8 @@ vi.mock('../hooks', () => ({
     mutateAsync: mocks.mutateAsync,
     isPending: false,
   }),
+  // The delete flow has its own oracle (`lead-delete.test.tsx`); here it is inert.
+  useDeleteLead: () => ({ mutateAsync: vi.fn(), isPending: false }),
 }));
 
 vi.mock('../LeadsBoard', async () => {
diff --git a/apps/web/src/sales-ops/leads/api.ts b/apps/web/src/sales-ops/leads/api.ts
index 5085cd5..042f0fe 100644
--- a/apps/web/src/sales-ops/leads/api.ts
+++ b/apps/web/src/sales-ops/leads/api.ts
@@ -18,8 +18,10 @@ import {
  * defaulted").
  *
  * There is NO DELETE verb here and there must never be one: a stage is archived
- * with `PATCH {status:'archived'}`, and a lead that goes nowhere ends in the
- * terminal `lost` stage.
+ * with `PATCH {status:'archived'}`, a lead that goes nowhere ends in the
+ * terminal `lost` stage, and a lead removed by mistake goes to the lixeira
+ * through the `POST /leads/:id/delete` ACTION (`deleteLead` below), a soft
+ * delete the gestor can restore.
  */
 
 type Token = string;
@@ -205,3 +207,18 @@ export const leadsApi = {
       body: JSON.stringify(payload),
     }),
 };
+
+/**
+ * Moves one lead to the lixeira: `POST /leads/:id/delete`, no body, `204` on
+ * success. A soft delete and an ACTION like `/move`, never the DELETE verb: the
+ * row stays, flagged, and the gestor restores it from `Cadastros > Leads
+ * excluídos`. Rejects with the `ApiError` of a `404` (absent, out of scope or
+ * already deleted) or a `409 lead_already_converted`; `useDeleteLead` decides
+ * what each means for the board.
+ *
+ * Token FIRST, unlike `leadsApi`, because that is the lixeira seam's fixed
+ * signature (`SEAM-CONTRACT.md`), shared with `listDeletedLeads` and `restoreLead`.
+ */
+export function deleteLead(token: Token, id: string): Promise<void> {
+  return apiFetch<void>(`${LEADS_PATH}/${id}/delete`, { method: 'POST', token });
+}
diff --git a/apps/web/src/sales-ops/leads/board-ui.ts b/apps/web/src/sales-ops/leads/board-ui.ts
index da7f6e0..1aa9bb5 100644
--- a/apps/web/src/sales-ops/leads/board-ui.ts
+++ b/apps/web/src/sales-ops/leads/board-ui.ts
@@ -95,6 +95,39 @@ export const primaryButtonClass =
 export const secondaryButtonClass =
   'inline-flex items-center justify-center rounded-[10px] border border-[#dcdce2] bg-white px-4 py-2 text-sm font-semibold text-[#57575f] transition hover:border-[#eaa81a] hover:text-[#9c7210]';
 
+/**
+ * The destructive pair, in the `lost` stage's red (`KIND_COLORS.lost`): the solid
+ * confirm of `LeadDeleteDialog`, and the outlined `Excluir lead` that opens it
+ * from an edit form. Same 40px geometry as `primaryButtonClass`.
+ */
+export const dangerButtonClass =
+  'inline-flex items-center justify-center rounded-[10px] bg-[#c2413b] px-4 py-2 text-sm font-semibold text-white transition hover:bg-[#a5341c] disabled:cursor-not-allowed disabled:opacity-60';
+
+export const dangerOutlineButtonClass =
+  'inline-flex items-center justify-center gap-1.5 rounded-[10px] border border-[#f2d6d4] bg-white px-4 py-2 text-sm font-semibold text-[#9b2f2a] transition hover:border-[#c2413b] hover:bg-[#fcf1f0] disabled:cursor-not-allowed disabled:opacity-60';
+
+/**
+ * The card's kebab. A constant 28px slot in the card's top row, always rendered
+ * and always in the tab order, so opening or hovering it never reflows the card.
+ * Quiet by default (a light grey glyph), darker while the card is hovered and
+ * on its own focus ring, chip-backed while hovered or open. Never `opacity-0`:
+ * an invisible slot reads as a misaligned value, and a touch device has no hover
+ * to reveal it. `-mr-1.5 -mt-1` tuck the 16px glyph into the card's corner
+ * padding and centre it on the 20px first line beside it.
+ */
+export const leadMenuTriggerClass =
+  '-mr-1.5 -mt-1 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-[#b4b4bb] outline-none transition-colors hover:bg-[#f2f2f4] focus-visible:ring-2 focus-visible:ring-[#eaa81a] group-hover/card:text-[#6a6a72] data-[state=open]:bg-[#f2f2f4] data-[state=open]:text-[#201f24]';
+
+/** The card menu panel; the same surface as the propostas table's row menu. */
+export const leadMenuContentClass = 'w-[180px] rounded-xl border-[#e5e5ea] bg-white p-1.5';
+
+export const leadMenuDeleteItemClass =
+  'cursor-pointer text-[13px] font-semibold text-[#9b2f2a] focus:bg-[#fcf1f0] focus:text-[#9b2f2a]';
+
+/** The Lista row's `Excluir`: `listActionButtonClass` geometry, destructive ink. */
+export const listDangerActionButtonClass =
+  'inline-flex items-center rounded-[9px] border border-[#dcdce2] bg-white px-2.5 py-1 text-[12px] font-semibold text-[#9b2f2a] transition hover:border-[#c2413b] hover:bg-[#fcf1f0] disabled:cursor-not-allowed disabled:opacity-60';
+
 export const mutedStateClass = 'text-[13px] text-[#8b8b92]';
 
 export const blockedNoticeClass = 'text-[13px] font-medium text-[#a5341c]';
diff --git a/apps/web/src/sales-ops/leads/delete-copy.ts b/apps/web/src/sales-ops/leads/delete-copy.ts
new file mode 100644
index 0000000..c08f924
--- /dev/null
+++ b/apps/web/src/sales-ops/leads/delete-copy.ts
@@ -0,0 +1,45 @@
+import { salesOpsMutationErrorMessage } from '../mutation-error-copy';
+
+/**
+ * Every line the lead delete flow renders: the card menu, the Lista action, the
+ * form button and the ONE confirmation, `LeadDeleteDialog`. Pure and React-free.
+ *
+ * Like `contact-lead.ts`, this file must not import the HTTP client module
+ * (board-write-surface OWNED_FILES rule), so the error classification below is
+ * structural.
+ */
+
+export const LEAD_DELETE_COPY = {
+  menuLabel: 'Excluir',
+  menuTrigger: 'Ações do lead',
+  formButton: 'Excluir lead',
+  dialogTitle: 'Excluir lead',
+  dialogBody: (name: string): string =>
+    `O lead "${name}" sai do quadro para todos. O gestor pode restaurá-lo em Cadastros > Leads excluídos.`,
+  confirm: 'Excluir',
+  cancel: 'Cancelar',
+  pending: 'Excluindo…',
+} as const;
+
+export const LEAD_DELETE_ERROR_COPY = {
+  converted: 'Este lead já virou proposta e não pode ser excluído.',
+} as const;
+
+/**
+ * The inline line for a refused delete, rendered INSIDE the still-open
+ * confirmation. `409 {reason:'lead_already_converted'}` names the one refusal an
+ * operator can understand; every other failure is the existing sales-ops
+ * mutation copy (403 included, keyed on the status). A `404` never reaches here:
+ * `useDeleteLead` resolves it, because the lead is already gone.
+ */
+export function leadDeleteErrorCopy(error: unknown): string {
+  if (
+    typeof error === 'object' &&
+    error !== null &&
+    (error as { status?: unknown }).status === 409 &&
+    (error as { reason?: unknown }).reason === 'lead_already_converted'
+  ) {
+    return LEAD_DELETE_ERROR_COPY.converted;
+  }
+  return salesOpsMutationErrorMessage(error);
+}
diff --git a/apps/web/src/sales-ops/leads/hooks.ts b/apps/web/src/sales-ops/leads/hooks.ts
index 33b9969..509b74d 100644
--- a/apps/web/src/sales-ops/leads/hooks.ts
+++ b/apps/web/src/sales-ops/leads/hooks.ts
@@ -1,9 +1,10 @@
-import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
+import { useInfiniteQuery, useQuery, useQueryClient, type QueryKey } from '@tanstack/react-query';
 import { useAccessToken } from '@/auth/react';
 import { useAppMutation } from '@/lib/app-mutation';
 import { queryKeys } from '@/lib/query-keys';
 import { requireToken } from '@/lib/require-token';
 import {
+  deleteLead,
   leadsApi,
   type MoveLeadPayload,
   type ReorderLeadStagesPayload,
@@ -17,6 +18,7 @@ import {
   flattenLeadPages,
   leadsHasMore,
   optimisticLeadMove,
+  optimisticLeadRemoval,
   reconcileLeadRow,
   type OptimisticLeadPatch,
 } from './optimistic';
@@ -196,6 +198,73 @@ export function useMoveLead(filters?: LeadBoardFilters) {
   });
 }
 
+/**
+ * The prefix every board cache entry shares, whatever its filters
+ * (`['leads', 'board']`). Derived from the factory, never hand-typed.
+ */
+const LEAD_BOARDS_PREFIX: QueryKey = queryKeys.leads.board(undefined).slice(0, 2);
+
+/** What `useDeleteLead` wrote, one entry per board cache entry it patched. */
+type LeadRemovalSnapshot = { boards: Array<{ key: QueryKey; previous: LeadsInfiniteData }> };
+
+function isNotFound(error: unknown): boolean {
+  return (
+    typeof error === 'object' &&
+    error !== null &&
+    (error as { status?: unknown }).status === 404
+  );
+}
+
+/**
+ * Moves a lead to the lixeira (`POST /leads/:id/delete`), OPTIMISTICALLY.
+ *
+ * Unlike `useMoveLead`, the patch sweeps EVERY cached board entry, whatever its
+ * filters. Removing a card can never make it appear twice, which is the hazard
+ * that keeps the move patch on one key, and a lead deleted under one vendedor
+ * filter must not survive in the unfiltered board the operator switches back to.
+ *
+ * Each patched entry is restored WHOLE from its own snapshot on error, so the
+ * revert is exact by construction. A `404` is NOT an error here: the lead is
+ * already gone (deleted elsewhere, or no longer in this viewer's scope), which
+ * is the outcome the operator asked for, so the card stays removed and the
+ * mutation resolves. Every outcome invalidates the leads root on settle.
+ */
+export function useDeleteLead() {
+  const { getToken } = useAccessToken();
+  const queryClient = useQueryClient();
+  return useAppMutation<void, Error, string, LeadRemovalSnapshot>({
+    mutationFn: async (leadId) => {
+      try {
+        await deleteLead(await requireToken(getToken), leadId);
+      } catch (error: unknown) {
+        if (isNotFound(error)) return;
+        throw error;
+      }
+    },
+    invalidates: [queryKeys.leads.all],
+    onMutate: async (leadId) => {
+      // An in-flight page fetch must not land on top of the optimistic removal.
+      await queryClient.cancelQueries({ queryKey: queryKeys.leads.all });
+      const boards: LeadRemovalSnapshot['boards'] = [];
+      for (const [key, data] of queryClient.getQueriesData<LeadsInfiniteData>({
+        queryKey: LEAD_BOARDS_PREFIX,
+      })) {
+        if (!data) continue;
+        const patch = optimisticLeadRemoval(data, leadId);
+        if (patch.next === data) continue;
+        boards.push({ key, previous: data });
+        queryClient.setQueryData(key, patch.next);
+      }
+      return { boards };
+    },
+    onError: (_error, _leadId, snapshot) => {
+      for (const { key, previous } of snapshot?.boards ?? []) {
+        queryClient.setQueryData(key, previous);
+      }
+    },
+  });
+}
+
 /**
  * No optimistic write: a low-frequency admin write on a small list behind an
  * `Atualizando` indicator. An optimistic stage row would buy nothing and would
diff --git a/apps/web/src/sales-ops/leads/optimistic.ts b/apps/web/src/sales-ops/leads/optimistic.ts
index 32ff59c..22c0244 100644
--- a/apps/web/src/sales-ops/leads/optimistic.ts
+++ b/apps/web/src/sales-ops/leads/optimistic.ts
@@ -18,7 +18,7 @@ export type OptimisticLeadPatch = {
   next: LeadsInfiniteData;
   /** the untouched snapshot, for onError rollback */
   previous: LeadsInfiniteData;
-  /** the id of the lead that moved */
+  /** the id of the lead that moved (or, for a removal, left the board) */
   leadId: string;
 };
 
@@ -136,6 +136,42 @@ export function optimisticLeadMove(
   };
 }
 
+/**
+ * The delete patch: the lead leaves every page it sits on and the rest of ITS
+ * column is re-densified with the same `densify` the move patch uses (the server
+ * closes the gap in the same transaction; the settle-time refetch brings its
+ * integers). Every other row comes out as the exact object that went in. An id
+ * no page holds hands back the identical snapshot, so the caller can tell a
+ * board that never showed the card from one it must patch.
+ */
+export function optimisticLeadRemoval(
+  previous: LeadsInfiniteData,
+  leadId: string,
+): OptimisticLeadPatch {
+  const flat = flattenLeadPages(previous);
+  const removed = flat.find((row) => row.id === leadId);
+  if (!removed) return { next: previous, previous, leadId };
+
+  const replacements = new Map<string, SalesOpsLead>();
+  densify(
+    leadsInStage(flat, removed.stageId).filter((row) => row.id !== leadId),
+    replacements,
+  );
+  return {
+    next: {
+      pages: previous.pages.map((page) => ({
+        ...page,
+        leads: page.leads
+          .filter((row) => row.id !== leadId)
+          .map((row) => replacements.get(row.id) ?? row),
+      })),
+      pageParams: previous.pageParams,
+    },
+    previous,
+    leadId,
+  };
+}
+
 /**
  * Swap the row the server returned for whatever sits under its id, leaving every
  * other row and every page boundary alone. Mirrors `reconcileOptimisticRow`, for
```
