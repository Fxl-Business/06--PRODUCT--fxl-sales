# Part 08e - LeadForm cutover

Part of slice `08-web-lead-form-unico`.

## Context

- `LeadsBoardContainer.tsx` (447 lines) mounts `LeadDialog` for `fieldSet === 'full'` (lines 366-380) and `ContactLeadDialog` for `'contact'` (lines 382-401), seeds them with `leadToSeed` (lines 98-111) / `leadToContactSeed`, and builds the edit undo in `saveWithUndo` (lines 209-221).
- `SalesOpsApp.tsx` already passes `onCreateClient` (lines 2381-2384) and `clients={persistedBootstrap.clients}`, `products={persistedBootstrap.products}` to the container in BOTH editions. No `SalesOpsApp.tsx` edit is needed in this slice.
- The container still derives `fieldSet = leadFieldSet(useSalesEdition())` for the board layout (card and Lista differ by edition; phase 3 removes editions). It no longer uses `fieldSet` to choose a dialog or a payload.
- Slice 08c/08d deliver `LeadForm`, `leadToWriteSeed`, `fieldIdsWithValue`, `LeadWritePayload`; slice 08a delivers `useFieldDefinitions`.
- `contact-lead.ts` keeps what the board renders: `CONTACT_LEAD_COPY` (only the keys `noContact`, `birthdayPrefix`, `emptyStagesAdmin`, `emptyStagesAdminAction`, `emptyStagesSeller`), `CONTACT_LIST_HEADERS`, `leadContactLine`, `leadBirthdayLabel`. Everything else in it (draft type, `contactDraftFromSeed`, `validateContactLeadDraft`, `buildContactLeadPayload`, `leadToContactSeed`, `contactLeadSaveErrorCopy`, the dialog-only copy keys) is removed.

## Design

1. `LeadsBoardContainer.tsx`:
   - remove imports of `ContactLeadDialog`, `LeadDialog`, `leadToContactSeed`, `SaveContactLeadPayload`, `SaveLeadPayload`, and the local `leadToSeed`, `dialogSeed`/`contactSeed` states, `clientOptions`, `productOptions`.
   - add `import { LeadForm } from './LeadForm'; import { leadToWriteSeed } from './lead-form'; import { useFieldDefinitions } from './crm-hooks'; import type { LeadWritePayload } from './api';`.
   - `const definitionsQuery = useFieldDefinitions(); const definitions = definitionsQuery.data ?? [];`
   - keep `const [dialogOpen, setDialogOpen]` and `editingLead`. `onCreateLead` sets `editingLead` null and opens; `onEditLead` sets `editingLead = lead` and opens.
   - `saveWithUndo(payload: LeadWritePayload)`:
     ```ts
     const previous = editingLead?.id === payload.id ? editingLead : null;
     const result = await saveLead.mutateAsync(payload);
     if (previous) {
       const previousIds = new Set((previous.fields ?? []).map((f) => f.fieldId));
       const added = (result.lead.fields ?? []).map((f) => f.fieldId).filter((id) => !previousIds.has(id));
       publishUndo('Lead editado', async () => {
         await requireUnchangedLead(result.lead);
         return saveLead.mutateAsync(leadToWriteSeed(previous, added));
       });
     }
     ```
   - ONE mount replacing both dialogs, rendered only after the definitions settled so the mount-scoped seed sees them (`!definitionsQuery.isPending`):
     ```tsx
     {dialogOpen && !definitionsQuery.isPending ? (
       <LeadForm
         clients={clients}
         definitions={definitions}
         initial={editingLead}
         key={editingLead?.id ?? 'novo'}
         onCreateClient={onCreateClient}
         onDelete={requestDeleteFromForm}
         onOpenChange={setDialogOpen}
         onSubmit={saveWithUndo}
         open
         pending={saveLead.isPending}
         products={products}
         sellers={sellers}
         showSellerPicker={isAdmin}
       />
     ) : null}
     ```
   - `onCreateClient` prop doc comment: drop "Leads edition only"; it now applies to both editions.
2. `hooks.ts`: `useSaveLead` generic `SaveLeadPayload | SaveContactLeadPayload` -> `LeadWritePayload`; update the imports at lines 15-20.
3. `api.ts`: delete `SaveLeadProductPayload`, `SaveLeadPayload`, `ContactLeadPayload`, `SaveContactLeadPayload` and their comments (lines 40-98); `saveLead: ({ id, ...body }: LeadWritePayload, token)`.
4. `contact-lead.ts`: reduce to the five copy keys and the three kept exports listed above; drop the now-unused imports (`isIsoDay`, `parseCurrencyInputToCents`, `SaveContactLeadPayload`).
5. `client-picker-copy.ts`: rewrite the header comment only (the picker copy is the same string pair; the comment now says "the cliente picker of the one LeadForm"). `CLIENT_PICKER_COPY` and `clientPickerCopy` do not change.
6. Delete `LeadDialog.tsx` and `ContactLeadDialog.tsx`.
7. `board-write-surface.test.ts` `OWNED_FILES` (lines 60-76): remove `'LeadDialog.tsx'` and `'ContactLeadDialog.tsx'`; add `'LeadForm.tsx'`, `'LeadFormFields.tsx'`, `'lead-form.ts'`. The test `the scanner actually read every file this slice owns` derives its expected size from the list, so nothing else changes.
8. `CLAUDE.md`, section "Kanban de leads" and "Edição Leads": replace (a) the sentence starting `In the FULL edition creating a lead never creates a cliente` through `The leads edition creates one inline (see Edição Leads).` by `Both editions create the cliente inline from the picker of the ONE LeadForm (Buscar ou criar novo cliente); the cliente is the lead's client_id, never a dynamic field.`; (b) the bullet starting `Leads writes use ContactLeadFieldsSchema` by `Lead writes use the single LeadWriteSchema through LeadForm (apps/web/src/sales-ops/leads/LeadForm.tsx, logic in lead-form.ts): nome and one contact (telefone or e-mail) are required, dynamic fields come from GET /field-definitions, the Cliente is always present and not removable.`; (c) the bullet starting `The contact dialog's empresa picker creates a client by name inline` by `LeadForm's empresa picker creates a client by name inline: the seam is SalesOpsApp's createClientByName handed to LeadsBoardContainer as onCreateClient; the copy is clientPickerCopy (oracle client-picker-copy.test.ts). Choosing a cliente prefills only blank contact fields; a cliente has no responsible seller, so the vendedor is never prefilled.`; (d) `The contact lead dialog stays open...` -> `LeadForm stays open...`.
9. `nexo/knowledge/reference/kanban-de-leads.md`: add a section `## LeadForm (one component for both editions)` with one sentence per line: replaces `LeadDialog` and `ContactLeadDialog`; required fields; payload `LeadWritePayload`; wire assumptions W1/W2 (from 08c); Cliente block rule; prefill rule; oracles `lead-form.test.ts`, `lead-form.test.tsx`, `leads-contact-container.test.tsx`.

## Steps (TDD)

1. Edit the affected tests first (see Tests) and run them: they fail against the old container.
2. Apply Design items 1-7.
3. Run the whole `src/sales-ops/leads` folder and `src/sales-ops/__tests__`; fix only by the rules in Tests.
4. Apply items 8-9 (docs).
5. `git grep -n "LeadDialog\|ContactLeadDialog\|buildContactLeadPayload\|leadToContactSeed\|SaveContactLeadPayload" apps/web/src` must print nothing except `MoveLeadDialog` and `LeadDeleteDialog` lines (those two names contain `LeadDialog` as a suffix; check with `grep -w`).

## Tests

`leads-contact-container.test.tsx` (the oracle; it mocks `../hooks`, so add a second mock):
- add `vi.mock('../crm-hooks', () => ({ useFieldDefinitions: () => ({ isPending: false, data: mocks.definitions }), usePipelines: ... }))` and `mocks.definitions = []` in the hoisted object; `usePipelines` is NOT needed yet (10a).
- `Novo lead mounts the LeadForm in the leads edition`: `lead-estimated-value` and `lead-phone` exist, `lead-company-text` and `lead-birth-date` do not.
- `Novo lead mounts the same LeadForm in the full edition` (replaces `Novo lead mounts LeadDialog`): identical assertions; also `lead-client-label` exists.
- every test that saved with only `lead-contact-name` also types `lead-phone` (`typeInto('lead-phone', '11999990000')`) before `[data-lead-save]`.
- `editing seeds the form and saves with the lead id`: unchanged assertions (`id`, `contactName`, `contactPhone`).
- `a seller gets no vendedor picker and creates with no sellerPersonId key` and `an admin keeps the vendedor picker and sends the key` stay as they are.
- `awaits a full-edition create and offers no edit undo`: replace `typeInto('lead-company-text', 'Acme')` by `typeInto('lead-phone', '11999990000')`.
- new `waits for the field definitions before mounting the form`: `useFieldDefinitions` returns `isPending: true` -> after the create click no `[role="dialog"]`; flip to settled and re-render -> the dialog mounts.
- new `a dynamic field value reaches the save payload`: `mocks.definitions = [descricao text def]`, type into `#lead-field-<id>`, save, the `mutateAsync` payload `fields` contains `{ fieldId, value }`.

`lead-undo.test.tsx`: the fetcher also answers `GET .../field-definitions` with `{ fields: [cliente, descricao(f-desc)] }`; `original.fields = [{ fieldId: 'f-desc', key: 'descricao', value: 'Antes' }]` (and `description: 'Antes'` stays for the card); the PATCH handler writes `contactName`, `contactPhone` and merges `body.fields` into `row.fields`. The test becomes `restores the prior fields by inverse PATCH` (no `it.each`, no `Remover Original item`, no products): edit the name to `Ana Nova`, save, assert `calls[0].method === 'PATCH'`, click `[data-undo-action]`, assert `calls[1].body` matches `{ contactName: 'Ana', contactPhone: '123', contactEmail: 'ana@example.com', fields: [{ fieldId: 'f-desc', value: 'Antes' }] }`. The stale-edit case keeps its shape.

`lead-delete.test.tsx` section `deleting from the edit form`: render `<LeadForm definitions={[]} clients={[]} products={[]} sellers={[]} ...>` instead of the two old dialogs; the parametrised pair becomes one case; the assertions (button shows on edit only, a confirmed delete closes the form, Escape on the confirmation closes only the confirmation) are unchanged.

`move-dialog-inline-layer.test.tsx`: replace the `LeadDialog` block (line ~193) with `LeadForm` (props `definitions={[]}`, `clients={[]}`, `products={[]}`, `sellers={SELLERS}`) and target the cliente picker by `aria-labelledby="lead-client-label"`; the Escape assertions are unchanged.

`leads-api-contract.test.ts`: where it builds a payload with `buildContactLeadPayload(contactDraftFromSeed(...), ...)` use `buildLeadWritePayload(leadFormDraftFromLead(lead, []), [], { id, includeSeller: true })`; the wire assertions (PATCH with the id in the path, body without the id, token on every call) stay.

No test is weakened: each removed test has its equivalent in `lead-form.test.ts` / `lead-form.test.tsx` (08c, 08d). The executor lists, in the exec note, which new test replaces each deleted one.

## Commands

- Oracle: `pnpm --filter @fxl-sales/web exec vitest run src/sales-ops/leads/__tests__/leads-contact-container.test.tsx`
- Affected: `pnpm --filter @fxl-sales/web exec vitest run src/sales-ops/leads src/sales-ops/__tests__`
- Guard: `pnpm --filter @fxl-sales/web exec vitest run src/sales-ops/leads/__tests__/board-write-surface.test.ts`
- `pnpm --filter @fxl-sales/web lint` and `pnpm --filter @fxl-sales/web type-check`

## Risks

- Edit undo now depends on the response carrying `fields`; if `07a` omits `fields` on a write response, `added` is empty and an added field survives an undo. Flagged to the orchestrator with W1.
- The form mounts only after `GET /field-definitions` settles (success or error). On error `definitions` is `[]` and the lead still saves; the extra fields are simply absent.
- The big test rewrite is the risk of this slice; it is mechanical (same helpers, same ids).
