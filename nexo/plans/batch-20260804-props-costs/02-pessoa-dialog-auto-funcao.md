---
id: 02-pessoa-dialog-auto-funcao
milestone: v2.4.0
status: todo
depends_on: []
files_modified:
  - apps/web/src/sales-ops/SalesOpsApp.tsx
  - apps/web/src/sales-ops/__tests__/pessoas-funcoes-view.test.tsx
  - apps/web/src/sales-ops/__tests__/cadastros-refresh.test.tsx
  - apps/web/src/sales-ops/__tests__/optimistic-row-guard.test.tsx
acceptance: "Given the Pessoa dialog with an unassigned active função, when the operator picks it in the `Função da pessoa` Combobox, then it is appended to the assigned list, the picker falls back to its `Selecione uma função` placeholder, and no `Adicionar função` button exists anywhere in the dialog."
---

# 02 — Pessoa dialog: picking a função assigns it

## 1. Current behaviour

Everything lives in `PersonDialogBody` in `apps/web/src/sales-ops/SalesOpsApp.tsx` (declared at
line 4831; exported wrapper `PersonDialog` at line 4809).

| What | Where |
| --- | --- |
| `const [pendingFuncaoId, setPendingFuncaoId] = useState('');` | `SalesOpsApp.tsx:4852` |
| `assignedFuncoes` (chips, resolved against the UNFILTERED catalogue + `createdFuncoes` + the pessoa's own rows) | `SalesOpsApp.tsx:4867-4873` |
| `selectableFuncoes` (`status === 'active'` AND `!assignedIds.includes(id)`) | `SalesOpsApp.tsx:4874-4876` |
| `function assignFuncao(id: string)` — the shared append | `SalesOpsApp.tsx:4878-4882` |
| `async function handleCreateFuncao(query)` — ends with `assignFuncao(created.id)` | `SalesOpsApp.tsx:4890-4898` (call at 4897) |
| `submit` guard `assignedIds.length === 0` | `SalesOpsApp.tsx:4900-4910` |
| `FieldBlock label="Funções" required` | `SalesOpsApp.tsx:4950` |
| chip rows + `Remover função ${funcao.name}` X buttons | `SalesOpsApp.tsx:4951-4980` |
| picker row wrapper `<div className="flex items-center gap-2">` + inner `<div className="flex-1">` | `SalesOpsApp.tsx:4981-4982` (closers at 4995 and 4999) |
| `<Combobox aria-label="Função da pessoa" …>` | `SalesOpsApp.tsx:4983-4994` |
| `onChange={setPendingFuncaoId}` | `SalesOpsApp.tsx:4988` |
| `onCreate={onCreateFuncao ? (query) => void handleCreateFuncao(query) : undefined}` | `SalesOpsApp.tsx:4989` |
| `value={pendingFuncaoId}` | `SalesOpsApp.tsx:4993` |
| `<SecondaryButton onClick={() => assignFuncao(pendingFuncaoId)}>Adicionar função</SecondaryButton>` | `SalesOpsApp.tsx:4996-4998` |

**The shared handler already exists.** `assignFuncao` is the one append, and it is *already* the
terminus of the `onCreate` path (`handleCreateFuncao` calls it at line 4897); the create row
never needed the button and never used it; `pessoas-funcoes-view.test.tsx` "offers a create row for
a função that does not exist yet and assigns it" proves that today. The ONLY path still routed
through the button is `onChange`, which merely parks the id in `pendingFuncaoId`. So this slice
funnels `onChange` into the same `assignFuncao` the create path already uses, and deletes the
button and the now-dead parking state.

Verified against the real code, all three constraints named in CLAUDE.md hold today and must
survive: `selectableFuncoes` filters to `status === 'active'` (line 4875), it excludes
`assignedIds` (same line), and `onCreate` is wired (line 4989) — CLAUDE.md "UI Controls" says
"the função picker inside the Pessoa dialog does have one, because a função needs only a name."

`Combobox` (`apps/web/src/components/ui/combobox.tsx`) fires `onChange(option.value)` from
`commitOption` and then closes the panel; it never fires `onChange` for the create row, and it
never fires it with `''`. Its trigger is `type="button"` and its search input `preventDefault`s
Enter unconditionally, so nothing on the pick path can submit the surrounding `<form>`.

## 2. The fix

All edits are inside `PersonDialogBody`. No new imports, no new helper, no `useCallback`.

1. **Delete the parking state.** Remove line 4852 (`const [pendingFuncaoId, setPendingFuncaoId] =
   useState('');`) entirely. Leaving it in place fails `pnpm run lint` as an unused binding.

2. **Trim `assignFuncao` (4878-4882).** Remove the `setPendingFuncaoId('');` line (4881). Keep the
   `if (!id) return;` guard and keep the idempotent `current.includes(id) ? current : [...current, id]`
   body unchanged — `assignFuncao` stays the single append reached by both paths.

3. **Route `onChange` into it.** Line 4988 becomes `onChange={assignFuncao}`. The signatures already
   match: `ComboboxProps['onChange']` is `(value: string) => void` and `assignFuncao(id: string)`.

4. **Reset the picker to empty, structurally.** Line 4993 becomes the literal `value=""`. This is the
   whole reset mechanism: with the state gone there is no selection to go stale, so the trigger
   renders `placeholder="Selecione uma função"` on every render and carries `data-placeholder`.
   Do NOT re-introduce a state variable and clear it in a handler — a literal `""` cannot drift.
   (Belt and braces anyway: the just-appended função drops out of `selectableFuncoes` on the same
   render via the `!assignedIds.includes` filter, so even a stale id would resolve to no label.)

5. **Delete the button and its layout scaffold.** Remove the `<SecondaryButton …>Adicionar função
   </SecondaryButton>` block (4996-4998), the `<div className="flex items-center gap-2">` wrapper
   (4981, closer 4999) and the inner `<div className="flex-1">` (4982, closer 4995). Render
   `<Combobox …/>` as a direct child of `FieldBlock`, immediately after the chips / empty-state
   ternary. `FieldBlock` (`SalesOpsApp.tsx:643-661`) is already `flex flex-col gap-[6px]` and the
   Combobox root is `relative w-full`, so the picker keeps full width with correct spacing and
   `flex-1` is not needed. `SecondaryButton` stays imported/defined — it has many other call sites.

**Explicitly unchanged** (touching any of these is out of scope and breaks an invariant):
`aria-label="Função da pessoa"`, `className={formSelectClass}` (the 44px canonical size),
`entityGender="f"`, `entityLabel="função"`, `onCreate` and `handleCreateFuncao`,
`placeholder="Selecione uma função"`, `searchPlaceholder="Buscar função..."`, `options={selectableFuncoes}`
and its two filters, `assignedFuncoes`, `createdFuncoes`, the `Remover função …` X buttons, the
`Atribua ao menos uma função.` empty state, and the `submit` / `PrimaryButton disabled` guards.

## 3. The named oracle test

### 3a. Update the four existing call sites that click the button

Delete the `await click(buttonByText('Adicionar função'));` line at each of these; the preceding
`pickOption(...)` / option-row click now does the assignment on its own. Every surrounding
assertion stays as-is.

- `apps/web/src/sales-ops/__tests__/pessoas-funcoes-view.test.tsx:277, 281, 319, 342`
- `apps/web/src/sales-ops/__tests__/cadastros-refresh.test.tsx:401`
- `apps/web/src/sales-ops/__tests__/optimistic-row-guard.test.tsx:402, 632`

One comment must be rewritten, not just deleted: `pessoas-funcoes-view.test.tsx:289` reads
"`Adicionar função` was clicked twice above; it must never submit the form." Keep the
`expect(onSave).not.toHaveBeenCalled();` below it and restate the claim as "two funções were picked
above; committing a Combobox option must never submit the form."

### 3b. New DOM test — `apps/web/src/sales-ops/__tests__/pessoas-funcoes-view.test.tsx`

Add inside the existing `describe('pessoas cadastro')`, next to
`'assigns and removes funções before saving a pessoa'`:

```
it('assigns a função the moment it is picked, with no confirm button', ...)
```

Steps, using the helpers already in that file (`renderPersonDialog`, `pickOption`, `combobox`,
`optionRows`, `buttonByText`, `buttonByAriaLabel`, `submit`, `change`, `requireNameInput`):

1. `renderPersonDialog({ funcoes: [vendedor, finder, designer], onSave })`.
2. **Button is gone:** `expect(() => buttonByText('Adicionar função')).toThrow();`
   (`buttonByText` throws `button not found: …` when nothing matches — this is the DOM-level guard.)
3. `await pickOption('Função da pessoa', 'Designer');`
   → `expect(buttonByAriaLabel('Remover função Designer')).not.toBeNull();` (no button click).
4. **Picker reset:** `expect(combobox('Função da pessoa').textContent?.trim()).toBe('Selecione uma função');`
   and `expect(combobox('Função da pessoa').hasAttribute('data-placeholder')).toBe(true);`
   (the trigger renders `<span>{triggerText}</span>`, and `data-placeholder` is set only when the
   value resolves to no option — see `combobox.tsx`, `resolvedLabel`/`triggerText`).
5. **A pick never submits:** `expect(onSave).not.toHaveBeenCalled();`
6. **Second pick appends rather than replaces:** `await pickOption('Função da pessoa', 'Vendedor');`
   → both `Remover função Designer` and `Remover função Vendedor` are non-null; reopening the picker
   (`await click(combobox('Função da pessoa'))`) shows `optionRows()` that `not.toContain('Designer')`
   and `not.toContain('Vendedor')` but do contain `'Finder'` (positive control that the picker still
   has options at all).
7. `await change(requireNameInput(), 'Sig'); await submit();` →
   `expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ funcaoIds: [designer.id, vendedor.id] }));`
   (order is append order.)

### 3c. New source contract test — same file

Add a new `describe('pessoa dialog UI contract')` block at the end of
`apps/web/src/sales-ops/__tests__/pessoas-funcoes-view.test.tsx`:

```
it('leaves no `Adicionar função` confirm button behind in the pessoa dialog', ...)
```

Read the source exactly the way `sale-wizard-ui-contract.test.tsx:23-25` does — via
`join(dirname(fileURLToPath(import.meta.url)), '..', 'SalesOpsApp.tsx')` and `readFileSync`, NOT via
`new URL(..., import.meta.url)`: this file is `// @vitest-environment happy-dom` (line 1), and
happy-dom's global `URL` resolves against the document origin, which would turn the path into
`http://localhost:3000/...`. Add `readFileSync` / `dirname` / `join` / `fileURLToPath` imports.

Assertions, following the established `not.toContain` pattern:

- Positive controls, so the negatives are about markup that was REMOVED rather than markup that
  never existed: `expect(source).toContain('Função da pessoa');`,
  `expect(source).toContain('Selecione uma função');`, `expect(source).toContain('Buscar função...');`
- The guard: `expect(source).not.toContain('Adicionar função');`
- The dead state cannot come back: `expect(source).not.toContain('pendingFuncaoId');`
- The create row and the active filter must survive the button's removal (CLAUDE.md "UI Controls" and
  "Pessoas e Funções"): `expect(source).toContain('handleCreateFuncao');` and
  `expect(source).toContain("funcao.status === 'active' && !assignedIds.includes(funcao.id)");`

`Adicionar função` appears nowhere else in `SalesOpsApp.tsx` (grep-verified: one hit, line 4997), so
the substring negative cannot false-positive on unrelated copy. `Nova função` in `FuncoesView` is a
different string and is untouched.

### 3d. Run-once commands

`pnpm --filter <pkg> test -- <path>` does NOT filter (pnpm swallows the positional), so invoke
vitest directly — `apps/web` runs `vitest run` via `apps/web/package.json` `"test"`:

```bash
CI=true pnpm --filter @fxl-sales/web exec vitest run src/sales-ops/__tests__/pessoas-funcoes-view.test.tsx
```

Full regression for the three touched suites plus the combobox/native-picker contract:

```bash
CI=true pnpm --filter @fxl-sales/web exec vitest run \
  src/sales-ops/__tests__/pessoas-funcoes-view.test.tsx \
  src/sales-ops/__tests__/cadastros-refresh.test.tsx \
  src/sales-ops/__tests__/optimistic-row-guard.test.tsx \
  src/sales-ops/__tests__/combobox-adoption.test.tsx
```

Then the gate: `pnpm run lint && pnpm run type-check && pnpm test`.

## 4. Scope limits (YAGNI)

- **Only** `PersonDialogBody`. The `Custos padrão por função` picker in `ProductDialogBody`, the
  wizard's `FUNÇÃO NO PROJETO` picker and `FuncaoDialog` are untouched, even though the first two
  also sit next to funções.
- No multi-select Combobox, no chips-inside-the-trigger control, no `Combobox` primitive change at
  all. `apps/web/src/components/ui/combobox.tsx` is NOT edited by this slice.
- No change to the wire format: `funcaoIds` stays a full-set replacement on save.
- No reordering, no drag handles, no dedupe UI, no toast/confirmation on append — the chip appearing
  is the feedback.
- No API, schema, migration or i18n change. No visual restyle of the chips or of `FieldBlock`.
- Do not "improve" the empty state copy or the `Predefinida` badge while in there.

## 5. Risk / invariants touched

- **CLAUDE.md > Pessoas e Funções — `funcao_required`.** "Person writes send `funcaoIds` as a full
  set replacement; the API rejects an empty set with `funcao_required`." The client-side guards are
  `submit`'s `assignedIds.length === 0` early return (4902) and `PrimaryButton disabled` (5004).
  Neither is touched, and the X remove buttons can still empty the list — the dialog must keep
  refusing to save in that state and keep showing `Atribua ao menos uma função.`. The step-3b test
  `'refuses to save a pessoa without a name or without any função'` (line ~313) is the existing
  guard and must stay green after its button-click line is deleted.
- **CLAUDE.md > Pessoas e Funções — system funções.** `vendedor` and `finder` are `isSystem: true`
  and must remain *assignable* (they are ordinary picker entries here; the system flag only bans
  rename/archive and only in `FuncaoDialog`). The `Predefinida` badge on the assigned chip must
  still render. Do not add an `isSystem` filter to `selectableFuncoes` — that filter belongs to the
  produto default-cost picker, not this one.
- **CLAUDE.md > Pessoas e Funções — archived funções.** "An archived função stays visible on the
  people who already carry it but disappears from the assignment picker." The
  `assignedFuncoes`/`selectableFuncoes` split is exactly that mechanism; both are left byte-for-byte
  alone. The existing test `'keeps an archived função a pessoa already carries listed but out of the
  picker'` is the regression net.
- **CLAUDE.md > UI Controls — the native picker ban.** The replacement must stay a `Combobox`. Do not
  reach for a native `<select>` "now that there is no button" — `no-restricted-syntax` in
  `apps/web/eslint.config.js` fails lint, and `combobox-adoption.test.tsx` asserts
  `not.toContain('<select')` over `SalesOpsApp.tsx`.
- **CLAUDE.md > UI Controls — `onCreate` policy.** The create row is a deliberate, documented feature
  of *this* picker. Deleting it while deleting the button next to it would silently contradict the
  documented rule; §3c pins `handleCreateFuncao` in the source.
- **CLAUDE.md > UI Controls — `useInlineLayer` / Escape.** Unchanged by construction: the layer
  registration lives inside `Combobox`, and this slice removes a sibling button, not the picker.
- **CLAUDE.md > UI Controls — picker geometry.** `formSelectClass` (44px) stays. The button being
  gone means nothing has to line up beside it any more, but do not swap in `comboboxTriggerClass`
  (that size is the `Filtros` bar only).
- **Low residual risk:** a double-append. `assignFuncao` is already idempotent on `assignedIds`, and
  the picked option leaves `selectableFuncoes` on the same render, so a double-fire is inert.
