# exec-02 - proposta wizard shell: the footer must never be clipped

Branch: `feat/02-wizard-shell-footer` (off `master` at `01a24e0`, slice 01 included).
Plan: `nexo/plans/batch-01K9NX4QPTUI0730CADPRODWIZ/02-wizard-shell-footer.md`.

## What changed

Exactly five className strings in `apps/web/src/sales-ops/SalesOpsApp.tsx`, inside `SaleWizardDialogBody`.
No JSX was moved, wrapped, reordered or added, and no copy, handler or behaviour changed.
`git diff` on that file is five single-line replacements and nothing else.

| Element | Line (now) | Change |
| --- | --- | --- |
| `DialogContent` shell | 5859 | prepended `flex h-[92vh]`, inserted `flex-col` before `gap-0`; every other token byte-identical and in the same order |
| `DialogHeader` | 5860 | prepended `shrink-0` |
| stepper `div` | 5869 | inserted `shrink-0` after `flex` |
| scroll body `div` | 5912 | `max-h-[calc(92vh-210px)] overflow-y-auto ...` becomes `min-h-0 flex-1 overflow-y-auto ...` (kept a block container, no nested flex) |
| footer `div` | 7158 | inserted `shrink-0` after `flex` |

Tests:

- NEW `apps/web/src/sales-ops/__tests__/sale-wizard-shell-layout.test.tsx` - the DOM oracle, harness copied from `sale-wizard-payment-plan.test.tsx` (happy-dom, the `vi.mock('@/components/ui/dialog', ...)` pass-through mocks, the `IS_REACT_ACT_ENVIRONMENT` / `createRoot` / `act` scaffold, a trimmed one-product/one-pessoa/one-área bootstrap).
- EXTENDED `apps/web/src/sales-ops/__tests__/sale-wizard-ui-contract.test.ts` - one new `it('keeps the wizard shell free of a hand-computed body height')`. No existing assertion was weakened or touched.

## What must survive - verified

Checked directly against the post-edit `git diff` line and pinned by the DOM oracle:

- `w-[calc(100vw-48px)]` and `max-w-[940px]` - present, and `max-w-[940px]` is what the test uses to find the shell.
- `rounded-[22px]` **and** `sm:rounded-[22px]` - both present, both asserted as exact tokens.
- `bg-[#f4f4f6]` - present, asserted.
- `overflow-hidden` - present, asserted.
- `gap-0` - present, asserted (load-bearing now that the shell is `flex flex-col`).
- `p-0` - present, asserted.
- The full twelve-variant `[&>button]:*` run - present verbatim; the test asserts `[&>button]:right-[26px]`. The child list is still header / stepper / body / footer, so no new direct-child `<button>` was introduced under `DialogContent`; every footer button stays nested inside the footer `div`.

`SaleDetailDialog` (line ~1870), `ProductDialogBody` (3476 / 3509 / 4030), `ClientDialog`, `AreaDialog`, `FuncaoDialog` and `PessoaDialog` were **not** touched, per the plan's scope note.

## Red first

Both oracles written and run against the unmodified `SalesOpsApp.tsx`.

`vitest run src/sales-ops/__tests__/sale-wizard-shell-layout.test.tsx src/sales-ops/__tests__/sale-wizard-ui-contract.test.ts`:

```
 Test Files  2 failed (2)
      Tests  2 failed | 2 passed (4)
```

DOM oracle, isolated:

```
 ❯ src/sales-ops/__tests__/sale-wizard-shell-layout.test.tsx (1 test | 1 failed) 40ms
   × sale wizard shell layout > pins the wizard shell to a flex column so the footer can never be clipped 40ms
     → expected [ 'max-h-[92vh]', …(23) ] to include 'flex'

AssertionError: expected [ 'max-h-[92vh]', …(23) ] to include 'flex'
 ❯ src/sales-ops/__tests__/sale-wizard-shell-layout.test.tsx:182:43
    180|     // the shell is a flex column with a real height
    181|     for (const token of ['flex', 'flex-col', 'h-[92vh]', 'overflow-hid…
    182|       expect(shell!.className.split(' ')).toContain(token);
```

The five positive controls (`Nova proposta`, `Pagamento`, `Cliente e responsáveis`, `Salvar rascunho`, `Avançar`) all passed before the first layout assertion, so the failure is genuinely about the classes and not about grabbing the wrong four nodes.

Source guard, isolated failure:

```
 ❯ src/sales-ops/__tests__/sale-wizard-ui-contract.test.ts:87:20
     87|     expect(source).toContain('flex h-[92vh] max-h-[92vh] w-[calc(100vw…
```

## Green

After the five className edits, same command:

```
 ✓ src/sales-ops/__tests__/sale-wizard-ui-contract.test.ts (3 tests) 11ms
 ✓ src/sales-ops/__tests__/sale-wizard-shell-layout.test.tsx (1 test) 38ms

 Test Files  2 passed (2)
      Tests  4 passed (4)
```

## Definition of done

`pnpm test`:

```
packages/shared-utils test:  Test Files  2 passed (2)
packages/shared-utils test:       Tests  23 passed (23)
apps/api test:  Test Files  29 passed (29)
apps/api test:       Tests  300 passed (300)
apps/web test:  Test Files  39 passed (39)
apps/web test:       Tests  363 passed (363)
```

Web moved from the 38 files / 361 tests baseline to 39 / 363: one new file (the DOM oracle, 1 test) plus one new `it` in the existing contract file. Nothing was lost.
API is unchanged at 29 / 300.

`pnpm run lint` - clean (`apps/api lint: Done`, `apps/web lint: Done`).
`pnpm run type-check` - clean (all four projects `Done`).

No process was left running; every vitest invocation was `vitest run`.

## Divergences from the plan

1. **Line numbers shifted by ~19.** Slice 01 merged ahead of this branch, so the shell is at 5859 (plan said 5840), header 5860, stepper 5869, body 5912 (plan said 5893), footer 7158 (plan said 7139). Every `Before:` className string in the plan matched the file **verbatim and uniquely**, so each edit landed unambiguously by content rather than by line. No adaptation to the edits themselves.
2. **The plan's test snippet does not type-check.** `const [header, stepper, body, footer] = Array.from(shell!.children) as HTMLElement[]` produced 11 `TS18048: '<name>' is possibly 'undefined'` errors under this repo's `tsc --noEmit` (indexed access is checked). Replaced with a narrowing helper - `shellChild(shell, index)` reads `shell.children.item(index)` and throws unless it `instanceof HTMLElement` - plus an `instanceof HTMLElement` guard on the shell itself, which also removed the `shell!` non-null assertions. **Every assertion in the plan is present unchanged**, including the exact-token `.split(' ')` matching and both negatives.
3. **Prettier wrapped one added line.** `sale-wizard-ui-contract.test.ts` was prettier-clean before this change, so the long `expect(source).toContain('flex h-[92vh] ...')` was reformatted onto its own argument line to keep it that way. The asserted string is byte-identical to the plan's. (For the record, `sale-wizard-payment-plan.test.tsx` is already prettier-dirty on `master`; that is pre-existing and not touched here.)
4. **No real-browser check was run.** The defect is a CSS layout clip and happy-dom does not lay out, so the honest proof available in-repo is the class contract on the four shell nodes, which is exactly what the plan specified as the primary oracle. The pixel claim rests on the plan's measurement plus the fact that `ProductDialogBody` already ships this identical recipe in production.
