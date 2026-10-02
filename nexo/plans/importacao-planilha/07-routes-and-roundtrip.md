---
id: 07-routes-and-roundtrip
milestone: v4.2.0
status: done
depends_on: [03-plan-leads, 05-plan-desfechos, 06-executor, 08-template]
files_modified:
  - apps/api/src/domains/import/plan/index.ts
  - apps/api/src/domains/import/routes.ts
  - apps/api/src/domains/sales-ops/routes.ts
  - apps/api/src/domains/sales-ops/cadastro-actor.ts
  - apps/api/src/domains/import/__tests__/plan-index.test.ts
  - apps/api/src/domains/import/__tests__/import-routes.test.ts
  - apps/api/src/domains/import/__tests__/import-routes.integration.test.ts
acceptance: "On the real salesOpsRouter, a non-admin gets the requireAdmin 403 body on GET /import/template, POST /import/preview and POST /import/commit without touching the database; GET /import/template answers an xlsx attachment; a missing or non-xlsx upload answers 400 invalid_file and an oversize one 413 file_too_large; preview of an invalid workbook returns located pt-BR issues errors-first and writes nothing; and the round-trip oracle holds: the example template downloaded for a fresh org previews with ok true and zero errors, commits with 201, and the returned counts equal the rows actually created in every table, while a commit whose fresh plan has errors answers 422 and one refused mid-transaction answers 409 with nothing written."
goal: "Wire the import feature end to end: planImport runs the sheet planners in contract order and sorts issues, importRouter exposes template, preview and commit behind requireAdmin with upload limits, commit re-plans inside one tenant transaction and executes all or nothing, and integration tests prove AC2, AC3, AC4, AC7 and AC8 on the real router and the real database."
must_not_break:
  - "pnpm --filter @fxl-sales/api test (whole unit suite)"
  - "pnpm --filter @fxl-sales/api test:integration (whole integration suite)"
  - "pnpm --filter @fxl-sales/api lint"
  - "pnpm --filter @fxl-sales/api type-check (tsconfig.json, tsconfig.scripts.json, tsconfig.test.json)"
  - apps/api/src/domains/sales-ops/__tests__/routes.test.ts
  - apps/api/src/domains/sales-ops/__tests__/financial-admin-gate.test.ts
  - apps/api/src/domains/sales-ops/__tests__/history-route.test.ts
  - apps/api/src/domains/sales-ops/__tests__/settlements.integration.test.ts
  - apps/api/src/domains/import/__tests__/parse.test.ts
  - scripts/__tests__/auth-fake-isolation.test.mjs
rules:
  - "Every import route carries `requireAdmin` from `../../middleware/require-admin.js` as its FIRST handler (before the body limit and before any parse); no inline admin check, no other 403 body."
  - "The org is ONLY `c.get('orgId')` and the actor ONLY `cadastroActor(c)`; nothing from the multipart body other than the `file` bytes is read."
  - "Amendment D11: every import route opens `withTenant(getDb(), orgId, ...)` and calls `ensureLeadStages(tx, orgId)` BEFORE `readImportCatalog(tx, orgId, now)`, through the one helper `seededCatalog`. Preview and template run it inside a tenant transaction that is ALWAYS rolled back (`readOnlyTenant`, a private sentinel thrown inside and caught outside `withTenant`), so they write nothing; commit keeps the seed in its committed transaction. Commit never trusts the preview: it re-parses, re-reads the catalog INSIDE the commit transaction, re-plans, and executes only when the fresh plan has zero errors."
  - "Commit is ONE `withTenant(getDb(), orgId, ...)`; a plan with errors and an ImportExecutionError both leave it by THROWING, so Postgres rolls back; never return from inside the transaction on a failure path."
  - "plan/index.ts is pure: no I/O, no clock, no env; it imports the four planners and buildRefIndex and nothing from routes or the database."
  - "Issue order: errors before warnings; inside a severity, file-level (sheet null) first, then SHEET_KEYS order, then row ascending with null first; ties keep their original order (stable sort)."
  - "Truncation happens once, in toPreviewBody, at MAX_RETURNED_ISSUES; `ok` is computed from the FULL issue list."
  - "No new dependency; `bodyLimit` comes from `hono/body-limit` (already in hono 4.12.28). Do not touch cors.ts (the web names the downloaded file itself)."
  - "No em dash in any file; relative imports use `.js`; no `any`; no docs edits (the scribe owns docs)."
  - "Do not touch apps/web/** and never apps/web/src/sales-ops/leads/** (live peer run)."
verifier_focus: "That the round-trip oracle really downloads the example through GET /template?example=1 (not exampleTabs()) and compares counts against SELECT counts per table, not against the response; that preview/template use the always-rollback helper so a catalog read that seeds cannot persist; that the 422 and 409 paths throw out of withTenant (verify zero rows afterwards); that requireAdmin precedes bodyLimit on both POST routes; that all three routes seed through `seededCatalog` (ensureLeadStages before readImportCatalog, D11) and only commit keeps the seed; that the cadastroActor move left sales-ops/routes.ts behaviour identical; and that the mount line sits under the existing appAuthMiddleware prefix."
---

# Slice 07 - routes and the round trip

## Objective

Make the import usable over HTTP and prove the whole pipeline (template -> parse -> catalog -> plan -> execute) against the real database.
After this slice `GET /api/v1/sales-ops/import/template`, `POST /api/v1/sales-ops/import/preview` and `POST /api/v1/sales-ops/import/commit` exist for admins, exactly as the SEAM HTTP wire contract says.

## Code facts (verified while planning)

- `server.ts` line 129-130: `app.use('/api/v1/sales-ops/*', appAuthMiddleware); app.route('/api/v1/sales-ops', salesOpsRouter);`. A sub-router mounted with `salesOpsRouter.route('/import', importRouter)` is therefore behind `appAuthMiddleware`, which sets `userId`, `orgId`, `userRole`, `userRoles`, `hubAuth`. `errorMiddleware` turns any other throw into `500 { error: 'internal_server_error', message }`.
- `requireAdmin` (`apps/api/src/middleware/require-admin.ts`) answers `403 ADMIN_ROLE_REQUIRED_BODY` = `{ error: 'forbidden', reason: 'admin_role_required' }` when `c.get('userRole') !== 'admin'`. Sales-ops routes apply it per route: `salesOpsRouter.post('/funcoes', requireAdmin, async (c) => ...)`.
- `cadastroActor(c)` is a module-private function in `sales-ops/routes.ts` (line 78): `{ userId: c.get('userId'), displayName: getHubActorDisplayName(c.get('hubAuth')) }`, typed by `CadastroActor` from `service.ts`. Importing it from `import/routes.ts` would create an import cycle (`sales-ops/routes.ts` imports `import/routes.ts`), so this slice moves it to its own module (see Step 1).
- `withTenant(db, orgId, fn)` is exported from `sales-ops/service.ts` (line 1418): `db.transaction(async (tx) => { await setTenantContext(tx, orgId); return fn(tx); })`. A throw inside `fn` rolls the transaction back and rethrows the same error object.
- `Db` is exported from `sales-ops/service.ts` (`ReturnType<typeof getDb>`).
- `hono/body-limit` exists in the installed hono: with a `content-length` header it compares the header; otherwise it streams and counts, calling `onError(c)` past `maxSize`. Its `onError` may return a Response.
- `c.req.parseBody()` returns `Record<string, string | File>` for `multipart/form-data` and `{}` for other content types; a malformed multipart body throws.
- `isProducerFlowLive` / `registerProducerFlowGate` live in `domains/integration/producer-gate.ts`; the default gate is `false`; tests may register their own.
- `ensureLeadStages(tx, orgId)` (`sales-ops/leads/stages-seed.ts`, line 62) seeds `LEAD_STAGE_SEEDS` (`Novo` and `Em negociação` with `isSystem: false`, `Proposta` conversion and `Perdido` lost with `isSystem: true`) when the org has ZERO stages and returns the stages; it must run inside a tenant transaction. It has no production caller today, so Amendment D11 makes the import routes its caller. `LEAD_STAGE_SEEDS` is exported from the same file.
- Integration tests: files matching `src/**/*.integration.test.ts` run only under `pnpm --filter @fxl-sales/api test:integration` (`VITEST_INTEGRATION=1 vitest run`), serially (`fileParallelism: false`), with `getDb()` pointed at the local test DB by `test/rls/setup-env.ts`. The reference pattern is `src/domains/sales-ops/__tests__/settlements.integration.test.ts`: blank the Hub env names in `vi.hoisted`, `await import('../routes.js')`, a Hono app whose first middleware sets `userId`/`orgId`/`userRole`/`userRoles`/`hubAuth` (fixture `hubAuthContext` from `src/auth/__tests__/hub-auth-context-fixture.ts`), cleanup through `getAdminDb()` after `deleteSettlementsForOrgs` (`src/db/__tests__/settlement-test-cleanup.ts`), `closeDb()` in `afterAll`.
- `audit_log` rows may be deleted by `actor_org_id` in `afterAll` only because the integration project is serial (see `test/rls/cadastro-archive-audit.test.ts` comment); this slice does the same, tail-only, for its own orgs.
- Unit admin-gate pattern: `src/domains/sales-ops/__tests__/financial-admin-gate.test.ts` (real `salesOpsRouter`, `vi.mock('../../../db/client.js')`, context set by a test middleware).

## Step 1 - `apps/api/src/domains/sales-ops/cadastro-actor.ts` (new, moved verbatim)

```ts
import type { Context } from 'hono';
import { getHubActorDisplayName } from '../../middleware/app-auth.js';
import type { CadastroActor } from './service.js';

/** (move the existing doc comment from sales-ops/routes.ts here, unchanged) */
export function cadastroActor(c: Context): CadastroActor {
  return { userId: c.get('userId'), displayName: getHubActorDisplayName(c.get('hubAuth')) };
}
```

In `sales-ops/routes.ts`: delete the local `cadastroActor` function and its comment, delete the now-unused `getHubActorDisplayName` import, add `import { cadastroActor } from './cadastro-actor.js';`. Every existing call site stays as is. The return type annotation becomes `CadastroActor` (structurally identical to the old inline type).

## Step 2 - `apps/api/src/domains/import/plan/index.ts`

Imports: `buildRefIndex` from `../refs.js`; `planCadastros` from `./cadastros.js`; `planLeads` from `./leads.js`; `planPropostas` from `./propostas.js`; `planDesfechos` from `./desfechos.js`; `SHEET_KEYS, MAX_RETURNED_ISSUES` from `../workbook-schema.js`; types `ImportCatalog, ImportCounts, ImportIssue, ImportPlan, ImportPreviewBody, ParsedWorkbook, SheetKey, SheetPlanResult` from `../types.js`.

Exports (exact):

```ts
export function planImport(parsed: ParsedWorkbook, catalog: ImportCatalog): ImportPlan;
export function compareIssues(a: ImportIssue, b: ImportIssue): number;
export function sortIssues(issues: readonly ImportIssue[]): ImportIssue[];
export function mergeCounts(...parts: readonly ImportCounts[]): ImportCounts;
export function isPlanOk(plan: Pick<ImportPlan, 'issues'>): boolean;
export function toPreviewBody(plan: ImportPlan): ImportPreviewBody;
```

Algorithm of `planImport`:

1. `const refs = buildRefIndex(parsed, catalog);` exactly once.
2. `const cadastros = planCadastros(parsed, catalog, refs);`
3. `const leads = planLeads(parsed, catalog, refs);`
4. `const propostas = planPropostas(parsed, catalog, refs);`
5. `const desfechos = planDesfechos(parsed, catalog, refs, propostas);` (the SAME `propostas` object).
6. `operations = [...cadastros.operations, ...leads.operations, ...propostas.operations, ...desfechos.operations]` (no reordering; desfechos ops come after every createSale by construction).
7. `issues = sortIssues([...parsed.issues, ...cadastros.issues, ...leads.issues, ...propostas.issues, ...desfechos.issues])`.
8. `counts = mergeCounts(cadastros.counts, leads.counts, propostas.counts, desfechos.counts)`.
9. Return `{ operations, issues, counts }`.

`compareIssues`: severity rank (`error` 0, `warning` 1); then sheet rank (`null` -> -1, else `SHEET_KEYS.indexOf(sheet)`); then row (`null` -> -1, else the number); returns the first non-zero difference, else 0.
`sortIssues`: `[...issues].sort(compareIssues)` (Array.prototype.sort is stable in ES2019+, so ties keep the planner order, which is column order inside a row).
`mergeCounts`: for each part and each `[key, n]` of `Object.entries(part)` with `typeof n === 'number'`, add into the result (`(result[key] ?? 0) + n`); a key never seen stays absent (never write zeros). Type the loop with `Object.entries(part) as Array<[SheetKey, number | undefined]>` (the one allowed cast, commented).
`isPlanOk`: `!plan.issues.some((i) => i.severity === 'error')`.
`toPreviewBody`: `{ ok: isPlanOk(plan), counts: plan.counts, issues: plan.issues.slice(0, MAX_RETURNED_ISSUES), truncated: plan.issues.length > MAX_RETURNED_ISSUES }`. It does not re-sort (planImport already sorted).

## Step 3 - `apps/api/src/domains/import/routes.ts`

Imports: `Hono, type Context` from `hono`; `bodyLimit` from `hono/body-limit`; `getDb` from `../../db/client.js`; `requireAdmin` from `../../middleware/require-admin.js`; `withTenant, type Db` from `../sales-ops/service.js`; `ensureLeadStages` from `../sales-ops/leads/stages-seed.js`; `cadastroActor` from `../sales-ops/cadastro-actor.js`; `readImportCatalog` from `./catalog.js`; `executeImportPlan, ImportExecutionError` from `./executor.js`; `parseWorkbook, INVALID_FILE_CODE` from `./parse.js`; `planImport, isPlanOk, toPreviewBody` from `./plan/index.js`; `buildTemplateWorkbook` from `./template.js`; `MAX_UPLOAD_BYTES, SHEET_KEYS, getSheetDef` from `./workbook-schema.js`; types `ImportCatalog, ImportCommitBody, ImportOperation, ImportPlan, ParsedWorkbook, SheetKey` from `./types.js`.

Exports: `importRouter` (a `new Hono()`), plus, for the unit tests, `XLSX_CONTENT_TYPE`, `TEMPLATE_FILENAME`, `EXAMPLE_TEMPLATE_FILENAME`, `INVALID_FILE_BODY`, `FILE_TOO_LARGE_BODY`, `MULTIPART_OVERHEAD_BYTES`, `describeExecutionFailure`.

Constants (exact):

```ts
export const XLSX_CONTENT_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
export const TEMPLATE_FILENAME = 'fxl-sales-importacao.xlsx';
export const EXAMPLE_TEMPLATE_FILENAME = 'fxl-sales-importacao-exemplo.xlsx';
export const INVALID_FILE_BODY = { error: 'validation_error', reason: 'invalid_file' } as const;
export const FILE_TOO_LARGE_BODY = { error: 'payload_too_large', reason: 'file_too_large' } as const;
/** Room for the multipart boundary and part headers around the file itself. */
export const MULTIPART_OVERHEAD_BYTES = 64 * 1024;
```

Private helpers:

```ts
const READ_ONLY_ROLLBACK = new Error('import_read_only_rollback');

/** Runs fn in a tenant transaction that is ALWAYS rolled back: a dry run cannot write, even if a reader seeds. */
async function readOnlyTenant<T>(orgId: string, fn: (tx: Db) => Promise<T>): Promise<T> {
  const box: { result?: { value: T } } = {};
  try {
    await withTenant(getDb(), orgId, async (tx) => {
      box.result = { value: await fn(tx) };
      throw READ_ONLY_ROLLBACK;
    });
  } catch (error) {
    if (error !== READ_ONLY_ROLLBACK) throw error;
  }
  if (!box.result) throw new Error('read-only tenant transaction produced no result');
  return box.result.value;
}

/** Amendment D11: the default etapas exist before the catalog is read, in EVERY import route's transaction. */
async function seededCatalog(tx: Db, orgId: string, now: Date): Promise<ImportCatalog> {
  await ensureLeadStages(tx, orgId);
  return readImportCatalog(tx, orgId, now);
}

/** Thrown out of the commit transaction so a plan with errors rolls back whatever the catalog read did. */
class ImportPlanRejected extends Error {
  constructor(readonly plan: ImportPlan) { super('import_plan_rejected'); }
}

const uploadBodyLimit = bodyLimit({
  maxSize: MAX_UPLOAD_BYTES + MULTIPART_OVERHEAD_BYTES,
  onError: (c) => c.json(FILE_TOO_LARGE_BODY, 413),
});

type UploadResult = { ok: true; parsed: ParsedWorkbook } | { ok: false; status: 400 | 413 };

/** Reads the `file` field and parses it. Never throws for user input. */
async function readUpload(c: Context): Promise<UploadResult>;
```

`readUpload` algorithm:
1. `let body; try { body = await c.req.parseBody(); } catch { return { ok: false, status: 400 }; }`
2. `const file = body['file'];` if `!(file instanceof File)` -> `{ ok: false, status: 400 }` (covers missing field, a text field and JSON bodies).
3. `if (file.size > MAX_UPLOAD_BYTES)` -> `{ ok: false, status: 413 }`.
4. `const parsed = await parseWorkbook(new Uint8Array(await file.arrayBuffer()));`
5. `if (parsed.issues.some((i) => i.code === INVALID_FILE_CODE))` -> `{ ok: false, status: 400 }` (amendment 7; `no_known_sheets` is NOT a 400).
6. `{ ok: true, parsed }`.
A route turns `{ ok: false, status: 400 }` into `c.json(INVALID_FILE_BODY, 400)` and `413` into `c.json(FILE_TOO_LARGE_BODY, 413)`.

`describeExecutionFailure(error: ImportExecutionError): string`:
- `key = 'planKey' in error.operation ? error.operation.planKey : error.operation.saleKey`.
- Split once on `:`: `sheetKey`, `rowText`. When `sheetKey` is in `SHEET_KEYS` and `rowText` is a positive integer: `place = \`na linha ${row} da aba "${getSheetDef(sheetKey).tab}"\``; otherwise `place = 'em uma das linhas'`.
- `cause = error.reason === 'producer_flow_live' ? 'a organização está conectada ao Finance e não aceita propostas ganhas nem pagamentos importados' : 'o cadastro recusou a linha'`.
- Return `` `A gravação parou ${place} porque ${cause}; nada foi importado. Gere a pré-visualização de novo.` ``
- It never includes `error.reason` verbatim for other reasons, a uuid or a planKey.

Routes (in this order, each with `requireAdmin` first):

```ts
importRouter.get('/template', requireAdmin, async (c) => {
  const example = c.req.query('example') === '1';
  const orgId = c.get('orgId');
  const now = new Date();
  // Rolled back: the dropdowns list the default etapas without persisting them.
  const catalog = await readOnlyTenant(orgId, (tx) => seededCatalog(tx, orgId, now));
  const bytes = await buildTemplateWorkbook(catalog, { example });
  return c.body(bytes, 200, {
    'Content-Type': XLSX_CONTENT_TYPE,
    'Content-Disposition': `attachment; filename="${example ? EXAMPLE_TEMPLATE_FILENAME : TEMPLATE_FILENAME}"`,
    'Cache-Control': 'no-store',
  });
});
```
(`await` works whether slice 08 returns `Buffer` or `Promise<Buffer>`; if its return type is not assignable to `c.body`'s data, wrap with `new Uint8Array(bytes)`.)

```ts
importRouter.post('/preview', requireAdmin, uploadBodyLimit, async (c) => {
  const upload = await readUpload(c);
  if (!upload.ok) return upload.status === 413 ? c.json(FILE_TOO_LARGE_BODY, 413) : c.json(INVALID_FILE_BODY, 400);
  const orgId = c.get('orgId');
  const now = new Date();
  // D11: seed, read and plan in one transaction, then roll it back; preview writes nothing.
  const plan = await readOnlyTenant(orgId, async (tx) => planImport(upload.parsed, await seededCatalog(tx, orgId, now)));
  return c.json(toPreviewBody(plan), 200);
});

importRouter.post('/commit', requireAdmin, uploadBodyLimit, async (c) => {
  const upload = await readUpload(c);
  if (!upload.ok) return upload.status === 413 ? c.json(FILE_TOO_LARGE_BODY, 413) : c.json(INVALID_FILE_BODY, 400);
  const orgId = c.get('orgId');
  const actor = cadastroActor(c);
  const now = new Date();
  try {
    const result = await withTenant(getDb(), orgId, async (tx) => {
      // D11: the seed is part of the committed transaction (and rolls back with it on any failure).
      const plan = planImport(upload.parsed, await seededCatalog(tx, orgId, now));
      if (!isPlanOk(plan)) throw new ImportPlanRejected(plan);
      return executeImportPlan(tx, orgId, plan, actor, now);
    });
    const body: ImportCommitBody = { counts: result.counts };
    return c.json(body, 201);
  } catch (error) {
    if (error instanceof ImportPlanRejected) return c.json(toPreviewBody(error.plan), 422);
    if (error instanceof ImportExecutionError) {
      return c.json({ error: 'conflict', reason: 'import_execution_failed', message: describeExecutionFailure(error) }, 409);
    }
    throw error;
  }
});
```

Top-of-file comment: three sentences: the three routes are admin-only; every route seeds the default etapas before reading the catalog (D11), and preview and template do it in an always-rolled-back transaction; commit re-plans inside its own transaction and leaves it by throwing on every failure path.

## Step 4 - the mount line in `apps/api/src/domains/sales-ops/routes.ts`

Add `import { importRouter } from '../import/routes.js';` with the other router imports, and, directly after `salesOpsRouter.route('/leads', leadsRouter);`:

```ts
// Planilha de importação (cadastros/importacao). Admin-only per route inside importRouter.
salesOpsRouter.route('/import', importRouter);
```

No other change to the file beyond Step 1. CORS is untouched (the web chooses the download filename itself).

## Red tests (write first, watch them fail, then implement)

### `apps/api/src/domains/import/__tests__/plan-index.test.ts` (unit)

`vi.mock` `../refs.js` (`buildRefIndex` returns a sentinel `{ resolve: vi.fn() }`), `../plan/cadastros.js`, `../plan/leads.js`, `../plan/propostas.js`, `../plan/desfechos.js` with `vi.fn()` planners returning hand-built `SheetPlanResult`s; then `await import('../plan/index.js')`. Use `emptyParsedWorkbook()` from `../parse.js` (not mocked) plus a pushed issue for parser issues, and a minimal `ImportCatalog` literal typed `ImportCatalog`.

- `builds the ref index once and hands the same index to every planner` - `buildRefIndex` called once with `(parsed, catalog)`; each planner's third argument is that sentinel; `planDesfechos`'s fourth argument is the exact object `planPropostas` returned (`toBe`).
- `concatenates operations in cadastros, leads, propostas, desfechos order` - each mock returns one distinctive op (`createArea areas:2`, `createLead leads:2`, `createSale propostas:2`, `transitionSale propostas:2`); `plan.operations.map(o => o.op)` equals that order.
- `puts errors before warnings, file-level before sheets, sheet order, then row` - parser issues: a warning `unknown_sheet` (sheet null) and an error on `parcelas` row 3; planner issues: an error on `areas` row 5, an error on `areas` row null, a warning on `propostas` row 2, an error with sheet null; expected order asserted by `[severity, sheet, row]` tuples: `error null null`, `error areas null`, `error areas 5`, `error parcelas 3`, `warning null null`, `warning propostas 2`.
- `keeps the original order for ties` - two errors on `produtos` row 4 with codes `a` then `b` from different planners keep `a`, `b`.
- `merges counts by summing per sheet and never writes zeros` - `{ areas: 1 }`, `{ leads: 2 }`, `{ propostas: 1 }`, `{}` -> `{ areas: 1, leads: 2, propostas: 1 }`; `mergeCounts({ areas: 1 }, { areas: 2 })` -> `{ areas: 3 }`.
- `is ok only with zero errors` - warnings only -> `isPlanOk` true; one error -> false.
- `toPreviewBody truncates at MAX_RETURNED_ISSUES and flags it` - 501 issues (1 error first then 500 warnings) -> `issues.length === 500`, `truncated: true`, `ok: false`, first issue is the error; exactly 500 -> `truncated: false`; `counts` passed through.

### `apps/api/src/domains/import/__tests__/import-routes.test.ts` (unit, REAL salesOpsRouter, fake db)

Setup like `financial-admin-gate.test.ts`: `vi.hoisted` blanks the Hub env names (same list as `settlements.integration.test.ts`); `vi.mock('../../../db/client.js', () => ({ getDb: () => fakeDb, getAdminDb: () => fakeDb, closeDb: async () => undefined }))` where `fakeDb = { transaction: vi.fn(async () => { throw new Error('fake db reached'); }) }`; `const { salesOpsRouter } = await import('../../sales-ops/routes.js');`; a Hono test app whose first middleware sets `userId`, `orgId`, `userRole` (`currentRole`), `userRoles`, `hubAuth` (fixture) and `app.route('/', salesOpsRouter)`. Upload helper: `form(file?: Blob | string)` builds a `FormData` with field `file` (a `File` named `planilha.xlsx` when bytes are given). Valid bytes: `await buildXlsx(exampleTabs())` from `./xlsx-fixture.js`.

- `answers the requireAdmin body on every import route for a non-admin` - for roles `seller`, `finder`, `undefined` and the three routes (`GET /import/template`, `POST /import/preview` and `POST /import/commit` with valid bytes): status 403, JSON equals `{ error: 'forbidden', reason: 'admin_role_required' }`, `fakeDb.transaction` never called.
- `answers the admin 403 before the upload limit` - seller posting a `MAX_UPLOAD_BYTES + 1` file to preview -> 403 (not 413).
- `refuses a missing, non-file or non-xlsx upload with invalid_file` - admin: empty FormData; `file` as a text field; a JSON body `{}` with `content-type: application/json`; a `File` of `Buffer.from('hello')`; a zero-byte `File` -> each 400 `{ error: 'validation_error', reason: 'invalid_file' }` on preview AND commit; `fakeDb.transaction` never called.
- `refuses an oversize file with file_too_large` - admin, a `File` of `MAX_UPLOAD_BYTES + 1` zero bytes -> 413 `{ error: 'payload_too_large', reason: 'file_too_large' }` on preview and commit; a raw body of `MAX_UPLOAD_BYTES + MULTIPART_OVERHEAD_BYTES + 1` bytes with a multipart content type -> 413 same body (the bodyLimit path); db never reached.
- `reaches the database only for an admin with a valid workbook` - admin preview with valid bytes -> `fakeDb.transaction` called once (response 500 from the fake throw; assert only the call count).
- `describes an execution failure by tab and row without codes or ids` - `describeExecutionFailure(new ImportExecutionError({ op: 'createSale', planKey: 'propostas:2', input: ..., wonOn: '2026-01-20' } as ImportOperation-compatible literal, 'producer_flow_live'))` contains `linha 2`, `"Propostas"` and `Finance`; with reason `duplicate` on `{ op: 'createArea', planKey: 'areas:7', input: { name: 'X' } }` contains `linha 7`, `"Áreas"`, and does not contain `duplicate` nor `areas:7`; a `settleReceivable` op with `saleKey: 'propostas:3'` names `linha 3` of `"Propostas"`. (Build the `createSale` input by importing nothing: use a `createArea`/`settleReceivable`/`transitionSale` op for the producer case if a full `SaleDraft` literal is heavy: `{ op: 'settleReceivable', saleKey: 'propostas:2', receivableLabel: '1/1', paidOn: '2026-01-20', settlePayables: false }`.)

### `apps/api/src/domains/import/__tests__/import-routes.integration.test.ts` (integration, REAL router, REAL database) - THE ORACLE FILE

Setup like `settlements.integration.test.ts`: hoisted Hub env blanking; `const gate = vi.hoisted(() => ({ liveAfterCatalog: false, live: false }));`; `vi.mock('../catalog.js', async (importOriginal) => { const actual = await importOriginal<typeof import('../catalog.js')>(); return { ...actual, readImportCatalog: async (...args: Parameters<typeof actual.readImportCatalog>) => { const catalog = await actual.readImportCatalog(...args); if (gate.liveAfterCatalog) gate.live = true; return catalog; } }; });`; `const { salesOpsRouter } = await import('../../sales-ops/routes.js');`; `registerProducerFlowGate((orgId) => gate.live && orgId === currentOrgId)` in `beforeEach`, and in `afterEach` reset `gate` to false/false and `registerProducerFlowGate(() => false)`.
Context middleware sets `userId = ACCOUNT_ID`, `orgId = currentOrgId`, `userRole = 'admin'`, `userRoles = ['admin','seller','finder']`, `hubAuth = hubAuthContext({ accountId: ACCOUNT_ID, workspaceId: currentOrgId, name: 'Equipe FXL' })`.
`newOrg(tag)` = `` `org_imp_${tag}_${crypto.randomUUID()}` `` pushed into `seededOrgIds`.

Helpers (write them in the file):
- `upload(path: '/import/preview' | '/import/commit', bytes: Buffer)` -> `app.request(path, { method: 'POST', body: formWith(bytes) })`.
- `orgTableCounts(orgId)` -> an object with UNFILTERED `count()` per org table, via `getAdminDb().select({ n: count() }).from(t).where(eq(t.orgId, orgId))` for `salesOpsAreas, salesOpsFuncoes, salesOpsProducts, salesOpsProductFuncaoCosts, salesOpsPeople, salesOpsPersonFuncoes, salesOpsClients, salesOpsLeadStages, salesOpsLeads, salesOpsLeadProducts, salesOpsSales, salesOpsSaleItems, salesOpsSaleProfessionals, salesOpsReceivables, salesOpsPayables, salesOpsSettlements`, plus `auditLog` by `actorOrgId` and `integrationOutbox` by `organizationId`. `expectNothingWritten(orgId)` asserts every value is 0.
- `createdBySheet(orgId)` -> the per-SheetKey DB count the oracle compares to `counts`: `areas` all areas; `funcoes` funções with `notInArray(slug, ['vendedor', 'finder', 'prestador'])` (system/legacy seeds are created on demand by the person path and are not workbook rows); `produtos` products; `custosProduto` product_funcao_costs; `pessoas` people; `clientes` clients; `etapas` lead stages with `notInArray(name, LEAD_STAGE_SEEDS.map((s) => s.name))` (the D11 seeds `Novo` and `Em negociação` are `isSystem: false`, so `isSystem` cannot tell them apart from workbook etapas); `leads` leads; `propostas` sales; `itens` sale items; `profissionais` sale professionals; `parcelas` receivables with `notLike(label, 'M%')`; `pagamentos` settlements with `type = 'baixa'` and `isNotNull(receivableId)`.
- `setCell(tab: FixtureTab, sheet: SheetKey, header: string, value: FixtureCell, rowIndex = 1)` writes into `tab.rows[rowIndex][headerRow(sheet).indexOf(header)]` (throws when the header is absent).
- Cleanup `afterEach`: `deleteSettlementsForOrgs(seededOrgIds)` first, then via `getAdminDb()` delete per org in FK-safe order: payables, receivables, sale professionals, sale items, sales, lead products, leads, lead stages, product funcao costs, products, person funcoes, people, funcoes, clients, areas, integration outbox (by `organizationId`); collect org ids into `auditOrgIds` for `afterAll`, which deletes `audit_log WHERE actor_org_id = ANY(...)` (tail-only, serial project) and then `closeDb()`.

Tests:
- `downloads the blank and the example template as xlsx attachments` - `GET /import/template` -> 200, `content-type` equals `XLSX_CONTENT_TYPE`, `content-disposition` equals `attachment; filename="fxl-sales-importacao.xlsx"`; load the bytes with `new ExcelJS.Workbook().xlsx.load(...)`: the visible worksheets (`state === 'visible'`) are `['Leia-me', ...WORKBOOK_SHEETS.map(s => s.tab)]` in order; `?example=1` -> filename `fxl-sales-importacao-exemplo.xlsx`; both `expectNothingWritten(orgId)`.
- `preview seeds the default etapas only inside its rolled-back transaction` (D11) - fresh org; a workbook with only a `Leads` tab (`headerRow('leads')` plus `exampleRow('leads')` with `Empresa` = `Empresa Avulsa`, `Vendedor` = null, `Produtos` = null and `Etapa` = `Novo`, a seed name) -> preview 200 with zero errors on `leads` (the seeded etapa resolved); `expectNothingWritten(orgId)` afterwards (zero lead stages persisted).
- `previews an invalid workbook with located pt-BR issues and writes nothing` (AC3) - workbook = `exampleTabs()` with `Parcelas` `Valor (R$)` set to `'abc'`, `Propostas` `Cliente` set to `'Cliente Que Não Existe'`, and a `Áreas` second data row `[null]` plus a non-blank extra cell so the row is not blank (or simply `Nome` = `'   '` with another filled cell - use `setCell` on a pushed row): status 200; `ok: false`; issues contain `{ severity: 'error', sheet: 'parcelas', row: 2, column: 'Valor (R$)', code: 'invalid_money' }` (use `expect.objectContaining`) and an error on `propostas` row 2 column `Cliente` whose message contains `Cliente Que Não Existe`; every error precedes every warning; no message matches `/[0-9a-f]{8}-[0-9a-f]{4}-/`; `expectNothingWritten(orgId)`.
- `round-trips the example template of a fresh org` (THE ORACLE, AC2) - fresh org; `GET /import/template?example=1` bytes; `expectNothingWritten` (the template's D11 seed was rolled back); `POST /import/preview` with those bytes -> 200, `issues.filter(i => i.severity === 'error')` equals `[]` (assert the filtered list so a failure prints the issues), `ok: true`, `truncated: false`, `counts` equals `Object.fromEntries(SHEET_KEYS.map(k => [k, 1]))` (every example sheet has exactly one row); `expectNothingWritten` again (preview wrote nothing); `POST /import/commit` with the SAME bytes -> 201; `body.counts` toEqual the preview counts; `createdBySheet(orgId)` toEqual `body.counts`; the sale row has `status 'won'` and `won_at` whose São Paulo day (`saoPauloDayOf`) is `2026-01-20`; every settlement of the org has `origin 'manual'`; exactly one `audit_log` row for the org with `action 'import.completed'`; zero `integration_outbox` rows for the org; the org now has the four `LEAD_STAGE_SEEDS` etapas plus `Diagnóstico` (D11: commit keeps the seed).
- `refuses to commit a workbook whose fresh plan has errors` (AC4, 422) - commit the invalid workbook of the AC3 test -> 422, body has `ok: false`, `truncated: false`, the same located `invalid_money` issue; `expectNothingWritten`.
- `re-plans at commit instead of trusting the preview` (AC4) - fresh org; preview the example -> ok true; then create the área `Tecnologia` directly with `createArea(getDb(), orgId, AreaSchema.parse({ name: 'Tecnologia' }))` (AreaSchema/createArea from `../../sales-ops/service.js`); commit the same bytes -> 422 with an error `{ sheet: 'areas', row: 2, code: 'duplicate_existing' }`; the org still has exactly that one área and zero products, people, clients, sales and audit rows.
- `rolls everything back when a service refuses mid-transaction` (AC4, 409) - fresh org; `gate.liveAfterCatalog = true` (the catalog reads `producerFlowLive: false`, the executor's re-check then sees live and throws `ImportExecutionError(op, 'producer_flow_live')` at the won createSale, AFTER the cadastros were written); commit the example -> 409, body `{ error: 'conflict', reason: 'import_execution_failed', message }` with `message` containing `"Propostas"` and `linha 2`; `expectNothingWritten(orgId)` (áreas, funções, produtos, pessoas, clientes, etapas and leads written earlier in the same transaction are gone).
- `refuses won propostas and payments in a Finance-connected org and emits nothing` (AC7) - fresh org, `gate.live = true` from the start; preview the example -> `ok: false`, errors with code `producer_flow_live` on `propostas` row 2 and `pagamentos` row 2; then build a workbook from `exampleTabs()` without the `Pagamentos` tab, `Propostas` row 2 `Situação` = `Perdida` and `Data de ganho` = null, plus a pushed Propostas row 3 copied from row 2 with `Ref` = `P2`, `Situação` = `Cancelada`, `Data de ganho` = null, `Produto` = `Sistema de gestão` (basic depth, no child rows); preview -> ok true; commit -> 201 with `counts.propostas === 2`; the two sales end `lost` and `cancelled`; zero `integration_outbox` rows for the org (the D2 proof asked by slice 05, note 5).
- `refuses an oversize upload through the real router` - `POST /import/preview` with a `File` of `MAX_UPLOAD_BYTES + 1` bytes -> 413 `FILE_TOO_LARGE_BODY`; `expectNothingWritten`.

## Commands (run once each, never watch mode)

Prerequisite for the integration run: the local Docker test DB is up (`docker compose up -d` at the repo root, as for every integration file) and `apps/api/.env` carries `TEST_DATABASE_URL`, `ADMIN_DATABASE_URL`, `TEST_MIGRATE_DATABASE_URL` (local hosts only; `assert-test-role.ts` refuses anything else).

```bash
pnpm --filter @fxl-sales/api exec vitest run src/domains/import/__tests__/plan-index.test.ts src/domains/import/__tests__/import-routes.test.ts
pnpm --filter @fxl-sales/api test:integration src/domains/import/__tests__/import-routes.integration.test.ts
pnpm --filter @fxl-sales/api exec vitest run src/domains/sales-ops/__tests__/routes.test.ts src/domains/sales-ops/__tests__/financial-admin-gate.test.ts src/domains/sales-ops/__tests__/history-route.test.ts
pnpm --filter @fxl-sales/api exec eslint src/domains/import/plan/index.ts src/domains/import/routes.ts src/domains/sales-ops/routes.ts src/domains/sales-ops/cadastro-actor.ts src/domains/import/__tests__/plan-index.test.ts src/domains/import/__tests__/import-routes.test.ts src/domains/import/__tests__/import-routes.integration.test.ts
pnpm --filter @fxl-sales/api type-check
pnpm --filter @fxl-sales/api test
pnpm --filter @fxl-sales/api test:integration
```

Named locked oracles for this slice:
- `src/domains/import/__tests__/import-routes.integration.test.ts` - `round-trips the example template of a fresh org` (AC2), `previews an invalid workbook with located pt-BR issues and writes nothing` (AC3), `rolls everything back when a service refuses mid-transaction` and `re-plans at commit instead of trusting the preview` (AC4), `refuses won propostas and payments in a Finance-connected org and emits nothing` (AC7).
- `src/domains/import/__tests__/import-routes.test.ts` - `answers the requireAdmin body on every import route for a non-admin` (AC8).
- `src/domains/import/__tests__/plan-index.test.ts` - `puts errors before warnings, file-level before sheets, sheet order, then row`.

If the round trip fails, the failure is almost always in an upstream planner or the executor (slices 02-06, 08), not in the wiring: read the printed error list, fix the owning slice's file only if this slice's executor is explicitly allowed to, otherwise record it in the exec notes as a blocker naming the owning slice. Never weaken the oracle (never filter issues, never relax the counts equality).

## Seam deviations

1. `cadastroActor` moves from a private function in `sales-ops/routes.ts` to the new `apps/api/src/domains/sales-ops/cadastro-actor.ts` (verbatim, typed `CadastroActor`), because `import/routes.ts` needs the SAME helper and importing it from `sales-ops/routes.ts` would create an import cycle. This adds one small file outside the slice table's list; no shared name changes.
2. `plan/index.ts` also exports `compareIssues`, `sortIssues`, `mergeCounts`, `isPlanOk` and `toPreviewBody` (truncation at `MAX_RETURNED_ISSUES` lives in `toPreviewBody`, so routes and tests share one implementation). Additive only.
3. Implements Amendment D11 through one private helper `seededCatalog(tx, orgId, now)` (`ensureLeadStages` then `readImportCatalog`). GET `/template` ALSO uses it, inside the same always-rolled-back transaction as preview, so the template's Etapas dropdown lists the default etapas of a fresh org exactly as the preview will resolve them, while still writing nothing. D11 names only preview and commit; extending it to the template is additive and keeps the three routes on one catalog path.
4. The 409 body's `message` is built by `describeExecutionFailure` from the operation's planKey/saleKey; it never echoes `ImportExecutionError.reason` except the `producer_flow_live` wording. No wire change.
5. Assumed upstream signatures (from the SEAM): `readImportCatalog(tx: Db, orgId: string, now: Date): Promise<ImportCatalog>`, `buildTemplateWorkbook(catalog, { example: boolean }): Promise<Buffer> | Buffer`, `executeImportPlan(tx, orgId, plan, actor, now): Promise<{ counts }>`. If slice 02/06/08 merged a different shape, adapt the call sites here, not the upstream files, and note it in the exec notes.
