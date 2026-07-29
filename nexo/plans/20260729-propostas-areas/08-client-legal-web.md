---
id: 08-client-legal-web
milestone: v2.3.0
status: done
depends_on: [02-proposal-schema-backend, 07-propostas-list-web]
files_modified: [apps/api/src/domains/sales-ops/service.ts, apps/api/src/domains/sales-ops/__tests__/service.test.ts, apps/api/test/rls/client-legal-fields.test.ts, apps/web/src/sales-ops/types.ts, apps/web/src/sales-ops/SalesOpsApp.tsx, apps/web/src/sales-ops/__tests__/client-dialog-legal-fields.test.tsx]
acceptance: "Given an existing client, when an admin fills Razão social, CNPJ/CPF, Endereço, Representante legal and CPF do representante in the client dialog and saves, then PATCH /api/v1/sales-ops/clients/:id persists all five legal fields and the bootstrap payload returns them on the client row."
---

# Slice 08: client-legal-web

## Scope

Expose the five client legal columns added by slice 02 (`legal_name`, `document`, `address`, `legal_rep_name`, `legal_rep_document` on `sales_ops_clients`) end to end: Zod schema, service normalization, web type, and an optional "Dados para contrato" section in the client dialog.
No route changes, no migration, no new endpoints.

## Dependency note

`02-proposal-schema-backend` is a real data dependency: it ships the migration and the Drizzle columns for `sales_ops_clients`.
`07-propostas-list-web` is listed ONLY to serialize edits to `apps/web/src/sales-ops/SalesOpsApp.tsx`, which slices 05 through 08 all touch; there is no functional dependency on the Propostas list.

## Preconditions to verify at execution start

Confirm `apps/api/src/db/schema.ts` `salesOpsClients` (currently at lines 492-503) exposes the five new columns with these exact Drizzle properties: `legalName: text('legal_name')`, `document: text('document')`, `address: text('address')`, `legalRepName: text('legal_rep_name')`, `legalRepDocument: text('legal_rep_document')`, all nullable.
If slice 02 shipped the migration but omitted the `schema.ts` properties, add exactly those five lines after `contact: text('contact'),` in this slice; do not create any migration here.

## 1. API: ClientSchema (apps/api/src/domains/sales-ops/service.ts)

Replace the current `ClientSchema` (lines 84-87) with:

```ts
export const ClientSchema = z.object({
  name: z.string().min(1).max(160),
  contact: z.string().max(200).nullish(),
  legalName: z.string().max(200).nullish(),
  document: z.string().max(32).nullish(),
  address: z.string().max(400).nullish(),
  legalRepName: z.string().max(200).nullish(),
  legalRepDocument: z.string().max(32).nullish(),
});
```

Notes on this exact shape:
`nullish()` means optional AND nullable, which is what the overview mandates and what lets the dialog send `null` to clear a field.
`contact` moves from `.optional().or(z.literal(''))` to `.nullish()`; empty string still passes (`max(200)` with no `min`), and null becomes accepted, which the new dialog payload uses.
`ClientInput` and the routes (`ClientSchema` on POST, `ClientSchema.partial()` on PATCH at `apps/api/src/domains/sales-ops/routes.ts` lines 93-110) flow through unchanged; do not touch `routes.ts`.

## 2. API: service normalization (same file)

Add one private helper directly above `createClient` (currently line 498):

```ts
function clearableText(value: string | null | undefined): string | null | undefined {
  if (value === undefined) return undefined;
  return value || null;
}
```

Rewrite `createClient` values to normalize every optional field ('' or null becomes null, undefined also inserts null via the explicit fallback):

```ts
export async function createClient(db: Db, orgId: string, data: ClientInput) {
  return withTenant(db, orgId, async (tx) => {
    const [client] = await tx
      .insert(salesOpsClients)
      .values({
        orgId,
        name: data.name,
        contact: data.contact || null,
        legalName: data.legalName || null,
        document: data.document || null,
        address: data.address || null,
        legalRepName: data.legalRepName || null,
        legalRepDocument: data.legalRepDocument || null,
      })
      .returning();
    return client!;
  });
}
```

Rewrite `updateClient` so PATCH keeps proper partial semantics (undefined = leave untouched, because Drizzle `.set()` skips undefined keys; '' or null = clear to null):

```ts
export async function updateClient(db: Db, orgId: string, id: string, data: Partial<ClientInput>) {
  return withTenant(db, orgId, async (tx) => {
    const [client] = await tx
      .update(salesOpsClients)
      .set({
        ...(data.name !== undefined ? { name: data.name } : {}),
        contact: clearableText(data.contact),
        legalName: clearableText(data.legalName),
        document: clearableText(data.document),
        address: clearableText(data.address),
        legalRepName: clearableText(data.legalRepName),
        legalRepDocument: clearableText(data.legalRepDocument),
        updatedAt: new Date(),
      })
      .where(and(eq(salesOpsClients.orgId, orgId), eq(salesOpsClients.id, id)))
      .returning();
    return client ?? null;
  });
}
```

Behavior note, intentional: the old `updateClient` wiped `contact` to null whenever a PATCH omitted it (`contact: data.contact || null` with no undefined guard); the new version preserves omitted fields.
The web dialog always sends all fields, so no user-visible change, and the integration test below pins the new preserve-on-omit semantics.

## 3. API: bootstrap mapping

No change needed.
`getSalesOpsSnapshot` (service.ts lines 642-676) selects `clients` with a bare `tx.select().from(salesOpsClients)`, so the new columns flow into `GET /bootstrap` automatically; `listClients` likewise.
The loose `clients: unknown[]` in `SalesOpsSnapshot` stays as is.

## 4. Web: SalesOpsClient type (apps/web/src/sales-ops/types.ts)

Extend the type (lines 56-63) with five optional nullable fields, optional so stale cached bootstrap payloads written before the API deploy still type-check:

```ts
export type SalesOpsClient = {
  id: string;
  orgId: string;
  name: string;
  contact: string | null;
  legalName?: string | null;
  document?: string | null;
  address?: string | null;
  legalRepName?: string | null;
  legalRepDocument?: string | null;
  createdAt: string;
  updatedAt: string | null;
};
```

`SaveClientPayload` in `apps/web/src/sales-ops/api.ts` (lines 35-38) is derived from `Partial<SalesOpsClient>`, so it picks the fields up automatically; do not edit `api.ts` or `hooks.ts`.

## 5. Web: ClientDialog (apps/web/src/sales-ops/SalesOpsApp.tsx)

All edits are inside `ClientDialog` / `ClientDialogBody` (currently lines 2550-2618).

5a. Export `ClientDialog` for the new test, mirroring `ProductDialog` (line 1989): change `function ClientDialog(` to `export function ClientDialog(`.

5b. Add five state hooks after the existing `contact` state (line 2580); the second field is named `documentNumber` in JS to avoid shadowing the DOM `document` global:

```ts
const [legalName, setLegalName] = useState(modal.client?.legalName ?? '');
const [documentNumber, setDocumentNumber] = useState(modal.client?.document ?? '');
const [address, setAddress] = useState(modal.client?.address ?? '');
const [legalRepName, setLegalRepName] = useState(modal.client?.legalRepName ?? '');
const [legalRepDocument, setLegalRepDocument] = useState(modal.client?.legalRepDocument ?? '');
```

5c. Replace the `submit` payload (line 2585) with (note `contact` switches from `|| undefined` to `|| null` to match the new clear-vs-preserve PATCH semantics):

```ts
onSave({
  id: activeModal.client?.id,
  name: name.trim(),
  contact: contact.trim() || null,
  legalName: legalName.trim() || null,
  document: documentNumber.trim() || null,
  address: address.trim() || null,
  legalRepName: legalRepName.trim() || null,
  legalRepDocument: legalRepDocument.trim() || null,
});
```

5d. Update the dialog chrome: `DialogDescription` (line 2593) becomes `Nome comercial, contato e dados para contrato.`, and the `DialogContent` className gains scroll head-room for the taller form: `max-w-[520px]` becomes `max-h-[85vh] max-w-[520px] overflow-y-auto`.

5e. Insert the new section between the `Contato` Field (closes line 2606) and the footer button row (line 2607), using the existing `Field` component and an `aria-label` on each `Input` equal to its visible label (the established testing hook, see product-commission-editor tests):

```tsx
<div className="flex flex-col gap-1 border-t border-[#e8e8ec] pt-4">
  <span className="text-[13px] font-semibold text-[#3a3a40]">Dados para contrato</span>
  <span className="text-xs text-[#a0a0a8]">Campos opcionais usados na geração de contratos.</span>
</div>
<Field label="Razão social">
  <Input
    aria-label="Razão social"
    className="bg-[#fafafb]"
    onChange={(event) => setLegalName(event.target.value)}
    placeholder="Razão social do cliente"
    value={legalName}
  />
</Field>
<Field label="CNPJ/CPF">
  <Input
    aria-label="CNPJ/CPF"
    className="bg-[#fafafb]"
    onChange={(event) => setDocumentNumber(event.target.value)}
    placeholder="00.000.000/0000-00"
    value={documentNumber}
  />
</Field>
<Field label="Endereço">
  <Input
    aria-label="Endereço"
    className="bg-[#fafafb]"
    onChange={(event) => setAddress(event.target.value)}
    placeholder="Rua, número, bairro, cidade - UF, CEP"
    value={address}
  />
</Field>
<Field label="Representante legal">
  <Input
    aria-label="Representante legal"
    className="bg-[#fafafb]"
    onChange={(event) => setLegalRepName(event.target.value)}
    placeholder="Nome completo"
    value={legalRepName}
  />
</Field>
<Field label="CPF do representante">
  <Input
    aria-label="CPF do representante"
    className="bg-[#fafafb]"
    onChange={(event) => setLegalRepDocument(event.target.value)}
    placeholder="000.000.000-00"
    value={legalRepDocument}
  />
</Field>
```

## 6. Web: ClientsView stays unchanged

Decision, locked: the `ClientsView` table (SalesOpsApp.tsx lines 1550-1606) keeps its current four data columns (Nome, Contato, Nº vendas, Receita total) and does NOT gain a document column.
Rationale: the legal fields are contract metadata, the table is already dense, and the data is one click away in the edit dialog; a document column can ride along with the contract-generation follow-up feature if it proves needed.

## 7. Tests (oracles)

7a. NEW `apps/web/src/sales-ops/__tests__/client-dialog-legal-fields.test.tsx`.
Model it exactly on `product-commission-editor.test.tsx`: `// @vitest-environment happy-dom`, the same `@/components/ui/dialog` mock, `createRoot` + `act`, and the `labeledInput` / `change` / `submit` helpers querying `input[aria-label="..."]`.
Render `<ClientDialog modal={{ kind: 'client', client }} onClose={vi.fn()} onSave={onSave} saving={false} />`.
Test 1 `submits the five legal fields alongside name and contact`: render with no existing client, fill Nome plus all five legal inputs via aria-labels, submit, expect `onSave` called with `expect.objectContaining({ name, contact: null, legalName, document, address, legalRepName, legalRepDocument })`.
Test 2 `rehydrates legal fields when editing an existing client`: render with a client fixture carrying all five fields, assert each `labeledInput(...).value` matches.
Test 3 `sends null for cleared legal fields`: render with the same fixture, clear `Razão social` to '', submit, expect `onSave` called with `expect.objectContaining({ legalName: null, document: '12.345.678/0001-90' })`.

7b. EXTEND `apps/api/src/domains/sales-ops/__tests__/service.test.ts` with a new `describe('client schema legal fields', ...)`.
Test 1 `accepts a payload with all legal fields`: `ClientSchema.parse` on name plus the five fields returns them verbatim.
Test 2 `accepts omission and nulls for every legal field`: `ClientSchema.parse({ name: 'Acme' })` succeeds with all five undefined, and parsing with explicit nulls succeeds.
Test 3 `rejects overlong legal documents`: `ClientSchema.safeParse` with a 33-char `document` and with a 33-char `legalRepDocument` both report `success: false`.

7c. NEW `apps/api/test/rls/client-legal-fields.test.ts`.
Model it exactly on `apps/api/test/rls/product-commission-contract.test.ts`: same APP/ADMIN connection setup, org id `org_client_legal_${Date.now()}` collected for `afterAll` cleanup via `adminClient\`DELETE FROM sales_ops_clients WHERE org_id = ${orgId}\``.
Test `persists legal fields through create, partial update, and preserves omitted fields`:
call `createClient(db, orgId, ClientSchema.parse({...}))` with all five legal fields and assert the returned row carries them;
call `updateClient(db, orgId, id, ClientSchema.partial().parse({ document: '111.222.333-44' }))` and assert `document` changed while `legalName`, `address`, `legalRepName`, `legalRepDocument`, and `contact` are preserved (pins the PATCH preserve-on-omit semantics);
call `updateClient` with `{ legalName: null }` and assert `legalName` is now null;
finish with `listClients` and assert the persisted row round-trips the final field values (bootstrap uses the same bare select).

## 8. Verification

Run `pnpm run lint`, `pnpm run type-check`, `pnpm test`, and `pnpm --filter @fxl-sales/api test:integration`; all must pass.
Manual smoke (optional, needs local stack): open Cadastros > Clientes, edit a client, fill the Dados para contrato section, save, reopen, and confirm the values rehydrate.

## Out of scope

No migration or `db/schema.ts` changes beyond the precondition guard (slice 02 owns them).
No routes.ts changes, no new endpoints, no ClientsView columns, no contract-document generation, no sale wizard changes.
