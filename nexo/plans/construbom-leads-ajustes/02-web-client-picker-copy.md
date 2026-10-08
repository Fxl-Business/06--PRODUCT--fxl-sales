---
id: 02-web-client-picker-copy
milestone: v4.7.0
status: done
depends_on: []
files_modified: [apps/web/src/sales-ops/leads/client-picker-copy.ts, apps/web/src/sales-ops/leads/contact-lead.ts, apps/web/src/sales-ops/leads/ContactLeadDialog.tsx, apps/web/src/sales-ops/leads/LeadDialog.tsx, apps/web/src/sales-ops/leads/__tests__/client-picker-copy.test.ts, apps/web/src/sales-ops/leads/__tests__/contact-lead-dialog.test.tsx, apps/web/src/sales-ops/leads/__tests__/lead-dialog.test.tsx]
oracle: [apps/web/src/sales-ops/leads/__tests__/client-picker-copy.test.ts, apps/web/src/sales-ops/leads/__tests__/contact-lead-dialog.test.tsx, apps/web/src/sales-ops/leads/__tests__/lead-dialog.test.tsx, apps/web/src/sales-ops/leads/__tests__/contact-lead.test.ts, apps/web/src/sales-ops/leads/__tests__/lead-delete.test.tsx, apps/web/src/sales-ops/leads/__tests__/leads-contact-container.test.tsx, apps/web/src/sales-ops/leads/__tests__/leads-full-edition.test.tsx, apps/web/src/sales-ops/leads/__tests__/board-write-surface.test.ts, apps/web/src/components/ui/__tests__/combobox.test.tsx]
acceptance: ["AC5a: ContactLeadDialog rendered WITH onCreateClient shows the cliente trigger text 'Buscar ou criar novo cliente' (with data-placeholder) and, once opened, a search input whose placeholder AND aria-label are 'Buscar ou criar novo cliente'; the Criar row is still offered for an unknown name.", "AC5b: ContactLeadDialog rendered WITHOUT onCreateClient shows 'Buscar cliente cadastrado' on the trigger and as the search placeholder and aria-label, offers no [data-combobox-create] row for an unknown name, and no picker copy contains 'criar'.", "AC6: LeadDialog (full edition) shows 'Buscar cliente cadastrado' on the 'Empresa (cliente cadastrado)' trigger and as its search placeholder and aria-label, and still offers no [data-combobox-create] row.", "Escape on the open cliente picker search field (found by its new accessible name) closes only the panel in BOTH dialogs, inside the REAL Dialog: onOpenChange is not called; a bare Escape on the trigger still closes the dialog (positive control).", "The two approved literals are pinned exactly once, in client-picker-copy.test.ts; the dialog tests import CLIENT_PICKER_COPY. The strings 'Selecione ou crie um cliente' and 'Selecione o cliente' no longer exist in apps/web/src.", "The Combobox default searchPlaceholder 'Buscar...' is unchanged (combobox.test.tsx stays green); no file outside files_modified changes; no em dash character is introduced."]
---

# Slice 02 - Texto do campo de cliente nos dois diálogos de lead (AC5-AC6)

## Goal

The cliente picker in both lead dialogs tells the operator what it does.
In the leads edition, where the picker creates a cliente inline, the trigger and the search field read `Buscar ou criar novo cliente`.
Where the picker cannot create (the full edition always, the leads edition when `onCreateClient` is absent), both read `Buscar cliente cadastrado` and never promise creation.

## Design decisions (final, the executor makes none)

- ONE new pure copy module, `apps/web/src/sales-ops/leads/client-picker-copy.ts`, holds both strings and the one rule.
  Why a new module: the copy is shared by two dialogs of two editions; `contact-lead.ts` is the leads-edition module (the full-edition `LeadDialog` must not import it), `LeadDialog.tsx` keeps its copy inline, and this repo never exports a `*_COPY` constant from a `.tsx` file (every one lives in a pure `*-copy.ts` / `.ts` module: `delete-copy.ts`, `import-copy.ts`, `forbidden-copy.ts`, `contact-lead.ts`).
- The exact strings:
  - `CLIENT_PICKER_COPY.searchOrCreate = 'Buscar ou criar novo cliente'`
  - `CLIENT_PICKER_COPY.searchOnly = 'Buscar cliente cadastrado'`
- The leads-edition no-create case reuses `searchOnly` (the planner fixes it as `Buscar cliente cadastrado`, not a third string such as `Buscar cliente`): both no-create pickers search only the existing cadastro, so one string covers both and the rule has exactly two outcomes.
- No trailing ellipsis: the trigger and the search field read the SAME string, verbatim as the human approved it (AC5/AC6 say both "read" it).
- The trigger placeholder and `searchPlaceholder` take the same value. `searchPlaceholder` is also the search input's `aria-label` (`combobox.tsx:346`), so the accessible name changes with it; that is intended.
- In `ContactLeadDialog` ONE boolean, `canCreateClient`, drives both the create row (`onCreate` spread) and the copy, so the copy can never promise a creation the picker cannot perform.
- `CONTACT_LEAD_COPY.clientPlaceholder` is DELETED (its only reader is `ContactLeadDialog.tsx:202`; verified by grep, no test reads it), so the client picker copy has one home.
- The `Combobox` primitive is NOT touched: its defaults (`placeholder = 'Selecionar...'`, `searchPlaceholder = 'Buscar...'`, `combobox.tsx:71,73`) stay, and `combobox.test.tsx:572` keeps pinning `Buscar...`.

## Verified context (worktree at b3ceab7)

- `apps/web/src/sales-ops/leads/contact-lead.ts:15-39` - `CONTACT_LEAD_COPY`; line 24 `clientLabel: 'Cliente'`, line 25 `clientPlaceholder: 'Selecione ou crie um cliente'`.
  `LeadsBoard.tsx:88,580,589` and `LeadCard.tsx:38,245` (slice 01's files) import `CONTACT_LEAD_COPY` but read only `emptyStagesAdmin`, `emptyStagesSeller`, `emptyStagesAdminAction`, `birthdayPrefix`; deleting `clientPlaceholder` does not touch them.
- `apps/web/src/sales-ops/leads/ContactLeadDialog.tsx`
  - imports: lines 15-24 `./board-ui`, lines 25-32 `./contact-lead`, line 33 `./delete-copy`.
  - props: `onCreateClient?: (name: string) => Promise<ComboboxOption | null>` (line 70); destructured at line 103.
  - `showBlocked` computed at lines 120-121.
  - cliente `Combobox` at lines 194-205: `aria-labelledby="lead-client-label"`, `entityGender="m"`, `entityLabel="cliente"`, line 200 `{...(onCreateClient ? { onCreate: (name) => void createClient(name) } : {})}`, line 202 `placeholder={CONTACT_LEAD_COPY.clientPlaceholder}`, `value`, `valueLabel`.
  - `createClient` (lines 134-145) has a free-text branch for `!onCreateClient` that is unreachable (the create row is only wired with `onCreateClient`). OUT OF SCOPE: do not touch it.
- `apps/web/src/sales-ops/leads/LeadDialog.tsx`
  - imports: lines 15-24 `./board-ui`, line 25 `./delete-copy`.
  - label `Empresa (cliente cadastrado)` at lines 195-197; the "No `onCreate`" comment at lines 198-202; cliente `Combobox` at lines 204-214 with line 212 `placeholder="Selecione o cliente"`; no `onCreate`, no `entityLabel`.
- `apps/web/src/components/ui/combobox.tsx`: `placeholder` (trigger text when nothing resolves, line 257; the trigger gets `data-placeholder=""` then, line 326), `searchPlaceholder` (input `aria-label` line 346 and `placeholder` line 351), create row `[data-combobox-create]` (line 381) shown only when `onCreate` is passed and the query is non-empty and matches no label (`combobox-filter.ts:100-108`).
  It already calls `useInlineLayer(open)` (line 93), so Escape inside a dialog closes only the panel.
- Production wiring: `SalesOpsApp.tsx:2349-2352` always passes `onCreateClient` to `LeadsBoardContainer`, which passes it to `ContactLeadDialog` (`LeadsBoardContainer.tsx:290-294`); `LeadDialog` is rendered at `LeadsBoardContainer.tsx:272-286` with no create prop.
  So the leads edition in the product always shows `Buscar ou criar novo cliente`.
- Tests that open these pickers find the search box by `input[type="text"]` under the listbox's parent (`contact-lead-dialog.test.tsx:117-123`, `lead-dialog.test.tsx:147-149`), never by the `Buscar...` aria-label.
  Grep over the whole repo (excluding `node_modules`, `dist`, `.git`): no test, e2e script or doc references `Selecione o cliente`, `Selecione ou crie um cliente`, `clientPlaceholder` or a lead-dialog `Buscar...`.
  The only `Buscar...` assertion is `combobox.test.tsx:572`, on the primitive's default, which this slice keeps.
  NO pre-existing test needs its query updated.
- Text-absence assertions checked against the new strings: `contact-lead-dialog.test.tsx:386` (`not.toContain('Novo lead')`, case-sensitive, `novo cliente` does not match), `contact-lead-dialog.test.tsx:196` (`not.toContain('Produtos')`), `lead-dialog.test.tsx:208` (`not.toContain('Etapa')`). All stay green.
- `board-write-surface.test.ts:54-72` scans `LeadDialog.tsx`, `ContactLeadDialog.tsx` and `contact-lead.ts` (OWNED_FILES). The new import of `./client-picker-copy` trips none of its rules (it bans `@/lib/app-mutation`, `@/lib/api-client`, `/transition`, inline `kind ===`, the quoted literal `'converted'`).
  The new module is NOT added to OWNED_FILES (that test is not this slice's file, and the scanner never requires every `leads/` file to be listed: `api.ts`, `hooks.ts`, `types.ts` are not).
- `apps/web/vitest.config.ts:19-20`: default environment `node`, include `src/**/__tests__/**/*.test.ts(x)`; the DOM tests opt in with `// @vitest-environment happy-dom`.
- `apps/web/eslint.config.js`: `react-refresh/only-export-components` is `warn` with `allowConstantExport`; irrelevant here because the constant lives in a `.ts` module.

## Exact changes

### 1. NEW `apps/web/src/sales-ops/leads/client-picker-copy.ts`

```ts
/**
 * The cliente picker's copy in both lead dialogs: the trigger placeholder AND the
 * search field (the `Combobox` `searchPlaceholder`, which is also the search
 * input's accessible name). Pure and React-free.
 *
 * The copy promises creation only where the picker really offers the create row:
 * the leads edition's `ContactLeadDialog` while `onCreateClient` is wired. The
 * full edition's `LeadDialog` never creates a cliente (that happens at
 * conversion, inside the proposta flow), so it always reads `searchOnly`.
 */

export const CLIENT_PICKER_COPY = {
  searchOrCreate: 'Buscar ou criar novo cliente',
  searchOnly: 'Buscar cliente cadastrado',
} as const;

/** The one rule: `searchOrCreate` only when the create row is offered. */
export function clientPickerCopy(canCreate: boolean): string {
  return canCreate ? CLIENT_PICKER_COPY.searchOrCreate : CLIENT_PICKER_COPY.searchOnly;
}
```

The file imports nothing.

### 2. `apps/web/src/sales-ops/leads/contact-lead.ts`

Delete line 25 (`  clientPlaceholder: 'Selecione ou crie um cliente',`).
Nothing else in this file changes.

### 3. `apps/web/src/sales-ops/leads/ContactLeadDialog.tsx`

- Add the import between the `./board-ui` block (ends line 24) and the `./contact-lead` block (starts line 25):
  ```ts
  import { clientPickerCopy } from './client-picker-copy';
  ```
- Right after `showBlocked` (lines 120-121), add:
  ```ts
  // One boolean drives both the create row and the copy, so the picker never
  // promises a creation it cannot perform.
  const canCreateClient = Boolean(onCreateClient);
  const clientPickerText = clientPickerCopy(canCreateClient);
  ```
- In the cliente `Combobox` (lines 194-205):
  - line 200 becomes `{...(canCreateClient ? { onCreate: (name) => void createClient(name) } : {})}` (same behaviour, now keyed on the shared boolean; `createClient` already handles an absent `onCreateClient`, so no narrowing is needed);
  - line 202 becomes `placeholder={clientPickerText}`;
  - add `searchPlaceholder={clientPickerText}` on the next line (props stay alphabetical: `placeholder`, `searchPlaceholder`, `value`, `valueLabel`).
- Nothing else changes: `entityLabel="cliente"`, `entityGender="m"`, `aria-labelledby`, `valueLabel`, the `Limpar` button, and the vendedor picker (`placeholder={CONTACT_LEAD_COPY.sellerPlaceholder}`, default search copy) stay as they are.

### 4. `apps/web/src/sales-ops/leads/LeadDialog.tsx`

- Add the import between the `./board-ui` block (ends line 24) and line 25 `./delete-copy`:
  ```ts
  import { CLIENT_PICKER_COPY } from './client-picker-copy';
  ```
- Extend the comment at lines 198-202 with one sentence, so it reads:
  ```tsx
  {/*
    No `onCreate`: a lead never creates a `sales_ops_clients` row. The
    resolve-or-create happens at conversion time, inside the proposta
    flow, where the record is complete enough to be worth persisting.
    So the copy never promises a creation either.
  */}
  ```
- Line 212 `placeholder="Selecione o cliente"` becomes `placeholder={CLIENT_PICKER_COPY.searchOnly}`, followed by a new line `searchPlaceholder={CLIENT_PICKER_COPY.searchOnly}`.
- Still no `onCreate`, no `entityLabel`. The product and vendedor pickers (`Selecione o produto`, `Selecione o vendedor`) are NOT touched.

## Red-first tests (write these first, run them, see them fail, then make the changes above)

Run from `apps/web`: `pnpm exec vitest run src/sales-ops/leads/__tests__/client-picker-copy.test.ts src/sales-ops/leads/__tests__/contact-lead-dialog.test.tsx src/sales-ops/leads/__tests__/lead-dialog.test.tsx` (run-once, never watch).
Expected red before the product change: the pure test fails to import the missing module; the copy tests see the old trigger text and `Buscar...`; the Escape tests throw `cliente search not found by its name`.

### A. NEW `apps/web/src/sales-ops/leads/__tests__/client-picker-copy.test.ts`

Node environment (no `@vitest-environment` line), style of `contact-lead.test.ts`.
This is the ONE place the approved literals are written in a test.

```ts
import { describe, expect, it } from 'vitest';
import { CLIENT_PICKER_COPY, clientPickerCopy } from '../client-picker-copy';

/**
 * The cliente picker copy in both lead dialogs. The approved literals are pinned
 * here and only here; the dialog tests import the constants.
 */

describe('client picker copy', () => {
  it('pins the approved strings', () => {
    expect(CLIENT_PICKER_COPY.searchOrCreate).toBe('Buscar ou criar novo cliente');
    expect(CLIENT_PICKER_COPY.searchOnly).toBe('Buscar cliente cadastrado');
  });

  it('promises creation only when the create row is offered', () => {
    expect(clientPickerCopy(true)).toBe(CLIENT_PICKER_COPY.searchOrCreate);
    expect(clientPickerCopy(false)).toBe(CLIENT_PICKER_COPY.searchOnly);
    expect(clientPickerCopy(false)).not.toMatch(/criar/i);
  });
});
```

### B. `apps/web/src/sales-ops/leads/__tests__/contact-lead-dialog.test.tsx` (additions only)

- Import: `import { CLIENT_PICKER_COPY } from '../client-picker-copy';` after the `../ContactLeadDialog` import (line 6).
- Add three tests inside the existing `describe('ContactLeadDialog', ...)`, after `creates a client by name inline through onCreateClient` (ends line 335), reusing the existing helpers `clientTrigger` (134-138), `comboboxSearch` (117-123), `click`, `typeInto`, `escape` (62-69) and `renderDialog` (151-169):

```tsx
  it('with inline create wired, the cliente trigger and search read Buscar ou criar novo cliente (AC5)', async () => {
    await renderDialog({ onCreateClient: vi.fn(async () => null) });
    expect(clientTrigger().textContent?.trim()).toBe(CLIENT_PICKER_COPY.searchOrCreate);
    expect(clientTrigger().hasAttribute('data-placeholder')).toBe(true);

    await click(clientTrigger());
    const search = comboboxSearch();
    expect(search.getAttribute('placeholder')).toBe(CLIENT_PICKER_COPY.searchOrCreate);
    expect(search.getAttribute('aria-label')).toBe(CLIENT_PICKER_COPY.searchOrCreate);

    // The copy keeps its promise: an unknown name offers the Criar row.
    await typeInto(search, 'Nova Obra');
    expect(document.querySelector('[data-combobox-create]')).not.toBeNull();
  });

  it('without onCreateClient the cliente picker never promises creation (AC5)', async () => {
    await renderDialog();
    expect(clientTrigger().textContent?.trim()).toBe(CLIENT_PICKER_COPY.searchOnly);

    await click(clientTrigger());
    const search = comboboxSearch();
    expect(search.getAttribute('placeholder')).toBe(CLIENT_PICKER_COPY.searchOnly);
    expect(search.getAttribute('aria-label')).toBe(CLIENT_PICKER_COPY.searchOnly);

    await typeInto(search, 'Nova Obra');
    expect(document.querySelector('[data-combobox-create]')).toBeNull();
    expect(clientTrigger().textContent ?? '').not.toMatch(/criar/i);
    expect(search.getAttribute('placeholder') ?? '').not.toMatch(/criar/i);
  });

  it('Escape on the open cliente picker closes only the picker', async () => {
    const { onOpenChange } = await renderDialog({ onCreateClient: vi.fn(async () => null) });
    await click(clientTrigger());
    const search = document.querySelector(
      `input[aria-label="${CLIENT_PICKER_COPY.searchOrCreate}"]`,
    );
    if (!(search instanceof HTMLInputElement)) throw new Error('cliente search not found by its name');

    await escape(search);
    expect(document.querySelector('[role="listbox"]')).toBeNull();
    expect(onOpenChange).not.toHaveBeenCalled();

    // Positive control: the real Radix dialog does close on a bare Escape.
    await escape(clientTrigger());
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
```

`vi.fn(async () => null)` satisfies `onCreateClient` (`Promise<ComboboxOption | null>`); it is never called by these tests except via the create row, which they do not click.
No existing test in this file is edited.

### C. `apps/web/src/sales-ops/leads/__tests__/lead-dialog.test.tsx` (additions only)

- Import: `import { CLIENT_PICKER_COPY } from '../client-picker-copy';` after the `../LeadDialog` import (line 6).
- Add an `escape` helper after `click` (ends line 66), identical to `contact-lead-dialog.test.tsx:62-69`:
  ```tsx
  async function escape(element: Element) {
    await act(async () => {
      element.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }),
      );
    });
    await settle();
  }
  ```
- Add a `clientTrigger` helper after `comboboxTriggers` (ends line 101):
  ```tsx
  function clientTrigger(): HTMLButtonElement {
    const node = dialogNode().querySelector('[role="combobox"][aria-labelledby="lead-client-label"]');
    if (!(node instanceof HTMLButtonElement)) throw new Error('cliente picker missing');
    return node;
  }
  ```
- Add two tests inside `describe('LeadDialog', ...)`, after `offers no create row on the cliente picker` (ends line 156). `renderDialog` already spreads `overrides` after `onOpenChange={vi.fn()}` (lines 127, 132), so passing `onOpenChange` in overrides needs no helper change:

```tsx
  it('the cliente picker reads Buscar cliente cadastrado on the trigger and the search field (AC6)', async () => {
    await renderDialog();
    expect(clientTrigger().textContent?.trim()).toBe(CLIENT_PICKER_COPY.searchOnly);
    expect(clientTrigger().hasAttribute('data-placeholder')).toBe(true);

    await click(clientTrigger());
    const search = document.querySelector('[role="listbox"]')?.parentElement?.querySelector(
      'input[type="text"]',
    );
    if (!(search instanceof HTMLInputElement)) throw new Error('search field missing');
    expect(search.getAttribute('placeholder')).toBe(CLIENT_PICKER_COPY.searchOnly);
    expect(search.getAttribute('aria-label')).toBe(CLIENT_PICKER_COPY.searchOnly);

    // Still no create row: a full-edition lead never creates a cliente.
    await typeInto(search, 'Empresa que não existe');
    expect(document.querySelector('[data-combobox-create]')).toBeNull();
  });

  it('Escape on the open cliente picker closes only the picker', async () => {
    const onOpenChange = vi.fn();
    await renderDialog({ onOpenChange });
    await click(clientTrigger());
    const search = document.querySelector(`input[aria-label="${CLIENT_PICKER_COPY.searchOnly}"]`);
    if (!(search instanceof HTMLInputElement)) throw new Error('cliente search not found by its name');

    await escape(search);
    expect(document.querySelector('[role="listbox"]')).toBeNull();
    expect(onOpenChange).not.toHaveBeenCalled();

    // Positive control: the real Radix dialog does close on a bare Escape.
    await escape(clientTrigger());
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
```

No existing test in this file is edited.

## Pre-existing tests to keep green (no edits)

- `apps/web/src/sales-ops/leads/__tests__/contact-lead-dialog.test.tsx` (every existing test, incl. `creates a client by name inline through onCreateClient`, `Escape on the open vendedor picker closes only the picker`, `renders the contact fields plus empresa and valor, in order`).
- `apps/web/src/sales-ops/leads/__tests__/lead-dialog.test.tsx` (every existing test, incl. `offers no create row on the cliente picker`, `offers no etapa picker at all`).
- `apps/web/src/sales-ops/leads/__tests__/contact-lead.test.ts` (does not read `clientPlaceholder`).
- `apps/web/src/sales-ops/leads/__tests__/lead-delete.test.tsx` (renders both dialogs at lines 640-670).
- `apps/web/src/sales-ops/leads/__tests__/leads-contact-container.test.tsx`, `leads-full-edition.test.tsx` (render the dialogs through the container).
- `apps/web/src/sales-ops/leads/__tests__/board-write-surface.test.ts` (scans both dialogs and `contact-lead.ts`).
- `apps/web/src/components/ui/__tests__/combobox.test.tsx` (pins the primitive's default `Buscar...` at line 572).

## Verification (Gate 2 for this slice)

From the slice worktree, run-once only:

```bash
cd apps/web
pnpm exec vitest run \
  src/sales-ops/leads/__tests__/client-picker-copy.test.ts \
  src/sales-ops/leads/__tests__/contact-lead-dialog.test.tsx \
  src/sales-ops/leads/__tests__/lead-dialog.test.tsx \
  src/sales-ops/leads/__tests__/contact-lead.test.ts \
  src/sales-ops/leads/__tests__/lead-delete.test.tsx \
  src/sales-ops/leads/__tests__/leads-contact-container.test.tsx \
  src/sales-ops/leads/__tests__/leads-full-edition.test.tsx \
  src/sales-ops/leads/__tests__/board-write-surface.test.ts \
  src/components/ui/__tests__/combobox.test.tsx
pnpm exec eslint \
  src/sales-ops/leads/client-picker-copy.ts \
  src/sales-ops/leads/contact-lead.ts \
  src/sales-ops/leads/ContactLeadDialog.tsx \
  src/sales-ops/leads/LeadDialog.tsx \
  src/sales-ops/leads/__tests__/client-picker-copy.test.ts \
  src/sales-ops/leads/__tests__/contact-lead-dialog.test.tsx \
  src/sales-ops/leads/__tests__/lead-dialog.test.tsx
pnpm run type-check
```

Plus these greps, each expected to print nothing (use `grep -rn`, not `git grep`, and check the exit code is 1, not an error):

```bash
grep -rn -e 'Selecione ou crie um cliente' -e 'Selecione o cliente' -e 'clientPlaceholder' apps/web/src
grep -rn "$(printf '\342\200\224')" apps/web/src/sales-ops/leads/client-picker-copy.ts apps/web/src/sales-ops/leads/ContactLeadDialog.tsx apps/web/src/sales-ops/leads/LeadDialog.tsx apps/web/src/sales-ops/leads/contact-lead.ts apps/web/src/sales-ops/leads/__tests__/client-picker-copy.test.ts apps/web/src/sales-ops/leads/__tests__/contact-lead-dialog.test.tsx apps/web/src/sales-ops/leads/__tests__/lead-dialog.test.tsx
```

Recommended visual check (the user is picky about UI; happy-dom does not lay out): `make dev-fake`, sign in as `leads-owner`, open `Operacional > Leads > Novo lead` and confirm the 44px cliente trigger beside `Limpar` shows `Buscar ou criar novo cliente` on one line, and the opened panel's search field shows the same text; then as `team-owner` (full edition) open `Novo lead` and confirm `Buscar cliente cadastrado` on the `Empresa (cliente cadastrado)` trigger and search.
Stop the dev processes you started by their process group (`kill -- -"$pgid"`), never by name.

## Constraints

- Touch ONLY the files in `files_modified`. Slice 01 owns `LeadsBoard.tsx`, `LeadCard.tsx`, `board-labels.ts` and the board tests (including `board-write-surface.test.ts`); slice 03 owns the import domain. Do not edit them.
- Never write the em dash character anywhere (code, comments, test names, commit message); use a plain dash.
- Do not change `combobox.tsx` or `inline-layer.ts`. The Escape guard comes from `Combobox`'s own `useInlineLayer(open)`; the new Escape tests run inside the REAL `Dialog` and assert `onOpenChange` was NOT called, with the bare-Escape positive control.
- `LeadDialog` gets no `onCreate` and no `entityLabel` (CLAUDE.md, UI Controls: `onCreate` only where an inline create yields a complete record; the full-edition lead never creates a cliente).
- Keep JSX props alphabetical and the surrounding style (two-space indent, single quotes, trailing commas). In the dialogs, do not add a quoted `'converted'` literal, a `/transition` path or an inline `kind ===` comparison (board-write-surface scans these files).
- No `CHANGELOG.md` edits.

## Out of scope

- The unreachable free-text branch of `ContactLeadDialog.createClient` (lines 135-140).
- The produto and vendedor pickers' copy in either dialog, and every other `Combobox` in the app (e.g. the proposta wizard's `Buscar ou digitar um novo cliente...` at `SalesOpsApp.tsx:8161`).
- The `emptyMessage` of the cliente picker (stays the primitive's default).

## Handoff to Capture (AC13, not this slice's files)

Suggested rule text for `CLAUDE.md` "UI Controls" and `nexo/knowledge/reference/ui-controls.md`:
"A picker's copy promises creation only where `onCreate` is wired. The lead dialogs' cliente picker reads `clientPickerCopy(canCreate)` from `apps/web/src/sales-ops/leads/client-picker-copy.ts` on BOTH the trigger and the search field: `Buscar ou criar novo cliente` in `ContactLeadDialog` while `onCreateClient` is wired, otherwise `Buscar cliente cadastrado` (always in the full edition's `LeadDialog`)."
And in the "Edição Leads" bullet about the contact dialog's empresa picker, mention that its copy is `Buscar ou criar novo cliente`.
