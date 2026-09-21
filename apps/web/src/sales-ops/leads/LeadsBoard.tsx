import * as React from 'react';
import {
  DndContext,
  DragOverlay,
  MeasuringStrategy,
  useDroppable,
  PointerSensor,
  closestCorners,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import { SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Combobox, type ComboboxOption } from '@/components/ui/combobox';
import type { MoveLeadPayload } from './api';
import type { LabelLookups } from './board-labels';
import { buildMovePayload, moveTargetsFor, stageOpensConversion } from './board-move';
import {
  boardScrollerClass,
  cardButtonClass,
  columnClass,
  dragHandleSurfaceClass,
  dragOverlayCardClass,
  comboboxTriggerClass,
  columnHeaderClass,
  mutedStateClass,
  primaryButtonClass,
} from './board-ui';
import { boardStages, leadIsConverted, leadsInStage, stageRequiresReason } from './calculations';
import { LeadCard } from './LeadCard';
import { MoveLeadDialog } from './MoveLeadDialog';
import type { SalesOpsLead, SalesOpsLeadStage } from './types';

/**
 * The Kanban surface. PURELY presentational: it holds no query, no mutation and
 * no copy of the lead list - it renders straight from props, so slice 04's
 * optimistic cache stays the single source of truth and a rejected move reverts
 * with the cache rather than fighting a second one.
 *
 * READ-ONLY IS A PROPERTY OF THE CARD. No column is read-only, the conversion
 * column least of all: it is the DESTINATION a card is dropped onto to start a
 * proposta. What refuses to move is the card, when `leadIsConverted(lead)`.
 */

/** The slice-08 seam. Nothing else in this slice knows the proposta wizard exists. */
export type LeadConversionRequest = {
  lead: SalesOpsLead;
  toStageId: string;
  toIndex: number;
};

export type LeadsBoardProps = {
  stages: SalesOpsLeadStage[];
  leads: SalesOpsLead[];
  lookups: LabelLookups;
  now: Date;
  /** Emitted once per confirmed move. The container hands this to `useMoveLead`. */
  onMoveLead: (payload: MoveLeadPayload) => void;
  movePending?: boolean;
  onCreateLead?: () => void;
  onEditLead?: (lead: SalesOpsLead) => void;
  /**
   * Called INSTEAD of `onMoveLead` when the destination is the conversion door.
   *   resolve(saleId) -> the board then calls `onMoveLead(payload)` with it
   *   resolve(null)   -> the operator cancelled: the board does NOTHING. No
   *                      optimistic write, no request, no card movement.
   *   reject          -> surfaced exactly like any other failed move.
   */
  onRequestConversion?: (request: LeadConversionRequest) => Promise<string | null>;
  /** Opens the proposta a converted lead became. */
  onOpenSale?: (saleId: string) => void;
  /** Controlled by the routing layer; the board renders the picker and owns no filter state. */
  sellerFilter?: {
    value: string | null;
    options: ComboboxOption[];
    onChange: (value: string | null) => void;
  };
  hasMore?: boolean;
  onLoadMore?: () => void;
  loadingMore?: boolean;
};

const ALL_SELLERS_VALUE = '';

type SortableCardProps = {
  lead: SalesOpsLead;
  lookups: LabelLookups;
  now: Date;
  onRequestMove?: (lead: SalesOpsLead) => void;
  onEdit?: (lead: SalesOpsLead) => void;
  onOpenSale?: (saleId: string) => void;
};

/**
 * The drag plumbing for ONE movable card, isolated here so `LeadCard` stays free
 * of dnd-kit entirely and can be rendered by any oracle without a `DndContext`.
 */
function SortableLeadCard({
  lead,
  lookups,
  now,
  onRequestMove,
  onEdit,
  onOpenSale,
}: SortableCardProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: lead.id,
    data: { stageId: lead.stageId },
  });

  return (
    <div
      className={dragHandleSurfaceClass}
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
    >
      <LeadCard
        dragHandleProps={{ ...attributes, ...listeners }}
        isDragging={isDragging}
        lead={lead}
        lookups={lookups}
        now={now}
        onEdit={onEdit}
        onOpenSale={onOpenSale}
        onRequestMove={onRequestMove}
      />
    </div>
  );
}

/**
 * THE COLUMN ITSELF AS A DROP TARGET.
 *
 * Without this every droppable on the board was a CARD (`useSortable` registers
 * each one), so `over` could only ever be another card. Three consequences, all
 * measured in a real browser on 2026-09-21:
 *   - an EMPTY column could never receive a card;
 *   - a drop had to land precisely on a card, never on the column's free space;
 *   - worst, the CONVERSION column was permanently unreachable, because its
 *     cards are converted, converted cards are excluded from `movableIds`, and
 *     a card outside `SortableContext` is not a droppable at all. The one column
 *     the whole feature exists to move leads into accepted nothing.
 *
 * `handleDragEnd` already read `over.id` as a stage id when it was not a card
 * (`overLead ? overLead.stageId : overId`); that branch was simply dead code
 * until this registered the id it was looking for.
 *
 * Drag remains pure convenience: the `Mover para` dialog is the real control and
 * its oracles still pass with this entire layer deleted.
 */
function StageDropZone({ stageId, children }: { stageId: string; children: React.ReactNode }) {
  const { setNodeRef, isOver } = useDroppable({ id: stageId });
  return (
    <div
      className={`flex min-h-[72px] flex-col gap-2 rounded-md transition-colors${
        isOver ? ' bg-[#eeeef6]' : ''
      }`}
      data-stage-dropzone={stageId}
      ref={setNodeRef}
    >
      {children}
    </div>
  );
}

export function LeadsBoard({
  stages,
  leads,
  lookups,
  now,
  onMoveLead,
  movePending = false,
  onCreateLead,
  onEditLead,
  onRequestConversion,
  onOpenSale,
  sellerFilter,
  hasMore = false,
  onLoadMore,
  loadingMore = false,
}: LeadsBoardProps) {
  const columns = React.useMemo(() => boardStages(stages), [stages]);
  const hasConversionHandler = Boolean(onRequestConversion);

  /**
   * The card currently under the cursor, held ONLY to render the DragOverlay.
   * It is presentation state and never a source of truth: no move is decided
   * from it, `handleDragEnd` still reads the event.
   */
  const [activeLeadId, setActiveLeadId] = React.useState<string | null>(null);
  const activeLead = activeLeadId === null ? null : (leads.find((row) => row.id === activeLeadId) ?? null);

  const [moveLeadId, setMoveLeadId] = React.useState<string | null>(null);
  const [moveSeedStageId, setMoveSeedStageId] = React.useState<string | null>(null);

  const moveLead = moveLeadId === null ? null : (leads.find((row) => row.id === moveLeadId) ?? null);

  /**
   * THE SINGLE EMITTER. Every input method funnels here and nowhere else - the
   * `Mover para` dialog's `onSubmit` IS this function, and `onDragEnd` calls it
   * too. That is the entire relationship between the two input methods, and it
   * is why deleting the drag layer changes no behaviour.
   */
  const emitMove = React.useCallback(
    async (payload: MoveLeadPayload) => {
      const target = stages.find((stage) => stage.id === payload.toStageId);
      if (stageOpensConversion(target)) {
        // Structurally unreachable when absent: `moveTargetsFor` already
        // excluded the stage from every menu.
        if (!onRequestConversion) return;
        const row = leads.find((candidate) => candidate.id === payload.leadId);
        if (!row) return;
        const saleId = await onRequestConversion({
          lead: row,
          toStageId: payload.toStageId,
          toIndex: payload.toIndex,
        });
        // Cancelled: the card never moved, nothing was persisted and no request
        // was issued.
        if (saleId === null) return;
        // The resolved sale id RIDES the move. The API answers
        // `400 sale_required_for_conversion` to a conversion move without one,
        // so this single line is the whole handshake's product.
        onMoveLead({ ...payload, saleId });
        return;
      }
      onMoveLead(payload);
    },
    [leads, onMoveLead, onRequestConversion, stages],
  );

  const sensors = useSensors(
    // `distance: 6` so a click on `Mover para…` is never swallowed by a drag.
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    // deliberately no KeyboardSensor - see the Mover para dialog, which is the real control
  );

  function openMoveDialog(lead: SalesOpsLead, seedStageId: string | null = null) {
    setMoveSeedStageId(seedStageId);
    setMoveLeadId(lead.id);
  }

  function handleDragStart(event: DragStartEvent) {
    setActiveLeadId(String(event.active.id));
  }

  /**
   * A cancelled drag (Escape, a `pointercancel` the browser still wins, an
   * unmount) MUST clear the overlay, or the board is left with a card stuck to
   * the cursor and no way to put it down.
   */
  function handleDragCancel() {
    setActiveLeadId(null);
  }

  function handleDragEnd(event: DragEndEvent) {
    setActiveLeadId(null);
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const dragged = leads.find((row) => row.id === String(active.id));
    // A converted card is never a drag source, so this is a belt to that brace.
    if (!dragged || leadIsConverted(dragged)) return;

    const overId = String(over.id);
    const overLead = leads.find((row) => row.id === overId);
    const toStageId = overLead ? overLead.stageId : overId;
    const target = columns.find((stage) => stage.id === toStageId);
    if (!target) return;

    const column = leadsInStage(leads, toStageId);
    const overIndex = overLead ? column.findIndex((row) => row.id === overId) : column.length;
    const toIndex = overIndex < 0 ? column.length : overIndex;

    // A drag has nowhere to type a reason and nowhere to fill a wizard, so both
    // of those destinations hand back to the dialog instead of emitting. That is
    // the one place drag defers to the keyboard control.
    if (stageRequiresReason(target) || stageOpensConversion(target)) {
      openMoveDialog(dragged, toStageId);
      return;
    }

    void emitMove(
      buildMovePayload({ lead: dragged, targetStage: target, targetIndex: toIndex, reason: '' }),
    );
  }

  return (
    <div className="flex flex-col gap-4" data-leads-board="true">
      <header className="flex flex-wrap items-center justify-between gap-3">
        {sellerFilter ? (
          <div className="w-[240px]">
            <Combobox
              aria-label="Vendedor"
              className={comboboxTriggerClass}
              onChange={(value) =>
                sellerFilter.onChange(value === ALL_SELLERS_VALUE ? null : value)
              }
              options={[
                { value: ALL_SELLERS_VALUE, label: 'Todos os vendedores' },
                ...sellerFilter.options,
              ]}
              value={sellerFilter.value ?? ALL_SELLERS_VALUE}
            />
          </div>
        ) : (
          <span />
        )}
        {onCreateLead ? (
          <button className={primaryButtonClass} onClick={onCreateLead} type="button">
            Novo lead
          </button>
        ) : null}
      </header>

      {/*
        The board does NOT filter its own `leads` array. Scoping is server-applied
        inside `withTenant` and the vendedor narrowing rides the board query's
        filters, so a client-side filter would be a second, weaker answer to a
        question the server already answered.
      */}
      {/*
        `measuring` on `Always`: columns change height as cards enter and leave,
        and dnd-kit's default caches droppable rects on drag start. A stale rect
        means the collision test is run against where a column USED to be, which
        reads to the operator as the board refusing a perfectly aimed drop.
      */}
      <DndContext
        collisionDetection={closestCorners}
        measuring={{ droppable: { strategy: MeasuringStrategy.Always } }}
        onDragCancel={handleDragCancel}
        onDragEnd={handleDragEnd}
        onDragStart={handleDragStart}
        sensors={sensors}
      >
        <div className={boardScrollerClass}>
          {columns.map((stage) => {
            const column = leadsInStage(leads, stage.id);
            const movableIds = column
              .filter((row) => !leadIsConverted(row))
              .map((row) => row.id);

            return (
              <section
                className={columnClass}
                data-stage-column={stage.id}
                key={stage.id}
                {...(stageOpensConversion(stage) ? { 'data-conversion-column': 'true' } : {})}
              >
                <header className={columnHeaderClass}>
                  <span>{stage.name}</span>
                  <span>{column.length}</span>
                </header>

                <SortableContext items={movableIds} strategy={verticalListSortingStrategy}>
                  <StageDropZone stageId={stage.id}>
                    {column.map((lead) => {
                      const targets = moveTargetsFor(lead, columns, hasConversionHandler);
                      if (targets.length === 0) {
                        return (
                          <LeadCard
                            key={lead.id}
                            lead={lead}
                            lookups={lookups}
                            now={now}
                            onEdit={onEditLead}
                            onOpenSale={onOpenSale}
                          />
                        );
                      }
                      return (
                        <SortableLeadCard
                          key={lead.id}
                          lead={lead}
                          lookups={lookups}
                          now={now}
                          onEdit={onEditLead}
                          onOpenSale={onOpenSale}
                          onRequestMove={(row) => openMoveDialog(row)}
                        />
                      );
                    })}
                    {column.length === 0 ? (
                      <p className={mutedStateClass}>Nenhum lead nesta etapa.</p>
                    ) : null}
                  </StageDropZone>
                </SortableContext>
              </section>
            );
          })}
        </div>

        {/*
          THE DRAGGED CARD RIDES AN OVERLAY, not its own slot in the column.
          The board scroller is `overflow-x-auto`, and a card transformed inside
          a scroll container clips at that container's edge: drag toward a column
          off-screen and the card visually disappears while still being dragged.
          The overlay is rendered outside the scroller, so it follows the cursor
          across the whole board. This is dnd-kit's documented answer for
          scrollable containers rather than a flourish.
        */}
        <DragOverlay dropAnimation={null}>
          {activeLead ? (
            <div className={dragOverlayCardClass}>
              <LeadCard lead={activeLead} lookups={lookups} now={now} />
            </div>
          ) : null}
        </DragOverlay>
      </DndContext>

      {hasMore ? (
        <footer>
          <button
            className={cardButtonClass}
            disabled={loadingMore}
            onClick={onLoadMore}
            type="button"
          >
            Carregar mais leads
          </button>
        </footer>
      ) : null}

      {moveLead ? (
        <MoveLeadDialog
          initialStageId={moveSeedStageId}
          key={moveLead.id}
          lead={moveLead}
          leads={leads}
          onOpenChange={(next) => {
            if (!next) setMoveLeadId(null);
          }}
          onSubmit={(payload) => {
            void emitMove(payload);
          }}
          open
          pending={movePending}
          targets={moveTargetsFor(moveLead, columns, hasConversionHandler)}
        />
      ) : null}
    </div>
  );
}
