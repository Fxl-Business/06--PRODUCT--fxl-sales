---
id: 03-import-recognize-clients
milestone: v4.7.0
status: done
depends_on: []
files_modified: [apps/api/src/domains/import/client-recognition.ts, apps/api/src/domains/import/types.ts, apps/api/src/domains/import/refs.ts, apps/api/src/domains/import/plan/cadastros.ts, apps/api/src/domains/import/plan/index.ts, apps/api/src/domains/import/executor.ts, apps/api/src/domains/import/routes.ts, apps/api/src/domains/import/template.ts, apps/api/src/domains/import/__tests__/client-recognition.test.ts, apps/api/src/domains/import/__tests__/refs.test.ts, apps/api/src/domains/import/__tests__/cadastros.test.ts, apps/api/src/domains/import/__tests__/plan-leads.test.ts, apps/api/src/domains/import/__tests__/plan-propostas.test.ts, apps/api/src/domains/import/__tests__/plan-index.test.ts, apps/api/src/domains/import/__tests__/executor.test.ts, apps/api/src/domains/import/__tests__/executor.integration.test.ts, apps/api/src/domains/import/__tests__/import-routes.integration.test.ts, apps/api/src/domains/import/__tests__/template.test.ts, apps/api/src/domains/import/plan/__tests__/desfechos.test.ts, apps/web/src/sales-ops/import/types.ts, apps/web/src/sales-ops/import/issues.ts, apps/web/src/sales-ops/import/import-copy.ts, apps/web/src/sales-ops/import/ImportCountsTable.tsx, apps/web/src/sales-ops/import/ImportView.tsx, apps/web/src/sales-ops/import/__tests__/import-view.test.tsx, apps/web/src/sales-ops/import/__tests__/import-copy.test.ts, apps/web/src/sales-ops/import/__tests__/issues.test.ts]
oracle: [apps/api/src/domains/import/__tests__/client-recognition.test.ts, apps/api/src/domains/import/__tests__/refs.test.ts, apps/api/src/domains/import/__tests__/cadastros.test.ts, apps/api/src/domains/import/__tests__/plan-leads.test.ts, apps/api/src/domains/import/__tests__/plan-propostas.test.ts, apps/api/src/domains/import/__tests__/plan-index.test.ts, apps/api/src/domains/import/__tests__/executor.test.ts, apps/api/src/domains/import/__tests__/template.test.ts, apps/api/src/domains/import/__tests__/template-example.test.ts, apps/api/src/domains/import/__tests__/workbook-schema.test.ts, apps/api/src/domains/import/__tests__/import-routes.test.ts, apps/api/src/domains/import/plan/__tests__/desfechos.test.ts, apps/api/src/domains/import/__tests__/import-routes.integration.test.ts, apps/api/src/domains/import/__tests__/executor.integration.test.ts, apps/api/src/domains/import/__tests__/catalog.integration.test.ts, apps/web/src/sales-ops/import/__tests__/import-view.test.tsx, apps/web/src/sales-ops/import/__tests__/import-copy.test.ts, apps/web/src/sales-ops/import/__tests__/issues.test.ts, apps/web/src/sales-ops/import/__tests__/import-routing.test.tsx]
acceptance: ["AC7: recognizeClientRows maps a Clientes row whose document digits equal exactly one existing cliente's document digits to that cliente even under another name (several clientes with those digits narrow to the one with the row's normalized name); planCadastros emits no createClient and no issue for a recognized row.", "AC8: a row with no document match is recognized by normalized name when exactly one existing cliente has that name and every document attached to that name agrees (the existing cliente's, and those of every Clientes row with that name, blanks ignored, at most one distinct value).", "AC9: a same-name row with a different document (versus the existing cliente or versus another row of the tab) is NOT recognized; it still emits createClient and today's possible_duplicate warning, byte-identical.", "AC10: buildRefIndex resolves a recognized row's sheet name AND the stored name to { existingId } with the STORED name as label, deduplicated against the existing entry; Leads Empresa and Propostas Cliente link to it; re-previewing the same Clientes + Leads workbook returns zero issues (no possible_duplicate, no ambiguous_client).", "AC11: recognition writes nothing: the integration test compares every column of every sales_ops_clients row (updated_at included) before and after the re-import commit, and the row count does not grow; every new lead's client_id is the pre-existing cliente's id and its client_name_snapshot is the stored name.", "AC12: POST /preview answers recognized: { clientes: N } with counts.clientes excluding those rows; the screen renders exactly ONE [data-import-recognized] line reading IMPORT_COPY.recognizedClients(N) (never one issue per row); POST /commit re-plans from scratch and answers 201 { counts, recognized }; the import.completed entry's afterJsonb is { counts, recognized, actorLabel }.", "The leads edition (salesEdition 'leads') reaches the same planners: the re-import integration test runs with it.", "The Leia-me no longer promises a warning for a cliente already in the cadastro; it says the row is recognized and neither duplicated nor changed.", "Every pre-existing oracle listed in this plan stays green; api and web type-check and lint on the changed files pass; no migration; no em dash character is introduced."]
---

# Slice 03 - A importação reconhece clientes já cadastrados (AC7-AC12)

## Goal

Re-importing a workbook whose Clientes tab lists clientes that already exist must reuse those clientes instead of duplicating them.
A Clientes row that IS an existing cliente (same CNPJ/CPF, or the same name with no conflicting document) creates nothing, writes nothing to the existing cliente, raises no warning, and every other tab that names it links to the existing cliente.
The preview tells the operator once, in one line, how many clientes were recognized.

## Human decisions (final, not reopened here)

- Recognition key: CNPJ/CPF digits first, otherwise the normalized name.
- Same name with two different documents is NOT recognized: the row creates a new cliente with today's warning.
- A recognized cliente is never written (create-only); the import reuses and links.
- One summary in the preview, not one line per row; the Clientes count to create excludes recognized rows; commit re-plans and applies the same rule.
- Out of scope: recognizing Pessoas, Produtos or Leads; updating existing clientes.

## Design decisions (final, the executor makes none)

D-R1. Where recognition is decided.
A new pure module `apps/api/src/domains/import/client-recognition.ts` exports `recognizeClientRows(parsed, catalog): ClientRecognition`.
It is called exactly ONCE, inside `buildRefIndex`, and the index exposes the answer as `refs.recognizedClient(row)`.
`planClientes` reads it from the index it already receives, so the planner and every name lookup structurally share one answer.
Rejected: computing it in `planImport` and passing it as a new argument to `buildRefIndex` and `planCadastros`, because a required argument ripples into about 30 test call sites and an optional one would allow an index built without recognition to disagree with the planner.
Rejected: letting `planClientes` call `recognizeClientRows` itself (the `assignProductCodes` precedent, which `buildRefIndex` and `planProdutos` each re-derive), because two derivations agree only by convention.

D-R2. The rule, exactly (this is the code in step 1).
For each Clientes row with a non-null `nome`: `key = normalizeLabel(nome)`, `doc = documentDigits(documento)`.
1. Document first, when `doc !== ''`: `byDoc` = existing clientes whose `documentDigits(document) === doc`.
   If `byDoc` has exactly one entry, the row is that cliente (even under another name).
   If it has several, narrow to those whose normalized name equals `key`; exactly one left is the match.
   If `byDoc` is non-empty and no single match remains, the row is NOT recognized and does not fall back to the name rule (the document points away from any by-name candidate).
2. Otherwise by name: `byName` = existing clientes whose normalized name equals `key`; it must have exactly one entry.
   The documents attached to that name must agree: the set of distinct non-empty digits made of the existing cliente's document plus the documents of EVERY Clientes row whose normalized name is `key` must have size at most 1.
   This is rule 3 applied to the whole tab: if the tab writes the same name with two different documents, no row with that name is recognized by name.
3. Anything else is not recognized: the planner creates the row and warns exactly as today.
Rejected: picking one of several same-document clientes by id order (an arbitrary link).
Rejected: a third outcome "exists but ambiguous" for several same-document clientes (more surface, and the lead warning would say "Há mais de um cliente chamado X" for a name no cliente carries).
Rejected: a per-row name rule without the tab-wide document agreement, because two rows with different CNPJs under one name would silently merge into one document-less cliente, which is exactly what rule 3 forbids.

D-R3. The ref index.
A recognized row registers `{ existingId }` under its SHEET name with the cliente's STORED name as label (instead of `{ planKey }`).
The lookup pool is deduplicated by `refKey`, so a recognized row and its own existing cliente are one candidate, under both the sheet spelling and the stored spelling.
A name that two existing clientes share stays ambiguous even when a Clientes row recognizes one of them by document: the cadastro itself is ambiguous and recognition never hides that.
Rejected: letting the Clientes tab override the catalog for its names, because a Leads reference would then resolve differently depending on whether a Clientes row exists.

D-R4. A recognized row emits no operation, no issue, and takes no part in the in-sheet duplicate bookkeeping (`seenName`, `seenDoc`).
Two rows recognized as the same cliente both resolve to it and raise nothing.
Non-recognized rows keep today's four warning texts byte-identical (`cadastros.ts:516`, `:521`, `:526`, `:533`).
Rejected: keeping the in-sheet duplicate warning for recognized rows, because its advice ("um nome repetido não pode ser usado nas outras abas") becomes false once both rows resolve to one id.

D-R5. What is counted and how it travels.
The count is the number of recognized ROWS, reported per tab as `recognized: ImportCounts` (`{ clientes: N }`, a key present only above zero, the same convention as `countOperations`).
Rejected: one file-level warning issue, because it reads as something to fix, inflates the warning count and flips `readyOk`, can be cut by the 500-issue truncation, and never reaches the commit body or the audit.
Rejected: a scalar `recognizedClients`, a one-off sibling per future tab.
Rejected: a column on the counts table, a column with one non-empty cell that would also appear under "Registros criados".

D-R6. Wire, commit and audit.
`ImportPlan.recognized` is REQUIRED (always set by `planImport`); `SheetPlanResult.recognized` is optional (only `planCadastros` sets it).
`POST /preview` answers `{ ok, counts, recognized, issues, truncated }` with `recognized` always present (`{}` when none).
`POST /commit` answers `201 { counts, recognized }`; the 422 body is the preview body and so also carries `recognized`.
The `import.completed` entry is `afterJsonb: { counts, recognized, actorLabel }`.
Rejected: leaving the audit unchanged, because the entry would show the Clientes tab producing nothing with no trace that its rows were matched to existing clientes.

D-R7. The web.
One line `<p data-import-recognized>` right under the counts table in step 3 (`IMPORT_COPY.recognizedClients(N)`) and, after commit, under the created-counts table in the success panel (`IMPORT_COPY.recognizedClientsDone(N)`).
When the counts table is empty AND something was recognized, the table's empty text is `IMPORT_COPY.nothingNew` instead of `nothingToImport` (the file did have rows).
The web field is OPTIONAL (`recognized?: ImportCounts`) and absent reads as zero, a tolerant reader across a rolling deploy (web on Vercel, API on AWS).
The confirm dialog text is unchanged; the recognized line sits right above the button.

D-R8. Labels and snapshots.
Every lookup of a recognized cliente answers the STORED name as `label`.
Leads keep the sheet text as `input.clientName`, and `createLead` snapshots the stored name from `clientId` (`lead-service.ts:451-456`, `:1084-1086`); Propostas use `l.label` (`propostas.ts:495`), the stored name.
`plan/leads.ts` and `plan/propostas.ts` need NO change.

D-R9. `documentDigits` moves out of `cadastros.ts` (local `digits`, lines 54-56) into `client-recognition.ts`, the one document rule for warnings and recognition.
Exact digits only; no leading-zero normalization (it could equate a CPF and a CNPJ, and re-importing the same file reads the same cells the same way).

D-R10. The leads edition takes the same path: `importRouter` never reads `salesEdition` (`routes.ts:91-140`), `/import/*` is gated only by `requireCapability('import')` (`sales-ops/routes.ts:90`), and `LEADS_CAPABILITIES` grants `import` (`packages/shared-utils/src/sales-edition.ts:62`).
The re-import integration test drives the leads edition to prove it.

D-R11. The Leia-me line `template.ts:124` ("Clientes e pessoas parecidos com um cadastro existente aparecem como aviso...") becomes false and is replaced by two lines (step 8).

## Verified context (worktree at b3ceab7)

- `apps/api/src/domains/import/catalog.ts:163-167`: `readImportCatalog` reads EVERY cliente of the org as `{ id, name, document }` ordered by name, no edition filter; `types.ts:110` types it.
- `apps/api/src/domains/import/plan/cadastros.ts`
  - `digits()` at lines 54-56.
  - `planClientes(parsed, catalog, blocked)` at lines 499-574: always pushes `createClient` (line 570) and only warns: existing name (514-517), existing document (518-523), in-sheet name (524-529), in-sheet document (530-537).
  - `planCadastros` at lines 640-656 builds `counts` with `countOperations(operations, sheetOf)`.
- `apps/api/src/domains/import/refs.ts`
  - `ImportRefIndex` at lines 23-32.
  - `type Registered = { planKey: string; label: string }` at line 208.
  - Registration loop at lines 233-256 (clientes are not `uniqueByName`, so every row registers).
  - Product label map at lines 265-272 and code entries at 304-308 build `Registered` values.
  - `toLookup` at lines 274-291 pools existing matches and workbook entries WITHOUT dedupe, so an existing cliente plus its own Clientes row is `ambiguous_ref`: this is the reported bug.
  - Return object at lines 368-385.
- `apps/api/src/domains/import/plan/leads.ts:91-109`: an `ambiguous_ref` empresa becomes the `ambiguous_client` warning and free text.
- `apps/api/src/domains/import/plan/propostas.ts:487-497`: an ambiguous cliente is an ERROR (`lookupIssue`), so today a re-import with Propostas fails outright.
- `apps/api/src/domains/import/plan/index.ts:18-35` (`planImport`), `:71-78` (`toPreviewBody`).
- `apps/api/src/domains/import/types.ts`: `ImportPlan` line 174, `SheetPlanResult` line 176, `ImportPreviewBody` line 188, `ImportCommitBody` line 189.
- `apps/api/src/domains/import/executor.ts`: `ImportExecutionResult` line 54; audit entry lines 446-457 (`afterJsonb: { counts, actorLabel }`).
- `apps/api/src/domains/import/routes.ts:130`: `const body: ImportCommitBody = { counts: result.counts };`.
- `apps/api/src/domains/import/template.ts:121-124`: the "Só cria, nunca altera" Leia-me block; `template.test.ts:329-366` requires one sentence per row, a final `.` or `:`, no `[.!?]\s+[A-ZÀ-Ý]`, no em dash.
- `apps/api/src/db/schema.ts:747-767`: `sales_ops_clients` has no unique index on `document` (several clientes may share one) and a nullable `updated_at`.
- `apps/api/src/domains/import/plan/__tests__/desfechos.test.ts:23-29` builds a literal `ImportRefIndex`; it needs the new member.
- Type-check covers test files (`apps/api/package.json:10` runs `tsconfig.test.json`), so every `ImportPlan` literal in tests must carry `recognized`.
- Web: `apps/web/src/sales-ops/import/types.ts:49-55` (wire mirror), `issues.ts:65-81` (`nonZeroCounts`, `totalCount`), `import-copy.ts:4-50` (`IMPORT_COPY`), `ImportCountsTable.tsx:17-21` (empty text), `ImportView.tsx:176-193` (success panel) and `:258-261` (step 3).
- The parser turns a whitespace-only cell into `null` (`cells.ts:311`), so a non-null `nome` always has a non-empty normalized key.

## Data flow

`routes.ts` (preview or commit) -> `planImport(parsed, catalog)` -> `buildRefIndex(parsed, catalog)` calls `recognizeClientRows` once -> `planCadastros` -> `planClientes` asks `refs.recognizedClient(row.row)` and skips recognized rows, counting them -> `planCadastros` returns `recognized: { clientes: N }` -> `planImport` merges into `plan.recognized` -> `toPreviewBody` (preview, 422) or `executeImportPlan` (audit + result) -> `routes.ts` commit body `{ counts, recognized }` -> web `ImportView` renders one line.
`planLeads` and `planPropostas` call `refs.resolve('client', name)` unchanged and now receive `{ existingId }`.

## Implementation (exact)

### 1. New `apps/api/src/domains/import/client-recognition.ts`

```ts
/**
 * Which Clientes rows ARE an existing cliente (D12). Pure: no I/O, no clock, no env.
 * Computed ONCE, inside buildRefIndex, so the Clientes planner and every name lookup
 * read the same answer (ImportRefIndex.recognizedClient). A recognized row is reused,
 * never written: the import stays create-only.
 *
 * 1. Document first: the existing clientes whose document digits equal the row's.
 *    Exactly one is the match, even under another name. Several narrow to the ones
 *    with the row's normalized name; if no single one is left the row is NOT
 *    recognized and never falls back to the name.
 * 2. Otherwise by name: exactly one existing cliente with the row's normalized name,
 *    and every document attached to that name agrees (the existing cliente's and the
 *    documents of every Clientes row with that name, blanks ignored, at most one
 *    distinct value).
 * 3. Anything else is not recognized: the planner creates the row and warns.
 */
import { normalizeLabel } from './cells.js';
import { cellReader } from './parse.js';
import type { ClientRecognition, ImportCatalog, ParsedWorkbook, RecognizedClient } from './types.js';

/** The one document rule: digits only, so "12.345.678/0001-90" equals "12345678000190". */
export function documentDigits(text: string | null | undefined): string {
  return (text ?? '').replace(/\D/g, '');
}

export function recognizeClientRows(parsed: ParsedWorkbook, catalog: ImportCatalog): ClientRecognition {
  const rows = parsed.sheets.clientes.rows.flatMap((row) => {
    const cells = cellReader('clientes', row);
    const nome = cells.text('nome');
    if (nome === null) return [];
    return [{ row: row.row, key: normalizeLabel(nome), doc: documentDigits(cells.text('documento')) }];
  });
  const sheetDocsByName = new Map<string, Set<string>>();
  for (const r of rows) {
    if (r.doc === '') continue;
    const docs = sheetDocsByName.get(r.key) ?? new Set<string>();
    docs.add(r.doc);
    sheetDocsByName.set(r.key, docs);
  }
  const existing = catalog.clients.map((c) => ({
    client: { existingId: c.id, name: c.name } satisfies RecognizedClient,
    key: normalizeLabel(c.name),
    doc: documentDigits(c.document),
  }));

  const result = new Map<number, RecognizedClient>();
  for (const r of rows) {
    if (r.doc !== '') {
      const byDoc = existing.filter((e) => e.doc === r.doc);
      const candidates = byDoc.length > 1 ? byDoc.filter((e) => e.key === r.key) : byDoc;
      const match = candidates.length === 1 ? candidates[0] : undefined;
      if (match) {
        result.set(r.row, match.client);
        continue;
      }
      if (byDoc.length > 0) continue;
    }
    const byName = existing.filter((e) => e.key === r.key);
    const match = byName.length === 1 ? byName[0] : undefined;
    if (!match) continue;
    const docs = new Set<string>(sheetDocsByName.get(r.key));
    if (match.doc !== '') docs.add(match.doc);
    if (docs.size <= 1) result.set(r.row, match.client);
  }
  return result;
}
```

If lint objects to `satisfies` inside the object literal, write `const client: RecognizedClient = { existingId: c.id, name: c.name };` before returning the object; behaviour is identical.

### 2. `apps/api/src/domains/import/types.ts`

- Replace line 174 and line 176:

```ts
export type ImportPlan = {
  operations: ImportOperation[];
  issues: ImportIssue[];
  counts: ImportCounts;
  /** Rows recognized as EXISTING records and therefore not created (D12: only Clientes today). */
  recognized: ImportCounts;
};

export type SheetPlanResult = {
  operations: ImportOperation[];
  issues: ImportIssue[];
  counts: ImportCounts;
  /** Only planCadastros sets it; a key is present only above zero. */
  recognized?: ImportCounts;
};
```

- Add after `EntityRef` (line 120):

```ts
/** A Clientes row that IS this existing cliente (D12). `name` is the STORED name, the label every lookup answers. */
export type RecognizedClient = { existingId: string; name: string };
/** Excel row number of the Clientes tab -> the existing cliente that row is. */
export type ClientRecognition = ReadonlyMap<number, RecognizedClient>;
```

- Replace lines 188-189:

```ts
export type ImportPreviewBody = {
  ok: boolean;
  counts: ImportCounts;
  recognized: ImportCounts;
  issues: ImportIssue[];
  truncated: boolean;
};
export type ImportCommitBody = { counts: ImportCounts; recognized: ImportCounts };
```

### 3. `apps/api/src/domains/import/refs.ts`

- Imports: add `import { recognizeClientRows } from './client-recognition.js';` and add `RecognizedClient` to the `./types.js` type import.
- `ImportRefIndex` (lines 23-32): add

```ts
  /** The existing cliente a Clientes row (Excel row number) IS, or null; the one answer of recognizeClientRows (D12). */
  recognizedClient(row: number): RecognizedClient | null;
```

- Line 208: `type Registered = { ref: EntityRef; label: string };`
- First statement of `buildRefIndex`: `const clientRecognition = recognizeClientRows(parsed, catalog);`
- Registration loop, replace line 251 (`const entry = { planKey: ..., label: nome };`) with

```ts
      // A recognized Clientes row stands for its existing cliente, never for a row to create (D12).
      const recognized = kind === 'client' ? clientRecognition.get(row.row) : undefined;
      const entry: Registered = recognized
        ? { ref: { existingId: recognized.existingId }, label: recognized.name }
        : { ref: { planKey: planKeyOf(sheet, row.row) }, label: nome };
```

- Product label map (lines 266-268): only plan entries carry a planKey:

```ts
  for (const list of registered.get('product')?.values() ?? []) {
    for (const entry of list) {
      if ('planKey' in entry.ref) productLabelByPlanKey.set(entry.ref.planKey, entry.label);
    }
  }
```

- Code entries (lines 305-308): `[{ ref: { planKey: workbookKey }, label: productLabelByPlanKey.get(workbookKey) ?? typed }]`.
- `toLookup` (lines 282-285), replace the `pool` construction with

```ts
    const candidates: Array<{ ref: EntityRef; label: string }> = [
      ...activeExisting.map((r) => ({ ref: { existingId: r.id } as EntityRef, label: r.name })),
      ...workbookEntries,
    ];
    // One candidate per record: a recognized Clientes row and its own existing cliente are the same ref.
    const seen = new Set<string>();
    const pool = candidates.filter((candidate) => {
      const key = refKey(candidate.ref);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
```

  The rest of `toLookup` is unchanged (existing candidates come first, so the label of an existing ref is always the stored name).
- Return object: add `recognizedClient: (row) => clientRecognition.get(row) ?? null,`.
- Update the file header comment's first line to mention that the index also owns the Clientes recognition.

### 4. `apps/api/src/domains/import/plan/cadastros.ts`

- Import `documentDigits` from `'../client-recognition.js'`; delete the local `digits` (lines 54-56); replace both `digits(` calls (lines 509 and 519) with `documentDigits(`.
- Add `ImportCounts` to the `../types.js` type import.
- `planClientes` becomes `function planClientes(parsed: ParsedWorkbook, catalog: ImportCatalog, refs: ImportRefIndex, blocked: Set<string>): Part & { recognizedCount: number }`, initialised as `{ operations: [], issues: [], recognizedCount: 0 }`.
- Right after `if (nome === null) continue;` (line 506) insert:

```ts
    // Recognized (D12): the row IS an existing cliente. Create-only, so it is reused and never
    // written: no operation, no issue, and no part in the in-sheet duplicate bookkeeping below.
    if (refs.recognizedClient(row.row) !== null) {
      out.recognizedCount += 1;
      continue;
    }
```

- Every other line of `planClientes` stays byte-identical (the four warning messages included).
- `planCadastros` (lines 640-656):

```ts
  const clientes = planClientes(parsed, catalog, refs, blocked);
  const parts: Part[] = [
    planAreas(parsed, catalog, blocked),
    planFuncoes(parsed, catalog, blocked),
    produtos,
    planPessoas(parsed, catalog, refs, blocked),
    clientes,
    planEtapas(parsed, catalog, blocked),
  ];
  ...
  const recognized: ImportCounts = clientes.recognizedCount > 0 ? { clientes: clientes.recognizedCount } : {};
  return { operations, issues, counts, recognized };
```

### 5. `apps/api/src/domains/import/plan/index.ts`

- `planImport` return gains:

```ts
    recognized: mergeCounts(...[cadastros, leads, propostas, desfechos].map((part) => part.recognized ?? {})),
```

- `toPreviewBody` gains `recognized: plan.recognized,` (between `counts` and `issues`).

### 6. `apps/api/src/domains/import/executor.ts`

- Line 54: `export type ImportExecutionResult = { counts: ImportCounts; recognized: ImportCounts };`
- Lines 446-457:

```ts
  const counts: ImportCounts = { ...plan.counts };
  // Reported, never acted on: a recognized cliente is not an operation (D12).
  const recognized: ImportCounts = { ...plan.recognized };
  // LAST statement: the audit tail lock is held until commit.
  await writeAuditEntry(tx, {
    ...
    afterJsonb: { counts, recognized, actorLabel: actor.displayName },
  });
  return { counts, recognized };
```

- The executor source guard (`executor.test.ts:286-299`) stays green: no insert, update, delete, clock or env is added.

### 7. `apps/api/src/domains/import/routes.ts`

- Line 130: `const body: ImportCommitBody = { counts: result.counts, recognized: result.recognized };`
- Nothing else; preview and 422 carry `recognized` through `toPreviewBody`.

### 8. `apps/api/src/domains/import/template.ts`

Replace line 124 with exactly these two lines:

```ts
  B('Um cliente que já está no cadastro, com o mesmo CNPJ/CPF ou, sem conflito de CNPJ/CPF, com o mesmo nome, é reconhecido: a linha não cria outro cliente nem altera o existente, e as outras abas usam o cliente existente.');
  B('Pessoas parecidas com um cadastro existente, e clientes com o mesmo nome mas outro CNPJ/CPF, aparecem como aviso na conferência e não impedem a importação.');
```

### 9. Web

`apps/web/src/sales-ops/import/types.ts`:

```ts
export type ImportPreviewBody = {
  ok: boolean;
  counts: ImportCounts;
  /**
   * Rows the server recognized as existing records and will not create (today only
   * `clientes`). Optional on purpose: an API deployed before it answers without the
   * key, which reads as zero.
   */
  recognized?: ImportCounts;
  issues: ImportIssue[];
  truncated: boolean;
};
export type ImportCommitBody = { counts: ImportCounts; recognized?: ImportCounts };
```

`isImportPreviewBody` is unchanged (it must not require the optional key).

`apps/web/src/sales-ops/import/issues.ts`, append:

```ts
/** Clientes rows the server recognized as existing clientes; absent, zero or invalid reads as 0. */
export function recognizedClientCount(body: { recognized?: ImportCounts }): number {
  const count = body.recognized?.clientes;
  return typeof count === 'number' && Number.isFinite(count) && count > 0 ? count : 0;
}
```

`apps/web/src/sales-ops/import/import-copy.ts`, add right after `nothingToImport`:

```ts
  nothingNew: 'Nenhum registro novo para criar.',
  recognizedClients: (n: number) =>
    n === 1
      ? '1 cliente da aba Clientes já está no cadastro (mesmo CNPJ/CPF ou mesmo nome) e não será criado de novo nem alterado; as outras abas usam o cliente existente.'
      : `${n} clientes da aba Clientes já estão no cadastro (mesmo CNPJ/CPF ou mesmo nome) e não serão criados de novo nem alterados; as outras abas usam os clientes existentes.`,
  recognizedClientsDone: (n: number) =>
    n === 1
      ? '1 cliente da aba Clientes já estava no cadastro e foi reaproveitado, sem alteração.'
      : `${n} clientes da aba Clientes já estavam no cadastro e foram reaproveitados, sem alteração.`,
```

`apps/web/src/sales-ops/import/ImportCountsTable.tsx`: the props become `{ counts, heading, emptyText = IMPORT_COPY.nothingToImport }: { counts: ImportCounts; heading: string; emptyText?: string }` and the empty branch renders `{emptyText}`.

`apps/web/src/sales-ops/import/ImportView.tsx`:
- Import `recognizedClientCount` from `./issues`.
- Before `return`: `const previewRecognized = preview !== null ? recognizedClientCount(preview) : 0;` and `const resultRecognized = result !== null ? recognizedClientCount(result) : 0;`.
- Success panel, right after `<ImportCountsTable counts={result.counts} heading={IMPORT_COPY.countsCreated} />`:

```tsx
            {resultRecognized > 0 ? (
              <p className="text-[13.5px] text-[#57575f]" data-import-recognized>
                {IMPORT_COPY.recognizedClientsDone(resultRecognized)}
              </p>
            ) : null}
```

- Step 3, replace the counts table line with:

```tsx
              <ImportCountsTable
                counts={preview.counts}
                emptyText={previewRecognized > 0 ? IMPORT_COPY.nothingNew : undefined}
                heading={IMPORT_COPY.countsToCreate}
              />
              {previewRecognized > 0 ? (
                <p className="text-[13.5px] text-[#57575f]" data-import-recognized>
                  {IMPORT_COPY.recognizedClients(previewRecognized)}
                </p>
              ) : null}
```

- `canImport`, the confirm text and every other line stay unchanged.

## Tests (Red first)

### Step 0 - reproduce the bug end to end before any product change

Write test A of `import-routes.integration.test.ts` (below) first and run it on the unchanged code.
It must fail at the re-preview: `counts` is `{ clientes: 3, leads: 3 }`, `recognized` is undefined, and `issues` holds 8 warnings (3 existing-name, 2 existing-document since one row has no document, 3 `ambiguous_client`), the same shape as the 342 the human saw (114 x 3).
Paste the failing assertion into the exec notes; that is the Red evidence of the reported bug.

### New `apps/api/src/domains/import/__tests__/client-recognition.test.ts`

Setup: `import { documentDigits, recognizeClientRows } from '../client-recognition.js'`, `seededCatalog` and `workbook` from `./plan-fixtures.js`, local ids `A`, `A2`, `B`, `C1`, `C2`, `C3`, `D`, `E` (valid uuid strings), and `const run = (rows, clients) => [...recognizeClientRows(workbook({ clientes: rows }), seededCatalog({ clients }))]`.
Every expectation compares `[row, { existingId, name }]` pairs with `toEqual`.

1. `documentDigits keeps only the digits and reads null as empty`: `'12.345.678/0001-90'` -> `'12345678000190'`; `null` -> `''`; `undefined` -> `''`; `'ISENTO'` -> `''`.
2. `recognizes a row by its document digits even under another name`: clients `[{ id: A, name: 'Padaria Pão Quente', document: '12.345.678/0001-90' }]`, rows `[{ nome: 'Padaria PQ', documento: '12345678000190' }]` -> `[[2, { existingId: A, name: 'Padaria Pão Quente' }]]`.
3. `recognizes a row without a document by its normalized name`: same clients, rows `[{ nome: 'PADARIA PAO QUENTE', documento: null }]` -> `[[2, { existingId: A, name: 'Padaria Pão Quente' }]]`.
4. `recognizes by name when the existing cliente has no document and the row has one`: clients `[{ id: B, name: 'Mercado Sol', document: null }]`, rows `[{ nome: 'Mercado Sol', documento: '98.765.432/0001-10' }]` -> `[[2, { existingId: B, name: 'Mercado Sol' }]]`.
5. `recognizes by name when neither side has a document`: clients `[{ id: B, name: 'Mercado Sol', document: null }]`, rows `[{ nome: 'mercado sol' }]` -> `[[2, { existingId: B, name: 'Mercado Sol' }]]`.
6. `does not recognize the same name with a different document`: clients of test 2, rows `[{ nome: 'Padaria Pão Quente', documento: '99.999.999/0001-99' }]` -> `[]`.
7. `does not recognize a name two existing clientes share when the row has no document`: clients `[A as in test 2, { id: A2, name: 'Padaria Pão Quente', document: null }]`, rows `[{ nome: 'Padaria Pão Quente' }]` -> `[]`.
8. `lets the document win over a name match to another cliente`: clients `[{ id: A, name: 'Padaria Pão Quente', document: null }, { id: B, name: 'Outro Nome', document: '11.111.111/0001-11' }]`, rows `[{ nome: 'Padaria Pão Quente', documento: '11111111000111' }]` -> `[[2, { existingId: B, name: 'Outro Nome' }]]`.
9. `narrows several clientes with the row document to the one with its name and never falls back to the name`: clients `[{ id: C1, name: 'Loja Um', document: '55.555.555/0001-55' }, { id: C2, name: 'Loja Dois', document: '55555555000155' }, { id: C3, name: 'Loja Três', document: null }]`, rows `[{ nome: 'loja dois', documento: '55.555.555/0001-55' }, { nome: 'Loja Três', documento: '55.555.555/0001-55' }]` -> `[[2, { existingId: C2, name: 'Loja Dois' }]]` (row 3 absent).
10. `does not recognize by name when the tab gives that name two different documents`: clients `[{ id: D, name: 'Loja', document: null }]`, rows `[{ nome: 'Loja', documento: '111' }, { nome: 'loja', documento: '222' }]` -> `[]`; positive control in the same test: rows `[{ nome: 'Loja', documento: '111' }, { nome: 'loja', documento: '111' }]` -> `[[2, { existingId: D, name: 'Loja' }], [3, { existingId: D, name: 'Loja' }]]`.
11. `recognizes two rows as the same cliente`: clients of test 2, rows `[{ nome: 'Padaria Pão Quente' }, { nome: 'Padaria PQ', documento: '12.345.678/0001-90' }]` -> both rows map to A.
12. `skips a row without a name and treats a document without digits as none`: clients `[test 2's A, { id: E, name: 'Isenta', document: 'ISENTO' }]`, rows `[{ nome: null, documento: '12.345.678/0001-90' }, { nome: 'Outra', documento: 'ISENTO' }]` -> `[]`.
13. `is pure and deterministic`: two runs on the same inputs are equal, `JSON.stringify([parsed, catalog])` is unchanged after the calls, and reversing `catalog.clients` gives the same result for test 2's and test 9's inputs.
14. `source is pure`: `readFileSync(new URL('../client-recognition.ts', import.meta.url), 'utf8')` does not match `/new Date/`, `/process\.env/`, `/db\//`, `/sales-ops\//`.

### `apps/api/src/domains/import/__tests__/refs.test.ts` (new tests in `describe('buildRefIndex')`, existing ones unchanged)

- `resolves a recognized Clientes row to the existing cliente under the sheet name and the stored name`: `buildRefIndex(workbook({ clientes: [{ nome: 'Padaria PQ', documento: '12345678000190' }] }), richCatalog())`; `resolve('client', 'padaria pq')` and `resolve('client', 'Padaria Pão Quente')` both `toEqual({ ok: true, ref: { existingId: IDS.clientPadaria }, label: 'Padaria Pão Quente' })`.
- `never makes a recognized row ambiguous with its own existing cliente`: clientes `[{ nome: 'padaria pão quente', documento: null }]`; `resolve('client', 'Padaria Pão Quente')` `toEqual` the same ok result (Red today: `ambiguous_ref`).
- `keeps an unrecognized same-name row ambiguous`: clientes `[{ nome: 'Padaria Pão Quente', documento: '99.999.999/0001-99' }]`; `resolve('client', 'Padaria Pão Quente')` `toMatchObject({ ok: false, code: 'ambiguous_ref' })`.
- `exposes the one recognition through recognizedClient`: clientes `[{ nome: 'Padaria PQ', documento: '12345678000190' }, { nome: 'Mercado Novo' }]`; `recognizedClient(2)` `toEqual({ existingId: IDS.clientPadaria, name: 'Padaria Pão Quente' })`, `recognizedClient(3)` and `recognizedClient(99)` are `null`, and `resolve('client', 'Mercado Novo')` `toMatchObject({ ok: true, ref: { planKey: 'clientes:3' } })`.

### `apps/api/src/domains/import/__tests__/cadastros.test.ts`

- DELIBERATE EDIT of `warns on a same-name or same-document cliente (digits only)` (lines 260-268), renamed `warns on an unrecognized same-name cliente and on a document repeated inside the sheet (digits only)`, because its first row is now recognized by document.
  Rows `[{ nome: 'padaria pão quente', documento: '99.999.999/0001-99' }, { nome: 'Outra', documento: '98.765.432/0001-10' }, { nome: 'Outra 2', documento: '98765432000110' }]` with `richCatalog()`.
  `r.issues.map((i) => [i.row, i.column, i.severity, i.code])` `toEqual([[2, 'Nome', 'warning', 'possible_duplicate'], [4, 'CNPJ/CPF', 'warning', 'possible_duplicate']])`.
  `r.issues[0]?.message` `toBe('Já existe um cliente chamado "padaria pão quente" no cadastro; se for o mesmo, remova esta linha (um nome repetido não pode ser usado nas outras abas).')`.
  `r.counts` `toEqual({ clientes: 3 })` and `r.recognized` `toEqual({})`.
- NEW `recognizes an existing cliente by document or name: no operation, no issue, counted apart`: catalog `richCatalog()` plus `{ id: IDS.clientPadaria.replace('e1', 'e2'), name: 'Mercado Sol', document: null }`; rows `[{ nome: 'Padaria PQ', documento: '12.345.678/0001-90' }, { nome: 'mercado sol', documento: '11.111.111/0001-11' }, { nome: 'Loja Nova' }]`.
  The only operation is `createClient` with `planKey: 'clientes:4'` and `input.name: 'Loja Nova'`; `issues` `toEqual([])`; `counts` `toEqual({ clientes: 1 })`; `recognized` `toEqual({ clientes: 2 })`.
- NEW `two rows recognized as the same cliente raise no in-sheet duplicate warning`: `richCatalog()`, rows `[{ nome: 'Padaria Pão Quente' }, { nome: 'padaria pão quente', documento: '12345678000190' }]`; `operations` `[]`, `issues` `[]`, `counts` `{}`, `recognized` `{ clientes: 2 }`.
- NEW `still warns and creates when several clientes carry the row document and none has its name`: `richCatalog()` plus `{ id: IDS.clientPadaria.replace('e1', 'e3'), name: 'Padaria Filial', document: '12.345.678/0001-90' }`; rows `[{ nome: 'Padaria Centro', documento: '12345678000190' }]`.
  Issues `toEqual` one warning `{ severity: 'warning', sheet: 'clientes', row: 2, column: 'CNPJ/CPF', code: 'possible_duplicate', message: 'O documento "12345678000190" já é do cliente "Padaria Pão Quente" no cadastro.' }`; `counts` `{ clientes: 1 }`; `recognized` `{}`.
- NEW `reports no recognized key when nothing is recognized`: `plan({ clientes: [{ nome: 'Loja' }] }).recognized` `toEqual({})`.
- Unchanged and green: the example-workbook test (fresh catalog recognizes nothing), `creates a cliente with blanks as null`, and every other test.

### `apps/api/src/domains/import/__tests__/plan-leads.test.ts` (new tests)

- `links a lead to a recognized cliente with no ambiguous_client on a re-import`: `richCatalog()`, clientes `[{ nome: 'Padaria Pão Quente', documento: '12.345.678/0001-90' }]`, leads `[lead({ empresa: 'Padaria Pão Quente' })]`; `r.issues` `toEqual([])` (Red today: `['ambiguous_client']`); `leadOp(r.operations).clientRef` `toEqual({ existingId: IDS.clientPadaria })`.
- `links a lead naming a recognized row spelled differently from the cadastro`: clientes `[{ nome: 'Padaria PQ', documento: '12345678000190' }]`, leads `[lead({ empresa: 'padaria pq' })]`; issues `[]`; `clientRef` `{ existingId: IDS.clientPadaria }`; `input.clientName` `'padaria pq'` (the executor's `createLead` snapshots the stored name).
- Unchanged and green: `warns and keeps free text when the empresa is ambiguous` (two existing clientes, no Clientes row) and every other test.

### `apps/api/src/domains/import/__tests__/plan-propostas.test.ts` (new test)

- `resolves the cliente to a recognized Clientes row instead of reporting it ambiguous`: `const d = sale({ clientes: [{ nome: 'padaria pão quente' }], ...one({}) })` (Red today: `ambiguous_ref` error); `d.clientRef` `toEqual({ existingId: IDS.padaria })` and `d.clientName` `toBe('Padaria Pão Quente')`.

### `apps/api/src/domains/import/__tests__/plan-index.test.ts`

- DELIBERATE EDIT: the two `toPreviewBody({...})` literals (lines 139 and 148-152) gain `recognized: {}`; the truncation test also asserts `expect(body.recognized).toEqual({})`.
- NEW `carries the planners' recognized rows onto the plan and the preview body`: `mocks.planCadastros.mockReturnValue({ ...empty(), recognized: { clientes: 3 } })`; `planImport(...).recognized` `toEqual({ clientes: 3 })` and `toPreviewBody(plan).recognized` `toEqual({ clientes: 3 })`.
- NEW `reports no recognized rows as an empty object`: with every mock at `empty()`, `planImport(emptyParsedWorkbook(), catalog).recognized` `toEqual({})`.

### `apps/api/src/domains/import/__tests__/executor.test.ts`

- DELIBERATE EDIT (type-check only): the `plan()` helper (line 90) and the `bad` literal (lines 245-251) gain `recognized: {}`.

### `apps/api/src/domains/import/plan/__tests__/desfechos.test.ts`

- DELIBERATE EDIT (type-check only): the literal `ImportRefIndex` (lines 23-29) gains `recognizedClient: throwing,`.

### `apps/api/src/domains/import/__tests__/executor.integration.test.ts`

- Add `const FULL_RECOGNIZED = { clientes: 1 };` next to `FULL_COUNTS` (the executor treats it as opaque metadata it reports and never acts on).
- DELIBERATE EDITS: `fullPlan` (lines 296-300) gains `recognized: { ...FULL_RECOGNIZED }`; the literals at lines 482-490, 530, 544 and 556 gain `recognized: {}`.
- The first test (line 340) also asserts `expect(result.recognized).toEqual(FULL_RECOGNIZED)`.
- The audit test (line 443) becomes `expect(entry.afterJsonb).toEqual({ counts: plan.counts, recognized: plan.recognized, actorLabel: 'Equipe FXL' })`.

### `apps/api/src/domains/import/__tests__/import-routes.integration.test.ts`

Additive harness changes:
- `createTestApp(edition?: 'leads')` sets `c.set('salesEdition', edition)` when given; `upload(path, bytes, edition?: 'leads')` passes it through.
- Import `ClientSchema, createClient` from `'../../sales-ops/service.js'` next to `AreaSchema, createArea`.
- Helper `sheetTab(sheet: SheetKey, rows: Array<Record<string, FixtureCell>>): FixtureTab` that names the tab from `WORKBOOK_SHEETS`, writes `headerRow(sheet)` and maps each row's header texts to cells (`null` for absent headers).
- Fixture rows (the Construbom shape: every lead names a cliente of the same file):
  - Clientes: `{ Nome: 'Construtora Alfa', 'CNPJ/CPF': '11.222.333/0001-81' }`, `{ Nome: 'Construtora Beta', 'CNPJ/CPF': '22.333.444/0001-92' }`, `{ Nome: 'Loja Sem Documento' }`.
  - Leads: `{ Contato: 'Ana Alfa', Empresa: 'Construtora Alfa' }`, `{ Contato: 'Bruno Beta', Empresa: 'Construtora Beta' }`, `{ Contato: 'Caio Loja', Empresa: 'Loja Sem Documento' }`.

Test A `recognizes the clientes of a re-imported Clientes + Leads workbook in the leads edition and links the new leads to them without writing the cadastro`:
1. `newOrg('recognize')`; `bytes = await buildXlsx([sheetTab('clientes', ...), sheetTab('leads', ...)])`.
2. First commit with edition `'leads'`: status 201, body `toEqual({ counts: { clientes: 3, leads: 3 }, recognized: {} })`.
3. Snapshot `clientsBefore` = every column of the org's `sales_ops_clients` rows via `getAdminDb()`, ordered by `id`; length 3. Snapshot `firstLeads`.
4. Delete every first lead through the real lixeira route: `createTestApp('leads').request(`/leads/${id}/delete`, { method: 'POST' })` answers 204 (the human's scenario).
5. Preview the SAME bytes with edition `'leads'`: status 200; `ok` true; `counts` `toEqual({ leads: 3 })`; `recognized` `toEqual({ clientes: 3 })`; `issues` `toEqual([])`.
6. Commit the SAME bytes with edition `'leads'`: status 201; body `toEqual({ counts: { leads: 3 }, recognized: { clientes: 3 } })`.
7. `clientsAfter` (same query) `toEqual(clientsBefore)`: no new row and no column changed, `updated_at` included.
8. The leads not in `firstLeads`, sorted by contact name, map to `[contactName, clientId, clientNameSnapshot]` `toEqual` `[['Ana Alfa', idOf('Construtora Alfa'), 'Construtora Alfa'], ['Bruno Beta', idOf('Construtora Beta'), 'Construtora Beta'], ['Caio Loja', idOf('Loja Sem Documento'), 'Loja Sem Documento']]` with `idOf` read from `clientsBefore`.
9. The org's `import.completed` entries ordered by id: exactly 2, and the second's `afterJsonb` `toEqual({ counts: { leads: 3 }, recognized: { clientes: 3 }, actorLabel: 'Equipe FXL' })`.

Test B `links leads to an existing cliente recognized by document under another name, with the stored name as snapshot`:
1. `newOrg('recognize-doc')`; `createClient(getDb(), orgId, ClientSchema.parse({ name: 'Construtora Alfa', document: '11.222.333/0001-81' }))`; snapshot `clientsBefore` (1 row).
2. Bytes: Clientes `{ Nome: 'Alfa Construções Ltda', 'CNPJ/CPF': '11222333000181' }`, Leads `{ Contato: 'Dora', Empresa: 'alfa construções ltda' }`.
3. Preview (full edition): `ok` true, `counts` `{ leads: 1 }`, `recognized` `{ clientes: 1 }`, `issues` `[]`.
4. Commit: 201, body `{ counts: { leads: 1 }, recognized: { clientes: 1 } }`.
5. Clients unchanged (`toEqual(clientsBefore)`); the one lead has `clientId` of the existing cliente and `clientNameSnapshot` `'Construtora Alfa'`.

Existing tests of this file stay green unchanged (a fresh org recognizes nothing; they read `.counts` and `.ok` only).

### `apps/api/src/domains/import/__tests__/template.test.ts` (new test)

- `Leia-me says a cliente already in the cadastro is recognized, never duplicated nor changed`: the joined text of `buildLeiameLines(catalogFixture(), { example: false })` contains both new step-8 lines verbatim and does not contain `'Clientes e pessoas parecidos com um cadastro existente'`.
- The existing `Leia-me has one pt-BR sentence per row and covers the rules` stays green unchanged (both new lines end with `.`, contain no `[.!?]\s+[A-ZÀ-Ý]` and no em dash).

### Web: `apps/web/src/sales-ops/import/__tests__/import-view.test.tsx` (new tests, existing unchanged)

- `tells in one line how many clientes were recognized and leaves them out of the counts`: `validatedWith({ ok: true, counts: { leads: 114 }, recognized: { clientes: 114 }, issues: [], truncated: false })`; exactly one `[data-import-recognized]` whose `textContent` is `IMPORT_COPY.recognizedClients(114)`; `[data-import-count]` keys are `['leads']`; it FOLLOWS `[data-import-counts]` in document order; `importButton().disabled` is false.
- `says there is nothing new to create when every row was recognized`: `validatedWith({ ...okPreview({}), recognized: { clientes: 2 } })`; text contains `IMPORT_COPY.nothingNew` and not `IMPORT_COPY.nothingToImport`; the recognized line reads `IMPORT_COPY.recognizedClients(2)`; Importar is disabled.
- `renders no recognized line when nothing was recognized or the server predates the field`: `validatedWith(okPreview())` shows no `[data-import-recognized]`; then `api.preview.mockResolvedValue({ ...okPreview(), recognized: { clientes: 0 } })`, click Validar again, still none.
- `repeats the recognized count in the past tense after the import`: `api.commit.mockResolvedValue({ counts: { leads: 3 }, recognized: { clientes: 3 } })`; validate `{ ...okPreview({ leads: 3 }), recognized: { clientes: 3 } }`, Importar, confirm; `[data-import-success]` holds exactly one `[data-import-recognized]` reading `IMPORT_COPY.recognizedClientsDone(3)`.

### Web: `apps/web/src/sales-ops/import/__tests__/import-copy.test.ts` (new tests)

- `pins the recognized clientes lines, singular and plural, before and after the import`: `recognizedClients(1)`, `recognizedClients(114)`, `recognizedClientsDone(1)`, `recognizedClientsDone(3)` and `nothingNew` equal the exact strings of step 9.
- `uses no em dash in the new lines`: none of those five strings contains `String.fromCharCode(0x2014)`.

### Web: `apps/web/src/sales-ops/import/__tests__/issues.test.ts` (new test)

- `recognizedClientCount reads recognized.clientes and reads absent, zero or invalid as zero`: `{ recognized: { clientes: 114 } }` -> 114; `{}` -> 0; `{ recognized: {} }` -> 0; `{ recognized: { clientes: 0 } }` -> 0; `{ recognized: { clientes: Number.NaN } }` -> 0; `{ recognized: { leads: 3 } }` -> 0.

## Pre-existing oracles

Named in CLAUDE.md "Importação por planilha":
- `import-routes.integration.test.ts`: every existing test stays green unchanged; additive harness parameter and tests A and B are added.
- `executor.integration.test.ts`: deliberate edits (plan literals gain `recognized`, the audit assertion includes `recognized`, `result.recognized` asserted); no behaviour of an existing assertion is relaxed.
- `template-example.test.ts`: unchanged, green.
- `workbook-schema.test.ts`: unchanged, green (no schema change).
- `import-view.test.tsx`: existing tests unchanged, new tests added.
- `import-copy.test.ts`: existing tests unchanged, new tests added.

Also in the reference oracle list:
- `cadastros.test.ts`: one deliberate rewrite (the same-document row is now recognized), new tests added.
- `refs.test.ts`, `plan-leads.test.ts`, `plan-propostas.test.ts`, `template.test.ts`, `issues.test.ts`: additions only.
- `plan-index.test.ts`, `executor.test.ts`, `plan/__tests__/desfechos.test.ts`: literal edits for the new required members, plus additions in `plan-index.test.ts`.
- `catalog.integration.test.ts`, `cells.test.ts`, `parse.test.ts`, `plan-helpers.test.ts`, `import-routes.test.ts`, `exceljs-pin.test.ts`, `import-routing.test.tsx`: unchanged, green.

## Commands (run-once only)

Fresh worktree: `pnpm install --frozen-lockfile`, `pnpm run build:packages`, and `apps/api/.env` copied read-only from the main checkout (git-ignored); the local Docker Postgres on 5006 must be up.

```bash
# API unit (the vitest config excludes *.integration.test.ts here)
pnpm --filter @fxl-sales/api exec vitest run src/domains/import
# API integration (local test DB through the fxl_sales_test role)
pnpm --filter @fxl-sales/api test:integration src/domains/import/__tests__/import-routes.integration.test.ts
pnpm --filter @fxl-sales/api test:integration src/domains/import/__tests__/executor.integration.test.ts src/domains/import/__tests__/catalog.integration.test.ts
# Step 0 only: just the reproduction
pnpm --filter @fxl-sales/api test:integration src/domains/import/__tests__/import-routes.integration.test.ts -t "recognizes the clientes"
# Web
pnpm --filter @fxl-sales/web exec vitest run src/sales-ops/import
# Types (the api script also checks the test tree) and lint on changed files
pnpm --filter @fxl-sales/api type-check
pnpm --filter @fxl-sales/web type-check
pnpm --filter @fxl-sales/api exec eslint <changed api files>
pnpm --filter @fxl-sales/web exec eslint <changed web files>
```

## Constraints

- Create-only: no UPDATE of any cliente column, no upsert; a recognized row produces no operation at all.
- Writes only through the domain services inside the one `withTenant` transaction; the executor gains no query.
- No migration, no new table or column, no new route, no new env var.
- Planners stay pure (no I/O, clock or env); `client-recognition.ts` imports only `cells.js`, `parse.js` and types.
- Never render an id; the web classifies nothing new by body code.
- No em dash character anywhere (code, copy, comments, docs); plain dash only.
- Do not touch slice 01's files (`LeadsBoard.tsx`, `LeadCard.tsx`, `board-labels.ts`) or slice 02's (`contact-lead.ts`, `ContactLeadDialog.tsx`, `LeadDialog.tsx`, `client-picker-copy.ts`).
- One sentence per physical line in any long Markdown written (exec notes).

## Risks

- Behaviour change by decision: a same-name row with no document now reuses the existing cliente instead of creating a homonym; two different clientes with the same name and no document must now be told apart by a CNPJ/CPF or a different name.
- A CNPJ typed as a NUMBER in Excel loses its leading zeros (`cells.ts:270`), so it can miss an existing cliente stored with the zero and fall back to the name rule; re-importing the same file is unaffected.
- `ImportPlan.recognized` is required, so the type-check of the API test tree fails until every plan literal listed above carries it; that is intended.

## Docs to update at Capture (the Capture scribe applies these, not the executor)

`CLAUDE.md`, section "Importação por planilha", replace the bullet at line 386:

```
- Create-only. An import never updates. An existing ACTIVE área, função, produto or etapa with the same name is an error (`duplicate_existing`), a reference to an archived record is an error (`archived_ref`), a same-name cliente or pessoa is only a warning (`possible_duplicate`).
```

with:

```
- Create-only. An import never updates. An existing ACTIVE área, função, produto or etapa with the same name is an error (`duplicate_existing`), a reference to an archived record is an error (`archived_ref`), a same-name pessoa is only a warning (`possible_duplicate`).
- A Clientes row that IS an existing cliente is RECOGNIZED by `recognizeClientRows` (`client-recognition.ts`), computed ONCE inside `buildRefIndex` and read by `planClientes` only through `refs.recognizedClient(row)`.
  Document digits first (several clientes with those digits narrow to the one with the row's name, never a name fallback), otherwise exactly one same-name cliente whose document agrees with every same-name row of the tab.
  A recognized row creates nothing, writes nothing to the cliente, raises no issue, and every reference to its sheet name resolves to that cliente (lookups dedupe by `refKey`); an unrecognized same-name or same-document cliente is still created with the `possible_duplicate` warning.
  Preview and commit carry `recognized: { clientes: N }` (also in the `import.completed` `afterJsonb`), shown as ONE line (`data-import-recognized`), never one issue per row.
```

and append `client-recognition.test.ts` to the "Oracles:" bullet at line 395 (after `executor.integration.test.ts`).

`nexo/knowledge/reference/importacao-por-planilha.md`:
- Line 49, after "Resolution order is existing active record, or a workbook row created earlier in the same plan.", add the line: "A Clientes row recognized as an existing cliente (D12) resolves to that cliente under its sheet name, deduplicated against the cliente's own entry, so neither spelling is ambiguous."
- Line 62 (D5), replace its last sentence "Clientes and pessoas have no unique name, so a same-name, same-document or same-email match is a warning `possible_duplicate`." with "Pessoas have no unique name, so a same-name or same-email match is a warning `possible_duplicate`; clientes follow D12, and only an UNRECOGNIZED same-name or same-document cliente row is a `possible_duplicate` warning."
- After line 72 (D11), add this D12 bullet (one sentence per line):

```
- D12. Re-import recognition of clientes (run 20261008T114022Z-construbom-leads-ajustes: Construbom re-imported the same workbook and the preview offered 114 duplicate clientes plus 114 leads linked to none).
  `recognizeClientRows` decides once, inside `buildRefIndex`: equal document digits first (several clientes with them narrow to the one with the row's name, otherwise not recognized and never a name fallback), then exactly one same-name cliente whose document agrees with every same-name row of the tab.
  A recognized row is reused and never written, emits no operation and no issue, and both its sheet name and the stored name resolve to the existing id with the stored name as label.
  The same name with a different document is created with the old `possible_duplicate` warning.
  Rejected: one warning per row (the reported bug), one file-level warning issue (reads as a problem and never reaches the commit body or the audit), passing the recognition as a planner argument (two entry points could disagree), and picking one of several same-document clientes by id (an arbitrary link).
```
- Line 79, `afterJsonb: { counts, actorLabel }` becomes `afterJsonb: { counts, recognized, actorLabel }`.
- Line 89, `200 ImportPreviewBody { ok, counts, issues, truncated }` becomes `200 ImportPreviewBody { ok, counts, recognized, issues, truncated }`.
- Line 90, `201 { counts }` becomes `201 { counts, recognized }`.
- Module layout: after the `catalog.ts` bullet add "- `client-recognition.ts`: `recognizeClientRows` and `documentDigits`, the D12 rule; pure, called only by `buildRefIndex`."; line 105 becomes "- `refs.ts`: `buildRefIndex`, name to existing id or workbook ref; it owns the Clientes recognition (`recognizedClient`)."
- Web screen, after line 117 add: "When the server recognized clientes, one line under the counts table says how many (`IMPORT_COPY.recognizedClients`), and the success panel repeats it in the past tense; with nothing to create the table reads `Nenhum registro novo para criar.`"
- Line 128, add `client-recognition.test.ts` to the planner oracles.
- Line 140 (Not built), append "recognition of existing Pessoas, Produtos or Leads (only Clientes are recognized, D12)".
- Known gaps, add: "A CNPJ typed as a number in Excel loses leading zeros, so it can miss a cliente stored with them and fall back to the name rule."
