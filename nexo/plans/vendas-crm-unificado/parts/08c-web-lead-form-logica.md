# Part 08c - LeadForm logic (pure)

Part of slice `08-web-lead-form-unico`.

## Context

- Today two contracts exist: `SaveLeadPayload` (full, `LeadDialog.tsx`) and `SaveContactLeadPayload` (`contact-lead.ts` `buildContactLeadPayload`, lines 124-148). The phase 2 API collapses them into ONE `LeadWriteSchema` (contract section "Cutover"): `contactName` required, at least one of `contactPhone` / `contactEmail`, everything else optional, dynamic values in `fields`.
- Field definitions come from `GET /field-definitions` (slice 08a `FieldDefinition`). The Cliente system field (`key 'cliente'`, `isSystem true`, `removable false`, `referenceTarget 'cliente'`) is backed by the lead columns `client_id` / `client_name_snapshot`, NOT by a `fields` entry.
- A `sales_ops_clients` row holds `name` and one free-text `contact` string and NOTHING about a responsible seller (`apps/api/src/db/schema.ts` lines 747-760, `apps/web/src/sales-ops/types.ts` lines 145-157). So choosing an empresa prefills only the contact. The responsible stays untouched; this is stated in the UI contract and tested.
- Helpers to reuse: `parseCurrencyInputToCents` (`apps/web/src/sales-ops/calculations.ts` line 436), `isIsoDay` (`@fxl-sales/shared-utils/sao-paulo-day`).
- Wire assumption W1 (beyond the contract, isolated here and in `api.ts`): the write body carries `fields: Array<{ fieldId: string; value: ... }>`; a field that is not listed stays untouched; `value: null` clears it. `pipelineId` is sent on create only. If `07a` ships a different envelope, only `buildLeadWritePayload` and `leadToWriteSeed` change.
- Wire assumption W2: a non-admin viewer sends NO `sellerPersonId` and the API assigns the caller's own pessoa in both editions (today only the leads edition does). 07a must keep that; flagged to the orchestrator.

## Design (exact API of `lead-form.ts`)

```ts
import { isIsoDay } from '@fxl-sales/shared-utils/sao-paulo-day';
import { parseCurrencyInputToCents } from '../calculations';
import type { FieldDefinition, FieldKind, FieldReferenceItem } from './crm-types';
import type { LeadFieldWrite, LeadFieldWriteValue, LeadWritePayload } from './api';
import type { SalesOpsLead } from './types';

export const LEAD_FORM_COPY = { createTitle: 'Novo lead', editTitle: 'Editar lead',
  description: 'Nome e contato são obrigatórios. O restante é opcional.',
  nameLabel: 'Nome do contato', phoneLabel: 'Telefone / WhatsApp', emailLabel: 'E-mail',
  clientLabel: 'Cliente', valueLabel: 'Valor estimado (R$)', sellerLabel: 'Vendedor responsável',
  sellerPlaceholder: 'Selecione o vendedor', clearLabel: 'Limpar',
  contactPrefilled: 'Contato preenchido a partir do cliente.',
  nameRequired: 'Informe o nome.', contactRequired: 'Informe o telefone ou o e-mail do contato.',
  emailInvalid: 'Informe um e-mail válido.', numberInvalid: 'Informe um número válido.', dateInvalid: 'Informe uma data válida.',
  noStageError: 'Nenhuma etapa ativa no funil. O lead não foi salvo.',
  saveFailed: 'Não foi possível salvar o lead. Tente novamente.' } as const;

export type FieldDraft = string | FieldReferenceItem[];
export type LeadFormDraft = { contactName: string; contactPhone: string; contactEmail: string;
  clientId: string | null; clientName: string; estimatedValue: string; sellerPersonId: string | null;
  fields: Record<string, FieldDraft> };
export type LeadFormProblem = { field: string; message: string };
```

`field` identifiers of a problem: `'contactName' | 'contact' | 'contactEmail' | 'field:<fieldId>'`.

Functions:

1. `isClienteDefinition(def: FieldDefinition): boolean` -> `def.referenceTarget === 'cliente'`. Every dynamic renderer and the payload builder SKIP such a definition: the dedicated Cliente section owns it.
2. `renderableDefinitions(defs): FieldDefinition[]` -> `defs.filter((d) => !isClienteDefinition(d)).sort((a, b) => a.position - b.position)`.
3. Seed lookup (object keyed by kind, no switch):
   ```ts
   const SEED_BY_KIND: Record<FieldKind, (value: LeadFieldValue['value'] | undefined) => FieldDraft> = {
     text: (v) => (typeof v === 'string' ? v : ''),
     number: (v) => (typeof v === 'number' ? String(v) : typeof v === 'string' ? v : ''),
     money: (v) => (typeof v === 'number' ? (v / 100).toFixed(2) : ''),
     date: (v) => (typeof v === 'string' ? v : ''),
     options: (v) => (typeof v === 'string' ? v : ''),
     reference: (v) => (Array.isArray(v) ? v.map((i) => ({ id: i.id, name: i.name })) : []),
   };
   ```
   (`LeadFieldValue` type imported from `./crm-types`.)
4. `leadFormDraftFromLead(lead: SalesOpsLead | null, defs: FieldDefinition[]): LeadFormDraft`:
   `contactName: lead?.contactName ?? ''`, `contactPhone: lead?.contactPhone ?? ''`, `contactEmail: lead?.contactEmail ?? ''`, `clientId: lead?.clientId ?? null`, `clientName: lead?.clientNameSnapshot ?? ''`, `estimatedValue: lead?.estimatedValueBrl ? (lead.estimatedValueBrl / 100).toFixed(2) : ''`, `sellerPersonId: lead?.sellerPersonId ?? null`, `fields`: for each renderable def, `SEED_BY_KIND[def.kind](lead?.fields?.find((f) => f.fieldId === def.id)?.value)`.
5. `fieldIdsWithValue(lead: SalesOpsLead | null): Set<string>` -> ids of `lead?.fields` whose value is neither `null` nor an empty array nor `''`.
6. `splitClientContact(contact: string | null | undefined): { phone: string; email: string }`: trim; empty -> both `''`; contains `@` -> `{ phone: '', email: trimmed }`; else `{ phone: trimmed, email: '' }`.
7. `prefillContactFromClient(draft: Pick<LeadFormDraft, 'contactPhone' | 'contactEmail'>, client: { contact: string | null } | undefined): Partial<Pick<LeadFormDraft, 'contactPhone' | 'contactEmail'>>`: returns only the keys that are blank in `draft` and non-blank in `splitClientContact(client?.contact)`; `{}` when `client` is undefined. NEVER overwrites typed text. Comment: "a cliente has no responsible seller (no column), so only the contact is prefilled".
8. `validateLeadFormDraft(draft: LeadFormDraft, defs: FieldDefinition[]): LeadFormProblem | null`, first problem wins in this order:
   - blank trimmed name -> `{ field: 'contactName', message: nameRequired }`;
   - blank phone AND blank email -> `{ field: 'contact', message: contactRequired }`;
   - non-blank email failing `/^[^\s@]+@[^\s@]+\.[^\s@]+$/` -> `{ field: 'contactEmail', message: emailInvalid }`;
   - then each renderable def in position order through `FIELD_CHECK_BY_KIND: Record<FieldKind, (draft: FieldDraft | undefined) => string | null>`: `number` and `money`: non-blank and `!Number.isFinite(Number(value))` -> `numberInvalid`; `date`: non-blank and `!isIsoDay(value)` -> `dateInvalid`; `text`, `options`, `reference` -> `null`. Problem `field` is `field:${def.id}`.
9. `fieldDraftToWrite(def, draft)` through `WRITE_BY_KIND: Record<FieldKind, (draft: FieldDraft | undefined) => LeadFieldWriteValue>`:
   - text/options/date: `typeof draft === 'string' && draft.trim() !== '' ? draft.trim() : null`;
   - number: blank -> `null`, else `Number(draft)`;
   - money: blank -> `null`, else `parseCurrencyInputToCents(draft)`;
   - reference: array with items -> `items.map((i) => ({ id: i.id, name: i.name.trim() })).filter((i) => i.name !== '')`; empty/absent -> `null`.
10. `buildLeadWritePayload(draft, defs, options: { id?: string; includeSeller: boolean; pipelineId?: string; hadValue?: ReadonlySet<string> }): LeadWritePayload`:
    ```ts
    const fields: LeadFieldWrite[] = [];
    for (const def of renderableDefinitions(defs)) {
      const value = fieldDraftToWrite(def, draft.fields[def.id]);
      if (value !== null || options.hadValue?.has(def.id)) fields.push({ fieldId: def.id, value });
    }
    return {
      ...(options.id ? { id: options.id } : {}),
      contactName: draft.contactName.trim(),
      contactPhone: trimmedOrNull(draft.contactPhone),
      contactEmail: trimmedOrNull(draft.contactEmail),
      clientId: draft.clientId,
      clientName: trimmedOrNull(draft.clientName),
      estimatedValueBrl: parseCurrencyInputToCents(draft.estimatedValue),
      ...(options.includeSeller ? { sellerPersonId: draft.sellerPersonId } : {}),
      ...(!options.id && options.pipelineId ? { pipelineId: options.pipelineId } : {}),
      fields,
    };
    ```
    (`trimmedOrNull` is a private helper in this file; same semantics as the one in `contact-lead.ts`. No lowercasing: the API owns it.)
11. `leadToWriteSeed(lead: SalesOpsLead, clearFieldIds: readonly string[] = []): LeadWritePayload`: the full previous state as a payload, used by the edit-undo: `{ id: lead.id, contactName, contactPhone: lead.contactPhone, contactEmail: lead.contactEmail, clientId: lead.clientId, clientName: lead.clientNameSnapshot || null, estimatedValueBrl: lead.estimatedValueBrl, sellerPersonId: lead.sellerPersonId, fields: [...(lead.fields ?? []).map((f) => ({ fieldId: f.fieldId, value: f.value })), ...clearFieldIds.map((fieldId) => ({ fieldId, value: null }))] }`.
12. `leadFormSaveErrorCopy(error: unknown): string`: structural (status 400 and `reason === 'no_open_stage'` -> `noStageError`; anything else -> `saveFailed`). No import of the HTTP client.

Changes to `apps/web/src/sales-ops/leads/api.ts` (types and one signature only):

```ts
export type LeadFieldWriteValue = string | number | null | Array<{ id: string | null; name: string }>;
export type LeadFieldWrite = { fieldId: string; value: LeadFieldWriteValue };
/** THE single lead write body of the phase 2 API (LeadWriteSchema). */
export type LeadWritePayload = {
  id?: string; contactName: string; contactPhone: string | null; contactEmail: string | null;
  clientId: string | null; clientName: string | null; estimatedValueBrl: number;
  sellerPersonId?: string | null; pipelineId?: string; fields: LeadFieldWrite[];
};
```
and `saveLead: ({ id, ...body }: SaveLeadPayload | SaveContactLeadPayload | LeadWritePayload, token)` (line 189 today). The three payload types coexist until 08e.

## Steps (TDD)

1. Write `lead-form.test.ts` (Tests). Run: fails (module missing).
2. Edit `api.ts` (types + the widened `saveLead` parameter).
3. Create `lead-form.ts`.
4. Run the oracle green, then `leads-api-contract.test.ts` (must be unchanged and green), lint, type-check.

## Tests (`lead-form.test.ts`, node)

Fixtures: `defs` = `[cliente(system, referenceTarget 'cliente'), descricao(text), qtd(number), orcamento(money), prazo(date), origem(options [{key:'site',label:'Site'},{key:'indicacao',label:'Indicação'}]), produtos(reference produto multiple)]` with ids `f-desc`, `f-qtd`, ... and positions 1..7.

- `requires a name first, then one contact`: empty draft -> `contactName` problem; name only -> `contact` problem with `contactRequired`; name + phone -> `null`; name + email -> `null`.
- `refuses a malformed e-mail and a blank-looking contact`: `'ana@'` -> `contactEmail` problem.
- `refuses a bad number, money and date`: `qtd 'abc'` -> `field:f-qtd` with `numberInvalid`; `prazo '2026-02-30'` -> `dateInvalid`; valid values -> `null`.
- `the cliente definition is never validated nor rendered as a dynamic field`: `renderableDefinitions(defs).map(d => d.key)` excludes `cliente`.
- `splitClientContact classifies an e-mail by the at sign`: `'ana@acme.com'` -> email; `' (11) 99999-0000 '` -> phone trimmed; `null` -> both blank.
- `prefillContactFromClient fills only blank targets and never overwrites typed text`: draft phone `'111'` + client contact `'(11) 2'` -> `{}`; draft blank + client email -> `{contactEmail}`; client `undefined` -> `{}`; client contact `null` -> `{}`.
- `buildLeadWritePayload trims, nulls blanks and sends integer cents`: valor `'1500.50'` -> `150050`; blank phone -> `null`; name `'  Ana '` -> `'Ana'`.
- `omits sellerPersonId when the picker is not offered and sends the key (null included) when it is`.
- `carries the id on edit and pipelineId only on create`.
- `sends only fields that have a value, plus the ones that had one before (so a clear is explicit)`: create with all blank -> `fields: []`; edit where `hadValue` has `f-desc` and the draft is blank -> `{ fieldId:'f-desc', value:null }` present.
- `encodes each kind`: text trimmed; number `'3'` -> `3`; money `'12'` -> `1200`; date kept; options key kept; produtos array `[{id:'P1',name:'Site'},{id:null,name:' Item livre '}]` -> names trimmed, `id:null` kept.
- `a lead round-trips through draft and payload unchanged`: build a `SalesOpsLead` fixture with `fields` for descricao, qtd, orcamento (150000), prazo, origem, produtos; `buildLeadWritePayload(leadFormDraftFromLead(lead, defs), defs, { id: lead.id, includeSeller: true, hadValue: fieldIdsWithValue(lead) })` deep-equals `leadToWriteSeed(lead)` after sorting `fields` by `fieldId` (client snapshot `''` becomes `null` in both).
- `leadToWriteSeed appends an explicit null for every field the edit added`: `leadToWriteSeed(prev, ['f-qtd'])` contains `{fieldId:'f-qtd', value:null}`.
- `leadFormSaveErrorCopy names the missing etapa for 400 no_open_stage and falls back otherwise`.

## Affected tests search

Searched `apps/web/src` for `SaveLeadPayload`, `SaveContactLeadPayload` and `saveLead(` consumers: `leads-api-contract.test.ts` calls `saveLead` with the old payloads, which still type-check because the parameter is a union. No test changes. `board-write-surface.test.ts` is not affected (it scans `OWNED_FILES`; `lead-form.ts` joins that list in 08e).

## Commands

- Oracle: `pnpm --filter @fxl-sales/web exec vitest run src/sales-ops/leads/__tests__/lead-form.test.ts`
- Affected: `pnpm --filter @fxl-sales/web exec vitest run src/sales-ops/leads/__tests__/leads-api-contract.test.ts src/sales-ops/leads/__tests__/contact-lead.test.ts`
- `pnpm --filter @fxl-sales/web lint` and `pnpm --filter @fxl-sales/web type-check`

## Risks

- W1 and W2 are wire assumptions; see Context. Reconciled by the orchestrator at plan-check.
- The `reference` kind is stored as an array for single and multiple definitions alike (the read shape is always an array of `{id, name}`), so `multiple` only changes the UI (08d), never the payload.
