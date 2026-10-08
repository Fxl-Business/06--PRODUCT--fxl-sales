---
id: 01-web-leads-board-parity
milestone: v4.7.0
status: done
depends_on: []
files_modified: [apps/web/src/sales-ops/leads/board-labels.ts, apps/web/src/sales-ops/leads/LeadCard.tsx, apps/web/src/sales-ops/leads/LeadsBoard.tsx, apps/web/src/sales-ops/leads/__tests__/board-labels.test.ts, apps/web/src/sales-ops/leads/__tests__/leads-contact-board.test.tsx]
oracle: [apps/web/src/sales-ops/leads/__tests__/leads-contact-board.test.tsx, apps/web/src/sales-ops/leads/__tests__/board-labels.test.ts, apps/web/src/sales-ops/leads/__tests__/leads-full-edition.test.tsx, apps/web/src/sales-ops/leads/__tests__/lead-board-totals.test.tsx, apps/web/src/sales-ops/leads/__tests__/leads-board-columns.test.tsx, apps/web/src/sales-ops/leads/__tests__/leads-list-view.test.tsx, apps/web/src/sales-ops/leads/__tests__/lead-unassigned-marker.test.tsx, apps/web/src/sales-ops/leads/__tests__/lead-delete.test.tsx, apps/web/src/sales-ops/leads/__tests__/leads-contact-container.test.tsx, apps/web/src/sales-ops/leads/__tests__/lead-card-days-parked.test.tsx, apps/web/src/sales-ops/leads/__tests__/leads-board-dropzones.test.tsx, apps/web/src/sales-ops/leads/__tests__/leads-board-keyboard.test.tsx, apps/web/src/sales-ops/leads/__tests__/lead-conversion.test.tsx, apps/web/src/sales-ops/leads/__tests__/lead-funnel.test.tsx, apps/web/src/sales-ops/leads/__tests__/board-write-surface.test.ts]
acceptance: ["In the leads edition (fieldSet contact) every Quadro column header renders [data-stage-total] with the stage R$ total at 0 decimals, the `N% do total` label and [data-stage-bar] with style width N%, read from the same aggregates as the full edition: the server summary when present, the loaded cards otherwise", "A leads-edition card shows the contact name, then [data-lead-client] with the live cadastro client name, else clientNameSnapshot, else `Sem cliente`, never an id, then the [data-lead-birthday] line when a birthday exists", "A leads-edition card renders no [data-lead-contact] and none of the lead's telefone or email text", "A leads-edition card renders [data-lead-value] with estimatedValueBrl in R$ at 0 decimals (R$ 0 for zero) inside a shrink-0 group that also holds the [data-lead-menu] kebab, while [data-lead-client] carries truncate inside a min-w-0 flex-1 column", "A leads-edition card renders no product chip even when the lead row carries products", "The leads-edition Lista shows its R$ on the Todas as fases chip and on every phase chip, the footer shows TOTAL with [data-list-total], and the header row reads exactly Lead, Fase, Aniversário, Vendedor, Na fase, Valor estimado, Ações with the value th and every value td right-aligned", "The leads-edition Lista Lead cell still shows the name plus [data-row-contact] (telefone · email) and never the client name, the Aniversário column stays, the Vendedor cell stays cellIndex 3, and an empty phase row spans colspan 7", "leadClientLabel(lead, lookups) and NO_CLIENT_LABEL = 'Sem cliente' live in board-labels.ts and share one private resolution ladder with leadCompanyLabel, which still falls back to Sem empresa", "The full edition is unchanged: the full branch of the LeadCard header is textually untouched, the full card still says Sem empresa and has no [data-lead-client] or [data-lead-value], the full Lista headers stay Lead, Fase, Produtos, Vendedor, Na fase, Valor estimado, Ações with colspan 7, and leads-full-edition, lead-board-totals, leads-board-columns and leads-list-view pass with no edit", "apps/web/src/sales-ops/leads/contact-lead.ts, every API file and LeadsBoardContainer.tsx are not modified", "eslint and tsc pass for @fxl-sales/web and no changed file contains the em dash character"]
---

# 01 Leads-edition board parity: R$ like the full edition, Nome & Cliente on the card

Serves AC1, AC2, AC3 and AC4 of `00-OVERVIEW.md`.
Web-only, no API change, no migration, no new dependency.
Runs in wave 1 in parallel with slices 02 and 03 on disjoint files.

## Context (verified at `b3ceab7`)

### The data is already there

- `GET /api/v1/sales-ops/leads/summary` (`apps/api/src/domains/sales-ops/leads/lead-routes.ts:194-202`) has no edition gate and no `requireAdmin`.
- `summarizeLeadStages` (`apps/api/src/domains/sales-ops/leads/lead-service.ts:732-764`) returns `{ stageId, count, estimatedValueBrl }` per stage for whatever edition the caller is in.
- `LeadsBoardContainer.tsx:156` calls `useLeadStageSummary(filters)` for both editions and `LeadsBoardContainer.tsx:268` hands it to the board as `stageSummary` regardless of `fieldSet`.
- `LeadsBoardContainer.tsx:162-165` builds `lookups` from `clients` for both editions, and `SalesOpsApp.tsx:2347-2348` passes `persistedBootstrap.clients`, so a leads-edition card can resolve the live client name.
- `LeadsBoard.tsx:334-372` already computes `aggregates` (`resolveStageAggregates`), `allStages`, `totalGeral`, `shareByStage`, `listTotalCents` and `fmtBrl0` unconditionally; only the rendering is gated.
- Conclusion: the whole slice is removing `!contact` gates and reshaping the leads-edition card header.

### What hides the R$ today (`apps/web/src/sales-ops/leads/LeadsBoard.tsx`)

- `:301-303` comment plus `const contact = fieldSet === 'contact';` ("no R$ figure anywhere").
- `:651-669` Quadro column header: `{!contact ? (<> [data-stage-total] + PERCENT_OF_TOTAL + [data-stage-bar] </>) : null}`.
- `:763` `Todas as fases` chip: `{!contact ? <span className="sales-ops-num">{fmtBrl0(totalGeral)}</span> : null}`.
- `:784-788` each phase chip: `{!contact ? (<span className="sales-ops-num opacity-75">...</span>) : null}`.
- `:805-813` contact `<thead>` row: six `th` from `CONTACT_LIST_HEADERS` (Lead, Fase, Aniversário, Vendedor, Na fase, Ações), no value column.
- `:814-823` full `<thead>` row: seven `th` from `LIST_HEADERS`, value th is `className="px-4 py-2.5 text-right"`.
- `:838-849` Lead cell: contact shows `leadContactLine(row)` in `[data-row-contact]`, full shows `leadCompanyLabel`. Stays as is.
- `:863-871` third cell: contact `[data-row-birthday]`, full produtos. Stays as is.
- `:894-900` value cell: `{!contact ? (<td className="px-4 py-3 text-right">...) : null}`.
- `:948` empty-phase row: `colSpan={contact ? 6 : 7}`.
- `:958-965` footer: `{!contact ? (<span> TOTAL_LABEL + [data-list-total] </span>) : null}`.

### The card (`apps/web/src/sales-ops/leads/LeadCard.tsx`)

- `:10` already imports `formatMoneyBrl`; `:11-19` imports from `./board-labels`; `:38` imports `CONTACT_LEAD_COPY, leadBirthdayLabel, leadContactLine` from `./contact-lead`.
- `:80` prop doc: "'contact' in the leads edition: contact data instead of empresa, valor and produtos."
- `:171-172` `contact` and `birthday` (birthday is computed only in the contact edition).
- `:236-250` contact header branch: name, `[data-lead-contact]` with `leadContactLine`, optional `[data-lead-birthday]`, then `{menu}` directly in the row (no value).
- `:251-267` full header branch: name + `leadCompanyLabel` on the left; a `flex shrink-0 items-start gap-0.5` group with the value span (`sales-ops-num shrink-0 text-[14px] font-bold text-[#201f24]`, `formatMoneyBrl(..., { minimumFractionDigits: 0, maximumFractionDigits: 0 })`) and `{menu}` on the right.
- `:269` product chips already gated on `!contact`; nothing to change there.
- The DragOverlay (`LeadsBoard.tsx:738-745`) renders the same `LeadCard` with `fieldSet`, so the lifted card follows automatically.

### Labels (`apps/web/src/sales-ops/leads/board-labels.ts`)

- `:34-37` private `present()`.
- `:44-47` `leadCompanyLabel`: live `clientNameById` name, then `clientNameSnapshot`, then `'Sem empresa'`.
- `:111-119` `LIST_HEADERS.value = 'Valor estimado'`.

### Ownership boundary

- `apps/web/src/sales-ops/leads/contact-lead.ts` (holds `CONTACT_LIST_HEADERS`, `leadContactLine`, `CONTACT_LEAD_COPY`) is OWNED BY SLICE 02. This slice reads it and never edits it.
- The new leads-edition label lives in `board-labels.ts`; the new Lista header reuses `LIST_HEADERS.value`.
- `leads-full-edition.test.tsx` holds a `LeadDialog` test that slice 02 may touch, so this slice does NOT edit that file; its new full-edition guards go into `leads-contact-board.test.tsx` instead, keeping the two slices' files disjoint.

## Design

### 1. `board-labels.ts` (one shared ladder, two fallbacks)

Replace the body of `leadCompanyLabel` (`:39-47`) with a private ladder plus two exported wrappers, in this order, right where `leadCompanyLabel` is today:

```ts
/**
 * The client name a lead resolves to: the cadastro client's live name, else the
 * free-text snapshot the API always writes, else `undefined`. Never the id.
 */
function resolvedClientName(lead: SalesOpsLead, lookups: LabelLookups): string | undefined {
  const resolved = lead.clientId ? lookups.clientNameById.get(lead.clientId) : undefined;
  return present(resolved) ?? present(lead.clientNameSnapshot);
}

/**
 * The cadastro client's name, else the free-text snapshot the API always writes,
 * else `Sem empresa`. A `clientId` the cache does not know degrades to the free
 * text - never to the id.
 */
export function leadCompanyLabel(lead: SalesOpsLead, lookups: LabelLookups): string {
  return resolvedClientName(lead, lookups) ?? 'Sem empresa';
}

/** The leads edition's fallback when a lead has no Cliente (the full edition says `Sem empresa`). */
export const NO_CLIENT_LABEL = 'Sem cliente';

/**
 * The Cliente line of a leads-edition card: the same ladder as
 * `leadCompanyLabel`, with the leads edition's own fallback. Never an id.
 */
export function leadClientLabel(lead: SalesOpsLead, lookups: LabelLookups): string {
  return resolvedClientName(lead, lookups) ?? NO_CLIENT_LABEL;
}
```

`leadCompanyLabel` keeps its exact behaviour (the existing `board-labels.test.ts` cases prove it).
Nothing else in the file changes.

### 2. `LeadCard.tsx` (leads-edition header only)

Imports:

- `:11-19`: add `leadClientLabel` to the `./board-labels` import, placed before `leadCompanyLabel` (alphabetical, matching the existing order).
- `:38`: becomes `import { CONTACT_LEAD_COPY, leadBirthdayLabel } from './contact-lead';` (`leadContactLine` is no longer used here; leaving it would fail `no-unused-vars`).

Prop doc `:80` becomes:

```ts
  /**
   * 'contact' in the leads edition: the Cliente (`Sem cliente` when none) and the
   * birthday under the name, the value beside the menu, and no produtos.
   */
```

Replace ONLY the contact branch `:236-250` with this exact JSX (the full branch `:251-267` stays byte-for-byte identical):

```tsx
      {contact ? (
        <div className="flex items-start justify-between gap-2">
          <div className="flex min-w-0 flex-1 flex-col gap-0.5">
            <span className="text-[14px] font-semibold text-[#201f24]">{lead.contactName}</span>
            <span className="truncate text-[12.5px] text-[#8b8b92]" data-lead-client>
              {leadClientLabel(lead, lookups)}
            </span>
            {birthday !== null ? (
              <span className="text-[12px] text-[#8b8b92]" data-lead-birthday>
                {`${CONTACT_LEAD_COPY.birthdayPrefix} ${birthday}`}
              </span>
            ) : null}
          </div>
          <div className="flex shrink-0 items-start gap-0.5">
            <span
              className="sales-ops-num shrink-0 text-[14px] font-bold text-[#201f24]"
              data-lead-value
            >
              {formatMoneyBrl(lead.estimatedValueBrl, {
                minimumFractionDigits: 0,
                maximumFractionDigits: 0,
              })}
            </span>
            {menu}
          </div>
        </div>
      ) : (
```

Why this shape:

- The left column keeps the existing contact classes `flex min-w-0 flex-1 flex-col gap-0.5`, so it takes the free width and may shrink below its content; the client line is `truncate` (single line, ellipsis), so a long client name can never push the value or the kebab out of the card.
- The right group is the full card's own `flex shrink-0 items-start gap-0.5` with the full card's value span classes, so the value reads exactly like the full card and never shrinks.
- The name line keeps its current classes (wraps like both cards do today); the birthday line is unchanged.
- `data-lead-client` and `data-lead-value` are new hooks on the leads-edition branch only.
  The full branch deliberately gets no new hook, so AC4 is provable by the diff alone (no line inside the `) : (` full branch changes).
- No product chips: `:269` already gates them on `!contact`.
- The `telefone · email` line leaves the card; `leadContactLine` stays in use by the Lista.

### 3. `LeadsBoard.tsx` (drop the R$ gates, add the Lista value column)

1. `:301-303` comment becomes:
   ```ts
     // The leads edition shows contact data in the Lista and the Cliente on the
     // card; every R$ figure renders in both editions. An org with no active etapa
     // gets an empty-state instead of an empty scroller.
   ```
   `const contact` and `const noStages` stay.
2. `:651-669` Quadro column header: remove the `{!contact ? (<> ... </>) : null}` wrapper and keep its two children (the `mt-2 flex items-baseline justify-between gap-2` row with `[data-stage-total]` and `PERCENT_OF_TOTAL(share)`, and the `mt-2 ${proportionTrackClass}` track with `[data-stage-bar]`) as direct children of `<header className={columnHeaderCardClass}>`, unchanged in classes, attributes and expressions.
3. `:763` `Todas as fases` chip: render `<span className="sales-ops-num">{fmtBrl0(totalGeral)}</span>` unconditionally.
4. `:784-788` phase chip: render `<span className="sales-ops-num opacity-75">{fmtBrl0(stageAggregate(aggregates, stage.id).totalBrl)}</span>` unconditionally.
5. `:805-813` contact `<thead>` row: insert `<th className="px-4 py-2.5 text-right">{LIST_HEADERS.value}</th>` between the `CONTACT_LIST_HEADERS.inStage` th (`:811`) and the `CONTACT_LIST_HEADERS.actions` th (`:812`).
   Keep both `<tr>` branches; the full row `:815-823` is not touched.
6. `:894-900` value cell: render `<td className="px-4 py-3 text-right"><span className="sales-ops-num font-bold">{fmtBrl0(row.estimatedValueBrl)}</span></td>` unconditionally, in the same position (after `Na fase`, before the actions td).
7. `:948` empty-phase row: `colSpan={7}` (both editions now have seven columns).
8. `:958-965` footer: render the `<span className="flex items-center gap-2">` with `TOTAL_LABEL` and `[data-list-total]` unconditionally.

Resulting leads-edition Lista columns: Lead (name + `[data-row-contact]`), Fase, Aniversário, Vendedor, Na fase, Valor estimado, Ações.
The Vendedor cell stays at `cellIndex` 3, which `lead-unassigned-marker.test.tsx:285` pins in both layouts.

For the full edition every one of these edits emits identical DOM: a removed `!contact ?` wrapper whose condition was always true, a fragment that renders no node, and `colSpan` 7 that was already 7.
No import changes in `LeadsBoard.tsx` (`LIST_HEADERS`, `PERCENT_OF_TOTAL`, `TOTAL_LABEL`, `fmtBrl0`, `proportionTrackClass` are already imported or local; `CONTACT_LIST_HEADERS` and `leadContactLine` stay used).

### pt-BR strings

- New: `Sem cliente` (`NO_CLIENT_LABEL`), already the propostas wording in `SalesOpsApp.tsx:9459`.
- Reused: `Valor estimado` (`LIST_HEADERS.value`), `TOTAL` (`TOTAL_LABEL`), `N% do total` (`PERCENT_OF_TOTAL`), `Aniversário` prefix (`CONTACT_LEAD_COPY.birthdayPrefix`).

## Red first (write these BEFORE touching product code, run them, see them fail)

Run with `pnpm --filter @fxl-sales/web exec vitest run src/sales-ops/leads/__tests__/leads-contact-board.test.tsx src/sales-ops/leads/__tests__/board-labels.test.ts` (run once, never watch).
In a fresh worktree run `pnpm install --frozen-lockfile` and `pnpm run build:packages` first.

### `board-labels.test.ts` (additions only; the existing `leadCompanyLabel` cases stay untouched)

Import `NO_CLIENT_LABEL` and `leadClientLabel` beside the existing imports, then add `describe('leadClientLabel', ...)` reusing the file's `CLIENT_ID`, `UNKNOWN_ID`, `lookups` and `lead()`:

- `prefers the cadastro client name over the snapshot`: `lead({ clientId: CLIENT_ID, clientNameSnapshot: 'Acme velho nome' })` gives `'Acme Indústria'`.
- `falls back to the snapshot, then to Sem cliente, and never to the id`: `{ clientId: UNKNOWN_ID, clientNameSnapshot: 'Beta Serviços' }` gives `'Beta Serviços'`; `{ clientId: UNKNOWN_ID, clientNameSnapshot: '   ' }` gives `'Sem cliente'` and does not contain `UNKNOWN_ID`; `lead()` (no id, empty snapshot) gives `'Sem cliente'`.
- `spells the fallback Sem cliente`: `expect(NO_CLIENT_LABEL).toBe('Sem cliente')` (the literal, so a drifted constant cannot pass by comparing to itself).
- `agrees with leadCompanyLabel whenever a name resolves`: for the resolved and the unresolved-with-snapshot leads above, `leadClientLabel(row, lookups)` equals `leadCompanyLabel(row, lookups)`.

Red reason at `b3ceab7`: `leadClientLabel` is not exported (TypeError on call) and `NO_CLIENT_LABEL` is undefined.

### `leads-contact-board.test.tsx` (deliberate edits; the old file pinned "no R$ in the leads edition", which the human reversed)

Fixture changes:

- Header comment `:11-14` becomes: "The leads edition's board (`fieldSet="contact"`): Nome & Cliente on the card, contact data in the Lista, the same R$ figures as the full edition, and the zero-etapas empty-state."
- Add `const CLIENT_ID = 'bbbbbbbb-0000-4000-8000-000000000001';` and `const UNKNOWN_CLIENT_ID = 'bbbbbbbb-0000-4000-8000-0000000000ff';`.
- `LOOKUPS` becomes `buildLabelLookups({ clients: [{ id: CLIENT_ID, name: 'Construbom Matriz' } as SalesOpsClient], people: [], products: [] })` (import `SalesOpsClient` from `'../../types'`).
- Add `const brl0 = (cents: number) => formatMoneyBrl(cents, { minimumFractionDigits: 0, maximumFractionDigits: 0 });` (import `formatMoneyBrl` from `'../../calculations'`), the same helper the full-edition oracles use.
- `LEADS`: Ana gets `clientId: CLIENT_ID, clientNameSnapshot: 'Construbom (nome antigo)', estimatedValueBrl: 150_000`; Bruno keeps `clientId: null, clientNameSnapshot: '', estimatedValueBrl: 0`; Caio gets `clientNameSnapshot: 'Obra Caio Ltda', estimatedValueBrl: 300_000`.
  Loaded totals: Primeiro contato 150_000 (2 leads), Retorno 300_000 (1 lead), all 450_000; shares 33% and 67%.
- Add `const SUMMARY: LeadStageSummary = { stages: [{ stageId: PRIMEIRO_ID, count: 12, estimatedValueBrl: 9_000_000 }, { stageId: RETORNO_ID, count: 1, estimatedValueBrl: 300_000 }] };` (import the type from `'../types'`).
  Summary totals: 9_300_000 and 13 leads; shares round to 97% and 3%.
- Add helper `const column = (id: string) => required(`[data-stage-column="${id}"]`);`.
- Every `renders no raw id` loop also checks `CLIENT_ID`.

`describe('contact board, Quadro')`:

- REPLACE `shows phone, email and birthday on the card` with `shows the name, the Cliente and the birthday on the card, and no contact line`: Ana's card has `[data-lead-client]` text `'Construbom Matriz'` (live name beats the snapshot), `[data-lead-birthday]` text `'Aniversário 28/02/1990'`, `[data-lead-contact]` is null, and the card text contains neither `'(11) 98888-7777'` nor `'ana@construbom.com.br'`.
- REPLACE `says Sem contato and shows no birthday for a lead without contact data` with `falls back to the snapshot, then to Sem cliente`: Caio's `[data-lead-client]` is `'Obra Caio Ltda'`; Bruno's is `'Sem cliente'` and Bruno's card has no `[data-lead-birthday]`; the board text never contains `'Sem empresa'` nor `'Sem contato'`.
- NEW `shows the value beside the menu, formatted like the full card`: render with `onDeleteLead: vi.fn()`; Ana's `[data-lead-value]` is `brl0(150_000)`, Bruno's is `brl0(0)`; for Ana, `value.parentElement` contains `[data-lead-menu]` and its `className` contains `shrink-0`; `[data-lead-client]` `className` contains `truncate` and its `parentElement.className` contains `min-w-0` and `flex-1`.
- REPLACE `shows no money, share or empresa anywhere` with `shows the stage R$ total, % do total and the bar from the loaded cards`: `column(PRIMEIRO_ID)` `[data-stage-total]` is `brl0(150_000)` and its text contains `'33% do total'`; `column(RETORNO_ID)` `[data-stage-total]` is `brl0(300_000)` and contains `'67% do total'`; `[data-stage-bar]` `style.width` is `'33%'` and `'67%'`; the `[data-stage-count]` list is still `['2', '1']`.
- NEW `takes the column total, share and bar from the server summary`: `renderBoard({ stageSummary: SUMMARY })`; counts `['12', '1']`; `column(PRIMEIRO_ID)` total `brl0(9_000_000)`, text contains `'97% do total'`, bar width `'97%'`; `column(RETORNO_ID)` total `brl0(300_000)`, text contains `'3% do total'`, bar width `'3%'`.
- `renders no raw id` and `enables Novo lead ...`: unchanged except the extra `CLIENT_ID`.

`describe('contact board, Lista')`:

- REPLACE `uses the contact headers` with `uses the contact headers plus Valor estimado before Ações`: headers equal `['Lead', 'Fase', 'Aniversário', 'Vendedor', 'Na fase', 'Valor estimado', 'Ações']`; the `Valor estimado` th `className` contains `text-right`; the list text does not contain `'Produtos'`.
- EDIT `shows the contact line and the birthday per row`: all existing `[data-row-contact]` / `[data-row-birthday]` assertions stay; `toHaveLength(6)` becomes `toHaveLength(7)`; add that Ana's first `td` text does not contain `'Construbom Matriz'` (the Lista keeps the contact line, not the client).
- NEW `shows the estimated value right-aligned before the actions`: Ana's row `td` index 5 text is `brl0(150_000)` and its `className` contains `text-right`; Bruno's index 5 is `brl0(0)`; Caio's index 5 is `brl0(300_000)`.
- REPLACE `phase chips keep their counts and lose their R$` with `phase chips keep their counts and carry their R$`: three chips, each with `[data-phase-count]`; the `[data-phase-chip=""]` chip text contains `brl0(450_000)` and its count is `'3'`; the Primeiro contato chip contains `brl0(150_000)`; the Retorno chip contains `brl0(300_000)`.
- REPLACE `the footer counts leads and shows no total` with `the footer counts leads and shows the TOTAL`: the list text contains `'Todas as fases · 3 leads'` and `'TOTAL'`; `[data-list-total]` is `brl0(450_000)`; after clicking `[data-phase-chip="${RETORNO_ID}"]` the list text contains `'Retorno · 1 lead'` and `[data-list-total]` is `brl0(300_000)`.
- NEW `takes the chips and the footer from the server summary`: `renderBoard({ stageSummary: SUMMARY })`, switch to Lista; the all chip contains `brl0(9_300_000)` with count `'13'`; the Primeiro contato chip contains `brl0(9_000_000)` with count `'12'`; `[data-list-total]` is `brl0(9_300_000)`; the list text contains `'Todas as fases · 13 leads'`; the table still lists 3 `[data-list-row]`.
- EDIT `an empty phase spans the six contact columns` to `an empty phase spans the seven contact columns`: colspan `'7'`.
- `renders no raw id`: unchanged except the extra `CLIENT_ID`.

`describe('contact board with no active etapa')`: unchanged.

`describe('contact LeadCard keeps the drag guard')`: unchanged.

NEW `describe('contact LeadCard header')` (standalone `LeadCard fieldSet="contact"`, no board):

- `never renders an unresolvable client id`: lead with `clientId: UNKNOWN_CLIENT_ID, clientNameSnapshot: ''` shows `[data-lead-client]` `'Sem cliente'` and the card text does not contain `UNKNOWN_CLIENT_ID`.
- `shows no product chip even when the row carries products`: lead with `products: [{ productId: null, productNameSnapshot: 'Telha Colonial' }]`; the card text does not contain `'Telha Colonial'`.

NEW `describe('the full edition keeps its own card and Lista')` (AC4 guards; green before AND after, they pin what must not move):

- `the full card keeps Sem empresa and gets no leads-edition hook`: standalone `LeadCard` with `fieldSet` omitted and Bruno's row (no client, value 0); card text contains `'Sem empresa'` and `brl0(0)`, does not contain `'Sem cliente'`; `[data-lead-client]`, `[data-lead-value]`, `[data-lead-contact]` and `[data-lead-birthday]` are all null.
- `the full Lista keeps Produtos, its seven headers and the company line`: `renderBoard({ fieldSet: 'full' })`, switch to Lista; headers equal `['Lead', 'Fase', 'Produtos', 'Vendedor', 'Na fase', 'Valor estimado', 'Ações']`; `[data-row-contact]` and `[data-row-birthday]` are null; Ana's first `td` contains `'Construbom Matriz'`.
- `the full empty phase still spans seven columns`: `renderBoard({ fieldSet: 'full', leads: [] })`, Lista, colspan `'7'`.

Expected red at `b3ceab7`: every REPLACE/NEW case under the two contact describes and the `contact LeadCard header` describe fails (no `[data-lead-client]`, no R$, six columns, `[data-lead-contact]` still present); the full-edition describe passes.
Record the red run's failing test names in the exec result.

## Implementation order

1. Red tests above, run, confirm the expected failures.
2. `board-labels.ts` (section 1); `board-labels.test.ts` goes green.
3. `LeadCard.tsx` (section 2).
4. `LeadsBoard.tsx` (section 3); `leads-contact-board.test.tsx` goes green.
5. Run the whole oracle list, then `pnpm --filter @fxl-sales/web lint` and `pnpm --filter @fxl-sales/web type-check`.
6. Visual check in a real browser (below).

## Pre-existing tests

Must stay green with NO edit:

- `leads-full-edition.test.tsx`: omitted vs `full` markup identity, money figures, share bar, empresa, product chips, Lista headers, `TOTAL`, `LeadDialog`.
- `lead-board-totals.test.tsx`: summary-driven totals, chips, footer, Funil, load-more (full edition).
- `leads-board-columns.test.tsx`: full column totals, bars, chip `aria-pressed`.
- `leads-list-view.test.tsx`: full Lista chips, footer, filtering.
- `lead-unassigned-marker.test.tsx`: both layouts; the contact card footer is untouched and the Lista Vendedor cell stays `cellIndex` 3.
- `lead-delete.test.tsx`: the contact card still carries `[data-lead-menu]` (`:372-375`); the menu now sits in the value group, which the test does not constrain.
- `leads-contact-container.test.tsx`: mocks `LeadsBoard` and asserts props only (`fieldSet`, `stageSummary`), unaffected.
- `lead-card-days-parked.test.tsx`, `leads-board-dropzones.test.tsx`, `leads-board-keyboard.test.tsx`, `lead-conversion.test.tsx`, `lead-funnel.test.tsx`: full edition or Funil, unaffected.
- `board-write-surface.test.ts`: scans `board-labels.ts`, `LeadCard.tsx`, `LeadsBoard.tsx`; this slice adds no transition call, no write path and no `kind` spelling, so it stays green.

Deliberately edited:

- `leads-contact-board.test.tsx`: it pinned the old product decision ("no R$ in the leads edition", contact line on the card, six Lista columns), which the human reversed on 2026-10-08.
- `board-labels.test.ts`: additions for the new helper only.

Not touched (owned elsewhere): `contact-lead.test.ts`, `contact-lead-dialog.test.tsx`, `lead-dialog.test.tsx` (slice 02).

## Visual check (required, real browser, throwaway harness)

happy-dom cannot see layout, so the card and header layout is checked in a real browser with the standalone harness (see memory note "Standalone component harness").

- Create `apps/web/repro.html` (`<script type="module" src="/src/repro-main.tsx">`) and `apps/web/src/repro-main.tsx` that imports `./index.css` and renders two `LeadsBoard`s one above the other: `fieldSet="contact"` and `fieldSet="full"`, three `normal` stages, with fixtures that include a lead whose client name is `Construtora e Incorporadora Horizonte Azul Empreendimentos Imobiliários Ltda`, a lead with no client, a lead with a birthday, values from `0` to `125_000_000` cents (R$ 1.250.000), `onDeleteLead` set so the kebab renders, and a `stageSummary` whose largest column total is at least R$ 12.500.000.
- Start `pnpm exec vite --port 8099 --strictPort` from `apps/web` as a background process, record its PID and process group, and open `http://localhost:8099/repro.html`.
- Check at a desktop width and at 390px: the long client name ellipsizes on one line; the value and the kebab stay fully inside the card and aligned to the top-right exactly like the full card; the column header shows the R$ total and `% do total` on one line with the bar below, matching the full board; the Lista value column is right-aligned and the table scrolls inside its card without a page-level horizontal scroll.
- Drag one card to see the DragOverlay copy match the card.
- Fix any visual defect found in the changed markup before finishing; report anything off outside this slice's markup in the exec result instead of fixing it here.
- Afterwards kill the vite process group by its exact id (`kill -- -<pgid>`), delete both harness files, and confirm `git status` shows neither. They are never committed and are not in `files_modified`.
- If no browser tool is available, say so in the exec result; the oracles remain the gate.

## Constraints

- No em dash character anywhere (code, comments, tests, this slice's notes); use a plain hyphen.
- Match the surrounding style: two-space indent, single quotes, trailing commas, existing Tailwind class order, `data-*` hooks as bare attributes.
- No new native `<select>`, `<option>`, `<datalist>` or raw `<input type="number">`.
- Never render a raw id; every client label goes through `leadClientLabel` / `leadCompanyLabel`.
- Do not edit `contact-lead.ts`, `LeadsBoardContainer.tsx`, `SalesOpsApp.tsx` (its `BOARD-WRITE-FENCE` sentinels stay untouched), any API file, or `leads-full-edition.test.tsx`.
- Run-once commands only; kill every process you start by exact PID or process group, never by name.

## Out of scope

- The Funil (already shows R$ in both editions).
- Product chips on the leads-edition card (the leads edition stores no produtos).
- Showing the client in the Lista `Lead` cell (human decision: only the card swaps).
- The client picker copy (slice 02) and the import recognition (slice 03).
- Any API, schema or summary change.
- Docs: `CLAUDE.md` and `nexo/knowledge/reference/kanban-de-leads.md` are updated in Capture (AC13), not in this slice.

## Capture handoff (AC13, for the Capture step, not for the executor)

These sentences become false when this slice lands:

- `nexo/knowledge/reference/kanban-de-leads.md:84`: "The contact card and the Lista show phone, email and the birthday ... and never empresa, produtos, valor, any R$ total, `% do total`, the proportion bar or the footer `TOTAL`."
  New truth: the leads-edition card shows the name, the Cliente (`leadClientLabel`, fallback `Sem cliente`), the birthday and the value beside the kebab; the Lista keeps name + `telefone · email` and the `Aniversário` column and gains a `Valor estimado` column; the column header, the Lista chips and the footer show R$ exactly like the full edition.
- `nexo/knowledge/reference/kanban-de-leads.md:96`, last sentence: "the Quadro/Lista value block stays gated on `!contact`, so the card and Lista in the leads edition still hide value - the Funil is that edition's financial surface." No longer true.
- `CLAUDE.md` "Edição Leads": add a bullet that the leads-edition board shows R$ like the full edition and the card shows Nome & Cliente (`leadClientLabel`, `Sem cliente`), with oracle `leads-contact-board.test.tsx`.
