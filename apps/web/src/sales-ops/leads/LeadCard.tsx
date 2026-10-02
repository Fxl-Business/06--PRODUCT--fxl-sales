import * as React from 'react';
import { formatMoneyBrl } from '../calculations';
import {
  CARD_TOOLTIP,
  SALE_STATUS_LABEL,
  leadCompanyLabel,
  leadProductLabels,
  leadSellerLabel,
  type LabelLookups,
} from './board-labels';
import { describeDaysInStage } from './board-move';
import {
  cardClass,
  cardDraggingClass,
  chipClass,
  saleLinkClass,
  saleLinkCodeClass,
  daysBadgeClass,
  avatarClass,
  dayBadgeTone,
  avatarInitials,
  readOnlyCardClass,
} from './board-ui';
import { daysInCurrentStage, leadIsConverted } from './calculations';
import type { SalesOpsLead } from './types';

/**
 * One card. PURELY presentational: props in, callbacks out, no TanStack, no
 * `apiFetch`, no clock of its own - `now` is injected so the days badge is
 * deterministic in a test and identical across every card of one render.
 *
 * The card IS clickable to edit, by design of the redesign (the old "the card
 * is not activatable" principle was superseded deliberately). The element is
 * still not a `<button>` and carries no `role`. The hazard of an edit firing at
 * the end of a drag is handled by a pointer-distance guard: a click whose
 * pointerdown-to-click movement exceeds the PointerSensor activation distance
 * is a drag, not a click.
 */

const MAX_PRODUCT_CHIPS = 3;
const ACTIVATION_DISTANCE = 6; // same as the board's PointerSensor

export type LeadCardProps = {
  lead: SalesOpsLead;
  lookups: LabelLookups;
  /** Injected clock. */
  now: Date;
  onEdit?: (lead: SalesOpsLead) => void;
  /**
   * Opens the proposta this lead became. Absent means the card renders the
   * status as plain text instead of a link, which is what an oracle rendering
   * the card standalone gets.
   */
  onOpenSale?: (saleId: string) => void;
  /** dnd-kit plumbing supplied by `LeadsBoard`. Absent on a read-only card. */
  dragHandleProps?: React.HTMLAttributes<HTMLElement> & Record<string, unknown>;
  isDragging?: boolean;
  /** Computed by the board (normal stage and not converted). */
  showDaysBadge?: boolean;
};

export function LeadCard({
  lead,
  lookups,
  now,
  onEdit,
  onOpenSale,
  dragHandleProps,
  isDragging = false,
  showDaysBadge = true,
}: LeadCardProps) {
  const readOnly = leadIsConverted(lead);
  const days = daysInCurrentStage(lead.stageChangedAt, now);
  const daysCopy = describeDaysInStage(days);
  const productLabels = leadProductLabels(lead, lookups);
  const visibleProducts = productLabels.slice(0, MAX_PRODUCT_CHIPS);
  const hiddenProductCount = productLabels.length - visibleProducts.length;
  const sellerLabel = leadSellerLabel(lead, lookups);
  const pointerDown = React.useRef<{ x: number; y: number } | null>(null);

  function handlePointerDown(event: React.PointerEvent<HTMLElement>) {
    pointerDown.current = { x: event.clientX, y: event.clientY };
    (dragHandleProps?.onPointerDown as ((e: React.PointerEvent<HTMLElement>) => void) | undefined)?.(
      event,
    );
  }

  function handleClick(event: React.MouseEvent<HTMLElement>) {
    const start = pointerDown.current;
    pointerDown.current = null;
    if (start) {
      const moved = Math.hypot(event.clientX - start.x, event.clientY - start.y);
      if (moved > ACTIVATION_DISTANCE) return; // a drag, not a click
    }
    if (readOnly) {
      if (lead.saleId && onOpenSale) onOpenSale(lead.saleId);
      return;
    }
    onEdit?.(lead);
  }

  return (
    <article
      className={`${cardClass} cursor-pointer${isDragging ? ` ${cardDraggingClass}` : ''}${
        readOnly ? ` ${readOnlyCardClass}` : ''
      }`}
      data-lead-card={lead.id}
      {...(readOnly ? { 'data-read-only-card': 'true' } : {})}
      {...(dragHandleProps ?? {})}
      onClick={handleClick}
      onPointerDown={handlePointerDown}
      title={readOnly ? undefined : CARD_TOOLTIP}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 flex-col gap-0.5">
          <span className="text-[14px] font-semibold text-[#201f24]">{lead.contactName}</span>
          <span className="text-[12.5px] text-[#8b8b92]">{leadCompanyLabel(lead, lookups)}</span>
        </div>
        <span className="sales-ops-num shrink-0 text-[14px] font-bold text-[#201f24]">
          {formatMoneyBrl(lead.estimatedValueBrl, {
            minimumFractionDigits: 0,
            maximumFractionDigits: 0,
          })}
        </span>
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

      {lead.lostReason ? (
        <div
          className="rounded-lg bg-[#fcf1f0] px-3 py-2 text-[12px] text-[#9b2f2a]"
          data-lost-reason-note
        >
          {lead.lostReason}
        </div>
      ) : null}

      {/*
        A converted card's proposta identity. The CODE is the load-bearing half:
        without it the operator sees a status and cannot tell which proposta it
        belongs to, because this card is titled with the CONTACT name while the
        propostas screen is keyed on the CLIENT. That was a real dead end.
        `saleId` and `onOpenSale` together decide link vs plain text, so a card
        rendered without the handler degrades to the old read-only chip rather
        than to a button that does nothing.
      */}
      {lead.saleStatus !== null ? (
        <div>
          {lead.saleId !== null && onOpenSale ? (
            <button
              aria-label={`Abrir a proposta ${lead.saleCode ?? ''} de ${lead.contactName}`.replace(
                /\s+/g,
                ' ',
              )}
              className={saleLinkClass}
              data-open-sale={lead.saleId}
              onClick={(e) => {
                e.stopPropagation();
                onOpenSale(lead.saleId as string);
              }}
              type="button"
            >
              <span className="flex items-center gap-1.5">
                {lead.saleCode ? (
                  <span className={saleLinkCodeClass}>{lead.saleCode}</span>
                ) : null}
                <span className={chipClass} data-sale-status={lead.saleStatus}>
                  {SALE_STATUS_LABEL[lead.saleStatus]}
                </span>
              </span>
              <span aria-hidden="true">&rarr;</span>
            </button>
          ) : (
            <span className={chipClass} data-sale-status={lead.saleStatus}>
              {SALE_STATUS_LABEL[lead.saleStatus]}
            </span>
          )}
        </div>
      ) : null}

      <div className="mt-1 flex items-center justify-between gap-2 border-t border-[#f0f0f3] pt-2.5">
        <span className="flex min-w-0 items-center gap-2">
          <span className={avatarClass}>{avatarInitials(sellerLabel)}</span>
          <span className="truncate text-[12px] text-[#57575f]">{sellerLabel}</span>
        </span>
        {showDaysBadge && !readOnly ? (
          <span
            aria-label={`${daysCopy} nesta etapa`}
            className={`${daysBadgeClass} ${dayBadgeTone(days)}`}
            data-days-in-stage={days}
          >
            {daysCopy}
          </span>
        ) : null}
      </div>
    </article>
  );
}
