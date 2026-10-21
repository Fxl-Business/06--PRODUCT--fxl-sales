import * as React from 'react';
import { saoPauloDayOf } from '@fxl-sales/shared-utils/sao-paulo-day';
import { daysInCurrentStage, leadIsConverted, leadIsUnassigned } from './calculations';
import { displayDate } from '../civil-day';
import { formatMoneyBrl } from '../calculations';
import { UNASSIGNED_LEAD_LABEL } from './board-labels';
import { leadContactLine } from './contact-lead';
import { primaryButtonClass, secondaryButtonClass, stageColors } from './board-ui';
import { summaryStageKind } from './crm-pipeline';
import { OrgModulesContext } from '@/auth/org-modules-context';
import type { FieldDefinition, LeadFollowup, LeadSummaryResponse } from './crm-types';
import {
  FOLLOWUP_STATE_LABEL,
  TIMELINE_LABEL,
  followupDueState,
  formatInstantSaoPaulo,
  sortTimeline,
  visibleFieldRows,
} from './summary-format';

export type LeadSummaryProps = {
  summary: LeadSummaryResponse;
  definitions: FieldDefinition[];
  /** The São Paulo civil day, passed in: this component never reads the clock. */
  today: string;
  /** Injected clock, for the day counters. */
  now: Date;
  onBack: () => void;
  onEdit: () => void;
  onAdvance?: () => void;
  onOpenSale?: (saleId: string) => void;
  /** Mounted under the follow-ups section (the note and follow-up composers). */
  notesSlot?: React.ReactNode;
  renderFollowupAction?: (followup: LeadFollowup) => React.ReactNode;
};

const ANONYMOUS_AUTHOR = 'Autor não identificado';
const NO_CLIENT = 'Sem cliente';
const NO_FOLLOWUPS = 'Nenhum próximo passo agendado.';
const NO_ADVANCE = 'Não há próximas etapas para este lead.';

function DataRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[140px_minmax(0,1fr)] gap-3 border-t border-[#f0f0f3] py-2 text-[14px] first:border-t-0">
      <dt className="text-[#8b8b92]">{label}</dt>
      <dd className="min-w-0 break-words text-[#1f1f27]">{children}</dd>
    </div>
  );
}

/** The lead summary page. Pure: props in, callbacks out. Never renders an id. */
export function LeadSummary({
  summary,
  definitions,
  today,
  now,
  onBack,
  onEdit,
  onAdvance,
  onOpenSale,
  notesSlot,
  renderFollowupAction,
}: LeadSummaryProps) {
  const { lead, stage, pipeline, nextStages } = summary;
  const converted = leadIsConverted(lead);
  const unassigned = leadIsUnassigned(lead);
  const modules = React.useContext(OrgModulesContext);
  const stageColor = stageColors([{ id: stage.id, kind: summaryStageKind(stage, modules) }]).get(stage.id);
  const openFollowups = summary.followups
    .filter((followup) => followup.doneAt === null)
    .sort((a, b) => (a.dueOn < b.dueOn ? -1 : a.dueOn > b.dueOn ? 1 : 0));
  const fieldRows = visibleFieldRows(lead, definitions);

  return (
    <div data-lead-summary={lead.id} className="flex flex-col gap-4">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-2">
          <button className={secondaryButtonClass} data-summary-back onClick={onBack} type="button">
            Voltar
          </button>
          <h2 className="break-words text-[22px] font-semibold text-[#1f1f27]">{lead.contactName}</h2>
          <div className="flex flex-wrap items-center gap-2 text-[13px]">
            <span
              className="rounded-full border px-2.5 py-0.5 font-semibold"
              data-summary-stage
              style={stageColor ? { background: stageColor.soft, borderColor: stageColor.border, color: stageColor.ink } : undefined}
            >
              {stage.name}
            </span>
            <span className="text-[#8b8b92]">{pipeline.name}</span>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {converted ? (
            lead.saleId && onOpenSale ? (
              <button className={primaryButtonClass} data-summary-open-sale onClick={() => onOpenSale(lead.saleId!)} type="button">
                Abrir proposta{lead.saleCode ? ` ${lead.saleCode}` : ''}
              </button>
            ) : null
          ) : (
            <>
              <button className={secondaryButtonClass} data-summary-edit onClick={onEdit} type="button">
                Editar
              </button>
              {onAdvance ? (
                <button
                  className={primaryButtonClass}
                  data-summary-advance
                  disabled={nextStages.length === 0}
                  onClick={onAdvance}
                  title={nextStages.length === 0 ? NO_ADVANCE : undefined}
                  type="button"
                >
                  Avançar
                </button>
              ) : null}
            </>
          )}
        </div>
      </header>

      <section aria-label="Dados" className="rounded-[14px] border border-[#e8e8ec] bg-white p-4" data-summary-section="dados">
        <dl className="flex flex-col">
          <DataRow label="Cliente">{lead.clientNameSnapshot || NO_CLIENT}</DataRow>
          <DataRow label="Contato">{leadContactLine(lead)}</DataRow>
          <DataRow label="Responsável">{unassigned ? UNASSIGNED_LEAD_LABEL : lead.sellerNameSnapshot || 'Sem vendedor'}</DataRow>
          <DataRow label="Valor estimado">{formatMoneyBrl(lead.estimatedValueBrl)}</DataRow>
          <DataRow label="Na etapa há">{`${daysInCurrentStage(lead.stageChangedAt, now)} dias`}</DataRow>
          <DataRow label="Criado em">{displayDate(saoPauloDayOf(new Date(lead.createdAt)))}</DataRow>
          {fieldRows.map((row) => (
            <DataRow key={row.id} label={row.label}>{row.text}</DataRow>
          ))}
        </dl>
      </section>

      <section aria-label="Próximos passos" className="rounded-[14px] border border-[#e8e8ec] bg-white p-4" data-summary-section="followups">
        <h3 className="mb-2 text-[15px] font-semibold text-[#1f1f27]">Próximos passos</h3>
        {openFollowups.length === 0 ? (
          <p className="text-[13px] text-[#8b8b92]">{NO_FOLLOWUPS}</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {openFollowups.map((followup) => {
              const state = followupDueState(followup.dueOn, today);
              return (
                <li className="flex flex-wrap items-center gap-3 border-t border-[#f0f0f3] pt-2 first:border-t-0" key={followup.id}>
                  <span className="min-w-0 flex-1 break-words text-[14px] text-[#1f1f27]">{followup.nextStep}</span>
                  <span className="text-[13px] text-[#57575f]">{displayDate(followup.dueOn)}</span>
                  <span className="text-[13px] text-[#8b8b92]">{followup.ownerName ?? 'Sem responsável'}</span>
                  <span className="rounded-full bg-[#f4f4f6] px-2 py-0.5 text-[12px] font-semibold text-[#57575f]" data-followup-state={state}>
                    {FOLLOWUP_STATE_LABEL[state]}
                  </span>
                  {renderFollowupAction?.(followup)}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {notesSlot}

      <section aria-label="Histórico" className="rounded-[14px] border border-[#e8e8ec] bg-white p-4" data-summary-section="timeline">
        <h3 className="mb-2 text-[15px] font-semibold text-[#1f1f27]">Histórico</h3>
        <ol className="flex flex-col gap-3">
          {sortTimeline(summary.timeline).map((item, index) => {
            const label = TIMELINE_LABEL[item.kind](item);
            return (
              <li className="border-t border-[#f0f0f3] pt-2 first:border-t-0" data-timeline-kind={item.kind} key={`${item.kind}-${item.at}-${index}`}>
                <p className="text-[14px] text-[#1f1f27]">{label.title}</p>
                {label.detail ? <p className="text-[13px] text-[#57575f]">{label.detail}</p> : null}
                <p className="text-[12px] text-[#8b8b92]">
                  {formatInstantSaoPaulo(item.at)} - {item.actorName ?? ANONYMOUS_AUTHOR}
                </p>
              </li>
            );
          })}
        </ol>
      </section>
    </div>
  );
}
