import * as React from 'react';
import { formatMoneyBrl } from '../calculations';
import {
  FUNNEL_EMPTY,
  FUNNEL_LOST_ASIDE,
  FUNNEL_METRIC_LABEL,
  FUNNEL_SHAPE_LABEL,
  FUNNEL_TOTAL_LABEL,
  PERCENT_OF_TOP,
  PERCENT_OF_TOTAL,
  TOTAL_LABEL,
  leadsCountLabel,
  type FunnelMetric,
  type FunnelShape,
} from './board-labels';
import {
  mutedStateClass,
  segmentedButtonActiveClass,
  segmentedButtonClass,
  segmentedContainerClass,
  stageColors,
} from './board-ui';
import {
  buildCumulativeFunnel,
  buildLeadFunnel,
  type LeadStageAggregates,
} from './calculations';
import type { SalesOpsLeadStage } from './types';

/**
 * The sales funnel, in two shapes a switch chooses between. ACUMULADO (the
 * default) is the true funnel: `buildCumulativeFunnel` counts a lead into every
 * earlier stage, so the bars taper monotonically from a full-width top and the
 * share reads as retention from the top (`% do topo`); the `lost` stage is set
 * apart below, never inside the taper. COMPOSIÇÃO is the older view:
 * `buildLeadFunnel` sizes each stage by its own magnitude, the share is of the sum
 * (`% do total`), and every stage - lost included - is an ordinary row. A second
 * switch sizes either shape by FATURAMENTO (R$) or VOLUME (lead count); the two
 * metrics are never shown mixed in one bar. The footer grand totals cover every
 * lead (lost included) and stay the same across both shapes. Purely presentational
 * over the board's per-stage aggregates (`resolveStageAggregates`): the server
 * summary when it has arrived, the loaded cards until then, so the Funil always
 * agrees with the column badges.
 */
export type LeadsFunnelViewProps = {
  aggregates: LeadStageAggregates;
  stages: SalesOpsLeadStage[];
};

const fmtBrl0 = (cents: number) =>
  formatMoneyBrl(cents, { minimumFractionDigits: 0, maximumFractionDigits: 0 });

type FunnelLikeRow = { count: number; totalBrl: number };

export function LeadsFunnelView({ aggregates, stages }: LeadsFunnelViewProps) {
  const [metric, setMetric] = React.useState<FunnelMetric>('value');
  const [shape, setShape] = React.useState<FunnelShape>('cumulative');
  const composition = React.useMemo(() => buildLeadFunnel(aggregates, stages), [aggregates, stages]);
  const cumulative = React.useMemo(() => buildCumulativeFunnel(aggregates, stages), [aggregates, stages]);
  // Composition rows cover every active stage (lost included), so they key every colour.
  const colors = React.useMemo(
    () => stageColors(composition.rows.map((row) => ({ id: row.stageId, kind: row.kind }))),
    [composition.rows],
  );

  if (composition.rows.length === 0) {
    return <p className={mutedStateClass}>{FUNNEL_EMPTY}</p>;
  }

  const magnitudeOf = (row: FunnelLikeRow) => (metric === 'value' ? row.totalBrl : row.count);
  const primaryText = (row: FunnelLikeRow) =>
    metric === 'value' ? fmtBrl0(row.totalBrl) : leadsCountLabel(row.count);
  const secondaryText = (row: FunnelLikeRow) =>
    metric === 'value' ? leadsCountLabel(row.count) : fmtBrl0(row.totalBrl);

  const isCumulative = shape === 'cumulative';
  const rows = isCumulative ? cumulative.rows : composition.rows;
  const maxMagnitude = Math.max(0, ...rows.map(magnitudeOf));
  // Cumulative share is retention from the top (= the widest bar); composition
  // share is the stage's slice of the whole sum.
  const shareDenom = isCumulative
    ? maxMagnitude
    : metric === 'value'
      ? composition.totalBrl
      : composition.totalCount;
  const shareLabel = isCumulative ? PERCENT_OF_TOP : PERCENT_OF_TOTAL;
  const lostAside = isCumulative ? cumulative.lost : null;

  return (
    <div className="flex flex-col gap-4" data-leads-funnel="true" data-funnel-metric={metric} data-funnel-shape={shape}>
      <div className="flex flex-wrap items-center gap-2">
        <div
          aria-label="Forma do funil"
          className={segmentedContainerClass}
          data-funnel-shape-toggle="true"
          role="group"
        >
          {(['cumulative', 'composition'] as const).map((option) => (
            <button
              aria-pressed={shape === option}
              className={`${segmentedButtonClass}${shape === option ? ' ' + segmentedButtonActiveClass : ''}`}
              data-funnel-shape-option={option}
              key={option}
              onClick={() => setShape(option)}
              type="button"
            >
              {FUNNEL_SHAPE_LABEL[option]}
            </button>
          ))}
        </div>
        <div
          aria-label="Métrica do funil"
          className={segmentedContainerClass}
          data-funnel-metric-toggle="true"
          role="group"
        >
          {(['value', 'volume'] as const).map((option) => (
            <button
              aria-pressed={metric === option}
              className={`${segmentedButtonClass}${metric === option ? ' ' + segmentedButtonActiveClass : ''}`}
              data-funnel-metric-option={option}
              key={option}
              onClick={() => setMetric(option)}
              type="button"
            >
              {FUNNEL_METRIC_LABEL[option]}
            </button>
          ))}
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        {rows.map((row) => {
          const color = colors.get(row.stageId);
          const magnitude = magnitudeOf(row);
          const widthPct = maxMagnitude > 0 ? Math.round((magnitude / maxMagnitude) * 100) : 0;
          const sharePct = shareDenom > 0 ? Math.round((magnitude / shareDenom) * 100) : 0;
          return (
            <div className="flex flex-col gap-1.5" data-funnel-row={row.stageId} key={row.stageId}>
              <div className="flex items-baseline justify-between gap-3">
                <span className="flex items-center gap-2">
                  <span
                    className="h-[9px] w-[9px] shrink-0 rounded-full"
                    style={{ backgroundColor: color?.dot }}
                  />
                  <span className="text-[13.5px] font-bold text-[#201f24]">{row.name}</span>
                </span>
                <span className="flex items-baseline gap-2 whitespace-nowrap">
                  <span className="sales-ops-num text-[15px] font-bold text-[#201f24]" data-funnel-primary>
                    {primaryText(row)}
                  </span>
                  <span className="text-[11.5px] text-[#9b9ba3]" data-funnel-secondary>
                    · {secondaryText(row)}
                  </span>
                  <span className="text-[11.5px] font-semibold text-[#9b9ba3]" data-funnel-share>
                    {shareLabel(sharePct)}
                  </span>
                </span>
              </div>
              {/* The funnel itself: a centred bar whose width tapers with the metric. */}
              <div className="flex h-8 items-center justify-center rounded-[10px] bg-[#f4f4f6]">
                <div
                  className="h-full rounded-[10px] transition-[width]"
                  data-funnel-bar
                  style={{ width: `${widthPct}%`, backgroundColor: color?.dot }}
                />
              </div>
            </div>
          );
        })}
      </div>

      {lostAside ? (
        <div
          className="flex items-baseline justify-between gap-3 rounded-[10px] border border-dashed border-[#e8e8ec] bg-[#fbfbfc] px-[14px] py-2.5"
          data-funnel-lost
        >
          <span className="flex items-center gap-2">
            <span
              className="h-[9px] w-[9px] shrink-0 rounded-full"
              style={{ backgroundColor: colors.get(lostAside.stageId)?.dot }}
            />
            <span className="text-[13.5px] font-bold text-[#201f24]">{lostAside.name}</span>
            <span className="text-[11px] font-semibold uppercase tracking-[0.05em] text-[#b0b0b8]">
              {FUNNEL_LOST_ASIDE}
            </span>
          </span>
          <span className="flex items-baseline gap-2 whitespace-nowrap">
            <span className="sales-ops-num text-[15px] font-bold text-[#201f24]" data-funnel-lost-primary>
              {primaryText(lostAside)}
            </span>
            <span className="text-[11.5px] text-[#9b9ba3]" data-funnel-lost-secondary>
              · {secondaryText(lostAside)}
            </span>
          </span>
        </div>
      ) : null}

      <div
        className="flex items-center justify-between rounded-[13px] bg-[#201f24] px-[14px] py-3 text-white"
        data-funnel-footer
      >
        <span className="text-[12px] font-bold uppercase tracking-[0.06em]">
          {FUNNEL_TOTAL_LABEL}
        </span>
        <span className="flex items-center gap-4">
          <span className="text-[12.5px] font-semibold opacity-80" data-funnel-grand-count>
            {leadsCountLabel(composition.totalCount)}
          </span>
          <span className="flex items-center gap-2">
            <span className="text-[11px] font-semibold uppercase tracking-[0.06em] opacity-70">
              {TOTAL_LABEL}
            </span>
            <span className="sales-ops-num text-[16px] font-bold" data-funnel-grand-total>
              {fmtBrl0(composition.totalBrl)}
            </span>
          </span>
        </span>
      </div>
    </div>
  );
}
