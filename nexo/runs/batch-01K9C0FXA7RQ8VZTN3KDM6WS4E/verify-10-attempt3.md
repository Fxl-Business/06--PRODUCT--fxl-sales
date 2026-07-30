# Verify - slice 10-produtos-servicos-web - attempt 3

**Verdict: PASS**

Branch `feat/10-produtos-servicos-web`, single commit `e356c99` on top of `master` (`a7d7248`).
Narrow re-verify of the attempt-2 documentation FAIL plus the two non-blocking follow-ups.
I did not write this code and did not review attempts 1 or 2.

## 1. Gates

All four run by me, from a clean tree, run-once (no watch mode).

| Gate | Exit |
| --- | --- |
| `pnpm run lint` | 0 |
| `pnpm run type-check` | 0 |
| `CI=true pnpm test` | 0 |
| `pnpm run build` | 0 |

Suite counts match the expected baseline exactly, nothing removed:

- `packages/shared-utils`: 1 file / 17 tests passed
- `apps/api`: 27 files / 283 tests passed
- `apps/web`: 34 files / 288 tests passed

A grep for `.skip(`, `.only(`, `describe.skip`, `it.skip`, `test.skip`, `xit(`, `xdescribe(` across `apps/web/src`, `apps/api/src`, `apps/api/test` and `packages` returned only two unrelated `process.exit(1)` hits.
No skipped or focused tests.

## 2. Scope of the amend

`git diff 647c542..e356c99 --stat` touches exactly three files: `CLAUDE.md` (6 lines), `apps/web/src/sales-ops/SalesOpsApp.tsx` (128 lines), and `apps/web/src/sales-ops/__tests__/sale-wizard-free-items.test.tsx` (4 lines).

I did not take the "docs and formatting only" claim on trust. Two independent measurements:

1. **Whitespace-blind diff.** `git diff -w 647c542..e356c99 -- SalesOpsApp.tsx` collapses to exactly two hunks: the `costRowFuncaoOptions` doc comment, and the wizard hint string.
2. **Content-only diff, which `-w` alone cannot do** (it is blind to added lines, and the hint change adds a line). I normalized both blobs by stripping leading/trailing whitespace per line and dropping blank lines, then diffed. Result: exactly two changed regions, the same comment block and the same hint string. Nothing else.

For the `ProductsView` re-indent specifically: the region is lines 2267-2459 in both `647c542` and `e356c99`, identical line count (193), and the **whitespace-stripped md5 of the region is byte-identical** (`c766ddc7434c3daba2fab869e84d8e06` both sides) across 114 raw diff lines (57 removed / 57 added).

**Conclusion: zero functional logic changed between attempt 2 and attempt 3.** Attempt 2's clean functional findings therefore transfer, and I did not need to re-derive them. Confirmed individually untouched: the archived-função escape hatch (`costRowFuncaoOptions`), `allFuncoesUsed` / `usedEligibleCount`, `costRowFuncaoValueLabel`, and both submit clamps.

## 3. Truth of every sentence in the touched `CLAUDE.md` sections

This was the attempt-2 FAIL and the crux here. I verified each factual claim against code.

### Line 89 (rewritten)

> The route segment stays `produtos`; what changed is the nav label, the page title and its subtitle. The wizard's missing-área hint points at `Cadastros > Produtos & Serviços` to match.

TRUE on all four counts:
- Route segment: `navigation.ts` still `{ id: 'produtos', ... }`.
- Nav label: `'Produtos'` -> `'Produtos & Serviços'`.
- Page title: `title: 'Produtos'` -> `'Produtos & Serviços'`.
- Subtitle: `'Catálogo, valores, códigos e regras de comissão'` -> `'Catálogo, valores, custos por função e padrões de proposta'`. The subtitle really did change, so the added clause is earned and not padding.
- Hint: `SalesOpsApp.tsx:5818-5819` renders `Cadastros {'>'} Produtos & Serviços.`

### Line 100 (new bullet - the NEW-row pool)

> A NEW função cost row draws from active, non-system funções only. ... A função already used by another row is filtered out, so the client can never trip `duplicate_funcao_cost`.

TRUE. `eligibleFuncoes = funcoes.filter((f) => f.status === 'active' && !f.isSystem)` (line 3283). For a new row `row.funcaoId` is falsy, so `costRowFuncaoOptions` returns `eligibleFuncoes` minus `usedFuncaoIds` and `current` is `undefined` - the prepend branch cannot fire. Active + non-system only, confirmed.

Supporting facts checked rather than assumed:
- `vendedor` / `finder` are genuinely the only `isSystem: true` funções (`service.ts:248-249`), consistent with `CLAUDE.md:78`.
- `duplicate_funcao_cost` is a real API error (`apps/api/src/domains/sales-ops/service.ts:160`), not an invented code.
- The dedupe filter is `f.id === row.funcaoId || !usedFuncaoIds.has(f.id)`, so another row's función is excluded while the row's own value is admitted. No duplicate is reachable through the picker.

### Line 101 (new bullet - the row's OWN stored función)

> A row's OWN stored função always stays selectable on that row, resolved against the unfiltered `funcoes` and labelled `<nome> (arquivada)` when archived. ... A `funcaoId` that resolves to nothing at all reads `Função não encontrada`, never a raw id.

TRUE. `funcaoById` is built from the **unfiltered** `funcoes` (line 3286). `costRowFuncaoOptions` prepends `current` when it is absent from `offered` (lines 3321-3325). The label comes from `funcaoCostOptionLabel`, which returns `` `${funcao.name} (arquivada)` `` for `status === 'archived'` (line 2241). `costRowFuncaoValueLabel` returns the literal `'Função não encontrada'` when `funcaoById.get` misses (line 3342).

The splitting of the old single bullet into two individually-true statements does resolve the attempt-2 defect: line 100 is now scoped to the NEW-row pool and no longer instructs the next agent to delete the escape hatch that line 101 mandates.

### Line 102 - the "fifth false sentence" replacement: **claim UPHELD**

I established this from the code myself rather than accepting the implementer's reading.

- `assignedFuncoes` (line 4497) resolves each assigned id against `funcoes` (the unfiltered org catalogue), then `createdFuncoes`, then `modal.person?.funcoes`. Status is never consulted. An archived función that a pessoa already carries therefore **does** resolve and renders as a chip with a working remove button (lines 4583-4606).
- `selectableFuncoes` (line 4504) filters `funcao.status === 'active' && !assignedIds.includes(funcao.id)`. There is **no** prepend of an archived-but-assigned value.

So an archived função genuinely **does** vanish from the Pessoa add-picker (`options={selectableFuncoes}`, line 4620), while surviving on the chips. The implementer's self-caught fifth false sentence was a real defect, and the replacement text describing the two-control split is accurate.

This is also consistent with the pre-existing `CLAUDE.md:80` ("An archived função stays visible on the people who already carry it but disappears from the assignment picker"). No contradiction - line 102 and line 80 say the same thing about the same picker.

### Named precedent: accurate

> the direct precedent is `selectableAreas` in this same product dialog, which prepends an archived-but-current área into the picker it belongs to.

TRUE and it is the right `selectableAreas`. Lines 3255-3264 sit in `ProductDialogBody`:
`knownAreas = currentArea && currentArea.status !== 'active' ? [currentArea, ...activeAreas] : activeAreas`.
That is a prepend of the archived-but-current value into the picker that owns it - exactly the claimed shape. (A second `selectableAreas` exists at line 4991 in the sale wizard; the bullet's "this same product dialog" correctly points at the first.)

### Code comment cites the right bullet

The rewritten comment at lines 3309-3315 cites *"a row's OWN stored função always stays selectable on that row"* - which is line 101, the bullet that actually governs this picker - and explicitly disclaims the bullet above it as being about the NEW-row pool. Correct attribution. The previous version's appeal to the pessoa picker as "the same rule" is gone, and the replacement sentence ("an archived função does vanish from that picker but must not vanish here") matches my own reading above.

### No other false or self-contradictory sentence

I read the whole `## Produtos & Serviços` section (lines 87-103) and cross-checked against the rest of `CLAUDE.md`. No contradictions found. One imprecision noted as non-blocking below.

## 4. The stale hint

- Both halves moved in the same commit: the JSX string (`SalesOpsApp.tsx:5818-5819`) and its assertion (`sale-wizard-free-items.test.tsx:286-288`).
- **The JSX line-wrap collapses to exactly the asserted text.** Proved empirically, not by reasoning: when I reverted the string, the failure output printed the rendered `container.textContent` containing `...em Cadastros > Produtos.` - a single space around the `{'>'}` expression and no stray whitespace at the wrap point. The shipped two-line form therefore renders `Cadastros > Produtos & Serviços.`, which the green suite confirms.
- **Reverting the hint turns the test Red.** Probe A: I replaced the wrapped string with the old single-line `Produtos.` and ran the file. Result: `1 failed | 2 passed`, failing on `sale-wizard-free-items.test.tsx:287` with the expected/received pair above. The assertion is genuinely load-bearing.
- The new text is correct for where the screen now lives: the nav item, page title and the hint all read `Produtos & Serviços`, and the route segment is still `produtos`. A sweep for `Cadastros > Produtos` found no other stale occurrence. The only remaining bare `"Produtos"` strings are `apps/web/src/i18n/pt-BR.json:183,286`, which belong to the legacy `/admin/*` tree that `CLAUDE.md` requires be left unchanged - correctly untouched.

## 5. Formatting, right instrument

Prettier is **not** installed: `pnpm exec prettier --version` prints `undefined` then `ERR_PNPM_RECURSIVE_EXEC_FIRST_FAIL Command "prettier" not found`, and piping it masks the failure - exactly the silent-failure trap flagged in the brief. I used `pnpm dlx prettier@3` with the repo's real config, `prettier.config.js` (`printWidth: 100`, `singleQuote`, `trailingComma: 'all'`, `tabWidth: 2`), which must be passed explicitly since it is an ES module at the repo root.

Measurement (formatted copy vs original, classified per line by comparing stripped content across each diff opcode):

| | whitespace-only delta lines | content-reflow delta lines |
| --- | --- | --- |
| branch `e356c99` | **23** | 314 |
| master `a7d7248` | **27** | 333 |

**The 23-vs-27 claim reproduces exactly.**

Attributable count: the 23 whitespace-only drift lines are at 1858-1861, 3070-3073 and 4895-4909. Intersected against the 869 lines this branch adds (from `git diff -U0 a7d7248..e356c99`, new-file numbering), the intersection is **empty - 0 attributable**. Within the `ProductsView` region itself the branch now has 0 whitespace-only and 0 content-reflow drift, where master's corresponding region had 12 content-reflow lines. The re-indent left that function prettier-clean.

**No functional line was altered by the re-indent.** Established three ways: `git diff -w` for the region is empty; the region's whitespace-stripped md5 is identical across the amend; and the normalized whole-file content diff shows only the comment and hint. The `-w` blindness to added lines is covered by the md5 and line-count checks (193 lines both sides).

## 6. Spot-checks against regression

Re-run by me rather than assumed, since `SalesOpsApp.tsx` changed.

The archived-función behaviour is pinned by `product-service-dialog.test.tsx` and all of it passes:
- Trigger label: `comboboxText('Função do custo padrão 1')` is `'Redator (arquivada)'`, and the row still holds `300`.
- Own-row option: `offered` contains `'Redator (arquivada)'`, with an active-función positive control (`'Desenvolvedor'`) so an empty pool could not pass.
- Submit payload preserves the archived id: `[{ funcaoId: archivedFuncao.id, mode: 'fix', valueBrl: 30000 }]`.
- `Adicionar` stays enabled: the "never offers an archived função to a row that does not already carry it" test successfully clicks Add with an archived-carrying row present and gets row 2. That exercises `usedEligibleCount` counting against the eligible pool only - had the archived row consumed pool, Add would have been disabled and the test could not have reached row 2.

**Mutation probe B (escape hatch).** I replaced the prepend with `const withCurrent = offered;`. Result: exactly one test went Red - `keeps naming an archived função on the cost row that already carries it` - on the `offered` assertion. The escape hatch is genuinely covered. (The trigger-label assertion in that test still passed under the mutant, correctly, because `valueLabel` resolves the trigger independently of the options list; the options assertion is what guards the hatch.)

**No raw uuid can render.** `combobox.tsx:243-244`: `resolvedLabel = selectedOption?.label ?? valueLabel` and `triggerText = resolvedLabel ?? placeholder`. The raw `value` is never a rendering fallback. Pinned by the test asserting the trigger is `'Função não encontrada'` and `not.toContain('0000')` for an id absent from the bootstrap.

## 7. Hygiene

- One commit on top of `master`.
- Conventional Commit subject: `feat(sales-ops): rename produtos to produtos & serviços with kind-aware list and default config`.
- No co-author trailer (`%(trailers)` is empty), author is `CauetPinciara <cauetpinciara@gmail.com>`.
- No AI attribution: grep for `claude|anthropic|copilot|generated with|co-authored|AI-assisted` over the full message returns nothing.
- No em dash in added lines: `git diff a7d7248..e356c99 | grep '^+' | grep '—'` is empty. The body and the new `CLAUDE.md` prose use a plain `-`.
- pt-BR gender correct throughout the added strings: `(arquivada)`, `Função não encontrada`, `Variável`, `Todas as funções já têm custo padrão`, `Serviços têm valor variável, definido em cada proposta`.

## Non-blocking findings (not FAIL conditions, not fixed by me)

1. **`SalesOpsApp.tsx:3289-3295` is misindented, and it is branch-added code.** The `usedEligibleCount` block and its comment sit at the wrong depth: the comment body at 6 spaces with `*/` at 4, and `const usedEligibleCount` at 4 where every sibling declaration in the function (`funcaoById`, `noFuncoesAvailable`, `allFuncoesUsed`, `legacyProviderNames`) is at 2. Prettier would collapse it to a single 2-space line. This escaped the "zero attributable whitespace" metric legitimately but by luck: because the re-wrap changes token layout as well as indentation, prettier classifies it as a content reflow rather than a whitespace-only delta, so it lands in the 314 rather than the 23. Cosmetic only - lint passes and prettier is not installed or enforced anywhere in this repo, so drift of this kind is endemic (master carries 333 such lines in this file alone). Worth a tidy on the next touch of that function.

2. **`CLAUDE.md:93` calls the list filter bar `Produto | Serviço` (singular), but the rendered segments are `Produtos` / `Serviços` (plural)** - `SalesOpsApp.tsx:2306,2314`. Line 91's `Produto | Serviço` for the *dialog* control is correct (`SalesOpsApp.tsx:3514` is singular `Produto`), so the two bullets use one backticked literal for two differently-labelled controls. Not touched by this amend and not misleading in substance - the discriminator, the segment count and the location are all right, and the next agent would find the control immediately - so it does not meet the bar for a FAIL. Flagged for accuracy.

Neither item is a correctness defect and neither is in the FAIL list.

## Equivalent mutants

None encountered. Both mutations I applied were behaviour-changing and both were caught by the existing suite. I am not reporting any equivalent mutant as a defect.

## Tree integrity

I mutated source twice (probe A: the wizard hint string; probe B: the `withCurrent` prepend) and reverted both. Verified by `git hash-object`, all three baselines restored byte-identically:

- `apps/web/src/sales-ops/SalesOpsApp.tsx` -> `96f93ba75191003924f867689331bd4b59f0a236`
- `apps/web/src/sales-ops/__tests__/sale-wizard-free-items.test.tsx` -> `2c2ca1bb4cad6db3797de8761665173166140baf`
- `CLAUDE.md` -> `8a2623e888cf2cb6c24798b25992d0d4b52de704`

`git diff HEAD` is empty. Still on `feat/10-produtos-servicos-web` at `e356c99`; nothing merged, pushed, committed or amended.

`git status --porcelain` matches the pre-existing snapshot exactly - the same five untracked entries I found on arrival (`.vscode/`, the two `agents/*.result.json`, `verify-10-attempt2.md`, `verify-10.md`), plus this report and the overwritten result file. `apps/web/dist` from the build gate is gitignored and does not appear. No probe files were left behind; all working files went to the session scratchpad.
