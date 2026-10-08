import * as React from 'react';
import { MoreHorizontal, Trash2 } from 'lucide-react';
import type { LeadFieldSet } from '@fxl-sales/shared-utils/sales-edition';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { formatMoneyBrl } from '../calculations';
import {
  CARD_TOOLTIP,
  SALE_STATUS_LABEL,
  UNASSIGNED_LEAD_LABEL,
  leadClientLabel,
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
  leadMenuContentClass,
  leadMenuDeleteItemClass,
  leadMenuTriggerClass,
  readOnlyCardClass,
  unassignedMarkerClass,
} from './board-ui';
import { daysInCurrentStage, leadIsConverted, leadIsUnassigned } from './calculations';
import { CONTACT_LEAD_COPY, leadBirthdayLabel } from './contact-lead';
import { LEAD_DELETE_COPY } from './delete-copy';
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
 *
 * A non-converted card handed `onDelete` carries ONE control of its own: the
 * kebab of its `Excluir` menu (lixeira), also opened by a right-click on the
 * card. `startsOnCardMenu` keeps that menu out of both the drag and the edit
 * paths. Its open state is the only state the card holds.
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
  /**
   * 'contact' in the leads edition: the Cliente (`Sem cliente` when none) and the
   * birthday under the name, the value beside the menu, and no produtos.
   */
  fieldSet?: LeadFieldSet;
  /**
   * Asks for this lead's delete confirmation. Present means a non-converted card
   * renders its kebab menu (and answers a right-click with it); absent, or a
   * converted card, renders neither.
   */
  onDelete?: (lead: SalesOpsLead) => void;
};

/**
 * The seller slot of a lead nobody owns yet (`leadIsUnassigned`). Shared by the
 * card footer and the Lista's Vendedor cell so the two can never drift. The text
 * IS the accessible name: nothing here is aria-hidden.
 */
export function UnassignedLeadMarker() {
  return (
    <span className={unassignedMarkerClass} data-unassigned-lead="">
      <span className="truncate">{UNASSIGNED_LEAD_LABEL}</span>
    </span>
  );
}

/**
 * True for an event the card's own surface must ignore: one that started on the
 * menu trigger, or one bubbling through React's tree from the PORTALLED menu
 * (its target is not inside the card's DOM at all). Such an event never reaches
 * the dnd-kit activator and never opens the editor.
 *
 * A guard on the card rather than `stopPropagation` on the trigger: a React
 * `stopPropagation` also stops the NATIVE event at the root, so the document
 * listener another open Radix menu dismisses itself with would never hear it.
 */
function startsOnCardMenu(event: React.SyntheticEvent<HTMLElement>): boolean {
  const target = event.target;
  if (!(target instanceof Node) || !event.currentTarget.contains(target)) return true;
  return target instanceof Element && target.closest('[data-lead-menu]') !== null;
}

/**
 * The card's one menu, `Excluir`. Opened by its kebab and, controlled through
 * `open`, by a right-click anywhere on the card. It only ASKS: `onDelete` opens
 * the shared `LeadDeleteDialog`, which the container owns.
 */
function LeadCardMenu({
  lead,
  open,
  onOpenChange,
  onDelete,
}: {
  lead: SalesOpsLead;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDelete: (lead: SalesOpsLead) => void;
}) {
  return (
    <DropdownMenu onOpenChange={onOpenChange} open={open}>
      <DropdownMenuTrigger
        aria-label={`${LEAD_DELETE_COPY.menuTrigger}: ${lead.contactName}`}
        className={leadMenuTriggerClass}
        data-lead-menu={lead.id}
        title={LEAD_DELETE_COPY.menuTrigger}
      >
        <MoreHorizontal aria-hidden className="h-4 w-4" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className={leadMenuContentClass}>
        <DropdownMenuItem
          className={leadMenuDeleteItemClass}
          data-delete-lead={lead.id}
          onSelect={() => onDelete(lead)}
        >
          <Trash2 aria-hidden />
          {LEAD_DELETE_COPY.menuLabel}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function LeadCard({
  lead,
  lookups,
  now,
  onEdit,
  onOpenSale,
  dragHandleProps,
  isDragging = false,
  showDaysBadge = true,
  fieldSet = 'full',
  onDelete,
}: LeadCardProps) {
  const contact = fieldSet === 'contact';
  const birthday = contact ? leadBirthdayLabel(lead) : null;
  const clientLabel = contact ? leadClientLabel(lead, lookups) : undefined;
  const readOnly = leadIsConverted(lead);
  const days = daysInCurrentStage(lead.stageChangedAt, now);
  const daysCopy = describeDaysInStage(days);
  const productLabels = leadProductLabels(lead, lookups);
  const visibleProducts = productLabels.slice(0, MAX_PRODUCT_CHIPS);
  const hiddenProductCount = productLabels.length - visibleProducts.length;
  const sellerLabel = leadSellerLabel(lead, lookups);
  const unassigned = leadIsUnassigned(lead);
  const pointerDown = React.useRef<{ x: number; y: number } | null>(null);
  const [menuOpen, setMenuOpen] = React.useState(false);
  const menu =
    onDelete && !readOnly ? (
      <LeadCardMenu lead={lead} onDelete={onDelete} onOpenChange={setMenuOpen} open={menuOpen} />
    ) : null;

  function handlePointerDown(event: React.PointerEvent<HTMLElement>) {
    // The menu is never a drag handle: no pointer record, no dnd-kit activation.
    if (startsOnCardMenu(event)) return;
    pointerDown.current = { x: event.clientX, y: event.clientY };
    (dragHandleProps?.onPointerDown as ((e: React.PointerEvent<HTMLElement>) => void) | undefined)?.(
      event,
    );
  }

  function handleClick(event: React.MouseEvent<HTMLElement>) {
    // Opening the menu, or picking from it, never opens the editor.
    if (startsOnCardMenu(event)) return;
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

  /**
   * Right-click opens the SAME menu, anchored at the kebab. Only where the menu
   * exists: a converted card keeps the browser's own context menu.
   */
  function handleContextMenu(event: React.MouseEvent<HTMLElement>) {
    if (!menu) return;
    event.preventDefault();
    setMenuOpen(true);
  }

  return (
    <article
      className={`group/card ${cardClass} cursor-pointer${isDragging ? ` ${cardDraggingClass}` : ''}${
        readOnly ? ` ${readOnlyCardClass}` : ''
      }`}
      data-lead-card={lead.id}
      {...(readOnly ? { 'data-read-only-card': 'true' } : {})}
      {...(dragHandleProps ?? {})}
      onClick={handleClick}
      onContextMenu={handleContextMenu}
      onPointerDown={handlePointerDown}
      title={readOnly ? undefined : CARD_TOOLTIP}
    >
      {contact ? (
        <div className="flex flex-col gap-0.5">
          <div className="flex items-start justify-between gap-2">
            <span className="min-w-0 break-words text-[14px] font-semibold text-[#201f24]">
              {lead.contactName}
            </span>
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
          {/*
            A full-width row of its own, under the name row: a long client name
            gets the whole card width instead of the column beside the value.
          */}
          <span
            className="line-clamp-2 break-words text-[12.5px] text-[#8b8b92]"
            data-lead-client
            title={clientLabel}
          >
            {clientLabel}
          </span>
          {birthday !== null ? (
            <span className="text-[12px] text-[#8b8b92]" data-lead-birthday>
              {`${CONTACT_LEAD_COPY.birthdayPrefix} ${birthday}`}
            </span>
          ) : null}
        </div>
      ) : (
        <div className="flex items-start justify-between gap-2">
          <div className="flex min-w-0 flex-col gap-0.5">
            <span className="text-[14px] font-semibold text-[#201f24]">{lead.contactName}</span>
            <span className="text-[12.5px] text-[#8b8b92]">{leadCompanyLabel(lead, lookups)}</span>
          </div>
          <div className="flex shrink-0 items-start gap-0.5">
            <span className="sales-ops-num shrink-0 text-[14px] font-bold text-[#201f24]">
              {formatMoneyBrl(lead.estimatedValueBrl, {
                minimumFractionDigits: 0,
                maximumFractionDigits: 0,
              })}
            </span>
            {menu}
          </div>
        </div>
      )}

      {!contact && productLabels.length > 0 ? (
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
          {unassigned ? (
            <UnassignedLeadMarker />
          ) : (
            <>
              <span className={avatarClass}>{avatarInitials(sellerLabel)}</span>
              <span className="truncate text-[12px] text-[#57575f]">{sellerLabel}</span>
            </>
          )}
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
