---
id: 10-produtos-servicos-web
milestone: v2.3.0
status: todo
depends_on: [06-combobox-adoption, 07-produtos-servicos-api]
files_modified:
  - apps/web/src/sales-ops/navigation.ts
  - apps/web/src/sales-ops/types.ts
  - apps/web/src/sales-ops/SalesOpsApp.tsx
  - apps/web/src/sales-ops/__tests__/produtos-servicos-view.test.tsx
  - apps/web/src/sales-ops/__tests__/product-service-dialog.test.tsx
  - apps/web/src/sales-ops/__tests__/product-commission-editor.test.tsx
  - apps/web/src/sales-ops/__tests__/areas-view.test.tsx
  - apps/web/src/sales-ops/__tests__/routing.test.tsx
acceptance: "given an admin on /cadastros/produtos, when they switch the Produto | Serviço segmented filter to Serviço and open Novo serviço, then the screen title reads Produtos & Serviços, the list shows the serviço column set (Valor = Variável, Plano padrão, Custos padrão) instead of Setup/Mensalidade/Recorrente, and the dialog replaces every own-value money input with the Definido na venda notice while exposing a default payment plan template (Tipo de entrada nenhuma|%|R$ fixo + Parcelas restantes + Forma de pagamento padrão + Número de ciclos where blank means prazo indeterminado) and a Custos padrão por função editor whose rows are {função via Combobox, % | R$ fixo, valor}, all saved through one SaveProductPayload that no longer carries providers"
---

# Produtos & Serviços: one adaptive Cadastros screen with real defaults

## Goal

Turn `cadastros/produtos` into the single "Produtos & Serviços" screen the human asked for: a `Produto | Serviço` segmented filter over one list whose columns adapt to the kind, and one dialog that adapts to the kind so that a Serviço declares "valor variável, definido na proposta" instead of its own price while gaining the two configuration surfaces a Serviço actually needs, namely default costs per função and a default payment plan template.
The same dialog is also where "improve by a lot the config inside product/service" lands: default commissions get an explicit "these are only defaults" framing, the default payment plan becomes a real template control built from slice 11's exact vocabulary and aria-labels so the cadastro default and the wizard builder read as one control, and the bespoke free-text `Prestadores de serviço` picker is retired in favour of função-based cost defaults so the app stops carrying a third, FK-less people concept.
Everything configured here is a suggestion: the copy states it once at the top of the dialog, and slice 12 makes the proposta honour and override it.

## Current state

### Verified in the repo

Anchors read at plan time, not assumed.

- `apps/web/src/sales-ops/SalesOpsApp.tsx` is 5207 lines.
  - `formatProductCommission(type, value)` at :1978-1990 renders `pct` as `10%` and `fix` as `R$ 1.000,00` through `Intl.NumberFormat('pt-BR')`.
  - `ProductsView` at :1991-2079, exported, props `{ areas, products, onEdit }`.
    Its early `return` for the empty case is :2000-2007, with title `Nenhum produto cadastrado` and text `Cadastre produtos reais para habilitar a criação de vendas e códigos automáticos.`
    Table headers at :2014-2022 are `Nome | Área | Cód. | Setup | Mensalidade | Somente vendedor | Vendedor + Finder | Recorrente | Ações` (9 columns).
    The `Setup` cell :2038 and `Mensalidade` cell :2040-2045 already print `Aberto` when `product.openPrice`.
  - `type ProductForm` :2403-2420, `productForm(product?)` :2422-2453.
  - `ReferenceToggle` :2455-2496, `CommissionModeButton` :2498-2518, `UnitToggle` :2520-2543, `UnitInput` :2545-2573, `DefinedOnSaleNotice` :2575-2581.
  - `ProductDialog` :2583-2603, a thin wrapper remounting `ProductDialogBody` via `key={props.modal.product?.id ?? 'new-product'}`; props include `collaborators: SalesOpsPerson[]`.
  - `ProductDialogBody` :2605-3112, `DialogContent` `max-w-[560px]` at :2677. Section order today: `Nome` :2703, code-suffix strip :2713-2736, `Preço em aberto` :2738-2745, the `Área` + `Setup (R$)` grid :2747-2780 (`Área` is a `NativeSelect` with `aria-label="Área do produto"` at :2750-2764), the `Possui mensalidade` card :2782-2833 with `Valor da mensalidade (R$)` :2800 and `Incide sobre recorrente` :2812-2830, the `Comissionamento` block :2835-2937, the `Módulos` `ListEditor` :2939-3005, the `Prestadores de serviço` `ListEditor` :3007-3084, `<datalist id="sales-ops-collaborators">` :3085-3089, footer :3092-3107.
  - `submit()` :2636-2672 builds `SaveProductPayload` and always sends `modules` and `providers`.
  - `ListEditor` :3114-3159 is the only repeating-row shell: uppercase 11px `#9b9ba3` title, optional 11.5px `#b0b0b8` subtitle, an `Adicionar` button, a dashed empty box.
  - `ModalState` :161-166; the `person` variant already carries a hint field (`roleHint`) at :165, the precedent for a product-kind hint.
  - `titleForView` :172-215, `produtos` entry :197-200 (`Produtos` / `Catálogo, valores, códigos e regras de comissão`).
  - `runHeaderAction` :596-618 opens `{ kind: 'product' }` at :597-600; `headerAction` :620-635 yields `'Novo produto'` at :624.
  - `ProductsView` is rendered at :1066-1072, `ProductDialog` at :1099-1108 with `collaborators={bootstrap.people.filter((person) => person.isCollaborator)}` at :1101.
  - Style constants `panelClass` :135, `mutedPanelClass` :136, `tableHeadClass` :137, `tableCellClass` :139, `iconButtonClass` :140, `formInputClass` :142, `formSelectClass` :144.
  - Money helpers `parseCurrencyToCents` :260, `centsToInput` :264, `parseDecimal` :269, `pctToInput` :276. `formatMoneyBrl` is `apps/web/src/sales-ops/calculations.ts:112-125` with `Intl.NumberFormat('pt-BR')` at :117.
  - `methodLabels` (`PIX`, `Cartão`, `Boleto`, `Transferência`) exists at :1597-1602 but is local to the sale-detail component.
- `apps/web/src/sales-ops/navigation.ts:58-65` hardcodes the `cadastros` array; `{ id: 'produtos', label: 'Produtos', icon: Database }` is :59.
- `apps/web/src/sales-ops/types.ts` `SalesOpsProduct` has no `kind`, no default plan, no função costs, and still carries the legacy `type: string` plus `providers: SalesOpsProductProvider[]` where a provider is `{ personName: string; commissionType: CommissionType; commissionValue: number }`. `CommissionType` is `'pct' | 'fix'`.
- `apps/web/src/sales-ops/api.ts` derives `SaveProductPayload` from `Partial<SalesOpsProduct>`, so type additions flow into the payload with no edit. Mutation `useSaveSalesOpsProduct` is `apps/web/src/sales-ops/hooks.ts:63-73`.
- API side: `sales_ops_products` is `apps/api/src/db/schema.ts:462-504` (already `modules jsonb`, `providers jsonb`); `ProductSchema` is `apps/api/src/domains/sales-ops/service.ts:64-84`; `POST /products` and `PATCH /products/:id` are `apps/api/src/domains/sales-ops/routes.ts:85-107`, and PATCH parses with `ProductSchema.partial()`, so an omitted key leaves its column untouched.
- Nothing outside the product dialog reads `product.providers`: it appears only in `types.ts`, `productForm` (:2447), the dialog body, the submit payload (:2662), `ProductSchema` (:82) and the column default (`schema.ts:495`).
- `apps/web/src/components/ui/tabs.tsx` is unmodified shadcn (`h-10 rounded-md bg-muted text-muted-foreground`, `data-[state=active]:bg-background`).
- Test harness: `apps/web/vitest.config.ts` sets `environment: 'node'`; component tests opt in with `// @vitest-environment happy-dom` on line 1, render through `createRoot`, reach `act` via a cast, and `vi.mock('@/components/ui/dialog')` into plain divs. Models are `apps/web/src/sales-ops/__tests__/product-commission-editor.test.tsx` (289 lines) and `apps/web/src/sales-ops/__tests__/areas-view.test.tsx` (285 lines). No `@testing-library/*` is installed.

### Consumed from the dependency plans

All four upstream plans now exist and are read. This slice consumes them rather than guessing.

**`03-combobox-primitive.md`** - the primitive is inline and non-portalled with **no new dependency**, so a rendered Combobox lives inside the test `container` and needs **no `vi.mock`**.
Its API (`03:170-212`): `{ options: ComboboxOption[]; value: string | null; onChange: (value: string) => void; onCreate?; entityLabel?; entityGender?: 'm' | 'f'; id?; placeholder?; valueLabel?; searchPlaceholder?; emptyMessage?; disabled?; className?; panelClassName?; 'aria-label'?; 'aria-labelledby'?; 'aria-describedby'? }`, with `ComboboxOption = { value; label; description?; group? }`.
DOM contract (`03:253-262`): trigger is `button[role="combobox"]` carrying the passthrough `aria-label`; the panel search field carries `aria-label={searchPlaceholder}` (default `'Buscar...'`); rows are `[role="option"]`; the create row is `[data-combobox-create="true"]`.
Enter always calls `preventDefault` (`03:235`), so a Combobox inside this dialog's `<form>` can never submit it by accident.
Outside-close listens on `mousedown`, not `click` (`03:249`).
`className` merges through `cn`/twMerge so `formSelectClass`'s `h-11 rounded-[10px]` wins over the base `h-10 rounded-md` (`03:50`, pinned by its test 27).
Accent palette is the product amber `bg-[#fdf7e8] text-[#9c7210]` / active `bg-[#f4efe2]`, never `bg-primary`, because `--primary` is blue in this repo (`03:61-67`).

**`05-pessoas-funcoes-api.md`** - `bootstrap` gains `funcoes: FuncaoResponse[]` and `personFuncoes` (`05:522-538`), where `FuncaoResponse = { id, orgId, name, slug, isSystem, status: 'active' | 'archived', createdAt, updatedAt }` (`05:392-401`), ordered `isSystem DESC, name ASC` (`05:421`).
`vendedor` and `finder` are the two immutable `isSystem: true` funções (`05:320-333`); `Prestador` is seeded as a **non-system** função only for orgs that had collaborators (`05:335-346`); and `isCollaborator` is redefined as "has at least one non-system função" (`05:253`).
Its compatibility matrix is explicit about this slice's surface: `sales_ops_products.providers` jsonb is "Untouched in 05. **Slice 07 replaces it with per-função cost defaults**; this slice only makes the funções available to it." (`05:556`).
That is the batch's own intent, and it settles the providers question below.

**`11-payment-plan-builder.md`** - defines the vocabulary this slice must reuse verbatim.
`PaymentPlanShape = { entradaMode: 'none' | 'pct' | 'fixed'; entradaValue: number; restanteCount: number; anchorDate: string }` where `entradaValue` is a percent 0-100 when `'pct'` and **integer cents** when `'fixed'` (`11:113-119`).
`defaultPlanShapeForProduct(product, baseDate): PaymentPlanShape` is named as "the single seam slices 07 and 10 wire the persisted template into" (`11:215`), and 11 records the assumed persisted field as `SalesOpsProduct.defaultPaymentPlan: { entradaMode, entradaValue, restanteCount } | null`, "reusing the `PaymentPlanShape` vocabulary minus `anchorDate` (which is always the proposta base date, never a product property)" (`11:218`).
Its aria-labels are `Tipo de entrada`, `Valor da entrada`, `Parcelas restantes`, `Recorrência`, `Início da recorrência`, `Número de ciclos` (`11:69-86`).
It **deletes** the `Prazo indeterminado` checkbox and the `Adicionar recorrência` placeholder: "blank ciclos is the only expression of indefinite" (`11:86`), with the caption `Deixe em branco para prazo indeterminado` (`11:82`).
It adds negative source-text guards to `sale-wizard-ui-contract.test.ts` (`11:272-277`): `not.toContain('Dividir em')`, `not.toContain('+ parcela')`, `not.toContain('Adicionar recorrência')`, `not.toContain('Número de parcelas')`, `not.toContain('Remover parcela')`.
**Slice 10 runs before slice 11 in the queue**, so this slice must not introduce any of those five substrings into `SalesOpsApp.tsx`, or it will red-line slice 11 later.

**`08-service-description-optional.md`** - already assumes `kind: 'produto' | 'servico'` on `SalesOpsProduct` (`08:306-307`) and adds a serviço predicate (`08:237`, `return product?.kind === 'servico'`). It runs before this slice, so the discriminator and its predicate may already exist; consume them rather than re-adding.

### Queue position

Wave 3 order is `08`, `09`, `10`, `11`. So by the time this slice starts: slice 06 has already converted the `Área` picker to the Combobox and left an interaction helper in the two existing product test files; slice 07 has added the `kind` discriminator and the storage; slice 08 has added the serviço predicate; slice 09 has added `SalesOpsFuncao` and `bootstrap.funcoes` on the web side. Slice 11 has **not** run yet.

### Three different things are called `kind`

Stated so nobody conflates them.
`ModalState.kind` is the modal discriminator (`'product' | 'client' | 'area' | 'person'`, :162-165).
`SaleItemForm.kind` is the item row kind (`'product' | 'free'`, :3495-3502, per `08:60`).
`SalesOpsProduct.kind` is the catalog discriminator this slice renders (`'produto' | 'servico'`).
The product-kind hint on `ModalState` is therefore named `productKind`, never `kind`.

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

State lives in `SalesOpsApp` (`const [productKind, setProductKind] = useState<ProductKind>('produto')`), not in the URL. The URL stays the single source of truth for **workspace and page**, which this is not; the precedent is `SalesFilters` at :170, already component state for the propostas list. The parent must own it because `headerAction` and `runHeaderAction` both read it.

`ProductsView` props become `{ areas, products, kind, onKindChange, onEdit }`. `kind` and `onKindChange` are required, not optional-with-internal-fallback, so there is one source of truth.

### One filtered list, not two sections

The toggle filters a single table. Two stacked sections would need two headers, two column sets, two empty states and double the scroll on one screen, and would make the header action ambiguous. With exactly one kind active, `Novo produto` / `Novo serviço` is unambiguous and the table never mixes semantics.

The segmented group sits in a slim bar above the table inside the same `panelClass` card (`border-b border-[#e8e8ec] px-4 py-3`) so filter and rows read as one object. Counts come from the unfiltered `products` array so the operator always sees how many of the other kind exist.

Kind is read through the serviço predicate slice 08 leaves in `calculations.ts`, or a local `productKind(product)` returning `product.kind ?? 'produto'` if none exists. A record from an API older than slice 07 is a Produto, which is both the safe default and what every existing row actually is.

### List columns

Nine columns in both sets, so toggling does not reflow the table rhythm.

Produto (unchanged from today, preserving both existing table oracles):

| Nome | Área | Cód. | Setup | Mensalidade | Somente vendedor | Vendedor + Finder | Recorrente | Ações |

Serviço:

| Nome | Área | Cód. | Valor | Plano padrão | Custos padrão | Somente vendedor | Vendedor + Finder | Ações |

- `Valor` renders the muted text `Variável` in `text-[#9b9ba3]`, never a money figure. A Serviço has no own value by definition (item 5), so `R$ 0,00` would be a lie and `Aberto` would leak the internal `openPrice` flag name.
- `Plano padrão` renders `defaultPlanSummary(product)`: `50% + 3x`, `3x`, `R$ 5.000,00 + 2x`, `1x`, optionally suffixed ` + mensal`, or `-` when no template is stored. Money inside it goes through `formatMoneyBrl`.
- `Custos padrão` renders `1 função` / `3 funções` / `-`, with a `title` on the cell listing `Nome da função · 5%` pairs formatted by `formatProductCommission`.
- `Setup`, `Mensalidade` and `Recorrente` are dropped for Serviço: the first two are meaningless when the value is variable, and recurrence is conveyed by `Plano padrão`'s ` + mensal` suffix.

Empty states, kind-aware, replacing the single stale string at :2002-2005 (which still says "vendas" after the Propostas rename):

- Produto: title `Nenhum produto cadastrado`, text `Cadastre produtos com valor próprio para habilitar a criação de propostas e códigos automáticos.`
- Serviço: title `Nenhum serviço cadastrado`, text `Cadastre serviços de valor variável para reaproveitar custos por função e padrões de proposta.`

The empty state renders **below** the segmented bar, not instead of the whole card, so the operator can still switch kinds from an empty bucket. This is a real behavioural fix over today's early `return` at :2000.

### Screen chrome

- `navigation.ts:59` label becomes `Produtos & Serviços`. The id stays `produtos`, so `navigation.test.ts:53-60` (which asserts ids) is untouched.
- `titleForView` `produtos` becomes `{ title: 'Produtos & Serviços', subtitle: 'Catálogo, valores, custos por função e padrões de proposta' }`.
- `headerAction` :623-624 becomes `productKind === 'servico' ? 'Novo serviço' : 'Novo produto'`.
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
2. The heaviest new section (`Plano de pagamento padrão`) is gated by a `ReferenceToggle`, so a user who wants no template sees one 2-row switch instead of five fields.
3. Consistent control heights everywhere: `formInputClass` is `h-11`, `DefinedOnSaleNotice` is `h-11`, `UnitInput` wraps an `h-11` `Input`, and every Combobox gets `formSelectClass` (`h-11`, which wins over the primitive's base `h-10` per `03:50`). Every money and numeric input carries `sales-ops-num` exactly like the existing ones.

### Section order

Numbers 0 to 11 apply to both kinds unless marked.

**0. Kind selector (both).**
A `SegmentedButton` pair `Produto | Serviço` at the top of the scroll body, above `Nome`, aria-labels `Classificar como produto` / `Classificar como serviço`.
Editable on an existing record so a mis-created row can be reclassified; harmless because sale items already snapshot their own name and área.
Below it, one amber note in the wizard's :4808 style (`border-[#f0dfae] bg-[#fdf0cf] px-[14px] py-[11px] text-[13px] text-[#57575f]`):
`Tudo aqui é padrão: dentro da proposta você pode alterar qualquer valor sem mexer no cadastro.`
That single sentence is item 8 made explicit, stated once rather than repeated per section.

**1. `Nome` (both).** Unchanged, `required`, `placeholder="Nome"`.

**2. Code-suffix strip (both).** Unchanged (:2713-2736).

**3. `Preço em aberto` toggle.**
Produto only, unchanged.
For Serviço the flag is implied `true` and the toggle is not rendered, because a Serviço's value is always variable (item 5). In its place one static line in the same amber style: `Serviços têm valor variável, definido em cada proposta.`
`submit()` sends `openPrice: form.kind === 'servico' ? true : form.openPrice`.

**4. `Área` + own value grid (both, `md:grid-cols-2`).**
- `Área`, required, the slice 06 Combobox, `aria-label="Área do produto"` preserved, `searchPlaceholder="Buscar área..."`, `entityLabel="área"`, `entityGender="f"`. Options are `selectableAreas` from :2628-2634, which already keeps an archived-but-current área selectable. `onCreate` is whatever slice 06 wired; this slice does not add or remove it.
- `Setup (R$)`: produto renders the numeric input when `!openPrice` and `DefinedOnSaleNotice` when `openPrice`; serviço always renders `DefinedOnSaleNotice`.

**5. `Possui mensalidade` card (both).**
The toggle stays for both kinds: it drives whether a proposta prefills a recurring block, and a retainer serviço needs it. It also **is** the product-level recurrence default, which the wizard already reads through its `recurringSource` guard at :3795-3807, so this slice does not add a second recurrence switch anywhere.
When on:
- `Valor da mensalidade (R$)`: produto renders the numeric input when `!openPrice`, `DefinedOnSaleNotice` otherwise; serviço always `DefinedOnSaleNotice`.
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
`Prestadores antigos deste cadastro agora são definidos por função: <nomes separados por vírgula>.`
This exists so retiring `providers` never silently loses a name the operator typed. It disappears once slice 07's replacement lands (`05:556`).

**11. Footer.** Unchanged.

Removed outright: the `Prestadores de serviço` `ListEditor` (:3007-3084) and `<datalist id="sales-ops-collaborators">` (:3085-3089). See below.

### 7. Default payment plan editor

Persisted shape, adopting slice 11's vocabulary verbatim (`11:113-119`, `11:218`) rather than inventing a parallel one:

```ts
export type ProductDefaultPaymentPlan = {
  /** Slice 11's PaymentPlanShape vocabulary. Note 'fixed', not 'fix'. */
  entradaMode: 'none' | 'pct' | 'fixed';
  /** Percent 0-100 when 'pct', integer CENTS when 'fixed', 0 when 'none'. */
  entradaValue: number;
  /** "Restante em N x". Integer >= 1. 1 means one remaining payment. */
  restanteCount: number;
  /** Default forma de pagamento seeded into every generated parcela row. */
  method: PaymentMethod;
  /**
   * Only meaningful when the product's hasMonthly is true (hasMonthly IS the
   * recurrence default). null means prazo indeterminado.
   */
  recurringCycles: number | null;
};
```

`SalesOpsProduct.defaultPaymentPlan?: ProductDefaultPaymentPlan | null`. `null` means no template at all.

Three deliberate decisions inside that shape:

- `anchorDate` is absent, exactly as slice 11 requires: it "is always the proposta base date, never a product property" (`11:218`). There are **no dates anywhere** in this object. It is a template. Asserted by a test.
- `recurringCycles` is the **only** recurrence field. It does not duplicate `monthlyBrl`, because `hasMonthly` + `monthlyBrl` already are the product's recurrence default and the wizard already seeds from them (:3795-3807). What was genuinely missing is the cycle count, so that is all this adds. Duplicating the mensalidade value here would create two sources of truth in one dialog.
- `method` extends slice 11's shape by one field. Slice 11's `generateInstallmentPlan` already takes `methods: PaymentMethod[]` positionally (`11:123-127`), so a product default seeds that array with no contract change. The human asked for "a default payment", which includes the forma.

Form state:

```ts
type DefaultPlanForm = {
  enabled: boolean;
  entradaMode: 'none' | 'pct' | 'fixed';
  entradaValue: string;   // percent when 'pct', reais when 'fixed'
  restanteCount: string;  // integer >= 1
  method: PaymentMethod;
  recurringCycles: string; // '' means prazo indeterminado
};
```

Controls, gated behind a `ReferenceToggle` labelled `Plano de pagamento padrão` with description `Entrada, parcelas e forma sugeridas na proposta`:

1. `Tipo de entrada` - Combobox, `aria-label="Tipo de entrada"`, options with labels `nenhuma`, `%`, `R$ fixo` and values `none`, `pct`, `fixed`, `w-[132px]`, `searchPlaceholder="Buscar tipo de entrada..."`. Identical label and options to slice 11's control (`11:69-70`).
2. `Valor da entrada` - `UnitInput`, `aria-label="Valor da entrada"`, unit `%` or `R$`, `sales-ops-num text-right`. Unmounted when the mode is `none`, matching `11:71`.
3. `Restante` - a numeric text input, `aria-label="Parcelas restantes"`, `w-[72px] text-center`, followed by a static `x`. Slice 11's label and geometry (`11:75`).
   **The label must be `Parcelas restantes`, not `Número de parcelas`**: slice 11 adds `not.toContain('Número de parcelas')` to the source-text contract test (`11:275`) and this slice runs first.
4. `Forma de pagamento padrão` - Combobox, `aria-label="Forma de pagamento padrão"`, `searchPlaceholder="Buscar forma de pagamento..."`, options `PIX`, `Cartão`, `Boleto`, `Transferência`. The label map at :1597-1602 is hoisted to a module-level `paymentMethodLabels` so those four pt-BR strings exist once.
5. `Número de ciclos` - rendered only when `form.hasMonthly` is true. A plain text input (no native number spinner), `aria-label="Número de ciclos"`, with the caption `Deixe em branco para prazo indeterminado`. Blank is the **only** expression of indefinite, exactly as slice 11 mandates (`11:82`, `11:86`).
   **No `Prazo indeterminado` checkbox.** Slice 11 deletes the wizard's copy, so adding one here would immediately be inconsistent, and this section would be the last user of a control the batch is removing.
6. Live summary strip in the wizard's green `#cfe4cf`/`#e2efe2` style, rendering `defaultPlanSummary`, for example `Entrada de 50% + 3x do restante · PIX`, plus ` · mensal por prazo indeterminado` or ` · mensal por 12 ciclos` when `hasMonthly`.
   Deliberately **not** shared with slice 11's hints: slice 11's `R$ 36.500,00` and `3 x R$ 12.166,66 (última R$ 12.166,68)` are derived from a proposta total, and a cadastro has no total. Sharing one function would force a fake total. Consistency comes from identical labels, options, geometry, palette and the blank-ciclos rule, which is what makes the two read as the same control.

Forbidden substrings this section must not contain, because slice 11 adds them as negative source-text guards and runs after this slice: `Dividir em`, `+ parcela`, `Número de parcelas`, `Remover parcela`, `Adicionar recorrência`.

### 8. Função cost defaults editor

Persisted shape:

```ts
export type ProductFuncaoCostDefault = {
  funcaoId: string;
  costType: CommissionType;  // 'pct' | 'fix'
  costValue: number;         // percent when 'pct', REAIS (2dp) when 'fix'
};
```

`costValue` mirrors the established product-level convention exactly: `sales_ops_products.seller_commission_value` and the `providers[].commissionValue` this replaces are both `numeric(10,2)` in reais (`schema.ts:478-493`, `service.ts:58-62`), and `formatProductCommission` (:1978) already formats that precise pair.
Parsing therefore uses `parseDecimal`, the helper the current providers editor already uses at :2667, and display uses `formatProductCommission`. Nothing is hand-rolled, and no second money convention appears inside one table.

`costType` stays `'pct' | 'fix'` (the repo's `CommissionType`) while the plan's `entradaMode` uses slice 11's `'fixed'`. That divergence is deliberate: `CommissionType` is the existing shared type behind four columns and `formatProductCommission`, and `entradaMode` is slice 11's payment-plan vocabulary. Unifying them would either break `CommissionType`'s four existing consumers or contradict slice 11. Stated here so nobody "fixes" it into a break.

Rendered through `ListEditor` with `title="Custos padrão por função"`, `subtitle="Quanto cada função custa neste item por padrão"`, `addLabel="Adicionar"`.
Each row reuses the providers row shell verbatim (`rounded-xl border border-[#ececf1] bg-[#fafafb] p-[11px]`, control plus trash on line one, unit toggle plus `UnitInput` on line two), so `ListEditor` stays the only repeating-row pattern in the file.

Row one: a Combobox, `aria-label="Função do custo padrão ${index + 1}"`, `searchPlaceholder="Buscar função..."`, `entityLabel="função"`, `entityGender="f"`, plus the existing red trash button with `aria-label="Remover custo padrão ${index + 1}"`.
Row two: the `% | R$` `UnitToggle` pair (`aria-label="Custo da função ${index + 1} em porcentagem"` / `... em reais`) and a `UnitInput` with `aria-label="Custo da função ${index + 1}"`.

Indexed aria-labels rather than name-interpolated ones: the current providers editor interpolates `provider.personName` into its aria-label (:3052), which makes the label unstable while typing and untestable before a name exists. Index labels are stable from the moment the row is added.

**Option set: active, non-system funções only.**
`funcoes.filter((funcao) => funcao.status === 'active' && !funcao.isSystem)`.
`vendedor` and `finder` are the two `isSystem` funções (`05:320-333`) and their cost is already the commission block in section 6, so offering them here would create two competing ways to pay a vendedor. `isSystem` exists precisely to make that distinction (`05:163-164`), so this uses it.
An org that had collaborators already has the non-system `Prestador` função seeded (`05:335-346`), so the common case is non-empty on day one.

Duplicate guard: a função already chosen is filtered out of the other rows' options, and `Adicionar` is disabled once every eligible função is used, `title="Todas as funções já têm custo padrão"`.

Empty case (no eligible funções): `ListEditor`'s `empty` prop renders
`Nenhuma função cadastrada ainda. Cadastre as funções em Cadastros > Funções para definir custos padrão.`
and `Adicionar` is disabled with the same string as its `title`.
The `Cadastros > X` phrasing matches the precedent already asserted at `apps/web/src/sales-ops/__tests__/sale-wizard-free-items.test.tsx:262`.

No `onCreate` on this Combobox. Creating a função needs `POST /funcoes` (admin-gated, `05:429`) plus a nested create flow inside a dialog that is already a form; slice 09 owns the funções cadastro. The empty-state message points there instead. Recorded in `## Out of scope`.

This section is not gated behind a toggle: it is the reason a Serviço exists, and its zero-row state is already a single dashed line. It renders for both kinds because a produto can also carry implementation cost.

### Fate of the `providers` datalist

Decision: delete the `Prestadores de serviço` editor and the `sales-ops-collaborators` datalist. `Custos padrão por função` supersedes them. `ProductDialog` drops `collaborators` and gains `funcoes`.

Why:

1. This is the batch's stated intent, not an invention. Slice 05's compatibility matrix says `sales_ops_products.providers` is "Untouched in 05. Slice 07 replaces it with per-função cost defaults; this slice only makes the funções available to it." (`05:556`).
2. `providers[].personName` is free text with no foreign key, so it is already a shadow people table. Keeping it beside first-class Pessoas and Funções is exactly the third overlapping people concept this slice is told not to leave behind. Slice 05 also folds the collaborator concept itself into funções: `isCollaborator` becomes "has at least one non-system função" (`05:253`), so the notion `providers` was built on no longer exists as a separate flag.
3. Its meaning ("this named person takes X% of this product") is a **cost default**, and a cadastro default should outlive any individual. Binding a concrete pessoa at cadastro level breaks the moment that person leaves; binding a função does not. The concrete pessoa is already chosen per proposta in the wizard's `Profissionais alocados` step (:4812), which stores a real `personId`.
4. Nothing downstream reads it. Verified: only `types.ts`, `productForm` (:2447), the dialog body, the submit payload (:2662), `ProductSchema` (:82) and the column default (`schema.ts:495`). No calculation, no payable, no report.

Data safety: `submit()` **omits** `providers` from the payload rather than sending `[]`. `PATCH /products/:id` parses with `ProductSchema.partial()` (`routes.ts:97`), so an omitted key leaves the column untouched and no existing row is destroyed by the first edit after this slice ships. `POST` gets the schema's `[]` default, which is correct for a new record. Until slice 07 completes the replacement, legacy names stay visible through section 10's notice.

## Test fallout

Every assertion below is broken by this slice and must be rewritten in the same commit.

1. `apps/web/src/sales-ops/__tests__/routing.test.tsx:257`
   `expectHeading('Produtos');` becomes `expectHeading('Produtos & Serviços');`
   (`:255` and `:440` assert only `pathname()` and stay as they are, because the route does not change.)

2. `apps/web/src/sales-ops/__tests__/product-commission-editor.test.tsx:84-98`, helper `renderDialog`
   `collaborators={[]}` becomes `funcoes={[]}`.

3. `apps/web/src/sales-ops/__tests__/product-commission-editor.test.tsx:222-243`, the reopen render inside `'preserves fixed type and value controls across switching, save, and reopen'`
   `collaborators={[]}` becomes `funcoes={[]}`.

4. `apps/web/src/sales-ops/__tests__/product-commission-editor.test.tsx:258-288`, `'shows seller-only and seller-with-finder scenarios separately in the product table'`
   The `<ProductsView …>` render gains `kind="produto"` and `onKindChange={vi.fn()}`.
   Its six text assertions (`Somente vendedor`, `Vendedor + Finder`, `10%`, `7% + 3%`, `R$ 1.000,00`, `R$ 700,00 + R$ 300,00`) all still hold: the fixtures resolve to `produto`, which keeps the original column set.

5. `apps/web/src/sales-ops/__tests__/product-commission-editor.test.tsx:146-150`, helper `chooseArea`
   Slice 06 has already converted `Área` to the Combobox and must have updated this helper. **Re-read it at Green time and reuse whatever interaction helper slice 06 left**; do not assume `<select>` and do not add a second helper. This mirrors slice 11's instruction for the same situation (`11:296-297`, `11:420-423`).

6. `apps/web/src/sales-ops/__tests__/areas-view.test.tsx:225-257`, `'requires an área before saving a product'`
   `collaborators={[]}` at `:233` becomes `funcoes={[]}`.
   The área interaction at `:249-251` follows the same rule as item 5.
   `:256` (`not.toHaveProperty('type')`) still holds.

7. `apps/web/src/sales-ops/__tests__/areas-view.test.tsx:259-284`, `'shows the área name instead of the legacy type in the products table'`
   The `<ProductsView …>` render gains `kind="produto"` and `onKindChange={vi.fn()}`.
   `toContain('Área')`, `toContain('FXL Tech')`, `not.toContain('Tipo')` and the `-` cell all still hold.

8. `apps/web/src/sales-ops/__tests__/sale-wizard-ui-contract.test.ts`
   No change required. None of its 24 substrings touch the product dialog, and this slice introduces none of its forbidden strings (`Nova venda`, `Salvar venda`, `Confirmar venda`, `Fechamento da venda`, `Salvar incompleto`, `Passo {wizardStep} de 3`).
   Deliberately **not** extended: the new copy is asserted through DOM queries in the two new test files, which is a strictly stronger oracle than a source-text substring.
   **But it constrains this slice negatively**: slice 11 will add `not.toContain('Dividir em' | '+ parcela' | 'Número de parcelas' | 'Remover parcela' | 'Adicionar recorrência')` (`11:272-277`) and runs after this slice, so none of those five substrings may appear in the new dialog code. Pinned by dialog test 17.

9. `apps/web/src/sales-ops/__tests__/navigation.test.ts:43-60`
   No change. It asserts `cadastros` **ids**, and only the `produtos` label changes; its label assertion at `:50-53` covers `operacional`, not `cadastros`.

10. `apps/web/src/sales-ops/__tests__/sale-wizard-free-items.test.tsx:262`
    No change. `'Defina a área deste produto em Cadastros > Produtos.'` refers to the Cadastros destination generically and stays accurate; the route is unchanged.

## Red

Two new files, following the `product-commission-editor.test.tsx` idiom exactly: `// @vitest-environment happy-dom` on line 1, `createRoot`, `React.act` through a cast, `vi.mock('@/components/ui/dialog')` into plain divs, hand-rolled `click` / `change` / `submit` helpers, DOM queried by `aria-label`.

**No Combobox mock.** Per `03:82-90` and `03:403` the primitive is inline and non-portalled, so it renders into `container` and every query is a plain `container.querySelector`. `vi.mock('@/components/ui/dialog')` stays, because the Radix dialog does portal.

Combobox interaction helper. At Green time, first re-read `product-commission-editor.test.tsx` and `areas-view.test.tsx` for the helper slice 06 left behind and reuse it. Only if slice 06 left none, add one local helper to each new file:

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

Fixtures. A local `product(patch)` factory copied from `product-commission-editor.test.tsx:40-65` and extended with `kind`, `defaultPaymentPlan` and `funcaoCostDefaults`. A `funcao(patch)` factory producing slice 05's shape: `{ id, orgId: 'org-test', name, slug, isSystem: false, status: 'active', createdAt, updatedAt: null }`.

### File 1: `apps/web/src/sales-ops/__tests__/produtos-servicos-view.test.tsx`

`describe('produtos e serviços view')`

1. `it('defaults to the produtos segment and shows the produto column set')`
   One produto and one serviço, `kind="produto"`. Headers contain `Setup`, `Mensalidade`, `Recorrente` and not `Plano padrão` or `Custos padrão`; only the produto row name is present.
2. `it('switching to the serviços segment reports the kind change to the parent')`
   Clicks `button[aria-label="Filtrar por serviços"]`; asserts `onKindChange` called with `'servico'`.
3. `it('renders the serviço column set with variável value, plano padrão and custos padrão')`
   `kind="servico"`. Headers contain `Valor`, `Plano padrão`, `Custos padrão` and not `Setup`, `Mensalidade`, `Recorrente`; the row text contains `Variável`, `50% + 3x` and `2 funções`.
4. `it('shows counts for both kinds regardless of the active segment')`
   Both segment buttons present, their text carrying the unfiltered counts.
5. `it('treats a product without an explicit kind as a produto')`
   A fixture with `kind` omitted is listed under `kind="produto"` and absent under `kind="servico"`.
6. `it('keeps the kind segments reachable from an empty bucket')`
   Only produtos while `kind="servico"`: text contains `Nenhum serviço cadastrado` **and** `button[aria-label="Filtrar por produtos"]` still exists. This is the behavioural fix over today's early `return`.
7. `it('summarises a plano padrão with no stored template as a dash')`
   Serviço with `defaultPaymentPlan: null`: a `-` cell exists in the `Plano padrão` column and the rendered text contains no `NaN`, `R$ NaN` or `undefined`.
8. `it('suffixes the plano padrão summary with mensal for a recurring serviço')`
   `hasMonthly: true` with `recurringCycles: null` renders ` + mensal`; the tooltip/summary never prints a date.

ORACLE: `CI=true pnpm --filter @fxl-sales/web exec vitest run src/sales-ops/__tests__/produtos-servicos-view.test.tsx`

### File 2: `apps/web/src/sales-ops/__tests__/product-service-dialog.test.tsx`

`describe('product and service dialog')`

1. `it('titles and describes the dialog from the selected kind')`
   Opens with `productKind: 'servico'`: the `h2` reads `Novo serviço` and the description mentions `custos por função`. Clicking `button[aria-label="Classificar como produto"]` makes the title `Novo produto`.
2. `it('replaces every own-value input with the definido na venda notice for a serviço')`
   Serviço with `Possui mensalidade` on: no numeric setup or monthly input exists, `Definido na venda` appears twice, and `Serviços têm valor variável, definido em cada proposta.` is present.
3. `it('keeps the own-value inputs for a produto and hides them only under preço em aberto')`
   Produto: the setup input is editable; toggling `Preço em aberto` replaces it with `Definido na venda`.
4. `it('states that every value here is only a default')`
   Text contains `Tudo aqui é padrão: dentro da proposta você pode alterar qualquer valor sem mexer no cadastro.` and the commission section header reads `Comissionamento padrão`.
5. `it('submits a default payment plan template with a percentage entrada, parcelas and forma')`
   Enables `Plano de pagamento padrão`, `chooseCombobox('Tipo de entrada', '%')`, `Valor da entrada` `50`, `Parcelas restantes` `3`, `chooseCombobox('Forma de pagamento padrão', 'Boleto')`, picks an área, submits.
   Asserts `onSave` received `defaultPaymentPlan: { entradaMode: 'pct', entradaValue: 50, restanteCount: 3, method: 'boleto', recurringCycles: null }`.
6. `it('submits a fixed entrada in integer cents')`
   Same flow with `R$ fixo` and `1.500,00`: `entradaMode: 'fixed'`, `entradaValue: 150000`. Pins the cents contract from `11:116` and the use of `parseCurrencyToCents`.
7. `it('omits the entrada value entirely when the mode is nenhuma')`
   `Tipo de entrada` `nenhuma`: no `input[aria-label="Valor da entrada"]` is mounted, and the submitted `entradaMode` is `'none'` with `entradaValue: 0`.
8. `it('treats a blank ciclos as prazo indeterminado and shows no checkbox')`
   `hasMonthly` on, `Número de ciclos` left blank: `recurringCycles` submits as `null`, the caption `Deixe em branco para prazo indeterminado` is present, and no button whose text is `Prazo indeterminado` exists.
9. `it('submits a bounded cycle count')`
   `Número de ciclos` `12`: `recurringCycles` submits as `12`.
10. `it('hides the ciclos field when the product has no mensalidade')`
    `hasMonthly` off: no `input[aria-label="Número de ciclos"]` is mounted.
11. `it('never puts a date in the default payment plan template')`
    With the plan enabled and `hasMonthly` on: `container.querySelectorAll('input[type="date"]').length` is `0`, and `JSON.stringify(submitted.defaultPaymentPlan)` matches no `/date/i` key.
12. `it('omits the default payment plan entirely when disabled')`
    `onSave` receives `defaultPaymentPlan: null`.
13. `it('saves função cost defaults as percentage and fixed rows')`
    With `Desenvolvedor` and `Testador`: row 1 `Desenvolvedor` / `%` / `5`, row 2 `Testador` / `R$` / `300`.
    Asserts `funcaoCostDefaults` equals `[{ funcaoId: dev.id, costType: 'pct', costValue: 5 }, { funcaoId: tester.id, costType: 'fix', costValue: 300 }]`. This is the human's exact example.
14. `it('never offers a system função as a cost default')`
    Passes a `vendedor` função with `isSystem: true` alongside `Desenvolvedor`; the row's Combobox lists only `Desenvolvedor`, and its panel text does not contain `Vendedor`.
15. `it('does not offer the same função twice')`
    After choosing `Desenvolvedor` in row 1, row 2's options exclude it, and `Adicionar` is disabled once every eligible função is used.
16. `it('explains where to register funções when none exist')`
    `funcoes={[]}`: text contains `Nenhuma função cadastrada ainda. Cadastre as funções em Cadastros > Funções para definir custos padrão.` and that section's `Adicionar` button is `disabled`.
17. `it('does not reintroduce any control the payment plan builder removes')`
    Renders the dialog with the plan enabled and asserts the rendered text contains none of `Dividir em`, `+ parcela`, `Número de parcelas`, `Remover parcela`, `Adicionar recorrência`. Guards slice 11's future negative source-text assertions from a slice that lands first.
18. `it('drops the free-text prestador picker and never writes providers')`
    `container.querySelector('datalist#sales-ops-collaborators')` is `null`, the text does not contain `Prestadores de serviço`, and `onSave.mock.calls[0][0]` does `not.toHaveProperty('providers')`.
19. `it('surfaces legacy prestador names inside the função cost section')`
    An existing product whose `providers` is `[{ personName: 'Ana', commissionType: 'pct', commissionValue: 5 }]`: text contains `Prestadores antigos deste cadastro agora são definidos por função: Ana.`
20. `it('renders módulos only for a produto and preserves them when reclassified')`
    An existing produto with one módulo shows `Módulos`; clicking `Classificar como serviço` hides it; submitting still sends that módulo.
21. `it('rehydrates a stored default plan and stored função costs when reopened')`
    An existing serviço carrying `defaultPaymentPlan` and two `funcaoCostDefaults`: `Tipo de entrada` reads `%`, `Valor da entrada` is `50`, `Parcelas restantes` is `3`, `Forma de pagamento padrão` reads `Boleto`, `Número de ciclos` is `''`, and both função rows are populated with the right unit toggle active (`className` contains `bg-[#201f24]`, matching the assertion idiom at `product-commission-editor.test.tsx:246`).
22. `it('keeps the commission editor working unchanged for a serviço')`
    Smoke-guards section 6 under the new kind: `Somente vendedor` / `Vendedor + Finder` pills switch, and `input[aria-label="Comissão do vendedor - somente vendedor"]` still reads `10`.

ORACLE: `CI=true pnpm --filter @fxl-sales/web exec vitest run src/sales-ops/__tests__/product-service-dialog.test.tsx`

### Regression oracles

```bash
CI=true pnpm --filter @fxl-sales/web exec vitest run src/sales-ops/__tests__/product-commission-editor.test.tsx
CI=true pnpm --filter @fxl-sales/web exec vitest run src/sales-ops/__tests__/areas-view.test.tsx
CI=true pnpm --filter @fxl-sales/web exec vitest run src/sales-ops/__tests__/routing.test.tsx
CI=true pnpm --filter @fxl-sales/web exec vitest run src/sales-ops/__tests__/sale-wizard-ui-contract.test.ts
```

Note on the oracle form: `pnpm --filter @fxl-sales/web test -- --run <path>` does **not** filter. pnpm swallows the positional argument and all 21 web test files run (122 tests instead of the handful under test). Always use `exec vitest run <path>` with the path relative to `apps/web`.

### Gate 2 full sweep

```bash
pnpm run lint
pnpm run type-check
CI=true pnpm test
pnpm run build
```

## Green

1. `apps/web/src/sales-ops/types.ts`: add `export type ProductKind = 'produto' | 'servico';` if slice 07 did not already, plus `ProductDefaultPaymentPlan` and `ProductFuncaoCostDefault` exactly as specified in `## Dialog design`.
   Add to `SalesOpsProduct`, each **optional** so no existing fixture or older API response breaks: `kind?: ProductKind` (skip if slice 07 added it), `defaultPaymentPlan?: ProductDefaultPaymentPlan | null`, `funcaoCostDefaults?: ProductFuncaoCostDefault[]`.
   Confirm `SalesOpsFuncao` and `SalesOpsBootstrap.funcoes` already exist from slice 09; add them in slice 05's exact shape (`{ id, orgId, name, slug, isSystem, status, createdAt, updatedAt }`) only if absent, together with the matching `funcoes: Array.isArray(data.funcoes) ? data.funcoes : []` line in the `hooks.ts` `select` normalizer.
2. `apps/web/src/sales-ops/api.ts`: no edit needed (`SaveProductPayload` derives from `Partial<SalesOpsProduct>`). Verify `providers` is optional so omitting it type-checks.
3. `apps/web/src/sales-ops/navigation.ts:59`: label `'Produtos'` becomes `'Produtos & Serviços'`.
4. `SalesOpsApp.tsx` `titleForView` `produtos` entry (:197-200): title `'Produtos & Serviços'`, subtitle `'Catálogo, valores, custos por função e padrões de proposta'`.
5. `SalesOpsApp.tsx` `ModalState` (:162): product variant gains `productKind?: ProductKind`.
6. `SalesOpsApp.tsx`: hoist `paymentMethodLabels: Record<PaymentMethod, string>` to module scope next to `statusMeta` (:226) and point the sale-detail local at :1597-1602 at it.
7. `SalesOpsApp.tsx`: rename `CommissionModeButton` (:2498) to `SegmentedButton`, add optional `count?: number` (rendered as a `ml-1.5 rounded-md bg-[#e9e9ed] px-1.5 text-[11px] font-bold` pill), optional `ariaLabel`, and `aria-pressed={active}`. Update the two call sites at :2840 and :2846.
8. `SalesOpsApp.tsx`: extract `ListEditor`'s header block (:3131-3147) into `DialogSection({ title, subtitle, action, children })` and reimplement `ListEditor` on top of it. No visual change.
9. `SalesOpsApp.tsx`: add helpers next to `formatProductCommission` (:1978) - `productKind(product): ProductKind` (only if slice 08 left no serviço predicate to reuse) and `defaultPlanSummary(product): string`.
10. `SalesOpsApp.tsx` `ProductsView` (:1991): props become `{ areas, products, kind, onKindChange, onEdit }`.
    Render the `panelClass` card unconditionally; inside it a segmented bar with two `SegmentedButton`s (`Produtos` / `Serviços`, counts from the unfiltered array, aria-labels `Filtrar por produtos` / `Filtrar por serviços`); below it either the kind-filtered table or the kind-aware `EmptyPanel`.
    Split the header and cell renderers per kind as specified, keeping every produto header string and cell expression byte-identical to today's.
11. `SalesOpsApp.tsx` `SalesOpsApp`: add `const [productKind, setProductKind] = useState<ProductKind>('produto')`; wire `runHeaderAction` (:598) to `setModal({ kind: 'product', productKind })`; wire `headerAction` (:624) to the kind-aware label; pass `kind={productKind}` and `onKindChange={setProductKind}` at the `ProductsView` call site (:1067-1071); replace `collaborators={…}` with `funcoes={bootstrap.funcoes ?? []}` at the `ProductDialog` call site (:1101).
12. `SalesOpsApp.tsx` `ProductForm` (:2403): add `kind: ProductKind`, `plan: DefaultPlanForm`, `funcaoCosts: FuncaoCostForm[]`. Drop the `providers` key; the legacy notice reads `modal.product?.providers` directly.
13. `SalesOpsApp.tsx` `productForm` (:2422): signature becomes `productForm(product?: SalesOpsProduct, kindHint?: ProductKind)`.
    Seed `kind: product?.kind ?? kindHint ?? 'produto'`; seed `plan` from `product?.defaultPaymentPlan` (`enabled` from whether the object exists, percent via `pctToInput`, `'fixed'` money via `centsToInput`, `restanteCount` via `String`, `recurringCycles: null` to `''`); seed `funcaoCosts` from `product?.funcaoCostDefaults ?? []` mapping `costValue` through `String(...)` exactly as the providers seed did at :2450.
14. `SalesOpsApp.tsx` `ProductDialog` (:2583): swap `collaborators: SalesOpsPerson[]` for `funcoes: SalesOpsFuncao[]`; extend the remount key to `key={props.modal.product?.id ?? \`new-${props.modal.productKind ?? 'produto'}\`}` so opening `Novo serviço` straight after `Novo produto` reseeds the form.
15. `SalesOpsApp.tsx` `ProductDialogBody` (:2605): implement sections 0 to 11 in order using only `DialogSection`, `SegmentedButton`, `ReferenceToggle`, `UnitToggle`, `UnitInput`, `DefinedOnSaleNotice`, `ListEditor` and `Combobox`. Bump `max-w-[560px]` to `max-w-[640px]` at :2677. Every Combobox gets `className={formSelectClass}` (or whatever slice 06 standardised on), an explicit `searchPlaceholder`, and `entityGender` where the noun is feminine.
16. `SalesOpsApp.tsx`: delete the `Prestadores de serviço` `ListEditor` (:3007-3084) and the `<datalist>` (:3085-3089).
17. `SalesOpsApp.tsx` `submit()` (:2636): add `kind: form.kind`; resolve `openPrice` first as `form.kind === 'servico' ? true : form.openPrice` so the existing zeroing expressions at :2645 and :2647 read the resolved value; build `defaultPaymentPlan` (`null` when disabled; `entradaValue` via `parseCurrencyToCents` for `'fixed'` and `parseDecimal` for `'pct'` and `0` for `'none'`; `restanteCount` via `Math.max(1, Math.floor(parseDecimal(...)))`; `recurringCycles` `null` when `!form.hasMonthly` or the field is blank, else the parsed integer); build `funcaoCostDefaults` from rows with a non-empty `funcaoId` using `parseDecimal(row.costValue, 0)`; **remove** the `providers` key from the payload object entirely.
18. Apply every rewrite in `## Test fallout`, re-reading the slice 06 combobox helper first (items 5 and 6).
19. Write the two new test files from `## Red`.
20. Run every ORACLE and the Gate 2 sweep. Land as one commit: `feat(sales-ops): rename produtos to produtos & serviços with kind-aware list and default config`.

## Refactor

- `SegmentedButton` and `DialogSection` are net reductions: they collapse two near-duplicate markup blobs (the commission pills and the `ListEditor` header) into one each, so the new sections cannot drift from the existing ones.
- `paymentMethodLabels` hoisted to module scope removes the second copy of the four pt-BR method strings.
- No `IndefiniteCheckbox` extraction. Slice 11 deletes the wizard's `Prazo indeterminado` checkbox outright (`11:86`, `11:393`), so extracting it would create a shared component with exactly one caller and then zero.
- No shared plan-summary function with slice 11. Its hints are derived from a proposta total (`11:72`, `11:76`) and a cadastro has no total; sharing would force a fake total. Consistency is enforced through identical labels, option sets, geometry, palette and the blank-ciclos rule instead.
- `formatProductCommission` (:1978) gains a second consumer (the serviço `Custos padrão` tooltip), which is why the `pct`/`fix` reais pair was reused for `costValue` rather than inventing a cents field.
- `SalesOpsApp.tsx` grows. It is already 5207 lines and this slice pushes it well past that. Extracting `ProductsView` plus the product dialog into `apps/web/src/sales-ops/products/` would be right, but it would balloon the diff of an already large slice and make the test fallout unreadable against the anchors above, and slice 11 is about to rewrite 240 lines of the same file. Recorded as a follow-up, deliberately not done here.

## Out of scope

- Any API, schema, migration or Zod change. Slice 07 owns `kind`, the default-plan and função-cost storage, and the `providers` replacement (`05:556`).
- Reading these defaults inside the proposta wizard and overriding them per proposta. Slice 12.
- Building the wizard's payment-plan builder, `PaymentPlanShape`, `generateInstallmentPlan`, `inferPaymentPlanShape` or `defaultPlanShapeForProduct`, and any edit to `apps/web/src/sales-ops/calculations.ts`. Slice 11 owns that file; this slice only defines the persisted template it will read.
- Rewriting `addMonthsToIsoDate` to clamp month ends. Slice 11 (`11:379`).
- Creating the `Combobox` primitive (slice 03) or sweeping the remaining `NativeSelect` call sites and native number spinners (slice 06). This slice converts only the pickers it renders.
- An `onCreate` create-new-função row on the função picker. Creating a função is admin-gated `POST /funcoes` (`05:429`) and slice 09 owns the funções cadastro; the empty-state message points there.
- Fixing the dead `bg-popover` / `text-popover-foreground` classes at `select.tsx:78` and `dropdown-menu.tsx:48,72`, which emit no CSS because `popover` is defined in neither `apps/web/tailwind.config.ts` nor `apps/web/src/index.css`. Slice 06 owns the fix (`03:397`). This slice must not use `bg-popover` anywhere.
- Creating `cadastros/funcoes` or `cadastros/pessoas`. Slices 05 and 09. This slice only consumes `bootstrap.funcoes`.
- Dropping the legacy `SalesOpsProduct.type` field.
- Changing the route path, the `AppRole` visibility rules, the propostas status machine, the payables materialization rules, or the `"N/M"` / `"MN/M"` receivable labels.
- i18n extraction. pt-BR strings stay inline.

## Risks

1. **Slice 07 still has no plan file**, so there is no written `## Default config shape` or `## API contract` to consume. This plan therefore **defines** both, using slice 11's `PaymentPlanShape` vocabulary for the plan (`11:113-119`, `11:218`) and the existing `numeric(10,2)` reais convention for costs, so the definitions are anchored in the repo and in a written sibling plan rather than invented.
   Mitigation: every new field is optional on `SalesOpsProduct`, `SaveProductPayload` derives from it automatically, and `PATCH /products/:id` uses `ProductSchema.partial()`, so a web bundle newer than the API degrades to ignoring extra keys rather than 400-ing. If slice 07 landed a different shape, the only edits are step 1, the `productForm` seed in step 13 and the `submit()` build in step 17, all pinned by dialog tests 5 to 13 and 21.
2. **Slice 11 lands after this slice and will assert negative source-text guards** on `SalesOpsApp.tsx` (`11:272-277`). Introducing `Dividir em`, `+ parcela`, `Número de parcelas`, `Remover parcela` or `Adicionar recorrência` in the new dialog would red-line slice 11 later. Avoided by using slice 11's own labels (`Tipo de entrada`, `Valor da entrada`, `Parcelas restantes`, `Número de ciclos`) and pinned by dialog test 17.
3. **Vocabulary drift between the cadastro template and the wizard builder.** Avoided by adopting slice 11's field names and value semantics exactly (`entradaMode: 'none' | 'pct' | 'fixed'`, `entradaValue` as percent-or-cents, `restanteCount`, blank ciclos means indefinite) and by omitting `anchorDate` because "it is always the proposta base date, never a product property" (`11:218`). Slice 11's `defaultPlanShapeForProduct` then maps `product.defaultPaymentPlan` to a `PaymentPlanShape` by taking three fields and adding `anchorDate: baseDate`, which is exactly the seam it reserved.
4. **Two spellings of "fixed" in one dialog** (`entradaMode: 'fixed'` versus `costType: 'fix'`). Deliberate and documented in `## Dialog design`: `CommissionType` is the repo's existing type behind four columns and `formatProductCommission`, and `entradaMode` is slice 11's. Unifying would break one of them. Pinned by dialog tests 6 and 13 asserting both literals.
5. **Slice 06 changes the picker DOM under the existing tests.** `chooseArea` at `product-commission-editor.test.tsx:146-150` and the área interaction at `areas-view.test.tsx:249-251` stop matching a `<select>` once slice 06 lands. Mitigation: slice 06 is wave 2 and lands first, and Green step 18 requires re-reading those helpers and reusing whatever slice 06 left rather than inventing a second one. This is the same instruction slice 11 gives itself (`11:296-297`).
6. **The five existing commission oracles are load-bearing and easy to break.** Mitigation: section 6 changes only the section header and adds a subtitle. Every pill label, every `aria-label`, and the independent `seller_only` / `with_finder` state machine are byte-identical; all five assertions plus dialog test 22 are re-run.
7. **Retiring `providers` could destroy operator data.** Mitigation: the payload **omits** the key instead of sending `[]`, and PATCH parses with `ProductSchema.partial()`, so the column is untouched by an edit. Dialog test 18 pins the omission and test 19 pins that legacy names stay on screen until slice 07 completes the replacement.
8. **`ProductsView` gaining two required props breaks two existing render sites at type-check time.** Mitigation: enumerated as fallout items 4 and 7, each a two-line change, with `pnpm run type-check` in the sweep catching any missed site.
9. **The função picker could offer `vendedor` or `finder`, creating two ways to pay a vendedor.** Avoided by filtering on `!funcao.isSystem`, which is exactly what slice 05 added `isSystem` for (`05:163-164`), and pinned by dialog test 14.
10. **Mixed units in `costValue` (percent versus reais in one number).** Not a new footgun: it is the convention `sales_ops_products` already uses for all four commission value columns and for the `providers` rows this replaces, and `formatProductCommission` already reads that pair. A cents field only here would put two money conventions in one table. Pinned by dialog tests 13 and 21.
11. **The dialog could still feel heavy.** Mitigation: the plan section collapses to a single switch row when disabled, section headers use one recipe, every control is `h-11`, labels are 12px `#8b8b92` semibold via `Field` (:401) or 11px uppercase `#9b9ba3` via `DialogSection`, and the width goes to 640 so the two-column grids breathe. The next lever, if a reviewer still finds it long, is collapsing `Comissionamento padrão` behind a summary row, a copy-and-toggle change with no contract impact.
12. **Slice size.** This slice **can** land atomically: it is one screen plus one dialog plus one nav label, and the five test files it touches are all rewritten from the same anchors, so splitting would leave a half-renamed screen on trunk. If the orchestrator disagrees, the exact split is:
    - `10a-produtos-servicos-shell`: Green steps 1 to 11, plus step 12's `kind` field only, plus fallout items 1, 4, 6, 7, plus test file 1 and dialog tests 1, 2, 3, 20, 22. Boundary: `navigation.ts`, `types.ts`, `titleForView`, `ModalState`, `runHeaderAction`, `headerAction`, `ProductsView`, and only the kind-gating of the existing dialog inputs.
    - `10b-produtos-servicos-defaults`: Green steps 12 (plan and funcaoCosts fields) to 17, plus fallout items 2, 3, 5, plus dialog tests 4 to 19 and 21. Boundary: only `ProductDialogBody`, `ProductForm`, `productForm`, `submit()`, and the `funcoes` prop swap.
    Both halves are independently green and neither leaves user-visible half-work. `10b` must still land before slice 11 so risk 2 stays covered.
