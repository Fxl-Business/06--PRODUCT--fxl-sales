import * as React from 'react';
import { formatMoneyBrl } from '../calculations';
import {
  FUNNEL_EMPTY,
  FUNNEL_TOTAL_LABEL,
  PERCENT_OF_TOTAL,
  TOTAL_LABEL,
  leadsCountLabel,
} from './board-labels';
import { columnHeaderCardClass, mutedStateClass, proportionTrackClass, stageColors } from './board-ui';
import { buildLeadFunnel } from './calculations';
import type { SalesOpsLead, SalesOpsLeadStage } from './types';

/**
 * The sales funnel: one row per active stage, showing volume (lead count) and
 * value (R$ total) with a proportion bar sized by the stage's share of the total
 * value - the same `% do total` the Quadro column header renders. Purely
 * presentational; it derives everything from `buildLeadFunnel`, so it can never
 * disagree with the board about which cards sit in which stage.
 */
export type LeadsFunnelViewProps = {
  leads: SalesOpsLead[];
  stages: SalesOpsLeadStage[];
};

const fmtBrl0 = (cents: number) =>
  formatMoneyBrl(cents, { minimumFractionDigits: 0, maximumFractionDigits: 0 });

export function LeadsFunnelView({ leads, stages }: LeadsFunnelViewProps) {
  const funnel = React.useMemo(() => buildLeadFunnel(leads, stages), [leads, stages]);
  const colors = React.useMemo(
    () => stageColors(funnel.rows.map((row) => ({ id: row.stageId, kind: row.kind }))),
    [funnel.rows],
  );

  if (funnel.rows.length === 0) {
    return <p className={mutedStateClass}>{FUNNEL_EMPTY}</p>;
  }

  return (
    <div className="flex flex-col gap-2.5" data-leads-funnel="true">
      {funnel.rows.map((row) => {
        const color = colors.get(row.stageId);
        return (
          <div className={columnHeaderCardClass} data-funnel-row={row.stageId} key={row.stageId}>
            <div className="flex items-center gap-2">
              <span
                className="h-[9px] w-[9px] shrink-0 rounded-full"
                style={{ backgroundColor: color?.dot }}
              />
              <span className="flex-1 truncate text-[13.5px] font-bold text-[#201f24]">
                {row.name}
              </span>
              <span className="text-[12.5px] font-semibold text-[#6a6a72]" data-funnel-count>
                {leadsCountLabel(row.count)}
              </span>
            </div>
            <div className="mt-2 flex items-baseline justify-between">
              <span className="sales-ops-num text-[18px] font-bold text-[#201f24]" data-funnel-total>
                {fmtBrl0(row.totalBrl)}
              </span>
              <span className="text-[11.5px] font-semibold text-[#9b9ba3]" data-funnel-share>
                {PERCENT_OF_TOTAL(row.share)}
              </span>
            </div>
            <div className={`mt-2 ${proportionTrackClass}`}>
              <div
                className="h-full rounded-full"
                data-funnel-bar
                style={{ width: `${row.share}%`, backgroundColor: color?.dot }}
              />
            </div>
          </div>
        );
      })}

      <div
        className="mt-1 flex items-center justify-between rounded-[13px] bg-[#201f24] px-[14px] py-3 text-white"
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
