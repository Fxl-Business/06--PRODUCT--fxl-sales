# Verify (Gate 2) - slice 10 produtos-servicos-web

Branch `feat/10-produtos-servicos-web`, one commit `ec2b364` on `master` (`a7d7248`).
Verdict: **FAIL** on one defect. Everything else verified clean, and much of it verified by independent probe rather than by reading the implementer's claims.

## 1. Gates

Run from a clean tree, exact commands:

| Gate | Exit |
| --- | --- |
| `pnpm run lint` | 0 |
| `pnpm run type-check` | 0 |
| `CI=true pnpm test` | 0 |
| `pnpm run build` | 0 |

Totals: web **34 files / 283 tests** (branch-point 32/240, so +2 files and +43 tests), api **27/283** (unchanged), shared-utils **1/17** (unchanged).
No file and no test disappeared.
No `.skip`, `.only`, `it.todo` or `xit` anywhere under `apps/web/src/sales-ops/__tests__/`.

## 2. The whitespace-churn claim

Per the brief's own measure, the claim holds:

```
git diff    master..HEAD -- SalesOpsApp.tsx   ->  743 added / 262 removed
git diff -w master..HEAD -- SalesOpsApp.tsx   ->  718 added / 237 removed
```

Residual whitespace-only churn is **exactly +25 / -25**, and every one of those lines sits inside the `Módulos` `ListEditor`, which is genuinely re-indented by the new `{isService ? null : (...)}` conditional that hides it for a serviço.
No pre-existing line elsewhere in the file was left re-indented.
The change was fully reviewable; nothing is hidden.

### But the misfire has a second half the `-w` check is structurally blind to

`git diff -w` can only compare an added line against a counterpart. A *newly added* line has none, so its indentation is never checked. Measured with an independent formatter at the repo's own effective style (`--print-width 100 --single-quote`):

| File version | prettier deltas | non-whitespace deltas | whitespace-only |
| --- | --- | --- | --- |
| `master` | 492 | 438 | **54** |
| branch | 1138 | 414 | **724** |

So the branch adds roughly **670 whitespace-only formatting deltas**, essentially all of its own 743 added lines, indented +2 relative to their syntactic context. Unambiguous examples:

- `type FuncaoCostForm = ...` (L2990-2991) declared at module scope but indented 2.
- `kind: SalesOpsProductKind;` (L2997) at indent 4 inside an object type whose siblings `name` / `areaId` / `codeSuffix` / `setupBrl` are all at 2.
- `funcaoCosts={...}` / `funcoes={...}` (L3200-3201) at indent 8 while the sibling JSX props `areas=` / `modal=` / `onClose=` are at 6.
- `const parcelas = Math.min(` (L3313) at indent 6 while `event.preventDefault();` two lines above, in the same block, is at 4.
- The added `setKind` / `setEntradaMode` / `setCostRow` helpers close at indent 4 where they should be 2.

The implementer's report says the misfire was "restored line by line". That is true of the pre-existing lines only; its own new code shipped mis-indented.

**This is not what I am failing on.** The repo has no prettier and no format gate (root/web/api `package.json` have no prettier dep, no config file, and `lint` is bare `eslint src/`), so no configured tool is violated, and the brief says to report style separately rather than fail on it. The brief's enumerated whitespace FAIL condition is about residual *churn* in the diff, which is 25 lines. Recorded here because the report's claim is materially incomplete, and because slice 11 rewrites this exact region and will inherit the drift.

## 3. The seven declared behaviour changes

| # | Change | Judgement | Test that can fail |
| --- | --- | --- | --- |
| 1 | open-price Produto no longer expressible | acceptable, see below | `has no preço em aberto switch`, `sends kind and never sends openPrice` (`not.toHaveProperty('openPrice')`), `zeroes the own value when a produto is reclassified` |
| 2 | `Recorrente` dropped from the serviço column set | acceptable | pinned both ways: `produtos-servicos-view` L177 `toContain('Recorrente')` as positive control, L233 `not.toContain` for serviço |
| 3 | `Módulos` hidden for a serviço but still submitted | acceptable, and the right call - hiding without submitting would destroy module data on reclassify | `renders módulos only for a produto and preserves them when reclassified` |
| 4 | `bootstrap.people` no longer reaches `ProductDialog` | acceptable | rewritten app-level `the produto função cost pool`; also enforced by type-check, the `collaborators` prop is gone |
| 5 | two toggles gained aria-labels | additive, neither had an accessible name before | tests resolve them via `labeledButton('Possui mensalidade')`, so removal throws |
| 6 | `parseDecimal` / `pctToInput` accept `null` | equivalent | correctly untested: both are called only on the `'pct'` branch, where the DB CHECK guarantees non-null, so `null` is unreachable in valid data and a behavioural test would be unfalsifiable |
| 7 | sale-detail `methodLabels` hoisted to module `paymentMethodLabels` | equivalent | same four strings, verified identical in the diff; no test can distinguish it, correctly so |

### 3a. Is the open-price Produto loss real? No.

Slice 07's `0013_produtos_servicos_defaults.sql` adds:

```sql
ALTER TABLE "sales_ops_products" ADD CONSTRAINT "sales_ops_products_kind_open_price_check"
  CHECK (("sales_ops_products"."kind" = 'service') = "sales_ops_products"."open_price");
```

`kind = 'service'` and `open_price` are therefore **the same fact**, enforced at the database. An "open-price Produto" is not a configuration that became impossible in the UI - it is a row the database refuses to hold. The migration's backfill (`kind = CASE WHEN open_price THEN 'service' ELSE 'product' END`) already reclassified every existing open-price row as a Serviço, and separately zeroed their `setup_brl` / `monthly_brl`. Removing the `Preço em aberto` switch removes the second of two controls for one fact. No legitimate configuration was lost.

### 3b. Is dropping `Recorrente` from the serviço columns a loss? Acceptable.

`recurringCommission` is no longer shown on a serviço row, but recurrence itself remains visible as the ` + mensal` suffix on `Plano padrão`, and the flag stays fully editable in the dialog (the `Incide sobre recorrente` toggle is rendered for both kinds). The serviço column set is already at nine columns; trading a boolean badge for `Valor | Plano padrão | Custos padrão` is the right trade for a screen whose serviço rows are defined by their defaults. Information is reachable, not destroyed.

## 4. Is the deliverable there? Yes.

- **Toggle over one list.** `SegmentedButton` pair (`Filtrar por produtos` / `Filtrar por serviços`) with counts computed from the *unfiltered* array, so the other bucket's size is always visible. Per-kind column sets, nine columns each.
- **Empty state renders below the toggle.** The old code early-returned an `EmptyPanel` in place of the whole card. Now the filter bar is always rendered inside the card and `visible.length === 0` swaps only the table body region. Pinned by `keeps the kind segments reachable from an empty bucket`, which asserts both segment buttons are still `HTMLButtonElement` while `Nenhum serviço cadastrado` is showing. The operator can never be trapped.
- **Default payment plan editor** over the six flat columns: `Tipo de entrada`, `Valor da entrada` (unmounted when `nenhuma`), `Restante [N] x`, `Forma de pagamento padrão`, `Número de ciclos` (only when `hasMonthly`), plus a live summary strip.
- **`Custos padrão por função`** submits the discriminated union: `{funcaoId, mode:'pct', valuePct}` or `{funcaoId, mode:'fix', valueBrl}`, matching the API's `ProductFuncaoCostSchema`. Verified by probe that a fix row typed as `300` submits `valueBrl: 30000`.

### 4a. Fixed função cost formatting: correct.

`formatMoneyBrl(cents)` divides by 100 (`calculations.ts:136`); `formatProductCommission`'s `fix` branch formats its argument directly as reais (`SalesOpsApp.tsx:2216-2223`). So reusing the commission helper on a cents-valued column really would render R$ 300,00 as R$ 30.000,00, and the dedicated `formatFuncaoCost` is justified. Rendered and confirmed: with `valueBrl: 30000` the `Custos padrão` cell title contains **`R$ 300,00`** and does not contain `R$ 30.000,00`.

### 4b. Installment cap: holds, in all three layers.

Enforced at the `max` attribute (`max={parcelasCeiling}`), at `setEntradaMode` (clamps a stored 120 down to 119 the moment an entrada appears, so the visible number never lies), and at `submit()` (`Math.min(parcelasCeiling, ...)`). Necessary, because `materializeDefaultPaymentPlan` pushes the entrada row *before* the parcela loop (`service.ts:519-521`) while `CreateSaleSchema` is `installments: z.array(...).min(1).max(120)` (`service.ts:392`).

Verified by probe rather than by reading the shipped test:

| Probe | Result |
| --- | --- |
| hand-type `500`, no entrada, submit | `defaultRemainingInstallments: 120` |
| hand-type `500` with a fixed entrada, submit | `119` |
| stored 120, then add a `%` entrada, submit | `119`, and `119 + 1 <= 120` |
| hand-type `0`, submit | `1`, never 0 |

The invalid 121-row combination cannot be entered or submitted.

**Coverage gap (not a defect):** the submit-side clamp is not pinned. Removing `Math.min(parcelasCeiling, ...)` from `submit()` leaves all 198 web sales-ops tests green, because the shipped cap test reaches 119 through the `setEntradaMode` clamp and never exercises a value above the ceiling at submit time. The behaviour is correct; only the third layer is untested.

## 5. `providers` is data-safe - proved against the real database

Not taken on trust. I wrote a throwaway integration test against the local Docker test DB (`apps/api/test/rls/zz-verify-probe.test.ts`, since deleted) driving the real `createProduct` / `updateProduct` service functions through the non-superuser `fxl_sales_test` role:

1. Created a product with two `providers` rows; confirmed the jsonb holds 2 entries via a separate admin-context connection.
2. Built the **exact** object `submit()` now produces (`kind`, the six default columns, `productFuncaoCosts`, `modules`, `status`; no `providers`, no `openPrice`), parsed it through the real `UpdateProductSchema`, and asserted `'providers' in parsed === false` - i.e. `.partial()` beats `.default([])`, so the key really stays absent rather than being defaulted to `[]`.
3. PATCHed. The `providers` column came back **byte-identical**, both entries intact. The new cost row landed.
4. **Control:** the same PATCH sending `providers: []` *does* clear the column to `[]`.

So the omission is load-bearing, not incidental. Mechanism confirmed in source too: `productPlainPatch` (`service.ts:1401-1412`) skips any key whose value is `undefined`, and `providers` is in `PRODUCT_PLAIN_COLUMNS`.

The read-only notice renders: `surfaces legacy prestador names read-only inside the função cost section` asserts the full string `Prestadores antigos deste cadastro não foram convertidos automaticamente: Ana. Recadastre o custo por função acima.` and that the payload still has no `providers`. No backfill is correct - a provider row keys on free-text `personName` with no deterministic mapping to a `funcaoId`.

## 6. Anti-gaming

Per-file `it()` / `expect()` counts across every modified test file: **no `it()` count dropped anywhere.** Only `combobox-adoption.test.tsx` moved down on expects (94 -> 92), the file with the rewritten test; `areas-view.test.tsx` gained 2 (`not.toHaveProperty('openPrice')` and `not.toHaveProperty('providers')` alongside its existing `'type'` check).

**Rewrite (a)** `optimistic-row-guard.test.tsx`, `the produto prestador pool` -> `the produto função cost pool`. The old subject (a pool of `people`) no longer exists in this dialog. The rewrite pins the pool that replaced it with the same shape and one **more** negative: `Prestador` offered as positive control, `Vendedor` (system) not offered, `Função Arquivada` (archived) not offered. Still an app-level wiring test no dialog-level test can see, which was the original reason it existed. **Stronger.**

**Rewrite (b)** `combobox-adoption.test.tsx`, `keeps a free-text prestador name` -> `offers a create row on the área picker and never on the função cost picker`. The create-row mechanism it guarded is still asserted, on the picker in the same dialog that legitimately has one (`+ Criar nova área "FXL Serviços"`, correct feminine agreement), and gains a two-sided negative on the função picker. Its other guarantee (providers being written) is deliberately inverted by this slice and is covered by `drops the free-text prestador picker and never writes providers`. **Equivalent-to-stronger.**

**Slice 09 was not undone, and neither pool was re-narrowed.** I constructed the check rather than trusting the rewrite:

- `isCollaboratorPerson` now has exactly one call site, `SalesOpsApp.tsx:4785`, the proposta wizard's Profissional pool, `isCollaboratorPerson(person) && person.status === 'active'`. That line is **untouched by this diff** - slice 09's fix stands.
- The produto Prestador pool was not narrowed, it was **deleted along with its editor**. There is no surviving pool to narrow.
- The replacement pool, `funcoes.filter(f => f.status === 'active' && !f.isSystem)`, is not a narrowing of anything that existed. Excluding system funções is right (`vendedor` / `finder` are `isSystem: true` per `service.ts:248-249` and are already paid by `Comissionamento padrão`); excluding archived matches the convention CLAUDE.md already documents for the assignment picker.

## 7. `CLAUDE.md` truth check - every sentence verified true

New `## Produtos & Serviços` section, all 13 bullets checked against code:

- route segment unchanged (`navigation.ts` id stays `produtos`), label and title changed - true.
- serviço own value forced to 0 on write and list prints `Variável` - true (`setupBrl: isService ? 0 : ...`).
- `openPrice` a server-written projection guarded by a DB CHECK, dialog never sends it - true (migration 0013; payload has no `openPrice`).
- `isServiceProduct` is the one place any branch on the discriminator happens - true: `calculations.ts:46` is `product?.kind === 'service'`; the only direct `product.kind` read is `productForm`'s seed at L3034, and every other `.kind` in the file is an unrelated discriminator (`modal`, `payable`, `pendingAction`). "A row without `kind` reads as a Produto" - true.
- filter renders inside the card and above the empty state; serviço trades three columns for three - true.
- kind filter is component state read by the header action - true (`SalesOpsApp` `useState`, read by `headerAction` and `runHeaderAction`).
- six flat columns, literal is `fix` never `fixed`, `'none'` + `1` is the app default, recurring amount deliberately absent - true.
- blank `Número de ciclos` submits `null`, no `Prazo indeterminado` checkbox - true.
- entrada sits on top and the endpoints cap at 120, so 120 without / 119 with - true (`service.ts:519-521` and `:392`).
- costs flat under `bootstrap.productFuncaoCosts`, cents, never format with `formatProductCommission` - true.
- picker offers active non-system only, used função filtered out so `duplicate_funcao_cost` is unreachable - true.
- `providers` deprecated, writes omit the key, legacy names read-only, no backfill possible - true (probed).

Three corrections were **genuine** corrections, not new errors:

1. The `onCreate` list dropped `prestador`. Leaving it would now be false, because that picker is deleted. The added sentence about the função cost picker having no create row is true (no `onCreate` prop on that `Combobox`; the section's empty state does point at `Cadastros > Funções`).
2. `isCollaboratorPerson` "has exactly one call site left" - verified above.
3. The Áreas bullet dropped the stale `openPrice` mention now that classification is `kind`. `type` is genuinely gone from both the web type and the schema (renamed to `kind` in migration 0013).

Only nit: "only the nav label and the page title changed" - the page *subtitle* changed too. The operative claim (the route segment is unchanged) is true; not counted as a false sentence.

## 8. Slice 11 is not red-lined

All three of slice 11's labels are used verbatim and pinned:

- `Parcelas restantes` and `Número de ciclos` are asserted **mounted** as positive controls in `does not reintroduce any control the payment plan builder removes`, which also asserts the absence of `Dividir em`, `+ parcela`, `Número de parcelas`, `Remover parcela`, `Adicionar recorrência`.
- `Tipo de entrada` is exercised through `pickOption('Tipo de entrada', ...)` in several tests, and the harness throws `combobox not found` if it is renamed.

Asserting on the DOM rather than on source text is the right call here: all five forbidden strings still legitimately exist in the wizard slice 11 rewrites, so a source-text guard would be unfalsifiable.

## 9. Handed-off items closed

- **`productType` type lie:** `type: string` removed from `SalesOpsProduct`; `productType: product?.type ?? 'SaaS'` became the literal `productType: 'SaaS'` with a comment. No wire change - the expression always took the fallback, and the server derives `product_type_snapshot` from the product's own `kind`.
- **Nav label:** three sites updated (`navigation.ts:66`, `navigation.test.ts`, `routing.test.tsx`, plus `optimistic-row-guard.test.tsx`), one more than the brief flagged. No standalone `Produtos` nav label remains. The two surviving `Produtos` strings in app source are the filter segment's own button text (correct) and a wizard hint (see notes).
- **`productFuncaoCosts` wiring:** complete through `types.ts` -> `hooks.ts` selector -> `emptyBootstrap` -> `ProductsView` (whole array, scoped per row) -> `ProductDialog` (pre-filtered by `productId`) -> submit payload. `optimistic.ts` rebuilds bootstraps with `{ ...snapshot }` spreads, so the key survives an optimistic write.

## 10. Correctness and scope

- `apps/api/**` **untouched** - diffstat is 27 files, all under `apps/web/src/sales-ops/` plus `CLAUDE.md`.
- Optimistic invariant intact: cost rows and products are not optimistic collections; the produto dialog's área picker still excludes unsaved áreas (pinned by `optimistic-row-guard`); no placeholder id reaches a request body.
- No raw account or workspace id rendered. The `Custos padrão` cell title resolves names via `funcaoNameById`, falling back to the literal `'Função'`, never to a uuid.
- pt-BR gender correct throughout: `Nenhuma função disponível`, `Nenhuma função cadastrada ainda`, `+ Criar nova área`, `Nenhum custo padrão definido`, `Nenhum serviço cadastrado`.
- Money via the existing helpers, integer cents, `numeric(5,2)` rates. No `any` cast and no em dash in any added line.
- Commit hygiene: one commit, `feat(sales-ops): ...`, no co-author trailer, no AI attribution, no em dash.

### The three self-reported deviations, judged

1. **Extra `funcoes` prop on `ProductsView`** - justified. The `Custos padrão` cell title needs función *names* and cost rows carry only `funcaoId`. The alternative (nesting names onto cost rows) would break the flat-array convention CLAUDE.md documents. Accept.
2. **The six default fields optional rather than required** - justified. Matches the documented `kind?` precedent two lines above; every reader falls back to the app default, and `summarises the app-default plan as 1x rather than a dash` explicitly asserts the rendered text contains neither `NaN` nor `undefined`. Accept.
3. **`type="number"` rather than a plain text input** - justified, and I verified the premise rather than taking it: `apps/web/src/index.css:88-93` sets `appearance: textfield` plus `::-webkit-outer-spin-button` / `::-webkit-inner-spin-button { appearance: none }`, so no spinner renders and native `min` / `max` validation is retained. The plan's concern is satisfied by CSS that postdates the plan. Accept.

## The defect (reason for FAIL)

**A stored `Custos padrão por função` row whose função has since been archived renders as an unset picker.**

`eligibleFuncoes` filters to `status === 'active' && !isSystem`, and the per-row option list only re-admits an already-used função via `funcao.id === row.funcaoId` **within that already-filtered list**. An archived função is absent from `eligibleFuncoes` entirely, so the escape hatch never fires and no option matches the row's stored value. The `Combobox` is also not given a `valueLabel`, so its trigger falls back to the placeholder.

Probed directly - product with one cost row of `valueBrl: 30000` for an archived função:

```
trigger text  >>>Selecione a função<<<     (the placeholder, not the função)
offered       >>>["Desenvolvedor"]<<<      (the archived função is not offered)
cost value    >>>300<<<                    (renders correctly)
payload costs >>>[{"funcaoId":"fc000009-…","mode":"fix","valueBrl":30000}]<<<
```

Why this is a defect and not an edge case:

- **It is a normal lifecycle state, not exotic.** A função is never deleted, only archived - that is this repo's documented design. So "a cost row pointing at an archived função" is the expected end state of archiving any função that has a cost, not a corrupted row.
- **The row misrepresents stored configuration.** It reads as "a cost of R$ 300,00 for no função". The operator cannot restore the correct value, because the archived função is not offered; and if they do the natural thing and pick something, the R$ 300,00 silently retargets to a different função.
- **It contradicts the convention `CLAUDE.md` documents for this exact entity**, one section above the new one: "An archived função stays visible on the people who already carry it but disappears from the assignment picker." The Pessoa dialog honours that. This new editor does not.
- **The code it replaced handled the analogous case.** The deleted prestador `Combobox` passed `valueLabel={provider.personName}` precisely so a value absent from the option list stayed displayable. That guard was dropped rather than carried across.

Scope of the fix is small: admit `row.funcaoId` into `eligibleFuncoes` (or pass a `valueLabel` resolved from the full `funcoes` list) so a stored función stays visible and selectable on the row that already carries it, and pin it with one test. The list view already gets this right - it builds `funcaoNameById` from the unfiltered `funcoes`, so the archived name resolves correctly there.

## Notes (not blocking, not counted against the verdict)

- **Untested clamp.** The submit-side installment clamp is unpinned; see 4b.
- **Formatting drift.** ~670 mis-indented added lines; see 2. No formatter is configured, so no gate catches it.
- **Stale cross-reference.** `SalesOpsApp.tsx:5751` still reads `Defina a área deste produto em Cadastros > Produtos.` while that nav entry now reads `Produtos & Serviços` (asserted verbatim in `sale-wizard-free-items.test.tsx:287`, so it moves as a pair).
- **Commit prose.** The body says the `type` field left "the ten fixtures that carried it"; the diff shows twelve.
- The `paymentMethodOptions` / `paymentMethodLabels` `Pix` vs `PIX` split the implementer noted is pre-existing and correctly left alone.

## Tree restored

Every probe was reverted and byte-identity confirmed with `git hash-object` against `git rev-parse HEAD:<path>`:

- `apps/web/src/sales-ops/SalesOpsApp.tsx` - `8b61c0b287630da677fb3dbd63f77dcb89b19086`, matches HEAD (mutated twice, restored).
- `apps/web/src/sales-ops/__tests__/product-service-dialog.test.tsx` - `87db86a29fb2178d6b735ef6a0b1c87e6c8a6d33`, matches HEAD (probe tests appended twice, restored).
- `apps/api/test/rls/zz-verify-probe.test.ts` - created, then deleted.

`git diff HEAD` is empty. `HEAD` is still `ec2b364`; nothing was merged, pushed, committed or amended. `git status --porcelain` shows only the two entries that were already untracked when I started:

```
?? .vscode/
?? nexo/runs/batch-01K9C0FXA7RQ8VZTN3KDM6WS4E/agents/exec-10-produtos-servicos-web.result.json
```
