---
id: 04-prefill-profissionais-do-produto
milestone: v2.4.0
status: todo
depends_on: ["03-profissional-picker-funcao-first"]
files_modified: [apps/web/src/sales-ops/calculations.ts, apps/web/src/sales-ops/SalesOpsApp.tsx, apps/web/src/sales-ops/__tests__/funcao-cost-seeding.test.ts, apps/web/src/sales-ops/__tests__/sale-wizard-funcao-costs.test.tsx, CLAUDE.md]
acceptance: "given a NEW proposta whose item is a produto declaring a `sales_ops_product_funcao_costs` row for Mentor, when the operator reaches step 3 `Custos e margem`, then `Profissionais alocados` already holds exactly one row whose FUNÇÃO is Mentor and whose CUSTO ALOCADO is that declaration resolved against the item subtotal with PROFISSIONAL left empty, that row is never duplicated on a re-render nor resurrected after the operator deletes it nor added twice for a função the operator already allocated by hand, no row is ever seeded when reopening a saved proposta, and step 3 refuses to advance until every such row has a pessoa or is removed."
---

# 04 - prefill profissionais do produto

User item 3, verbatim:

> Look how in the 'Advisor 360' product I have 75% for the 'Mentor' [in CUSTOS PADRÃO POR FUNÇÃO].
> But when creating the proposal it is not bringing him automatically, and letting me select only the person that will be attached to it.

Screenshot evidence: `Editar produto` step 4 shows `CUSTOS PADRÃO POR FUNÇÃO` with one row (função `Mentor`, unit `%`, value `75`), while `Nova proposta` step 3 shows `Nenhum profissional alocado` and `Custos profissionais R$ 0` for a proposta whose itens include that produto.

This slice runs AFTER `03-profissional-picker-funcao-first` and assumes FUNÇÃO is already the first column of the `Profissionais alocados` table and that the PROFISSIONAL picker is already filtered by the row's função. Nothing here depends on the column ORDER (the seeding is state-level, not layout-level), but the two slices compose deliberately: a seeded row is exactly the shape slice 03's filtered picker was built for, a known função with an unknown pessoa.

---

## 1. Current behaviour

### 1.1 The professionals state

`apps/web/src/sales-ops/SalesOpsApp.tsx:5528`

```
const [professionals, setProfessionals] = useState<ProfessionalForm[]>(prefill?.professionals ?? []);
```

On the CREATE path `prefill` is `null` (`SalesOpsApp.tsx:5447`, `const prefill = editSale ? deriveWizardPrefill(editSale, bootstrap) : null;`), so the array starts EMPTY and there is no code path anywhere that adds a row except the `+ profissional` button at `SalesOpsApp.tsx:7272-7296`. That is the whole defect: nothing reads `bootstrap.productFuncaoCosts` in order to CREATE a row. The empty state at `SalesOpsApp.tsx:7310-7314` (`Nenhum profissional alocado`) is therefore what the screenshot shows, and `professionalCents` (`SalesOpsApp.tsx:5881-5884`) sums an empty array, which is the `Custos profissionais R$ 0` in the margin panel.

The row type is `ProfessionalForm` at `SalesOpsApp.tsx:5035-5061`: `personId`, `personName`, `funcaoId`, `funcaoName`, `costUnit`, `costPct`, `costBrl`, `costManual`.

### 1.2 The render-phase produto-default guard for professional costs

`apps/web/src/sales-ops/SalesOpsApp.tsx:5787-5804`, the fourth of the file's render-phase source-key syncs:

```
const funcaoCostKeyNow = JSON.stringify(
  [...funcaoCostBasis.entries()].map(([funcaoId, entry]) => [funcaoId, entry.cents]),
);
if (funcaoCostKey !== funcaoCostKeyNow) {
  setFuncaoCostKey(funcaoCostKeyNow);
  setProfessionals((current) =>
    current.map((row) =>
      row.costManual || row.costUnit === 'pct' || !row.funcaoId
        ? row
        : { ...row, costBrl: centsToInput(funcaoCostBasis.get(row.funcaoId)?.cents ?? 0) },
    ),
  );
}
```

Its state key is `funcaoCostKey` (`SalesOpsApp.tsx:5530`). It only ever REWRITES existing rows; it never appends one. It is preceded by the three sibling guards it is modelled on: `commissionDefaultsSource` at `SalesOpsApp.tsx:5629-5642` (keyed on the product id and its commission template, `commissionDefaultsSourceKey` at `5081-5098`), `planShapeSource` at `SalesOpsApp.tsx:5700-5712` (keyed by `planShapeSourceKey` at `5208-5216`, product id plus stored plan template), and `recurringSource` at `SalesOpsApp.tsx:5742-5754`. All four share one shape: advance the source key UNCONDITIONALLY first, then apply at most one conditional `setState`, so the sequence provably terminates on the next render.

The second produto-default seam for a professional row is `applyFuncaoToProfessional` at `SalesOpsApp.tsx:6251-6262`: picking a função on a row re-derives `costBrl` from `funcaoCostBasis` unless `costManual`.

### 1.3 Where `productFuncaoCosts` is read

- `SalesOpsApp.tsx:5767-5774` (the wizard): `buildFuncaoCostBasis(items.map(...), bootstrap.productFuncaoCosts)`. The rows arrive FLAT and are scoped by `productId` inside `buildFuncaoCostBasis` (`apps/web/src/sales-ops/calculations.ts:200-229`), which returns `Map<funcaoId, {cents, contributions[]}>` summed over every item whose produto declares that função. `describeFuncaoCostBasis` (`calculations.ts:232-241`) renders that same entry as `5% de FXL Custom (R$ 20.000,00)`.
- `SalesOpsApp.tsx:5780-5786`: `productItemsSubtotalCents`, the fallback base for a `%` row whose função no produto declares.
- `SalesOpsApp.tsx:1380` and `SalesOpsApp.tsx:1439` (the produto dialog, `funcaoCosts` prop, filtered by `productId` at 1439). Out of scope here.

### 1.4 `costManual` semantics as they actually stand

`ProfessionalForm.costManual` doc comment, `SalesOpsApp.tsx:5052-5060`: set on the first keystroke; while false the cost re-derives from the produto default for the row's função; once true it is never recomputed. `setProfessionalCostUnit` (`SalesOpsApp.tsx:6028-6058`) pins in both directions. `restoreProfessionalDefault` (`SalesOpsApp.tsx:6061-6076`) is the only un-pin.

`deriveWizardPrefill` sets it unconditionally on the EDIT path, `SalesOpsApp.tsx:5299-5301`:

```
// Unconditional: a persisted cost is a saved decision, so nothing on the
// edit path may recompute it behind the operator.
costManual: true,
```

That is what CLAUDE.md line 175 means by "a prefilled row is `costManual` unconditionally": PREFILLED FROM A STORED PROPOSTA. See D3 below, which is the one place this plan deliberately departs from the brief.

### 1.5 The step-3 gate and the payload

- `professionalsValid` / `canAdvanceStepThree`: `SalesOpsApp.tsx:5851-5854`, today only `Boolean(funcaoId) || Boolean(funcaoName.trim())`.
- Its banner: `SalesOpsApp.tsx:7519-7523`, `Selecione a função de cada profissional alocado.`, gated on `showCostErrors`.
- `draftValid`: `SalesOpsApp.tsx:5871-5879`. Does NOT consider `professionals` at all. It gates the always-visible `Salvar rascunho` footer button at `SalesOpsApp.tsx:7864-7874`.
- `createPayload` maps every row straight through: `SalesOpsApp.tsx:6399-6409`, then `buildSalePayload` (`calculations.ts:684-697`) trims `personName` and drops a blank `personId` to `undefined`.

Server side, and this is decisive for D5:

- `SaleProfessionalSchema` at `apps/api/src/domains/sales-ops/service.ts:346-361` declares `personId: uuid.optional()` but `personName: z.string().min(1)`. A row with an empty pessoa is therefore a ZOD failure, not a soft one.
- `resolvePartyContexts` at `apps/api/src/domains/sales-ops/service.ts:655-708` checks `if (professional.personId && !peopleById.has(...)) throw new SaleInputError('person_not_found', index)` at line 699, i.e. it only validates a personId that is PRESENT. The blocking constraint on a person-less row is the `personName.min(1)` above, which surfaces as a bare `400 validation_error` with no operator-legible message.

---

## 2. The fix

### D1 - one new pure pair in `calculations.ts`

Add to `apps/web/src/sales-ops/calculations.ts`, immediately after `describeFuncaoCostBasis` (`calculations.ts:241`), so the seeding rule lives beside the basis it reads:

```
export function funcaoCostSeedKey(productId: string, funcaoId: string): string
export type FuncaoCostSeed = { funcaoId: string; costCents: number }
export type FuncaoCostSeedPlan = { keys: string[]; seeds: FuncaoCostSeed[] }
export function planFuncaoCostSeeds(
  items: FuncaoCostBasisItem[],
  costs: SalesOpsProductFuncaoCost[],
  basis: Map<string, FuncaoCostBasisEntry>,
  seededKeys: readonly string[],
  allocatedFuncaoIds: readonly string[],
): FuncaoCostSeedPlan
```

`funcaoCostSeedKey(productId, funcaoId)` returns the literal `` `${productId}::${funcaoId}` ``. It is exported so the test names the key rather than re-spelling the template.

`planFuncaoCostSeeds` body, exactly:

1. Build `seen = new Set(seededKeys)` and `allocated = new Set(allocatedFuncaoIds.filter(Boolean))`.
2. Bucket `costs` by `productId`, the same way `buildFuncaoCostBasis` does at `calculations.ts:204-209`.
3. Walk `items` in ARRAY ORDER. Skip any item without `productId`.
4. For each item, walk that produto's cost rows in `costs` ARRAY ORDER. For each:
   - `key = funcaoCostSeedKey(cost.productId, cost.funcaoId)`; if `seen.has(key)` continue; otherwise `seen.add(key)` and push `key` onto `keys`. This happens BEFORE and INDEPENDENTLY of whether a row is produced.
   - If `allocated.has(cost.funcaoId)` continue (no row). Otherwise `allocated.add(cost.funcaoId)` and push `{funcaoId: cost.funcaoId, costCents: basis.get(cost.funcaoId)?.cents ?? 0}` onto `seeds`.
5. Return `{keys, seeds}`.

Consequences that the executor must not re-decide:

- **One row per FUNÇÃO, one key per (PRODUTO, FUNÇÃO).** Two produtos on the proposta that both declare `Mentor` yield TWO keys and ONE row, whose cents are the SUMMED `basis` entry, which is exactly what `buildFuncaoCostBasis` already aggregates and exactly what `applyFuncaoToProfessional` would have written had the operator picked Mentor by hand. Two rows would double-charge the same função.
- The function is pure and total: no `Date`, no randomness, no cadastro lookups, no `status` reasoning. Anything status-shaped is filtered by the caller (D2).

### D2 - the fifth render-phase guard, CREATE path only

In `SaleWizardDialogBody`:

1. Hoist the array literal currently inlined at `SalesOpsApp.tsx:5768-5772` into `const funcaoCostItems = items.map(...)` and pass it to `buildFuncaoCostBasis`, so the guard below reuses the identical item projection instead of rebuilding it.
2. Add, beside `funcaoCostKey` at `SalesOpsApp.tsx:5530`:
   `const [seededFuncaoCostKeys, setSeededFuncaoCostKeys] = useState<string[]>([]);`
3. Add a memo beside `allocatableFuncoes` (`SalesOpsApp.tsx:5431-5443`):
   `const seedableFuncaoCosts = useMemo(() => bootstrap.productFuncaoCosts.filter((cost) => allocatableFuncoes.some((funcao) => funcao.id === cost.funcaoId)), [bootstrap.productFuncaoCosts, allocatableFuncoes]);`
   `allocatableFuncoes` is already "active, non-optimistic, plus this session's inline creates". Filtering the SEED INPUT and not the BASIS is load-bearing in both directions: an ARCHIVED função must not be auto-proposed as a new allocation (CLAUDE.md: an archived função "disappears from the assignment picker", and a seeded row IS a new assignment), while `funcaoCostBasis` must keep summing every declaration so that a row whose função the operator picks by hand still prefills. Because the archived declaration never reaches `planFuncaoCostSeeds`, its key is never recorded either, so reactivating a função mid-session seeds it on the next render, which is the behaviour with no special case in it.
4. Immediately AFTER the existing `funcaoCostKey` block (`SalesOpsApp.tsx:5787-5804`), add:

```
if (!editSale) {
  const seedPlan = planFuncaoCostSeeds(
    funcaoCostItems,
    seedableFuncaoCosts,
    funcaoCostBasis,
    seededFuncaoCostKeys,
    professionals.map((row) => row.funcaoId),
  );
  if (seedPlan.keys.length > 0) {
    setSeededFuncaoCostKeys([...seededFuncaoCostKeys, ...seedPlan.keys]);
    if (seedPlan.seeds.length > 0) {
      setProfessionals((current) => [
        ...current,
        ...seedPlan.seeds.map((seed) => ({
          personId: '',
          personName: '',
          funcaoId: seed.funcaoId,
          funcaoName: allocatableFuncoes.find((funcao) => funcao.id === seed.funcaoId)?.name ?? '',
          costUnit: 'fix' as const,
          costPct: '0',
          costBrl: centsToInput(seed.costCents),
          costManual: false,
        })),
      ]);
    }
  }
}
```

`funcaoName` is guaranteed non-empty by the `seedableFuncaoCosts` filter; the `?? ''` is the type-level tail, not a real branch.

Placement AFTER the `funcaoCostKey` guard is required: that guard maps over EXISTING rows and its key must already have advanced for this render, so a row appended here is never also visited by it in the same pass.

**Termination.** `seededFuncaoCostKeys` only grows, and `planFuncaoCostSeeds` returns only keys not already in it. The declaration set is finite (`items x productFuncaoCosts`), so after one `setState` the next render returns `keys.length === 0` and no setter runs. Identical proof shape to the four guards already in this component.

**StrictMode.** The seen-set is `useState`, never a `useRef` mutated during render. A ref would be marked "seeded" on React's discarded first render pass while the `setProfessionals` from that pass is thrown away, and the row would silently never appear.

### D3 - `costManual: false` on a seeded row (deliberate departure from the brief)

The brief asked for `costManual` unconditionally, citing CLAUDE.md line 175. That sentence describes `deriveWizardPrefill`, i.e. a row PREFILLED FROM A PERSISTED PROPOSTA, and the code comment it documents says so in as many words (`SalesOpsApp.tsx:5299-5300`: "a persisted cost is a saved decision"). A produto-seeded row is the opposite kind of object: it is a produto DEFAULT, and CLAUDE.md's Propostas invariant is that "Every commercial number a produto supplies is a per-proposta DEFAULT, never a constraint", re-applied until the operator pins it.

Pinning a seeded row would ship a concrete money bug on the exact screen in the report. `Advisor 360` is a Serviço; a Serviço's `Valor negociado` prefills as `"0"` and is typed by the operator on step 1 (CLAUDE.md, Produtos & Serviços). The Mentor row is therefore seeded at 75% of R$ 0 = R$ 0,00 on the very first render, and with `costManual: true` it would stay R$ 0,00 forever, no matter what the operator negotiates. `costManual: false` makes the guard at `SalesOpsApp.tsx:5790` re-derive it the moment the item value lands, which is the whole point of the feature.

The brief's stated worry ("so the render-phase guard cannot later clobber them") does not apply: that guard writes `centsToInput(funcaoCostBasis.get(row.funcaoId)?.cents ?? 0)`, which is byte for byte the expression the seed itself used. It cannot clobber a seeded row; it can only keep it current. The row pins itself on the first keystroke, on a unit toggle, or on a função change with a typed cost, exactly like a hand-added row.

Second-order benefit, and the reason no rendering change is needed: the footer branch at `SalesOpsApp.tsx:7483-7502` prints the `Alterado manualmente` chip when `costManual` and the derivation line otherwise. A `costManual: true` seed would label a row nobody touched as manually altered, contradicting CLAUDE.md's own rule that the marker "renders only when a field is pinned AND diverges from the current default". With `costManual: false` a seeded row renders `75% de Advisor 360 (R$ 20.000,00)` under its input and the whole chip question disappears. Do NOT touch that branch in this slice.

### D4 - idempotency, in one table

| Event | What happens | Why |
| --- | --- | --- |
| Re-render, nothing changed | Nothing. `keys` is empty. | Every declaration key is already in `seededFuncaoCostKeys`. |
| Item unit price edited | No new row; the existing seeded row's cents re-derive via the `funcaoCostKey` guard. | The key set is unchanged; D3 keeps the row unpinned. |
| Operator DELETES a seeded row | It stays deleted, forever, for this wizard session. | The key was recorded at seed time and is never removed. Deletion does not un-record it. |
| Operator already added a row for that função by hand | Key recorded, NO row appended. | `allocatedFuncaoIds` carries the live `professionals` funcaoIds into the pure function. |
| Two produtos declare the same função | Two keys, one row, summed cents. | See D1. |
| Produto removed from the itens, then re-added | No re-seed. | Keys are never removed. Once seeded, once. |
| Produto removed from the itens, row kept | The row survives and its cost falls to R$ 0,00 automatically. | Rows are NEVER auto-removed: the operator may already have assigned a pessoa, and silently deleting that is destructive. The `?? 0` in the `funcaoCostKey` guard does the rest. |
| Wizard closed and reopened | Full re-seed. | `SaleWizardDialogBody` is keyed and unmounted (`SalesOpsApp.tsx:5341-5358`), so the session state including the key set is genuinely new. This is correct: a fresh `Nova proposta` must propose the produto defaults again. |

### D5 - create vs edit

The guard is wrapped in `if (!editSale)`. `editSale` is the prop that decides `prefill` at `SalesOpsApp.tsx:5447`, so `!editSale` is exactly "no `deriveWizardPrefill` ran", which is exactly "`professionals` did not come from `bootstrap.saleProfessionals`". No other discriminator is acceptable: keying off `professionals.length === 0` would re-seed a saved proposta whose rows the operator had deleted before saving, and keying off the funcaoIds already present would re-seed a saved proposta from which the operator deliberately removed the Mentor row.

Seeding is a CREATE-only affordance, stated positively: on a saved proposta the stored `sales_ops_sale_professionals` rows ARE the decision, and the ABSENCE of a row is equally a decision. Adding a produto mid-edit therefore seeds nothing; the operator clicks `+ profissional` and picks the função, and `applyFuncaoToProfessional` (`SalesOpsApp.tsx:6251-6262`) still prefills the cost from the same basis. That degradation is graceful and is a deliberate scope limit (section 4).

### D6 - an unfilled seeded row BLOCKS step 3; it is never dropped at submit

Decision: **step 3 blocks with a validation message.** Rejected: dropping the row at submit.

Three reasons, in order of weight:

1. **Margin parity.** CLAUDE.md pins `computeSaleFinancials` as the ONE margin implementation, so that "the `Margem líquida` on screen equals the persisted `net_margin_brl`". `professionalCents` (`SalesOpsApp.tsx:5881-5884`) sums EVERY row, seeded ones included, and feeds the step-3 and step-4 panels. Dropping a person-less row at submit would persist a larger margin than the number the operator just read and approved on the Revisão card. Blocking is the only option that holds the invariant without also having to exclude the row from the on-screen margin, which would defeat the report's own evidence (`Custos profissionais R$ 0`).
2. **The 400 already exists and is illegible.** `personName: z.string().min(1)` (`apps/api/src/domains/sales-ops/service.ts:349`) rejects the row, and `routes.ts` maps it to a bare `400 validation_error`. Blocking locally converts an opaque server failure into an actionable pt-BR sentence next to the offending row.
3. **No silent drops.** This wizard already refuses to write a silent zero for a percentage with no base (`SalesOpsApp.tsx:7463-7471`). Silently discarding a cost row that the app itself proposed is the same class of behaviour.

Implementation, exact:

- Replace `SalesOpsApp.tsx:5851-5854` with three consts:
  - `professionalsFuncaoValid` = the existing predicate, unchanged.
  - `professionalsPersonValid = professionals.every((professional) => Boolean(professional.personId) || Boolean(professional.personName.trim()))`. The `personName` clause is required, not belt-and-braces: the picker's `onCreate` at `SalesOpsApp.tsx:7353-7361` writes `personId: ''` with a typed name, and CLAUDE.md sanctions it ("profissional accepts the typed name verbatim").
  - `professionalsValid = professionalsFuncaoValid && professionalsPersonValid`; `canAdvanceStepThree = professionalsValid` stays as written.
- Add `&& professionalsValid` to `draftValid` (`SalesOpsApp.tsx:5871-5879`). Without it `Salvar rascunho`, which is visible on EVERY step (`SalesOpsApp.tsx:7864-7874`), would post a person-less seeded row and 400. Blast radius is nil for rows the operator adds, because `+ profissional` seeds `personId` from `allocatablePeople[0]` (`SalesOpsApp.tsx:7278`), and nil for the edit path, where `personNameSnapshot` is always non-empty.
- Because that button then goes disabled from step 1 with no visible reason, make its `title` explain itself, and only that:
  `title={professionalsValid ? 'Salvar como rascunho para terminar depois' : 'Escolha o profissional de cada função sugerida pelo produto no passo 3, ou remova a linha'}`
- Keep the existing função banner exactly as it is but key it on the narrower const, and add a second banner beside it inside the same `Profissionais alocados` card (after `SalesOpsApp.tsx:7523`):
  - função: `showCostErrors && !professionalsFuncaoValid` -> `Selecione a função de cada profissional alocado.` (unchanged string).
  - pessoa: `!professionalsPersonValid` -> `Escolha o profissional de cada função sugerida pelo produto, ou remova a linha.`
  The pessoa banner is deliberately NOT gated on `showCostErrors`. `showCostErrors` means "the operator tried to advance and got it wrong"; an unfilled seeded row is the APP's own proposal and not yet anybody's mistake, so it explains itself the moment step 3 is on screen, and it is the only thing on screen that explains the disabled `Salvar rascunho`.
- Add `aria-label={`Remover profissional ${index + 1}`}` to the icon-only delete button at `SalesOpsApp.tsx:7504-7514`. It is the affordance the new banners tell the operator to use and it currently has no accessible name at all; it is also the hook the tests need. The string does not collide with any `not.toContain` guard in `sale-wizard-ui-contract.test.tsx` (`Remover parcela` is the banned one).

---

## 3. The named oracle test

### 3a. Pure, new file: `apps/web/src/sales-ops/__tests__/funcao-cost-seeding.test.ts`

Plain vitest, no DOM, covering `planFuncaoCostSeeds` and `funcaoCostSeedKey` against a hand-built `Map` from `buildFuncaoCostBasis`.

`describe('planFuncaoCostSeeds')`:

1. `it('seeds one row per funcao an item produto declares, with the basis cents')`
2. `it('keys a declaration on (productId, funcaoId), never on funcaoId alone')` - asserts `keys` for two produtos both declaring Mentor are two distinct `funcaoCostSeedKey` values.
3. `it('emits one row with the summed cents when two produtos declare the same funcao')` - `seeds.length === 1`, cents equal `basis.get(mentor).cents`.
4. `it('returns nothing once every declaration key has been seen')` - feed back the previous `keys`.
5. `it('records the key but emits no row for a funcao already allocated by hand')` - `keys.length === 1`, `seeds.length === 0`. This is the pin for "does not duplicate a manual row".
6. `it('does not re-emit a key for a row the operator deleted')` - `seededKeys` carries the key, `allocatedFuncaoIds` is empty, expect `{keys: [], seeds: []}`. This is the pin for "no resurrection".
7. `it('ignores free-form items and any produto with no declaration')`
8. `it('emits zero cents when the declaring item has no value yet')` - the Serviço-at-R$-0 case from D3.
9. `it('is deterministic in item order then cost-row order')`

### 3b. DOM, existing file: `apps/web/src/sales-ops/__tests__/sale-wizard-funcao-costs.test.tsx`

This is the ONLY web test file whose bootstrap carries a non-empty `productFuncaoCosts` and also renders the wizard (fixtures at lines 186-201: `FXL Custom` declares Desenvolvedor 5% and Testador R$ 300,00; `Landing Page` declares Testador R$ 300,00). Every other wizard test file passes `productFuncaoCosts: []` and is untouched by this slice. Verified by grep; do not widen the change.

**Mechanical migration of the 24 existing `it()` blocks.** Because item 1 defaults to `FXL Custom`, step 3 now opens with two seeded rows, so every test that says "profissional 1" would address a seeded row instead of the row it added. Apply ONE uniform change, no per-test judgement:

- Add a module-level `let seedsCleared = false;` reset to `false` inside `renderWizard` (`sale-wizard-funcao-costs.test.tsx:306`).
- Add `async function clearSeededProfessionals()` which returns immediately when `seedsCleared`, otherwise sets it and clicks `buttonByLabel('Remover profissional 1')` (the helper already exists at line 449) until no `button[aria-label^="Remover profissional"]` remains, flushing between clicks.
- Call it as the FIRST line of `addProfessional()` (line 432). It is a no-op on the second and later calls, so a test that adds two profissionais still keeps both, and a test that returns to step 3 later never loses the row it added.
- Do NOT put it in `goToCosts()`: the tests at lines 624 and 636 are edit-path (`renderWizard(sale)`) and must keep their STORED rows.

**New `describe('produto-seeded profissional rows')` in the same file**, using a `goToCostsKeepingSeeds()` that is `goToCosts()` without the clear:

1. `it('seeds a row per declared funcao on a new proposta, funcao filled and pessoa empty')` - after `goToCostsKeepingSeeds()`: `comboboxText('Função do profissional 1')` is `Desenvolvedor`, `Custo alocado do profissional 1` is `1000` (5% of R$ 20.000,00), row 2 is `Testador` at `300`, both PROFISSIONAL triggers show the placeholder, `Nenhum profissional alocado` is absent, and `rowFooterText(1)` contains `5% de FXL Custom (R$ 20.000,00)` and NOT `Alterado manualmente`.
2. `it('does not duplicate a seeded row when the item value changes')` - `backToProposta()`, retype `Valor unitário do item 1` as `40000`, `goToCostsKeepingSeeds()`: still exactly two rows, and row 1 is now `2000`. Pins both no-duplication and D3's unpinned re-derivation in one test.
3. `it('does not resurrect a seeded row the operator deleted')` - delete `Remover profissional 1`, `backToProposta()`, retype the value, return: exactly one row, and it is `Testador`.
4. `it('does not seed a second row for a funcao the operator already allocated')` - delete both, `+ profissional`, pick `Desenvolvedor`, add the second produto item `Landing Page` on step 1, return to step 3: still one `Desenvolvedor` row. (`Landing Page` declares only Testador, whose key was already recorded, so nothing new appears.)
5. `it('seeds nothing when reopening a saved proposta')` - `renderWizard(sale)` with a `saleProfessionals` fixture of ONE stored row and sale items on `FXL Custom`: exactly that one row, no Desenvolvedor and no Testador row added on top.
6. `it('blocks Avançar and Salvar rascunho until every seeded row has a pessoa')` - on step 3 the pessoa banner is present and `Salvar rascunho` is `disabled`; clicking `Avançar` keeps `Passo 3 de 4`; pick a pessoa on both rows and both unblock; then re-render, delete both rows instead, and assert they also unblock. Pins D6 in both of its escape hatches.
7. `it('sends the seeded row with its funcaoId and resolved cents')` - fill the pessoas, save, assert `onSave` carries two `professionals` entries with the right `funcaoId` and `costBrl` of `100000` and `30000`.

### Run once

```
pnpm --filter @fxl-sales/web exec vitest run \
  src/sales-ops/__tests__/funcao-cost-seeding.test.ts \
  src/sales-ops/__tests__/sale-wizard-funcao-costs.test.tsx \
  src/sales-ops/__tests__/sale-wizard-edit.test.tsx \
  src/sales-ops/__tests__/sale-wizard-ui-contract.test.tsx \
  src/sales-ops/__tests__/calculations.test.ts
```

(`apps/web/package.json` `test` is `vitest run`; `pnpm --filter <pkg> test -- <path>` does NOT filter in this repo, which is why `exec vitest run` is the established idiom in `nexo/plans/`.)

Full gate before handing to Verify: `pnpm run lint && pnpm run type-check && pnpm test`.

---

## 4. Scope limits (YAGNI)

- **No API change.** Nothing about `sales_ops_sale_professionals`, `SaleProfessionalSchema`, `resolvePartyContexts` or any migration. The row that reaches the wire is the same shape it has been since `0014_sale_professional_funcoes`.
- **No seeding on the edit path**, including a produto added mid-edit. D5.
- **No seeding of a pessoa.** The row's PROFISSIONAL stays empty by design; that is the literal request.
- **No auto-removal** of a seeded row when its produto leaves the itens. D4.
- **No persistence of "which rows were seeded"** beyond the wizard session. There is no column for it and no question that needs one.
- **Do not touch the `Alterado manualmente` / `Restaurar padrão` branch** at `SalesOpsApp.tsx:7452-7502`. D3 makes it correct without an edit.
- **Do not touch `buildFuncaoCostBasis`, `describeFuncaoCostBasis`, `professionalCostBaseCents`, `resolveProfessionalCostCents`.** The seeding reads them; it does not change them.
- **Do not touch the produto dialog** (`SalesOpsApp.tsx:1380`, `1439`) or `sales_ops_product_funcao_costs` editing.
- **Do not re-order or re-label the professionals table.** That is slice 03's, already merged when this runs.
- No em dash anywhere in code, comments or docs. Use a plain dash.

---

## 5. CLAUDE.md edits

Two edits, both inside `## Propostas domain`.

**Edit 1** - the tail of the existing paragraph at CLAUDE.md line 175. OLD, verbatim:

> The derivation is rendered under the input (`5% de FXL Custom (R$ 20.000,00)`) by `describeFuncaoCostBasis`, which reads the same entry the cents came from; a row goes `costManual` on the first keystroke and is never recomputed again, and a prefilled row is `costManual` unconditionally.

NEW, verbatim:

> The derivation is rendered under the input (`5% de FXL Custom (R$ 20.000,00)`) by `describeFuncaoCostBasis`, which reads the same entry the cents came from; a row goes `costManual` on the first keystroke and is never recomputed again, and a row prefilled from a STORED proposta by `deriveWizardPrefill` is `costManual` unconditionally, because a persisted cost is a saved decision.
>   A row SEEDED from a produto on the create path is the opposite object and is deliberately NOT `costManual`: a produto number is a default that must keep following the item value, and a Serviço seeds at 75% of the `"0"` its `Valor negociado` prefills with, so pinning it would freeze the cost at R$ 0,00 for the whole session. The guard cannot clobber such a row either way, because it writes exactly the expression the seed used.

**Edit 2** - a new bullet immediately after that paragraph:

> - A NEW proposta AUTO-SEEDS one `Profissionais alocados` row per função declared by the produtos on its itens, função filled from the cadastro and PROFISSIONAL left empty for the operator, through the pure `planFuncaoCostSeeds` in `apps/web/src/sales-ops/calculations.ts` driven by a fifth render-phase guard beside the `funcaoCostKey` one.
>   The seed fires once per `(produto, função)` declaration, tracked by `funcaoCostSeedKey` in a session key set that only ever GROWS, which is what makes deleting a seeded row permanent, re-adding the produto inert, and a re-render a no-op; the ROW is deduped per função instead, so two produtos declaring `Mentor` produce two keys and one row carrying the summed basis.
>   Only `editSale === null` seeds, so reopening a saved proposta can never add a row on top of its stored `sales_ops_sale_professionals`: the absence of a row there is itself a saved decision. Only funções that are currently allocatable seed, because a seeded row is a new assignment and an archived função disappears from assignment pickers; `buildFuncaoCostBasis` still reads the unfiltered declarations, so a hand-picked função still prefills.
>   A row with no pessoa BLOCKS step 3 and `Salvar rascunho` and is never silently dropped at submit: `professionalCents` already counts it in the margin the operator approved, and `SaleProfessionalSchema.personName` is `min(1)`, so dropping it would persist a margin the Revisão card never showed while keeping it would 400 illegibly. The banner is not gated on `showCostErrors`, because a seeded row is the app's proposal and not yet the operator's mistake.

---

## 6. Risk / invariants touched

| Risk | Assessment |
| --- | --- |
| A fifth render-phase `setState`-during-render guard | Lowest-risk shape available: it is the fifth instance of an idiom this component already proves four times, the key advances unconditionally before any conditional setter, and the key set only grows. Termination is proved in D2. |
| StrictMode double render | Addressed by construction: `useState`, never a render-mutated `useRef`. Called out in D2 because the ref version silently loses the row. |
| Blast radius on `sale-wizard-funcao-costs.test.tsx` | Real and bounded: 24 `it()` blocks in exactly one file, fixed by ONE mechanical helper wired into `addProfessional()`. Verified by grep that no other web test file combines the wizard with a non-empty `productFuncaoCosts`. |
| `draftValid` gains a clause | `Salvar rascunho` can now be disabled where it was not. Only ever for a person-less row, which today can only exist if the people cadastro is empty; the dynamic `title` plus the ungated banner are the two places that say why. |
| Margin parity (`computeSaleFinancials`) | Preserved, and it is the load-bearing reason for D6. The seeded row's cents enter the on-screen margin and the persisted one identically. |
| "Every produto number is a per-proposta DEFAULT" | Reinforced. D3 keeps a seeded row on the re-apply path instead of pinning it out of one. |
| `Alterado manualmente` renders only when pinned AND divergent | Untouched, and no longer at risk of a false positive on a seeded row, because of D3. |
| Archived-função handling | Follows the existing split: hidden from an assignment picker, still honoured on a row that already carries it. `funcaoCostBasis` stays unfiltered so no money read changes. |
| `resolvePartyContexts` / `SaleProfessionalSchema` | Not modified. Note for the record that CLAUDE.md's phrase "validates every `professionals[].personId`" is loose: `service.ts:699` only validates a personId that is PRESENT, and the real gate on an empty row is `personName: z.string().min(1)` at `service.ts:349`. That is the constraint D6 is built on; correcting the CLAUDE.md phrasing is out of scope for this slice. |
| Interaction with slice 03 | Ordering-independent. If slice 03 renames the row aria-labels, the new tests must use ITS labels; the seeding logic and `planFuncaoCostSeeds` are untouched by any layout change. |
