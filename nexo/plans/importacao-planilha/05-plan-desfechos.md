---
id: 05-plan-desfechos
milestone: v4.2.0
status: done
depends_on: [04-plan-propostas]
files_modified:
  - apps/api/src/domains/import/plan/desfechos.ts
  - apps/api/src/domains/import/plan/__tests__/desfechos.test.ts
acceptance: "Given a hand-built ParsedWorkbook, ImportCatalog and propostas SheetPlanResult, planDesfechos validates every Ganha proposta's Data de ganho (required, not after catalog.today), appends one transitionSale op (to lost or cancelled) after each Perdida/Cancelada createSale, turns every valid Pagamentos row into one settleReceivable op carrying a receivable label that buildSaleLedger would generate for that proposta, refuses unknown Refs, non-Ganha propostas, unknown or duplicated parcelas and future payment days with pt-BR issues naming the values, and, when catalog.producerFlowLive, refuses every Ganha proposta and every Pagamentos row with producer_flow_live and emits no settlement; plannedReceivableLabels matches buildSaleLedger's labels on the same input."
goal: "Plan the outcome effects of the import (won day, lost, cancelled) and the Pagamentos history, so that every operation it emits passes the manual settlement validators (validarNovaBaixa via applyBaixaTx) and the transition rules at commit, and nothing in a Finance-connected org can create an obligation or settlement event."
must_not_break:
  - "pnpm --filter @fxl-sales/api test (whole unit suite)"
  - "pnpm --filter @fxl-sales/api lint"
  - "pnpm --filter @fxl-sales/api type-check"
  - apps/api/src/domains/sales-ops/__tests__/sale-margin-parity.test.ts
  - apps/api/src/domains/import/__tests__/parse.test.ts
rules:
  - "desfechos.ts is pure: no I/O, no clock (never `new Date()`), no process.env, no database, no Date-based formatting of civil days (format dd/mm/aaaa by splitting the ISO string)."
  - "Read cells ONLY through `cellReader(sheet, row)` from `../parse.js`; match Refs ONLY with `normalizeLabel` from `../cells.js`."
  - "A null in a required cell, or any cell that already carries a parser issue, is never reported again: skip that check silently."
  - "Never edit types.ts, workbook-schema.ts, cells.ts, parse.ts, refs.ts or plan/propostas.ts; never import anything from apps/web."
  - "Never mutate or reorder `propostas.operations`; return only NEW operations (transitions then settlements)."
  - "Issue messages are pt-BR, quote the user's values, never contain a uuid, a planKey or a column key; `column` is the header text from workbook-schema (`getColumnDef(sheet, key).header`) or null."
  - "No em dash in any file; relative imports use the `.js` extension; no `any`."
  - "Do not touch apps/web/** (and never apps/web/src/sales-ops/leads/**: live peer run)."
verifier_focus: "That plannedReceivableLabels is proven equal to buildSaleLedger's labels by the parity test (zero-amount installment dropped and renumbered, bounded recurring M labels, indefinite recurring producing none); that producerFlowLive refuses every Ganha row and every Pagamentos row and yields zero settleReceivable ops; that Perdida/Cancelada transitions come out in Propostas row order and only for rows whose createSale op exists; that no check double-reports a parser issue; and that the D2 verdict below is backed by the cited service.ts lines."
---

# Slice 05 - plan desfechos (Ganha, Perdida, Cancelada, Pagamentos)

## Objective

Write `apps/api/src/domains/import/plan/desfechos.ts` with `planDesfechos(parsed, catalog, refs, propostas)`.
It consumes slice 04's `SheetPlanResult` (the createSale operations) and the parsed `Propostas` and `Pagamentos` sheets, and returns only the extra operations and issues that outcomes and payment history need.
`plan/index.ts` (slice 07) concatenates its result after `planPropostas`, so every transition and settlement lands after every createSale.

## Code facts (verified while planning)

- `CreateSaleSchema.status` is `z.enum(['draft', 'open', 'won'])` (`apps/api/src/domains/sales-ops/service.ts` around line 590). A sale cannot be CREATED as `lost` or `cancelled`; it must be created and then transitioned.
- `SALE_STATUS_OPTIONS` values are `draft|open|won|lost|cancelled` with labels Rascunho, Aberta, Ganha, Perdida, Cancelada (slice 01). The `situacao` cell holds the VALUE; blank means Aberta (slice 04's default).
- `SALE_TRANSITIONS` (service.ts line 2792): `open: ['won', 'lost', 'cancelled']`. So `open -> lost` and `open -> cancelled` are legal; `transitionSale` would answer `invalid_transition` from any other start for these targets except `draft -> cancelled` and `lost -> cancelled`.
- `buildSaleLedger` (service.ts line 973) builds receivable labels purely from the input:
  - `keptInstallments = input.installments.filter(row => row.amountBrl > 0)`; labels `${index + 1}/${keptInstallments.length}` in input order. A zero-amount installment is DROPPED and the others are renumbered.
  - When `input.recurring` is non-null and `recurring.cycles !== null`: labels `M${i + 1}/${cycles}` for `i` in `0..cycles-1`, after the installments. An indefinite recorrência (`cycles: null`) creates NO receivable rows.
  - `SaleRecurringSchema.monthlyBrl` is `z.number().int().positive()`, so every recurring receivable is > 0.
- Therefore every receivable that exists after `createSale` has `amountBrl > 0`; a zero-amount parcela has no row and no label, so it can never be referenced (it is reported as `unknown_parcela`).
- `materializeWonPayables` (service.ts line 1167) pushes a commission, finder or tax payable only when its amount is `> 0`, and skips a professional with `costBrl <= 0`; every payable linked to a receivable is therefore `> 0` and `open`.
- `applyBaixaTx` with `{ mode: 'manual' }` (`apps/api/src/domains/sales-ops/settlements.ts` line 430) calls `validarNovaBaixa` (`packages/shared-utils/src/liquidacao.ts`), which refuses in this order: `sale_not_won`, `row_void`, `invalid_paid_on` (not a real civil day), `paid_on_in_future` (`paidOn > today`), `already_paid` (open amount 0). The amount is always the whole open amount, never from input.
- `applyBaixaTx` itself emits a `settlement.recorded` event when `policy.mode === 'manual' && isProducerFlowLive(orgId)` (line 496). This is why Pagamentos MUST be refused in a live org (D2).

### Settlement validator walkthrough (why every planned settlement passes at commit)

| validator refusal | why it cannot happen for a planned `settleReceivable` |
| --- | --- |
| `sale_not_won` | a settlement is planned only for a Ref whose `situacao` is `won`, whose createSale op has `input.status === 'won'` (seam-asserted). |
| `row_void` | every receivable and payable is inserted `open` by `createSale` in the same transaction; nothing voids them before the settlement. |
| `invalid_paid_on` | `dataPagamento` is a `day` cell: `isIsoDay` and year >= 1900 already checked by the parser. |
| `paid_on_in_future` | planned only when `paidOn <= catalog.today`; commit re-plans with a catalog read from the same `now` the executor uses for `today`. |
| `already_paid` (receivable) | open amount is the full amount (> 0, see facts) and the same canonical parcela of the same Ref is refused twice (`duplicate_payment`). |
| `already_paid` (payables, `Repasses pagos`) | each payable is linked to exactly ONE receivable, and a receivable is settled at most once, so each payable is settled at most once; its amount is > 0. |

## D2 investigation verdict (open question from the overview)

Evidence, `apps/api/src/domains/sales-ops/service.ts`:

- `createSale` (line 2507) calls `emitSaleObligationEvents` only inside `if (input.status === 'won')` (line 2647). A sale created as `open` emits nothing.
- `transitionSale` (line 2811) calls `emitSaleObligationEvents` in exactly two places: the `to === 'open'` branch, and only `if (sale.status === 'won')` (voiding payables of a reverted win, line 2917); and after the update `if (to === 'won')` (line 2939).
  The `to === 'lost'` branch only sets `{ status: 'lost', lostAt: now, updatedAt: now }` and the `cancelled` branch only `{ status: 'cancelled', updatedAt: now }`; neither touches receivables or payables nor emits.
- A never-won sale has no payables (payables materialize only on `won`) and no settlements, so there is nothing to void or publish.
- `emitSaleObligationEvents` itself returns immediately when `!isProducerFlowLive(orgId)` and is the only emission path in these two functions.

Verdict: `createSale(status 'open')` followed by `transitionSale(open -> lost)` or `transitionSale(open -> cancelled)` emits NOTHING to the integration outbox, live org or not.

Resulting rule: Perdida and Cancelada propostas are ALWAYS allowed, including when `catalog.producerFlowLive` is true. Only Ganha propostas and Pagamentos rows are refused with `producer_flow_live`.
Known limitation (record in Leia-me via slice 08 if it wants; not a blocker): `lost_at` is the commit instant (the executor's `now`), because the sheet has no loss date column.

## Exports (exact) - `apps/api/src/domains/import/plan/desfechos.ts`

```ts
import { normalizeLabel } from '../cells.js';
import { cellReader } from '../parse.js';
import { getColumnDef, SALE_STATUS_OPTIONS } from '../workbook-schema.js';
import type {
  ImportCatalog, ImportCounts, ImportIssue, ImportOperation, ParsedRow, ParsedWorkbook, RefIndex, SaleDraft, SheetKey, SheetPlanResult,
} from '../types.js';

export type DesfechoIssueCode =
  | 'won_date_required' | 'won_date_in_future' | 'won_date_ignored' | 'producer_flow_live'
  | 'unknown_proposta_ref' | 'proposta_not_won' | 'unknown_parcela' | 'duplicate_payment' | 'payment_in_future';

/** The receivable labels createSale will write for this draft, in buildSaleLedger order. Pure mirror, proven by a parity test. */
export function plannedReceivableLabels(draft: Pick<SaleDraft, 'installments' | 'recurring'>): string[];

/** How a typed Parcela is compared with a generated label: every whitespace removed, uppercased (`m 2/12` -> `M2/12`). */
export function canonicalParcelaLabel(text: string): string;

export function planDesfechos(
  parsed: ParsedWorkbook,
  catalog: ImportCatalog,
  _refs: RefIndex,          // unused today; kept for the shared planner signature
  propostas: SheetPlanResult,
): SheetPlanResult;
```

`plannedReceivableLabels`:

```ts
const kept = draft.installments.filter((row) => row.amountBrl > 0);
const labels = kept.map((_, index) => `${index + 1}/${kept.length}`);
const recurring = draft.recurring ?? null;
if (recurring && recurring.cycles !== null) for (let i = 0; i < recurring.cycles; i++) labels.push(`M${i + 1}/${recurring.cycles}`);
return labels;
```

Internal helpers (not exported): `dayBr(iso)` returns `dd/mm/aaaa` from `iso.split('-')`; `statusLabel(value: string | null)` returns the `SALE_STATUS_OPTIONS` label (null -> `Aberta`); `hasCellIssue(parsed, sheet, row, header)` is `parsed.issues.some(i => i.sheet === sheet && i.row === row && i.column === header)`; `header(sheet, key)` is `getColumnDef(sheet, key).header`; `issue(severity, sheet, row, column, code, message)` builds an `ImportIssue`.

## Algorithm of `planDesfechos`

Let `ops: ImportOperation[] = []`, `transitions: ImportOperation[] = []`, `settlements: ImportOperation[] = []`, `issues: ImportIssue[] = []`.

### Step 1 - index the propostas

- `saleOps = new Map<string, Extract<ImportOperation, { op: 'createSale' }>>()` from `propostas.operations` where `op === 'createSale'`, keyed by `planKey`.
- `refRows = new Map<string, ParsedRow[]>()`: for each row of `parsed.sheets.propostas.rows`, `ref = cellReader('propostas', row).text('ref')`; when non-null, push the row under `normalizeLabel(ref)`.
  (Duplicate Refs are slice 04's error; this slice only needs to know a Ref is ambiguous so it can stay silent.)

### Step 2 - Propostas outcomes (in Propostas row order)

For each `row` of `parsed.sheets.propostas.rows`, `r = cellReader('propostas', row)`, `status = r.text('situacao')` (an option value or null), `wonOn = r.text('dataGanho')`, `saleKey = \`propostas:${row.row}\``, `op = saleOps.get(saleKey)`:

1. If `status === 'won'`:
   1. `catalog.producerFlowLive` -> error `producer_flow_live`, column `Situação`, message `Esta organização está conectada ao FXL Finance, então propostas Ganhas não podem ser importadas: o histórico não chegaria ao Finance. Importe como Aberta e marque como ganha no app.`; continue to the next row (no date checks).
   2. `wonOn === null` and not `hasCellIssue(parsed, 'propostas', row.row, 'Data de ganho')` -> error `won_date_required`, column `Data de ganho`, `Preencha a Data de ganho: ela é obrigatória quando a situação é Ganha.`
   3. `wonOn !== null && wonOn > catalog.today` -> error `won_date_in_future`, column `Data de ganho`, `A Data de ganho ${dayBr(wonOn)} está no futuro; use um dia até hoje (${dayBr(catalog.today)}).`
   4. No lower bound against `Data base`: decided from the domain. `won_at` and `base_date` are independent in the service (`createSale` stores `wonAt = now` and `transitionSale` sets `wonAt: now` whatever the base date), so the app itself produces wins before a future base date; refusing or warning would reject states the product creates every day.
   5. Seam assert: when `op` exists and (`op.input.status !== 'won'` or `op.wonOn !== wonOn`) throw `new Error(\`planDesfechos seam: ${saleKey} must be createSale status won with wonOn = Data de ganho\`)` (programmer error, caught by the round-trip tests).
2. Else (`status` is `null`, `draft`, `open`, `lost` or `cancelled`):
   1. `wonOn !== null` -> warning `won_date_ignored`, column `Data de ganho`, `A Data de ganho ${dayBr(wonOn)} só vale para propostas Ganhas e foi ignorada.`
   2. If `status === 'lost' || status === 'cancelled'` and `op` exists:
      seam assert `op.input.status === 'open'` (else throw `new Error(\`planDesfechos seam: ${saleKey} must be createSale status open before its transition\`)`);
      push `{ op: 'transitionSale', saleKey, to: status }` to `transitions`.
      When `op` is absent (slice 04 refused the row) emit nothing and no issue.
   3. No producer check here: see the D2 verdict.

### Step 3 - Pagamentos (in Pagamentos row order)

`seen = new Map<string, number>()` keyed by `${normalizeLabel(ref)}|${canonicalLabel}` with the first Excel row.
For each `row` of `parsed.sheets.pagamentos.rows`, `r = cellReader('pagamentos', row)`, `ref = r.text('ref')`, `parcela = r.text('parcela')`, `paidOn = r.text('dataPagamento')`, `settlePayables = r.bool('repassesPagos') === true`:

1. `catalog.producerFlowLive` -> error `producer_flow_live`, column null, `Esta organização está conectada ao FXL Finance, então o histórico de pagamentos não pode ser importado: as baixas não chegariam ao Finance. Registre os pagamentos no app.`; continue (one issue per row, no other checks).
2. `ref === null` -> continue silently (parser already reported `required`).
3. `rows = refRows.get(normalizeLabel(ref))`:
   - undefined -> error `unknown_proposta_ref`, column `Ref`, `O Ref "${ref}" não existe na aba Propostas; um pagamento só pode citar uma proposta desta planilha.`; continue.
   - `rows.length > 1` -> continue silently (slice 04 reports the duplicate Ref).
4. `prow = rows[0]`, `pstatus = cellReader('propostas', prow).text('situacao')`.
   - `pstatus !== 'won'` -> error `proposta_not_won`, column `Ref`, `A proposta "${ref}" está como ${statusLabel(pstatus)}; só propostas Ganhas podem ter pagamentos.`; continue.
5. `op = saleOps.get(\`propostas:${prow.row}\`)`; undefined -> continue silently (the proposta row has its own errors).
6. `parcela === null` -> skip the parcela checks (parser issue already exists) but still run step 8 on the date; then continue without an op.
   Otherwise `canonical = canonicalParcelaLabel(parcela)`, `labels = plannedReceivableLabels(op.input)`, `match = labels.find(l => l === canonical)`:
   - no match, `canonical.startsWith('M')` and `op.input.recurring` non-null with `cycles === null` -> error `unknown_parcela`, column `Parcela`, `A recorrência da proposta "${ref}" é por prazo indeterminado e não gera mensalidades na importação, então a parcela "${parcela}" não existe.`
   - other no match -> error `unknown_parcela`, column `Parcela`, `A proposta "${ref}" não tem a parcela "${parcela}"; as parcelas dela são ${list}.` where `list` is `labels.slice(0, 12).join(', ')` plus ` e mais ${labels.length - 12}` when `labels.length > 12`.
7. When `match`: `key = \`${normalizeLabel(ref)}|${match}\``; if `seen.has(key)` -> error `duplicate_payment`, column `Parcela`, `A parcela "${match}" da proposta "${ref}" já foi paga na linha ${seen.get(key)}.`; else `seen.set(key, row.row)`.
8. `paidOn !== null && paidOn > catalog.today` -> error `payment_in_future`, column `Data do pagamento`, `A data do pagamento ${dayBr(paidOn)} está no futuro; use um dia até hoje (${dayBr(catalog.today)}).`
9. Emit `{ op: 'settleReceivable', saleKey: op.planKey, receivableLabel: match, paidOn, settlePayables }` into `settlements` ONLY when this row produced no issue in steps 6-8, `match` exists and `paidOn !== null`.

No lower bound for `paidOn` (before `Data base` or before `Data de ganho`): `validarNovaBaixa` has none and the UI allows any past day, so the import does not invent one.

Why an EXISTING sale cannot be referenced: the import is create-only (decision 3); a baixa on an existing proposta is a change to an existing record, existing sales have no `Ref` in the org, and their parcelas may already carry settlements, so the plan could not guarantee `already_paid`/`row_void` would not fire at commit. The pt-BR message says "uma proposta desta planilha".

### Step 4 - result

```ts
const operations = [...transitions, ...settlements];
const counts: ImportCounts = settlements.length > 0 ? { pagamentos: settlements.length } : {};
return { operations, issues, counts };
```

Issues are in Propostas row order then Pagamentos row order (slice 07 sorts globally anyway).
Transitions are not counted (the proposta is already counted under `propostas` by slice 04).

## Red tests (write first, watch them fail, then implement)

File `apps/api/src/domains/import/plan/__tests__/desfechos.test.ts`.
Fixtures built by hand, no xlsx: `emptyParsedWorkbook()` from `../../parse.js`, then push `{ row, cells }` rows with the exact column keys of slice 01 (every key of the sheet present, null where blank); a literal `ImportCatalog` with `today: '2026-10-02'`, `producerFlowLive: false`, settings 10/3/6, empty lists; a stub `RefIndex` whose `resolve` throws (proves it is not used); a local `draft(overrides)` building a `SaleDraft` (`clientRef: null`, `sellerRef: { existingId: 'seller' }`, `finderRef: null`, one item, `installments` of three rows of 1000 cents, `recurring: null`, `status: 'open'`, `baseDate: '2026-01-15'`, the commission/tax numbers, `otherCostsBrl: 0`, `professionals: []`, `notes: null`) and a `saleOp(row, status, wonOn, overrides)` building `{ op: 'createSale', planKey: \`propostas:${row}\`, input: draft({ status, ...overrides }), wonOn }`.

`describe('plannedReceivableLabels')`:
- `labels installments N/M in order` - three positive rows -> `['1/3','2/3','3/3']`.
- `drops a zero-amount installment and renumbers the rest` - `[1000, 0, 1000]` -> `['1/2','2/2']`.
- `appends bounded recurring cycles as MN/M` - 1 installment + `recurring { cycles: 3 }` -> `['1/1','M1/3','M2/3','M3/3']`.
- `creates no label for an indefinite recurring` - `cycles: null` -> `['1/1']`.
- `matches buildSaleLedger on the same input` (THE parity oracle) - for four inputs (each case above), `buildSaleLedger(CreateSaleSchema.parse(payload), itemContexts, parties).receivables.map(r => r.label)` equals `plannedReceivableLabels(payload)`; use the same `itemContexts`/`parties` construction and uuid literals as `sales-ops/__tests__/sale-margin-parity.test.ts` (payload with real uuids, `status: 'open'`, `items` summing to the installments).

`describe('canonicalParcelaLabel')`: `' 1/3 '` -> `1/3`; `'m 2 / 12'` -> `M2/12`.

`describe('planDesfechos - Propostas outcomes')`:
- `accepts a Ganha proposta with a past won day and emits no extra op` - situacao won, dataGanho `2026-01-20`, op status won wonOn same -> operations `[]`, issues `[]`.
- `accepts a won day equal to today` - `2026-10-02` -> no issue.
- `requires the won day of a Ganha proposta` - dataGanho null -> one error `won_date_required`, sheet `propostas`, row, column `Data de ganho`.
- `does not repeat a parser error on the won day` - dataGanho null plus a pre-existing parsed issue `{ sheet:'propostas', row, column:'Data de ganho', code:'invalid_day' }` -> no new issue.
- `refuses a won day in the future` - `2026-10-03` -> `won_date_in_future`, message contains `03/10/2026` and `02/10/2026`.
- `does not compare the won day with the base date` - dataGanho `2026-01-10`, dataBase `2026-02-01` -> no issue.
- `warns that a won day on a non-Ganha proposta is ignored` - situacao open + dataGanho -> warning `won_date_ignored`; situacao null + dataGanho -> same.
- `appends a lost transition after a Perdida proposta` - row 2 lost with op status open -> operations `[{ op:'transitionSale', saleKey:'propostas:2', to:'lost' }]`.
- `appends a cancelled transition after a Cancelada proposta`.
- `keeps Propostas row order for transitions` - rows 2 cancelled, 3 open, 4 lost -> saleKeys `propostas:2`, `propostas:4` in that order.
- `emits nothing for a Perdida row slice 04 refused` - lost row without an op -> operations `[]`, issues `[]`.
- `throws on a seam violation` - lost row whose op has status `lost`-like mismatch (`'draft'`) -> throws `/planDesfechos seam/`; won row whose op has status `open` -> throws.
- `allows Perdida and Cancelada in a producer-live org` (D2 oracle) - `producerFlowLive: true`, rows lost and cancelled -> two transitions, zero issues.
- `refuses a Ganha proposta in a producer-live org` - one error `producer_flow_live`, column `Situação`, and no `won_date_*` issue even with dataGanho null.

`describe('planDesfechos - Pagamentos')` (Propostas row 2 `P1` won with op of installments 3 x 1000 and `recurring { cycles: 2 }`, row 3 `P2` lost):
- `plans one settlement per valid row with the generated label` - Pagamentos `P1`, `2/3`, `2026-03-01`, repasses true -> `{ op:'settleReceivable', saleKey:'propostas:2', receivableLabel:'2/3', paidOn:'2026-03-01', settlePayables:true }`; counts `{ pagamentos: 1 }`.
- `treats a blank Repasses pagos as false` - repassesPagos null -> `settlePayables: false`.
- `matches the Ref ignoring case and accents and the parcela ignoring spaces and case` - Ref `p1`, parcela ` m1/2 ` -> receivableLabel `M1/2`.
- `refuses a Ref that is not in Propostas` - `P9` -> `unknown_proposta_ref`, column `Ref`, message contains `"P9"`, no op.
- `refuses a payment on a non-Ganha proposta` - `P2` -> `proposta_not_won`, message contains `Perdida`.
- `refuses a parcela the proposta will not have` - `4/3` -> `unknown_parcela`, message lists `1/3, 2/3, 3/3, M1/2, M2/2`.
- `refuses a parcela of a zero-amount installment` - op installments `[1000, 0]`, parcela `2/2` -> `unknown_parcela` listing only `1/1`.
- `explains an indefinite recurring` - op `recurring { cycles: null }`, parcela `M1/12` -> `unknown_parcela` whose message contains `prazo indeterminado`.
- `truncates a long parcela list` - 15 installments, bad parcela -> message ends with `e mais 3.`.
- `refuses the same parcela twice` - two rows `P1`/`1/3` (rows 2 and 4) -> second gets `duplicate_payment` naming `linha 2`; exactly one op.
- `refuses a payment day in the future` - `2026-10-03` -> `payment_in_future`, no op; `2026-10-02` -> op.
- `stays silent when the Ref is duplicated or its proposta was refused` - two Propostas rows with Ref `P1` -> no issue, no op; won row without op -> no issue, no op.
- `stays silent on blank required cells` - ref null, or parcela null -> no new issue, no op.
- `refuses every payment row in a producer-live org` (D2 oracle) - three rows (one valid, one with unknown Ref, one duplicate) -> exactly three `producer_flow_live` errors (column null), zero settleReceivable ops, counts `{}`.
- `puts transitions before settlements` - a lost row and a payment row -> operations kinds `['transitionSale', 'settleReceivable']`.
- `never uses the RefIndex` - the throwing stub is passed in every test (implicit), plus one explicit test.
- `messages never contain a planKey` - across all issues produced in this file, no message matches `/propostas:\d+/` or a uuid regex.

## Commands (run once each, never watch mode)

```bash
pnpm --filter @fxl-sales/api exec vitest run src/domains/import/plan/__tests__/desfechos.test.ts
pnpm --filter @fxl-sales/api exec eslint src/domains/import/plan/desfechos.ts src/domains/import/plan/__tests__/desfechos.test.ts
pnpm --filter @fxl-sales/api type-check
pnpm --filter @fxl-sales/api test
```

If `@fxl-sales/shared-utils/*` subpaths fail to resolve, run `pnpm run build:packages` once at the repo root and retry.

Named locked oracles for this slice: `src/domains/import/plan/__tests__/desfechos.test.ts`, especially `matches buildSaleLedger on the same input`, `allows Perdida and Cancelada in a producer-live org`, `refuses every payment row in a producer-live org`.

## Seam deviations (proposed amendments to SEAM-CONTRACT.md)

1. What slice 04 MUST put on each `createSale` op (slice 04 is planned in parallel; this is the contract between 04 and 05):
   - `planKey` is exactly `propostas:<Excel row>` (contract rule, restated because 05 looks ops up by it).
   - `input.status`: `situacao` `draft` -> `'draft'`; `open` or blank -> `'open'`; `won` -> `'won'`; `lost` -> `'open'`; `cancelled` -> `'open'`. Slice 04 never puts `lost`/`cancelled` (CreateSaleSchema refuses them) and never emits the transition; slice 05 appends `{ op: 'transitionSale', saleKey, to }`.
   - `wonOn`: `status === 'won'` -> the `dataGanho` cell value as parsed (string or null, NOT validated by 04); every other status -> `null`. Slice 04 does not report won-day or producer-live issues; slice 05 owns them (`won_date_required`, `won_date_in_future`, `won_date_ignored`, `producer_flow_live`).
   - `input.installments` and `input.recurring` are exactly what the executor will pass to `createSale` (after ref resolution), because `plannedReceivableLabels(op.input)` derives the parcela labels from them. Zero-amount installments may stay in the draft (they get no label, matching `buildSaleLedger`).
   - Slice 04 may omit the op for a refused proposta row; 05 then stays silent for that row.
2. Receivable labels are NOT exported by slice 04: slice 05 derives them from the draft with `plannedReceivableLabels`, proven equal to `buildSaleLedger` by a parity test. No new export from `plan/propostas.ts` is needed.
3. Ref matching rule for every sheet that cites a proposta (Itens, Profissionais, Parcelas, Pagamentos) and for duplicate-Ref detection in Propostas: `normalizeLabel(ref)` from `cells.ts`. Slice 04 must use the same rule, so `p1` and `P1` are the same Ref everywhere (and a duplicate).
4. Executor (slice 06) notes: `settleReceivable.receivableLabel` is the canonical generated label (exact match against `sales_ops_receivables.label` is safe); `transitionSale` is called with the executor's `now`, so `lost_at` is the commit instant. The re-check of `isProducerFlowLive` before Ganha/settlements stays as contracted; no re-check is needed for transitions (D2 verdict).
5. Slice 07 (AC7) should include one Perdida and one Cancelada row in its producer-live integration test and assert zero `integration_outbox` rows, the end-to-end proof of the D2 verdict.
6. Overview D2 should be amended to read: "Perdida/Cancelada are allowed in every org: slice 05 proved `createSale(open)` + `transitionSale(open -> lost|cancelled)` emits nothing (service.ts emits only on `won` and on leaving `won`)."
