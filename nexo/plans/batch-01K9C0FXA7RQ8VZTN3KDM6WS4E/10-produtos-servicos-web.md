---
id: 10-produtos-servicos-web
milestone: v2.3.0
status: todo
depends_on: [06-combobox-adoption, 07-produtos-servicos-api]
files_modified:
  - apps/web/src/sales-ops/navigation.ts
  - apps/web/src/sales-ops/types.ts
  - apps/web/src/sales-ops/api.ts
  - apps/web/src/sales-ops/hooks.ts
  - apps/web/src/sales-ops/SalesOpsApp.tsx
  - apps/web/src/sales-ops/__tests__/produtos-servicos-view.test.tsx
  - apps/web/src/sales-ops/__tests__/product-service-dialog.test.tsx
  - apps/web/src/sales-ops/__tests__/product-commission-editor.test.tsx
  - apps/web/src/sales-ops/__tests__/areas-view.test.tsx
  - apps/web/src/sales-ops/__tests__/routing.test.tsx
  - apps/web/src/sales-ops/__tests__/calculations.test.ts
  - apps/web/src/sales-ops/__tests__/sales-view.test.tsx
  - apps/web/src/sales-ops/__tests__/sales-transition-actions.test.tsx
  - apps/web/src/sales-ops/__tests__/sale-wizard-commission-defaults.test.tsx
  - apps/web/src/sales-ops/__tests__/sale-wizard-custom-item-labels.test.tsx
  - apps/web/src/sales-ops/__tests__/sale-wizard-free-items.test.tsx
  - apps/web/src/sales-ops/__tests__/sale-wizard-payment-plan.test.tsx
acceptance: "given an admin on /cadastros/produtos, when they switch the Produto | Serviço segmented filter to Serviço and open Novo serviço, then the screen title reads Produtos & Serviços, the list shows the serviço column set (Valor = Variável, Plano padrão, Custos padrão) instead of Setup/Mensalidade/Recorrente, and the dialog has no Preço em aberto switch, replaces every own-value money input with the Definido na venda notice, and exposes a default payment plan template (Tipo de entrada nenhuma|%|R$ fixo + Parcelas restantes + Forma de pagamento padrão + Número de ciclos where blank means prazo indeterminado) plus a Custos padrão por função editor whose rows submit {funcaoId, mode: 'pct'|'fix', valuePct percent or valueBrl cents}, all through one SaveProductPayload that sends kind, omits openPrice, and no longer carries providers"
---

# Produtos & Serviços: one adaptive Cadastros screen with real defaults

## Goal

Turn `cadastros/produtos` into the single "Produtos & Serviços" screen the human asked for: a `Produto | Serviço` segmented filter over one list whose columns adapt to the kind, and one dialog that adapts to the kind so that a Serviço declares "valor variável, definido na proposta" instead of its own price while gaining the two configuration surfaces a Serviço actually needs, namely default costs per função and a default payment plan template.
This slice is the web half of the contract slice 07 already shipped: it starts sending `kind`, retires the `Preço em aberto` switch that `kind` now subsumes, wires `productFuncaoCosts` through the bootstrap and the write payload, and removes the `providers` editor that slice 07 deprecated.
It is also where "improve by a lot the config inside product/service" lands: default commissions get an explicit "these are only defaults" framing, and the default payment plan becomes a real template control built from slice 11's exact labels and geometry so the cadastro default and the wizard builder read as one control.
Everything configured here is a suggestion: the copy states it once at the top of the dialog, and slice 12 makes the proposta honour and override it.

## Current state

### Verified in the repo

Anchors read at plan time, not assumed.

- `apps/web/src/sales-ops/SalesOpsApp.tsx` is 5207 lines.
  - `emptyBootstrap` :122-133, whose `saleProfessionals: []` line is :131.
  - `formatProductCommission(type, value)` :1978-1990 renders `pct` as `10%` and `fix` as `R$ 1.000,00` through `Intl.NumberFormat('pt-BR')`. Its `fix` branch treats the value as **reais**, matching the `numeric(10,2)` commission columns.
  - `ProductsView` :1991-2079, exported, props `{ areas, products, onEdit }`.
    Its early `return` for the empty case is :2000-2007, title `Nenhum produto cadastrado`, text `Cadastre produtos reais para habilitar a criação de vendas e códigos automáticos.`
    Table headers :2014-2022 are `Nome | Área | Cód. | Setup | Mensalidade | Somente vendedor | Vendedor + Finder | Recorrente | Ações` (9 columns).
    The `Setup` cell :2038 and `Mensalidade` cell :2040-2045 print `Aberto` when `product.openPrice`.
  - `type ProductForm` :2403-2420, `productForm(product?)` :2422-2453.
  - `ReferenceToggle` :2455-2496, `CommissionModeButton` :2498-2518, `UnitToggle` :2520-2543, `UnitInput` :2545-2573, `DefinedOnSaleNotice` :2575-2581.
  - `ProductDialog` :2583-2603, a thin wrapper remounting `ProductDialogBody` via `key={props.modal.product?.id ?? 'new-product'}`; props include `collaborators: SalesOpsPerson[]`.
  - `ProductDialogBody` :2605-3112, `DialogContent` `max-w-[560px]` at :2677. Section order today: `Nome` :2703, code-suffix strip :2713-2736, `Preço em aberto` `ReferenceToggle` :2738-2745, the `Área` + `Setup (R$)` grid :2747-2780 (`Área` is a `NativeSelect`, `aria-label="Área do produto"`, :2750-2764), the `Possui mensalidade` card :2782-2833 with `Valor da mensalidade (R$)` :2800 and `Incide sobre recorrente` :2812-2830, the `Comissionamento` block :2835-2937, the `Módulos` `ListEditor` :2939-3005, the `Prestadores de serviço` `ListEditor` :3007-3084, `<datalist id="sales-ops-collaborators">` :3085-3089, footer :3092-3107.
  - `submit()` :2636-2672 forces `setupBrl` to 0 at :2645 and `monthlyBrl` to 0 at :2647 when `form.openPrice`, and always sends `modules` and `providers`.
  - `ListEditor` :3114-3159 is the only repeating-row shell: uppercase 11px `#9b9ba3` title, optional 11.5px `#b0b0b8` subtitle, an `Adicionar` button, a dashed empty box.
  - `ModalState` :161-166; the `person` variant already carries a hint field (`roleHint`) at :165, the precedent for a product-kind hint.
  - `titleForView` :172-215, `produtos` entry :197-200 (`Produtos` / `Catálogo, valores, códigos e regras de comissão`).
  - `runHeaderAction` :596-618 opens `{ kind: 'product' }` at :597-600; `headerAction` :620-635 yields `'Novo produto'` at :624.
  - `ProductsView` is rendered at :1066-1072, `ProductDialog` at :1099-1108 with `collaborators={bootstrap.people.filter((person) => person.isCollaborator)}` at :1101.
  - Style constants `panelClass` :135, `mutedPanelClass` :136, `tableHeadClass` :137, `tableCellClass` :139, `iconButtonClass` :140, `formInputClass` :142, `formSelectClass` :144.
  - Money helpers `parseCurrencyToCents` :260, `centsToInput` :264, `parseDecimal` :269, `pctToInput` :276 (which accepts a `string | number | undefined`, so it reads a drizzle `numeric` string directly). `formatMoneyBrl` is `apps/web/src/sales-ops/calculations.ts:112-125`.
  - `methodLabels` (`PIX`, `Cartão`, `Boleto`, `Transferência`) exists at :1597-1602 but is local to the sale-detail component.
  - The eleven wizard call sites that read `product.openPrice` (:3585, :3729, :3833-3835, :3940, :3953, :3972, :4430-4432, :4495) are **not** touched by this slice; slice 07 kept the column as a server-derived projection precisely so they keep working.
- `apps/web/src/sales-ops/navigation.ts:58-65` hardcodes the `cadastros` array; `{ id: 'produtos', label: 'Produtos', icon: Database }` is :59.
- `apps/web/src/sales-ops/api.ts:22-36` builds `SaveProductPayload` from `Partial<SalesOpsProduct>` and **already** `Omit`s the three commission value fields to re-declare them as `number`, because the read type serializes `numeric` as a string. That is the exact idiom this slice reuses for `defaultEntradaPct`.
- `apps/web/src/sales-ops/hooks.ts:28-40` is an explicit allow-list `select` that silently drops unknown bootstrap keys; `saleProfessionals` is :37, `settings` is :38.
- Eleven `SalesOpsBootstrap` object literals exist and must all gain any new required key. Verified by grepping `saleProfessionals: []`:
  `SalesOpsApp.tsx:131` (`emptyBootstrap`), `__tests__/calculations.test.ts:89` and `:122`, `__tests__/sales-transition-actions.test.tsx:163`, `__tests__/sales-view.test.tsx:193`, `__tests__/sale-wizard-custom-item-labels.test.tsx:110`, `__tests__/sale-wizard-payment-plan.test.tsx:112`, `__tests__/areas-view.test.tsx:78`, `__tests__/sale-wizard-free-items.test.tsx:112`, `__tests__/sale-wizard-commission-defaults.test.tsx:121`, `__tests__/routing.test.tsx:68`.
- `apps/web/src/components/ui/tabs.tsx` is unmodified shadcn (`h-10 rounded-md bg-muted text-muted-foreground`, `data-[state=active]:bg-background`).
- Test harness: `apps/web/vitest.config.ts` sets `environment: 'node'`; component tests opt in with `// @vitest-environment happy-dom` on line 1, render through `createRoot`, reach `act` via a cast, and `vi.mock('@/components/ui/dialog')` into plain divs. Models are `__tests__/product-commission-editor.test.tsx` (289 lines) and `__tests__/areas-view.test.tsx` (285 lines). No `@testing-library/*` is installed.

### Consumed from slice 07, which is authoritative for every name below

`07-produtos-servicos-api.md` is written and settles the contract. This slice does not invent any shape.

- **Decision 1 (`07:76-95`)**: `type` is **renamed** to `kind`, closed domain `'product' | 'service'` with a DB CHECK. Storage values stay English to match every other enum; the pt-BR labels `Produto` / `Serviço` live in the web layer, exactly as `draft|open|won` maps to Rascunho/Aberta/Ganha.
- **Decision 2 (`07:97-108`)**: `openPrice` survives only as a **server-written projection** of `kind`, with `sales_ops_products_kind_open_price_check` making drift impossible, and it stays accepted on the wire as a deprecated alias. `07:107` assigns this slice the job: "Slice 10 replaces the 'Preço aberto' switch with the `Produto | Serviço` toggle and starts sending `kind`."
- **Decision 3 (`07:196-259`)**: função costs are a real child table `sales_ops_product_funcao_costs` with `mode text` (`'pct' | 'fix'`), `value_pct numeric(5,2)` and `value_brl integer` (**cents**) as separate typed columns, a CHECK that exactly one is set, and a composite `(org_id, funcao_id)` FK. Cost rows are a **full-replace set inside the product write**; there is no cost endpoint and no DELETE verb.
- **Decision 4 (`07:261-274`)**: `providers` is deprecated here and **contracted later**. Stage 2 is this slice: "**Slice 10:** replace the providers editor with the função cost editor and stop sending `providers`." And: "**There is no backfill from `providers` to `productFuncaoCosts`, and there cannot be one**", because a provider row keys on free-text `personName` while a cost row keys on `funcaoId`, and fuzzy-matching would "silently attach wrong money to wrong roles". `07:274` states the intended complement: "The existing `providers` values stay readable in the deprecated column so slice 10 can surface them read-only while the operator re-enters them as função costs."
- **Flat default columns, not a nested object (`07:151-159`, `07:378-383`)**. `SalesOpsProduct` gains six read-only fields: `defaultPaymentMethod: PaymentMethod`, `defaultEntradaMode: 'none' | 'pct' | 'fix'`, `defaultEntradaPct: string | null` (numeric serialized by drizzle as a **string**), `defaultEntradaBrl: number | null` (**cents**), `defaultRemainingInstallments: number`, `defaultRecurringCycles: number | null` where **null means indefinite**.
  There is no "plan disabled" state: `defaultEntradaMode: 'none'` plus `defaultRemainingInstallments: 1` **is** the app default and reproduces today's single cash parcela (`07:489`, `07:607`).
- **The entrada mode literal is `'fix'`, not `'fixed'`** (`07:286`). One vocabulary across the whole batch, shared with `CommissionType` and with the cost row `mode`.
- **No `default_recurring_monthly_brl`** (`07:430`): "The recurring amount is deliberately not stored in the defaults block: it already lives in `monthlyBrl`, and `hasMonthly` already expresses 'this thing recurs'."
- **Write schema (`07:289-292`)**: `ProductFuncaoCostSchema` is a discriminated union on `mode`: `{ funcaoId, mode: 'pct', valuePct: pct }` or `{ funcaoId, mode: 'fix', valueBrl: money }` where `money` is integer cents.
- **Validation this dialog must not trip**: `service_cannot_have_fixed_value` (`07:340`) rejects a `'service'` carrying `setupBrl > 0` or `monthlyBrl > 0`; `kind_open_price_conflict` (`07:339`) rejects sending both `kind` and a contradicting `openPrice`; `duplicate_funcao_cost` (`07:342`) rejects two rows sharing a `funcaoId`; `unknown_funcao` (`07:517`) rejects a foreign `funcaoId`.
- **Responses (`07:398-399`, `07:506`, `07:536-541`)**: cost rows come back **flat** under `productFuncaoCosts`, never nested inside a product, on `GET /products`, `POST`, `PATCH` and `/bootstrap`.
- **Work slice 07 explicitly deferred to this slice**: adding `productFuncaoCosts` to the web `SalesOpsBootstrap` type, to the `hooks.ts:28` allow-list `select`, to `emptyBootstrap` and to the eleven bootstrap literals (`07:571`, `07:729`); and adding a `productFuncaoCosts` write field to `SaveProductPayload` (`07:569`, `07:730`).
- Slice 07 already renamed the seven web product fixtures' `type: 'SaaS'` to `kind: 'product'` (`07:572`, `07:715`) and updated `SalesOpsApp.tsx:4104`. Do not redo that.

### Consumed from the other dependency plans

**`03-combobox-primitive.md`** - inline and non-portalled with no new dependency, so a rendered Combobox lives inside the test `container` and needs **no `vi.mock`** (`03:82-90`, `03:403`).
API (`03:170-212`): `{ options: ComboboxOption[]; value: string | null; onChange; onCreate?; entityLabel?; entityGender?: 'm' | 'f'; id?; placeholder?; valueLabel?; searchPlaceholder?; emptyMessage?; disabled?; className?; panelClassName?; 'aria-label'? }` with `ComboboxOption = { value; label; description?; group? }`.
DOM contract (`03:253-262`): trigger is `button[role="combobox"]` carrying the passthrough `aria-label`; the panel search field carries `aria-label={searchPlaceholder}`; rows are `[role="option"]`.
Enter always calls `preventDefault` (`03:235`), so a Combobox inside this dialog's `<form>` cannot submit it by accident. Outside-close listens on `mousedown`, not `click` (`03:249`).
`className` merges through twMerge so a caller's `h-11 rounded-[10px]` wins over the base `h-10 rounded-md` (`03:50`).
Accent palette is the product amber `bg-[#fdf7e8] text-[#9c7210]` / active `bg-[#f4efe2]`, never `bg-primary`, because `--primary` is blue here (`03:61-67`).

**`06-combobox-adoption`** deletes `NativeSelect` entirely and standardises picker geometry on two canonical sizes. This slice therefore specs no `NativeSelect` anywhere and passes the canonical taller size so pickers line up with the `h-11` form controls.

**`05-pessoas-funcoes-api.md`** - `bootstrap.funcoes: FuncaoResponse[]` where `FuncaoResponse = { id, orgId, name, slug, isSystem, status, createdAt, updatedAt }` (`05:392-401`), ordered `isSystem DESC, name ASC` (`05:421`). `vendedor` and `finder` are the two immutable `isSystem: true` funções (`05:320-333`); `Prestador` is seeded as a **non-system** função for orgs that had collaborators (`05:335-346`); `isCollaborator` is redefined as "has at least one non-system função" (`05:253`).

**`11-payment-plan-builder.md`** - its builder is `Entrada [nenhuma | % | R$ fixo]` + value, `Restante [N] x`, `Recorrência [nenhuma | mensal]`, with aria-labels `Tipo de entrada`, `Valor da entrada`, `Parcelas restantes`, `Número de ciclos` (`11:69-86`).
It **deletes** the `Prazo indeterminado` checkbox and the `Adicionar recorrência` placeholder: "blank ciclos is the only expression of indefinite" (`11:86`), with the caption `Deixe em branco para prazo indeterminado` (`11:82`).
It adds negative source-text guards to `sale-wizard-ui-contract.test.ts` (`11:272-277`): `not.toContain('Dividir em')`, `not.toContain('+ parcela')`, `not.toContain('Adicionar recorrência')`, `not.toContain('Número de parcelas')`, `not.toContain('Remover parcela')`.
**Slice 10 runs before slice 11**, so none of those five substrings may enter `SalesOpsApp.tsx` here.
Slice 11 also extracts `PaymentPlanShape` and `generateInstallmentPlan` into `calculations.ts` and mirrors slice 07's `materializeDefaultPaymentPlan` vectors (`07:727`). This slice does **not** touch `calculations.ts`: the persisted defaults are already flat columns on `SalesOpsProduct`, so slice 11's `defaultPlanShapeForProduct` reads them directly and no shared web type is needed.

### Queue position

Wave 3 order is `08`, `09`, `10`, `11`. By the time this slice starts: slice 06 has converted the `Área` picker and left an interaction helper in the two existing product test files; slice 07 has landed `kind`, the six default columns, the cost child table, and the forced web type edits; slice 08 has added its serviço predicate; slice 09 has added `SalesOpsFuncao` and `bootstrap.funcoes`. Slice 11 has **not** run yet.

### Four different things are called `kind` or `mode`

Stated so nobody conflates them.
`ModalState.kind` is the modal discriminator (`'product' | 'client' | 'area' | 'person'`, :162-165).
`SaleItemForm.kind` is the item row kind (`'product' | 'free'`, :3495-3502, per `08:60`).
`SalesOpsProduct.kind` is the catalog discriminator this slice renders (`'product' | 'service'`).
`ProductFuncaoCost.mode` and `defaultEntradaMode` both use `'pct' | 'fix'`-family vocabulary but are unrelated fields.
The product-kind hint on `ModalState` is therefore named `productKind`, never `kind`. Note that the literal `'product'` now means "the product modal" in `ModalState.kind` and "a Produto, not a Serviço" in `SalesOpsProduct.kind`; the two live on different fields and never meet, and renaming the modal discriminator is out of scope.

## Screen design

### Route path: unchanged

`cadastros/produtos` stays.
`CLAUDE.md` binds the canonical route list to `cadastros/produtos|areas|clientes|vendedores|finders|geral`, and the batch's scope limits forbid touching routing beyond what a slice needs.
The `SalesOpsView` union member doubles as the URL segment, so renaming it would churn `navigation.ts`, `titleForView`, `resolveSalesOpsRoute`, the "first item of `cadastros`" default-route contract, `navigation.test.ts:44-60` and four `routing.test.tsx` assertions, and would need a legacy redirect for existing bookmarks.
The operator reads the label, not the path, and the label is what this slice changes.
No old URLs to handle because no URL changes.

### The kind toggle: a segmented filter, not `components/ui/tabs.tsx`

Decision: a controlled segmented pill group reusing the recipe already on screen at :2839-2852 (`#f2f2f4` track, `rounded-[11px]`, `p-1`, `#201f24` active fill, white active text).

Why not Radix `Tabs`:

1. `tabs.tsx` is unmodified shadcn resolving against the shadcn theme tokens, not the hand-tuned Sales Ops palette. Dropping it here puts two differently shaped segmented controls in the same flow (this filter and the dialog's `Somente vendedor | Vendedor + Finder` pills), which reads as two design systems. The same palette argument slice 03 made for the create row applies (`03:61-67`).
2. Radix `Tabs` mounts one `TabsContent` per value. Here there is one table; what varies is its **column set** and the header-action label, both outside any panel. Panels would be an empty abstraction.
3. Each option carries a live count badge, which `TabsTrigger` has no slot for.
4. Radix roving tabindex and pointer-capture semantics are painful to drive from hand-rolled `dispatchEvent` with no `@testing-library/user-event` in the repo. The existing pills are plain `<button>` and the existing helpers already click them.

Implementation: generalize `CommissionModeButton` (:2498) into `SegmentedButton` with the same classes plus optional `count?: number`, `ariaLabel?: string`, and `aria-pressed={active}`, then update its two existing call sites (:2840, :2846) so exactly one segmented recipe exists in the file. Visible text is unchanged, so `button('Somente vendedor')` and `button('Vendedor + Finder')` keep resolving.

Exactly two options, `Produtos` and `Serviços`, no `Todos`. The locked decision says `Produto | Serviço`; a third bucket reintroduces the mixed-column problem the split removes.

State lives in `SalesOpsApp` (`const [productKind, setProductKind] = useState<ProductKind>('product')`), not in the URL. The URL stays the single source of truth for **workspace and page**, which this is not; the precedent is `SalesFilters` at :170, already component state for the propostas list. The parent must own it because `headerAction` and `runHeaderAction` both read it.

### One filtered list, not two sections

The toggle filters a single table. Two stacked sections would need two headers, two column sets, two empty states and double the scroll on one screen, and would make the header action ambiguous. With exactly one kind active, `Novo produto` / `Novo serviço` is unambiguous and the table never mixes semantics.

The segmented group sits in a slim bar above the table inside the same `panelClass` card (`border-b border-[#e8e8ec] px-4 py-3`) so filter and rows read as one object. Counts come from the unfiltered `products` array so the operator always sees how many of the other kind exist.

Kind is read through the serviço predicate slice 08 left in `calculations.ts`, or a local `productKind(product)` returning `product.kind ?? 'product'` if none exists. A record from an API older than slice 07 reads as a Produto, which is the safe default.

### List columns

Nine columns in both sets, so toggling does not reflow the table rhythm.

Produto (unchanged from today, preserving both existing table oracles):

| Nome | Área | Cód. | Setup | Mensalidade | Somente vendedor | Vendedor + Finder | Recorrente | Ações |

Serviço:

| Nome | Área | Cód. | Valor | Plano padrão | Custos padrão | Somente vendedor | Vendedor + Finder | Ações |

- `Valor` renders the muted text `Variável` in `text-[#9b9ba3]`, never a money figure. A Serviço has no own value by definition and slice 07 enforces it at the DB level (`sales_ops_products_service_no_fixed_value_check`), so `R$ 0,00` would be a lie and `Aberto` would leak the deprecated `openPrice` flag name.
- `Plano padrão` renders `defaultPlanSummary(product)` from the six flat columns: `50% + 3x`, `R$ 5.000,00 + 2x`, `1x`, each optionally suffixed ` + mensal`. Money goes through `formatMoneyBrl` and the percent through `pctToInput`, which reads the drizzle `numeric` string directly.
  **There is no `-` state**: every product carries a plan, because `'none'` + `1` is the column default and means "à vista em 1x" (`07:489`).
- `Custos padrão` renders `1 função` / `3 funções` / `-`, with a `title` on the cell listing `Nome da função · 5%` or `Nome da função · R$ 300,00` pairs.
  Cost rows are **not** nested on the product (`07:398`), so `ProductsView` takes a new `funcaoCosts: SalesOpsProductFuncaoCost[]` prop carrying every org row and filters by `productId`.
- `Setup`, `Mensalidade` and `Recorrente` are dropped for Serviço: the first two are structurally zero, and recurrence is conveyed by `Plano padrão`'s ` + mensal` suffix.

Empty states, kind-aware, replacing the single stale string at :2002-2005 (which still says "vendas" after the Propostas rename):

- Produto: title `Nenhum produto cadastrado`, text `Cadastre produtos com valor próprio para habilitar a criação de propostas e códigos automáticos.`
- Serviço: title `Nenhum serviço cadastrado`, text `Cadastre serviços de valor variável para reaproveitar custos por função e padrões de proposta.`

The empty state renders **below** the segmented bar, not instead of the whole card, so the operator can still switch kinds from an empty bucket. This is a real behavioural fix over today's early `return` at :2000.

### Screen chrome

- `navigation.ts:59` label becomes `Produtos & Serviços`. The id stays `produtos`, so `navigation.test.ts:53-60` (which asserts ids) is untouched.
- `titleForView` `produtos` becomes `{ title: 'Produtos & Serviços', subtitle: 'Catálogo, valores, custos por função e padrões de proposta' }`.
- `headerAction` :623-624 becomes `productKind === 'service' ? 'Novo serviço' : 'Novo produto'`.
- `runHeaderAction` :597-600 becomes `setModal({ kind: 'product', productKind })`.
- `ModalState`'s product variant becomes `{ kind: 'product'; product?: SalesOpsProduct; productKind?: ProductKind }`, mirroring the `roleHint` precedent at :165.

## Dialog design

### Shell

- Width `max-w-[560px]` becomes `max-w-[640px]`. The two-column grids and the plan row are cramped at 560; the sale wizard is 940 (:4135) and the sale detail 760 (:1617), so 640 stays clearly subordinate.
- Title from `form.kind`: `Novo produto` / `Editar produto` / `Novo serviço` / `Editar serviço`.
- Description from `form.kind`: produto keeps `Catálogo, valores e comissões padrão`; serviço gets `Valor variável, custos por função e padrões de proposta`.
- Footer unchanged (`Cancelar` / `Adicionar` / `Salvar alterações`, submit disabled while `saving || !form.areaId`).

### Sections, not inner tabs

One scrolling column with consistent section headers.
Inner tabs are rejected: the dialog is already opened from a screen-level segmented control, so a second tab layer is one level too many, and tabs would hide the two `required` fields (`Nome`, `Área`) behind a tab, which breaks native form validation and makes a failed submit point at nothing visible.

The "wall of fields" risk is handled three ways instead.

1. Exactly one section-header recipe. Extract `ListEditor`'s header markup (:3131-3147) into `DialogSection({ title, subtitle, action, children })` and let `ListEditor` render through it, so `Comissionamento padrão`, `Plano de pagamento padrão`, `Custos padrão por função` and `Módulos` are typographically identical: `border-t border-[#ececf1] pt-4`, 11px bold uppercase `tracking-[0.06em]` `#9b9ba3` title, 11.5px `#b0b0b8` subtitle.
2. Net field count barely moves. This slice **removes** the `Preço em aberto` toggle and the whole `Prestadores de serviço` editor (two controls per row plus an add button), and adds four plan fields plus a cost editor. For a Serviço it also removes two money inputs in favour of two one-line notices.
3. Consistent control heights: `formInputClass` is `h-11`, `DefinedOnSaleNotice` is `h-11`, `UnitInput` wraps an `h-11` `Input`, and every Combobox gets slice 06's canonical taller size. Every money and numeric input carries `sales-ops-num`.

### Section order

**0. Kind selector (both).**
A `SegmentedButton` pair `Produto | Serviço` at the top of the scroll body, above `Nome`, aria-labels `Classificar como produto` / `Classificar como serviço`, bound to `form.kind` (`'product'` / `'service'`).
Editable on an existing record so a mis-created row can be reclassified. Reclassifying a Produto to Serviço zeroes its own value on submit, which is exactly what slice 07's CHECK requires, and sale items already snapshot their own name and área so history is unaffected.
Below it, one amber note in the wizard's :4808 style (`border-[#f0dfae] bg-[#fdf0cf] px-[14px] py-[11px] text-[13px] text-[#57575f]`):
`Tudo aqui é padrão: dentro da proposta você pode alterar qualquer valor sem mexer no cadastro.`
That single sentence is item 8 made explicit, stated once rather than repeated per section.

**1. `Nome` (both).** Unchanged, `required`, `placeholder="Nome"`.

**2. Code-suffix strip (both).** Unchanged (:2713-2736).

**3. `Preço em aberto` toggle: DELETED (:2738-2745).**
`openPrice` is now a server-written projection of `kind`, enforced by `sales_ops_products_kind_open_price_check` (`07:104`), and sending both a `kind` and a contradicting `openPrice` is a `kind_open_price_conflict` validation error (`07:339`). Two controls for one fact is exactly what slice 07 removed from the schema, and slice 07 assigned the UI half here (`07:107`).
For a Serviço, one static line in the same amber style replaces it: `Serviços têm valor variável, definido em cada proposta.`
`submit()` sends `kind` and **never** `openPrice`.
`ProductForm.openPrice` is deleted; every former `form.openPrice` read becomes `form.kind === 'service'`.

**4. `Área` + own value grid (both, `md:grid-cols-2`).**
- `Área`, required, the slice 06 Combobox, `aria-label="Área do produto"` preserved, `searchPlaceholder="Buscar área..."`, `entityLabel="área"`, `entityGender="f"`. Options are `selectableAreas` from :2628-2634, which already keeps an archived-but-current área selectable. `onCreate` is whatever slice 06 wired; this slice neither adds nor removes it.
- `Setup (R$)`: produto renders the numeric input; serviço renders `DefinedOnSaleNotice`.

**5. `Possui mensalidade` card (both).**
The toggle stays for both kinds: it is the product-level recurrence default that the wizard already reads (:3795-3807), and a retainer serviço needs it. Slice 07 is explicit that `hasMonthly` already expresses "this thing recurs" and that no second recurrence field exists (`07:430`).
When on:
- `Valor da mensalidade (R$)`: produto renders the numeric input; serviço renders `DefinedOnSaleNotice`.
- `Incide sobre recorrente` sub-toggle, unchanged.

**6. `Comissionamento padrão` (both).**
Functionally identical to today's block (:2835-2937), which carries five oracle assertions and must not regress. Two copy changes only:
- header `Comissionamento` becomes `Comissionamento padrão`;
- new subtitle `Sugestão aplicada ao criar a proposta`.
The `Somente vendedor | Vendedor + Finder` pills, the `Comissão do vendedor` / `Comissão do finder` labels, every `aria-label`, and the independent `seller_only` vs `with_finder` state machine are untouched.
No kind gating: a flat `R$` commission on a variable-value serviço is legitimate (a fixed fee per closed deal).

**7. `Plano de pagamento padrão` (both).** New. See below.

**8. `Custos padrão por função` (both).** New. See below.

**9. `Módulos`.**
Produto only. Fixed-value module rows contradict a variable-value serviço.
`submit()` still sends `form.modules` unchanged for both kinds, so switching an existing record to Serviço never destroys its module data.

**10. Legacy-providers notice.**
Rendered only when `modal.product?.providers?.length` is non-zero, as helper text inside the `Custos padrão por função` section, `text-[12px] text-[#8b8b92]`:
`Prestadores antigos deste cadastro não foram convertidos automaticamente: <nomes separados por vírgula>. Recadastre o custo por função acima.`
This is the deliberate complement to slice 07's refusal to backfill. Slice 07 rejected an automatic `providers` to `productFuncaoCosts` mapping because it "would silently attach wrong money to wrong roles" (`07:274`), and named exactly this affordance: "The existing `providers` values stay readable in the deprecated column so slice 10 can surface them read-only while the operator re-enters them as função costs."
It is read-only, it never writes, and it disappears when a later contract slice drops the column.

**11. Footer.** Unchanged.

Removed outright: the `Prestadores de serviço` `ListEditor` (:3007-3084) and `<datalist id="sales-ops-collaborators">` (:3085-3089). See below.

### 7. Default payment plan editor

There is no nested plan object and no enable switch. The editor edits six flat columns, and its default state (`'none'` + `1`) reproduces today's single cash parcela byte for byte (`07:489`, `07:607`).

Form state:

```ts
// inside ProductForm
defaultPaymentMethod: PaymentMethod;
defaultEntradaMode: 'none' | 'pct' | 'fix';
defaultEntradaValue: string;         // percent when 'pct', reais when 'fix', unused when 'none'
defaultRemainingInstallments: string;
defaultRecurringCycles: string;      // '' means prazo indeterminado
```

One form field carries both entrada units because the UI has one input whose unit follows the mode, and slice 07's `sales_ops_products_default_entrada_mode_check` forbids both columns being set at once. `submit()` fans it out into exactly one column.

Controls, in order, always visible:

1. `Tipo de entrada` - Combobox, `aria-label="Tipo de entrada"`, `w-[132px]`, `searchPlaceholder="Buscar tipo de entrada..."`, options `{ value: 'none', label: 'nenhuma' }`, `{ value: 'pct', label: '%' }`, `{ value: 'fix', label: 'R$ fixo' }`. Identical label, option labels and values to slice 11's control (`11:69-70`) and to slice 07's `ProductEntradaModeSchema` (`07:286`).
2. `Valor da entrada` - `UnitInput`, `aria-label="Valor da entrada"`, unit `%` or `R$`, `sales-ops-num text-right`. Unmounted when the mode is `none`, matching `11:71`.
3. `Restante` - a numeric text input, `aria-label="Parcelas restantes"`, `w-[72px] text-center`, followed by a static `x`, `min` 1 and `max` 120 to match slice 07's CHECK.
   **The label must be `Parcelas restantes`, not `Número de parcelas`**: slice 11 adds `not.toContain('Número de parcelas')` to the source-text contract test (`11:275`) and this slice runs first.
4. `Forma de pagamento padrão` - Combobox, `aria-label="Forma de pagamento padrão"`, `searchPlaceholder="Buscar forma de pagamento..."`, options `PIX`, `Cartão`, `Boleto`, `Transferência`. The label map at :1597-1602 is hoisted to a module-level `paymentMethodLabels` so those four pt-BR strings exist once.
5. `Número de ciclos` - rendered only when `form.hasMonthly`. A plain text input (no native number spinner), `aria-label="Número de ciclos"`, with the caption `Deixe em branco para prazo indeterminado`. Blank is the **only** expression of indefinite, exactly as slice 11 mandates (`11:82`, `11:86`) and as `defaultRecurringCycles: null` means in slice 07 (`07:157`, `07:383`).
   **No `Prazo indeterminado` checkbox.** Slice 11 deletes the wizard's copy, so adding one here would immediately be inconsistent and would leave this section as the last user of a control the batch is removing.
6. Live summary strip in the wizard's green `#cfe4cf`/`#e2efe2` style, rendering `defaultPlanSummary`, for example `Entrada de 50% + 3x do restante · PIX`, plus ` · mensal por prazo indeterminado` or ` · mensal por 12 ciclos` when `hasMonthly`.
   Deliberately **not** shared with slice 11's hints: slice 11's `R$ 36.500,00` and `3 x R$ 12.166,66 (última R$ 12.166,68)` are derived from a proposta total, and a cadastro has no total, so sharing one function would force a fake total. Consistency comes from identical labels, option sets, geometry, palette and the blank-ciclos rule.

Forbidden substrings this section must not contain, because slice 11 adds them as negative source-text guards and runs after this slice: `Dividir em`, `+ parcela`, `Número de parcelas`, `Remover parcela`, `Adicionar recorrência`.

### 8. Função cost defaults editor

Form state:

```ts
type FuncaoCostForm = { funcaoId: string; mode: 'pct' | 'fix'; value: string };
```

Submitted as slice 07's discriminated union (`07:289-292`), one branch per mode, so the units can never be ambiguous:

```ts
form.funcaoCosts
  .filter((row) => row.funcaoId)
  .map((row) =>
    row.mode === 'pct'
      ? { funcaoId: row.funcaoId, mode: 'pct' as const, valuePct: parseDecimal(row.value, 0) }
      : { funcaoId: row.funcaoId, mode: 'fix' as const, valueBrl: parseCurrencyToCents(row.value) },
  )
```

`valuePct` is a percent number; `valueBrl` is **integer cents** parsed by `parseCurrencyToCents` (:260). This is the point of slice 07's two typed columns (`07:251`): "the units bug (5.00 percent versus 30000 cents in the same field) is precisely the bug the convention exists to prevent."

Seeding reverses it: `mode: row.mode`, `value: row.mode === 'pct' ? pctToInput(row.valuePct, 0) : centsToInput(row.valueBrl ?? 0)`. `valuePct` arrives as a drizzle `numeric` **string** (`07:380`), which `pctToInput` already accepts.

Display uses a new `formatFuncaoCost(row)`: `${pctToInput(row.valuePct, 0)}%` for `'pct'` and `formatMoneyBrl(row.valueBrl ?? 0)` for `'fix'`.
`formatProductCommission` (:1978) is deliberately **not** reused here: its `fix` branch formats reais, while a cost row stores cents, and slice 07 flagged exactly this (`07:754`, "slice 10's editor must convert cents for display"). Reusing it would render `R$ 300,00` as `R$ 30.000,00`.

Rendered through `ListEditor` with `title="Custos padrão por função"`, `subtitle="Quanto cada função custa neste item por padrão"`, `addLabel="Adicionar"`.
Each row reuses the retired providers row shell verbatim (`rounded-xl border border-[#ececf1] bg-[#fafafb] p-[11px]`, control plus trash on line one, unit toggle plus `UnitInput` on line two), so `ListEditor` stays the only repeating-row pattern in the file.

Row one: a Combobox, `aria-label="Função do custo padrão ${index + 1}"`, `searchPlaceholder="Buscar função..."`, `entityLabel="função"`, `entityGender="f"`, plus the existing red trash button with `aria-label="Remover custo padrão ${index + 1}"`.
Row two: the `% | R$` `UnitToggle` pair (`aria-label="Custo da função ${index + 1} em porcentagem"` / `... em reais`) and a `UnitInput` with `aria-label="Custo da função ${index + 1}"`.

Indexed aria-labels rather than name-interpolated ones: the current providers editor interpolates `provider.personName` into its aria-label (:3052), which makes the label unstable while typing and untestable before a name exists. Index labels are stable from the moment the row is added.

**Option set: active, non-system funções only.**
`funcoes.filter((funcao) => funcao.status === 'active' && !funcao.isSystem)`.
`vendedor` and `finder` are the two `isSystem` funções (`05:320-333`) and their cost is already the commission block in section 6, so offering them here would create two competing ways to pay a vendedor. `isSystem` exists precisely to make that distinction (`05:163-164`).
An org that had collaborators already has the non-system `Prestador` função seeded (`05:335-346`), so the common case is non-empty on day one.

Duplicate guard: a função already chosen is filtered out of the other rows' options, and `Adicionar` is disabled once every eligible função is used, `title="Todas as funções já têm custo padrão"`. This keeps the client from ever tripping slice 07's `duplicate_funcao_cost` (`07:342`).

Empty case (no eligible funções): `ListEditor`'s `empty` prop renders
`Nenhuma função cadastrada ainda. Cadastre as funções em Cadastros > Funções para definir custos padrão.`
and `Adicionar` is disabled with the same string as its `title`.
The `Cadastros > X` phrasing matches the precedent already asserted at `__tests__/sale-wizard-free-items.test.tsx:262`.

No `onCreate` on this Combobox. Creating a função needs admin-gated `POST /funcoes` (`05:429`) plus a nested create flow inside a dialog that is already a form; slice 09 owns the funções cadastro. The empty-state message points there instead.

This section is not gated behind a toggle: it is the reason a Serviço exists, and its zero-row state is already a single dashed line. It renders for both kinds because a produto can also carry implementation cost.

Cost rows reach the dialog as a prop, not through the product, because slice 07 returns them flat (`07:398`): `ProductDialog` gains `funcaoCosts: SalesOpsProductFuncaoCost[]` holding only the rows for the product being edited, filtered by the parent.

### Fate of the `providers` datalist

Decision: delete the `Prestadores de serviço` editor and the `sales-ops-collaborators` datalist, and stop sending `providers`. `ProductDialog` drops `collaborators` and gains `funcoes` plus `funcaoCosts`.

This is not a judgement call this slice makes; it is the assignment. Slice 05 handed `providers` to slice 07 (`05:556`), and slice 07 staged it as expand-then-contract with this slice as stage 2: "**Slice 10:** replace the providers editor with the função cost editor and stop sending `providers`" (`07:271`). Slice 07 also flags the consequence of not doing it (`07:745`): "the operator will briefly see both editors in slice 10's dialog work unless slice 10 removes the providers section, which its plan must do."

Supporting reasons, weighed independently:

1. `providers[].personName` is free text with no foreign key, so it is already a shadow people table, and slice 07 named it "the anti-pattern being replaced here" (`07:252`). Keeping it beside first-class Pessoas and Funções is exactly the third overlapping people concept this slice is told not to leave behind.
2. Slice 05 folds the collaborator concept itself into funções: `isCollaborator` becomes "has at least one non-system função" (`05:253`), so the flag the providers picker was built on no longer exists as an independent thing.
3. A cadastro default should outlive any individual. Binding a concrete pessoa at cadastro level breaks the moment that person leaves; binding a função does not. The concrete pessoa is already chosen per proposta in the wizard's `Profissionais alocados` step (:4812), which stores a real `personId`.
4. Nothing downstream reads it: only `types.ts`, `productForm` (:2447), the dialog body, the submit payload (:2662), `ProductProviderSchema` and the column default.

**The data is not migrated, by design, and this slice does not migrate it either.** Slice 07 established there is no deterministic `personName` to `funcaoId` mapping (`07:274`, `07:490`). After this slice the values remain in the deprecated `providers` column, reachable only from the database and from the read-only notice in section 10, until a later contract slice drops the column. That is stated as a risk below.

Write safety: `submit()` **omits** `providers` from the payload rather than sending `[]`. `PATCH /products/:id` parses with `UpdateProductSchema` (`ProductFieldsSchema.partial()`, `07:330`), where an omitted key is left unchanged (`07:526`), so no existing row is destroyed by the first edit after this slice ships. `POST` gets the schema's `[]` default, correct for a new record.

## Test fallout

Every item below is broken by this slice and must be fixed in the same commit.

### Required-key churn from `SalesOpsBootstrap.productFuncaoCosts`

Slice 07 deferred this to here (`07:571`, `07:729`). The key is added as **required**, matching its ten siblings, because `hooks.ts:28-40` is the one place that guarantees the array exists and an optional key would push `?? []` into every consumer forever. Each site gains one line, `productFuncaoCosts: [],`:

1. `SalesOpsApp.tsx:131` area (`emptyBootstrap`).
2. `__tests__/calculations.test.ts:89`.
3. `__tests__/calculations.test.ts:122`.
4. `__tests__/sales-transition-actions.test.tsx:163`.
5. `__tests__/sales-view.test.tsx:193`.
6. `__tests__/sale-wizard-custom-item-labels.test.tsx:110`.
7. `__tests__/sale-wizard-payment-plan.test.tsx:112`.
8. `__tests__/areas-view.test.tsx:78`.
9. `__tests__/sale-wizard-free-items.test.tsx:112`.
10. `__tests__/sale-wizard-commission-defaults.test.tsx:121`.
11. `__tests__/routing.test.tsx:68`.

`pnpm run type-check` catches any miss. No assertion in any of those files changes.

### Component prop and copy changes

12. `__tests__/routing.test.tsx:257`
    `expectHeading('Produtos');` becomes `expectHeading('Produtos & Serviços');`
    (`:255` and `:440` assert only `pathname()` and stay as they are, because the route does not change.)

13. `__tests__/product-commission-editor.test.tsx:84-98`, helper `renderDialog`
    `collaborators={[]}` becomes `funcaoCosts={[]} funcoes={[]}`.

14. `__tests__/product-commission-editor.test.tsx:222-243`, the reopen render inside `'preserves fixed type and value controls across switching, save, and reopen'`
    Same prop swap.

15. `__tests__/product-commission-editor.test.tsx:258-288`, `'shows seller-only and seller-with-finder scenarios separately in the product table'`
    The `<ProductsView …>` render gains `funcaoCosts={[]}`, `kind="product"` and `onKindChange={vi.fn()}`.
    Its six text assertions (`Somente vendedor`, `Vendedor + Finder`, `10%`, `7% + 3%`, `R$ 1.000,00`, `R$ 700,00 + R$ 300,00`) all still hold: slice 07 already set those fixtures to `kind: 'product'` (`07:715`), which keeps the original column set.

16. `__tests__/product-commission-editor.test.tsx:146-150`, helper `chooseArea`
    Slice 06 has already converted `Área` to the Combobox and must have updated this helper. **Re-read it at Green time and reuse whatever interaction helper slice 06 left**; do not assume `<select>` and do not add a second helper. Slice 11 gives itself the same instruction (`11:296-297`, `11:420-423`).

17. `__tests__/areas-view.test.tsx:225-257`, `'requires an área before saving a product'`
    `collaborators={[]}` at `:233` becomes `funcaoCosts={[]} funcoes={[]}`.
    The área interaction at `:249-251` follows item 16.
    `:256` (`not.toHaveProperty('type')`) still holds, and gains a sibling assertion `not.toHaveProperty('providers')` and `not.toHaveProperty('openPrice')`.

18. `__tests__/areas-view.test.tsx:259-284`, `'shows the área name instead of the legacy type in the products table'`
    The `<ProductsView …>` render gains `funcaoCosts={[]}`, `kind="product"` and `onKindChange={vi.fn()}`.
    `toContain('Área')`, `toContain('FXL Tech')`, `not.toContain('Tipo')` and the `-` cell all still hold.

### No change needed, stated to close the question

19. `__tests__/sale-wizard-ui-contract.test.ts`
    No edit. None of its 24 substrings touch the product dialog, and this slice introduces none of its forbidden strings.
    Deliberately **not** extended: the new copy is asserted through DOM queries in the two new test files, a strictly stronger oracle than a source-text substring.
    **But it constrains this slice negatively**: slice 11 will add `not.toContain('Dividir em' | '+ parcela' | 'Número de parcelas' | 'Remover parcela' | 'Adicionar recorrência')` (`11:272-277`) and runs after this slice, so none of those five substrings may appear in the new dialog code. Pinned by dialog test 18.

20. `__tests__/navigation.test.ts:43-60` - no change; it asserts `cadastros` **ids**, and its label assertion at `:50-53` covers `operacional`, not `cadastros`.

21. `__tests__/sale-wizard-free-items.test.tsx:262` - no change beyond item 9. `'Defina a área deste produto em Cadastros > Produtos.'` stays accurate; the route is unchanged.

22. The eleven wizard `product.openPrice` readers (:3585, :3729, :3833-3835, :3940, :3953, :3972, :4430-4432, :4495) - no change. Slice 07 kept `openPrice` as a server-derived column exactly so this stays true (`07:101`, `07:566`).

## Red

Two new files, following the `product-commission-editor.test.tsx` idiom exactly: `// @vitest-environment happy-dom` on line 1, `createRoot`, `React.act` through a cast, `vi.mock('@/components/ui/dialog')` into plain divs, hand-rolled `click` / `change` / `submit` helpers, DOM queried by `aria-label`.

**No Combobox mock.** Per `03:82-90` and `03:403` the primitive is inline and non-portalled, so it renders into `container` and every query is a plain `container.querySelector`. `vi.mock('@/components/ui/dialog')` stays, because the Radix dialog does portal.

Combobox interaction helper. At Green time, first re-read `product-commission-editor.test.tsx` and `areas-view.test.tsx` for the helper slice 06 left and reuse it. Only if slice 06 left none, add one local helper per new file:

```ts
async function chooseCombobox(ariaLabel: string, optionLabel: string) {
  const trigger = container.querySelector(`button[role="combobox"][aria-label="${ariaLabel}"]`);
  if (!(trigger instanceof HTMLButtonElement)) throw new Error(`combobox not found: ${ariaLabel}`);
  await click(trigger);
  const option = [...container.querySelectorAll('[role="option"]')].find(
    (candidate) => candidate.textContent?.trim() === optionLabel,
  );
  if (!(option instanceof HTMLElement)) throw new Error(`option not found: ${optionLabel}`);
  await click(option);
}

function comboboxValue(ariaLabel: string): string {
  const trigger = container.querySelector(`button[role="combobox"][aria-label="${ariaLabel}"]`);
  if (!(trigger instanceof HTMLButtonElement)) throw new Error(`combobox not found: ${ariaLabel}`);
  return trigger.textContent?.trim() ?? '';
}
```

The existing `click` helper dispatches only `MouseEvent('click')`, never `mousedown`, so it cannot trip the Combobox's outside-close listener (`03:249`).

Fixtures. A local `product(patch)` factory copied from `product-commission-editor.test.tsx:40-65` (already carrying `kind: 'product'` after slice 07) and extended with the six default columns. A `funcao(patch)` factory in slice 05's shape: `{ id, orgId: 'org-test', name, slug, isSystem: false, status: 'active', createdAt, updatedAt: null }`. A `funcaoCost(patch)` factory in slice 07's read shape: `{ id, orgId: 'org-test', productId, funcaoId, mode: 'pct', valuePct: '5.00', valueBrl: null, createdAt, updatedAt: null }`.
Verify at Green time whether slice 07 made the six default fields required or optional on `SalesOpsProduct`; if required, the shared fixtures already carry them, and the new factories must too.

### File 1: `apps/web/src/sales-ops/__tests__/produtos-servicos-view.test.tsx`

`describe('produtos e serviços view')`

1. `it('defaults to the produtos segment and shows the produto column set')`
   One produto and one serviço, `kind="product"`. Headers contain `Setup`, `Mensalidade`, `Recorrente` and not `Plano padrão` or `Custos padrão`; only the produto row name is present.
2. `it('switching to the serviços segment reports the kind change to the parent')`
   Clicks `button[aria-label="Filtrar por serviços"]`; asserts `onKindChange` called with `'service'`.
3. `it('renders the serviço column set with variável value, plano padrão and custos padrão')`
   `kind="service"`. Headers contain `Valor`, `Plano padrão`, `Custos padrão` and not `Setup`, `Mensalidade`, `Recorrente`; the row text contains `Variável`, `50% + 3x` and `2 funções`.
4. `it('counts custos padrão from the flat productFuncaoCosts prop, scoped per product')`
   Two serviços and three cost rows, two belonging to serviço A and one to serviço B: the rows read `2 funções` and `1 função`, and a serviço with no rows reads `-`. Pins that cost rows are looked up by `productId`, not read off the product (`07:398`).
5. `it('renders a fixed função cost in reais from cents')`
   A cost row with `mode: 'fix'`, `valueBrl: 30000` produces a `title` containing `R$ 300,00`, never `R$ 30.000,00`. Pins `07:754`.
6. `it('shows counts for both kinds regardless of the active segment')`
   Both segment buttons present, their text carrying the unfiltered counts.
7. `it('treats a product without an explicit kind as a produto')`
   A fixture with `kind` omitted is listed under `kind="product"` and absent under `kind="service"`.
8. `it('keeps the kind segments reachable from an empty bucket')`
   Only produtos while `kind="service"`: text contains `Nenhum serviço cadastrado` **and** `button[aria-label="Filtrar por produtos"]` still exists. This is the behavioural fix over today's early `return`.
9. `it('summarises the app-default plan as 1x rather than a dash')`
   `defaultEntradaMode: 'none'`, `defaultRemainingInstallments: 1`: the `Plano padrão` cell reads `1x`, and the rendered text contains no `NaN`, `R$ NaN` or `undefined`. Pins that there is no "no plan" state (`07:489`).
10. `it('suffixes the plano padrão summary with mensal for a recurring serviço')`
    `hasMonthly: true` with `defaultRecurringCycles: null` renders ` + mensal`; the summary never prints a date.

ORACLE: `CI=true pnpm --filter @fxl-sales/web exec vitest run src/sales-ops/__tests__/produtos-servicos-view.test.tsx`

### File 2: `apps/web/src/sales-ops/__tests__/product-service-dialog.test.tsx`

`describe('product and service dialog')`

1. `it('titles and describes the dialog from the selected kind')`
   Opens with `productKind: 'service'`: the `h2` reads `Novo serviço`, the description mentions `custos por função`. Clicking `button[aria-label="Classificar como produto"]` makes the title `Novo produto`.
2. `it('has no preço em aberto switch')`
   The rendered text does not contain `Preço em aberto` and no button carries that label, in either kind. Pins slice 07 Decision 2's UI half (`07:107`).
3. `it('sends kind and never sends openPrice')`
   Picks an área, submits: `onSave` received `kind: 'product'`, and the payload does `not.toHaveProperty('openPrice')`. Pins the `kind_open_price_conflict` avoidance (`07:339`).
4. `it('replaces every own-value input with the definido na venda notice for a serviço')`
   Serviço with `Possui mensalidade` on: no numeric setup or monthly input exists, `Definido na venda` appears twice, and `Serviços têm valor variável, definido em cada proposta.` is present.
5. `it('zeroes the own value when a produto is reclassified as a serviço')`
   Opens an existing produto with `setupBrl: 100000`, `hasMonthly: true`, `monthlyBrl: 50000`; clicks `Classificar como serviço`; submits. Asserts `kind: 'service'`, `setupBrl: 0`, `monthlyBrl: 0`, so the write can never trip `service_cannot_have_fixed_value` (`07:340`).
6. `it('keeps the own-value inputs editable for a produto')`
   Produto: the setup input is editable and its typed value is submitted in cents.
7. `it('states that every value here is only a default')`
   Text contains `Tudo aqui é padrão: dentro da proposta você pode alterar qualquer valor sem mexer no cadastro.` and the commission section header reads `Comissionamento padrão`.
8. `it('submits the app-default plan when nothing is touched')`
   Picks an área, submits: `defaultEntradaMode: 'none'`, `defaultEntradaPct: null`, `defaultEntradaBrl: null`, `defaultRemainingInstallments: 1`, `defaultPaymentMethod: 'pix'`. Pins `07:489`.
9. `it('submits a percentage entrada into defaultEntradaPct only')`
   `chooseCombobox('Tipo de entrada', '%')`, `Valor da entrada` `50`, `Parcelas restantes` `3`, `chooseCombobox('Forma de pagamento padrão', 'Boleto')`, submits.
   Asserts `defaultEntradaMode: 'pct'`, `defaultEntradaPct: 50`, `defaultEntradaBrl: null`, `defaultRemainingInstallments: 3`, `defaultPaymentMethod: 'boleto'`. Pins the entrada-mode CHECK (`07:180-182`).
10. `it('submits a fixed entrada into defaultEntradaBrl as integer cents')`
    `R$ fixo` with `1.500,00`: `defaultEntradaMode: 'fix'`, `defaultEntradaBrl: 150000`, `defaultEntradaPct: null`.
11. `it('unmounts the entrada value input when the mode is nenhuma')`
    `Tipo de entrada` `nenhuma`: no `input[aria-label="Valor da entrada"]` is mounted.
12. `it('treats a blank ciclos as prazo indeterminado and shows no checkbox')`
    `hasMonthly` on, `Número de ciclos` blank: `defaultRecurringCycles` submits as `null`, the caption `Deixe em branco para prazo indeterminado` is present, and no button whose text is `Prazo indeterminado` exists.
13. `it('submits a bounded cycle count')`
    `Número de ciclos` `12`: `defaultRecurringCycles` submits as `12`.
14. `it('hides the ciclos field and nulls the column when the product has no mensalidade')`
    `hasMonthly` off: no `input[aria-label="Número de ciclos"]` is mounted and `defaultRecurringCycles` submits as `null`.
15. `it('never puts a date in the default payment plan controls')`
    `container.querySelectorAll('input[type="date"]').length` is `0`, and the submitted payload has no key matching `/date/i`. The stored template is dateless by construction (`07:403`).
16. `it('saves função costs as a discriminated pct row and a fix row in cents')`
    With `Desenvolvedor` and `Testador`: row 1 `Desenvolvedor` / `%` / `5`, row 2 `Testador` / `R$` / `300`.
    Asserts `productFuncaoCosts` equals `[{ funcaoId: dev.id, mode: 'pct', valuePct: 5 }, { funcaoId: tester.id, mode: 'fix', valueBrl: 30000 }]`, with no `valueBrl` on the first row and no `valuePct` on the second. This is the human's exact example and slice 07's acceptance vector (`07:27`, `07:597`).
17. `it('never offers a system função as a cost default')`
    Passes a `vendedor` função with `isSystem: true` alongside `Desenvolvedor`; the row's Combobox lists only `Desenvolvedor` and its panel text does not contain `Vendedor`.
18. `it('does not offer the same função twice')`
    After choosing `Desenvolvedor` in row 1, row 2's options exclude it, and `Adicionar` is disabled once every eligible função is used. Pins the client never tripping `duplicate_funcao_cost` (`07:342`).
19. `it('explains where to register funções when none exist')`
    `funcoes={[]}`: text contains `Nenhuma função cadastrada ainda. Cadastre as funções em Cadastros > Funções para definir custos padrão.` and that section's `Adicionar` button is `disabled`.
20. `it('does not reintroduce any control the payment plan builder removes')`
    Asserts the rendered text contains none of `Dividir em`, `+ parcela`, `Número de parcelas`, `Remover parcela`, `Adicionar recorrência`. Guards slice 11's future negative source-text assertions from a slice that lands first.
21. `it('drops the free-text prestador picker and never writes providers')`
    `container.querySelector('datalist#sales-ops-collaborators')` is `null`, the text does not contain `Prestadores de serviço`, and `onSave.mock.calls[0][0]` does `not.toHaveProperty('providers')`. Pins slice 07's stage 2 (`07:271`).
22. `it('surfaces legacy prestador names read-only inside the função cost section')`
    An existing product whose `providers` is `[{ personName: 'Ana', commissionType: 'pct', commissionValue: 5 }]`: text contains `Prestadores antigos deste cadastro não foram convertidos automaticamente: Ana. Recadastre o custo por função acima.` and submitting still omits `providers`.
23. `it('renders módulos only for a produto and preserves them when reclassified')`
    An existing produto with one módulo shows `Módulos`; clicking `Classificar como serviço` hides it; submitting still sends that módulo.
24. `it('rehydrates the stored plan columns and the funcaoCosts prop when reopened')`
    An existing serviço with `defaultEntradaMode: 'pct'`, `defaultEntradaPct: '50.00'` (a drizzle numeric **string**), `defaultRemainingInstallments: 3`, `defaultPaymentMethod: 'boleto'`, `defaultRecurringCycles: null`, plus two `funcaoCosts` rows passed as the prop.
    Asserts `Tipo de entrada` reads `%`, `Valor da entrada` is `50`, `Parcelas restantes` is `3`, `Forma de pagamento padrão` reads `Boleto`, `Número de ciclos` is `''`, and both cost rows are populated with the right unit toggle active (`className` contains `bg-[#201f24]`, matching the idiom at `product-commission-editor.test.tsx:246`) and the `fix` row showing `300` rather than `30000`.
25. `it('keeps the commission editor working unchanged for a serviço')`
    Smoke-guards section 6 under the new kind: the `Somente vendedor` / `Vendedor + Finder` pills switch and `input[aria-label="Comissão do vendedor - somente vendedor"]` still reads `10`.

ORACLE: `CI=true pnpm --filter @fxl-sales/web exec vitest run src/sales-ops/__tests__/product-service-dialog.test.tsx`

### Regression oracles

```bash
CI=true pnpm --filter @fxl-sales/web exec vitest run src/sales-ops/__tests__/product-commission-editor.test.tsx
CI=true pnpm --filter @fxl-sales/web exec vitest run src/sales-ops/__tests__/areas-view.test.tsx
CI=true pnpm --filter @fxl-sales/web exec vitest run src/sales-ops/__tests__/routing.test.tsx
CI=true pnpm --filter @fxl-sales/web exec vitest run src/sales-ops/__tests__/sale-wizard-ui-contract.test.ts
CI=true pnpm --filter @fxl-sales/web exec vitest run src/sales-ops/__tests__/calculations.test.ts
```

Note on the oracle form: `pnpm --filter @fxl-sales/web test -- --run <path>` does **not** filter. pnpm swallows the positional argument and all 21 web test files run (122 tests instead of the handful under test). Always use `exec vitest run` with the path relative to `apps/web`.

### Gate 2 full sweep

```bash
pnpm run lint
pnpm run type-check
CI=true pnpm test
pnpm run build
```

## Green

1. `apps/web/src/sales-ops/types.ts` - confirm slice 07 landed `kind: 'product' | 'service'`, the six `default*` fields and `SalesOpsProductFuncaoCost` on/next to `SalesOpsProduct`; reconcile any name drift against `07:368-395` before editing.
   Add `export type ProductKind = SalesOpsProduct['kind'];` if slice 07 exported no alias.
   Add `productFuncaoCosts: SalesOpsProductFuncaoCost[]` to `SalesOpsBootstrap` as a **required** key.
   Confirm `SalesOpsFuncao` and `SalesOpsBootstrap.funcoes` already exist from slice 09; add them in slice 05's shape only if absent.
2. `apps/web/src/sales-ops/hooks.ts` - add `productFuncaoCosts: Array.isArray(data.productFuncaoCosts) ? data.productFuncaoCosts : [],` to the `select` allow-list next to `saleProfessionals` (:37).
3. `apps/web/src/sales-ops/api.ts` - extend the existing `Omit` list on `SaveProductPayload` (:22-36) with `'defaultEntradaPct'` and re-declare it as `defaultEntradaPct?: number | null`, exactly as the three commission values are already handled, because the read type is a `numeric` string while slice 07's Zod expects a number (`07:318`, `07:380`).
   Add the write field:
   ```ts
   productFuncaoCosts?: Array<
     | { funcaoId: string; mode: 'pct'; valuePct: number }
     | { funcaoId: string; mode: 'fix'; valueBrl: number }
   >;
   ```
   Mirrors `ProductFuncaoCostSchema` (`07:289-292`). No change to `salesOpsApi.saveProduct`; the response gains a `productFuncaoCosts` key the declared type ignores, and the mutation already invalidates the bootstrap.
4. `apps/web/src/sales-ops/navigation.ts:59` - label `'Produtos'` becomes `'Produtos & Serviços'`.
5. `SalesOpsApp.tsx` `emptyBootstrap` (:122-133) - add `productFuncaoCosts: []`.
6. `SalesOpsApp.tsx` `titleForView` `produtos` entry (:197-200) - title `'Produtos & Serviços'`, subtitle `'Catálogo, valores, custos por função e padrões de proposta'`.
7. `SalesOpsApp.tsx` `ModalState` (:162) - product variant gains `productKind?: ProductKind`.
8. `SalesOpsApp.tsx` - hoist `paymentMethodLabels: Record<PaymentMethod, string>` to module scope next to `statusMeta` (:226) and point the sale-detail local at :1597-1602 at it.
9. `SalesOpsApp.tsx` - rename `CommissionModeButton` (:2498) to `SegmentedButton`, add optional `count?: number` (a `ml-1.5 rounded-md bg-[#e9e9ed] px-1.5 text-[11px] font-bold` pill), optional `ariaLabel`, and `aria-pressed={active}`. Update the two call sites at :2840 and :2846.
10. `SalesOpsApp.tsx` - extract `ListEditor`'s header block (:3131-3147) into `DialogSection({ title, subtitle, action, children })` and reimplement `ListEditor` on top of it. No visual change.
11. `SalesOpsApp.tsx` - add helpers next to `formatProductCommission` (:1978): `productKind(product): ProductKind` (only if slice 08 left no serviço predicate to reuse), `formatFuncaoCost(row)` using `formatMoneyBrl` for `'fix'` cents and `pctToInput` for `'pct'`, and `defaultPlanSummary(product)`.
12. `SalesOpsApp.tsx` `ProductsView` (:1991) - props become `{ areas, products, funcaoCosts, kind, onKindChange, onEdit }`.
    Render the `panelClass` card unconditionally; inside it a segmented bar with two `SegmentedButton`s (`Produtos` / `Serviços`, counts from the unfiltered array, aria-labels `Filtrar por produtos` / `Filtrar por serviços`); below it either the kind-filtered table or the kind-aware `EmptyPanel`.
    Split the header and cell renderers per kind as specified, keeping every produto header string and cell expression byte-identical to today's.
13. `SalesOpsApp.tsx` `SalesOpsApp` - add `const [productKind, setProductKind] = useState<ProductKind>('product')`; wire `runHeaderAction` (:598) to `setModal({ kind: 'product', productKind })`; wire `headerAction` (:624) to the kind-aware label; at the `ProductsView` call site (:1067-1071) pass `funcaoCosts={bootstrap.productFuncaoCosts}`, `kind={productKind}`, `onKindChange={setProductKind}`; at the `ProductDialog` call site (:1099-1108) replace `collaborators={…}` with `funcoes={bootstrap.funcoes ?? []}` and `funcaoCosts={bootstrap.productFuncaoCosts.filter((row) => row.productId === modal.product?.id)}`.
14. `SalesOpsApp.tsx` `ProductForm` (:2403) - **delete** `openPrice` and `providers`; add `kind: ProductKind`, the five plan fields from `## Dialog design` section 7, and `funcaoCosts: FuncaoCostForm[]`.
15. `SalesOpsApp.tsx` `productForm` (:2422) - signature becomes `productForm(product?: SalesOpsProduct, kindHint?: ProductKind, funcaoCosts?: SalesOpsProductFuncaoCost[])`.
    Seed `kind: product?.kind ?? kindHint ?? 'product'`; seed the five plan fields from the flat columns (`defaultEntradaValue` via `pctToInput` for `'pct'` and `centsToInput` for `'fix'`, `defaultRemainingInstallments` via `String`, `defaultRecurringCycles: null` to `''`); seed `funcaoCosts` from the prop, mapping `valuePct` through `pctToInput` and `valueBrl` through `centsToInput`.
16. `SalesOpsApp.tsx` `ProductDialog` (:2583) - swap `collaborators: SalesOpsPerson[]` for `funcoes: SalesOpsFuncao[]` plus `funcaoCosts: SalesOpsProductFuncaoCost[]`; extend the remount key to `key={props.modal.product?.id ?? \`new-${props.modal.productKind ?? 'product'}\`}` so opening `Novo serviço` straight after `Novo produto` reseeds the form.
17. `SalesOpsApp.tsx` `ProductDialogBody` (:2605) - implement sections 0 to 11 in order using only `DialogSection`, `SegmentedButton`, `ReferenceToggle`, `UnitToggle`, `UnitInput`, `DefinedOnSaleNotice`, `ListEditor` and `Combobox`. Bump `max-w-[560px]` to `max-w-[640px]` at :2677. Delete the `Preço em aberto` `ReferenceToggle` (:2738-2745). Replace every former `form.openPrice` read with `form.kind === 'service'`. Every Combobox gets slice 06's canonical taller size, an explicit `searchPlaceholder`, and `entityGender` where the noun is feminine.
18. `SalesOpsApp.tsx` - delete the `Prestadores de serviço` `ListEditor` (:3007-3084) and the `<datalist>` (:3085-3089).
19. `SalesOpsApp.tsx` `submit()` (:2636) - send `kind: form.kind`; **omit** `openPrice` and `providers` entirely; force `setupBrl: form.kind === 'service' ? 0 : parseCurrencyToCents(form.setupBrl)` and `monthlyBrl: form.kind === 'service' || !form.hasMonthly ? 0 : parseCurrencyToCents(form.monthlyBrl)`; emit `defaultPaymentMethod`, `defaultEntradaMode`, `defaultEntradaPct` (`parseDecimal` when `'pct'`, else `null`), `defaultEntradaBrl` (`parseCurrencyToCents` when `'fix'`, else `null`), `defaultRemainingInstallments` clamped to 1..120, `defaultRecurringCycles` (`null` when `!form.hasMonthly` or the field is blank, else the parsed integer clamped to 1..120), and `productFuncaoCosts` built as the discriminated union in `## Dialog design` section 8.
20. Apply every item in `## Test fallout`, starting with the eleven one-line bootstrap additions and re-reading the slice 06 combobox helper before items 16 and 17.
21. Write the two new test files from `## Red`.
22. Run every ORACLE and the Gate 2 sweep. Land as one commit: `feat(sales-ops): rename produtos to produtos & serviços with kind-aware list and default config`.

## Refactor

- `SegmentedButton` and `DialogSection` are net reductions: they collapse two near-duplicate markup blobs (the commission pills and the `ListEditor` header) into one each, so the new sections cannot drift from the existing ones.
- `paymentMethodLabels` hoisted to module scope removes the second copy of the four pt-BR method strings.
- Deleting `ProductForm.openPrice` and `ProductForm.providers` removes two form fields and the whole providers editor, so the dialog's net field count barely rises despite gaining two sections.
- No `IndefiniteCheckbox` extraction. Slice 11 deletes the wizard's `Prazo indeterminado` checkbox outright (`11:86`, `11:393`), so extracting it would create a shared component with exactly one caller and then zero.
- No shared plan-summary function with slice 11: its hints are derived from a proposta total (`11:72`, `11:76`) and a cadastro has no total. Consistency is enforced through identical labels, option sets, geometry, palette and the blank-ciclos rule.
- `formatFuncaoCost` is deliberately separate from `formatProductCommission` (:1978) because the two store money in different units (cents versus reais). Unifying them is only correct once the six `numeric(10,2)` commission columns are normalized to cents, which slice 07 listed as a separate slice (`07:732`).
- `SalesOpsApp.tsx` grows. It is already 5207 lines and this slice pushes it further. Extracting `ProductsView` plus the product dialog into `apps/web/src/sales-ops/products/` would be right, but it would balloon the diff of an already large slice, make the test fallout unreadable against the anchors above, and collide with slice 11's imminent 240-line rewrite of the same file. Recorded as a follow-up, deliberately not done here.

## Out of scope

- Any API, schema, migration or Zod change. Slice 07 owns all of it and has landed.
- Reading these defaults inside the proposta wizard and overriding them per proposta. Slice 12.
- Building the wizard's payment-plan builder, `PaymentPlanShape`, `generateInstallmentPlan`, `inferPaymentPlanShape` or `defaultPlanShapeForProduct`, and any edit to `apps/web/src/sales-ops/calculations.ts` beyond the two bootstrap literals in its test file. Slice 11 owns that file and reads the flat default columns directly.
- Rewriting `addMonthsToIsoDate` to clamp month ends. Slice 11 (`11:379`).
- Creating the `Combobox` primitive (slice 03) or sweeping the remaining pickers and native number spinners (slice 06). This slice converts only the pickers it renders.
- An `onCreate` create-new-função row on the função picker. Creating a função is admin-gated `POST /funcoes` (`05:429`) and slice 09 owns the funções cadastro; the empty-state message points there.
- Fixing the dead `bg-popover` / `text-popover-foreground` classes at `select.tsx:78` and `dropdown-menu.tsx:48,72`, which emit no CSS because `popover` is defined in neither `apps/web/tailwind.config.ts` nor `apps/web/src/index.css`. Slice 06 owns the fix (`03:397`). This slice must not use `bg-popover`.
- **Dropping** the `providers` jsonb column or `ProductProviderSchema`. This slice removes the *editor* and stops *sending* the field, which is slice 07's stage 2 (`07:271`); a later contract slice drops the column (`07:272`).
- Migrating existing `providers` data into `productFuncaoCosts`. Slice 07 established no deterministic mapping exists (`07:274`).
- Removing `openPrice` from `SalesOpsProduct` or from the eleven wizard readers. Slice 07 deliberately kept it as a server-derived projection (`07:101`).
- Creating `cadastros/funcoes` or `cadastros/pessoas`. Slices 05 and 09.
- Normalizing the six `*_commission_value numeric(10,2)` columns to cents (`07:732`).
- Changing the route path, the `AppRole` visibility rules, the propostas status machine, the payables materialization rules, or the `"N/M"` / `"MN/M"` receivable labels.
- i18n extraction. pt-BR strings stay inline.

## Risks

1. **Existing `providers` data becomes invisible in the product UI after this slice, and it is not migrated.** This is deliberate and inherited: slice 07 refused an automatic `providers` to `productFuncaoCosts` backfill because a provider row keys on free-text `personName` while a cost row keys on `funcaoId`, so fuzzy-matching "would silently attach wrong money to wrong roles" (`07:274`, `07:490`). After this slice those values live only in the deprecated database column and in the read-only notice in section 10. Mitigation and the accepted residue: the notice (dialog test 22) shows the operator every legacy name in the record so the manual re-entry slice 07 intended is actually possible; the payload **omits** `providers` rather than sending `[]`, and `UpdateProductSchema` leaves omitted keys unchanged (`07:526`), so no row is destroyed by an edit (dialog test 21). **Flag to the human:** before the later contract slice drops the column, run `SELECT id, name, providers FROM sales_ops_products WHERE jsonb_array_length(providers) > 0` and keep the output, because that is the last moment the data is reachable.
2. **Removing the `Preço em aberto` switch changes what an operator can express.** An open-price *Produto* is no longer representable; such records are Serviços. That is slice 07's Decision 2 plus its backfill (`kind = CASE WHEN open_price THEN 'service' ELSE 'product' END`, `07:487`), so every existing open-price product has already become a Serviço in the database before this slice renders anything. Mitigation: the toggle's removal is pinned by dialog test 2, the `kind`-only write by test 3, and the reclassification zeroing by test 5, so the dialog can never emit a payload that trips `kind_open_price_conflict` or `service_cannot_have_fixed_value`.
3. **`SalesOpsBootstrap` gaining a required key touches eleven files.** Mitigation: each is a single added line, all eleven are enumerated with `file:line` in `## Test fallout`, no assertion changes, and `pnpm run type-check` catches a miss. The alternative (an optional key) was rejected because `hooks.ts:28-40` is the one place that guarantees the array exists and an optional key would push `?? []` into every consumer permanently.
4. **`defaultEntradaPct` crosses the string/number boundary.** It is a drizzle `numeric` string on read (`07:380`) and a number on write (`07:318`). Getting it wrong sends `"50.00"` where Zod wants `50`. Mitigation: `api.ts` `Omit`s and re-declares it exactly as the three commission values already are (Green step 3), seeding goes through `pctToInput` which accepts either, and submission goes through `parseDecimal`. Pinned by dialog tests 9 and 24.
5. **Cost values cross the cents/reais boundary.** `valueBrl` is integer cents while `formatProductCommission`'s `fix` branch formats reais, so reusing it would render `R$ 300,00` as `R$ 30.000,00`. Slice 07 flagged this explicitly (`07:754`). Mitigation: a separate `formatFuncaoCost` using `formatMoneyBrl`, and `parseCurrencyToCents` on the way in. Pinned by view test 5, dialog test 16 (`valueBrl: 30000`) and dialog test 24 (redisplay as `300`).
6. **Slice 11 lands after this slice and will assert negative source-text guards** on `SalesOpsApp.tsx` (`11:272-277`). Introducing `Dividir em`, `+ parcela`, `Número de parcelas`, `Remover parcela` or `Adicionar recorrência` here would red-line slice 11 later. Avoided by using slice 11's own labels (`Tipo de entrada`, `Valor da entrada`, `Parcelas restantes`, `Número de ciclos`) and pinned by dialog test 20.
7. **Slice 06 changes the picker DOM under the existing tests.** `chooseArea` at `product-commission-editor.test.tsx:146-150` and the área interaction at `areas-view.test.tsx:249-251` stop matching a `<select>` once slice 06 lands and deletes `NativeSelect`. Mitigation: slice 06 is wave 2 and lands first, and Green step 20 requires re-reading those helpers and reusing whatever slice 06 left rather than inventing a second one, the same instruction slice 11 gives itself (`11:296-297`).
8. **The five existing commission oracles are load-bearing and easy to break.** Mitigation: section 6 changes only the section header and adds a subtitle. Every pill label, every `aria-label`, and the independent `seller_only` / `with_finder` state machine are byte-identical; all five assertions plus dialog test 25 are re-run.
9. **The função picker could offer `vendedor` or `finder`, creating two ways to pay a vendedor.** Avoided by filtering on `!funcao.isSystem`, which is what slice 05 added `isSystem` for (`05:163-164`), and pinned by dialog test 17.
10. **`ProductsView` gaining three required props breaks two existing render sites at type-check time.** Mitigation: enumerated as fallout items 15 and 18, three added lines each, with `pnpm run type-check` catching any missed site.
11. **Cost rows arrive flat, not nested, so a naive `product.funcaoCosts` read would silently render zero costs.** Mitigation: the flat shape is stated in `## Current state` from `07:398`, the prop is threaded explicitly in Green steps 12 and 13, and view test 4 pins per-`productId` scoping with two products and three rows.
12. **`'product'` now means two different things** across `ModalState.kind` and `SalesOpsProduct.kind`. Mitigation: the product-kind hint is named `productKind`, the two literals live on different fields of different types and never meet, and the collision is documented in `## Current state`. Renaming the modal discriminator is out of scope.
13. **Slice 07 may have made the six default fields optional rather than required on `SalesOpsProduct`.** Its Green step 19 says "add the six read-only default fields" without stating optionality. Mitigation: Green step 1 is an explicit reconciliation read of `07:368-395` against the landed `types.ts`, every reader in this slice tolerates `undefined` via the existing `pctToInput` / `centsToInput` fallbacks, and view test 9 asserts no `NaN` or `undefined` ever reaches the screen.
14. **The dialog could still feel heavy.** Mitigation: this slice removes one toggle and one whole repeating-row editor while adding two sections, so the net field count barely moves; section headers use one recipe; every control is `h-11`; labels are 12px `#8b8b92` semibold via `Field` (:401) or 11px uppercase `#9b9ba3` via `DialogSection`; and the width goes to 640 so the two-column grids breathe. The next lever, if a reviewer still finds it long, is collapsing `Comissionamento padrão` behind a summary row, a copy-and-toggle change with no contract impact.
15. **Slice size.** This slice **can** land atomically: it is one screen plus one dialog plus one nav label plus eleven one-line fixture additions, and it must be atomic in one respect anyway, because removing the `providers` editor and adding the `productFuncaoCosts` write field are the two halves of slice 07's stage 2 and shipping only one would leave either two live cost mechanisms or none. If the orchestrator still wants a split, the only safe boundary is:
    - `10a-produtos-servicos-shell`: Green steps 1 to 13 plus step 14's `kind` field, plus fallout items 1 to 18 except 13/14/17, plus test file 1 and dialog tests 1 to 7, 23, 25. Boundary: bootstrap plumbing, `navigation.ts`, `titleForView`, `ModalState`, `runHeaderAction`, `headerAction`, `ProductsView`, and the `openPrice`-to-`kind` swap in the dialog.
    - `10b-produtos-servicos-defaults`: Green steps 14 (plan and funcaoCosts fields) to 19, plus fallout items 13, 14, 17, plus dialog tests 8 to 22 and 24. Boundary: only `ProductDialogBody`, `ProductForm`, `productForm`, `submit()`, `api.ts`, and the `funcoes` / `funcaoCosts` prop swap.
    `10a` must not remove the providers editor (it has no replacement yet) and `10b` must land before slice 11 so risk 6 stays covered. Both halves are independently green.
