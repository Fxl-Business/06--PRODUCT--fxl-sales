---
id: 02-catalog-refs-cadastros
milestone: v4.2.0
status: done
depends_on: [01-contract-and-parser]
files_modified:
  - apps/api/src/domains/sales-ops/service.ts
  - apps/api/src/domains/import/catalog.ts
  - apps/api/src/domains/import/refs.ts
  - apps/api/src/domains/import/plan/plan-helpers.ts
  - apps/api/src/domains/import/plan/cadastros.ts
  - apps/api/src/domains/import/__tests__/plan-fixtures.ts
  - apps/api/src/domains/import/__tests__/plan-helpers.test.ts
  - apps/api/src/domains/import/__tests__/refs.test.ts
  - apps/api/src/domains/import/__tests__/cadastros.test.ts
  - apps/api/src/domains/import/__tests__/catalog.integration.test.ts
acceptance: "readImportCatalog returns the org-scoped ImportCatalog (numbers not numeric strings, product função costs, people with função ids and slugs, stages, settings with the 10/3/6 fallback, today in São Paulo, producerFlowLive from the gate) and writes nothing; buildRefIndex resolves names (normalizeLabel) and produto `#<código>` to existing ids or workbook planKeys with unknown_ref / archived_ref / ambiguous_ref failures and answers whether a person holds a função; planCadastros turns the Áreas, Funções, Produtos, Custos por produto, Pessoas, Clientes and Etapas sheets into create operations in sheet and row order, with unique product code suffixes, and every rule the domain schemas or unique indexes would refuse reported as a row-level pt-BR issue with the header text; the example workbook's cadastro sheets plan with zero errors against a seeded catalog."
goal: "Give the planners their three foundations: the org snapshot (catalog.ts), the one name resolver (refs.ts) and the cadastro planner (plan/cadastros.ts), plus the shared issue helpers (plan/plan-helpers.ts) that slices 03-05 reuse, and the `ensureSystemFuncoes` seed the import routes need for a fresh org."
must_not_break:
  - "pnpm --filter @fxl-sales/api test (whole unit suite)"
  - "pnpm --filter @fxl-sales/api test:integration (whole integration suite)"
  - "pnpm --filter @fxl-sales/api lint"
  - "pnpm --filter @fxl-sales/api type-check (tsconfig.json, tsconfig.scripts.json, tsconfig.test.json)"
  - "apps/api/src/domains/import/__tests__/parse.test.ts (slice 01 oracles)"
  - "test/rls/funcoes-rls.test.ts, test/rls/funcoes-concurrency.test.ts (the on-demand função seed path ensureSystemFuncoes reuses)"
rules:
  - "catalog.ts NEVER writes (Amendment D11). It only SELECTs, every query filtered by eq(<table>.orgId, orgId), inside the tx it is given; it never opens withTenant itself and never reads process.env or the clock (`now` is a parameter)."
  - "refs.ts, plan/plan-helpers.ts and plan/cadastros.ts are pure: no I/O, no clock, no env, no database import (type-only imports from db/schema are not needed and not allowed)."
  - "Name matching uses ONLY normalizeLabel from ../cells.js (Amendment 6). No second normalizer."
  - "Planners read cells only through cellReader(sheet, row) from ../parse.js (Amendment 8)."
  - "A null in a REQUIRED column means the parser already reported it: skip the row silently, never report it again."
  - "An operation is emitted only for a row that has NO error issue (parser or planner). Warnings never block. counts[sheet] = operations emitted for that sheet; a key is present only when its count is > 0."
  - "Every planner input is validated by the REAL domain schema (AreaSchema, FuncaoSchema, ProductSchema, ProductFuncaoCostSchema, PersonSchema, ClientSchema, LeadStageSchema) with safeParse; the op input is the PARSED output. Zod issues are mapped by zodIssuesToImportIssues to the header text."
  - "Issue messages are pt-BR, quote the value as typed, never contain a uuid, a planKey or a column key; `column` is the header text from getColumnDef(sheet, key).header."
  - "D5: an área, função, produto or etapa whose normalized name exists ACTIVE in the org is `duplicate_existing` (error). D6: a reference to an archived (pessoa: inactive) record is `archived_ref` (error)."
  - "Unique-index safety: áreas, funções and etapas are unique by name in the database INCLUDING archived rows, so a same-name ARCHIVED row is the error `duplicate_archived`; funções are also unique by slug (any status), so a slug clash is `duplicate_slug`; product code suffixes are unique including archived rows."
  - "Money stays integer cents, except product commission values with type 'fix', which ProductSchema stores in REAIS (cents / 100)."
  - "No em dash anywhere; relative imports use the `.js` extension; no `any`; no rest-destructuring to drop keys (lint has no ignoreRestSiblings), use `withoutKeys`."
  - "Do not touch apps/web/** and nexo/plans/prospeccao-redesign/** (live peer run)."
verifier_focus: "That readImportCatalog performs zero writes (fresh-org test counts rows) and filters every table by org (org B rows absent); that numeric strings become numbers; that refs prefers an existing row over a colliding workbook row, makes non-unique names (pessoa, cliente) ambiguous, and resolves `#<código>`; that every unique index the services hit (área/função/etapa name incl. archived, função slug, product code suffix incl. archived) is caught in the plan; that product suffix assignment matches nextProductCodeSuffix semantics; that the example-workbook test really parses `exampleTabs()` rather than a hand-built copy; and that the one service.ts change is the additive `ensureSystemFuncoes` export delegating to the existing private seed."
---

# Slice 02 - Catalog, refs and cadastro planner

## Objective

After this slice the import has:

- `readImportCatalog(tx, orgId, now)`: the read-only org snapshot every planner and the template use.
- `buildRefIndex(parsed, catalog)`: the one resolver from a typed name to an existing id or a workbook row.
- `planCadastros(parsed, catalog, refs)`: create operations and pt-BR issues for the seven cadastro sheets.
- `plan/plan-helpers.ts`: issue builders and the zod-to-issue mapper, reused by slices 03, 04 and 05.
- `ensureSystemFuncoes(tx, orgId)` exported from `sales-ops/service.ts`, so the routes (slice 07) can seed Vendedor/Finder in a fresh org next to `ensureLeadStages` (see Seam deviations, D11b).

Nothing is mounted and nothing is executed.

## Code facts (verified while planning)

- `Db` is `export type Db = ReturnType<typeof getDb>` in `apps/api/src/domains/sales-ops/service.ts`; `withTenant(db, orgId, fn)` opens a transaction and sets the tenant context; a nested `withTenant` is a savepoint.
- Funções: `FuncaoSchema = { name: trim().min(1).max(120), status: active|archived default active }`. `createFuncao` returns `'reserved_slug'` when `slugifyFuncao(name)` is `vendedor`/`finder`, `'duplicate'` for an existing row with the SAME exact name (any status), `'duplicate_slug'` for the same slug (any status). DB: unique `(org_id, slug)` and `(org_id, name)`. `SYSTEM_FUNCAO_SLUGS = ['vendedor', 'finder']` and `slugifyFuncao` are exported.
- `slugifyFuncao('!!!') === ''` (no alphanumerics); a second such row would clash on the slug index.
- Migration 0012 seeded Vendedor/Finder only for orgs that existed then. A newer org has NO system função until `resolvePersonFuncoes(tx, orgId, { kind: 'slugs', ... })` (private, used by `createPerson` only for the deprecated booleans) seeds them. The web always sends `funcaoIds`, so a fresh org today cannot even pick Vendedor. Hence `ensureSystemFuncoes` below.
- Áreas: `AreaSchema = { name: trim().min(1).max(120), status }`; `createArea` returns `'duplicate'` for the same exact name (any status); DB unique `(org_id, name)`.
- Etapas: `LeadStageSchema = { name: trim().min(1).max(120), status }` in `leads/schemas.ts`; `createLeadStage` returns `'duplicate'` for the same exact name (any status), always writes `kind: 'normal'`, `isSystem: false`, `position = max(position over ALL stages) + 1`. DB unique `(org_id, name)`.
- `ensureLeadStages(tx, orgId)` (`leads/stages-seed.ts`) seeds `Novo`, `Em negociação`, `Proposta` (conversion), `Perdido` (lost) only when the org has zero stages. Amendment D11: the routes call it before `readImportCatalog`; the catalog never seeds.
- Produtos: `ProductSchema = ProductFieldsSchema.superRefine(validateProductFields)` with `name trim 1..140`, `codeSuffix /^\d{1,2}$/ default '0'`, `areaId uuid` (required), money fields `int >= 0`, commission values `nonnegative` (percent for `pct`, REAIS for `fix`), `sellerCommissionValue default 10`, `finderCommissionValue default 3`, `sellerWithFinder*` optional (service falls back to the seller pair), entrada mode/value pairing (`entrada_mode_value_mismatch`), `defaultRemainingInstallments int 1..120 default 1`, `defaultRecurringCycles int 1..120 nullable optional`, `productFuncaoCosts` optional (duplicate funcaoId -> `duplicate_funcao_cost`), `modules default []`, `providers default []`. Product names have NO unique index; code suffix has `sales_ops_products_org_code_suffix_idx (org_id, code_suffix)` over every status, compared as TEXT (`'3'` and `'03'` do not collide in the DB, but both mean `#3`).
- The web suggests a new suffix with `nextProductCodeSuffix` (`apps/web/src/sales-ops/calculations.ts`): numeric set of existing `^\d{1,2}$` suffixes; empty -> `0`; else `max + 1` when `<= 99`; else the lowest free `0..99`; else `'0'`.
- The web caps product default installments at 119 when there is an entrada (`maxRemainingInstallments`), because a proposta has at most 120 installments.
- `ProductFuncaoCostSchema` = discriminated union on `mode`: `{ funcaoId uuid, mode 'pct', valuePct 0..100 }` or `{ funcaoId uuid, mode 'fix', valueBrl int >= 0 }`.
- `PersonSchema`: `displayName 1..120`, `contactEmail email | ''` optional, `status active|inactive default active`, `funcaoIds uuid[]` optional, `hubAccountId` optional, deprecated booleans optional. An empty `funcaoIds` is refused by the service (`funcao_required`).
- `ClientSchema`: `name 1..160`, `contact 200`, `legalName 200`, `document 32`, `address 400`, `legalRepName 200`, `legalRepDocument 32`, all `nullish`. Clients have no status and no unique index.
- DB numeric columns come back from drizzle as strings: products `seller_commission_value`, `seller_with_finder_commission_value`, `finder_commission_value`, `default_entrada_pct`; product costs `value_pct`; settings `default_seller_commission_pct`, `default_finder_commission_pct`, `default_tax_pct`.
- `isProducerFlowLive(orgId)` from `apps/api/src/domains/integration/producer-gate.ts` (default closed; tests set it with `registerProducerFlowGate` and reset with `() => false`).
- `todayInSaoPaulo(now)` from `@fxl-sales/shared-utils/sao-paulo-day` (subpath only).
- Zod is `^3.24` (issue codes `too_big`, `too_small`, `invalid_string` with `validation`, `invalid_type`, `invalid_enum_value`, `custom`).
- Lint: `@typescript-eslint/no-unused-vars` with `argsIgnorePattern: '^_'` only, so `const { a: _a, ...rest } = x` FAILS lint; use `withoutKeys`.
- Unit tests: `src/**/__tests__/**/*.test.ts` minus `*.integration.test.ts`. Integration: `VITEST_INTEGRATION=1`, includes `src/**/*.integration.test.ts`, setup `test/rls/setup-env.ts` points `getDb()` at the local test DB (non-superuser role, RLS live) and `getAdminDb()` at the admin connection. Pattern: `src/domains/sales-ops/__tests__/producer-emission.integration.test.ts` (seed with `getAdminDb()`, exercise through `getDb()`, `closeDb()` in `afterAll`).

## File 1 - `apps/api/src/domains/sales-ops/service.ts` (one additive export)

Insert directly after `resolvePersonFuncoes`:

```ts
/**
 * Seeds the two predefined app roles (Vendedor, Finder) for an org that does not
 * have them yet, through the SAME race-safe on-demand seed createPerson uses for
 * the deprecated booleans. Idempotent. MUST run inside a tenant transaction.
 * The import routes call it before readImportCatalog (Amendment D11b), because an
 * org provisioned after migration 0012 has no system função at all.
 */
export async function ensureSystemFuncoes(tx: Db, orgId: string): Promise<void> {
  const seeded = await resolvePersonFuncoes(tx, orgId, {
    kind: 'slugs',
    slugs: [...SYSTEM_FUNCAO_SLUGS],
  });
  if (seeded === 'unknown_funcao') throw new Error('system_funcao_seed_failed');
}
```

`SYSTEM_FUNCAO_SLUGS` elements are assignable to `LegacyFuncaoSlug`; if `tsc` widens the spread to `string[]`, write `slugs: ['vendedor', 'finder']`.
Nothing else in service.ts changes.

## File 2 - `apps/api/src/domains/import/catalog.ts`

Imports: `and, asc, eq` from `drizzle-orm`; `salesOpsAreas, salesOpsClients, salesOpsFuncoes, salesOpsLeadStages, salesOpsPeople, salesOpsPersonFuncoes, salesOpsProductFuncaoCosts, salesOpsProducts, salesOpsSettings` from `../../db/schema.js`; `type Db, ProductEntradaModeSchema, ProductKindSchema, SaleInstallmentSchema` from `../sales-ops/service.js`; `isProducerFlowLive` from `../integration/producer-gate.js`; `todayInSaoPaulo` from `@fxl-sales/shared-utils/sao-paulo-day`; types from `./types.js`.

```ts
export const DEFAULT_IMPORT_SETTINGS: ImportCatalogSettings = { defaultSellerCommissionPct: 10, defaultFinderCommissionPct: 3, defaultTaxPct: 6 };
export async function readImportCatalog(tx: Db, orgId: string, now: Date): Promise<ImportCatalog>;
/** Exported for unit tests: one drizzle numeric string (or null) to a number. */
export function numericToNumber(value: string | null): number | null; // null -> null; Number(value); NaN -> throws Error('invalid numeric value')
```

Algorithm (sequential awaits on the same `tx`; every WHERE starts with `eq(table.orgId, orgId)`):

1. `areas`: `select id, name, status from salesOpsAreas where org order by name` -> as is.
2. `funcoes`: `id, name, slug, isSystem, status`, order `desc(isSystem)` is NOT needed; order by `name`.
3. `products`: `select * from salesOpsProducts where org order by name`; `costs`: `select productId, funcaoId, mode, valuePct, valueBrl from salesOpsProductFuncaoCosts where org order by productId, funcaoId`.
   Map each product to `ProductCatalogEntry`:
   - `kind`: `ProductKindSchema.safeParse(row.kind)`, fallback `'product'`.
   - commission types: `row.x === 'fix' ? 'fix' : 'pct'` for seller, sellerWithFinder, finder.
   - commission values and `defaultEntradaPct`: `numericToNumber` (`sellerCommissionValue` etc. are NOT NULL, so `?? 0` only to satisfy the type).
   - `defaultPaymentMethod`: `SaleInstallmentSchema.shape.method.safeParse(row.defaultPaymentMethod)`, fallback `'pix'`.
   - `defaultEntradaMode`: `ProductEntradaModeSchema.safeParse(...)`, fallback `'none'`.
   - `defaultEntradaBrl`, `defaultRecurringCycles`: as stored (number | null).
   - `productFuncaoCosts`: the cost rows of this product, `mode === 'fix'` -> `{ funcaoId, mode: 'fix', valueBrl: row.valueBrl ?? 0 }`, else `{ funcaoId, mode: 'pct', valuePct: numericToNumber(row.valuePct) ?? 0 }`.
   - archived products are included (code suffixes stay unique across both).
4. `people`: `select id, displayName, contactEmail, status from salesOpsPeople where org order by displayName`; assignments: `select personId, funcaoId, slug from salesOpsPersonFuncoes innerJoin salesOpsFuncoes on and(eq(salesOpsFuncoes.orgId, orgId), eq(salesOpsFuncoes.id, salesOpsPersonFuncoes.funcaoId)) where eq(salesOpsPersonFuncoes.orgId, orgId)`; attach `funcaoIds` and `funcaoSlugs` in query order (empty arrays when none).
5. `clients`: `id, name, document` order by name.
6. `stages`: `id, name, kind, status, position` order by `position`, then `name`; `kind` narrowed: `'conversion' | 'lost'` kept, anything else `'normal'`.
7. `settings`: first row of `salesOpsSettings where org`; present -> the three numerics through `numericToNumber` (fallback to the default when null); absent -> `DEFAULT_IMPORT_SETTINGS` (a fresh copy).
8. Return `{ today: todayInSaoPaulo(now), producerFlowLive: isProducerFlowLive(orgId), settings, areas, funcoes, products, people, clients, stages }`.

Top-of-file comment: "Read-only. The routes seed default etapas (`ensureLeadStages`) and system funções (`ensureSystemFuncoes`) in the same transaction BEFORE calling this (Amendment D11/D11b)."

## File 3 - `apps/api/src/domains/import/plan/plan-helpers.ts`

Imports: `type ZodError` from `zod`; types from `../types.js`; `getColumnDef` from `../workbook-schema.js`.

```ts
/** A syntactically valid uuid used only to run the domain schemas before the real id exists. Never reaches an operation. */
export const PLACEHOLDER_UUID = '00000000-0000-4000-8000-000000000000';

export function planKeyOf(sheet: SheetKey, row: number): string;            // `${sheet}:${row}`
export function header(sheet: SheetKey, key: string): string;               // getColumnDef(sheet, key).header
export function rowError(sheet: SheetKey, row: number, column: string | null, code: string, message: string): ImportIssue;
export function rowWarning(sheet: SheetKey, row: number, column: string | null, code: string, message: string): ImportIssue;
/** `${sheet}:${row}` for every ERROR issue with a row (parser and planner issues alike). */
export function erroredRowKeys(issues: readonly ImportIssue[]): Set<string>;
export function lookupIssue(sheet: SheetKey, row: number, column: string, failure: { code: string; message: string }): ImportIssue; // severity error
export function withoutKeys<T extends object, K extends keyof T>(value: T, keys: readonly K[]): Omit<T, K>; // shallow copy, delete keys, one `as Omit<T, K>`
export function countOperations(operations: readonly ImportOperation[], sheetOf: (op: ImportOperation) => SheetKey | null): ImportCounts; // keys only when > 0
/** Renders a list for messages: "A", "A e B", "A, B e C". */
export function joinPt(items: readonly string[]): string;

export type ZodIssueContext = {
  sheet: SheetKey;
  row: number;
  /** schema field (first path segment) -> header text */
  columns: Readonly<Record<string, string>>;
  /** header used when the path is empty or unmapped */
  fallbackColumn: string | null;
  /** the candidate object that was parsed, to quote values */
  values: Readonly<Record<string, unknown>>;
};
export function zodIssuesToImportIssues(error: ZodError, ctx: ZodIssueContext): ImportIssue[];
```

`zodIssuesToImportIssues`: one `ImportIssue` (severity error, code `invalid_value`) per zod issue, deduped by `column + message`. `field = String(issue.path[0] ?? '')`, `column = ctx.columns[field] ?? ctx.fallbackColumn`, `value = ctx.values[field]` shown with `String(value)`.
Messages (`<h>` = column header text, or `o campo` when column is null):

| zod issue | message |
| --- | --- |
| `too_big`, type `string` | `O texto passa do limite de <maximum> caracteres.` |
| `too_big`, other | `O valor passa do máximo permitido (<maximum>).` |
| `too_small`, type `string` | `Preencha a coluna "<h>".` |
| `too_small`, other | `O valor fica abaixo do mínimo permitido (<minimum>).` |
| `invalid_string`, validation `email` | `"<value>" não é um e-mail válido.` |
| `invalid_string`, other | `"<value>" não está no formato esperado.` |
| `custom`, message `entrada_mode_value_mismatch` | `Preencha a entrada padrão em percentual ou em valor, não nas duas colunas.` |
| `custom`, message `duplicate_funcao_cost` | `A mesma função aparece duas vezes nos custos deste produto.` |
| `custom`, message `invalid_iso_day` | `"<value>" não é uma data válida.` |
| anything else | `O valor da coluna "<h>" não é aceito.` |

This mapper is the safety net: the parser already enforces lengths and kinds, so most of these are unreachable from a template file, but every schema refusal still becomes a row issue instead of a 500 at commit.

## File 4 - `apps/api/src/domains/import/refs.ts`

Imports: `normalizeLabel` from `./cells.js`; `cellReader` from `./parse.js`; `slugifyFuncao, SYSTEM_FUNCAO_SLUGS` from `../sales-ops/service.js` (value import of two pure exports is fine; `service.ts` has no import-time side effects beyond module evaluation, and `workbook-schema.test.ts` of slice 01 already imports it); `planKeyOf` from `./plan/plan-helpers.js`; types from `./types.js`.

### Exports (exact)

```ts
export type SystemFuncaoSlug = (typeof SYSTEM_FUNCAO_SLUGS)[number]; // 'vendedor' | 'finder'
export type PersonRoleLookup =
  | RefLookup
  | { ok: false; code: 'missing_funcao'; message: string };

export interface ImportRefIndex extends RefIndex {
  /** resolve('person', name) and require the system função; the planners' vendedor/finder check. */
  resolvePersonWithFuncao(name: string, slug: SystemFuncaoSlug): PersonRoleLookup;
  /** True when the person (existing or workbook) will hold the função with this slug after commit. */
  personHasFuncaoSlug(person: EntityRef, slug: string): boolean;
  /** True when the person will hold exactly this função (compared with sameRef). */
  personHasFuncao(person: EntityRef, funcao: EntityRef): boolean;
  /** True only for an EXISTING função flagged isSystem (workbook funções are never system). */
  funcaoIsSystem(funcao: EntityRef): boolean;
}

export function sameRef(a: EntityRef, b: EntityRef): boolean;
export function refKey(ref: EntityRef): string; // 'id:<existingId>' | 'plan:<planKey>'

export type ProductCodeAssignment =
  | { ok: true; code: number; explicit: boolean }
  | { ok: false; code: 'duplicate_code' | 'no_free_code'; message: string };
/** Code suffix per Produtos Excel row with a non-null Nome, deterministic. Used by buildRefIndex and planCadastros. */
export function assignProductCodes(parsed: ParsedWorkbook, catalog: ImportCatalog): Map<number, ProductCodeAssignment>;

export function buildRefIndex(parsed: ParsedWorkbook, catalog: ImportCatalog): ImportRefIndex;
```

### Kind table (used for registration and messages)

| kind | sheet | name column | existing source | active when | article / noun | tab |
| --- | --- | --- | --- | --- | --- | --- |
| area | areas | nome | catalog.areas (name) | status `active` | `a área` | Áreas |
| funcao | funcoes | nome | catalog.funcoes (name) | status `active` | `a função` | Funções |
| product | produtos | nome | catalog.products (name) | status `active` | `o produto` | Produtos |
| person | pessoas | nome | catalog.people (displayName) | status `active` | `a pessoa` | Pessoas |
| client | clientes | nome | catalog.clients (name) | always | `o cliente` | Clientes |
| stage | etapas | nome | catalog.stages (name) | status `active` | `a etapa` | Etapas |

### Registration (inside `buildRefIndex`)

For every row of the kind's sheet whose name cell (via `cellReader`) is non-null, `key = normalizeLabel(name)`:

- area, funcao, stage (unique by name in the DB): SKIP when any catalog row of that kind (any status) has the same key, or when the key is already registered by an earlier row (first row wins). Otherwise register `{ planKey: planKeyOf(sheet, row), label: name }`.
- product: SKIP when an ACTIVE catalog product has the same key, or when already registered by an earlier row. An ARCHIVED same-name product does not block (no unique name index; the workbook row wins).
- person, client (no unique name): register EVERY row (no skip, so duplicates become ambiguous).

Rows with errors are still registered (cross-references stay quiet; the plan is not committable anyway).

Workbook product codes: `assignProductCodes` results with `ok: true` map `code -> planKey` (first row wins).

Workbook person funções (after funções are registered): for each registered pessoas row, read `funcoes` (list); resolve each name with `resolve('funcao', n)`; keep the ok refs (deduped by `refKey`); their slugs: existing -> the catalog função's `slug`; workbook -> `slugifyFuncao(registered label)`.
Existing person funções: `catalog.people[i].funcaoIds` as `{ existingId }` and `funcaoSlugs`.

### `resolve(kind, name)`

1. `key = normalizeLabel(name)`; empty key -> `unknown_ref` (message below with `""`).
2. Product code path: when kind is `product` and `name.trim()` matches `/^#\s*(\d{1,2})$/`: `n = Number(m[1])`; existing candidates = catalog products whose `codeSuffix` matches `/^\d{1,2}$/` and `Number(codeSuffix) === n`; workbook candidate = the code map entry for `n`. Then apply step 4 with the code messages.
3. Name path: existing candidates = catalog rows of the kind with `normalizeLabel(name) === key`; workbook candidates = registered rows with that key.
4. `pool = activeExisting ∪ workbook`. `pool.length === 1` -> `{ ok: true, ref, label }` (`ref` = `{ existingId: id }` or `{ planKey }`; label = the existing row's name or the typed workbook name). `pool.length > 1` -> `ambiguous_ref`. `pool.length === 0` and an inactive existing candidate -> `archived_ref`. Else `unknown_ref`.
   (For area/funcao/stage the pool can never hold an existing AND a workbook row, because registration skipped the colliding workbook row; for product the same holds for active rows.)

Messages (`<x>` = the name as typed, trimmed; `<Noun>` capitalized article+noun from the kind table, e.g. `A área`, `O produto`):

| code | message |
| --- | --- |
| unknown_ref | `Não encontramos <article noun> "<x>" no cadastro nem na aba <tab>.` e.g. `Não encontramos a área "Tecnologia" no cadastro nem na aba Áreas.` |
| archived_ref (area, funcao, product) | `<Noun> "<x>" está arquivad<a/o>; restaure em Cadastros > Geral (Histórico de arquivamentos) ou use outr<a/o>.` |
| archived_ref (person) | `A pessoa "<x>" está inativa; reative em Cadastros > Geral (Histórico de arquivamentos) ou use outra.` |
| archived_ref (stage) | `A etapa "<x>" está arquivada; restaure em Cadastros > Etapas ou use outra.` |
| ambiguous_ref (person, client) | `Há mais de <uma pessoa / um cliente> com o nome "<x>" (no cadastro ou nesta planilha); deixe os nomes diferentes para indicar qual usar.` |
| ambiguous_ref (product, name path) | `Há mais de um produto com o nome "<x>"; use o código, por exemplo #3.` |
| ambiguous_ref (other kinds; defensive, existing data duplicates) | `Há mais de <uma/um> <noun> com o nome "<x>".` |
| unknown_ref (code path) | `Não encontramos o produto com código #<n>.` |
| archived_ref (code path) | `O produto com código #<n> está arquivado; restaure em Cadastros > Geral (Histórico de arquivamentos) ou use outro.` |
| ambiguous_ref (code path) | `Há mais de um produto com o código #<n>.` |

Write the messages as one `const MESSAGES` table keyed by kind so the executor never invents grammar inline; gender: área, função, pessoa, etapa feminine; produto, cliente masculine.

### `resolvePersonWithFuncao(name, slug)`

`r = resolve('person', name)`; failure -> return it. Else `personHasFuncaoSlug(r.ref, slug)` -> return `r`. Else `{ ok: false, code: 'missing_funcao', message }` where `<F>` = `Vendedor` for `vendedor`, `Finder` for `finder`:
- existing person: `A pessoa "<label>" não tem a função <F>; atribua a função em Cadastros > Pessoas antes de importar.`
- workbook person: `A pessoa "<label>" não tem a função <F> na aba Pessoas; inclua <F> na coluna Funções.`

### `funcaoIsSystem(ref)`

`'existingId' in ref` and the catalog função with that id has `isSystem === true`.

### `assignProductCodes(parsed, catalog)`

1. `used = new Set<number>()` of every catalog product suffix matching `/^\d{1,2}$/` (ALL statuses), and `owner: Map<number, string>` (product name, plus ` (arquivado)` when archived) for messages.
2. Pass 1, explicit, in row order, rows with non-null `nome` and non-null `codigo` (`int 0..99` from the parser): if `used.has(c)` -> `{ ok: false, code: 'duplicate_code', message: 'O código <c> já é usado pelo produto "<owner>"; deixe a coluna em branco para usar o próximo código livre.' }`; else `{ ok: true, code: c, explicit: true }`, add to `used`, `owner.set(c, nome)`.
3. Pass 2, blank `codigo`, in row order: `next = used.size === 0 ? 0 : max(used) + 1`; if `next > 99`, `next` = lowest free in `0..99`; none free -> `{ ok: false, code: 'no_free_code', message: 'Não há código livre de 0 a 99 para o produto "<nome>"; arquive ou renumere um produto antes.' }`. Else `{ ok: true, code: next, explicit: false }`, add to `used`.
   This is `nextProductCodeSuffix` applied repeatedly, so a blank row gets exactly what the product dialog would have suggested at that point.

## File 5 - `apps/api/src/domains/import/plan/cadastros.ts`

Imports: `AreaSchema, FuncaoSchema, ProductSchema, ProductFuncaoCostSchema, PersonSchema, ClientSchema, slugifyFuncao, SYSTEM_FUNCAO_SLUGS` from `../../sales-ops/service.js`; `LeadStageSchema` from `../../sales-ops/leads/schemas.js`; `normalizeLabel` from `../cells.js`; `cellReader` from `../parse.js`; `assignProductCodes, refKey, type ImportRefIndex` from `../refs.js`; helpers from `./plan-helpers.js`; types from `../types.js`.

```ts
export function planCadastros(parsed: ParsedWorkbook, catalog: ImportCatalog, refs: ImportRefIndex): SheetPlanResult;
```

Structure: one private function per sheet (`planAreas`, `planFuncoes`, `planProdutos` (folds Custos por produto), `planPessoas`, `planClientes`, `planEtapas`), each returning `{ operations, issues }`; `planCadastros` concatenates them in that order (= sheet order), then computes `counts` (`createProduct` counts `produtos`, and `custosProduto` counts the cost rows attached to emitted products).

Shared per-row protocol, applied in every sheet:

1. Read cells with `cellReader(sheet, row)`. A required cell that is null -> skip the row (no issue).
2. Collect this row's planner issues in order of the checks below.
3. Emit the operation only when `erroredRowKeys(parsed.issues)` does not hold `sheet:row` AND the row has no planner error. `planKey = planKeyOf(sheet, row.row)`.

Header texts come from `header(sheet, key)`; below they are written literally for readability.

### Áreas (`areas`)

1. `nome`. `key = normalizeLabel(nome)`.
2. Existing area with that key: active -> error `duplicate_existing` (column `Nome`): `A área "<nome>" já existe no cadastro; remova esta linha (as outras abas já usam a área existente).`; archived -> error `duplicate_archived`: `A área "<nome>" já existe arquivada; restaure em Cadastros > Geral (Histórico de arquivamentos) e remova esta linha.`
3. Earlier row in this sheet with the same key -> error `duplicate_in_sheet`: `A área "<nome>" já aparece na linha <n> desta aba.`
4. `AreaSchema.safeParse({ name: nome, status: 'active' })`; failure -> `zodIssuesToImportIssues` with `columns { name: 'Nome' }`.
5. Op `{ op: 'createArea', planKey, input: parsed.data }`.

### Funções (`funcoes`)

1. `nome`; `key`; `slug = slugifyFuncao(nome)`.
2. `slug` in `SYSTEM_FUNCAO_SLUGS` -> error `reserved_funcao`: `Vendedor e Finder já existem em toda organização; remova a linha "<nome>".` (stop further checks for this row).
3. `slug === ''` -> error `invalid_funcao_name`: `O nome "<nome>" precisa ter ao menos uma letra ou um número.` (stop).
4. Existing função same key: active -> `duplicate_existing` `A função "<nome>" já existe no cadastro; remova esta linha (as outras abas já usam a função existente).`; archived -> `duplicate_archived` `A função "<nome>" já existe arquivada; restaure em Cadastros > Geral (Histórico de arquivamentos) e remova esta linha.`
5. Else existing função with the same `slug` (any status) -> `duplicate_slug`: `A função "<nome>" é parecida demais com "<existing name>", que já existe; use outro nome ou a função existente.`
6. Earlier row same key -> `duplicate_in_sheet` `A função "<nome>" já aparece na linha <n> desta aba.`; else earlier row same slug -> `duplicate_slug` `A função "<nome>" é parecida demais com "<earlier nome>" da linha <n>; use nomes diferentes.`
7. `FuncaoSchema.safeParse({ name: nome, status: 'active' })` -> zod issues, `columns { name: 'Nome' }`.
8. Op `createFuncao`.

### Produtos (`produtos`) and Custos por produto (`custosProduto`)

`codes = assignProductCodes(parsed, catalog)` once.

Per Produtos row (`nome`, `area` required):

1. Name: active existing product same key -> error `duplicate_existing` (Nome): `O produto "<nome>" já existe no cadastro; remova esta linha (as outras abas já usam o produto existente).` Archived existing same key -> WARNING `possible_duplicate` (Nome): `Já existe um produto arquivado chamado "<nome>"; esta linha cria um produto novo.` Earlier row same key -> error `duplicate_in_sheet` `O produto "<nome>" já aparece na linha <n> desta aba.`
2. Code: `codes.get(row)`; `ok: false` -> error with its code and message, column `Código`.
3. Área: `refs.resolve('area', area)`; failure -> `lookupIssue(..., 'Área', failure)`; ok -> `areaRef`.
4. Pairs (pct / R$): for each pair below, both non-null -> error `both_pct_and_brl` on the (R$) column: `Preencha "<pct header>" ou "<brl header>", não as duas.`
   - seller: `comissaoVendedorPct` / `comissaoVendedorBrl` -> `sellerCommissionType` `'pct'` with value pct, or `'fix'` with value `brl / 100`; neither -> both keys omitted (schema defaults `pct` 10, the product dialog's default).
   - seller with finder: `comissaoVendedorComFinderPct` / `comissaoVendedorComFinderBrl` -> `sellerWithFinderCommissionType/Value`; neither -> omitted (service falls back to the seller pair).
   - finder: `comissaoFinderPct` / `comissaoFinderBrl` -> `finderCommissionType/Value`; neither -> omitted (default `pct` 3).
   - entrada: `entradaPct` / `entradaBrl` -> `defaultEntradaMode 'pct'` + `defaultEntradaPct`, or `'fix'` + `defaultEntradaBrl` (cents); neither -> `'none'`, both `null`.
5. Monthly: `temMensalidade === false && (mensalidade ?? 0) > 0` -> error `conflicting_values` (Mensalidade (R$)): `Tem mensalidade é Não, mas a Mensalidade (R$) está preenchida; corrija uma das duas colunas.` `hasMonthly = temMensalidade ?? ((mensalidade ?? 0) > 0)`; `monthlyBrl = mensalidade ?? 0`.
6. Installments: `defaultEntradaMode !== 'none' && (parcelas ?? 1) > 119` -> error `too_many_installments` (Parcelas padrão): `Com entrada padrão, as parcelas padrão vão até 119, porque a entrada ocupa uma das 120.`
7. Candidate: `{ name: nome, kind: tipo ?? 'product', codeSuffix: String(code), areaId: PLACEHOLDER_UUID, setupBrl: valor ?? 0, hasMonthly, monthlyBrl, recurringCommission: comissaoRecorrente ?? false, hasFinderCommission: comissionaFinder ?? false, <commission keys from step 4>, defaultPaymentMethod: formaPagamento ?? 'pix', defaultEntradaMode, defaultEntradaPct, defaultEntradaBrl, defaultRemainingInstallments: parcelas ?? 1, defaultRecurringCycles: ciclosRecorrencia ?? null, status: 'active' }` (no `providers`, no `modules`, no `productFuncaoCosts`, no `openPrice`). When the code is not ok use `'0'` in the candidate (the row already errors).
   `ProductSchema.safeParse(candidate)`; failure -> zod issues with `columns { name: 'Nome', kind: 'Tipo', codeSuffix: 'Código', setupBrl: 'Valor (R$)', monthlyBrl: 'Mensalidade (R$)', sellerCommissionValue: <the pct or R$ header used>, sellerWithFinderCommissionValue: <same rule>, finderCommissionValue: <same rule>, defaultPaymentMethod: 'Forma de pagamento padrão', defaultEntradaMode: 'Entrada padrão (%)', defaultEntradaPct: 'Entrada padrão (%)', defaultEntradaBrl: 'Entrada padrão (R$)', defaultRemainingInstallments: 'Parcelas padrão', defaultRecurringCycles: 'Ciclos de recorrência' }`, fallback `null`.
8. Op (when allowed): `{ op: 'createProduct', planKey, input: withoutKeys(parsed.data, ['areaId', 'productFuncaoCosts']), areaRef, funcaoCosts: [] }`. Keep a `Map<planKey, op>` for step 9.

Per Custos por produto row (`produto`, `funcao` required):

1. `p = refs.resolve('product', produto)`: failure -> lookupIssue (Produto). Ok with `existingId` -> error `existing_product_cost` (Produto): `O produto "<label>" já existe no cadastro; custos padrão só podem ser importados para produtos criados nesta planilha (edite o produto existente em Cadastros > Produtos & Serviços).`
2. `f = refs.resolve('funcao', funcao)`: failure -> lookupIssue (Função). Ok and `refs.funcaoIsSystem(f.ref)` -> error `system_funcao_cost` (Função): `Vendedor e Finder não têm custo padrão; eles recebem comissão.`
3. `custoPct` and `custoBrl` both -> `both_pct_and_brl` (Custo (R$)): `Preencha "Custo (%)" ou "Custo (R$)", não as duas.`; neither -> `cost_required` (Custo (%)): `Preencha "Custo (%)" ou "Custo (R$)".`
4. Earlier cost row with the same product planKey and the same `refKey(f.ref)` -> `duplicate_cost` (Função): `O produto "<p.label>" já tem um custo para a função "<f.label>" na linha <n>.`
5. `cost = pct ? { mode: 'pct', valuePct } : { mode: 'fix', valueBrl }`; `ProductFuncaoCostSchema.safeParse({ funcaoId: PLACEHOLDER_UUID, ...cost })` -> zod issues `columns { valuePct: 'Custo (%)', valueBrl: 'Custo (R$)' }`.
6. When the cost row is allowed AND the product op exists in the map: push `{ funcaoRef: f.ref, cost }` onto that op's `funcaoCosts` (in cost-row order) and count it under `custosProduto`.

### Pessoas (`pessoas`)

1. `nome` and `funcoes` (list) required; `email` optional. `funcoes` empty array (defensive only; the parser returns null) -> error `funcao_required` (Funções): `Informe ao menos uma função para a pessoa "<nome>".`
2. For each função name: `refs.resolve('funcao', n)`; each failure -> lookupIssue (Funções); collect ok refs deduped by `refKey`.
3. Warnings (never block), column Nome unless stated:
   - existing person same key: `possible_duplicate` `Já existe uma pessoa chamada "<nome>" no cadastro; se for a mesma, remova esta linha (um nome repetido não pode ser usado nas outras abas).`
   - existing person with the same e-mail (`email.trim().toLowerCase()` vs `contactEmail?.trim().toLowerCase()`), column E-mail: `possible_duplicate` `O e-mail "<email>" já é da pessoa "<existing name>" no cadastro.`
   - earlier row same key: `possible_duplicate` `A pessoa "<nome>" já aparece na linha <n> desta aba; um nome repetido não pode ser usado nas outras abas.`
4. `PersonSchema.safeParse({ displayName: nome, contactEmail: email ?? '', status: 'active', funcaoIds: [PLACEHOLDER_UUID] })` -> zod issues `columns { displayName: 'Nome', contactEmail: 'E-mail', funcaoIds: 'Funções' }`.
5. Op `{ op: 'createPerson', planKey, input: withoutKeys(parsed.data, ['funcaoIds']), funcaoRefs }`. The input never carries `hubAccountId` or the deprecated booleans (they are absent from the candidate).

### Clientes (`clientes`)

1. `nome` required; others optional text.
2. Warnings `possible_duplicate`:
   - existing client same key (Nome): `Já existe um cliente chamado "<nome>" no cadastro; se for o mesmo, remova esta linha (um nome repetido não pode ser usado nas outras abas).`
   - `digits(documento)` non-empty and equal to `digits(existing.document)` (`digits = s.replace(/\D/g, '')`), column CNPJ/CPF: `O documento "<documento>" já é do cliente "<existing name>" no cadastro.`
   - earlier row same key (Nome): `O cliente "<nome>" já aparece na linha <n> desta aba; um nome repetido não pode ser usado nas outras abas.`; earlier row same document digits (CNPJ/CPF): `O documento "<documento>" já aparece na linha <n> desta aba.`
3. `ClientSchema.safeParse({ name: nome, contact, legalName: razaoSocial, document: documento, address: endereco, legalRepName: representante, legalRepDocument: documentoRepresentante })` (blanks as `null`) -> zod issues with the obvious field -> header map.
4. Op `createClient` with `parsed.data`.

### Etapas (`etapas`)

1. `nome`; existing stage same key: active -> `duplicate_existing` `A etapa "<nome>" já existe no funil; remova esta linha (os leads já podem usar a etapa existente).`; archived -> `duplicate_archived` `A etapa "<nome>" já existe arquivada; restaure em Cadastros > Etapas e remova esta linha.`
2. Earlier row same key -> `duplicate_in_sheet` `A etapa "<nome>" já aparece na linha <n> desta aba.`
3. `LeadStageSchema.safeParse({ name: nome, status: 'active' })` -> zod issues `columns { name: 'Nome' }`.
4. Op `createLeadStage`. A new etapa is always an ordinary (`normal`) column appended after the existing ones; the sheet cannot create a conversion or lost etapa (the schema has no `kind`).

## File 6 - `apps/api/src/domains/import/__tests__/plan-fixtures.ts` (test helper, reused read-only by slices 03-07)

```ts
export const IDS: { readonly areaTec: string; areaArchived: string; funcaoVendedor: string; funcaoFinder: string; funcaoDev: string; funcaoArchived: string; productSistema: string; productArchived: string; personAna: string; personInactive: string; clientPadaria: string; stageNovo: string; stageNegociacao: string; stageProposta: string; stagePerdido: string; stageArchived: string };
/** A catalog shaped like a seeded org (D11/D11b): Vendedor/Finder system funções, the four default etapas, settings 10/3/6, today 2026-03-10, producerFlowLive false. Every list is empty unless `overrides` fills it. */
export function seededCatalog(overrides?: Partial<ImportCatalog>): ImportCatalog;
/** seededCatalog plus one record of each kind, active and archived (the IDS above), product `Sistema legado` with codeSuffix '3' active and `Produto antigo` '7' archived. */
export function richCatalog(): ImportCatalog;
export function productEntry(overrides: Partial<ProductCatalogEntry> & { id: string; name: string }): ProductCatalogEntry; // defaults mirror ProductSchema defaults
/** In-memory ParsedWorkbook: rows numbered from 2 in array order unless a `row` is given. */
export function workbook(sheets: Partial<Record<SheetKey, Array<Record<string, CellValue> & { row?: number }>>>, issues?: ImportIssue[]): ParsedWorkbook;
```

All ids are fixed literal uuids (`'00000000-0000-4000-8000-0000000000a1'` style), never random.

## Red tests (write first, watch them fail, then implement)

### `src/domains/import/__tests__/plan-helpers.test.ts`

- `builds planKeys as sheet colon row` - `planKeyOf('produtos', 7) === 'produtos:7'`.
- `collects only error rows into erroredRowKeys` - one error and one warning -> set has only the error's key; file-level issue (row null) ignored.
- `maps zod issues to header text with pt-BR messages` - `PersonSchema.safeParse({ displayName: 'Ana', contactEmail: 'x@', funcaoIds: [PLACEHOLDER_UUID] })` -> one issue `{ code: 'invalid_value', column: 'E-mail' }` whose message contains `"x@"`; `AreaSchema.safeParse({ name: 'a'.repeat(121) })` -> message `O texto passa do limite de 120 caracteres.`; ProductSchema entrada mismatch -> the entrada message; an unmapped field -> `fallbackColumn`.
- `withoutKeys drops keys without mutating the source`.
- `countOperations omits zero counts`.
- `joinPt joins with commas and e`.

### `src/domains/import/__tests__/refs.test.ts`

- `resolves an existing active área by name ignoring case and accents` - richCatalog area `Tecnologia`; `resolve('area', '  TECNOLOGIA ')` -> `{ ok: true, ref: { existingId: IDS.areaTec }, label: 'Tecnologia' }`.
- `resolves a workbook área to its planKey` - workbook Áreas row 2 `Marketing` -> `{ planKey: 'areas:2' }`.
- `prefers the existing row over a colliding workbook row` - workbook Áreas `tecnologia` with existing `Tecnologia` -> existingId.
- `first workbook row wins for unique-name kinds` - Áreas rows 2 and 3 both `Vendas` -> `areas:2`.
- `reports archived áreas, funções, produtos and etapas as archived_ref with a restore hint` - message contains `Histórico de arquivamentos` (etapa: `Cadastros > Etapas`).
- `reports an inactive pessoa as archived_ref saying inativa`.
- `reports unknown names with the tab to fix` - `resolve('client', 'Nada')` -> `unknown_ref`, message `Não encontramos o cliente "Nada" no cadastro nem na aba Clientes.`
- `makes repeated pessoa and cliente names ambiguous` - existing `Ana Souza` plus workbook Pessoas `ana souza` -> `ambiguous_ref`; two workbook clientes with the same name -> `ambiguous_ref`.
- `lets a workbook produto win over an archived produto with the same name`.
- `resolves produtos by code` - `#3` -> existing `Sistema legado`; `# 3` same; `#7` -> archived_ref; `#42` -> unknown_ref `Não encontramos o produto com código #42.`; a workbook product with Código 12 -> `#12` resolves to its planKey; a workbook product with blank Código in an org whose max suffix is 7 -> `#8` resolves to it.
- `answers vendedor membership for existing and workbook people` - existing Ana with funcaoSlugs `['vendedor']` -> `personHasFuncaoSlug(ref, 'vendedor')` true; workbook Pessoas `Bia` with Funções `['Vendedor', 'Desenvolvedor']` (Desenvolvedor a workbook função) -> true for `vendedor`, true for `desenvolvedor`, false for `finder`; `personHasFuncao(biaRef, { planKey: 'funcoes:2' })` true.
- `resolvePersonWithFuncao names the missing função and where to fix it` - existing person without vendedor -> `missing_funcao`, message contains `Cadastros > Pessoas`; workbook person without it -> message contains `coluna Funções`.
- `funcaoIsSystem is true only for existing system funções`.
- `assignProductCodes mirrors nextProductCodeSuffix` - existing suffixes `{'3', '07'}` archived included, workbook rows: explicit 5, blank, blank -> 5, 8, 9; explicit 3 -> `duplicate_code` naming the existing product; two explicit 5 -> second `duplicate_code`; existing max 99 with 0 free -> blank gets 0; every 0..99 used -> `no_free_code`; fresh org first blank -> 0.

### `src/domains/import/__tests__/cadastros.test.ts`

- `plans the example workbook's cadastro sheets with zero errors` (THE oracle) - `parseWorkbook(await buildXlsx(exampleTabs()))`, `seededCatalog()`, `buildRefIndex`, `planCadastros` -> no error issue; counts `{ areas: 1, funcoes: 1, produtos: 1, custosProduto: 1, pessoas: 1, clientes: 1, etapas: 1 }`; operations in order `createArea, createFuncao, createProduct, createPerson, createClient, createLeadStage`; the product op has `input.codeSuffix === '0'`, `input.setupBrl === 500000`, `input.sellerCommissionType === 'pct'`, `input.sellerCommissionValue === 10`, `areaRef: { planKey: 'areas:2' }`, one funcaoCost `{ funcaoRef: { planKey: 'funcoes:2' }, cost: { mode: 'pct', valuePct: 20 } }`; the person op has `funcaoRefs` `[{ existingId: <Vendedor id> }, { planKey: 'funcoes:2' }]`.
- Áreas: `refuses an área that already exists active (D5)`; `refuses an área that exists archived`; `refuses a repeated área in the sheet`.
- Funções: `refuses Vendedor and Finder as reserved` (`vendedor`, ` FINDER `); `refuses a name without letters or digits`; `refuses a slug clash with an existing função` (existing `Dev Ops`, row `dev-ops`); `refuses a slug clash inside the sheet`; `refuses an existing archived função`.
- Produtos: `fills defaults like the product dialog` (only Nome and Área -> kind product, codeSuffix next free, setupBrl 0, hasMonthly false, sellerCommission pct 10, finder pct 3, pix, entrada none, 1 installment, cycles null, providers [] , modules []); `converts a fixed commission from cents to reais` (Comissão do vendedor (R$) 15050 -> fix 150.5); `refuses pct and R$ in the same pair` (each of the four pairs, column is the R$ header); `infers Tem mensalidade from a filled Mensalidade`; `refuses Mensalidade with Tem mensalidade Não`; `caps default installments at 119 with an entrada`; `refuses an existing active product name` and `warns on an archived same-name product`; `refuses a used code including archived` ; `resolves the Área column through refs and reports archived_ref`; `never emits an operation for a row with a parser error` (pass a parser issue for `produtos:2` -> no op, no count).
- Custos por produto: `attaches costs to workbook products in row order`; `refuses costs for an existing product`; `refuses Vendedor and Finder costs`; `requires exactly one of Custo (%) and Custo (R$)`; `refuses the same função twice for one product`; `fixed cost stays in cents` (Custo (R$) 120000 -> `{ mode: 'fix', valueBrl: 120000 }`).
- Pessoas: `resolves Funções to existing and workbook funções`; `reports each unknown or archived função`; `warns on an existing same-name or same-e-mail pessoa without blocking`; `warns on a repeated name in the sheet`; `refuses an invalid e-mail through PersonSchema` (column E-mail); `the person input never carries funcaoIds, hubAccountId or legacy booleans`.
- Clientes: `creates a cliente with blanks as null`; `warns on a same-name or same-document cliente (digits only)`.
- Etapas: `refuses a default etapa name already in the funnel` (`novo`); `refuses an archived etapa name`; `creates a new etapa`.
- `issues carry sheet, Excel row, header text and never a uuid or planKey` - over all issues of a deliberately broken workbook: `column` is a header from WORKBOOK_SHEETS, message does not match `/[0-9a-f]{8}-[0-9a-f]{4}-/` nor `/\b[a-z]+:\d+\b/`.

### `src/domains/import/__tests__/catalog.integration.test.ts`

Pattern: `getDb`, `getAdminDb`, `closeDb` from `../../../db/client.js`; seed with `getAdminDb()` inserts (fixtures, including archived/inactive rows and a numeric-string settings row); exercise with `withTenant(getDb(), orgId, (tx) => readImportCatalog(tx, orgId, NOW))`; unique org ids `org_import_catalog_<label>_<Date.now()>_<random8>`; `afterAll` deletes per org in FK order (`sales_ops_product_funcao_costs`, `sales_ops_person_funcoes`, `sales_ops_people`, `sales_ops_products`, `sales_ops_funcoes`, `sales_ops_areas`, `sales_ops_clients`, `sales_ops_lead_stages`, `sales_ops_settings`), resets `registerProducerFlowGate(() => false)` and calls `closeDb()`.

- `returns the org snapshot with numbers, costs, people funções and settings` - org A: areas `Tecnologia` (active) and `Antiga` (archived); funções `Vendedor` (system, slug vendedor) and `Desenvolvedor`; product with `seller_commission_value '12.50'`, `default_entrada_pct '30.00'`, mode pct, cost rows pct `'20.00'` and fix `120000`; person Ana with Vendedor + Desenvolvedor; client with document; settings `12.00 / 4.00 / 5.50`; stages via `ensureLeadStagesForOrg`. Org B: area `Outra`, person `Beto`. Assert numbers (`12.5`, `30`, `{ mode: 'pct', valuePct: 20 }`, `{ mode: 'fix', valueBrl: 120000 }`), Ana's `funcaoSlugs` contains `vendedor` and `desenvolvedor`, settings `{ 12, 4, 5.5 }`, stages in position order with kinds, archived área present with `status: 'archived'`, and nothing from org B.
- `computes today in São Paulo from the given instant` - `NOW = new Date('2026-03-10T02:00:00.000Z')` -> `today === '2026-03-09'`.
- `falls back to 10/3/6 and writes nothing in a fresh org` - fresh org: settings `DEFAULT_IMPORT_SETTINGS`, `stages` `[]`, `funcoes` `[]`; afterwards admin counts of `sales_ops_lead_stages` and `sales_ops_funcoes` for that org are 0.
- `sees system funções and default etapas once the route seeds them (D11/D11b)` - inside ONE `withTenant`: `ensureLeadStages(tx, org)`, `ensureSystemFuncoes(tx, org)`, `ensureSystemFuncoes(tx, org)` (idempotent), then `readImportCatalog` -> funções exactly Vendedor and Finder with `isSystem: true`, stages `Novo, Em negociação, Proposta, Perdido`.
- `mirrors the producer gate` - `registerProducerFlowGate((id) => id === orgA)` -> `producerFlowLive` true for A, false for B.

## Commands (run once each, never watch mode)

```bash
pnpm --filter @fxl-sales/api exec vitest run src/domains/import/__tests__/plan-helpers.test.ts src/domains/import/__tests__/refs.test.ts src/domains/import/__tests__/cadastros.test.ts
make db-up   # only if the local Postgres container is not running
cd apps/api && VITEST_INTEGRATION=1 pnpm exec vitest run src/domains/import/__tests__/catalog.integration.test.ts
pnpm --filter @fxl-sales/api exec eslint src/domains/import src/domains/sales-ops/service.ts
pnpm --filter @fxl-sales/api type-check
pnpm --filter @fxl-sales/api test
pnpm --filter @fxl-sales/api test:integration
```

Named locked oracles: `src/domains/import/__tests__/cadastros.test.ts` (`plans the example workbook's cadastro sheets with zero errors`), `src/domains/import/__tests__/refs.test.ts`, `src/domains/import/__tests__/plan-helpers.test.ts`, `src/domains/import/__tests__/catalog.integration.test.ts` (`falls back to 10/3/6 and writes nothing in a fresh org`).
If `@fxl-sales/shared-utils/sao-paulo-day` does not resolve, run `pnpm run build:packages` once at the repo root.

## Handoff notes for slices 03-07

- Planners take `refs: ImportRefIndex` (from `refs.ts`), a superset of the contract's `RefIndex`.
- Vendedor check: `refs.resolvePersonWithFuncao(name, 'vendedor')`; finder: `'finder'`; turn a failure into an issue with `lookupIssue(sheet, row, header, failure)`.
- Professionals (slice 04): `refs.personHasFuncao(personRef, funcaoRef)` tells whether the executor will have to grant the função.
- Stage kind (slice 03): a workbook etapa is always `normal`; an existing one's kind is `catalog.stages.find(s => s.id === ref.existingId).kind`.
- Reuse `plan-helpers.ts` (`rowError`, `rowWarning`, `lookupIssue`, `erroredRowKeys`, `zodIssuesToImportIssues`, `PLACEHOLDER_UUID`, `withoutKeys`, `countOperations`) instead of local copies.
- Test catalogs come from `plan-fixtures.ts` (`seededCatalog`, `richCatalog`, `workbook`).

## Seam deviations (proposed amendments to SEAM-CONTRACT.md)

1. D11b (system funções, same shape as D11): an org created after migration 0012 has NO Vendedor/Finder função, so `Vendedor` in Pessoas, and every vendedor/finder reference, would be `unknown_ref` in a fresh org and AC2 would fail. Slice 02 adds `ensureSystemFuncoes(tx, orgId)` to `apps/api/src/domains/sales-ops/service.ts` (additive export over the existing private seed; no other slice owns that file in this feature). Slice 07's routes call it right after `ensureLeadStages(tx, orgId)` and before `readImportCatalog`, in both preview (rolled back) and commit. `readImportCatalog` still never writes; the executor still never seeds.
2. Planner signatures take `refs: ImportRefIndex` (exported by `refs.ts`, extends `RefIndex` with `resolvePersonWithFuncao`, `personHasFuncaoSlug`, `personHasFuncao`, `funcaoIsSystem`) instead of the bare `RefIndex`; `buildRefIndex(parsed, catalog): ImportRefIndex`. `types.ts` is unchanged.
3. New shared file `apps/api/src/domains/import/plan/plan-helpers.ts` (owned by slice 02) with the issue builders and the zod mapper; slices 03-05 import it.
4. New test helper `apps/api/src/domains/import/__tests__/plan-fixtures.ts` (owned by slice 02), reused read-only by slices 03-07.
5. Issue codes added by this slice: `duplicate_existing`, `duplicate_archived`, `duplicate_in_sheet`, `duplicate_slug`, `reserved_funcao`, `invalid_funcao_name`, `duplicate_code`, `no_free_code`, `both_pct_and_brl`, `conflicting_values`, `too_many_installments`, `existing_product_cost`, `system_funcao_cost`, `cost_required`, `duplicate_cost`, `funcao_required`, `possible_duplicate` (warning), `invalid_value` (zod), `missing_funcao` (refs), plus the contract's `unknown_ref`, `archived_ref`, `ambiguous_ref`.
6. D5 refinement: for áreas, funções and etapas an ARCHIVED same-name row is also an error (`duplicate_archived`), because the database name index covers archived rows and `createArea`/`createFuncao`/`createLeadStage` would refuse at commit. For produtos (no name index) an archived same name is only a `possible_duplicate` warning.
