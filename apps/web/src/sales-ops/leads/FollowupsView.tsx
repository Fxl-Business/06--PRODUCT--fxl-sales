import { Combobox } from '@/components/ui/combobox';
import { PeriodFilter } from '../PeriodFilter';
import type { PeriodSelection } from '../period';
import { displayDate } from '../civil-day';
import {
  blockedNoticeClass,
  comboboxTriggerClass,
  mutedStateClass,
  secondaryButtonClass,
  segmentedButtonActiveClass,
  segmentedButtonClass,
  segmentedContainerClass,
} from './board-ui';
import type { FollowupListRow, FollowupScope, FollowupStatus } from './crm-types';
import {
  FOLLOWUP_COPY,
  FOLLOWUP_PRESETS,
  FOLLOWUP_SCOPE_OPTIONS,
  FOLLOWUP_STATUS_OPTIONS,
  sortFollowups,
} from './followups';
import { FOLLOWUP_STATE_LABEL, followupDueState } from './summary-format';

export type FollowupsViewProps = {
  rows: readonly FollowupListRow[];
  /** The São Paulo civil day, passed in. */
  today: string;
  scope: FollowupScope;
  onScopeChange: (scope: FollowupScope) => void;
  /** The team scope is offered to an admin under `operacional` only. */
  showScopeToggle: boolean;
  status: FollowupStatus;
  onStatusChange: (status: FollowupStatus) => void;
  period: PeriodSelection;
  onPeriodChange: (period: PeriodSelection) => void;
  onOpenLead: (leadId: string) => void;
  onMarkDone: (followupId: string) => void;
  pendingId?: string | null;
  loadFailed?: boolean;
};

/** The follow-ups agenda. Presentational: the container owns the queries and the navigation. */
export function FollowupsView({
  rows,
  today,
  scope,
  onScopeChange,
  showScopeToggle,
  status,
  onStatusChange,
  period,
  onPeriodChange,
  onOpenLead,
  onMarkDone,
  pendingId = null,
  loadFailed = false,
}: FollowupsViewProps) {
  const ordered = sortFollowups(rows);
  return (
    <div className="flex flex-col gap-4" data-followups-view="">
      <div className="flex flex-wrap items-center gap-3">
        {showScopeToggle ? (
          <div aria-label="Escopo" className={segmentedContainerClass} role="group">
            {FOLLOWUP_SCOPE_OPTIONS.map((option) => (
              <button
                aria-pressed={scope === option.value}
                className={scope === option.value ? segmentedButtonActiveClass : segmentedButtonClass}
                data-followup-scope={option.value}
                key={option.value}
                onClick={() => onScopeChange(option.value)}
                type="button"
              >
                {option.label}
              </button>
            ))}
          </div>
        ) : null}
        <div className="w-[190px]">
          <Combobox
            aria-label={FOLLOWUP_COPY.statusLabel}
            className={`w-full ${comboboxTriggerClass}`}
            onChange={(value) => onStatusChange(value as FollowupStatus)}
            options={FOLLOWUP_STATUS_OPTIONS.map((option) => ({ value: option.value, label: option.label }))}
            value={status}
          />
        </div>
        <PeriodFilter
          aria-label="Período do follow-up"
          onChange={onPeriodChange}
          presets={FOLLOWUP_PRESETS}
          value={period}
        />
      </div>

      {loadFailed ? (
        <p className={blockedNoticeClass} role="alert">{FOLLOWUP_COPY.loadFailed}</p>
      ) : ordered.length === 0 ? (
        <p className={mutedStateClass}>{FOLLOWUP_COPY.empty}</p>
      ) : (
        <ul className="flex flex-col divide-y divide-[#f0f0f3] rounded-[14px] border border-[#e8e8ec] bg-white" data-followups-list="">
          {ordered.map((row) => {
            const done = row.doneAt !== null;
            const state = done ? null : followupDueState(row.dueOn, today);
            return (
              <li className="flex flex-wrap items-center gap-3 px-4 py-3" data-followup-row={row.id} key={row.id}>
                <button
                  aria-label={`${FOLLOWUP_COPY.openLead}: ${row.leadContactName}`}
                  className="min-w-0 max-w-[220px] truncate text-left text-[14px] font-semibold text-[#1f1f27] hover:underline"
                  data-followup-open-lead={row.leadId}
                  onClick={() => onOpenLead(row.leadId)}
                  type="button"
                >
                  {row.leadContactName}
                </button>
                <span className="min-w-0 flex-1 break-words text-[14px] text-[#57575f]">{row.nextStep}</span>
                <span className="text-[13px] text-[#57575f]">{displayDate(row.dueOn)}</span>
                {state ? (
                  <span className="rounded-full bg-[#f4f4f6] px-2 py-0.5 text-[12px] font-semibold text-[#57575f]" data-followup-state={state}>
                    {FOLLOWUP_STATE_LABEL[state]}
                  </span>
                ) : null}
                <span className="text-[13px] text-[#8b8b92]">{row.ownerName ?? FOLLOWUP_COPY.noOwner}</span>
                {done ? (
                  <span className="text-[13px] text-[#8b8b92]">{FOLLOWUP_COPY.doneBadge}</span>
                ) : (
                  <button
                    className={secondaryButtonClass}
                    data-followup-done={row.id}
                    disabled={pendingId === row.id}
                    onClick={() => onMarkDone(row.id)}
                    type="button"
                  >
                    {FOLLOWUP_COPY.done}
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
