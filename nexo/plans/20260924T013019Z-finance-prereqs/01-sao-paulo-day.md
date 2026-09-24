---
id: 01-sao-paulo-day
milestone: v4.1.0
status: todo
depends_on: []
files_modified: [packages/shared-utils/src/sao-paulo-day.ts, packages/shared-utils/src/index.ts, packages/shared-utils/package.json, packages/shared-utils/src/__tests__/sao-paulo-day.test.ts, apps/api/src/domains/sales-ops/service.ts, apps/api/src/domains/sales-ops/__tests__/sao-paulo-day-decisions.test.ts, apps/api/test/rls/sao-paulo-day.test.ts, apps/web/src/sales-ops/civil-day.ts, apps/web/src/sales-ops/calculations.ts, apps/web/src/sales-ops/SalesOpsApp.tsx, apps/web/src/sales-ops/__tests__/civil-day.test.ts, apps/web/src/sales-ops/__tests__/sale-detail-civil-day.test.tsx, CLAUDE.md, nexo/knowledge/reference/propostas.md]
goal: "C1 São Paulo day helper in shared-utils, and every API/web 'today' decision and due-date display uses the São Paulo civil day with no one-day slip"
acceptance: ["`@fxl-sales/shared-utils/sao-paulo-day` exports todayInSaoPaulo, saoPauloDayOf, isIsoDay, isAfterTodayInSaoPaulo and the package root re-exports them", "saoPauloDayOf(new Date('2026-03-01T01:30:00Z')) is '2026-02-28' in any process timezone, and follows historical Brazilian daylight saving (2018-11-05T02:30:00Z is '2018-11-05')", "isIsoDay accepts only real calendar days in strict YYYY-MM-DD", "isAfterTodayInSaoPaulo compares against the São Paulo day and throws RangeError on a malformed day", "createSale straight into won and transitionSale to won date the one-shot other_cost payable on the São Paulo day of the win instant (2026-02-28 for 2026-03-01T01:30:00Z)", "cancelContract without effectiveDate uses the São Paulo day as cut-off (a receivable due 2026-03-01 is voided at 2026-03-01T01:30:00Z, one due 2026-02-28 stays open)", "every API day input (dueDate, startDate, baseDate, effectiveDate) rejects a non-calendar day such as 2026-02-30 with 400 validation_error", "the wizard's default dates (baseDate, first parcela) are the São Paulo day, not the UTC day", "the sale detail renders a stored due_date 'YYYY-MM-DDT00:00:00.000Z' as the same civil day under TZ=America/Sao_Paulo", "no sales-ops source in API or web derives today via new Date().toISOString().slice(0, 10), guarded by a non-vacuous source test", "CLAUDE.md and propostas.md carry the civil-day rules in the same change"]
---

# 01-sao-paulo-day

## Context

Verified in the worktree at `82a62a3`.

Storage.
- `sales_ops_receivables.due_date` and `sales_ops_payables.due_date` are `timestamp('due_date', { withTimezone: true })` (`apps/api/src/db/schema.ts:1123`, `:1145`).
- The API writes a civil day `D` as `D T00:00:00.000Z` through `dateFromIsoDay` (`apps/api/src/domains/sales-ops/service.ts:605-607`) and reads it back with `asDateOnly` (`service.ts:600-603`), which is `toISOString().slice(0, 10)` for a `Date`.
- That storage round-trip is consistent and C1 keeps it unchanged.

The bugs are the places where an INSTANT (the clock) is turned into a day with the UTC slice, which is one day ahead of São Paulo between 21:00 and 23:59 local time.
- `createSale` (`service.ts:2299-2436`): `wonDate: asDateOnly(now)` at `service.ts:2422`.
  `now` is already an injectable parameter (`service.ts:2303`).
- `transitionSale` (`service.ts:2552-2657`): `const now = new Date();` at `service.ts:2571` and `wonDate: asDateOnly(now)` at `service.ts:2628`.
  The signature is `(db, orgId, saleId, to)`, with no injectable clock.
- `wonDate` feeds `materializeWonPayables`: the one-shot `other_cost` due date (`service.ts:1259`) and the professional one-shot fallback (`fallbackDueDate: input.wonDate`, `service.ts:1217`).
- `cancelContract` (`service.ts:2672-2735`): `const effective = effectiveDate ?? new Date().toISOString().slice(0, 10);` at `service.ts:2687`, then `cutoff = dateFromIsoDay(effective)` and `gt(salesOpsReceivables.dueDate, cutoff)` at `service.ts:2698`.
  After 21:00 in São Paulo the default cut-off is tomorrow, so a receivable due tomorrow is NOT voided.
- `isoDate` (`service.ts:148`) is a bare regex `^\d{4}-\d{2}-\d{2}$`, used by `dueDate` (`:441`), `startDate` (`:448`), `baseDate` (`:539`) and `effectiveDate` (`:562`); `2026-02-30` passes.
- `serializeSaleForApi` (`service.ts:2827-2829`) and every stored-date read use `asDateOnly` on STORED values, which is correct and stays.
- `apps/api/src/domains/sales-ops/routes.ts:343` passes `parsed.data.effectiveDate` through; it needs no change.

Web.
- `inputDateToday()` in `apps/web/src/sales-ops/SalesOpsApp.tsx:716-718` is `new Date().toISOString().slice(0, 10)`: the wizard's default `baseDate` (`SalesOpsApp.tsx:6495`, `:6588`, `:6613`) and default first parcela (`:6584`) are tomorrow after 21:00 in São Paulo.
- `dateOnly` / `displayDate` (`SalesOpsApp.tsx:707-714`) slice the string and call `formatIsoDateBr`, so the sale detail (`:2847` receivables, `:2903` and `:3089` payables, `:2649` and `:2786` base date, `:7128-7171` wizard preview) already print the stored civil day.
  They are private to the 9300-line file, so no test pins them against a negative-offset timezone.
- `formatIsoDateBr` (`apps/web/src/sales-ops/calculations.ts:474-478`) splits on `-` without slicing, so a full timestamp prints `01T00:00:00.000Z/03/2026`; `ProfessionalSplitPanel.tsx:97` and `:151` call it directly on wizard rows (already `YYYY-MM-DD` today, so latent).
- `wonAt` / `lostAt` are not rendered anywhere in sales-ops.
- `formatLedgerTimestampBr` (`cadastro-history.ts:190`) formats a real instant with its clock in the operator's timezone on purpose; it is not a civil day and is out of scope.
- `addMonthsToIsoDate` (`calculations.ts:524-533`) and the API `addMonths` (`service.ts:609-618`) are pure UTC calendar arithmetic on day strings and are correct.

Package.
- `packages/shared-utils/package.json` exports `.`, `./theme`, `./hmac`, `./sale-financials`, `./professional-split`, all from `dist`.
- The web must import SUBPATHS because the root re-exports the Node-only hmac module (`SalesOpsApp.tsx:125-128`).
- API and web tests resolve the package through `dist`, so every oracle command below runs `pnpm run build:packages` first.
- No file in the repo uses `timeZone` or `America/Sao_Paulo` today.

## Design

### C1 module `packages/shared-utils/src/sao-paulo-day.ts`

```ts
/**
 * Civil days in America/Sao_Paulo.
 *
 * Storage is unchanged: a civil day D is stored in a timestamptz as D T00:00:00Z
 * and read back with the UTC slice. Only decisions about "today" (the clock) go
 * through this module, because the UTC slice of an instant is one day ahead of
 * São Paulo between 21:00 and 23:59 local time.
 */
export const SAO_PAULO_TIME_ZONE = 'America/Sao_Paulo';

const ISO_DAY = /^(\d{4})-(\d{2})-(\d{2})$/;

const saoPauloDayFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: SAO_PAULO_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

export function saoPauloDayOf(instant: Date): string {
  if (!(instant instanceof Date) || Number.isNaN(instant.getTime())) {
    throw new RangeError('invalid_instant');
  }
  const parts = saoPauloDayFormatter.formatToParts(instant);
  const part = (type: 'year' | 'month' | 'day') =>
    parts.find((candidate) => candidate.type === type)?.value ?? '';
  return `${part('year').padStart(4, '0')}-${part('month')}-${part('day')}`;
}

export function todayInSaoPaulo(now: Date = new Date()): string {
  return saoPauloDayOf(now);
}

export function isIsoDay(value: string): boolean {
  if (typeof value !== 'string') return false;
  const match = ISO_DAY.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const probe = new Date(0);
  probe.setUTCFullYear(year, month - 1, day);
  return (
    probe.getUTCFullYear() === year &&
    probe.getUTCMonth() === month - 1 &&
    probe.getUTCDate() === day
  );
}

export function isAfterTodayInSaoPaulo(day: string, now: Date = new Date()): boolean {
  if (!isIsoDay(day)) throw new RangeError('invalid_iso_day');
  return day > todayInSaoPaulo(now);
}
```

- `formatToParts` with `en-CA` is used, never `format(...)` string parsing and never a fixed `-03:00` offset, so historical daylight saving (Brazil had DST until 2019) is right.
- `setUTCFullYear(year, month, day)` is used instead of `Date.UTC` because `Date.UTC` maps years 0..99 to 1900..1999.
- String comparison of two valid `YYYY-MM-DD` values is chronological.

Exports.
- `packages/shared-utils/src/index.ts`: append `export * from './sao-paulo-day.js';`.
- `packages/shared-utils/package.json` `exports`: add after `./professional-split`:
  `"./sao-paulo-day": { "types": "./dist/sao-paulo-day.d.ts", "import": "./dist/sao-paulo-day.js" }`.

### API (`apps/api/src/domains/sales-ops/service.ts`, small localized edits)

1. Import (new line after the existing `@fxl-sales/shared-utils` import block, `service.ts:1-6`):
   `import { isIsoDay, saoPauloDayOf, todayInSaoPaulo } from '@fxl-sales/shared-utils/sao-paulo-day';`
   Use the subpath, not the root, so `vi.mock('@fxl-sales/shared-utils', ...)` factories elsewhere stay unaffected.
2. `service.ts:148`: `const isoDate = z.string().refine(isIsoDay, { message: 'invalid_iso_day' });`
   Invalid days surface through the existing `400 validation_error` mapping in `routes.ts`; no route change.
3. `asDateOnly` (`service.ts:600`): keep the body; add the doc comment
   `/** STORED civil day of a due_date/base_date value (UTC slice, the storage convention). Never pass the clock: "today" is saoPauloDayOf / todayInSaoPaulo. */`
4. `createSale`, `service.ts:2422`: `wonDate: saoPauloDayOf(now),`.
5. `transitionSale`: signature becomes
   `export async function transitionSale(db: Db, orgId: string, saleId: string, to: TransitionTarget, now: Date = new Date()): Promise<TransitionResult>`
   and delete `const now = new Date();` at `service.ts:2571`.
   `service.ts:2628`: `wonDate: saoPauloDayOf(now),`.
   `wonAt: now` / `updatedAt: now` stay (they are instants).
6. `cancelContract`: signature becomes
   `export async function cancelContract(db: Db, orgId: string, saleId: string, effectiveDate?: string, now: Date = new Date()): Promise<CancelContractResult>`
   and `service.ts:2687` becomes `const effective = effectiveDate ?? todayInSaoPaulo(now);`.
   An explicit future `effectiveDate` stays allowed (unchanged behaviour).

No change to `routes.ts`: both new parameters are optional and trailing, and existing callers pass nothing.
Slices 04 and 06 will edit `transitionSale` / `cancelContract` too; they must keep the trailing `now` parameter.

### Web

New file `apps/web/src/sales-ops/civil-day.ts`:

```ts
import { todayInSaoPaulo } from '@fxl-sales/shared-utils/sao-paulo-day';
import { formatIsoDateBr } from './calculations';

/**
 * The stored civil day of a due_date/base_date value: the API stores day D as
 * D T00:00:00Z, so the first ten characters ARE the day. Never `new Date(value)`
 * in the browser timezone, which prints the previous day west of UTC.
 */
export function civilDayOf(value: string): string {
  return value.slice(0, 10);
}

/** `dd/mm/aaaa` of a stored civil day; accepts a timestamp or a date-only string. */
export function displayDate(value: string): string {
  return formatIsoDateBr(civilDayOf(value));
}

/** The default for a date input: today in America/Sao_Paulo, not the UTC day. */
export function inputDateToday(now: Date = new Date()): string {
  return todayInSaoPaulo(now);
}
```

- `apps/web/src/sales-ops/calculations.ts:475`: `const [year, month, day] = isoDate.slice(0, 10).split('-');` so `formatIsoDateBr` itself never prints a timestamp tail.
- `apps/web/src/sales-ops/SalesOpsApp.tsx`:
  - delete `dateOnly`, `displayDate` and `inputDateToday` (lines 707-718);
  - add `import { displayDate, inputDateToday } from './civil-day';` next to the `./ProfessionalSplitPanel` import (`:133`);
  - remove `formatIsoDateBr,` from the `./calculations` import list (`:148`) only if `grep -n "formatIsoDateBr" SalesOpsApp.tsx` shows no other use after the deletion (today it shows none), otherwise lint fails on an unused import.
  - every existing `displayDate(...)` / `inputDateToday()` call site stays byte-identical.

## Steps

Red, Green, Refactor, in order.

1. RED `packages/shared-utils/src/__tests__/sao-paulo-day.test.ts` (import from `../sao-paulo-day.js` and `../index.js`).
   First statement of the file, before imports are used: `process.env.TZ = 'Asia/Tokyo';` with a positive-control test proving it took effect (`new Date('2026-03-01T01:30:00Z').getHours()` is `10`).
   Tests:
   - `the process timezone is Asia/Tokyo (positive control)`.
   - `saoPauloDayOf keeps an instant just after UTC midnight on the previous São Paulo day`: `2026-03-01T01:30:00Z` to `2026-02-28`; `2026-03-01T02:59:59.999Z` to `2026-02-28`; `2026-03-01T03:00:00Z` to `2026-03-01`; `2026-12-31T23:30:00Z` to `2026-12-31`; `2027-01-01T02:00:00Z` to `2026-12-31`.
   - `saoPauloDayOf follows historical Brazilian daylight saving`: `2018-11-05T02:30:00Z` to `2018-11-05` (UTC-2 then; a fixed -3 gives `2018-11-04`).
   - `saoPauloDayOf refuses an invalid instant`: `new Date('nope')` throws `RangeError`.
   - `todayInSaoPaulo reads the injected clock`: `todayInSaoPaulo(new Date('2026-03-01T01:30:00Z'))` is `2026-02-28`.
   - `isIsoDay accepts only real calendar days`: true for `2026-02-28`, `2024-02-29`, `2026-12-31`, `0001-01-01`; false for `2026-02-29`, `2026-02-30`, `2026-04-31`, `2026-13-01`, `2026-00-10`, `2026-01-00`, `2026-1-01`, `2026-01-01T00:00:00Z`, ` 2026-01-01`, `''`.
   - `isAfterTodayInSaoPaulo compares against the São Paulo day, not the UTC day`: with `now = 2026-03-01T01:30:00Z`, `2026-03-01` is true, `2026-02-28` is false, `2026-02-27` is false.
   - `isAfterTodayInSaoPaulo refuses a malformed day`: `'2026-02-30'` throws `RangeError`.
   - `the package root and the subpath export the São Paulo day helpers`: the four functions are `typeof 'function'` on `../index.js`; `JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')).exports['./sao-paulo-day']` equals `{ types: './dist/sao-paulo-day.d.ts', import: './dist/sao-paulo-day.js' }`.
   GREEN: create `sao-paulo-day.ts`, edit `index.ts` and `package.json` per Design.
2. RED `apps/api/src/domains/sales-ops/__tests__/sao-paulo-day-decisions.test.ts` (unit, no DB).
   - `rejects a day input that is not a real calendar day`: `CancelContractSchema.safeParse({ effectiveDate: '2026-02-30' }).success` is false; `'2026-02-28'` is true; `SaleInstallmentSchema.safeParse({ dueDate: '2026-02-30', amountBrl: 1000, method: 'pix' }).success` is false and with `2026-02-28` is true; `CreateSaleSchema.safeParse(<the minimal body below with baseDate '2026-02-30'>).success` is false and the same body with `2026-02-28` is true.
     Minimal body: `{ clientName: 'Cliente', sellerName: 'Ana', status: 'draft', baseDate, items: [{ productName: 'Item', quantity: 1, unitBrl: 1000, areaId: '77777777-7777-4777-8777-777777777777' }], installments: [{ dueDate: '2026-02-28', amountBrl: 1000, method: 'pix' }] }`; if the positive case fails on a field unrelated to dates, adjust the body until the `2026-02-28` case passes, and keep the positive assertion (it is what proves the negative one is not vacuous).
   - `no sales-ops API source derives a day from the UTC clock`: read `service.ts` and `routes.ts` with `readFileSync(new URL('../service.ts', import.meta.url))`; assert both are longer than 1000 characters (vacuity control), that neither matches `/new Date\(\)\.toISOString\(\)\.slice\(0,\s*10\)/` nor `/asDateOnly\(\s*now\s*\)/`, and that `service.ts` contains `saoPauloDayOf(now)` exactly twice and `todayInSaoPaulo(now)` once.
   GREEN: service edits 1 to 6.
3. RED `apps/api/test/rls/sao-paulo-day.test.ts` (integration; copy the connection, `afterAll` cleanup and `seedAreaAndProduct` pattern from `apps/api/test/rls/proposal-write.test.ts:14-73`; import `createSale`, `transitionSale`, `cancelContract`, `CreateSaleSchema`, `AreaSchema`, `ProductSchema`, `createArea`, `createProduct` from `../../src/domains/sales-ops/service.js`).
   Helper `dueDayOf(orgId, saleId, kind)` via the admin client:
   ``SELECT to_char(due_date AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS day FROM sales_ops_payables WHERE org_id = ${orgId} AND sale_id = ${saleId} AND kind = ${kind}``.
   Body builder: `clientName 'Cliente SP'`, `sellerName 'Ana Martins'`, `baseDate '2026-02-20'`, `otherCostsBrl 20000`, one product item `unitBrl 500000`, `installments: [{ dueDate: '2026-02-20', amountBrl: 500000, method: 'pix' }]`, no professionals.
   Org ids `org_spday_<name>_${crypto.randomUUID()}`.
   - `createSale straight into won dates the one-shot other_cost on the São Paulo day of the win`: `createSale(db, orgId, CreateSaleSchema.parse({ ...body, status: 'won' }), new Date('2026-03-01T01:30:00Z'))`; `other_cost` day is `2026-02-28`.
   - `transitionSale to won dates the one-shot other_cost on the São Paulo day of the win`: create with `status: 'open'`, then `transitionSale(db, orgId, sale.id, 'won', new Date('2026-03-01T01:30:00Z'))`; `other_cost` day is `2026-02-28`.
     Control in the same test with a second sale and `new Date('2026-03-01T03:30:00Z')`: day is `2026-03-01` (proves the helper is not a blanket minus one).
   - `cancelContract without an effective date cuts off at the São Paulo day, not the UTC day`: create `status: 'won'` with `installments: [{ dueDate: '2026-02-28', amountBrl: 250000, method: 'pix' }, { dueDate: '2026-03-01', amountBrl: 250000, method: 'pix' }]` (items total stays 500000); `cancelContract(db, orgId, sale.id, undefined, new Date('2026-03-01T01:30:00Z'))` returns `ok: true` and `voidedReceivables: 1`; the receivable due `2026-02-28` is `open`, the one due `2026-03-01` is `void`.
     Under the old UTC default the cut-off is `2026-03-01`, nothing is future, `recurringBrl` is 0, and the call answers `not_cancellable`, so this test fails on the old code.
   GREEN: already green after step 2's service edits; run it and see it pass, then temporarily revert edit 5 or 6 locally to see it fail (do not commit the revert).
4. RED `apps/web/src/sales-ops/__tests__/civil-day.test.ts` (node environment).
   First statement: `process.env.TZ = 'America/Sao_Paulo';`.
   - `the process timezone is negative-offset (positive control)`: `new Date('2026-03-01T00:00:00.000Z').getDate()` is `28`.
   - `displayDate prints the stored civil day of a UTC-midnight timestamp in a negative-offset timezone`: `displayDate('2026-03-01T00:00:00.000Z')` is `01/03/2026`; `displayDate('2026-03-01')` is `01/03/2026`.
   - `formatIsoDateBr accepts a full timestamp`: `formatIsoDateBr('2026-03-01T00:00:00.000Z')` is `01/03/2026`.
   - `inputDateToday is the São Paulo day, not the UTC day, near UTC midnight`: `inputDateToday(new Date('2026-03-01T01:30:00Z'))` is `2026-02-28`; `inputDateToday(new Date('2026-03-01T03:30:00Z'))` is `2026-03-01`.
   - `no sales-ops web source derives today from the UTC clock`: walk `apps/web/src/sales-ops` with `readdirSync(dir, { recursive: true })` from `fileURLToPath(new URL('..', import.meta.url))`, keep `.ts`/`.tsx` files not under `__tests__`; assert the list includes `SalesOpsApp.tsx` and `civil-day.ts` and has more than 20 files (vacuity control); assert none matches `/new Date\(\)\.toISOString\(\)\.slice\(0,\s*10\)/`.
   GREEN: create `civil-day.ts`, edit `calculations.ts:475`, edit `SalesOpsApp.tsx` per Design.
5. RED `apps/web/src/sales-ops/__tests__/sale-detail-civil-day.test.tsx` (`// @vitest-environment happy-dom`, then `process.env.TZ = 'America/Sao_Paulo';` before the imports are used).
   Copy the `vi.mock` blocks for `@/components/ui/dialog`, `@/components/ui/dropdown-menu`, `@/components/ui/alert-dialog`, the `act` alias, the `sale(...)` factory and `renderSalesView` from `apps/web/src/sales-ops/__tests__/sales-view.test.tsx:1-248`; keep only one won sale.
   Fixture: won sale `P-010`, `baseDate: '2026-03-01T00:00:00.000Z'`; receivables `{ id: 'rec-1', label: '1/2', dueDate: '2026-03-01T00:00:00.000Z', amountBrl: 150000, status: 'open' }` and `{ id: 'rec-2', label: '2/2', dueDate: '2026-04-01T00:00:00.000Z', amountBrl: 150000, status: 'open' }`; payable `{ kind: 'seller_commission', dueDate: '2026-03-05T00:00:00.000Z', amountBrl: 12000, status: 'open' }`.
   - `renders a stored UTC-midnight due date as the same civil day in a negative-offset timezone`: positive control `new Date('2026-03-01T00:00:00.000Z').getDate()` is `28`; click the `P-010` row; the text contains `01/03/2026`, `01/04/2026` and `05/03/2026`, and does NOT contain `28/02/2026`, `31/03/2026` or `04/03/2026`.
   GREEN: already green after step 4 (the slice keeps the string-slice display); it is a regression oracle.
6. Docs (see Docs), then `pnpm run lint` on changed files and the oracle commands.

## Oracle tests

Always first: `pnpm run build:packages` (API and web resolve `@fxl-sales/shared-utils` through `dist`).

1. `pnpm --filter @fxl-sales/shared-utils exec vitest run src/__tests__/sao-paulo-day.test.ts`
   Mutations: replace the formatter with `instant.toISOString().slice(0, 10)` (the near-midnight test fails); replace it with a fixed `-3h` shift (the 2018 DST test fails); make `isIsoDay` the bare regex (`2026-02-30` test fails); drop the `package.json` export (the export test fails).
2. `pnpm --filter @fxl-sales/api exec vitest run src/domains/sales-ops/__tests__/sao-paulo-day-decisions.test.ts`
   Mutations: revert `isoDate` to the bare regex (the `2026-02-30` assertions fail); restore `asDateOnly(now)` in either won path (the source guard fails).
3. `pnpm --filter @fxl-sales/api test:integration test/rls/sao-paulo-day.test.ts` (local Docker test DB only; never `db:migrate`).
   Mutations: `wonDate: asDateOnly(now)` in `createSale` fails test 1; in `transitionSale` fails test 2; `new Date().toISOString().slice(0, 10)` or `todayInSaoPaulo()` without `now` in `cancelContract` fails test 3 (`not_cancellable`, or the wrong row voided).
4. `pnpm --filter @fxl-sales/web exec vitest run src/sales-ops/__tests__/civil-day.test.ts src/sales-ops/__tests__/sale-detail-civil-day.test.tsx`
   Mutations: `inputDateToday` back to the UTC slice fails the near-midnight test; `displayDate` as `new Date(value).toLocaleDateString('pt-BR')` fails both display tests (`28/02/2026`); dropping `.slice(0, 10)` from `formatIsoDateBr` fails its test.
   The positive controls (`getDate()` is `28`) prove the file really runs west of UTC, so a green display test is not vacuous.
5. Regression: `pnpm --filter @fxl-sales/web exec vitest run src/sales-ops/__tests__/sales-view.test.tsx` and `pnpm --filter @fxl-sales/api test:integration src/domains/sales-ops/__tests__/sale-transitions.integration.test.ts test/rls/proposal-write.test.ts`.

## Docs

`CLAUDE.md`, in `## Propostas domain`, add a new block between `Professionals (step 3):` and `Testing:`:

```markdown
Civil days:
- `due_date` stores a civil day `D` as `D T00:00:00Z` and is read back with the UTC slice (`asDateOnly` in the API, `displayDate` / `civilDayOf` in `apps/web/src/sales-ops/civil-day.ts`); never format it through `new Date(...)` in the browser timezone.
- Every "today" decision is the `America/Sao_Paulo` day from `@fxl-sales/shared-utils/sao-paulo-day` (`todayInSaoPaulo`, `saoPauloDayOf`, `isAfterTodayInSaoPaulo`), never `new Date().toISOString().slice(0, 10)`. The won date and the `cancel-contract` default cut-off follow it.
- Day inputs are validated with `isIsoDay` (a real calendar day), never a bare regex. The web imports the subpath, never the package root.
```

`nexo/knowledge/reference/propostas.md`, append at the end:

```markdown
- Civil days are São Paulo days (audit PC24, prerequisite 6).
  `due_date` stays `timestamptz` and a civil day `D` is still stored as `D T00:00:00Z` and read back with the UTC slice, so storage and every existing row are unchanged.
  The slip was never in storage: it was in turning the CLOCK into a day with `toISOString().slice(0, 10)`, which is one day ahead of São Paulo from 21:00 to 23:59 local time.
  `packages/shared-utils/src/sao-paulo-day.ts` is the one place that decides "today": `todayInSaoPaulo`, `saoPauloDayOf`, `isAfterTodayInSaoPaulo` and `isIsoDay`, built on `Intl.DateTimeFormat` with `timeZone: 'America/Sao_Paulo'` so historical daylight saving is right, never on a fixed `-03:00`.
  `createSale` and `transitionSale` pass `saoPauloDayOf(now)` as the won date (the one-shot `other_cost` and professional fallback due date), and `cancelContract` defaults its cut-off to `todayInSaoPaulo(now)`; both take a trailing optional `now` so tests can pin an instant near UTC midnight.
  `isAfterTodayInSaoPaulo` throws `RangeError` on a malformed day on purpose: callers validate with `isIsoDay` first and answer their own error code.
  The web never builds a `Date` from a stored day: `displayDate` slices the first ten characters, and `inputDateToday` is the São Paulo day.
  Oracles: `packages/shared-utils/src/__tests__/sao-paulo-day.test.ts`, `apps/api/test/rls/sao-paulo-day.test.ts`, `apps/api/src/domains/sales-ops/__tests__/sao-paulo-day-decisions.test.ts`, `apps/web/src/sales-ops/__tests__/civil-day.test.ts` and `apps/web/src/sales-ops/__tests__/sale-detail-civil-day.test.tsx`, the web ones running under `TZ=America/Sao_Paulo` with a `getDate()` positive control.
```

No em dash anywhere; one sentence per line as shown.

## Security notes

- No new route, no auth change, no tenant query change; `transitionSale` and `cancelContract` keep their `withTenant` and `orgId` filters.
- The new `now` parameters are internal service arguments and are never read from a request.
- Tightening `isoDate` only narrows accepted input (fail closed on a non-calendar day).

## Contract deviations

None that break C1.
Two additive notes for the other slices:
- C1 says the helpers are also exported from the root index; they are, but the web must import the `/sao-paulo-day` subpath because the root re-exports the Node-only hmac module.
- `transitionSale` and `cancelContract` gain a trailing optional `now: Date = new Date()`; slices 04 and 06 must preserve it (and slice 06 should pass the same `now` into its settlement default `paidOn = todayInSaoPaulo(now)`).

## Decisions for AUDIT

- D1: the won date used for the one-shot `other_cost` and the professional one-shot fallback is the São Paulo day of the win instant; `won_at` itself stays the raw instant.
- D2: an explicit `effectiveDate` on `cancel-contract` may still be in the future (unchanged behaviour); only the DEFAULT moves to the São Paulo day.
- D3: every API day input (`dueDate`, `startDate`, `baseDate`, `effectiveDate`) now rejects a non-calendar day such as `2026-02-30` with the existing `400 validation_error`; before, the regex accepted it and `new Date` silently rolled it over.
- D4: `isAfterTodayInSaoPaulo` throws `RangeError` on a malformed day instead of returning a boolean, so a caller that forgot `isIsoDay` fails loudly rather than accepting a bad date.
- D5: instants shown with a clock (`formatLedgerTimestampBr`, legacy admin pages) stay in the operator's own timezone; they are events, not civil days.

## Out of scope

- Settlement dates, `paid_on`, and any settlement code (slice 06 reuses `todayInSaoPaulo` / `isAfterTodayInSaoPaulo`).
- Changing `due_date` to a `date` column or rewriting stored values.
- `contract_ended_at` (audit prerequisite 8, not in this feature's request).
- Lead aging (`daysInCurrentStage`), commissions `hold_until`, and the legacy admin/finder pages.
- `packages/shared-utils/src/date.ts` (`toISODate` has no caller; left untouched).
