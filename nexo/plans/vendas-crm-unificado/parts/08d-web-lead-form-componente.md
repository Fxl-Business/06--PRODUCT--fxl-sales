# Part 08d - LeadForm component

Part of slice `08-web-lead-form-unico`.

## Context

- Replaces, in 08e, `LeadDialog.tsx` (full edition, 405 lines) and `ContactLeadDialog.tsx` (leads edition, 361 lines). Their shared structure is the model: `Dialog` / `DialogContent className="max-w-xl"`, a `max-h-[60vh]` scroll column, the footer `Excluir lead` / `Cancelar` / `Salvar` with `data-lead-save`, the inline blocked notice `data-lead-blocked`, the inline save error `data-lead-save-error` (`ContactLeadDialog.tsx` lines 152-361).
- DOM contract kept from the old dialogs (the tests port their helpers): ids `lead-contact-name`, `lead-phone`, `lead-email`, `lead-estimated-value`, `lead-client-label` (the Cliente `aria-labelledby`), seller picker `aria-label="Vendedor responsável"`.
- Class helpers from `apps/web/src/sales-ops/leads/board-ui.ts`: `fieldLabelClass`, `formInputClass`, `formSelectClass`, `formTextareaClass`, `blockedNoticeClass`, `primaryButtonClass`, `secondaryButtonClass`, `dangerOutlineButtonClass`.
- Inline layers: `Combobox` already calls `useInlineLayer(open)` itself (`apps/web/src/components/ui/combobox.tsx`), so every picker here is covered. This form adds NO other inline layer (no `InfoHint`). If a later change adds one, it must call `useInlineLayer(open)` from `@/components/ui/inline-layer`.
- Copy: `LEAD_FORM_COPY` and the pure functions come from slice 08c (`lead-form.ts`); the picker copy from `client-picker-copy.ts` (`clientPickerCopy(canCreate)`: `Buscar ou criar novo cliente` only while `onCreateClient` is wired).
- Catalog: `SalesOpsProduct` (`apps/web/src/sales-ops/types.ts`) has `id`, `name`, `kind`, `status`; kind is read ONLY through `isServiceProduct` (`apps/web/src/sales-ops/calculations.ts` line 72).

## Design

`LeadFormFields.tsx` - the dynamic renderers.

```tsx
export type FieldRendererProps = {
  definition: FieldDefinition;
  draft: FieldDraft | undefined;
  onChange: (next: FieldDraft) => void;
  products: SalesOpsProduct[];
  sales: ComboboxOption[];
};
export type LeadFormFieldsProps = {
  definitions: FieldDefinition[];            // the full list; Cliente-target ones are skipped inside
  drafts: Record<string, FieldDraft>;
  onChange: (fieldId: string, next: FieldDraft) => void;
  products: SalesOpsProduct[];
  sales?: ComboboxOption[];
};
```

- `LeadFormFields` maps `renderableDefinitions(definitions)` (08c) to `<div className="flex flex-col gap-1.5" data-lead-field={definition.key} key={definition.id}>` holding a label (`fieldLabelClass`, `htmlFor={`lead-field-${definition.id}`}`, text `definition.label`) and the renderer `FIELD_RENDERERS[definition.kind]`.
- `FIELD_RENDERERS: Record<FieldKind, (props: FieldRendererProps) => React.JSX.Element>`:
  - `text`: `<textarea className={formTextareaClass} id=... maxLength={4000} />`.
  - `number`: `<Input className={formInputClass} id=... inputMode="decimal" step="any" type="number" />`.
  - `money`: `<Input className={formInputClass} id=... inputMode="decimal" min="0" step="0.01" type="number" />` (reais as typed; 08c converts to cents).
  - `date`: `<Input className={formInputClass} id=... type="date" />`.
  - `options`: `<Combobox aria-label={definition.label} className={formSelectClass} id=... onChange=... options={[{ value: '', label: 'Nenhum' }, ...(definition.options ?? []).map((o) => ({ value: o.key, label: o.label }))]} value={draft string || null} />`.
  - `reference`: `REFERENCE_RENDERERS[definition.referenceTarget]`.
- `REFERENCE_RENDERERS: Record<Exclude<FieldReferenceTarget, 'cliente'>, (props) => JSX.Element>` (a `cliente`-target definition never reaches a renderer):
  - `produto` and `servico` -> `CatalogReferenceField`: chips of the draft items (`FieldReferenceItem[]`), a catalog `Combobox` (options = active products filtered by `isServiceProduct` equal to `target === 'servico'`, minus the already chosen ids; `aria-label={`${definition.label} - catalogo`}`) plus an `Adicionar` button (`secondaryButtonClass` + `self-stretch`), and a free line: `<Input id=`lead-field-${id}-free`>` plus `+ Adicionar item livre` (`self-stretch shrink-0 whitespace-nowrap`). A free item is `{ id: null, name }`. When `definition.multiple` is false, adding REPLACES the single item. Chip remove button: `aria-label={`Remover ${name}`}`, text `x`.
  - `contato` -> a single text `<Input>` holding the name; the draft is `[{ id: null, name }]` (empty text -> `[]`).
  - `venda` -> a `Combobox` over `sales` (empty `sales` renders the muted text `Nenhuma venda disponível.`); the draft is `[{ id, name: label }]`.

`LeadForm.tsx`:

```tsx
export type LeadFormProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** null means create. The caller keys the form by lead id (mount-scoped state). */
  initial: SalesOpsLead | null;
  definitions: FieldDefinition[];
  clients: SalesOpsClient[];
  products: SalesOpsProduct[];
  sales?: ComboboxOption[];
  sellers: ComboboxOption[];
  showSellerPicker?: boolean;        // default true; false omits the key
  onCreateClient?: (name: string) => Promise<ComboboxOption | null>;
  onSubmit: (payload: LeadWritePayload) => Promise<unknown> | void;
  pending?: boolean;
  /** Create only: the pipeline the board is showing. */
  pipelineId?: string;
  onDelete?: () => void;            // rendered only when initial?.id
};
```

State (all `useState` initializers, no effect): `draft = leadFormDraftFromLead(initial, definitions)`, `hadValue = useMemo/useState(() => fieldIdsWithValue(initial))`, `touched: ReadonlySet<string>`, `submitted`, `submitting`, `saveError`, `prefilled: boolean`.

Layout, in this order inside the scroll column:
1. Nome: `<label htmlFor="lead-contact-name">{nameLabel}<span aria-hidden> *</span></label>` + `<Input id="lead-contact-name" maxLength={140} required />`.
2. Contato: two inputs side by side in a `grid gap-3 sm:grid-cols-2`: `lead-phone` (`type="tel"`, `autoComplete="tel"`, `maxLength={40}`) and `lead-email` (`type="email"`, `autoComplete="email"`, `maxLength={254}`); under them a muted line `Informe ao menos um: telefone ou e-mail.` (`mutedStateClass`); when `prefilled`, a second muted line `<p data-contact-prefilled="">{contactPrefilled}</p>`; typing in phone or email sets `prefilled` false.
3. Cliente, ALWAYS rendered, never conditional on `definitions`: `<div data-lead-field="cliente" data-field-removable="false" className="flex flex-col gap-1.5">`, `<span id="lead-client-label" className={fieldLabelClass}>{clientLabel}</span>`, a row `flex items-center gap-2` with `<Combobox aria-labelledby="lead-client-label" className={formSelectClass} entityGender="m" entityLabel="cliente" onChange={selectClient} {...(canCreate ? { onCreate: (name) => void createClient(name) } : {})} options={clientOptions} placeholder={copy} searchPlaceholder={copy} value={draft.clientId} valueLabel={draft.clientName || undefined} />` and `<button className={`${secondaryButtonClass} self-stretch`} onClick={() => selectClient('')} type="button">Limpar</button>`; `copy = clientPickerCopy(Boolean(onCreateClient))`. There is NO control that removes or hides this block (no `data-field-remove`, no close button on it).
4. Valor estimado: `lead-estimated-value`, `Input type="number" min="0" step="0.01" inputMode="decimal"`.
5. `<LeadFormFields .../>` (dynamic fields).
6. Vendedor (only when `showSellerPicker`): `<Combobox aria-label={sellerLabel} className={formSelectClass} onChange={...} options={sellers} placeholder={sellerPlaceholder} value={draft.sellerPersonId} />`, no `onCreate`.
7. Blocked notice `<p className={blockedNoticeClass} data-lead-blocked="true">` shown iff `problem && (submitted || touched.has(problem.field))`; save error `<p className={blockedNoticeClass} data-lead-save-error="true" role="alert">`.
Footer: `Excluir lead` (only `initial?.id && onDelete`, `dangerOutlineButtonClass sm:mr-auto`, `data-delete-lead-form=""`, label `LEAD_DELETE_COPY.formButton` from `./delete-copy`, disabled while submitting), `Cancelar`, `Salvar` (`data-lead-save="true"`, `type="button"`, `disabled={problem !== null || pending || submitting}`, `onClick={() => void save()}`).

Behaviour:
- `clientOptions = React.useMemo(() => clients.map((row) => ({ value: row.id, label: row.name })), [clients])` (the form builds its own options from the `SalesOpsClient[]` it receives, because the prefill needs each row's `contact`).
- `selectClient(value)`: `const picked = clients.find((c) => c.id === value)`; one `setDraft` that sets `clientId: value || null`, `clientName: picked?.name ?? ''` and spreads `prefillContactFromClient(current, picked)`; if the spread was non-empty `setPrefilled(true)`. The vendedor is NEVER touched by this function (a cliente has no responsible).
- `createClient(name)`: `const created = await onCreateClient(name)`; if `null` return; set `clientId = created.value`, `clientName = created.label`. (No prefill: a new cliente has no contact yet.) Without `onCreateClient` the create row is not offered at all (`onCreate` not passed).
- `save()`: `setSubmitted(true)`; if `problem !== null || submitting` return; build `buildLeadWritePayload(draft, definitions, { id: initial?.id, includeSeller: showSellerPicker, pipelineId, hadValue })`; `await onSubmit(payload)`; on rejection `setSaveError(leadFormSaveErrorCopy(error))`, `setSubmitting(false)` and RETURN (the dialog stays open with every typed value); on success `onOpenChange(false)`.
- `touched`: `setField(key, value)` adds the problem-field id: `contactName` -> `contactName`; phone or email -> `contact` and `contactEmail`; dynamic field -> `field:<id>`.
- The title is `LEAD_FORM_COPY.editTitle` when `initial?.id` else `createTitle`; description is `LEAD_FORM_COPY.description`.
- Never render a raw id: labels come from names; the cliente trigger uses `valueLabel`.

## Steps (TDD)

1. Write `lead-form.test.tsx` (Tests). Run: fails (components missing).
2. Create `LeadFormFields.tsx`, then `LeadForm.tsx`.
3. Run the oracle green; lint; type-check.

## Tests (`lead-form.test.tsx`, happy-dom, REAL `Dialog` and REAL `Combobox`; DO NOT mock `@/components/ui/dialog`)

Helpers copied from `contact-lead-dialog.test.tsx` lines 30-150 (`act`, `settle`, `click`, `escape`, `typeInto`, `input`, `saveButton`, `blockedText`, `comboboxSearch`, `pickClient`, `clientTrigger`). Fixtures: `CLIENTS = [{id:'c1', name:'Acme', contact:'ana@acme.com'}, {id:'c2', name:'Beta', contact:'(11) 99999-0000'}, {id:'c3', name:'Gama', contact:null}]` (full `SalesOpsClient` shape), `DEFS` as in 08c plus the Cliente system definition, `SELLERS`.

- `requires a name and one contact before Salvar enables`: create; Salvar disabled; type name -> still disabled and `blockedText()` is null (nothing touched on the contact yet); type phone -> enabled; clear phone, type e-mail -> enabled; type `'ana@'` -> disabled and the e-mail message shows.
- `shows the name error only after Nome changed, and the contact error after Telefone or E-mail changed`.
- `the Cliente picker is always present, even with no definitions`: `definitions=[]` -> exactly one `[data-lead-field="cliente"]` containing a `[role="combobox"][aria-labelledby="lead-client-label"]`.
- `the Cliente is not duplicated nor removable when the org lists it`: with the system definition in `DEFS` still exactly one `[data-lead-field="cliente"]`; `dialogNode().querySelector('[data-field-remove]')` is `null`; no button whose text matches `/remover campo|ocultar campo/i`; `data-field-removable` equals `'false'`.
- `creates a cliente by name inline` (same interaction as `contact-lead-dialog.test.tsx` lines 317-336): `onCreateClient` resolves `{value:'c9', label:'Nova Obra'}`; after Salvar the payload has `clientId: 'c9'`, `clientName: 'Nova Obra'`.
- `the picker reads Buscar ou criar novo cliente only while onCreateClient is wired`: with it, trigger text and the search input `aria-label` equal `CLIENT_PICKER_COPY.searchOrCreate`; without it both equal `CLIENT_PICKER_COPY.searchOnly` and there is no `criar` option.
- `choosing an empresa prefills a blank e-mail, a blank phone, and nothing else`: pick Acme -> `input('lead-email').value === 'ana@acme.com'`, phone blank, `[data-contact-prefilled]` visible; reset, pick Beta -> phone filled; pick Gama (contact null) -> both stay blank and no prefilled line.
- `a prefill never overwrites what the operator typed`: type phone `'(21) 1'`, then pick Beta -> phone still `'(21) 1'`.
- `choosing an empresa leaves the responsável alone`: pick a vendedor first, then pick Acme; the vendedor trigger text is unchanged. (A cliente has no responsible seller; this pins that.)
- `Limpar clears the cliente but keeps the typed contact`.
- `renders each dynamic field by kind`: `[data-lead-field="descricao"] textarea`, `[data-lead-field="qtd"] input[type="number"]`, `[data-lead-field="orcamento"] input[step="0.01"]`, `[data-lead-field="prazo"] input[type="date"]`, `[data-lead-field="origem"] [role="combobox"]`, `[data-lead-field="produtos"]` with a combobox and an input named `lead-field-<id>-free`.
- `submits the dynamic values encoded by kind`: fill name, phone, qtd `3`, orcamento `1500.50`, prazo `2026-11-01`, pick origem `Site`, add a catalog produto and the free item `Consultoria avulsa`; the payload `fields` equal `[ {fieldId:'f-desc',...}, ... ]` with `orcamento` = `150050`, `origem` = `'site'`, `produtos` = `[{id:'P1',name:'Site institucional'},{id:null,name:'Consultoria avulsa'}]`.
- `a single (multiple:false) reference replaces its item`.
- `Escape on the open cliente picker closes only the picker` (copy of `contact-lead-dialog.test.tsx` lines 387-401, including the positive control that a bare Escape afterwards calls `onOpenChange(false)`).
- `Escape on an open dynamic options picker closes only that picker`.
- `a refused save keeps the dialog open with the typed values and an inline error`: `onSubmit` rejects `new Error('x')`; `[data-lead-save-error]` text equals `LEAD_FORM_COPY.saveFailed`; `input('lead-contact-name').value` unchanged; `onOpenChange` never called with `false`.
- `a 400 no_open_stage shows the no-etapa copy` (`Object.assign(new Error('x'), {status: 400, reason: 'no_open_stage'})`).
- `closes only once the save resolves`.
- `edit mode seeds the lead, titles Editar lead and sends the id`: lead fixture with `fields`; title `Editar lead`; payload `id` equals the lead id; clearing a seeded dynamic field sends `value: null` for it.
- `Excluir lead renders on edit only and only when onDelete is given`.
- `hides the vendedor and omits sellerPersonId when showSellerPicker is false`.
- `stretches the inline action buttons`: `Limpar`, `Adicionar` and `+ Adicionar item livre` have class `self-stretch`; `Cancelar` does not.
- `never renders a raw id`: dialog `textContent` contains neither the client uuid, the seller uuid nor a field-definition id.

## Affected tests search

Searched `apps/web/src` for `LeadForm`, `lead-form`, `data-lead-field`: none exists. The old dialogs and their tests are untouched here and keep passing. Nothing is impacted.

## Commands

- Oracle: `pnpm --filter @fxl-sales/web exec vitest run src/sales-ops/leads/__tests__/lead-form.test.tsx`
- Affected: `pnpm --filter @fxl-sales/web exec vitest run src/sales-ops/leads`
- `pnpm --filter @fxl-sales/web lint` and `pnpm --filter @fxl-sales/web type-check`

## Risks

- A text field as a `textarea` for every `text` definition is taller than a one-line input; accepted, it matches the old Descrição field and keeps one renderer per kind.
- The Cliente block does not depend on `definitions`, so a failed `GET /field-definitions` still lets the operator create a lead (only the extra fields are missing).
