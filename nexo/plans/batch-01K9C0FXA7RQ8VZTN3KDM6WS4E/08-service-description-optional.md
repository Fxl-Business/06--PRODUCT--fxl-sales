---
id: 08-service-description-optional
milestone: v2.3.0
status: todo
depends_on: [07-produtos-servicos-api]
files_modified:
  - apps/web/src/sales-ops/calculations.ts
  - apps/web/src/sales-ops/SalesOpsApp.tsx
  - apps/web/src/sales-ops/__tests__/sale-wizard-service-description.test.tsx
acceptance: "given a proposta item whose catalog row is a Serviço, when the operator leaves `Nome / descrição do item` blank and advances or saves, then step 1 accepts the row and the persisted `productNameSnapshot` is the serviço catalog name, while open-price Produtos and itens avulsos still block on a blank description"
---

# Serviço items do not require a description

## Goal

On the Nova proposta wizard, an item whose catalog row is a **Serviço** must be savable without a `Nome / descrição do item`, because a serviço already has a catalog name to fall back on and the description is only there to record scope detail.
The relaxation is narrow: it must not touch **itens avulsos** (`productId` null, where the typed name is the item's only identity) and it must not touch **open-price Produtos** (where the current required-description rule is deliberate).
No new column, no parallel description field, and no migration: the existing `items[].productName` to `productNameSnapshot` fallback path in `saleItemDisplayName` already produces the catalog name when the description is blank, so this slice is a validation and copy change plus one shared predicate.

## Current state

### Client - where the description requirement is enforced

The description requirement for product rows is enforced in exactly one predicate and mirrored in two render sites.

- `apps/web/src/sales-ops/SalesOpsApp.tsx:3828-3836` - `itemsValid`.
  Line 3833-3834 is the rule to relax:
  ```ts
  const openPriceOk =
    !product?.openPrice || (Boolean(item.customLabel.trim()) && parseCurrencyToCents(item.unitBrl) > 0);
  ```
  The description and the negotiated value are fused into one condition, so relaxing the description naively would also relax the value.
- `apps/web/src/sales-ops/SalesOpsApp.tsx:3838` - `canAdvanceStepOne = canSaveBasics && itemsValid`.
  This is the only gate `advanceWizard` consults for step 1.
- `apps/web/src/sales-ops/SalesOpsApp.tsx:4034-4038` - `advanceWizard` sets `showItemErrors` then returns early on `!canAdvanceStepOne`.
- `apps/web/src/sales-ops/SalesOpsApp.tsx:4153` - the step-chip `disabled` rule reuses `canAdvanceStepOne`, so it follows the predicate automatically.
- `apps/web/src/sales-ops/SalesOpsApp.tsx:5194-5201` - the footer primary button.
  Its `disabled` is `saving || (wizardStep === 1 && !canSave)` (line 5196), and `canSave` (line 3783) never looks at descriptions.
  So the footer is **not** a second enforcement point; the gate is `advanceWizard` alone.
- `apps/web/src/sales-ops/SalesOpsApp.tsx:3839-3847` - `draftValid`, used by the `Salvar rascunho` button at line 5186.
  It already does **not** require a description on product rows (only `areaId`), which is why the existing test `saves an unlabeled custom draft with the catalog name fallback` passes today.
- `apps/web/src/sales-ops/SalesOpsApp.tsx:4426-4433` - per-row render flags: `customLabelValid`, `showCustomLabelError`, `showCustomUnitError`, `showAreaError`.
- `apps/web/src/sales-ops/SalesOpsApp.tsx:4495-4535` - the description block.
  Rendered only when `product?.openPrice` (line 4495); visible label `Nome / descrição do item` at 4498-4500; `aria-label` at 4503; placeholder `Ex.: Módulo Vendas` at 4513; the error line at 4518-4522; the pristine warning `Sistema personalizado - informe um nome/descrição e o valor negociado` at 4530.

### Client - where the fallback already lives

- `apps/web/src/sales-ops/SalesOpsApp.tsx:3936-3942` - `saleItemDisplayName`.
  For a product row: `if (!product.openPrice) return product.name;` then `return item.customLabel.trim() || product.name;`.
  The blank-description fallback to the catalog name already exists and needs no change in behaviour.
- `apps/web/src/sales-ops/SalesOpsApp.tsx:4099-4107` - `createPayload` sets `productName: saleItemDisplayName(item)` for product rows, preserving `productId: product?.id`.
- `apps/web/src/sales-ops/SalesOpsApp.tsx:5027` - step 4 review renders `items.map(saleItemDisplayName).join(', ')`, so the review string uses the same fallback.
- `apps/web/src/sales-ops/calculations.ts:180-187` - `buildSalePayload` trims `productName` before it leaves the browser.
- `apps/web/src/sales-ops/SalesOpsApp.tsx:3566-3591` - `deriveWizardPrefill`.
  Line 3584-3587 already round-trips a blank description correctly: when `productNameSnapshot === product.name` the edit wizard reopens with `customLabel: ''`, so a serviço saved without a description reopens blank rather than pre-filled with the catalog name.

### Client - free-form items (must stay required)

- `apps/web/src/sales-ops/SalesOpsApp.tsx:3495-3502` - `SaleItemForm`, with `kind: 'product' | 'free'` and the shared `customLabel` field.
- `apps/web/src/sales-ops/SalesOpsApp.tsx:3829-3830` - the `free` branch of `itemsValid` requires `areaId`, a non-blank `customLabel`, and a positive value.
- `apps/web/src/sales-ops/SalesOpsApp.tsx:3843-3846` - the same requirement inside `draftValid`.
- `apps/web/src/sales-ops/SalesOpsApp.tsx:4088-4098` - `createPayload` free branch, `productId: undefined` and `productName: item.customLabel.trim() || 'Item avulso'`.
- `apps/web/src/sales-ops/SalesOpsApp.tsx:4342-4422` - the free row render, label `Descrição do item`, error `Informe a descrição deste item avulso.` at 4408.

### Server - the item name validator

- `apps/api/src/domains/sales-ops/service.ts:136-152` - `SaleItemSchema`.
  Line 139 is `productName: z.string().trim().min(1).max(140)`.
- `apps/api/src/domains/sales-ops/service.ts:193` - `items: z.array(SaleItemSchema).min(1)` inside `SaleWriteBaseSchema`, shared by `CreateSaleSchema` (:199) and `UpdateSaleSchema` (:201-203), so `POST /sales` and `PUT /sales/:id` enforce the same rule.
- `apps/api/src/domains/sales-ops/service.ts:436-445` - persistence: `productNameSnapshot: item.productName`.

**Finding: no API change is required, and this is not a client-only fix.**
The client never sends an empty `productName` for a product row, because `saleItemDisplayName` substitutes `product.name` when `customLabel` is blank.
`product.name` is itself guaranteed non-empty by `ProductSchema` at `apps/api/src/domains/sales-ops/service.ts:65` (`name: z.string().min(1).max(140)`).
So the wire contract stays exactly as it is: `productName` remains required and non-empty on the API, and only the *client-side* obligation to type it moves.
Relaxing `service.ts:139` would be strictly worse - it would let a genuinely nameless item reach `sale_items.product_name_snapshot` (`apps/api/src/db/schema.ts:602`, `notNull`) and surface as an empty cell in the sale detail dialog.
One residual hole is closed defensively in Green step 4: `ProductSchema.name` has `.min(1)` but no `.trim()`, so a whitespace-only catalog name would make the fallback collapse to `''` and produce a 400.

### Where the resulting snapshot surfaces

The label produced by the fallback must be meaningful in all of these, and all of them read the same single field:

- Sale detail dialog item table - `apps/web/src/sales-ops/SalesOpsApp.tsx:1646-1650` (`item.productNameSnapshot`).
- Sales list primary-product column - `apps/web/src/sales-ops/SalesOpsApp.tsx:280-285` (`salePrimaryProductName`).
- Dashboard revenue by product - `apps/web/src/sales-ops/calculations.ts:213-214` and `apps/api/src/domains/sales-ops/service.ts:588-589`.
- Wizard step 4 review - `apps/web/src/sales-ops/SalesOpsApp.tsx:5027`.
- Payables and receivables views are **unaffected**: receivable labels are the `"N/M"` / `"MN/M"` convention and payable labels are commission/tax strings, neither of which embeds the item name.

## Truth table

`kind` below is the item row kind in `SaleItemForm` crossed with the slice-07 catalog discriminator.
"Required?" means "does a blank description block `advanceWizard` on step 1 and block `Salvar proposta`".
`draftValid` (the `Salvar rascunho` path) is unchanged by this slice and is listed for completeness.

| Catalog row | `SaleItemForm.kind` | `productId` | description | Required to advance? | Required for `Salvar rascunho`? | resulting `productNameSnapshot` |
| --- | --- | --- | --- | --- | --- | --- |
| Serviço | `product` | present | blank | **no (this slice)** | no | `product.name`, e.g. `Consultoria FXL` |
| Serviço | `product` | present | filled | no | no | the typed text, trimmed |
| Produto, `openPrice: true` | `product` | present | blank | **yes (unchanged)** | no | on draft: `product.name`, e.g. `FXL Custom` |
| Produto, `openPrice: true` | `product` | present | filled | no | no | the typed text, trimmed |
| Produto, `openPrice: false` | `product` | present | n/a - field not rendered | no | no | `product.name`, e.g. `FXL Finance` |
| any | `free` (avulso) | **null** | blank | **yes (unchanged)** | **yes (unchanged)** | n/a while blocked; `'Item avulso'` only if the payload is somehow forced |
| any | `free` (avulso) | null | filled | no | no | the typed text, trimmed |

Two invariants fall out of this table and are asserted in Red:

1. `productNameSnapshot` is never empty and never a raw id, for every cell.
2. The negotiated value requirement is orthogonal: a Serviço with a blank description still needs `unitBrl > 0`, because `openPrice`/variable-value rows have no catalog price to fall back on.

## Copy changes

Three cases, three distinct pristine hints.
The **`aria-label` stays byte-identical** (`Nome / descrição do item ${index + 1}`) in every case, so the existing queries in `sale-wizard-custom-item-labels.test.tsx` keep resolving.
Only the visible `<span>` label, the placeholder, and the hint line change, and only for the Serviço branch.

**Case A - Produto with `openPrice: true` (unchanged, keep verbatim):**

- visible label: `Nome / descrição do item`
- placeholder: `Ex.: Módulo Vendas`
- pristine hint: `Sistema personalizado - informe um nome/descrição e o valor negociado`
- blank-description error: `Informe o nome ou a descrição deste item personalizado.`
- zero-value error: `Informe um valor negociado maior que zero.`

**Case B - Serviço, description blank (new):**

- visible label: `Nome / descrição do item (opcional)`
- placeholder: `Ex.: detalhe do escopo`
- pristine hint: `Serviço com valor variável - sem descrição, o item aparece como "{product.name}"`
- blank-description error: **none, ever.** The `Informe o nome ou a descrição deste item personalizado.` line must not render for a Serviço.
- zero-value error: `Informe um valor negociado maior que zero.` (kept)

**Case C - Serviço, description filled (new):**

- visible label: `Nome / descrição do item (opcional)`
- pristine hint: `Serviço com valor variável - descrição opcional`
- zero-value error: `Informe um valor negociado maior que zero.` (kept)

**Case D - item avulso (unchanged, keep verbatim):**

- visible label: `Descrição do item`
- pristine hint: `Item avulso - informe a área, a descrição e o valor`
- blank-description error: `Informe a descrição deste item avulso.`

`sale-wizard-ui-contract.test.ts` impact: **none.**
That file asserts 21 positive substrings and 6 negative ones (lines 10-37).
The only two that live near the Itens block are `'Cadastrar produto'` (:20) and `'+ item avulso'` (:21), and neither is touched.
`Sistema personalizado - informe um nome/descrição e o valor negociado` is **not** among its assertions, and Case A keeps it anyway.
No negative assertion (:32-37) matches any new string.
So no edit to `sale-wizard-ui-contract.test.ts` is expected; if it fails, the implementation drifted from this plan.

## Red

Write the new tests first and watch them fail, then run the three regression files to prove they still pass afterwards.

Harness idiom to copy verbatim from `apps/web/src/sales-ops/__tests__/sale-wizard-custom-item-labels.test.tsx`: `// @vitest-environment happy-dom` on line 1, the `vi.mock('@/components/ui/dialog', ...)` block (:10-24), the `act` cast (:26-28), the `createRoot` lifecycle (:133-163), and the `buttonByText` / `labeledInput` / `labeledSelect` / `labeledButton` / `textOccurrences` / `click` / `changeInput` / `changeSelect` helpers (:165-213).
There is no `@testing-library/*` in this repo and `apps/web/vitest.config.ts` sets `environment: 'node'`, so do not reach for `render`, `screen`, or `fireEvent`.

### New file: `apps/web/src/sales-ops/__tests__/sale-wizard-service-description.test.tsx`

Fixture: one catalog row that is a Serviço named `Consultoria FXL` (variable value), one open-price Produto named `FXL Custom`, one fixed-price Produto named `FXL Finance`, one active Área, one seller, one client - the same shape as `sale-wizard-custom-item-labels.test.tsx:34-131`.
The Serviço must be the **first** product so `firstProduct` seeds item 1 (`SalesOpsApp.tsx:3718-3734`).

`describe('sale wizard serviço description', ...)` with these tests:

1. `it('advances step 1 with a serviço item whose description is blank')`
   Set `Valor unitário do item 1` to `4000`, leave `Nome / descrição do item 1` untouched, click `Avançar`.
   Asserts the container now contains `Plano de pagamento` and does **not** contain `Informe o nome ou a descrição deste item personalizado.`.

2. `it('submits a blank-description serviço with the catalog name as productName')`
   Same setup, then `Avançar` x3 and `Salvar proposta`.
   Asserts `onSave` was last called with `status: 'open'` and `items: [expect.objectContaining({ productId: servicoId, productName: 'Consultoria FXL', unitBrl: 400000, areaId })]`.
   Also asserts `payload.items[0].productName` is truthy and is not the product uuid - this is the guard that the snapshot is neither empty nor a raw id, and it is exactly the invariant `SaleItemSchema` at `service.ts:139` requires.

3. `it('keeps the typed description when a serviço row has one')`
   Type `Escopo mensal`, set the value, advance to review.
   Asserts review contains `Escopo mensal`, and the payload `productName` is `Escopo mensal` with `productId` still the serviço id.

4. `it('still blocks a serviço item with a zero negotiated value')`
   Leave both blank and click `Avançar`.
   Asserts the container still shows `Cliente e responsáveis`, contains `Informe um valor negociado maior que zero.`, and `textOccurrences('Informe o nome ou a descrição deste item personalizado.')` is `0`.
   This is the orthogonality guard from the truth table.

5. `it('keeps the description required for an open-price produto')`
   `changeSelect(labeledSelect('Produto / serviço do item 1'), customProdutoId)`, set the value to `4000`, click `Avançar`.
   Asserts the container still shows `Cliente e responsáveis` and `textOccurrences('Informe o nome ou a descrição deste item personalizado.')` is `1`.
   This is the anti-over-relaxation guard.

6. `it('keeps the description required for a free-form avulso item')`
   Fill item 1 (serviço, value only), click `+ item avulso`, click `Avançar`.
   Asserts `Informe a descrição deste item avulso.` is present and the container still shows `Cliente e responsáveis`.
   This is the concept-1 guard: the avulso name is the item's identity and stays required.

7. `it('labels the serviço description field as optional and names the fallback')`
   Asserts the container text contains `Nome / descrição do item (opcional)` and `Serviço com valor variável - sem descrição, o item aparece como "Consultoria FXL"` while blank, then after typing a description contains `Serviço com valor variável - descrição opcional`.
   Also asserts `labeledInput('Nome / descrição do item 1')` still resolves, pinning the unchanged `aria-label`.

### Existing assertions this change touches

- `apps/web/src/sales-ops/__tests__/sale-wizard-custom-item-labels.test.tsx:255-280` - `blocks advancement until every custom row has a label and positive negotiated value`.
  Must keep passing unchanged.
  Its fixture products are `openPrice: true` **Produtos**, so they must be tagged as produtos under the slice-07 discriminator, not serviços.
  If slice 07 made the catalog discriminator required on `SalesOpsProduct`, add `kind: 'produto'` to the `product()` factory at :34-65 - that is the only edit this file should need.
- `apps/web/src/sales-ops/__tests__/sale-wizard-custom-item-labels.test.tsx:282-299` - `saves an unlabeled custom draft with the catalog name fallback`.
  Unchanged, and it is the pre-existing proof that the `productName: product.name` fallback works; test 2 above lifts the same assertion from `draft` to `open`.
- `apps/web/src/sales-ops/__tests__/sale-wizard-custom-item-labels.test.tsx:301-323` - `uses the catalog name for a fixed-price item without rendering a custom label field`.
  Unchanged; still asserts the description field is absent for `openPrice: false`.
- `apps/web/src/sales-ops/__tests__/sale-wizard-free-items.test.tsx:238-251` - `blocks advance until the free row has description and value`.
  Unchanged; this is the load-bearing regression guard for itens avulsos.
- `apps/web/src/sales-ops/__tests__/sale-wizard-ui-contract.test.ts` - no assertion affected, see Copy changes.
- `apps/web/src/sales-ops/__tests__/calculations.test.ts` - no assertion affected; `buildSalePayload` is not changed.

### Oracle commands

```bash
pnpm --filter @fxl-sales/web test -- --run src/sales-ops/__tests__/sale-wizard-service-description.test.tsx
pnpm --filter @fxl-sales/web test -- --run src/sales-ops/__tests__/sale-wizard-custom-item-labels.test.tsx
pnpm --filter @fxl-sales/web test -- --run src/sales-ops/__tests__/sale-wizard-free-items.test.tsx
pnpm --filter @fxl-sales/web test -- --run src/sales-ops/__tests__/sale-wizard-ui-contract.test.ts
pnpm --filter @fxl-sales/api test
pnpm run lint
pnpm run type-check
```

The api command must pass with **zero source changes** under `apps/api/`.
If it does not, the client is emitting an empty `productName` and Green step 4 was skipped.

## Green

0. Confirm the slice-07 naming before touching anything.
   Read `nexo/plans/batch-01K9C0FXA7RQ8VZTN3KDM6WS4E/07-produtos-servicos-api.md` and `git log -p --stat -1` on the 07 merge to get the exact discriminator field name, its value literals, and whether it is optional on `SalesOpsProduct` (`apps/web/src/sales-ops/types.ts:31-55`).
   Every mention of `kind === 'servico'` below means "that discriminator", not necessarily that literal spelling.

1. Add one shared predicate to `apps/web/src/sales-ops/calculations.ts`, next to `resolveSaleCommissionDefaults`:
   ```ts
   export function isServiceProduct(product: SalesOpsProduct | undefined): boolean {
     return product?.kind === 'servico';
   }
   ```
   One seam, so the wizard never open-codes the discriminator and slice 12 can reuse it.
   Import it in `apps/web/src/sales-ops/SalesOpsApp.tsx` alongside `buildSalePayload` (:105).

2. Relax `itemsValid` at `apps/web/src/sales-ops/SalesOpsApp.tsx:3828-3836`.
   Split the fused condition so the value rule survives:
   ```ts
   const product = selectedProduct(item);
   const needsNegotiatedValue = Boolean(product?.openPrice) || isServiceProduct(product);
   const needsDescription = Boolean(product?.openPrice) && !isServiceProduct(product);
   const valueOk = !needsNegotiatedValue || parseCurrencyToCents(item.unitBrl) > 0;
   const descriptionOk = !needsDescription || Boolean(item.customLabel.trim());
   return valueOk && descriptionOk && Boolean(product?.areaId);
   ```
   Leave `draftValid` (:3839-3847) and `canSave` (:3783) untouched; neither requires a product-row description today.

3. Widen the description-field render gate at `apps/web/src/sales-ops/SalesOpsApp.tsx:4495` from `product?.openPrice ?` to `product?.openPrice || isServiceProduct(product) ?`, so a Serviço always gets the field even if slice 07 models variable value without setting `openPrice`.

4. Harden the fallback in `saleItemDisplayName` at `apps/web/src/sales-ops/SalesOpsApp.tsx:3936-3942`.
   Change line 3940 to `if (!product.openPrice && !isServiceProduct(product)) return product.name.trim() || 'Produto';` and line 3941 to `return item.customLabel.trim() || product.name.trim() || 'Produto';`.
   This closes the only path from a blank description to an API 400: `ProductSchema.name` (`apps/api/src/domains/sales-ops/service.ts:65`) is `.min(1)` without `.trim()`, so a whitespace-only catalog name would otherwise reach `buildSalePayload`'s `productName.trim()` (`apps/web/src/sales-ops/calculations.ts:183`) as `''` and be rejected by `SaleItemSchema` at `service.ts:139`.

5. Rework the per-row flags at `apps/web/src/sales-ops/SalesOpsApp.tsx:4426-4432`.
   Introduce `const isService = isServiceProduct(product);` and `const needsDescription = Boolean(product?.openPrice) && !isService;`, then:
   - `showCustomLabelError = needsDescription && showItemErrors && !customLabelValid`
   - `showCustomUnitError = (Boolean(product?.openPrice) || isService) && showItemErrors && !customUnitValid`
   `showAreaError` (:4433) is unchanged.

6. Apply the Copy changes inside the block at `apps/web/src/sales-ops/SalesOpsApp.tsx:4495-4535`.
   - Visible `<span>` at 4498-4500: `{isService ? 'Nome / descrição do item (opcional)' : 'Nome / descrição do item'}`.
   - `aria-label` at 4503: **do not touch.** It stays `` `Nome / descrição do item ${index + 1}` ``.
   - `placeholder` at 4513: `{isService ? 'Ex.: detalhe do escopo' : 'Ex.: Módulo Vendas'}`.
   - Error block at 4516-4526: unchanged in structure; the `showCustomLabelError` branch now simply never fires for a Serviço because of step 5.
   - Pristine hint at 4528-4531: branch on `isService`.
     Serviço + blank description renders `Serviço com valor variável - sem descrição, o item aparece como "{saleItemDisplayName(item)}"`.
     Serviço + filled description renders `Serviço com valor variável - descrição opcional`.
     Produto keeps `Sistema personalizado - informe um nome/descrição e o valor negociado` verbatim.

7. Do **not** touch `apps/api/src/domains/sales-ops/service.ts`.
   `productName: z.string().trim().min(1).max(140)` at :139 stays as-is by design; see the Finding in Current state.

8. Run every Oracle command in Red, in order.
   Then run the full `pnpm test` and `pnpm run build` before handing to Verify.

## Refactor

- After step 1, grep `apps/web/src` for any other open-coded read of the slice-07 discriminator and route it through `isServiceProduct`.
  Slices 10 and 12 will want the same predicate; leaving a second inline comparison behind is how the two drift apart.
- The `isService` / `needsDescription` pair is computed in two places after this slice (`itemsValid` at :3828 and the row render at :4426).
  If a third caller appears, lift it into a single `productRowRequirements(product)` helper returning `{ needsDescription, needsNegotiatedValue }` and consume it from both.
  Do not do this pre-emptively inside this slice - two call sites is not yet duplication worth a new abstraction.

## Out of scope

- Any change to `apps/api/src/domains/sales-ops/service.ts`, the `sale_items` schema, or any migration.
- Any change to `buildSalePayload`, `deriveWizardPrefill`, or the `"N/M"` / `"MN/M"` receivable label conventions.
- Itens avulsos: the `Descrição do item` field, its copy, and its required rule are frozen by this slice.
- Open-price Produtos: the existing required-description rule and all four of its strings are frozen.
- The Itens section layout and the `Cadastrar produto` button - that is slice 04.
- The payment-plan builder - slice 11.
- Per-proposta override of catalog defaults - slice 12.
- Replacing `NativeSelect` in the item rows with the Combobox primitive - slice 06.
- Any i18n extraction; pt-BR strings stay inline where they already live.

## Risks

1. **Slice 07 has not been planned yet, so the discriminator name is a guess.**
   At the time of writing, `nexo/plans/batch-01K9C0FXA7RQ8VZTN3KDM6WS4E/` contains only `00-OVERVIEW.md`, and `apps/web/src/sales-ops/types.ts:31-55` has no `kind` field - only `type: string` and `openPrice: boolean`.
   This plan therefore assumes `kind: 'produto' | 'servico'`.
   Mitigation: Green step 0 is a mandatory read of the 07 output, and the discriminator is read in exactly **one** expression (`isServiceProduct` in `calculations.ts`).
   If 07 chose `type: 'servico'` or a boolean `isService`, the only edit is that one function body.

2. **Over-relaxation regressing open-price Produtos.**
   The current rule fuses description and value into one boolean at :3833-3834, so an incautious edit drops both for every open-price row.
   Mitigation: Green step 2 splits the boolean explicitly, and Red tests 4 and 5 fail loudly if either half leaks - test 5 asserts the produto error still renders exactly once, test 4 asserts the value error still fires for a serviço.

3. **Silently regressing itens avulsos.**
   Free rows share the `customLabel` field with product rows, so a change written against "the description field" instead of "the product-row description rule" would hit both.
   Mitigation: every change in Green lives inside the `kind === 'product'` branch, the free branch of `itemsValid` (:3829-3830) and `draftValid` (:3843-3846) are named as untouched, and Red test 6 plus the existing `sale-wizard-free-items.test.tsx:238-251` both guard it.

4. **A client-only relaxation producing a 400 from `POST /sales`.**
   Mitigation: established by reading, not assumed - `saleItemDisplayName` already substitutes `product.name`, and `ProductSchema.name` is `.min(1)`, so the wire payload is never empty.
   The one residual hole (a whitespace-only catalog name) is closed by Green step 4, and the Oracle requires `pnpm --filter @fxl-sales/api test` to pass with no `apps/api/` diff.

5. **An empty or id-shaped label leaking into the sale detail dialog or the dashboard.**
   All four consumers read the single `productNameSnapshot` field (`SalesOpsApp.tsx:1649`, `:282`, `:5027`, `calculations.ts:213`).
   Mitigation: Green step 4 makes the fallback chain terminate in a literal, and Red test 2 asserts the emitted `productName` is truthy and is not the product uuid.

6. **A copy change breaking the source-text contract test.**
   `sale-wizard-ui-contract.test.ts` `readFileSync`s `SalesOpsApp.tsx` and asserts literal substrings.
   Mitigation: its assertions were enumerated (lines 10-37) and none covers the strings this slice touches; Case A is kept verbatim precisely so no positive assertion can regress, and no new string collides with the negative assertions at :32-37.
   The file is in the Oracle list so a surprise is caught immediately.

7. **Breaking the existing test queries by renaming the visible label.**
   `sale-wizard-custom-item-labels.test.tsx` queries `input[aria-label="Nome / descrição do item N"]` in eight places (:217-336).
   Mitigation: the `aria-label` at :4503 is explicitly frozen; only the visible `<span>` text gains the `(opcional)` suffix, and Red test 7 pins that the `aria-label` still resolves.

8. **Slice 07 making the discriminator a required field on `SalesOpsProduct`, breaking every existing product fixture.**
   Mitigation: that fallout belongs to slice 07 and should already be repaired when 08 starts.
   If `pnpm run type-check` still fails on `sale-wizard-custom-item-labels.test.tsx:34-65` or `sale-wizard-free-items.test.tsx`, add `kind: 'produto'` to the fixture factories and nothing else - tagging those fixtures as serviços would silently invert the very guards in Red.
