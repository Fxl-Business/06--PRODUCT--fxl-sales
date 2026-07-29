---
id: 06-combobox-adoption
milestone: v2.3.0
status: todo
depends_on: [01-query-cache-refresh, 03-combobox-primitive]
files_modified: [CLAUDE.md, apps/web/eslint.config.js, apps/web/src/index.css, apps/web/src/components/ui/select.tsx, apps/web/src/components/ui/dropdown-menu.tsx, apps/web/src/sales-ops/SalesOpsApp.tsx, apps/web/src/auth/react.tsx, apps/web/src/admin/products/ProductDialog.tsx, apps/web/src/finder/links/LinkGeneratorForm.tsx, apps/web/src/sales-ops/__tests__/combobox-adoption.test.tsx, apps/web/src/sales-ops/__tests__/areas-view.test.tsx, apps/web/src/sales-ops/__tests__/product-commission-editor.test.tsx, apps/web/src/sales-ops/__tests__/sale-wizard-free-items.test.tsx, apps/web/src/sales-ops/__tests__/sale-wizard-custom-item-labels.test.tsx, apps/web/src/sales-ops/__tests__/sale-wizard-payment-plan.test.tsx, apps/web/src/sales-ops/__tests__/sale-wizard-edit.test.tsx, apps/web/src/sales-ops/__tests__/sale-wizard-commission-defaults.test.tsx, apps/web/src/sales-ops/__tests__/sale-wizard-state-preservation.test.tsx, apps/web/src/sales-ops/__tests__/sale-wizard-ui-contract.test.ts, apps/web/src/sales-ops/__tests__/routing.test.tsx, apps/web/src/auth/__tests__/react.test.tsx]
acceptance: "given the Nova proposta wizard with clientes SegPro and produtos FXL Finance / FXL Advisor, when the operator opens the Cliente picker and types \"Dias Pet\" (matching nothing), then no native <select> or <datalist> exists anywhere in apps/web/src, a single row reading exactly `+ Criar novo cliente \"Dias Pet\"` is offered, clicking it creates the cliente through POST /sales-ops/clients and selects it, typing \"Advis\" into the Produto / serviço picker narrows it to one row that ArrowDown plus Enter selects, and every picker renders at the same height, font size and border radius as the Input beside it on the same row"
---

# 06 - Adopt the Combobox everywhere and delete every native picker

## Goal

Make "no browser-native picker, ever" a real and enforced rule of this codebase by swapping every picker-shaped control in `apps/web/src` onto the `Combobox` primitive from slice 03, deleting the local `NativeSelect` wrapper and both `<datalist>` typeaheads so exactly one searchable-picker implementation survives, killing the OS number spinners with the app's own numeric input styling, and adding the explicit `+ Criar novo <entidade> "<texto>"` affordance to the three pickers where creating inline is meaningful (cliente, produto/serviço, área).
The slice also closes two adjacent defects on this exact surface that it would otherwise be shipping on top of: `NativeSelect` composes its classes with a template string instead of `cn`, so picker heights, font sizes and border radii are wrong wherever a picker sits beside an `Input`, and the dead `bg-popover` / `text-popover-foreground` classes leave the existing `Select` and `DropdownMenu` panels with no background at all.
A third defect that would have blocked the inline-create affordances, the `SaleWizardDialog` remount key at `apps/web/src/sales-ops/SalesOpsApp.tsx:3644`, is **already fixed by slice 01** and is inherited here rather than re-patched.

## Current state

Every anchor below was read at plan time on `master` at `b60fd2f`.

### Native `<select>` - 2 raw elements, 17 call sites

| Anchor | Kind | What it picks | Notes |
| --- | --- | --- | --- |
| `apps/web/src/sales-ops/SalesOpsApp.tsx:437` | native-select | - | The `<select>` inside the local `NativeSelect` wrapper, `:421-448`. Class string `'h-10 rounded-md border border-[#dcdce2] bg-[#fafafb] px-3 text-sm font-medium text-[#201f24] outline-none transition focus:border-[#eaa81a] disabled:cursor-not-allowed disabled:opacity-60'`. API `{ value, onChange, children, className?, disabled?, 'aria-label'? }`. |
| `apps/web/src/sales-ops/SalesOpsApp.tsx:957` | native-select | Filtro de status das propostas | `aria-label="Filtrar por status"`, 6 fixed options. |
| `apps/web/src/sales-ops/SalesOpsApp.tsx:975` | native-select | Filtro de área das propostas | `aria-label="Filtrar por área"`, `bootstrap.areas` plus `Todas as áreas`. |
| `apps/web/src/sales-ops/SalesOpsApp.tsx:1003` | native-select | Nothing | Inert. `onChange={() => undefined} value="all"`, single option `Todos os status`. Comissões filter bar. |
| `apps/web/src/sales-ops/SalesOpsApp.tsx:1006` | native-select | Nothing | Inert. `onChange={() => undefined} value="all"`, single option `Todos os responsáveis`. |
| `apps/web/src/sales-ops/SalesOpsApp.tsx:2319` | native-select | Moeda | `SettingsView`, 2 options, no `aria-label`. |
| `apps/web/src/sales-ops/SalesOpsApp.tsx:2329` | native-select | Regime tributário | `SettingsView`, 3 options, no `aria-label`. |
| `apps/web/src/sales-ops/SalesOpsApp.tsx:2381` | native-select | Idioma | `SettingsView`, 2 options, no `aria-label`. |
| `apps/web/src/sales-ops/SalesOpsApp.tsx:2750` | native-select | Área do produto | `ProductDialogBody`. `aria-label="Área do produto"`, `className={`${formSelectClass} w-full`}`, wrapped in `<div className="relative">` with a hand-placed `<ChevronDown>` at `:2765`. |
| `apps/web/src/sales-ops/SalesOpsApp.tsx:2971` | native-select | Tipo do módulo | `ProductDialogBody`, 5 fixed strings `Módulo / Upsell / Downsell / Cross-sell / Add-on`, no `aria-label`. |
| `apps/web/src/sales-ops/SalesOpsApp.tsx:3348` | native-select | Status da área | `AreaDialogBody`, `aria-label="Status da área"`, 2 options. |
| `apps/web/src/sales-ops/SalesOpsApp.tsx:3446` | native-select | Status da pessoa | `PersonDialogBody`, 2 options, no `aria-label`. |
| `apps/web/src/sales-ops/SalesOpsApp.tsx:4221` | native-select | Vendedor da proposta | Wizard step 1, `sellers`, no `aria-label`. |
| `apps/web/src/sales-ops/SalesOpsApp.tsx:4246` | native-select | Finder da proposta | Wizard step 1, `finders`, no `aria-label`, `disabled={sellerIsFinder}`. |
| `apps/web/src/sales-ops/SalesOpsApp.tsx:4350` | native-select | Área de um item avulso | Wizard step 1, `aria-label={`Área do item ${index + 1}`}`, `activeAreas`. |
| `apps/web/src/sales-ops/SalesOpsApp.tsx:4440` | native-select | Produto / serviço de um item | Wizard step 1, `aria-label={`Produto / serviço do item ${index + 1}`}`, `bootstrap.products`. |
| `apps/web/src/sales-ops/SalesOpsApp.tsx:4655` | native-select | Forma de pagamento da parcela | Wizard step 2, `aria-label={`Forma de pagamento da parcela ${index + 1}`}`, 4 fixed options. |
| `apps/web/src/sales-ops/SalesOpsApp.tsx:4850` | native-select | Profissional alocado | Wizard step 3, `collaborators` plus a `<option value="">Digite manualmente</option>` escape hatch that in practice clears `personName` and offers no field to type into. No `aria-label`. |
| `apps/web/src/auth/react.tsx:235` | native-select | Workspace ativo | `HubUserControls`, rendered by `apps/web/src/components/layout/TopBar.tsx:10`, only when `workspaces.length > 1`. `aria-label="Workspace"`, uncontrolled (`defaultValue`). Option text is `{workspace.name ?? workspace.id}`, which **renders a raw Hub workspace id** and violates the CLAUDE.md "UI Identifiers" rule. |

### Bespoke typeahead - 2 `<datalist>` pairs

| Anchor | Kind | Behaviour today |
| --- | --- | --- |
| `apps/web/src/sales-ops/SalesOpsApp.tsx:4197-4218` | bespoke-typeahead | The Cliente field. A shadcn `Input` with `list="sales-ops-client-options"`, placeholder `"Buscar ou digitar um novo cliente..."`, a decorative lucide `Search` icon at `:4210`, and a `<datalist>` of `client.name` at `:4211-4215`. `onChange` does `bootstrap.clients.find(c => c.name === value)` on **exact string equality**, sets `clientName` unconditionally and `clientId` to the match or `''`. |
| `apps/web/src/sales-ops/SalesOpsApp.tsx:3026-3036` + `:3085-3089` | bespoke-typeahead | The prestador name field in `ProductDialogBody`. `Input list="sales-ops-collaborators"` over `collaborators[].displayName`, free text allowed, stored as `providers[i].personName` (a name snapshot, not an id). |

**Verified net effect of the Cliente field, correcting the context pack.** The API does **not** create a cliente on sale save. `apps/api/src/domains/sales-ops/service.ts:411-412` writes `clientId: input.clientId` and `clientNameSnapshot: input.clientName` and nothing else; the only insert into `salesOpsClients` is `service.ts:742`, reached solely by `POST /api/v1/sales-ops/clients` (`routes.ts:115-121`). So typing an unknown name today produces a proposta with a dangling `clientNameSnapshot` and `clientId = null`, and no row ever appears in `cadastros/clientes`. Preserving "the net effect" therefore means: the operator can still commit a name that is not in the list, and the proposta still saves. The create row is a strict improvement on top, not a replacement.

### shadcn `Select` (Radix) - 6 call sites in 3 files, none in sales-ops

| Anchor | Kind | What it picks |
| --- | --- | --- |
| `apps/web/src/admin/products/ProductDialog.tsx:103` | shadcn-Select | App (data-driven, `apps ?? []`) |
| `apps/web/src/admin/products/ProductDialog.tsx:136` | shadcn-Select | Product status (closed enum, 2 options) |
| `apps/web/src/admin/products/CommissionRuleForm.tsx:94` | shadcn-Select | Commission basis (closed enum, 2 options) |
| `apps/web/src/finder/links/LinkGeneratorForm.tsx:93` | shadcn-Select | App (data-driven) |
| `apps/web/src/finder/links/LinkGeneratorForm.tsx:115` | shadcn-Select | Product (data-driven, grows with the catalog) |

### Native number spinner - 19 occurrences, all through `<Input type="number">`

`apps/web/src/sales-ops/SalesOpsApp.tsx:2276`, `:2285`, `:2314`, `:2344`, `:2565` (inside `UnitInput`, `:2545-2573`), `:2775`, `:2807`, `:2998`, `:4467`, `:4579`, `:4747`.
`apps/web/src/admin/products/CommissionRuleForm.tsx:62`, `:74`, `:86`.
`apps/web/src/admin/products/PriceBandForm.tsx:69`, `:80`, `:91`.
`apps/web/src/admin/apps/AppDialog.tsx:121`, `:131`.

Every one routes through `apps/web/src/components/ui/input.tsx:4-16`, so one styling fix reaches all 19. There is currently **no** spinner suppression anywhere: `apps/web/src/index.css` has no `::-webkit-inner-spin-button` or `appearance` rule (the only sales-ops rules are `:65-92`).
`apps/web/src/sales-ops/SalesOpsApp.tsx:2724-2734` is a raw `<input type="text" inputMode="numeric">`, not a spinner, and stays as is.

### `NativeSelect` never runs tailwind-merge, so picker geometry is wrong today

Verified: `apps/web/src/sales-ops/SalesOpsApp.tsx:439` composes its class with a **template string**, `` `h-10 rounded-md border border-[#dcdce2] bg-[#fafafb] px-3 text-sm ... ${className}` ``, not with `cn` (`apps/web/src/lib/utils.ts:4-6`, `twMerge(clsx(...))`). `Input` (`input.tsx:9-12`) does use `cn`. Two concrete consequences:

- The base `h-10 rounded-md` is never removed from a `NativeSelect`, so which height actually applies is decided by Tailwind's CSS output order rather than by the call site's intent. At the four wizard sites that pass `h-10 rounded-[9px] text-[13.5px]` (`:4352`, `:4442`, `:4657`, `:4851`) that resolves to **40px**, while the `Input`s on the same grid row resolve through `cn` plus `formInputClass` to **44px**. A single Itens row therefore renders three font sizes (13.5 / 14 / 13.5px) and three border radii (8 / 9 / 10px).
- The `h-10 rounded-[9px]` prefixes on the sibling `Input`s at `:4367` and `:4474` are dead classes: `twMerge` discards them in favour of `formInputClass`'s `h-11 rounded-[10px]`, which is why the mismatch is one-sided and easy to miss.

Slice 04 (`itens-section-align`) deliberately scoped the `NativeSelect` fix out, because touching that shared wrapper would move `:2752` and `:2972` app-wide while slice 04 is layout-only inside the Itens section; it standardises the Itens rows on the already-proven in-file convention `h-11 rounded-[10px]` (from `:4222`, `:4247`) locally, and consolidates the five-column grid template that is currently hand-written six times (`:4333`, `:4349`, `:4388`, `:4438`, `:4496`, `:4537`) into one module-level `saleItemGridClass` constant. This slice **deletes** `NativeSelect`, so it is the slice that gets to make picker geometry correct app-wide, and it must not undo slice 04's grid consolidation while doing so.

### Out of scope by batch decision, listed so nobody re-derives it

`<input type="date">` at `apps/web/src/sales-ops/SalesOpsApp.tsx:4298`, `:4633`, `:4736`. The overview's "Deliberately excluded" section keeps them.

### The wizard remount key is already fixed upstream - inherited, not re-patched

The precondition that makes every inline-create affordance in this slice safe is owned by **slice 01 (`01-query-cache-refresh`)**, wave 1, which lands before this slice. On `master` today, `apps/web/src/sales-ops/SalesOpsApp.tsx:3644` reads:

```
key={`${props.editSale?.id ?? 'create'}-${props.bootstrap.clients[0]?.id ?? 'no-client'}-${props.bootstrap.products[0]?.id ?? 'no-product'}-${props.bootstrap.people.length}`}
```

Clientes and produtos come back name-ordered (`apps/api/src/domains/sales-ops/service.ts:730`, `:1316`), so creating a cliente that sorts before the current first row changes `clients[0].id`, changes the `key`, and React throws away the whole wizard subtree: cliente, itens, plano, custos, current step. Slice 01 root-caused this as the second half of the item-1 cache-refresh problem (any bootstrap refetch that reorders those lists destroys in-progress wizard state) and fixes it at `nexo/plans/batch-01K9C0FXA7RQ8VZTN3KDM6WS4E/01-query-cache-refresh.md`, step 5.1: the key is reduced to the wizard session identity, `key={props.editSale?.id ?? 'create'}`, and the wizard is only mounted once `bootstrapQuery.isSuccess`. Slice 01 also ships the two guards in `apps/web/src/sales-ops/__tests__/sale-wizard-state-preservation.test.tsx`.

**Therefore this slice must not touch line 3644.** By the time it runs the key is already the session identity and the inline cliente and área creates are safe by inheritance. Two slices patching the same line on a 5,207-line file is a guaranteed merge conflict, and whichever landed second would look like a no-op while silently deleting the other's guard. The executor's only obligation here is to confirm, before starting, that the line is already reduced; if it is not, slice 01 has not landed and this slice is not ready to run.

### Two adjacent defects this slice does own

1. **`NativeSelect` never runs tailwind-merge.** Detailed above, under "`NativeSelect` never runs tailwind-merge, so picker geometry is wrong today". This slice deletes the wrapper, so it is the slice that gets to fix it.
2. **Dead popover tokens.** `apps/web/src/components/ui/select.tsx:78` and `apps/web/src/components/ui/dropdown-menu.tsx:48,72` use `bg-popover text-popover-foreground`. Verified: `popover` is absent from `theme.extend.colors` in `apps/web/tailwind.config.ts` (only `border, input, ring, background, foreground, primary, secondary, muted, accent, destructive, card`) and `--popover` is absent from `apps/web/src/index.css:8-55`. Both utilities emit zero CSS, so those panels have no background. The two sales-ops `DropdownMenuContent` call sites (`SalesOpsApp.tsx:876-878`, `:1499-1501`) pass their own `bg-white` and are unaffected; the visible sufferers are the `Select` panels in the admin and finder trees.

### The `Combobox` contract this slice consumes

Locked by `nexo/plans/batch-01K9C0FXA7RQ8VZTN3KDM6WS4E/03-combobox-primitive.md`, section "Component API". The parts this slice uses:

- `Combobox` from `@/components/ui/combobox`, `ComboboxOption` from the same module: `{ value, label, description?, group? }`.
- Props used here: `options`, `value` (`string | null`), `onChange(value)`, `onCreate?(trimmedQuery)`, `entityLabel`, `entityGender` (`'m' | 'f'`), `placeholder`, `valueLabel`, `searchPlaceholder`, `emptyMessage`, `disabled`, `className` (merged onto the trigger through `cn`, so `formSelectClass` wins over the base), `aria-label`.
- DOM the tests drive: trigger is `<button type="button" role="combobox" aria-expanded aria-haspopup="listbox">` carrying the passed `aria-label`; the panel is **inline and non-portalled** inside the component's own `relative` wrapper; the search field is the panel's only `input[type="text"]`; option rows are `<div role="option">` (deliberately not buttons, so no existing `buttonByText` helper can collide with them); the create row is `<div role="option" data-combobox-create="true">` pinned in a footer outside the scroll area, styled `bg-[#fdf7e8] text-[#9c7210]` with active `bg-[#f4efe2]`.
- `onCreate` does **not** mutate `value`. The caller decides. `valueLabel` is how a caller shows a value that is not in `options`.
- Escape inside the panel calls `preventDefault` + `stopPropagation` + `stopImmediatePropagation`, so it closes the combobox without closing the surrounding Radix `Dialog`. Enter always `preventDefault`s, so no surrounding `<form>` submits.

## Migration table

**The rule applied, once, everywhere.** `apps/web/src` contains no browser-native picker markup: no `<select>`, no `<option>`, no `<datalist>`, no OS number spin buttons. Inside the product surface (`src/sales-ops/**`, plus the workspace switcher in `src/auth/react.tsx`) every single-select control is `Combobox` with **no exceptions**, including short closed enums. Two reasons the short enums convert too rather than falling back to shadcn `Select`: sales-ops then has exactly one picker component with one behaviour and one focus treatment, and the inline non-portalled `Combobox` is drivable in this repo's `createRoot` + `React.act` + happy-dom harness whereas a Radix `Select` panel is not (`areas-view.test.tsx:9-23` exists precisely because portals do not work here). In the frozen legacy trees (`src/admin/**`, `src/finder/**`) only the **data-driven** pickers convert, because those lists grow with the org and are the ones that actually want search; the two closed-enum `Select`s there keep the shadcn `Select`, which is not a native picker and so already satisfies the rule.

`onCreate` is added where, and only where, an inline create yields a **complete, valid** record or exactly reproduces an affordance that already exists.

### Canonical picker geometry, standardised here

Because `NativeSelect` never ran `tailwind-merge` (see Current state), picker heights are currently wrong and the fix has to be part of the swap rather than a follow-up. The `Combobox` trigger composes through `cn` (slice 03's test 27 locks that `formSelectClass` fully displaces the base `h-10 rounded-md border-input bg-background`), so the dead-class failure mode cannot recur once every site goes through it.

There are exactly **two** canonical picker sizes after this slice, and no call site may pass a third:

| Class constant | Geometry | Used at |
| --- | --- | --- |
| `formSelectClass` | `h-11` (44px), `rounded-[10px]`, `text-sm` (14px), `border-[#dcdce2]`, `bg-[#fafafb]` | Every picker inside a form or a dialog: `:2318`, `:2328`, `:2380`, `:2748`, `:2971`, `:3026`, `:3347`, `:3445`, `:4197`, `:4220`, `:4246`, `:4350`, `:4440`, `:4655`, `:4850`. Identical geometry to `formInputClass` (`:142`), which is the point: a picker and the `Input` beside it on the same grid row now match. |
| `comboboxTriggerClass` | `h-10` (40px), `rounded-md`, `text-sm`, same border and background | The compact `Filtros` bar only: `:957`, `:975`. No `Input` sits on that row, so there is nothing to mismatch, and the bar's own vertical rhythm (`py-[13px]`, `:953`) is built around 40px. |

No call site re-passes `h-10`, `h-11`, `rounded-[9px]`, `rounded-md`, `rounded-[10px]`, `text-[13.5px]` or `text-sm`. Sites keep only their **non-geometry** extras: `w-[190px]` at `:959` and `:977`, `flex-[0_0_132px] bg-white` at `:2972`, `w-full` at `:2752`, `bg-white` where a row sits on a grey panel. This is a **visible change at all 17 former `NativeSelect` sites** and is called out in Risks.

Two ordering constraints against slice 04, which lands first in wave 1 and rewrites the Itens rows:

- At `:4350` and `:4440` (and the `Input`s beside them), take whatever class string slice 04 left in place rather than the strings quoted from `master` above; slice 04 is expected to have already promoted them to `h-11 rounded-[10px]`, which is the same target, so the reconciliation should be a no-op. Resolve it at rebase time, not by guessing.
- Do not inline or duplicate slice 04's `saleItemGridClass`. The picker swap touches the control inside each row, never the row's grid template.
- `:4655` (parcelas) and `:4850` (profissionais) are outside slice 04's scope, so promoting them from 40px to 44px is this slice's call and this slice's visible change.

### Sales-ops (`apps/web/src/sales-ops/SalesOpsApp.tsx`)

| Site | Today | Target | `onCreate` | What create does |
| --- | --- | --- | --- | --- |
| `:421-448` `NativeSelect` | wrapper component | **deleted** | - | - |
| `:957` filtro de status | native-select | `Combobox`, `aria-label="Filtrar por status"` | no | Closed enum plus `Todos os status`. |
| `:975` filtro de área | native-select | `Combobox`, `aria-label="Filtrar por área"` | no | Filter row, not an editing surface. Creating an área from a filter makes no sense. |
| `:1003`, `:1006` comissões filters | native-select, inert | **deleted** | - | Both are `onChange={() => undefined} value="all"` with a single option. Re-rendering them as a Combobox would ship a searchable control that provably cannot filter. The `Filtros` label and the record count at `:1009-1014` stay. Flagged to the human in Risks. |
| `:2319` Moeda | native-select | `Combobox`, `aria-label="Moeda"` | no | Closed enum. |
| `:2329` Regime tributário | native-select | `Combobox`, `aria-label="Regime tributário"` | no | Closed enum. |
| `:2381` Idioma | native-select | `Combobox`, `aria-label="Idioma"` | no | Closed enum. |
| `:2750` Área do produto | native-select | `Combobox`, `aria-label="Área do produto"`, `entityLabel="área"`, `entityGender="f"` | **yes** | Inline API create. `POST /sales-ops/areas` with `{ name: query, status: 'active' }` through `useSaveSalesOpsArea().mutateAsync`, then select the returned `area.id`. Justified: an área is fully specified by name plus status (`AreaDialogBody.submit`, `:3326-3330`, sends exactly `{ id, name, status }`), so the inline row is a complete record, not a stub. Opening `AreaDialog` here would stack a third dialog on top of the product dialog. On failure the picker keeps its previous value and shows nothing new; the operator can still use `cadastros/areas`. |
| `:2765` hand-placed `<ChevronDown>` | decoration | **deleted** | - | The `Combobox` trigger renders its own chevron. Also drop the `<div className="relative">` wrapper at `:2749`. |
| `:2971` Tipo do módulo | native-select | `Combobox`, `aria-label={`Tipo do módulo ${index + 1}`}` | no | Closed enum of 5 code-defined strings. |
| `:3026-3036` + `:3085-3089` prestador | bespoke-typeahead + datalist | `Combobox`, `aria-label={`Prestador ${index + 1}`}`, `entityLabel="prestador"`, `entityGender="m"`, `valueLabel={provider.personName}` | **yes** | No API call. `onCreate(query)` sets `providers[i].personName = query`, exactly reproducing today's free-text datalist. Options are `collaborators.map(p => ({ value: p.displayName, label: p.displayName }))` - the stored field is a **name snapshot**, not an id, so `option.value` is the display name. `valueLabel` keeps a typed-in name visible on the trigger. The `<datalist>` and its `list=` attribute are deleted. |
| `:3348` Status da área | native-select | `Combobox`, `aria-label="Status da área"` | no | Closed enum. |
| `:3446` Status da pessoa | native-select | `Combobox`, `aria-label="Status da pessoa"` | no | Closed enum. |
| `:4197-4218` Cliente | bespoke-typeahead + datalist | `Combobox`, `aria-label="Cliente"`, `entityLabel="cliente"`, `entityGender="m"`, `placeholder="Buscar ou digitar um novo cliente..."`, `valueLabel={clientName}` | **yes** | Inline API create through a new optional `onCreateClient?: (name: string) => Promise<SalesOpsClient \| null>` prop, wired in `SalesOpsApp` to `useSaveSalesOpsClient().mutateAsync({ name })`. On success set `clientId = client.id` and `clientName = client.name`. Justified over opening `ClientDialog`: `SaveClientPayload` requires only `name` (`api.ts:39-42`) and every contract field is explicitly optional in the UI ("Campos opcionais usados na geração de contratos", `:3234`), so a name-only cliente is a valid record; and `ClientDialog` is owned by `SalesOpsApp`, not the wizard, so opening it mid-wizard would stack three dialogs deep for a single-field record. **Fallback that preserves today's net effect exactly:** when `onCreateClient` is absent (the wizard is rendered standalone in every existing test) or the mutation rejects, set `clientName = query` and leave `clientId = ''`, which is bit-for-bit what the datalist did. The `Search` icon and `<datalist>` are deleted; the primitive renders its own `Search` icon in the panel. |
| `:4221` Vendedor | native-select | `Combobox`, `aria-label="Vendedor"` | no | Deferred to slice 09 `pessoas-funcoes-web`, which replaces this whole surface with Pessoas plus Funções. A pessoa is only useful once its role flags are set (`isSeller` / `isFinder` / `isCollaborator`, `PersonDialogBody:3401-3405`), so a name-only inline create would produce a pessoa that appears in no picker. Building the affordance now guarantees throwing it away in wave 3. |
| `:4246` Finder | native-select | `Combobox`, `aria-label="Finder"`, `disabled={sellerIsFinder}` | no | Same reason. Keep the `Sem finder cadastrado` case as `emptyMessage`, not as a fake option. |
| `:4350` Área do item | native-select | `Combobox`, `aria-label={`Área do item ${index + 1}`}`, `entityLabel="área"`, `entityGender="f"` | **yes** | Same inline área create as `:2750`, through a new optional `onCreateArea?: (name: string) => Promise<SalesOpsArea \| null>` prop on `SaleWizardDialog`. On success set `items[index].areaId = area.id`. |
| `:4440` Produto / serviço | native-select | `Combobox`, `aria-label={`Produto / serviço do item ${index + 1}`}`, `entityLabel="produto"`, `entityGender="m"` | **yes** | **Opens `ProductDialog` prefilled with the typed name**, through a new optional `onCreateProduct?: (name: string) => void` prop; `SalesOpsApp` sets `modal = { kind: 'product', prefillName: name }`. Deliberately not an inline create: a produto is invalid without an `areaId` (the submit guard `if (!form.areaId) return;` at `:2638` and the disabled Adicionar button at `:3102`) and carries pricing plus three commission pairs, so an inline row would put an unusable catalog entry in front of every future proposta. The wizard stays mounted behind the product dialog, and slice 01's invalidation plus its already-landed remount-key fix make the new produto appear in the picker without losing wizard state. |
| `:4309-4314` "Cadastrar produto" | dead `<button>` with no `onClick` | wired to the same `onCreateProduct` | - | Currently a button that does nothing. Same handler, no typed name. The `sale-wizard-ui-contract` test asserts the literal string `'Cadastrar produto'` survives, and it does. |
| `:4655` Forma de pagamento | native-select | `Combobox`, `aria-label={`Forma de pagamento da parcela ${index + 1}`}` | no | Closed enum of 4. Converted rather than left as a plain `Select` for the two reasons in the rule above; search over 4 rows costs nothing and buys one picker behaviour across the wizard. |
| `:4850` Profissional | native-select | `Combobox`, `aria-label={`Profissional ${index + 1}`}`, `entityLabel="profissional"`, `entityGender="m"`, `valueLabel={professional.personName}` | **yes** | No API call. `onCreate(query)` sets `{ personId: '', personName: query }`. This **replaces** the `<option value="">Digite manualmente</option>` escape hatch at `:4868`, which today clears `personName` and then offers no field to type the name into - a dead end. `valueLabel` also fixes the prefill case: an edited proposta whose `saleProfessionals` row has `personId: null, personNameSnapshot: 'Dev Externo'` currently shows a blank picker; now it shows `Dev Externo`. |

### Elsewhere

| Site | Today | Target | `onCreate` | What create does |
| --- | --- | --- | --- | --- |
| `apps/web/src/auth/react.tsx:235` | native-select | `Combobox`, `aria-label="Workspace"`, controlled | no | Also fixes the CLAUDE.md violation: `label` becomes `orgLabel(workspace)` and, when `isOrgLabelFallback(workspace)`, the raw id moves to the option's `description` line as muted text instead of being the primary label (both helpers already exist at `apps/web/src/lib/displayNames.ts:17-30`). `value` becomes controlled from `workspaces.find(w => w.name === workspaceName)?.id ?? ''`; `onChange` calls `void setActive(id)` exactly as today. Creating a Hub workspace is not this app's job. |
| `apps/web/src/admin/products/ProductDialog.tsx:103` | shadcn-Select | `Combobox` | no | Data-driven app list. Keeps `t('admin.products.field.appPlaceholder')` as `placeholder` and the `Label htmlFor="product-app"` association through the `id` prop. |
| `apps/web/src/admin/products/ProductDialog.tsx:136` | shadcn-Select | **unchanged** | - | Closed 2-option enum in a frozen legacy tree, already not a native picker. |
| `apps/web/src/admin/products/CommissionRuleForm.tsx:94` | shadcn-Select | **unchanged** | - | Same. |
| `apps/web/src/finder/links/LinkGeneratorForm.tsx:93` | shadcn-Select | `Combobox` | no | Data-driven app list. |
| `apps/web/src/finder/links/LinkGeneratorForm.tsx:115` | shadcn-Select | `Combobox`, `disabled={!appId}` | no | Data-driven product list that grows with the catalog; this is the one legacy picker that most wants search. |
| All 19 `<Input type="number">` | native-number | spinnerless, app-styled | - | One base-layer rule in `apps/web/src/index.css`, no call-site edits. See Green step 3. |

### Bespoke duplicates deleted

1. `NativeSelect`, `apps/web/src/sales-ops/SalesOpsApp.tsx:421-448`, and its 17 call sites.
2. The Cliente typeahead, `:4197-4218`: the `list=` attribute, the decorative `Search` icon and `<datalist id="sales-ops-client-options">`.
3. The prestador typeahead, `:3026-3036` `list=` attribute plus `<datalist id="sales-ops-collaborators">` at `:3085-3089`.
4. The hand-placed `<ChevronDown>` at `:2765`.
5. The two inert comissões filter pickers, `:1003` and `:1006`.
6. The raw `<select>` at `apps/web/src/auth/react.tsx:235`.

After this slice `apps/web/src/components/ui/combobox.tsx` is the only searchable picker in the app, and the ESLint rule added in Green step 2 makes it impossible to add another native one by accident.

## Test fallout

Ground truth about the harness, so nobody plans the wrong idiom: there is **no** `@testing-library/*` in this repo, so nothing uses `selectOptions`, `getByRole`, `render` or `userEvent`. `apps/web/vitest.config.ts` sets `environment: 'node'`; each component test opts into a DOM with `// @vitest-environment happy-dom` on line 1 and drives React by hand with `createRoot` plus a cast `React.act`. Because slice 03 locked the panel as **inline and non-portalled**, every migrated picker is reachable with a plain `container.querySelector` and **no test needs a new `vi.mock`**.

Note on the existing `vi.mock('@/components/ui/dialog')` blocks (`areas-view.test.tsx:9-23` and friends): the real Radix dialog *does* render under happy-dom, portal and `role="dialog"` and close button included, so those mocks are a convention that keeps assertions scoped to `container`, not a hard requirement. Keep them exactly as they are. Do not "improve" them in this slice.

### Shared helpers to add to each affected test file

Add these next to the existing `labeledInput` / `buttonByText` helpers, and delete the `changeSelect` / `labeledSelect` helpers they replace.

```ts
function comboboxTrigger(ariaLabel: string): HTMLButtonElement {
  const match = container.querySelector(`button[role="combobox"][aria-label="${ariaLabel}"]`);
  if (!(match instanceof HTMLButtonElement)) throw new Error(`combobox not found: ${ariaLabel}`);
  return match;
}

function comboboxText(ariaLabel: string): string {
  return comboboxTrigger(ariaLabel).textContent?.trim() ?? '';
}

async function pickOption(ariaLabel: string, optionLabel: string) {
  await click(comboboxTrigger(ariaLabel));
  const row = [...container.querySelectorAll('[role="option"]')].find((candidate) =>
    candidate.textContent?.trim().startsWith(optionLabel),
  );
  if (!(row instanceof HTMLElement)) throw new Error(`option not found: ${optionLabel}`);
  await click(row);
}
```

`comboboxText` returns the trigger's visible label, so assertions move from ids to user-visible names. That is the point: `expect(comboboxText('Área do item 2')).toBe('FXL Advisor')` asserts what the operator sees. `startsWith` is used in `pickOption` because an option row's `textContent` concatenates its label and its optional description line.

### 1. `apps/web/src/sales-ops/__tests__/areas-view.test.tsx`

- `:109-115` `changeSelect` - delete, add `comboboxTrigger` / `pickOption`.
- `:175-177` `container.querySelector('select[aria-label="Status da área"]')` plus `changeSelect(statusSelect, 'archived')` - replace with `await pickOption('Status da área', 'Arquivada')`. The submitted payload assertion at `:181` is unchanged.
- `:249-251` `container.querySelector('select[aria-label="Área do produto"]')` plus `changeSelect(areaSelect, areaFixture.id)` - replace with `await pickOption('Área do produto', 'FXL Tech')`. Assertions at `:255-256` unchanged.
- `:171` and `:216` `container.querySelector('input')` - **verify, do not change.** They rely on the Nome `Input` being the first `<input>` in `AreaDialog`. It still is: the Status combobox contributes an `<input>` only while its panel is open, and it is closed at those points. Add nothing; if the run disagrees, tighten them to `input[aria-label="Nome"]` rather than reordering the dialog.

### 2. `apps/web/src/sales-ops/__tests__/product-commission-editor.test.tsx`

- `:138-144` `changeSelect` - delete.
- `:146-150` `chooseArea()` - rewrite to `await pickOption('Área do produto', 'FXL Tech')`.
- `:100-106` `button(label)` matches by exact trimmed `textContent`. **Verify, do not change.** The new Área trigger reads `Selecione a área` or `FXL Tech`, neither of which collides with `'Vendedor + Finder'`, `'Somente vendedor'` or `'Salvar'`. Option rows are `<div>`, not `<button>`, so they can never be matched by this helper.

### 3. `apps/web/src/sales-ops/__tests__/sale-wizard-free-items.test.tsx`

- `:187-191` `labeledSelect` and `:205-211` `changeSelect` - delete, add the shared helpers.
- `:216` `await changeSelect(labeledSelect('Área do item 2'), areaTwoId)` - replace with `await pickOption('Área do item 2', 'FXL Advisor')` (`areaTwoId` is the área named `FXL Advisor`, `:100-107`). Payload assertions at `:226-235` unchanged.

### 4. `apps/web/src/sales-ops/__tests__/sale-wizard-custom-item-labels.test.tsx`

- `:179-184` `labeledSelect` and `:207-213` `changeSelect` - delete, add the shared helpers.
- `:303` `await changeSelect(labeledSelect('Produto / serviço do item 1'), fixedProductId)` - replace with `await pickOption('Produto / serviço do item 1', 'FXL Finance')` (`:71`).

### 5. `apps/web/src/sales-ops/__tests__/sale-wizard-payment-plan.test.tsx`

- `:181-185` `labeledSelect` and `:199-205` `changeSelect` - delete, add the shared helpers.
- `:247` `await changeSelect(labeledSelect('Produto / serviço do item 1'), recurringProductId)` - replace with `await pickOption('Produto / serviço do item 1', 'FXL Advisor')` (`:65-66`).
- `:277` `await changeSelect(labeledSelect('Forma de pagamento da parcela 2'), 'boleto')` - replace with `await pickOption('Forma de pagamento da parcela 2', 'Boleto')`. The payload assertion at `:287` still expects `method: 'boleto'`, which is the point of the test.

### 6. `apps/web/src/sales-ops/__tests__/sale-wizard-edit.test.tsx`

This file has the most fallout and is the real regression net for the slice.

- `:270-274` `labeledSelect` - delete, add `comboboxTrigger` / `comboboxText` / `pickOption`.
- `:311` `expect(fieldInput('Cliente').value).toBe('SegPro')` - the Cliente control is no longer an `<input>` inside a `<label>`. Replace with `expect(comboboxText('Cliente')).toBe('SegPro')`.
- `:314` `expect(labeledSelect('Área do item 2').value).toBe(areaTwoId)` - replace with `expect(comboboxText('Área do item 2')).toBe('FXL Advisor')` (`:149-151`).
- `:320` `expect(labeledSelect('Forma de pagamento da parcela 2').value).toBe('boleto')` - replace with `expect(comboboxText('Forma de pagamento da parcela 2')).toBe('Boleto')`.
- `:285-294` `professionalRowInputs()` finds the row by hunting for the `<select>` containing an option whose text is `Digite manualmente`, then uses `select.parentElement` as the row. Rewrite to:
  ```ts
  function professionalRowInputs(): { role: HTMLInputElement; cost: HTMLInputElement } {
    const row = comboboxTrigger('Profissional 1').parentElement;
    const inputs = row ? [...row.querySelectorAll('input')] : [];
    if (inputs.length < 2) throw new Error('professional row inputs not found');
    return { role: inputs[0]!, cost: inputs[1]! };
  }
  ```
  The `Combobox` wrapper is a `<div className="relative w-full">`, so the trigger's `parentElement` is that wrapper, not the row grid. Use `comboboxTrigger('Profissional 1').closest('div.grid')` instead if the run shows the inputs are not siblings; pick whichever the first run proves, and do not add a `data-testid`.
- `:276-283` `fieldInput(label)` - **keep.** It is still used for `'Comissão vendedor %'` at `:326`, which stays a plain `Input` inside a `Field` label.
- `:355-357` `expect(payload.professionals).toEqual([{ personId: undefined, personName: 'Dev Externo', ... }])` - **must stay green unchanged.** This is the assertion that proves the `valueLabel` plus `onCreate` design preserves a name-only professional snapshot. If it goes red the design is wrong, not the test.

### 7. `apps/web/src/sales-ops/__tests__/sale-wizard-commission-defaults.test.tsx`

- `:193-198` `productSelects()` filters `<select>` elements by their option text - rewrite to
  ```ts
  function productTriggers(): HTMLButtonElement[] {
    return [...container.querySelectorAll<HTMLButtonElement>(
      'button[role="combobox"][aria-label^="Produto / serviço do item "]',
    )];
  }
  ```
- `:204-210` `changeSelect` - delete, add `pickOption`.
- `:264` `expect(initialSelects).toHaveLength(2)` - `expect(productTriggers()).toHaveLength(2)`.
- `:263`/`:265` `changeSelect(initialSelects[1]!, productB.id)` - `await pickOption('Produto / serviço do item 2', 'Product B')`.
- `:274` `changeSelect(productSelects()[0]!, productB.id)` - `await pickOption('Produto / serviço do item 1', 'Product B')`.
- `:177-183` `buttonByText` - **verify, do not change.** `'remover'`, `'Avançar'`, `'Voltar'`, `'Essa proposta teve um finder'`, `'Salvar rascunho'` do not collide with any trigger label (`'Product A'`, `'Product B'`, `'Client A'`, `'FXL Tech'`, `'Pix'`).

### 8. `apps/web/src/auth/__tests__/react.test.tsx`

- `:178-185` queries `container.querySelector('select')`, assigns `select.value = 'workspace-beta'` and dispatches a `change` event. Rewrite to open the combobox and click the row:
  ```ts
  const trigger = container.querySelector('button[role="combobox"][aria-label="Workspace"]');
  if (!(trigger instanceof HTMLButtonElement)) throw new Error('workspace combobox not found');
  await act(async () => trigger.dispatchEvent(new MouseEvent('click', { bubbles: true })));
  const row = [...container.querySelectorAll('[role="option"]')].find((candidate) =>
    candidate.textContent?.trim().startsWith('Beta'),
  );
  await act(async () => {
    row?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await Promise.resolve();
  });
  ```
  Workspace fixtures are `{ id: 'workspace-alpha', name: 'Alpha' }` and `{ id: 'workspace-beta', name: 'Beta' }` (`:65-68`), so `orgLabel` yields `Alpha` / `Beta` and no id is rendered. The four assertions at `:187-196` (`setActive` called with `'workspace-beta'`, `cache.seed` once with the switched token, the ordering assertion, `getToken` call counts) are unchanged and are the reason this rewrite must be exact.
- `:179` `expect(select).not.toBeNull()` - becomes the `instanceof` guard above.
- Note: the file has **no** `// @vitest-environment` change needed; line 1 already sets `happy-dom`.

### 9. `apps/web/src/sales-ops/__tests__/routing.test.tsx`

- No `<select>` assertion, so nothing breaks on that axis. Two defensive changes:
  - `:39-42` `const mutation = { isPending: false, mutate: vi.fn() }` - add `mutateAsync: vi.fn(async () => ({}))`. The new `createClientByName` / `createAreaByName` helpers in `SalesOpsApp` call `mutateAsync`; they are only reached from a create row, which this file never clicks, but the mock should not be a landmine for the next slice.
  - `:382-383` `expect(mainRegion().querySelector('button[aria-label="Vendedores"]')).toBeNull()` - **verify, do not change.** The new wizard triggers use the singular `'Vendedor'` and `'Finder'`, and the wizard is not open in that test.
- `:85-99` `vi.mock('@/components/ui/dialog')` - unchanged. Do **not** add a mock for `@/components/ui/combobox`; the panel is inline.

### 10. `apps/web/src/sales-ops/__tests__/sale-wizard-ui-contract.test.ts`

This is a source-text test: it `readFileSync`s `../SalesOpsApp.tsx` and asserts 20 literal substrings plus 6 negatives.

- All 20 positives survive verbatim: `'Nova proposta'`, `'Editar proposta'`, `'Cliente, itens, pagamento e custos - salve como rascunho a qualquer momento'`, `"label: 'Proposta'"`, `"label: 'Pagamento'"`, `'Custos e margem'`, `'Revisão'`, `'Essa proposta teve um finder'`, `'Cadastrar produto'`, `'+ item avulso'`, `'Plano de pagamento'`, `'Dividir em'`, `'A soma das parcelas precisa ser igual ao total da proposta.'`, `'Adicionar recorrência'`, `'Prazo indeterminado'`, `'Previsão de contas a pagar'`, `'Passo {wizardStep} de 4'`, `'Avançar'`, `'Salvar proposta'`, `'Salvar rascunho'`.
- All 6 negatives stay absent. The strings this slice introduces (`'Buscar ou digitar um novo cliente...'`, `'cliente'`, `'área'`, `'produto'`, `'profissional'`, `'prestador'`, `'Selecione a área'`, `'Nenhuma área encontrada'`) contain none of `'Fechamento da venda'`, `'Nova venda'`, `'Salvar incompleto'`, `'Confirmar venda'`, `'Passo {wizardStep} de 3'`, `'Salvar venda'`.
- **Required addition**, so the file keeps pace with the new core rule and becomes its cheapest guard:
  ```ts
  expect(source).not.toContain('<select');
  expect(source).not.toContain('<option');
  expect(source).not.toContain('datalist');
  expect(source).not.toContain('NativeSelect');
  ```

### 11. `apps/web/src/sales-ops/__tests__/sale-wizard-state-preservation.test.tsx` - inherited from slice 01, and it breaks here

This file does not exist on `master`; slice 01 creates it to guard the remount-key fix (`01-query-cache-refresh.md`, Red section 4). **Its probe is the control this slice deletes.** Slice 01 picks the step-1 cliente field precisely because its `value` is the wizard's `clientName` state, and reaches it with:

```ts
container.querySelector('input[placeholder="Buscar ou digitar um novo cliente..."]')
```

After this slice that element is gone: the placeholder moves to the `Combobox` trigger's `<button>` text, and the only `input` in the control is the panel's search field, which exists only while the panel is open and holds the query rather than the committed value. Both of slice 01's tests, `'keeps typed wizard state when a bootstrap refetch changes the first cliente'` and `'keeps typed wizard state when a bootstrap refetch changes the people count'`, go red on the `querySelector` returning `null`.

**Required rewrite, preserving slice 01's intent exactly.** Swap the probe for a control this slice does not touch, and keep the cliente axis as a second assertion driven through the picker:

```ts
// was: the cliente input's value
// now: a plain Input that this slice leaves alone
expect(labeledInput('Valor unitário do item 1').value).toBe('4321');
// and, for the cliente axis, the committed value on the trigger
expect(comboboxText('Cliente')).toBe('Cliente Digitado');
```

`'Cliente Digitado'` is committed by opening `comboboxTrigger('Cliente')`, typing it into the panel, and clicking the `+ Criar novo cliente "Cliente Digitado"` row with no `onCreateClient` wired, which is the fallback path Red test 3 locks (sets `clientName`, leaves `clientId` empty). Add the shared `comboboxTrigger` / `comboboxText` / `pickOption` / `typeInPanel` helpers to the file. Do **not** weaken either assertion to `container.textContent` matching, and do not delete either test: they are slice 01's guarantee, and this slice's inline-create affordances are the reason that guarantee matters.

If slice 01 has not landed when this slice starts, this entry is inapplicable and Green step 7 says to stop anyway.

### 12. No change needed, verified

`apps/web/src/sales-ops/__tests__/client-dialog-legal-fields.test.tsx` (`ClientDialog` gains no picker; `:107` `container.querySelector('input')` is still the Nome field), `apps/web/src/sales-ops/__tests__/sales-view.test.tsx`, `apps/web/src/sales-ops/__tests__/sales-transition-actions.test.tsx`, `apps/web/src/sales-ops/__tests__/calculations.test.ts`, `apps/web/src/sales-ops/__tests__/navigation.test.ts`, `apps/web/src/admin/products/__tests__/useProducts.test.ts`, `apps/web/src/__tests__/route-error-and-auth-context.test.tsx`, `apps/web/src/i18n/__tests__/keys-resolve.test.ts`, `apps/web/src/auth/__tests__/{claims,provider,token}.test.ts`. There are **no** component tests for `admin/**` or `finder/**`, which is why converting the four data-driven `Select`s there is cheap.

## Red

Write `apps/web/src/sales-ops/__tests__/combobox-adoption.test.tsx` first and watch it fail. Copy the harness idiom from `apps/web/src/sales-ops/__tests__/sale-wizard-free-items.test.tsx:1-24` (pragma, `vi.mock('@/components/ui/dialog')` down to plain divs, `React.act` cast) and `:141-211` (`renderWizard`, `click`, `changeInput`), and reuse its `product()` / `baseBootstrap()` fixtures. Add the shared `comboboxTrigger` / `comboboxText` / `pickOption` helpers and a `typeInPanel(value: string)` that drives the panel's `input[type="text"]` with the native value setter plus an `input` event.

Fixtures this file needs on top of `sale-wizard-free-items`: a second produto named `FXL Advisor` so filtering has something to discriminate, and `onCreateClient` / `onCreateArea` / `onCreateProduct` spies passed to `SaleWizardDialog`.

**ORACLE**

```bash
CI=true pnpm --filter @fxl-sales/web exec vitest run src/sales-ops/__tests__/combobox-adoption.test.tsx
```

Use exactly this form. `pnpm --filter @fxl-sales/web test -- --run <path>` does **not** filter: pnpm swallows the positional argument and all 21 web test files run (measured: 21 files / 122 tests instead of 1 file). `pnpm ... exec vitest run <path>` was verified to run exactly one file. The path is relative to `apps/web`.

**Full gate before handing off to Verify**

```bash
pnpm run lint && pnpm run type-check && CI=true pnpm test
```

Baseline to compare against: **measure it on this slice's branch point, do not trust a number quoted here.** `master` was 21 web test files / 122 tests at plan time, but slices 01, 02, 03 and 04 all land before this one and each adds test files (01 alone adds at least `cadastros-refresh.test.tsx` and `sale-wizard-state-preservation.test.tsx`). Record `CI=true pnpm test` file and test counts immediately after branching, then assert this slice adds exactly one file (`combobox-adoption.test.tsx`) and removes none. Anything else means the tree is polluted.

### `describe('combobox adoption in the proposta wizard', ...)`

1. `'filters the produto picker by the typed query and selects the match with the keyboard'`
   Open `comboboxTrigger('Produto / serviço do item 1')`; assert two `[role="option"]` rows (`FXL Finance`, `FXL Advisor`). `typeInPanel('Advis')`; assert exactly one row and its text starts with `'FXL Advisor'`. Dispatch `keydown` `ArrowDown` then `Enter` on the panel search field; assert the panel is gone (`container.querySelector('[role="listbox"]')` is null), `comboboxText('Produto / serviço do item 1')` is `'FXL Advisor'`, and the item row's unit value re-derived from the new produto (`labeledInput('Valor unitário do item 1').value` changed). This is the "filters and selects by typing plus keyboard" oracle.

2. `'offers Criar novo cliente for an unmatched query and adopts the created cliente'`
   `onCreateClient` resolves `{ id: 'new-client-id', name: 'Dias Pet', ... }`. Open `comboboxTrigger('Cliente')`, `typeInPanel('Dias Pet')`. Assert `container.querySelector('[data-combobox-create="true"]')` is not null and its `textContent.trim()` is **exactly** `'+ Criar novo cliente "Dias Pet"'`. Click it. Assert `onCreateClient` called once with `'Dias Pet'`, the panel closed, `comboboxText('Cliente')` is `'Dias Pet'`, and after advancing to step 4 and clicking `Salvar proposta` the payload carries `clientId: 'new-client-id'` and `clientName: 'Dias Pet'`. This is the create-row oracle demanded by the batch acceptance.

3. `'falls back to the typed name with no clientId when no create handler is wired'`
   Render without `onCreateClient`. `typeInPanel('Dias Pet')`, click the create row, save. Assert `clientName: 'Dias Pet'` and `payload.clientId` is `undefined`. Locks "preserve the existing net effect" of the deleted datalist.

4. `'hides the create row when the typed cliente already exists'`
   `typeInPanel('SegPro')` -> `[data-combobox-create="true"]` is null and one option row remains.

5. `'offers Criar nova área with feminine agreement on a free-form item row'`
   Click `+ item avulso`, open `comboboxTrigger('Área do item 2')`, `typeInPanel('Jurídico')`. Assert the create row text is exactly `'+ Criar nova área "Jurídico"'`. With `onCreateArea` resolving `{ id: 'new-area-id', name: 'Jurídico', status: 'active' }`, click it and assert `comboboxText('Área do item 2')` is `'Jurídico'` and the saved payload's `items[1].areaId` is `'new-area-id'`.

6. `'routes the produto create row and the Cadastrar produto button to the same handler'`
   Open the produto picker, `typeInPanel('FXL Novo')`, click the create row; assert `onCreateProduct` called once with `'FXL Novo'` and that `onChange` did not change the selected produto (the primitive does not mutate `value` on create). Then click `buttonByText('Cadastrar produto')` and assert `onCreateProduct` was called again, with no query. Note deliberately **not** asserted here: that the wizard survives the post-create bootstrap refetch. That is slice 01's guarantee and slice 01's test (`sale-wizard-state-preservation.test.tsx`); duplicating it would fork the guard.

7. `'lets a name-only profissional survive through the picker'`
   Advance to step 3, click `+ profissional`, open `comboboxTrigger('Profissional 1')`, `typeInPanel('Dev Externo')`, click the create row. Assert `comboboxText('Profissional 1')` is `'Dev Externo'` and the saved payload has `professionals: [{ personId: undefined, personName: 'Dev Externo', ... }]`.

8. `'renders no native select, option or datalist anywhere in the wizard'`
   Walk all four steps (`Avançar` x3) and after each assert `container.querySelectorAll('select, option, datalist').length === 0`.

9. `'closes the panel on Escape without closing the wizard'`
   Open the Cliente picker, `typeInPanel('Dias')`, dispatch `keydown` `Escape` on the search field. Assert the listbox is gone, `container.textContent` still contains `'Editar proposta'` or `'Nova proposta'`, and `onCreateClient` was not called. Guards the Radix `Dialog` interaction the primitive's Escape handling is designed for.

10. `'never submits the product form when Enter is pressed in a picker panel'`
    Render `ProductDialog` (import it from `../SalesOpsApp`, as `areas-view.test.tsx:231` does) with an `onSave` spy, open `comboboxTrigger('Área do produto')`, `typeInPanel('zzz')`, dispatch `Enter`. Assert `onSave` was not called.

### `describe('the native picker ban is enforced', ...)`

These are cheap source assertions that make the core rule executable rather than aspirational. Read the files with `readFileSync` plus `fileURLToPath(new URL(...))`, the idiom already used by `sale-wizard-ui-contract.test.ts:1-6`.

11. `'suppresses the OS number spinner in the base stylesheet'` - `apps/web/src/index.css` contains `::-webkit-inner-spin-button` and `::-webkit-outer-spin-button` and `appearance: textfield`.
12. `'bans native picker markup through ESLint'` - `apps/web/eslint.config.js` contains `no-restricted-syntax`, `JSXOpeningElement[name.name="select"]`, `JSXOpeningElement[name.name="datalist"]` and the raw `<input type="number">` selector.
13. `'records the rule in CLAUDE.md'` - the repo-root `CLAUDE.md` contains a `## UI Controls` heading and the string `@/components/ui/combobox`.

## Green

1. **Confirm the dependency landed.** `apps/web/src/components/ui/combobox.tsx` and `combobox-filter.ts` exist and export `Combobox`, `ComboboxOption`, and support `entityLabel` plus `entityGender`. If `entityGender` is missing, stop and reconcile with slice 03 rather than forking a second create-label implementation.

2. **Add the enforcement rule** in `apps/web/eslint.config.js`, inside the existing `rules` block at `:16-24`:
   ```js
   'no-restricted-syntax': [
     'error',
     {
       selector: 'JSXOpeningElement[name.name="select"]',
       message: 'Native <select> is banned. Use <Combobox> from @/components/ui/combobox (CLAUDE.md, UI Controls).',
     },
     {
       selector: 'JSXOpeningElement[name.name="datalist"]',
       message: 'Native <datalist> is banned. Use <Combobox> from @/components/ui/combobox (CLAUDE.md, UI Controls).',
     },
     {
       selector: 'JSXOpeningElement[name.name="option"]',
       message: '<option> only exists inside a native picker, which is banned. Use <Combobox> options (CLAUDE.md, UI Controls).',
     },
     {
       selector: 'JSXOpeningElement[name.name="input"] > JSXAttribute[name.name="type"][value.value="number"]',
       message: 'Use <Input type="number"> from @/components/ui/input; a raw <input type="number"> renders OS spin buttons.',
     },
   ],
   ```
   Run `pnpm run lint` now and expect a wall of errors. That wall is the work list for steps 5 to 9.

3. **Kill the number spinners** in `apps/web/src/index.css`, inside the existing `@layer base` block, next to the `.sales-ops` rules at `:65-92` (base-layer rather than a class on `input.tsx`, so it also reaches inputs rendered inside Radix `Dialog` portals which sit outside `.sales-ops`):
   ```css
   input[type='number'] {
     appearance: textfield;
   }

   input[type='number']::-webkit-outer-spin-button,
   input[type='number']::-webkit-inner-spin-button {
     appearance: none;
     margin: 0;
   }
   ```
   In the same file drop `select` from the font-inheritance selector list at `:75-80`, since no `<select>` will exist.

4. **Fix the dead popover tokens.** Replace `bg-popover text-popover-foreground` with `bg-background text-foreground` at `apps/web/src/components/ui/select.tsx:78`, `apps/web/src/components/ui/dropdown-menu.tsx:48` and `:72`, and make the bare `border` explicit as `border border-border` in the two `dropdown-menu.tsx` strings. Chosen over defining a new `popover` token in both `tailwind.config.ts` and `index.css` because slice 03 already committed the new `Combobox` panel to `border-border bg-background text-foreground shadow-md`; using the same real tokens gives the app one panel look and zero new tokens. This is a visible change - see Risks.

5. **`apps/web/src/sales-ops/SalesOpsApp.tsx` - the shared pieces.**
   - Import `Combobox` and `type ComboboxOption` from `@/components/ui/combobox`.
   - Delete `NativeSelect` (`:421-448`).
   - Add, next to `formInputClass` / `formSelectClass` at `:142-145`:
     ```tsx
     const comboboxTriggerClass =
       'h-10 rounded-md border-[#dcdce2] bg-[#fafafb] px-3 text-sm font-medium text-[#201f24] transition focus-visible:border-[#eaa81a] focus-visible:ring-0 focus-visible:ring-offset-0 disabled:cursor-not-allowed disabled:opacity-60';
     ```
     This is `NativeSelect`'s class verbatim minus `outline-none` (the primitive's trigger already carries `focus-visible:outline-none`) and with `focus:` promoted to `focus-visible:` so a mouse click never paints a border flash. It is the compact 40px size, and it is used at exactly two sites (the `Filtros` bar).
   - Redefine `formSelectClass` as `` `${comboboxTriggerClass} h-11 rounded-[10px]` ``. Drop its `appearance-none` (nothing to hide now) and its `pr-9` (the primitive's `justify-between gap-2` plus its own chevron already reserves the space; keeping `pr-9` would double-pad). `twMerge` inside `cn` resolves `h-10`/`h-11` and `rounded-md`/`rounded-[10px]` in favour of the later token, which slice 03's test 27 locks. Every non-filter picker gets this and nothing else geometry-wise; that is what finally makes a picker and its neighbouring `Input` the same 44px with one 14px font size and one 10px radius.
   - Add a `<div>`-based twin of `Field` (`:401-419`), because a `<label>` must not contain two labelable elements and the panel's search `<input>` would be the second one:
     ```tsx
     function FieldBlock({ label, children, required }: { label: string; children: ReactNode; required?: boolean }) {
       return (
         <div className="flex flex-col gap-[6px]">
           <span className="text-xs font-semibold text-[#8b8b92]">
             {label}
             {required ? <span className="text-[#b23a22]"> *</span> : null}
           </span>
           {children}
         </div>
       );
     }
     ```
     Use `FieldBlock` at exactly the seven `Field`-wrapped picker sites (`:2318` Moeda, `:2328` Regime tributário, `:2380` Idioma, `:2748` Área do produto, `:3347` Status da área, `:3445` Status da pessoa, `:4220` Vendedor). Every one of those pickers gets its accessible name from the `aria-label` in the Migration table, so nothing loses its label. Leave `Field` untouched for every `Input`.
   - Add three small option builders near `titleForView`, all pure:
     ```tsx
     function areaOptions(areas: SalesOpsArea[]): ComboboxOption[]
     function productOptions(products: SalesOpsProduct[], areaNameById: Map<string, string>): ComboboxOption[]
     function personOptions(people: SalesOpsPerson[]): ComboboxOption[]
     ```
     `productOptions` puts the área name in `description`, which is what the primitive's secondary line is for and replaces nothing (the item row's área chip at `:4452-4460` stays). `personOptions` puts `contactEmail` in `description` when present. None of them ever emit a raw account or workspace id.

6. **`SalesOpsApp.tsx` - the create wiring.** In the `SalesOpsApp` component body, next to the existing mutation hooks at `:507-515`:
   ```tsx
   async function createClientByName(name: string): Promise<SalesOpsClient | null> {
     try {
       const { client } = await saveClient.mutateAsync({ name: name.trim() });
       return client;
     } catch {
       return null;
     }
   }

   async function createAreaByName(name: string): Promise<SalesOpsArea | null> {
     try {
       const { area } = await saveArea.mutateAsync({ name: name.trim(), status: 'active' });
       return area;
     } catch {
       return null;
     }
   }
   ```
   Keep both `mutateAsync` references **inside** the function bodies so `routing.test.tsx`'s hook mock is not required to provide them at render time. Pass `onCreateClient={createClientByName}`, `onCreateArea={createAreaByName}` and `onCreateProduct={(name) => setModal({ kind: 'product', prefillName: name })}` to `SaleWizardDialog` (`:1133-1149`), and `onCreateArea={createAreaByName}` to `ProductDialog` (`:1099-1108`).
   Extend `ModalState` (`:161-166`) to `{ kind: 'product'; product?: SalesOpsProduct; prefillName?: string }` and thread `prefillName` into `productForm` (`:2422-2453`) as the `name` default when there is no `product`. Include it in the `ProductDialog` `key` at `:2594` (`props.modal.product?.id ?? `new-product-${props.modal.prefillName ?? ''}``) so opening it twice with different typed names re-seeds the form.
   Leave `ProductDialog` rendered before `SaleWizardDialog` in the tree; Radix portals stack by mount order at runtime, so the product dialog opened second lands on top.

7. **Confirm, do not patch, the wizard remount key.** Read `apps/web/src/sales-ops/SalesOpsApp.tsx:3644` and check it is already `key={props.editSale?.id ?? 'create'}` and that the `<SaleWizardDialog>` element at `:1133-1149` is already gated on `bootstrapQuery.isSuccess`. Both are slice 01's edits (`01-query-cache-refresh.md`, step 5.1). If the composite key with `clients[0]?.id` / `products[0]?.id` / `people.length` is still there, **stop**: slice 01 has not landed, and step 6's create affordances would destroy the operator's typed proposta on every create. Do not fix it here; two slices patching this line is a guaranteed conflict and the second to land would silently delete the first one's guard.

8. **`SalesOpsApp.tsx` - swap the 17 call sites** in the order of the Migration table, deleting `:1003-1008`, `:2765`, `:3085-3089` and `:4210-4215` outright. For each surviving site: pass `options`, `value`, `onChange`, the `aria-label` from the table, and `className={cn(formSelectClass, '<only the site\'s non-geometry extras>')}` (or `comboboxTriggerClass` at the two `Filtros` sites), following the "Canonical picker geometry" table. Strip every `h-10`, `h-11`, `rounded-[9px]`, `rounded-md`, `rounded-[10px]` and `text-[13.5px]` from the call sites; keep only `w-[190px]`, `w-full`, `flex-[0_0_132px]` and `bg-white`. Where a site currently fabricates a sentinel option, move it to the right prop instead: `Todos os status` / `Todas as áreas` stay real options with `value="all"` (they are values, not placeholders); `Selecione a área` at `:2756-2758` becomes `placeholder`; `Sem finder cadastrado` at `:4252` becomes `emptyMessage="Nenhum finder cadastrado"`; `Digite manualmente` at `:4868` is deleted in favour of `onCreate`. Run `pnpm run lint` after this step and expect the sales-ops half of the wall to be gone.

9. **The remaining files.**
   - `apps/web/src/auth/react.tsx:229-263`: replace the `<select>` with a controlled `Combobox`, `aria-label="Workspace"`, `className="h-9 rounded-md border-input bg-background px-3 text-sm"` to keep the current box, options built with `orgLabel` and `isOrgLabelFallback` from `@/lib/displayNames`, `onChange={(id) => void setActive(id)}`. No `onCreate`.
   - `apps/web/src/admin/products/ProductDialog.tsx:100-116`: swap the app `Select` for a `Combobox` with `id="product-app"` so the existing `Label htmlFor` keeps working. Leave `:133-145` (status) on `Select`; prune only the now-unused named imports.
   - `apps/web/src/finder/links/LinkGeneratorForm.tsx:89-127`: swap both `Select`s for `Combobox` with `id="app"` / `id="product"` and `disabled={!appId}` preserved on the product one; drop the `Select*` imports entirely from this file.

10. **Rewrite the tests** exactly as enumerated in Test fallout, files 1 through 11 (file 11 is the one slice 01 created, whose probe this slice deletes). Do them one file at a time and run that file's ORACLE, `CI=true pnpm --filter @fxl-sales/web exec vitest run src/sales-ops/__tests__/<file>`, before moving on, so a red is always attributable to one migration. Do not use the `pnpm ... test -- --run <path>` form; it silently runs all 21 files.

11. **Record the rule** in the repo-root `CLAUDE.md`, as a new `## UI Controls` section placed after `## UI Identifiers`:
    - Every single-select picker uses `Combobox` from `@/components/ui/combobox`. Native `<select>`, `<option>` and `<datalist>` are banned and ESLint enforces it in `apps/web/eslint.config.js`.
    - Numeric fields use `<Input type="number">`; the OS spin buttons are suppressed in `apps/web/src/index.css`. A raw `<input type="number">` is banned.
    - `<input type="date">` is the one native picker still allowed, by explicit batch decision.
    - `onCreate` is only wired where an inline create yields a complete valid record: cliente, área, prestador and profissional inline; produto opens `ProductDialog` prefilled because a produto is invalid without an área.

12. **Run the full gate.** `pnpm run lint && pnpm run type-check && CI=true pnpm test`. Then verify the two visual claims by hand in the running app, because no test can: open `cadastros/produtos` and confirm the Área picker searches and the amber `+ Criar nova área "..."` row appears and works; open `operacional/vendas` -> `Nova proposta` and confirm the Cliente picker's create row creates a real cliente that then shows up in `cadastros/clientes`; confirm no number field shows spin buttons; confirm the admin `Select` panels now have a background.

13. **One atomic commit**, for example `feat(web): adopt the searchable Combobox everywhere and delete every native picker`. Stage exactly the 20 paths in `files_modified`. Do not stage `.vscode/` or `apps/web/src/components/ui/__tests__/zz-probe.test.tsx`.

## Refactor

- Do not extract a `SalesOpsCombobox` adapter component. The 17 call sites already pass site-specific class strings, and an adapter would only relocate them while hiding which picker is which. Two shared string constants (`comboboxTriggerClass`, `formSelectClass`) carry all the shared styling.
- Keep the three option builders pure and module-level so they are unit-testable and do not re-allocate inside render. If `SalesOpsApp.tsx` grows past roughly 5,300 lines after this slice, move `areaOptions` / `productOptions` / `personOptions` into `apps/web/src/sales-ops/calculations.ts`, which already holds this file's pure helpers, rather than creating a new module.
- Leave `apps/web/src/components/ui/select.tsx` and `@radix-ui/react-select` in place. Two closed-enum call sites in the frozen legacy trees still use them, and removing the dependency would drag `pnpm-lock.yaml` and `apps/web/vite.config.ts:35-49` into an already wide commit. Note it as a follow-up for whenever those two admin screens are next touched.
- Leave `UnitInput` (`:2545-2573`) structurally alone. It keeps `type="number"`; the index.css rule is what de-spins it.
- Resist widening `productOptions` into a grouped-by-área list in this slice. `ComboboxOption.group` supports it, but slice 10 (`produtos-servicos-web`) reshapes the produto model with the `Produto | Serviço` toggle and should own that decision.

## Out of scope

- `<input type="date">` at `SalesOpsApp.tsx:4298`, `:4633`, `:4736`. Kept by the overview's "Deliberately excluded" section.
- Making the two deleted comissões filters real. Wiring a status and a responsável filter over `bootstrap.payables` is a new feature, not in the batch Frame.
- Any `onCreate` on the Vendedor, Finder or Workspace pickers. Pessoa creation belongs to slice 09; Hub workspace creation is not this app's job.
- Multi-select, per-option `disabled`, a clear button, async option loading, grouped produto lists, or any change to `combobox.tsx` / `combobox-filter.ts`. Slice 03 owns the primitive; if this slice needs a primitive change, that is a signal to reconcile with 03, not to fork.
- Defining a `popover` design token. Step 4 removes the need for one.
- The `SaleWizardDialog` remount key at `SalesOpsApp.tsx:3644` and the `bootstrapQuery.isSuccess` mount gate at `:1133-1149`. Both belong to slice 01. This slice only reads that line to confirm the precondition, and only rewrites the probe inside the test slice 01 shipped for it.
- The propostas status machine, payables/receivables materialization, and the `"N/M"` / `"MN/M"` receivable label conventions. Untouched.
- Route trees, navigation, `AppRole` visibility, tenancy filtering. Untouched.
- The payment-plan builder redesign (slice 11) and the Itens grid alignment (slice 04), even though both edit the same wizard region.
- Removing `@radix-ui/react-select` from `apps/web/package.json`.

## Risks

- **The slice is wide: 20 files, one 5,207-line file, and 17 call sites.** Mitigated by the fact that all 17 sites go through one deleted wrapper with one known API, so each swap is mechanical, and by Green step 10's file-at-a-time test loop which keeps every red attributable. It **must** stay one commit, because the ESLint rule from step 2 fails `pnpm run lint` until the last native picker is gone, so no intermediate commit can be green. If a reviewer insists on a split, the only clean seam is: **06a** = primitive adoption in `sales-ops/**` plus its 9 test files; **06b** = `auth/react.tsx`, `admin/products/ProductDialog.tsx`, `finder/links/LinkGeneratorForm.tsx`, the `index.css` spinner rule, the popover-token fix, the ESLint rule and the `CLAUDE.md` section. 06a would then have to defer step 2, which is the whole point of the slice, so prefer one commit.
- **The inline cliente and área create paths are only safe because slice 01 fixed the `SaleWizardDialog` remount key at `SalesOpsApp.tsx:3644`.** Both creates change a name-ordered bootstrap collection, which under the old composite key remounted the wizard and destroyed the operator's typed proposta. This slice inherits that fix rather than duplicating it, so the dependency is real and load-bearing, not incidental: **if slice 01 is ever parked, reverted or its key change is undone, this slice must be re-verified against wizard-state loss before shipping**, and Green step 7 is the pre-flight check that catches it (read the line, stop if the composite key is back). The guard itself lives in slice 01's `sale-wizard-state-preservation.test.tsx`, which this slice must keep green after rewriting its deleted probe (Test fallout item 11) rather than deleting or weakening.
- **Rewriting 9 test files is the biggest breakage risk**, one of which (`sale-wizard-state-preservation.test.tsx`) does not exist yet because slice 01 creates it and this slice deletes the control it probes. Every affected assertion is enumerated with file:line in Test fallout, and every rewrite moves from an opaque id (`select.value === areaTwoId`) to a user-visible label (`comboboxText(...) === 'FXL Advisor'`), so a wrong rewrite fails loudly rather than passing vacuously. Three assertions are explicitly marked "must stay green unchanged" (`sale-wizard-edit.test.tsx:355-357`, and the four Hub assertions at `auth/__tests__/react.test.tsx:187-196`) because they are the behaviour contracts the migration must not bend.
- **Reaching the panel from a test.** Removed as a risk by slice 03's locked decision: the panel is inline and non-portalled, so every option row is a plain `container.querySelector('[role="option"]')`, no test needs a new `vi.mock`, and no `afterEach` portal cleanup changes.
- **Escape inside a picker closing the whole wizard, or Enter submitting the dialog form.** Both are handled by the primitive (`preventDefault` + `stopPropagation` + `stopImmediatePropagation` on Escape, unconditional `preventDefault` on Enter) and both get an adoption-level guard here, Red tests 9 and 10, because the primitive's own tests use a synthetic ancestor rather than the real dialogs.
- **Fixing the dead popover tokens visibly changes two existing panels.** That is the intent - they currently render with no background at all, which is a real defect - but it is a visual change and is called out rather than slipped in. Blast radius is small and verified: the only affected surfaces are the `Select` panels in `admin/products/**` and `finder/links/**`; both sales-ops `DropdownMenuContent` call sites already pass their own `bg-white` (`SalesOpsApp.tsx:877`, `:1501`). Flag it to the human at Gate 3 with a before/after of `admin/products`.
- **Deleting the two inert comissões filter pickers removes visible controls.** They cannot filter anything (`onChange={() => undefined}`, one option each), so re-rendering them as searchable Comboboxes would ship a control that lies to the operator. Flagged to the human as a deliberate removal; the `Filtros` heading and record count stay, so the bar does not collapse.
- **A short closed enum gains a search field it does not need.** Accepted, deliberately. The alternative is two picker components in sales-ops with two focus treatments, and a Radix `Select` panel that this test harness cannot drive. If the human dislikes it on a specific field, adding a `searchable={false}` prop to the primitive is a later, additive change to `combobox.tsx`, not a re-migration.
- **`twMerge` failing to let `formSelectClass` win, producing box drift across 17 sites.** Locked upstream by slice 03's test 27, which asserts `h-11 rounded-[10px] border-[#dcdce2] bg-[#fafafb]` fully displaces `h-10 rounded-md border-input bg-background`. Verified downstream by eye in Green step 12.
- **Standardising picker geometry is a visible change at all 17 former `NativeSelect` sites.** That is the intent: because `NativeSelect` composed classes with a template string instead of `cn`, the four wizard-row pickers render 40px next to 44px `Input`s today, and a single Itens row shows three font sizes and three border radii. After this slice there are exactly two canonical picker sizes (44px in forms and dialogs, 40px in the compact `Filtros` bar) and every call site passing a third is stripped. The two sites nobody has looked at recently, `:4655` Forma de pagamento and `:4850` Profissional, go from 40px to 44px, which visibly changes the parcelas and profissionais row heights. Called out rather than slipped in; show the human a before/after of one Itens row and one parcela row at Gate 3. The failure mode cannot recur, because the `Combobox` trigger composes through `cn`.
- **Colliding with slice 04 over the Itens rows.** Slice 04 lands first in wave 1, promotes the Itens controls to `h-11 rounded-[10px]` locally and replaces six hand-written copies of the five-column grid template with one `saleItemGridClass` constant. Both hazards are avoided by rule rather than by hope: at `:4350` and `:4440` take slice 04's post-merge class string rather than the one quoted from `master`, and never touch a row's grid template while swapping the control inside it. Because slice 04's target geometry and this slice's canonical geometry are the same 44px / 10px, the reconciliation should be a no-op; if it is not, that is a real disagreement to surface, not to paper over.
- **Prototyping in the shared working tree pollutes sibling baselines.** Another planner did this during Frame and briefly moved the web test baseline from 21 files / 122 tests to 22 / 125. This plan writes no application code; the executor works on an isolated branch and re-measures the baseline on its own branch tip (see Red) rather than trusting the number quoted here, because slices 01, 02, 03 and 04 all land first and each adds test files.
- **Merge conflicts in `SalesOpsApp.tsx` with slices 01, 04, 09, 10, 11 and 12.** All six edit the same file; 01 edits the wizard wrapper at `:1133-1149` and `:3644`, and 04 and 11 edit the same wizard body region. The batch runs serial on `master` with one `--no-ff` merge per slice, so this slice must be rebased on whatever landed first and its ORACLE re-run before the merge. Keeping the diff to picker swaps only, touching neither the remount key (slice 01) nor the row grid templates (slice 04), and refusing the adapter-component refactor, is what keeps the conflict surface to the lines actually being replaced.
- **`bootstrap` is name-ordered, so an inline create can reorder every picker's options mid-interaction.** Harmless for the migrated pickers because `value` is an id and the primitive resolves the trigger label by `options.find(o => o.value === value)`, so a reorder cannot change what is selected. The only thing that ever cared was the wizard `key`, which slice 01 already fixed.
- **`routing.test.tsx`'s hook mock lacks `mutateAsync`.** Only reachable from a create row, which that test never clicks, but Green step 6 keeps the calls inside function bodies and Test fallout item 9 adds `mutateAsync` to the mock so a future slice does not trip on it.
