# Part 08b - Period filter (shared)

Part of slice `08-web-lead-form-unico`.

## Context

- Request item 8: every list (Propostas, Prospecção Lista and Quadro, Funil, Follow-ups) filters by period, in `America/Sao_Paulo` civil days.
- `@fxl-sales/shared-utils/sao-paulo-day` exports `saoPauloDayOf(Date)`, `todayInSaoPaulo(now?)`, `isIsoDay(string)`, `SAO_PAULO_TIME_ZONE` (`packages/shared-utils/src/sao-paulo-day.ts` lines 9-50). Web already imports the subpath (`ContactLeadDialog.tsx` line 3).
- The API side (phase 2 contract): `from`/`to` are inclusive ISO civil days interpreted in Sao Paulo; leads filter on `created_at`, follow-ups on `due_on`, propostas on their existing date semantics (created for non-won, `won_at` for won).
- Pickers are `Combobox` from `@/components/ui/combobox` (props `options`, `value`, `onChange`, `aria-label`, `className`); the compact filter-bar size is `comboboxTriggerClass` from `apps/web/src/sales-ops/leads/board-ui.ts` line 22. `<input type="date">` is allowed and numeric raw inputs are banned; use `Input` from `@/components/ui/input`.
- Period state is COMPONENT state in each owner (URL stays the source of truth for workspace and page only), like `leadView` and `salesFilters`.

## Design

`period.ts` (pure, React-free, imports only the sao-paulo-day subpath):

```ts
import { isIsoDay, saoPauloDayOf } from '@fxl-sales/shared-utils/sao-paulo-day';

export type PeriodPreset = 'all' | 'today' | 'last7' | 'last30' | 'next7' | 'month' | 'lastMonth' | 'custom';
export type PeriodSelection = { preset: PeriodPreset; from: string; to: string };   // from/to are only read for 'custom'
export type PeriodRange = { from: string | null; to: string | null };               // inclusive ISO civil days, null = open end
export const PERIOD_ALL: PeriodRange = { from: null, to: null };
export const PERIOD_ALL_SELECTION: PeriodSelection = { preset: 'all', from: '', to: '' };
export const PERIOD_COPY = { label: 'Período', from: 'De', to: 'Até', invalid: 'A data inicial não pode ser depois da final.', badDay: 'Informe uma data válida.' } as const;
export const PERIOD_PRESET_LABEL: Record<PeriodPreset, string> = {
  all: 'Todo o período', today: 'Hoje', last7: 'Últimos 7 dias', last30: 'Últimos 30 dias',
  next7: 'Próximos 7 dias', month: 'Este mês', lastMonth: 'Mês passado', custom: 'Personalizado',
};
export const DEFAULT_PERIOD_PRESETS: readonly PeriodPreset[] = ['all','today','last7','last30','month','lastMonth','custom'];
```

- `addDaysToIsoDay(day: string, delta: number): string`: `const [y,m,d] = day.split('-').map(Number); const t = new Date(Date.UTC(y!, m! - 1, d! + delta)); return t.toISOString().slice(0, 10);` (UTC arithmetic on a civil day; this is NOT a "today" decision, so the `toISOString().slice` rule does not apply, and a comment says so).
- `startOfMonth(day)`: `${day.slice(0, 7)}-01`.
- `endOfMonth(day)`: `const [y,m] = day.split('-').map(Number); return new Date(Date.UTC(y!, m!, 0)).toISOString().slice(0, 10);`
- `periodError(sel: PeriodSelection): string | null`: only for `custom`: a non-blank `from`/`to` that fails `isIsoDay` -> `PERIOD_COPY.badDay`; both set and `from > to` (string compare) -> `PERIOD_COPY.invalid`; otherwise `null`.
- `selectionToRange(sel: PeriodSelection, today: string): PeriodRange`:
  - `all` -> `PERIOD_ALL`; `today` -> `{today,today}`; `last7` -> `{addDays(today,-6), today}`; `last30` -> `{addDays(today,-29), today}`; `next7` -> `{today, addDays(today,6)}`;
  - `month` -> `{startOfMonth(today), endOfMonth(today)}`; `lastMonth` -> `{startOfMonth(prev), endOfMonth(prev)}` where `prev = addDaysToIsoDay(startOfMonth(today), -1)`;
  - `custom` -> if `periodError(sel)` is non-null `PERIOD_ALL` (an invalid range is reported by the control and never applied), else `{from: sel.from || null, to: sel.to || null}`.
  - Implement with an object lookup `PRESET_RANGE: Record<Exclude<PeriodPreset,'custom'>, (today: string) => PeriodRange>`, no switch on strings spread across files.
- `periodQuery(range: PeriodRange): { from?: string; to?: string }`: only the non-null ends.
- `dayInPeriod(day: string, range: PeriodRange): boolean`: `(range.from === null || day >= range.from) && (range.to === null || day <= range.to)`.
- `instantInPeriod(iso: string, range: PeriodRange): boolean`: if both ends null return `true`; `const t = new Date(iso); if (Number.isNaN(t.getTime())) return false; return dayInPeriod(saoPauloDayOf(t), range);`
- `saleReferenceInstant(sale: { status: string; wonAt: string | null; createdAt: string }): string` -> `sale.status === 'won' && sale.wonAt ? sale.wonAt : sale.createdAt` (the contract's "existing date semantics": won by `won_at`, everything else by creation).
- `filterSalesByPeriod<T extends { status: string; wonAt: string | null; createdAt: string }>(sales: readonly T[], range: PeriodRange): T[]`: returns the same array reference semantics are not needed; returns `sales.filter((s) => instantInPeriod(saleReferenceInstant(s), range))`, and `[...sales]` when the range is open.

`PeriodFilter.tsx` (props in, callbacks out, no hook, no fetch):

```tsx
export type PeriodFilterProps = {
  value: PeriodSelection;
  onChange: (next: PeriodSelection) => void;
  presets?: readonly PeriodPreset[];   // default DEFAULT_PERIOD_PRESETS
  'aria-label'?: string;               // default PERIOD_COPY.label
};
```

- Root `<div className="flex flex-wrap items-center gap-2" data-period-filter="">`.
- `<Combobox aria-label={ariaLabel} className={`w-[190px] ${comboboxTriggerClass}`} onChange={(v) => onChange({ preset: v as PeriodPreset, from: value.from, to: value.to })} options={presets.map((p) => ({ value: p, label: PERIOD_PRESET_LABEL[p] }))} searchPlaceholder="Buscar período..." value={value.preset} />` (a Combobox registers its own inline layer; this control is used inside pages, and inside a dialog it would still be safe because `Combobox` calls `useInlineLayer`).
- When `value.preset === 'custom'`: two `<Input type="date" aria-label="De" ...>` and `aria-label="Até"` with `className="h-10 w-[150px] rounded-md border-[#dcdce2] bg-[#fafafb] px-3 text-sm"`, `data-period-from` / `data-period-to`; `onChange` writes `from` / `to` as typed.
- `const error = periodError(value)`; when non-null render `<p className="text-[13px] font-medium text-[#a5341c]" data-period-error="" role="alert">{error}</p>`.
- It renders no id and no raw value other than the dates the operator typed.

## Steps (TDD)

1. Write `period.test.ts` and `period-filter.test.tsx`; run: fail (missing modules).
2. Create `period.ts` as designed. Run `period.test.ts` green.
3. Create `PeriodFilter.tsx`. Run `period-filter.test.tsx` green.
4. Lint and type-check.

## Tests

`apps/web/src/sales-ops/__tests__/period.test.ts` (node):
- `last7 and last30 end on today and span 7 and 30 civil days`: today `2026-10-20` -> `{2026-10-14, 2026-10-20}` and `{2026-09-21, 2026-10-20}`.
- `next7 starts on today`: `{2026-10-20, 2026-10-26}`.
- `month covers the whole calendar month and lastMonth the previous one`: today `2026-10-20` -> `{2026-10-01, 2026-10-31}` and `{2026-09-01, 2026-09-30}`; today `2026-03-05` -> lastMonth `{2026-02-01, 2026-02-28}`; today `2028-03-05` -> lastMonth ends `2028-02-29`; today `2026-01-15` -> lastMonth `{2025-12-01, 2025-12-31}`.
- `custom with from after to is reported and not applied`: `periodError` equals `PERIOD_COPY.invalid`, `selectionToRange` equals `PERIOD_ALL`.
- `custom rejects a day that does not exist`: `from:'2026-02-30'` -> `PERIOD_COPY.badDay`.
- `custom with one end keeps the other open`: `{from:'2026-10-01', to:''}` -> `{from:'2026-10-01', to:null}`.
- `periodQuery drops open ends`.
- `instantInPeriod uses the Sao Paulo day, not the UTC day`: range `{2026-10-20, 2026-10-20}`; instant `2026-10-21T01:30:00.000Z` (22:30 in Sao Paulo on the 20th) is INSIDE; instant `2026-10-20T02:59:00.000Z` (23:59 on the 19th) is OUTSIDE; instant `2026-10-20T03:00:00.000Z` (00:00 on the 20th) is INSIDE.
- `an open range matches any instant, an invalid instant matches nothing once a bound is set`.
- `saleReferenceInstant: won uses wonAt, everything else createdAt; a won sale without wonAt falls back to createdAt`.
- `filterSalesByPeriod keeps a won sale by its won day even when it was created earlier` (created 2026-09-01, won 2026-10-10, range October -> kept; range September -> dropped).

`apps/web/src/sales-ops/__tests__/period-filter.test.tsx` (happy-dom, real `Combobox`; helper style from `leads/__tests__/contact-lead-dialog.test.tsx` lines 30-70):
- `renders a Combobox trigger named Período and no native select`: `container.querySelector('select')` is `null`; `[role="combobox"][aria-label="Período"]` exists and shows `Todo o período`.
- `choosing Personalizado reveals De and Até date inputs`: after picking the option, `input[type="date"][aria-label="De"]` and `[aria-label="Até"]` exist; `onChange` was called with `preset: 'custom'`.
- `typing a reversed range shows the inline error and the control reports it`: render with `{preset:'custom', from:'2026-10-20', to:'2026-10-01'}`; `[data-period-error]` text equals `PERIOD_COPY.invalid`.
- `a preset other than custom shows no date inputs and no error`.
- `offers only the presets it is given`: `presets=['all','next7']` -> exactly two options in the listbox.

## Affected tests search

New files only; no existing file is edited. Searched `apps/web/src` for `period`, `Período` and `todayInSaoPaulo` consumers: none is touched by this slice.

## Commands

- Oracle: `pnpm --filter @fxl-sales/web exec vitest run src/sales-ops/__tests__/period.test.ts src/sales-ops/__tests__/period-filter.test.tsx`
- `pnpm --filter @fxl-sales/web lint` and `pnpm --filter @fxl-sales/web type-check`

## Risks

- `Date.UTC` arithmetic is only used for civil-day math, never for "today". A reviewer might flag `toISOString().slice(0, 10)`; the comment in `addDaysToIsoDay` explains why it is the civil-day arithmetic and not a clock read.
- `PeriodFilter` uses `Combobox`, so a PeriodFilter placed inside a Dialog keeps Escape working (the Combobox registers `useInlineLayer` itself).
