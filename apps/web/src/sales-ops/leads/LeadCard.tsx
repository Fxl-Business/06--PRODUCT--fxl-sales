import * as React from 'react';
import { formatMoneyBrl } from '../calculations';
import {
  SALE_STATUS_LABEL,
  leadCompanyLabel,
  leadProductLabels,
  leadSellerLabel,
  type LabelLookups,
} from './board-labels';
import { describeDaysInStage } from './board-move';
import {
  cardButtonClass,
  cardClass,
  cardDraggingClass,
  chipClass,
  daysBadgeClass,
  readOnlyCardClass,
} from './board-ui';
import { daysInCurrentStage, leadIsConverted } from './calculations';
import type { SalesOpsLead } from './types';

/**
 * One card. PURELY presentational: props in, callbacks out, no TanStack, no
 * `apiFetch`, no clock of its own - `now` is injected so the days badge is
 * deterministic in a test and identical across every card of one render.
 *
 * The card element is deliberately NOT itself a button, and the move trigger is
 * NOT nested inside the drag handle. A control that is both draggable and
 * activatable has an activation behaviour that depends on how far the pointer
 * moved, which is the class of bug CLAUDE.md's `type="button"` paragraph is
 * about.
 */

const MAX_PRODUCT_CHIPS = 3;

export type LeadCardProps = {
  lead: SalesOpsLead;
  lookups: LabelLookups;
  /** Injected clock. */
  now: Date;
  /** Absent means no move trigger and no drag handle - a converted or otherwise immovable card. */
  onRequestMove?: (lead: SalesOpsLead) => void;
  onEdit?: (lead: SalesOpsLead) => void;
  /** dnd-kit plumbing supplied by `LeadsBoard`. Absent on a read-only card. */
  dragHandleProps?: React.HTMLAttributes<HTMLElement> & Record<string, unknown>;
  isDragging?: boolean;
};

export function LeadCard({
  lead,
  lookups,
  now,
  onRequestMove,
  onEdit,
  dragHandleProps,
  isDragging = false,
}: LeadCardProps) {
  const readOnly = leadIsConverted(lead);
  const days = daysInCurrentStage(lead.stageChangedAt, now);
  const daysCopy = describeDaysInStage(days);
  const productLabels = leadProductLabels(lead, lookups);
  const visibleProducts = productLabels.slice(0, MAX_PRODUCT_CHIPS);
  const hiddenProductCount = productLabels.length - visibleProducts.length;

  return (
    <article
      className={`${cardClass}${isDragging ? ` ${cardDraggingClass}` : ''}${
        readOnly ? ` ${readOnlyCardClass}` : ''
      }`}
      data-lead-card={lead.id}
      {...(readOnly ? { 'data-read-only-card': 'true' } : {})}
      {...(dragHandleProps ?? {})}
    >
      <div className="flex flex-col gap-0.5">
        <span className="text-[14px] font-semibold text-[#201f24]">{lead.contactName}</span>
        <span className="text-[12.5px] text-[#8b8b92]">{leadCompanyLabel(lead, lookups)}</span>
      </div>

      {productLabels.length > 0 ? (
        <div className="flex flex-wrap gap-1">
          {visibleProducts.map((label, index) => (
            <span className={chipClass} key={`${label}-${index}`}>
              {label}
            </span>
          ))}
          {hiddenProductCount > 0 ? (
            <span className={chipClass}>{`+${hiddenProductCount}`}</span>
          ) : null}
        </div>
      ) : null}

      {/*
        The label says "estimado" so this number can never be read as a closed
        value: it is a guess an operator typed on a card and it reaches no
        financial computation anywhere in the app.
      */}
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-[11.5px] uppercase tracking-[0.06em] text-[#9b9ba3]">
          Valor estimado
        </span>
        <span className="sales-ops-num text-[13.5px] font-semibold text-[#201f24]">
          {formatMoneyBrl(lead.estimatedValueBrl)}
        </span>
      </div>

      <div className="flex items-center justify-between gap-2">
        <span className="text-[12.5px] text-[#57575f]">{leadSellerLabel(lead, lookups)}</span>
        <span
          aria-label={`${daysCopy} nesta etapa`}
          className={daysBadgeClass}
          data-days-in-stage={days}
        >
          {daysCopy}
        </span>
      </div>

      {lead.saleStatus !== null ? (
        <div>
          <span className={chipClass} data-sale-status={lead.saleStatus}>
            {SALE_STATUS_LABEL[lead.saleStatus]}
          </span>
        </div>
      ) : null}

      {onRequestMove || onEdit ? (
        <div className="flex flex-wrap gap-2 pt-1">
          {onRequestMove ? (
            <button
              aria-label={`Mover para… ${lead.contactName}`}
              className={cardButtonClass}
              data-move-trigger={lead.id}
              onClick={() => onRequestMove(lead)}
              type="button"
            >
              Mover para…
            </button>
          ) : null}
          {onEdit ? (
            <button
              className={cardButtonClass}
              data-edit-lead={lead.id}
              onClick={() => onEdit(lead)}
              type="button"
            >
              Editar
            </button>
          ) : null}
        </div>
      ) : null}
    </article>
  );
}
