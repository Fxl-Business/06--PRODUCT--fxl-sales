# Verify report - slice 03 archive affordance (Gate 2)

- Slice: `03-archive-affordance`
- Branch: `feat/03-archive-affordance`, one commit ahead of `master` (`168127e feat(cadastros): archive and restore a produto, area, funcao or pessoa`)
- Auditor: independent Verify sub-agent; did not write this code
- Verdict: **PASS**

## 1. Commands

Each run exactly once, never in watch mode.

| command | exit | result |
| --- | --- | --- |
| `pnpm --filter @fxl-sales/web test` | 0 | Test Files 47 passed (47); Tests 559 passed (559) |
| `pnpm --filter @fxl-sales/web lint` | 0 | `eslint src/`, no output |
| `pnpm run type-check` | 0 | shared-types, shared-utils, api, web all Done |
| `pnpm test` | 0 | shared-utils 3/3 files, 80 tests; api 35/35 files, 345 tests; web 47/47 files, 559 tests |

The new oracle file reports `✓ src/sales-ops/__tests__/cadastro-archive.test.tsx (21 tests) 133ms`.

```
 Test Files  47 passed (47)
      Tests  559 passed (559)
   Duration  4.54s
```

```
packages/shared-utils test:  Test Files  3 passed (3)
packages/shared-utils test:       Tests  80 passed (80)
apps/api test:  Test Files  35 passed (35)
apps/api test:       Tests  345 passed (345)
apps/web test:  Test Files  47 passed (47)
apps/web test:       Tests  559 passed (559)
```

## 2. Non-vacuity of the oracle (mutation testing)

Four mutations, each applied to the source, run against `cadastro-archive.test.tsx`, then reverted.
All four went RED.

### (a) Archive PATCH sends an extra body key besides `status` - **RED**

Mutation: `apps/web/src/sales-ops/api.ts`, `setCadastroStatus` body became
`JSON.stringify({ status, name: 'stale-cached-name' })`.

Observed: `Tests 4 failed | 17 passed (21)`. The load-bearing failure is the explicit key guard:

```
 FAIL  cadastro archive transport > never issues a DELETE and never sends a body key other than status
+   "name",
 ❯ cadastro-archive.test.tsx:378
    expect(Object.keys(JSON.parse(String(init.body)))).toEqual(['status']);

 FAIL  cadastro archive transport > restores with the same endpoint and status active
AssertionError: expected { status: 'active', …(1) } to deeply equal { status: 'active' }
+   "name": "stale-cached-name",
    "status": "active",
```

The status-only-body claim is genuinely enforced, not decorative.

### (b) Archive control rendered for a system função - **RED**

Mutation: `FuncoesView` in `SalesOpsApp.tsx` was changed so the `funcao.isSystem` branch renders
`CadastroArchiveButton` alongside the `Lock`, instead of the lock and nothing else.

Observed: `Tests 1 failed | 20 passed (21)`, failing at the exact assertion:

```
 FAIL  cadastro archive guards > offers no archive affordance for vendedor or finder
 ❯ cadastro-archive.test.tsx:582
    expect(buttonByAriaLabel('Arquivar função Vendedor')).toBeNull();
```

The failure dump shows the rendered `Archive` svg, so the assertion caught a real DOM node rather
than a label typo. The positive control on `Designer` in the same test means the negatives are about
the `isSystem` flag and not about a control that never renders.

### (c) Confirmation fires the write without confirming - **RED**

Mutation: `useCadastroArchive.select` became
`{ onArchive(target); if (target.status !== 'active') setPending(target); }`, so the confirmation
dialog still opens but the write is already issued. This is the sharper mutation: it isolates the
gate rather than deleting the dialog.

Observed: `Tests 4 failed | 17 passed (21)`.

```
 FAIL  cadastro archive confirmation > requires a confirmation before archiving a produto
 FAIL  cadastro archive confirmation > requires a confirmation before archiving an área
 FAIL  cadastro archive confirmation > requires a confirmation before archiving a função
 FAIL  cadastro archive confirmation > cancelling the confirmation archives nothing
AssertionError: expected "spy" to not be called at all, but actually been called 1 times
```

That `cancelling the confirmation archives nothing` fails under this mutation is the important part:
the cancel test is not passing merely because nothing ever fires.

### (d) Extra mutation for audit point 7 - `type="button"` removed - **RED**

Mutation: `type="button"` deleted from `CadastroArchiveButton`.

```
 FAIL  cadastro archive confirmation > both row controls are type="button"
AssertionError: expected 'submit' to be 'button' // Object.is equality
```

`HTMLButtonElement.type` reflects the attribute and defaults to `submit` when absent, so the
assertion at `cadastro-archive.test.tsx:558-565` is real and catches exactly the class of bug that
happy-dom's click path cannot see.

## 3. No DELETE anywhere

- `apps/api` is untouched by this diff: `git diff master..HEAD --name-only` yields ten paths, all
  under `apps/web/src/sales-ops/`.
- `apps/api/src/domains/sales-ops/routes.ts` still carries only the comment
  `// There is deliberately no DELETE verb: removal is PATCH { status: 'archived' },` and no
  `.delete(` route.
- The only `DELETE` strings added anywhere in the diff are the comment in `api.ts`, the doc header of
  the test file, and the test's own `expect(init.method).not.toBe('DELETE')` guard.
- The single new transport, `salesOpsApi.setCadastroStatus`, hardcodes `method: 'PATCH'`.

## 4. Status-only body, proven against the real request

Block A of the oracle stubs `globalThis.fetch` and calls `salesOpsApi.setCadastroStatus` directly, so
it asserts against the actual outgoing request, not an intent. It pins
`Object.keys(JSON.parse(init.body))` to exactly `['status']` across every call it makes, and mutation
(a) confirms that guard fires. A stale cached `name` or `funcaoIds` cannot ride along on an archive.

Endpoints and literals confirmed correct: `products`/`areas`/`funcoes` write `archived`, `people`
writes `inactive` (its column has no `archived`), and a restore is the same endpoint with `active`.
`clients` is correctly absent from `CadastroResource` - it has no status column, so a control there
would be a silent 200 no-op.

## 5. The three in-scope fixes

**`ProductDialogBody` no longer hardcodes `status: 'active'`.** It now submits
`activeModal.product?.status ?? 'active'`. Proven both ways: `a produto edit never rewrites the
stored status` renders the dialog on a `status: 'archived'` produto and asserts the submitted payload
still carries `archived`; `a produto create still submits active` proves the `??` fallback did not
regress the create path. `product-service-dialog.test.tsx` stayed green untouched, which the plan
named as the tell that the fallback was written correctly.

**The `Status` Combobox is gone from all three dialogs.** `AreaDialogBody`, `FuncaoDialogBody` and
`PersonDialogBody` each lost the `useState` and the whole `<FieldBlock label="Status">`. Each now
submits `modal.X?.status ?? 'active'`. Three oracle tests assert `button[role="combobox"][aria-label^="Status d"]`
is null and that the stored status survives a submit unchanged. A source-assertion test added to
`pessoas-funcoes-view.test.tsx` blocks all three labels from returning and carries a positive control
(`CadastroArchiveButton`, `cadastroArchive`) so it cannot pass against an empty file.
`FuncaoDialogBody`'s note correctly narrowed to `o nome não pode ser alterado.`

**The wizard picker filters archived produtos, and both halves hold.** `selectableProducts` returns
active produtos plus the one the item already references, and the single `productOptions` call site
was actually changed to `productOptions(selectableProducts(bootstrap.products, item.productId), …)` -
so this is a call-site-level fix, not just a pure helper nobody calls. `productOptions` labels an
archived row `(arquivado)`, mirroring `funcaoCostOptionLabel`. Block E proves both halves at the
picker level, not against the helper: an archived produto is absent from a new proposta's options,
and on an edit whose item references it the trigger reads `FXL Legado (arquivado)` and the option is
offered on that row. This is what makes the shipped confirmation copy
`sai das listas de seleção de novas propostas` true rather than a lie.

## 6. Existing tests: adapted, not weakened

| file | change | assessment |
| --- | --- | --- |
| `areas-view.test.tsx` | dropped three `Status da área` combobox lines; expected payload `archived` to `active`; test renamed; `onArchive={vi.fn()}` added to 3 renders | Forced: the control no longer exists. The create-path payload is still asserted in full. Compensated by the new source assertion barring the picker's return. |
| `pessoas-funcoes-view.test.tsx` | same drop for `Status da função`; removed `expect(combobox('Status da função').disabled).toBe(true)`; `onArchive` added to 4 renders; **added** a new source-assertion test | The one removed assertion had no subject left. Everything else in the system-função lock test survives: disabled name input, disabled `Salvar`, the `Função predefinida do app` text, and `onSave` not called. Net assertion count went up. |
| `produtos-servicos-view.test.tsx` | `onArchive: vi.fn()` in `renderView` | Prop plumbing only. |
| `product-commission-editor.test.tsx` | `onArchive={vi.fn()}` on one render | Prop plumbing only. |
| `cadastros-refresh.test.tsx` | `setCadastroStatus: vi.fn()` in the `vi.mock('../api')` literal | Mechanically required: the factory replaces the whole module. |
| `routing.test.tsx` | `useSetSalesOpsCadastroStatus: () => mutation` in the `vi.mock('../hooks')` literal | **Legitimate, and mechanically required.** This file renders `<SalesOpsApp />` and mocks `../hooks` with a full object-literal factory. `SalesOpsApp` calls the new hook unconditionally at the top of its body, so without this line the component throws. Its omission from the plan's `files_modified` is a plan oversight, not scope creep - the edit adds one mock entry and touches no assertion. |

No assertion anywhere was removed or loosened without its subject having been deleted, and every
deletion is covered by a stronger replacement.

## 7. CLAUDE.md compliance

- **No native pickers.** `grep -nE '^\+.*<(select|option|datalist)[ >]'` over the diff returns
  nothing. The slice in fact removes three `Combobox` instances and adds none; `pnpm --filter
  @fxl-sales/web lint` passes, so `no-restricted-syntax` is satisfied.
- **`useInlineLayer`.** No call site is added or removed. Correctly so: the new confirmation is an
  `AlertDialog` rendered as a page-level sibling of each table, containing a title, a paragraph and
  two buttons - no `Combobox`, no `InfoHint`, not nested inside a `Dialog`. There is no layer to
  register. Removing three `Combobox`es cannot strand a registration, since the release is
  idempotent and runs on unmount.
- **Mutations go through `useAppMutation` with declared invalidations.**
  `useSetSalesOpsCadastroStatus` uses `useAppMutation` and declares
  `invalidates: [queryKeys.salesOps.all]`. No optimistic write, which is the right call and is
  documented in the hook: `useOptimisticBootstrapWrite` excludes produtos, so an optimistic archive
  would give one gesture two latencies on adjacent screens.
- **No raw account or workspace id rendered.** Every new user-facing string interpolates a `name` or
  `displayName`. Row ids appear only in `aria-label`-free payload fields.
- **pt-BR copy** throughout, and the verb tracks each cadastro's own vocabulary: `Arquivar`/`Restaurar`
  for produto, serviço, área and função; `Inativar`/`Reativar` for a pessoa, matching the `inactive`
  literal and the `Inativo` badge the row shows afterwards.
- **No em dash** in the diff (`grep "—"` returns nothing).
- **No CHANGELOG or generated-file edits.**
- **Scope confined to `apps/web/**`** - all ten changed paths are under `apps/web/src/sales-ops/`.

## 8. Completeness (the mid-flight executor death)

Checked the plan's §3 change list item by item against the code rather than trusting the green bar.
Everything landed: the `lucide-react`, hooks and type imports; `archivedRowClass`; `CadastroKind`,
`CadastroArchiveTarget` and the five-row `cadastroArchive` table with the copy verbatim from §2.9;
`useCadastroArchive`, `CadastroArchiveButton`, `CadastroArchiveConfirm`; all four views wired with
the `onArchive` prop, the row class, the grouped `Ações` cell and the confirmation as last child of
the panel; the `Arquivado` badge in the produto `Nome` cell with no tenth column added; the
`SalesOpsApp` handler and its four prop passes; the wizard picker fix; and all four dialog fixes.

Two details the plan flagged as the likely mechanical mistakes were both handled correctly:
`useCadastroArchive` sits **above** the early empty-state return in all three of `AreasView`,
`PessoasView` and `FuncoesView` (lint's `react-hooks/rules-of-hooks` confirms), and the archive
control in `FuncoesView` is inside the non-system branch rather than merely disabled in a shared one
- mutation (b) proves the test catches the alternative. Optimistic rows render the control disabled
(`disabled={pending}`) on the three optimistic collections and not on produtos, which is correct
since produtos are not an optimistic collection.

The work is coherent and complete, not merely green.

## 9. Acceptance

| criterion | result |
| --- | --- |
| Admin on produtos / áreas / pessoas / funções can click Arquivar, confirm, and exactly one PATCH `{status}` is issued to the existing endpoint | Met. `onArchive` asserted `toHaveBeenCalledTimes(1)` with the exact target on all four cadastros; transport pinned to `PATCH /api/v1/sales-ops/<resource>/<id>` with body `{status}` only. |
| No DELETE is ever issued | Met. Only transport is a hardcoded `PATCH`; `apps/api` untouched; `salesOpsRouter` still has no DELETE verb. |
| Cancelling issues nothing | Met, and non-vacuously - the cancel test fails under mutation (c). |
| No archive control for the system funções vendedor/finder | Met, with a positive control on `Designer`; fails under mutation (b). |

## 10. Tree restoration

`git diff master..HEAD` was captured before any mutation and re-captured after the last revert.
Both hash to `5803a5e09364aa74f2da54cee9cd7e72d06b29959e28b3fe53d2e2ad134136c7` - byte-identical.
`git status --porcelain` shows only the pre-existing untracked `.vscode/`. No probe files were left
anywhere in the repo; all scratch output went to the session scratchpad. The oracle file was re-run
after the final revert and reports `Test Files 1 passed (1); Tests 21 passed (21)`. No long-running
process was started, so none needed killing.

## 11. Note for the record (not a defect in this slice)

The plan's `files_modified` list omits `apps/web/src/sales-ops/__tests__/routing.test.tsx`, which had
to be edited for the hooks mock to keep matching the module shape. Worth correcting in the slice
record so the next reader does not treat it as an unexplained edit.
