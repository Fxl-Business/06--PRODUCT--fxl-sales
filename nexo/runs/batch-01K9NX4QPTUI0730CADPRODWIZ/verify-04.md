# Verify - slice 04 `wizard-plano-layout`

Branch: `feat/04-wizard-plano-layout` (uncommitted).
Verifier did not read `exec-04.md` and wrote no source file.

Verdict: **PASS**

## Diff under review

```
apps/web/src/sales-ops/SalesOpsApp.tsx                          | 214 +++++-----
apps/web/src/sales-ops/__tests__/sale-wizard-payment-plan.test.tsx |  44 +++
apps/web/src/sales-ops/__tests__/sale-wizard-ui-contract.test.tsx  |  16 ++
3 files changed, 173 insertions(+), 101 deletions(-)
```

Identical against `HEAD` and against `master`, so the branch carries nothing but this slice.

## Commands

| Command | Result |
| --- | --- |
| `pnpm test` (web) | **368 passed, 39 files** (baseline 365/39 - `+3`, exactly the three added tests) |
| `pnpm test` (api) | **300 passed, 29 files** (baseline 300/29 - unchanged) |
| `pnpm run lint` | exit `0`, clean |
| `pnpm run type-check` | exit `0`, clean |

No test count dropped anywhere.
Grep of the added lines for `.skip` / `.only` / `todo(`: **NONE**.
Grep of the added lines for the em dash character: **NONE**.

The `+3` reconciles exactly: `sale-wizard-payment-plan.test.tsx` 12 to 14, `sale-wizard-ui-contract.test.tsx` 5 to 6.

## The decisive check - layout only

### 1. `calculations.ts` zero-diff

```
$ git diff apps/web/src/sales-ops/calculations.ts
(no output)
```

**EMPTY.** Confirmed twice, before and after the oracle experiment.

### 2. `payment-plan-generation.test.ts` zero-diff

```
$ git diff apps/web/src/sales-ops/__tests__/payment-plan-generation.test.ts
(no output)
```

**EMPTY.** Confirmed twice. The file still runs 20 tests, all passing, so the generation semantics it pins are untouched and still exercised.

### 3. Payment-plan machinery untouched

Read the full diff line by line. None of the following appears on any changed line:

- `planDirty`, `markPlanDirty`, `regeneratePlan`, `keepEditedRows`.
  The amber confirm bar and its `Aplicar` / `Manter parcelas` buttons are pure context in the diff, byte-identical.
- `appliedPlanKey` and its render-phase guard: not in the diff at all.
- The blank-`Número de ciclos`-means-indefinite rule: `min={1}`, `max={MAX_PLAN_INSTALLMENTS}`, `placeholder="Indeterminado"` and the `recurringCyclesValid` error branch all survive verbatim; only their indentation moved.
- The exact-sum invariant lives in `splitInstallmentsEqually` in `calculations.ts`, which has a zero diff.
- `markPlanDirty()` is still called from the parcela date and amount handlers, and is still absent from the `Forma` handler with its explaining comment intact.

### 4. No user-visible string and no `aria-label` changed

**`aria-label` audit.** Extracted every `aria-label` occurrence from `git show HEAD:...SalesOpsApp.tsx` and from the working file, sorted with counts, diffed:

```
diff old.aria.txt new.aria.txt
-> IDENTICAL: no aria-label added, removed, or altered
```

**Visible-string audit.** Stripped every `className="..."`, `className={...}` (balanced-brace scan), ``className={`...`}`` and every comment from both versions, collapsed whitespace, and diffed the remainder. The residual diff is **element nesting only**, with two cosmetic exceptions, both non-semantic:

- `<span>x</span>` became `<span> x </span>` - a Prettier reflow onto three lines. JSX strips whitespace adjacent to a newline, so the rendered text node is still exactly `x`.
- `Deixe em branco para prazo indeterminado` moved from a sibling `<div>` into the `Nº de ciclos` `Field`, and its tag changed `<div>` to `<span>`. The **string is character-identical**; only its parent changed. Its input keeps `aria-label="Número de ciclos"`, so the accessible name is unaffected (confirmed by the `aria-label` diff above).

Every other Portuguese string - `sem entrada`, `entrada cobre o total`, `Informe uma mensalidade maior que zero.`, `Informe um número de ciclos válido ou deixe em branco para prazo indeterminado.`, `Mensalidade de ... a partir de ...`, `Sem parcelas futuras geradas agora - a mensalidade entra como receita recorrente (MRR).`, `N ciclos de ...`, `Regerar plano`, `Aplicar`, `Manter parcelas`, `Nº` / `Vencimento` / `Valor` / `Forma` - is present, unaltered, and merely relocated. **Relocated, never altered.**

### 5. No handler, state variable or effect dependency changed

The behaviour-token grep over the diff returns only `onChange` lines, and every one is a `-`/`+` pair whose right-hand side is character-identical (`setRecurringMode`, `setRecurringMonthlyBrl`, `setRecurringStartDate`, `setRecurringCycles`) - pure re-indentation caused by unwrapping the `<>` fragment. Zero `useState`, `useEffect`, `useMemo`, `useCallback` or `useRef` lines appear in the diff. The change is markup and classNames and nothing else.

## Adversarial checks

### Oracle experiment

Backed up the source (sha256 `3dd821be…76c3c2`), reverted **only** `SalesOpsApp.tsx` to `HEAD` with the three new tests left in place, and re-ran both affected files:

```
Tests  3 failed | 17 passed (20)

× aligns the three declarative header controls on one grid...
  -> expected 'grid gap-[9px] md:grid-cols-[minmax(0…' to contain 'md:grid-cols-3'
× keeps the recorrência sub-fields below the header grid, not inside it
  -> expected 'Nº de ciclos' to contain 'Deixe em branco para prazo indetermin…'
× keeps the step-2 payment plan header on one grid with no right-flown derived lines
  -> expected 'import {\n  AlertTriangle,…' not to contain 'md:grid-cols-[minmax(0,1fr)_minmax(0,…'
```

All three fail, and each fails **for its own structural reason** - the old two-column template, the hint living outside the ciclos label, and the old class string still in source. No false oracle.

Restored from backup and verified byte-identity:

```
apps/web/src/sales-ops/SalesOpsApp.tsx: OK
RESTORED BYTE-IDENTICAL
```

`git status --porcelain` after restore matches what I found at the start, exactly (3 modified, `.vscode/` and the two exec-04 artefacts untracked). Both required zero-diffs re-confirmed after the restore, and both test files re-run green (20/20).

### Are the new tests real, or tautologies?

Two of three assert **rendered DOM**, not source text:

- `planHeaderGrid()` walks up from the live `Tipo de entrada` combobox trigger via `closest('div.grid')`, then proves that same element contains the `Parcelas restantes` input **and** the `Recorrência` combobox. That cannot pass unless the three controls really share one grid element - it is not a class-string tautology, because the containment assertions pin which grid was found.
- The derived-line assertion collects real `<div>` nodes by their rendered text (`sem entrada`, `1 x R$ 2.500,00`), asserts there are exactly two, and asserts neither carries `text-right`.
- The second test asserts the mensalidade and ciclos inputs are **absent** from the header grid and that the hint is inside the ciclos `<label>` - both negative and positive DOM claims.

The third test is a source grep, which is the established and documented convention of `sale-wizard-ui-contract.test.tsx` (the whole file works that way). The executor annotated it as such and pointed at the DOM test for the load-bearing claim, and included a positive control so the greps cannot pass by the strings simply having vanished. Acceptable.

### Judging the fix on its merits, not on the test passing

Read the resulting markup at `SalesOpsApp.tsx:6484-6564` and reasoned about the geometry rather than trusting the grid assertion.

The container is `grid gap-x-[9px] gap-y-3 md:grid-cols-3`, holding three sibling `FieldBlock`s (`flex flex-col gap-[6px]`: label span, then control, then derived line). Because all three are grid items in the same implicit row, their top edges coincide, so all three labels align and all three 44px controls sit on one horizontal axis. The dialog is `max-w-[940px]`, so after the card's `p-4` each column is roughly 277px:

- **Entrada** - `w-[116px]` picker plus 9px gap plus `flex-1` `UnitInput` when a value is needed; `flex-1` full width when the mode is `nenhuma`, so the column never shows a stub with dead space beside it. The 132px to 116px narrowing is safe: the widest label is `nenhuma`, which is the case where the picker is full width anyway, and `R$ fixo` fits 116px with room to spare.
- **Restante** - now fills its column at 44px with the `x` suffix absolutely positioned at `right-[13px]` behind `pr-8`. That is character for character the `UnitInput` affordance (`SalesOpsApp.tsx:3208-3221`), and the local comment correctly explains why it is not routed through the shared helper: `UnitInput` accepts no `min`/`max`, and this input clamps to `maxRemainingInstallments(entradaMode)`.
- **Recorrência** - the `w-[132px]` wrapper is gone, so the combobox fills its column at 44px, on the same axis as the other two instead of on a row of its own below.

The derived lines lost `text-right`, so each now starts at its own column's left edge, immediately under the control it describes, instead of being flung to that column's right edge. That is precisely the reported defect. The recorrência sub-fields (`Mensalidade` / `Início` / `Nº de ciclos`) moved out of the header block into their own `md:grid-cols-3` row underneath with a matching 9px gutter, so the two rows share one column rhythm.

**I state explicitly: yes, the three controls genuinely land on one grid, and each derived line genuinely sits under its own control.** The large empty gap is structurally impossible now (two columns became three), and `Recorrência` shares the axis rather than starting a new one.

Two honest caveats, neither a defect:

- `Recorrência` has no derived line of its own in the header row; its derived text lives in the expanded block below, which only exists when the mode is `mensal`. Its column is therefore shorter. Grid items flow from the top, so nothing shifts or centres oddly.
- A long `Restante` derived line such as `3 x R$ 4.166,66 (última R$ 4.166,68)` will wrap to two lines in a 277px column. The grid row stretches to the tallest item, so the controls stay on one axis regardless.

### Project-rule compliance

`CLAUDE.md`'s "UI Controls" rule is respected and the diff moves **toward** it, never away:

- Both pickers keep `formSelectClass` (44px) and the `Restante` input keeps `formInputClass` (44px), so picker and input line up.
- The parcela date and amount inputs dropped `h-10 rounded-[9px]` from their `cn(...)` calls. This is a provable **no-op**: `cn` is `twMerge(clsx(...))` (`apps/web/src/lib/utils.ts`) and `formInputClass` was already passed *after* those tokens, so tailwind-merge was already resolving to `h-11 rounded-[10px]`. The removal deletes dead classes that falsely advertised 40px geometry; the rendered height does not change. The comment at `SalesOpsApp.tsx:180-186` documents exactly this resolution order.
- No native `<select>`, `<option>`, `<datalist>` or raw `<input type="number">` introduced; lint's `no-restricted-syntax` guard passes.

### Scope creep

One change sits outside the three header controls: the `Parcelas a receber` header grid lost `px-0.5` (`SalesOpsApp.tsx:6687`). The row grid below it has no horizontal padding, so the header labels were offset 2px from the controls they name. This is the identical defect and identical fix already documented in this same file at `SalesOpsApp.tsx:190` for the step-1 `Itens` grid ("the header carried an extra `px-0.5`, so a column label never sat exactly over the control it named"). Same card, same alignment concern, established in-file precedent. **Not scored as scope creep.**

No other file, route, schema, migration or API surface was touched.

## Findings

1. **Observation, not a blocker.** `expect(source).not.toContain('sales-ops-num text-right text-[12.5px] font-bold')` in `sale-wizard-ui-contract.test.tsx` greps the whole 7000-line `SalesOpsApp.tsx`. A future unrelated control that legitimately wants that exact class string would false-fail this test. It matches the file's existing convention and carries a positive control, so it is acceptable as written.
2. **Observation, not a blocker.** `px-0.5` still sits on another header grid at `SalesOpsApp.tsx:6799` (the step-3 profissionais table) with the same 2px label offset. Out of this slice's card; worth a future sweep.
3. **Observation, not a blocker.** In the failing-oracle run, the DOM test tripped on its first assertion, so the `text-right` and `h-11` assertions in that test were not independently exercised as oracles. They are still real DOM reads and pass on the fixed source.

No blocking findings.

## Verdict

**PASS.**

Every command is green (`lint` 0, `type-check` 0, web 368/39 up 3 from 365/39, api 300/29 flat). No test count dropped and nothing was skipped. Both required diffs are empty and were re-confirmed after the oracle experiment. The `aria-label` set is byte-identical and every user-visible string is character-identical and merely relocated. No handler, state variable or effect changed - the diff is markup and classNames only, and the one geometry deletion is a provable tailwind-merge no-op. The oracle fails for the right reasons and the source was restored byte-identically. The layout reasoning holds on the merits: the three declarative controls share one three-column grid on a single 44px axis, and each derived line is left-aligned directly beneath its own control.
