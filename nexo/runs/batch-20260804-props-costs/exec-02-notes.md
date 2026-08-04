# exec-02 — Pessoa dialog: picking a função assigns it

## What changed

All edits confined to `PersonDialogBody` in `apps/web/src/sales-ops/SalesOpsApp.tsx`:

1. Deleted the parking state `const [pendingFuncaoId, setPendingFuncaoId] = useState('');`.
2. Trimmed `assignFuncao` to drop the now-gone `setPendingFuncaoId('');` call; it stays the single
   idempotent append reached by both the picker `onChange` and `handleCreateFuncao`.
3. Routed the `Função da pessoa` Combobox `onChange` directly to `assignFuncao`.
4. Set the Combobox `value` to the literal `""` (structural reset — no state to go stale).
5. Deleted the `Adicionar função` `SecondaryButton` and its `flex items-center gap-2` / `flex-1`
   layout scaffold; the Combobox now renders as a direct child of `FieldBlock`.

`onCreate`, `handleCreateFuncao`, the active/unassigned filter on `selectableFuncoes`, the chip list,
`Remover função …` buttons, the `Atribua ao menos uma função.` empty state and the submit /
`PrimaryButton disabled` guards are all byte-for-byte unchanged.

## Tests

- `apps/web/src/sales-ops/__tests__/pessoas-funcoes-view.test.tsx`:
  - Removed the four `click(buttonByText('Adicionar função'))` lines inside
    "assigns and removes funções before saving a pessoa", "refuses to save a pessoa without a name
    or without any função", and "prefills the funções of the pessoa being edited and keeps its id".
  - Rewrote the stale comment ("`Adicionar função` was clicked twice above...") to describe the new
    behaviour (picking a Combobox option must never submit the form).
  - Added `it('assigns a função the moment it is picked, with no confirm button', ...)` per the plan's
    §3b steps (button absence, immediate chip append, placeholder reset with `data-placeholder`, no
    submit on pick, second pick appends, options list drops both picked funções but still offers a
    positive control).
  - Added `describe('pessoa dialog UI contract')` with the source-string contract test from §3c,
    reading `SalesOpsApp.tsx` via `readFileSync`/`dirname`/`join`/`fileURLToPath` (the happy-dom-safe
    pattern already used by `sale-wizard-ui-contract.test.tsx`).
- `apps/web/src/sales-ops/__tests__/cadastros-refresh.test.tsx`: removed the one
  `click(buttonByText('Adicionar função'))` line (was line 401).
- `apps/web/src/sales-ops/__tests__/optimistic-row-guard.test.tsx`: removed both
  `click(buttonByText('Adicionar função'))` lines (were lines 402 and 632).

## Red → Green

Ran the four touched suites before the source change: 8 failed / 26 passed, all failures were
exactly the newly-added/newly-touched assertions (button-not-found expectations tripping on the
still-present button, and the new source-contract test tripping on `'Adicionar função'` still being
in the source). This confirmed the oracle's premise.

After the source change: same four suites — 52/52 passed.

## Gates

- `pnpm run lint` — clean.
- `pnpm run type-check` — clean.
- `pnpm --filter @fxl-sales/web test` — 44 files / 491 tests passed.

No pre-existing failures encountered.
