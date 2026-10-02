---
id: 03-plan-leads
milestone: v4.2.0
status: done
depends_on: [02-catalog-refs-cadastros]
files_modified:
  - apps/api/src/domains/import/plan/leads.ts
  - apps/api/src/domains/import/__tests__/plan-leads.test.ts
acceptance: "Given a ParsedWorkbook, an ImportCatalog and a RefIndex fake, planLeads returns one createLead operation per valid Leads row (planKey leads:<row>, refs for cliente, vendedor, produtos and etapa, lostReason only for the lost etapa, input accepted by CreateLeadSchema with placeholder ids), and pt-BR issues with sheet, Excel row and header text for every D7 and vendedor rule (conversion_stage, lost_reason_required, seller_not_a_vendedor, ref failures, no_open_stage) plus possible_duplicate warnings for a repeated contato+empresa inside the workbook; it never reads the clock, env or database."
goal: "Plan the Leads sheet into createLead operations the executor can run with createLead plus moveLead, with every lead rule checked in the preview."
must_not_break:
  - "pnpm --filter @fxl-sales/api test (whole unit suite)"
  - "pnpm --filter @fxl-sales/api lint"
  - "pnpm --filter @fxl-sales/api type-check"
  - apps/api/src/domains/sales-ops/leads/__tests__/lead-contract.test.ts
  - apps/api/src/domains/import/__tests__/parse.test.ts
rules:
  - "planLeads is pure: no I/O, no clock (no `new Date`), no process.env, no database import. Runtime imports allowed: `CreateLeadSchema` from '../../sales-ops/leads/lead-schemas.js' (zod only), `normalizeLabel` from '../cells.js', `cellReader` from '../parse.js', `getColumnDef` from '../workbook-schema.js'. Everything else is `import type`. NEVER import '../../sales-ops/service.js' or 'lead-service.js' at runtime."
  - "Use ONLY the RefIndex interface from types.ts (`resolve(kind, name)`). Never import from '../refs.js' in leads.ts or in its test; the test builds its own fake RefIndex."
  - "Cells are read only through `cellReader('leads', row)`; headers in issues come only from `getColumnDef('leads', key).header`, never a hand-typed string."
  - "A lead never creates a cliente: an unresolved Empresa becomes free text `clientName` with `clientRef: null`."
  - "Money is integer cents; a blank Valor estimado is 0."
  - "Every message is pt-BR, quotes the value the user typed, never contains a uuid, a planKey or a column key."
  - "Do not touch apps/web/** (and never apps/web/src/sales-ops/leads/**), types.ts, refs.ts, catalog.ts or any other slice's file."
  - "No em dash anywhere; relative imports use `.js`."
verifier_focus: "That the conversion etapa and the lost-without-reason cases are errors and never operations; that the vendedor check covers BOTH an existing pessoa (catalog funcaoSlugs) and a workbook pessoa (its Funções list), and refuses a pessoa without Vendedor; that the CreateLeadSchema backstop really runs (placeholder ids, strict schema) and maps to headers; that no operation is emitted for a row with any error (parser or planner); that the test's RefIndex is a fake and nothing imports refs.ts; and that the Executor notes match lead-service.ts (createLead lands in the first active normal stage, moveLead is the only writer of stage and lost_reason, LeadInputError is THROWN not returned)."
---

# Slice 03 - Plan leads

## Objective

Implement `planLeads(parsed, catalog, refs)` in `apps/api/src/domains/import/plan/leads.ts`.
It turns each row of the `Leads` sheet into one `createLead` `ImportOperation` (shape fixed in `types.ts`) and reports every lead rule as an `ImportIssue` in the preview.
Nothing is mounted and nothing is written; slice 07 calls it from `planImport` and slice 06 executes its operations.

## Code facts (verified while planning)

- `CreateLeadSchema` (`apps/api/src/domains/sales-ops/leads/lead-schemas.ts`) is `.strict()`: keys `contactName` (trim, 1..140), `clientId` (uuid, nullish), `clientName` (trim, 1..200, REQUIRED even when `clientId` is set; the server then overwrites the snapshot from the cadastro), `estimatedValueBrl` (int >= 0, default 0), `description` (max 4000, nullish, no trim), `sellerPersonId` (uuid, nullish), `products` (max 50, default `[]`) of `LeadProductSchema` (strict `{ productId?: uuid, productName?: trim 1..140 }`, one of the two required).
  There is no `stageId`, no `lostReason`: a lead is always born in the default stage.
- `MoveLeadSchema` is strict `{ stageId: uuid, position: int 0..100000, reason?: trim 1..500, saleId?: uuid }`.
- `createLead(db, orgId, input, scope)` in `lead-service.ts`: opens `withTenant`; `scope.isAdmin === true` gives the no-predicate gate; validates the vendedor through `person_funcoes` against the SYSTEM função with slug `vendedor` and `status = 'active'` (`seller_not_a_vendedor` / `seller_not_found`); resolves `clientId` (`client_not_found`) and each `productId` (`product_not_found`, archived produtos resolve fine there); picks the FIRST active `kind = 'normal'` stage by `(position, name)` or THROWS `LeadInputError('no_open_stage')`; appends at `max(position)+1`; never writes `lost_reason` or `sale_id`.
  Errors are THROWN as `LeadInputError` (codes: seller_not_found, seller_not_a_vendedor, client_not_found, product_not_found, stage_not_found, lost_reason_required, sale_required_for_conversion, sale_not_found, sale_not_allowed, no_open_stage); the result union `{ ok: false, reason }` only carries `not_found | seller_scope | seller_person_unmapped | already_converted`.
- `moveLead(db, orgId, id, input, scope)` is the ONLY writer of `stage_id`, `position`, `stage_changed_at`, `lost_reason`, `sale_id`: destination must be an ACTIVE stage of the org (`stage_not_found`); `kind = 'lost'` without `reason` throws `lost_reason_required`; `kind = 'conversion'` requires `saleId`; any other kind with `saleId` throws `sale_not_allowed`; `lost_reason` is written only for a lost destination (null otherwise); `position` is clamped to the column length, so `100_000` means "append at the end".
- `LeadScope = { userId: string; email: string | null; isAdmin: boolean }`; `CadastroActor = { userId: string; displayName: string | null }`.
- Stages: `createLeadStage` always writes `kind: 'normal'`, `isSystem: false`, at `max(position)+1` (after every existing stage). Migration 0022 seeded `Novo`, `Em negociação` (normal), `Proposta` (conversion), `Perdido` (lost) for orgs that existed then; `ensureLeadStages` has NO caller in `apps/api/src` today (only tests), so an org created later can have zero stages (see Seam deviations, note 2).
- `createFuncao` refuses a name whose slug is `vendedor` or `finder` (`reserved_slug`), so any função with slug `vendedor` is the system one.
- Leads sheet columns (slice 01): `contato` text(140) R, `empresa` text(200) R (freeText, list clientes), `valorEstimado` money, `descricao` text(4000), `vendedor` text(120) (list vendedores), `produtos` list(50) (freeText, list produtos), `etapa` text(120) (list etapas), `motivoPerda` text(500).
  The list coercer already trims, drops empties and dedupes by `normalizeLabel`; each item is at most 200 characters.
- Parser handoff: a `null` in a REQUIRED column means the parser already reported it; never report it again.

## Decisions taken in this plan (record in the exec notes)

- L1. Existing-lead duplicate detection is SKIPPED: the catalog carries no leads and reading them would widen slice 02's catalog for a warning. Only duplicates WITHIN the workbook warn (`possible_duplicate`), keyed by `normalizeLabel(contato) + '|' + normalizeLabel(empresa)`.
- L2. A `Motivo da perda` on a row whose etapa is not the lost one (or is blank) is a WARNING (`lost_reason_ignored`) and `lostReason` becomes `null`, because `moveLead` would discard it anyway.
- L3. An Empresa that matches more than one cliente (`ambiguous_ref`) is a WARNING (`ambiguous_client`) and the lead keeps the free text unlinked; an unmatched Empresa is silent free text.
- L4. A Produtos item that resolves to an ARCHIVED produto is an error (D6), even though `createLead` itself would accept it. An unmatched name becomes a free-text product, EXCEPT a `#<digits>` code that matches nothing, which is the refs error (a code is never a product description).
- L5. An explicit Etapa always produces a `stageRef`, even when it names the default stage; the executor's `moveLead` is then a harmless append inside the same column.
- L6. A row produces an operation only when `contato` and `empresa` are non-null AND no error issue exists for that row, from the parser (`parsed.issues` with `sheet: 'leads'`, same `row`, severity error) or from this planner. Every check still runs on every row, so the preview lists every problem at once.

## File 1 - `apps/api/src/domains/import/plan/leads.ts`

### Imports (exact)

```ts
import { CreateLeadSchema } from '../../sales-ops/leads/lead-schemas.js';
import { normalizeLabel } from '../cells.js';
import { cellReader } from '../parse.js';
import { getColumnDef } from '../workbook-schema.js';
import type {
  EntityRef,
  ImportCatalog,
  ImportIssue,
  ImportOperation,
  ParsedRow,
  ParsedWorkbook,
  RefIndex,
  SheetPlanResult,
} from '../types.js';
```

### Exports (exact)

```ts
export function planLeads(parsed: ParsedWorkbook, catalog: ImportCatalog, refs: RefIndex): SheetPlanResult;
/** Stand-in uuid for a ref the executor resolves later; only used to run CreateLeadSchema in the preview. */
export const LEAD_PLACEHOLDER_ID = '00000000-0000-4000-8000-000000000000';
```

Nothing else is exported.

### Local helpers (module-private)

- `header(key)` = `getColumnDef('leads', key).header`.
- `issue(severity, row, key | null, code, message): ImportIssue` with `sheet: 'leads'`, `column: key ? header(key) : null`.
- `isVendedorFuncaoName(name, catalog, refs)`: `const l = refs.resolve('funcao', name)`; if `l.ok && 'existingId' in l.ref` return `catalog.funcoes.some(f => f.id === l.ref.existingId && f.slug === 'vendedor')`; otherwise return `normalizeLabel(name) === 'vendedor'` (covers a fresh org where slice 02 makes the system Vendedor resolvable in some other way).
- `personIsVendedor(ref, parsed, catalog, refs)`:
  - `{ existingId }`: `p = catalog.people.find(id)`; `p` absent -> throw `Error('planLeads: ref to unknown person')` (contract violation by refs); return `p.funcaoSlugs.includes('vendedor')`.
  - `{ planKey }`: must match `/^pessoas:(\d+)$/` and a row with that `row` number must exist in `parsed.sheets.pessoas.rows`, else throw `Error('planLeads: bad person planKey')`; return `(cellReader('pessoas', r).list('funcoes') ?? []).some(n => isVendedorFuncaoName(n, catalog, refs))`.
- `stageKind(ref, catalog)`: `{ existingId }` -> `catalog.stages.find(id)?.kind` (absent -> throw programmer Error); `{ planKey }` -> `'normal'` (createLeadStage only mints normal stages).
- `hasOpenStage(parsed, catalog)`: `catalog.stages.some(s => s.status === 'active' && s.kind === 'normal') || parsed.sheets.etapas.rows.some(r => cellReader('etapas', r).text('nome') !== null)`.

### Algorithm of `planLeads`

1. `rows = parsed.sheets.leads.rows`. If `rows.length === 0` return `{ operations: [], issues: [], counts: {} }`.
2. If `!hasOpenStage(parsed, catalog)`: push sheet-level error `no_open_stage` (row null, column null) and continue (rows are still validated; with this error the plan is not executable anyway).
3. `seen = new Map<string, number>()` (duplicate key -> first Excel row). For each `row` in order, with `c = cellReader('leads', row)`, collect `rowIssues: ImportIssue[]`:
   1. `contato = c.text('contato')`, `empresa = c.text('empresa')`.
   2. Empresa: when `empresa !== null`: `l = refs.resolve('client', empresa)`;
      `l.ok` -> `clientRef = l.ref`;
      `l.code === 'unknown_ref'` -> `clientRef = null` (free text, no issue);
      `l.code === 'ambiguous_ref'` -> `clientRef = null` + warning `ambiguous_client` (column Empresa);
      `l.code === 'archived_ref'` -> error with `l.code` / `l.message` (column Empresa).
   3. `estimated = c.number('valorEstimado') ?? 0`; `description = c.text('descricao')` (null stays null).
   4. Vendedor: `v = c.text('vendedor')`; null -> `sellerRef = null`. Else `l = refs.resolve('person', v)`; not ok -> error with `l.code` / `l.message` (column Vendedor), `sellerRef = null`;
      ok and `'existingId' in l.ref` and the catalog person's `status !== 'active'` -> error `archived_ref` `seller_inactive` message below;
      ok and `!personIsVendedor(...)` -> error `seller_not_a_vendedor`;
      else `sellerRef = l.ref`.
   5. Produtos: for each `name` of `c.list('produtos') ?? []`: `l = refs.resolve('product', name)`;
      `l.ok` -> if an earlier item of this row has a ref that is the same entity (same `existingId` or same `planKey`) -> warning `duplicate_product` and skip; else push `{ productRef: l.ref, name }`;
      `l.code === 'unknown_ref'` and `!/^#\d+$/.test(name.trim())` -> if `[...name].length > 140` error `too_long` (column Produtos), else push `{ productRef: null, name }`;
      any other failure (unknown `#code`, `archived_ref`, `ambiguous_ref`) -> error with `l.code` / `l.message` (column Produtos).
   6. Etapa: `e = c.text('etapa')`; `motivo = c.text('motivoPerda')`. `stageRef = null`, `kind = null`.
      `e !== null`: `l = refs.resolve('stage', e)`; not ok -> error `l.code` / `l.message` (column Etapa); ok -> `kind = stageKind(l.ref, catalog)`;
      `kind === 'conversion'` -> error `conversion_stage` (column Etapa), `stageRef` stays null;
      otherwise `stageRef = l.ref`.
      Then: `kind === 'lost' && motivo === null` -> error `lost_reason_required` (column Motivo da perda);
      `kind !== 'lost' && motivo !== null` (blank or failed or conversion etapa included) -> warning `lost_reason_ignored` (column Motivo da perda), `lostReason = null`, but ONLY when the Etapa did not already fail (no double-reporting on a broken etapa);
      `lostReason = kind === 'lost' ? motivo : null`.
   7. Duplicate: when `contato !== null && empresa !== null`: `key = normalizeLabel(contato) + '|' + normalizeLabel(empresa)`; if `seen.has(key)` -> warning `possible_duplicate` (column Contato) naming the first row; else `seen.set(key, row.row)`.
   8. Schema backstop, only when `contato !== null && empresa !== null` and `rowIssues` has no error yet:
      ```ts
      const candidate = {
        contactName: contato,
        clientName: empresa,
        clientId: clientRef ? LEAD_PLACEHOLDER_ID : null,
        estimatedValueBrl: estimated,
        description,
        sellerPersonId: sellerRef ? LEAD_PLACEHOLDER_ID : null,
        products: products.map(p => (p.productRef ? { productId: LEAD_PLACEHOLDER_ID } : { productName: p.name })),
      };
      const res = CreateLeadSchema.safeParse(candidate);
      ```
      On failure, for each zod issue (deduplicated by mapped header): map `path[0]` -> key: `contactName`->`contato`, `clientName`|`clientId`->`empresa`, `estimatedValueBrl`->`valorEstimado`, `description`->`descricao`, `sellerPersonId`->`vendedor`, `products`->`produtos`, anything else -> column null; push error `invalid_lead`.
      On success keep `res.data` for the input.
   9. Append `rowIssues` to the result issues (they are already in schema column order because steps 2-6 follow it; the duplicate warning comes after the column issues of its row, the backstop last).
   10. Emit the operation when L6 holds:
      ```ts
      {
        op: 'createLead',
        planKey: `leads:${row.row}`,
        input: { contactName: data.contactName, clientName: data.clientName, estimatedValueBrl: data.estimatedValueBrl, description: data.description ?? null },
        clientRef, sellerRef, products, stageRef, lostReason,
      }
      ```
      (`products` keeps the user's spelling in `name` for both kinds; `input` is taken from the zod OUTPUT so trims and defaults are the service's.)
4. Return `{ operations, issues, counts: { leads: operations.length } }`.

### Issue catalogue (codes and exact pt-BR messages)

`<x>` is the value as typed (after the coercer's trim).

| code | severity | column | message |
| --- | --- | --- | --- |
| `no_open_stage` | error | null (row null) | `O funil de leads não tem nenhuma etapa ativa para receber leads; crie uma etapa na aba Etapas ou em Cadastros > Etapas.` |
| refs `unknown_ref` / `archived_ref` / `ambiguous_ref` | error | Vendedor, Produtos, Etapa (and Empresa for archived) | `l.message` verbatim from the RefIndex |
| `ambiguous_client` | warning | Empresa | `Há mais de um cliente chamado "<empresa>"; o lead fica com o nome como texto, sem ligação a um cadastro.` |
| `archived_ref` (inactive vendedor) | error | Vendedor | `A pessoa "<vendedor>" está inativa; escolha outro vendedor ou reative a pessoa em Cadastros > Pessoas.` |
| `seller_not_a_vendedor` | error | Vendedor | `"<vendedor>" não tem a função Vendedor; só uma pessoa com essa função pode ser o vendedor de um lead.` |
| `duplicate_product` | warning | Produtos | `"<name>" é o mesmo produto de "<first name>"; o lead fica com ele uma vez só.` |
| `too_long` | error | Produtos | `O produto "<name>" tem <n> caracteres; o limite é 140.` |
| `conversion_stage` | error | Etapa | `A etapa "<etapa>" é a de conversão; um lead só chega nela quando vira proposta dentro do Sales. Escolha outra etapa.` |
| `lost_reason_required` | error | Motivo da perda | `Preencha o motivo da perda, porque a etapa "<etapa>" é a de leads perdidos.` |
| `lost_reason_ignored` | warning | Motivo da perda | `O motivo da perda só vale na etapa de leads perdidos e será ignorado nesta linha.` |
| `possible_duplicate` | warning | Contato | `O lead de "<contato>" na empresa "<empresa>" repete a linha <first row> desta aba; confira se não é o mesmo lead.` |
| `invalid_lead` | error | mapped header or null | `O valor da coluna "<header>" não é aceito no cadastro de leads.` (column null: `A linha não forma um lead válido.`) |

## Red tests (write first, watch them fail, then implement)

File `apps/api/src/domains/import/__tests__/plan-leads.test.ts` (pure, vitest, no DB, no xlsx bytes).

Test scaffolding inside the file (not shared, not exported):

- `class FakeRefIndex implements RefIndex` with `set(kind, name, lookup)` storing under `${kind}:${normalizeLabel(name)}`; `resolve` returns the stored lookup or `{ ok: false, code: 'unknown_ref', message: \`Não encontrei "${name}".\` }`.
- `leadRow(row: number, cells: Partial<Record<ColumnKey<'leads'>, CellValue>>): ParsedRow` filling every leads column key (from `getSheetDef('leads').columns`) with `null` first; same `pessoaRow` for `pessoas` and `etapaRow` for `etapas`.
- `workbook(patch)` = `emptyParsedWorkbook()` with given rows/issues.
- `baseCatalog()`: settings 10/3/6, `today: '2026-10-02'`, `producerFlowLive: false`; funções `vendedor` (id F-V, slug vendedor, isSystem, active), `dev` (slug desenvolvedor); people `P-ANA` Ana Souza active `funcaoSlugs ['vendedor']`, `P-BIA` Bia active `['desenvolvedor']`, `P-OLD` Velho inactive `['vendedor']`; clients `C-1` Padaria Pão Quente; stages `S-NOVO` Novo normal active pos 1, `S-NEG` Em negociação normal pos 2, `S-PROP` Proposta conversion pos 3, `S-PERD` Perdido lost pos 4. Ids are readable strings (not uuids) on purpose: the planner never validates catalog ids, only the placeholder.

Named cases (describe `planLeads`):

1. `returns nothing for an empty Leads sheet` - `{ operations: [], issues: [], counts: {} }`.
2. `plans a minimal lead with free-text empresa and default stage` - contato + empresa unknown -> one op `leads:2`, `clientRef: null`, `clientName` the text, `estimatedValueBrl: 0`, `description: null`, `sellerRef: null`, `products: []`, `stageRef: null`, `lostReason: null`; `counts.leads === 1`; no issues.
3. `links an existing or workbook cliente by ref and keeps clientName` - existing -> `{ existingId: 'C-1' }`; workbook -> `{ planKey: 'clientes:3' }`; `input.clientName` equals the typed text in both.
4. `warns and keeps free text when the empresa is ambiguous` - `ambiguous_ref` -> warning `ambiguous_client`, op still emitted with `clientRef: null`.
5. `accepts an existing vendedor and a workbook pessoa carrying Vendedor` - `P-ANA` existing; workbook `pessoas:4` whose Funções is `['Vendedor', 'Desenvolvedor']` (funcao ref for Vendedor -> existing F-V) -> both ops carry the sellerRef.
6. `accepts a workbook vendedor in a fresh org where Vendedor is not in the catalog` - catalog with no funções; Funções `['vendedor']` resolves `unknown_ref` -> still a vendedor (normalized name rule).
7. `refuses a pessoa without the Vendedor função` - existing `P-BIA` and workbook pessoa with `['Desenvolvedor']` -> error `seller_not_a_vendedor`, column `Vendedor`, no op.
8. `refuses an inactive vendedor` - `P-OLD` -> error `archived_ref`, message names `Velho`.
9. `passes RefIndex failures through with their own code and message` - vendedor `unknown_ref`, etapa `archived_ref`, produto `ambiguous_ref` -> three errors with the fake's exact message and the right header.
10. `resolves produtos to refs or free names and dedupes the same produto` - `['Sistema de gestão', '#3', 'Consultoria avulsa']` where the first two resolve to the same existingId -> products `[{ productRef, name: 'Sistema de gestão' }, { productRef: null, name: 'Consultoria avulsa' }]` + warning `duplicate_product`.
11. `refuses an unknown produto code and a free name over 140 characters` - `#99` unknown -> error `unknown_ref`; a 141-character name -> error `too_long`; no op.
12. `refuses an archived produto` - `archived_ref` -> error, no op.
13. `refuses the conversion etapa` (D7) - `Proposta` -> error `conversion_stage`, column `Etapa`, no op.
14. `requires Motivo da perda for the lost etapa` (D7) - `Perdido` without motivo -> error `lost_reason_required`, column `Motivo da perda`; with motivo -> op with `stageRef: { existingId: 'S-PERD' }`, `lostReason` the text.
15. `ignores Motivo da perda outside the lost etapa with a warning` - `Em negociação` + motivo -> warning `lost_reason_ignored`, op with `lostReason: null`, `stageRef` S-NEG; blank etapa + motivo -> same warning, `stageRef: null`.
16. `targets a workbook etapa by planKey` - etapa resolves `{ planKey: 'etapas:2' }` -> op `stageRef` that planKey, no issue.
17. `reports no_open_stage once when the org and the workbook have no active normal etapa` - catalog stages only conversion+lost and empty Etapas sheet, two lead rows -> exactly one `no_open_stage` (row null); adding an Etapas row removes it.
18. `warns possible_duplicate for a repeated contato and empresa inside the workbook` - rows 2 and 5 `Carlos Lima` / `Padaria Pão Quente` vs `carlos  lima` / `PADARIA PAO QUENTE` -> one warning on row 5 naming `linha 2`; both ops emitted.
19. `skips a row with a null required cell without reporting it again` - contato null (parser already reported) -> no op, no planner issue for that row.
20. `emits no operation for a row the parser flagged` - `parsed.issues` has an error on `leads` row 3 column `Valor estimado (R$)` and the cell is null -> no op for row 3, `counts.leads` excludes it, other rows unaffected.
21. `every emitted input passes CreateLeadSchema once refs are replaced by uuids` - for all ops of a rich workbook, substitute a real uuid for every ref and `CreateLeadSchema.parse({...op.input, clientId, sellerPersonId, products})` does not throw (the executor's contract).
22. `never puts an id or planKey in a message` - over every issue produced by cases 7-18, message does not match `/[0-9a-f]{8}-[0-9a-f]{4}-/i` nor `/\b(pessoas|clientes|etapas|produtos):\d+/` nor any catalog id (`P-ANA`, `S-PERD`...).
23. `is pure` - source read of `plan/leads.ts` (readFileSync, the `lead-contract.test.ts` pattern): no `new Date`, no `process.env`, no `from '../refs.js'`, no `sales-ops/service.js`, no `lead-service.js`, no `db/`.

## Commands (run once each, never watch mode)

```bash
pnpm --filter @fxl-sales/api exec vitest run src/domains/import/__tests__/plan-leads.test.ts
pnpm --filter @fxl-sales/api exec eslint src/domains/import/plan/leads.ts src/domains/import/__tests__/plan-leads.test.ts
pnpm --filter @fxl-sales/api type-check
pnpm --filter @fxl-sales/api test
```

Named locked oracle: `apps/api/src/domains/import/__tests__/plan-leads.test.ts` (all 23 cases; the D7 oracles are cases 13 and 14, the vendedor oracle is cases 5-7).
If `@fxl-sales/shared-utils/sao-paulo-day` (pulled in by `cells.ts`) fails to resolve, run `pnpm run build:packages` once at the repo root and retry.

## Executor notes

For slice 06 (`executor.ts`). This is the exact sequence for one `createLead` operation `op`; `ids` is the executor's `planKey -> id` map, `resolveRef(ref)` returns `ref.existingId` or `ids.get(ref.planKey)` (missing -> throw `ImportExecutionError(op, 'unresolved_ref')`).

1. Scope for an import (the route already passed `requireAdmin`): `const scope: LeadScope = { userId: actor.userId, email: null, isAdmin: true };`.
   `isAdmin: true` makes `resolveLeadScopePredicate` return the no-predicate gate WITHOUT touching `resolveCallerPersonId` (which would otherwise try to self-claim a pessoa by e-mail, a write). `email: null` keeps that door shut even if the branch changes.
2. Build and VALIDATE the input (never trust the planner's shape):
   ```ts
   const input = CreateLeadSchema.parse({
     ...op.input,
     clientId: op.clientRef ? resolveRef(op.clientRef) : null,
     sellerPersonId: op.sellerRef ? resolveRef(op.sellerRef) : null,
     products: op.products.map(p => (p.productRef ? { productId: resolveRef(p.productRef) } : { productName: p.name })),
   });
   ```
   A zod failure throws `ImportExecutionError(op, 'invalid_lead')`.
3. `const created = await createLead(tx, orgId, input, scope);` inside `try`. `createLead` THROWS `LeadInputError` for seller, client, product and `no_open_stage` problems: `catch (e) { if (e instanceof LeadInputError) throw new ImportExecutionError(op, e.code); throw e; }`. A returned `{ ok: false, reason }` throws `ImportExecutionError(op, reason)`. Record `ids.set(op.planKey, created.lead.id)`.
   The lead lands in the FIRST active normal stage by `(position, name)`.
4. Only when `op.stageRef !== null`:
   ```ts
   const move = MoveLeadSchema.parse({
     stageId: resolveRef(op.stageRef),
     position: 100_000,               // clamped to the column length: appends, so workbook row order is the column order
     ...(op.lostReason !== null ? { reason: op.lostReason } : {}),
   });
   const moved = await moveLead(tx, orgId, created.lead.id, move, scope);
   ```
   Same `LeadInputError` / `{ ok: false }` wrapping as step 3. Never pass `saleId` (the planner never targets the conversion etapa; `moveLead` would throw `sale_required_for_conversion`). A lost destination without `reason` throws `lost_reason_required`, which the planner already prevents.
   `moveLead` sets `stage_changed_at` to the commit time (not a historical day); that is accepted in v1.
5. A workbook etapa (`{ planKey: 'etapas:N' }`) is resolvable here because `createLeadStage` operations come earlier in `plan.operations` (sheet order); `createLeadStage` returns a row or `'duplicate'` (sentinel -> `ImportExecutionError(op, 'duplicate')`), and the executor must record `ids.set(planKey, row.id)` for it.
6. `createLead` and `moveLead` each open `withTenant` on `tx`: that is the intended savepoint (D1). They write nothing to `audit_log`.
7. The executor's own integration test should cover: a lead in `Perdido` with its reason (`lost_reason` stored, `stage_id` the lost stage), a lead in a workbook etapa, two leads in the same stage keeping row order, and a vendedor created in the same import.

## Seam deviations

1. None to `types.ts`: the `createLead` operation shape in SEAM-CONTRACT is sufficient (`lostReason` is carried separately and only for the lost etapa).
2. Risk for the orchestrator (no change requested from this slice): `ensureLeadStages` has no production caller, so an org created after migration 0022 has ZERO stages. `planLeads` then reports `no_open_stage` (unless the Etapas sheet adds one) and `Perdido`/`Proposta` are `unknown_ref`. If the orchestrator wants a fresh org to import leads into the default funnel, slice 02 (`readImportCatalog`) and slice 06 must agree on seeding: preview cannot write (AC3), so the clean option is the executor calling `ensureLeadStages(tx, orgId)` first AND the catalog projecting `LEAD_STAGE_SEEDS` as virtual stages, which needs an `EntityRef` kind for them. This slice does not implement it; it is recorded so AC2's fresh-org round trip is checked against it (the example Leads row uses the workbook etapa `Diagnóstico`, which still works because a workbook etapa is an active normal stage).
