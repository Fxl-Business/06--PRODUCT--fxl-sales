import * as React from 'react';
import { formatMoneyBrl } from '../calculations';
import {
  FUNNEL_EMPTY,
  FUNNEL_METRIC_LABEL,
  FUNNEL_TOTAL_LABEL,
  PERCENT_OF_TOTAL,
  TOTAL_LABEL,
  leadsCountLabel,
  type FunnelMetric,
} from './board-labels';
import {
  mutedStateClass,
  segmentedButtonActiveClass,
  segmentedButtonClass,
  segmentedContainerClass,
  stageColors,
} from './board-ui';
import { buildLeadFunnel } from './calculations';
import type { SalesOpsLead, SalesOpsLeadStage } from './types';

/**
 * The sales funnel: centred, tapering bars - one per active stage, widest at the
 * top - so the drop-off reads as a funnel rather than a list. A metric switch
 * sizes the funnel either by FATURAMENTO (R$) or by VOLUME (lead count); the two
 * are never shown mixed in one bar. Bar width is the stage's magnitude over the
 * LARGEST stage (the taper); the `% do total` label is its share of the sum.
 * Purely presentational, derived from `buildLeadFunnel`.
 */
export type LeadsFunnelViewProps = {
  leads: SalesOpsLead[];
  stages: SalesOpsLeadStage[];
};

const fmtBrl0 = (cents: number) =>
  formatMoneyBrl(cents, { minimumFractionDigits: 0, maximumFractionDigits: 0 });

export function LeadsFunnelView({ leads, stages }: LeadsFunnelViewProps) {
  const [metric, setMetric] = React.useState<FunnelMetric>('value');
  const funnel = React.useMemo(() => buildLeadFunnel(leads, stages), [leads, stages]);
  const colors = React.useMemo(
    () => stageColors(funnel.rows.map((row) => ({ id: row.stageId, kind: row.kind }))),
    [funnel.rows],
  );

  if (funnel.rows.length === 0) {
    return <p className={mutedStateClass}>{FUNNEL_EMPTY}</p>;
  }

  const magnitudeOf = (row: (typeof funnel.rows)[number]) =>
    metric === 'value' ? row.totalBrl : row.count;
  const maxMagnitude = Math.max(0, ...funnel.rows.map(magnitudeOf));
  const totalMagnitude = metric === 'value' ? funnel.totalBrl : funnel.totalCount;

  const primaryText = (row: (typeof funnel.rows)[number]) =>
    metric === 'value' ? fmtBrl0(row.totalBrl) : leadsCountLabel(row.count);
  const secondaryText = (row: (typeof funnel.rows)[number]) =>
    metric === 'value' ? leadsCountLabel(row.count) : fmtBrl0(row.totalBrl);

  return (
    <div className="flex flex-col gap-4" data-leads-funnel="true" data-funnel-metric={metric}>
      <div
        aria-label="Métrica do funil"
        className={segmentedContainerClass}
        data-funnel-metric-toggle="true"
        role="group"
        style={{ alignSelf: 'flex-start' }}
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

      <div className="flex flex-col gap-1.5">
        {funnel.rows.map((row) => {
          const color = colors.get(row.stageId);
          const magnitude = magnitudeOf(row);
          const widthPct = maxMagnitude > 0 ? (magnitude / maxMagnitude) * 100 : 0;
          const sharePct =
            totalMagnitude > 0 ? Math.round((magnitude / totalMagnitude) * 100) : 0;
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
                    {PERCENT_OF_TOTAL(sharePct)}
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

      <div
        className="flex items-center justify-between rounded-[13px] bg-[#201f24] px-[14px] py-3 text-white"
        data-funnel-footer
      >
        <span className="text-[12px] font-bold uppercase tracking-[0.06em]">
          {FUNNEL_TOTAL_LABEL}
        </span>
        <span className="flex items-center gap-4">
          <span className="text-[12.5px] font-semibold opacity-80" data-funnel-grand-count>
            {leadsCountLabel(funnel.totalCount)}
          </span>
          <span className="flex items-center gap-2">
            <span className="text-[11px] font-semibold uppercase tracking-[0.06em] opacity-70">
              {TOTAL_LABEL}
            </span>
            <span className="sales-ops-num text-[16px] font-bold" data-funnel-grand-total>
              {fmtBrl0(funnel.totalBrl)}
            </span>
          </span>
        </span>
      </div>
    </div>
  );
}
