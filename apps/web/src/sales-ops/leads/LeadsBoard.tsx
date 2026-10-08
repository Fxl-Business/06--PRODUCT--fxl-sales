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
import { Filter, List, Plus, SquareKanban } from 'lucide-react';
import type { LeadFieldSet } from '@fxl-sales/shared-utils/sales-edition';
import { Combobox, type ComboboxOption } from '@/components/ui/combobox';
import { formatMoneyBrl } from '../calculations';
import type { MoveLeadPayload } from './api';
import {
  ALL_PHASES_LABEL,
  BOARD_VIEW_LABEL,
  EDIT_LABEL,
  EMPTY_COLUMN_HINT,
  EMPTY_PHASE_LIST,
  LIST_HEADERS,
  MOVE_LABEL,
  NO_PRODUCTS_DASH,
  PERCENT_OF_TOTAL,
  TOTAL_LABEL,
  VIEW_IN_LIST_LABEL,
  leadCompanyLabel,
  leadProductLabels,
  leadSellerLabel,
  loadMoreLabel,
  scopeLeadsCount,
  type LabelLookups,
} from './board-labels';
import {
  buildMovePayload,
  describeDaysInStage,
  dragHandsBackToDialog,
  moveTargetsFor,
  stageOpensConversion,
} from './board-move';
import { moveLeadInList, summaryWithPendingMove } from './optimistic';
import {
  avatarClass,
  avatarInitials,
  boardScrollerClass,
  cardButtonClass,
  dayBadgeTone,
  daysBadgeClass,
  listActionButtonClass,
  listDangerActionButtonClass,
  listFooterClass,
  listRowClass,
  listTableCardClass,
  listTheadClass,
  phaseChipClassName,
  segmentedButtonActiveClass,
  segmentedButtonClass,
  segmentedContainerClass,
  stageColors,
  stageIsNormal,
  columnClass,
  dragHandleSurfaceClass,
  dragOverlayCardClass,
  comboboxTriggerClass,
  columnHeaderCardClass,
  iconButtonClass,
  proportionTrackClass,
  primaryButtonClass,
} from './board-ui';
import {
  aggregatesFromLeads,
  boardStages,
  daysInCurrentStage,
  leadIsConverted,
  leadIsUnassigned,
  leadsInStage,
  resolveStageAggregates,
  stageAggregate,
  sumStageAggregates,
} from './calculations';
import {
  CONTACT_LEAD_COPY,
  CONTACT_LIST_HEADERS,
  leadBirthdayLabel,
  leadContactLine,
} from './contact-lead';
import { LEAD_DELETE_COPY } from './delete-copy';
import { LeadCard, UnassignedLeadMarker } from './LeadCard';
import { LeadsFunnelView } from './LeadsFunnelView';
import { MoveLeadDialog } from './MoveLeadDialog';
import type { LeadStageSummary, SalesOpsLead, SalesOpsLeadStage } from './types';

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
  /**
   * The server's per-stage totals (`GET /leads/summary`) for exactly the set this
   * board may show, loaded or not. Absent (pending, failed) means the figures
   * fall back to `leads`. Never a reason to wait: the cards render regardless.
   */
  stageSummary?: LeadStageSummary;
  lookups: LabelLookups;
  now: Date;
  /** Emitted once per confirmed move. The container hands this to `useMoveLead`. */
  onMoveLead: (payload: MoveLeadPayload) => void;
  movePending?: boolean;
  onCreateLead?: () => void;
  onEditLead?: (lead: SalesOpsLead) => void;
  /**
   * Asks for the delete confirmation of a NON-converted lead: the card's kebab
   * menu (and right-click) and the Lista's `Excluir` call it. The container owns
   * the confirmation and the mutation. Absent means no delete affordance at all.
   */
  onDeleteLead?: (lead: SalesOpsLead) => void;
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
  /** 'contact' in the leads edition. Default 'full' renders today's board. */
  fieldSet?: LeadFieldSet;
  /** Leads edition empty-state: true shows the gestor copy and action, false the vendedor copy. */
  canManageStages?: boolean;
  /** Leads edition empty-state action. Absent means no button. */
  onOpenStagesCadastro?: () => void;
};

const ALL_SELLERS_VALUE = '';

type SortableCardProps = {
  lead: SalesOpsLead;
  lookups: LabelLookups;
  now: Date;
  onEdit?: (lead: SalesOpsLead) => void;
  onDelete?: (lead: SalesOpsLead) => void;
  onOpenSale?: (saleId: string) => void;
  showDaysBadge?: boolean;
  fieldSet?: LeadFieldSet;
};

/**
 * The drag plumbing for ONE movable card, isolated here so `LeadCard` stays free
 * of dnd-kit entirely and can be rendered by any oracle without a `DndContext`.
 */
function SortableLeadCard({
  lead,
  lookups,
  now,
  onEdit,
  onDelete,
  onOpenSale,
  showDaysBadge,
  fieldSet,
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
        onDelete={onDelete}
        onEdit={onEdit}
        fieldSet={fieldSet}
        onOpenSale={onOpenSale}
        showDaysBadge={showDaysBadge}
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
function StageDropZone({
  stageId,
  dotColor,
  children,
}: {
  stageId: string;
  dotColor: string;
  children: React.ReactNode;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: stageId });
  return (
    <div
      className="flex min-h-[72px] flex-col gap-2 rounded-md transition-colors"
      data-stage-dropzone={stageId}
      ref={setNodeRef}
      style={
        isOver
          ? { backgroundColor: 'rgba(255,255,255,0.6)', outline: `1.5px solid ${dotColor}` }
          : undefined
      }
    >
      {children}
    </div>
  );
}

export function LeadsBoard({
  stages,
  leads,
  stageSummary,
  lookups,
  now,
  onMoveLead,
  movePending = false,
  onCreateLead,
  onEditLead,
  onDeleteLead,
  onRequestConversion,
  onOpenSale,
  sellerFilter,
  hasMore = false,
  onLoadMore,
  loadingMore = false,
  fieldSet = 'full',
  canManageStages = false,
  onOpenStagesCadastro,
}: LeadsBoardProps) {
  /**
   * THE CARD'S VISUAL MOVE WHILE THE PROPOSTA WIZARD IS OPEN.
   *
   * Dragging onto the conversion stage no longer detours through the `Mover
   * para` dialog: the wizard opens straight away, and this holds the card in the
   * destination column meanwhile so the board reflects what the operator just
   * did. It is LOCAL and never persisted - no request is issued and no cache is
   * patched until `POST /sales` answers 201, so a cancelled wizard still leaves
   * nothing behind. It only removes the lie of a card sitting in its old column
   * while its proposta is being filled in.
   */
  const [pendingConversion, setPendingConversion] = React.useState<MoveLeadPayload | null>(null);

  const columns = React.useMemo(() => boardStages(stages), [stages]);
  // The leads edition shows contact data in the Lista and the Cliente on the
  // card; every R$ figure renders in both editions. An org with no active etapa
  // gets an empty-state instead of an empty scroller.
  const contact = fieldSet === 'contact';
  const noStages = contact && columns.length === 0;

  const [leadView, setLeadView] = React.useState<'board' | 'list' | 'funnel'>('board');
  const [rawStageFilter, setLeadStageFilter] = React.useState<string>('');
  // An archived stage drops out of `columns`; the filter then reads as "all"
  // (derived, so no effect-driven reset is needed).
  const leadStageFilter = columns.some((s) => s.id === rawStageFilter) ? rawStageFilter : '';

  const colors = React.useMemo(() => stageColors(columns), [columns]);
  /*
    `moveLeadInList` is the SAME primitive the optimistic cache patch uses, so the
    preview and the real move cannot disagree about where the card lands.
  */
  const visibleLeads = React.useMemo(
    () =>
      pendingConversion
        ? moveLeadInList(leads, pendingConversion, new Date().toISOString())
        : leads,
    [leads, pendingConversion],
  );

  /*
    THE per-stage figures every surface reads: the column badge, R$ total,
    `% do total` and bar, the Lista chips and footer, the Funil and the
    load-more total. The server summary counts every live lead in scope,
    loaded or not; until it arrives the loaded cards answer, so a slow summary
    shows the old numbers and never a 0. A card held in the conversion column
    while the wizard is open shifts the summary through the same primitive the
    optimistic move uses.
  */
  const displayedSummary = React.useMemo(
    () => summaryWithPendingMove(stageSummary, leads, pendingConversion),
    [stageSummary, leads, pendingConversion],
  );
  const { aggregates, fromServer } = React.useMemo(
    () => resolveStageAggregates(displayedSummary, visibleLeads),
    [displayedSummary, visibleLeads],
  );
  // Summed over the drawn columns only: a summary row for an archived stage
  // never reaches a board total.
  const allStages = React.useMemo(
    () => sumStageAggregates(columns, aggregates),
    [columns, aggregates],
  );
  const totalGeral = allStages.totalBrl;
  const shareByStage = (stageId: string) =>
    totalGeral > 0
      ? Math.round((stageAggregate(aggregates, stageId).totalBrl / totalGeral) * 100)
      : 0;
  const orderedLeads = React.useMemo(
    () =>
      columns
        .filter((stage) => !leadStageFilter || stage.id === leadStageFilter)
        .flatMap((stage) => leadsInStage(leads, stage.id)),
    [columns, leads, leadStageFilter],
  );
  const listScope = leadStageFilter ? stageAggregate(aggregates, leadStageFilter) : allStages;
  const listTotalCents = listScope.totalBrl;
  const listCount = listScope.count;
  // How many cards are on screen, for the honest load-more label.
  const loadedCount = React.useMemo(
    () => sumStageAggregates(columns, aggregatesFromLeads(leads)).count,
    [columns, leads],
  );
  const scopeLabel = leadStageFilter
    ? (columns.find((s) => s.id === leadStageFilter)?.name ?? ALL_PHASES_LABEL)
    : ALL_PHASES_LABEL;
  const fmtBrl0 = (cents: number) =>
    formatMoneyBrl(cents, { minimumFractionDigits: 0, maximumFractionDigits: 0 });
  const hasConversionHandler = Boolean(onRequestConversion);

  /**
   * The card currently under the cursor, held ONLY to render the DragOverlay.
   * It is presentation state and never a source of truth: no move is decided
   * from it, `handleDragEnd` still reads the event.
   */
  const [activeLeadId, setActiveLeadId] = React.useState<string | null>(null);
  const activeLead =
    activeLeadId === null ? null : (visibleLeads.find((row) => row.id === activeLeadId) ?? null);

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
        // Show the card where the operator dropped it while they fill in the
        // wizard. Purely local - see `pendingConversion`.
        setPendingConversion(payload);
        let saleId: string | null = null;
        try {
          saleId = await onRequestConversion({
            lead: row,
            toStageId: payload.toStageId,
            toIndex: payload.toIndex,
          });
        } finally {
          // Both outcomes clear it. Cancelled, the card springs back to its
          // original column because nothing else ever changed. Saved, the real
          // optimistic patch from `onMoveLead` takes over the same position.
          setPendingConversion(null);
        }
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

    // A drag has nowhere to TYPE, so the `Perdido` stage - and only that stage -
    // still hands back to the dialog: its reason is required by the API and
    // blocked in the UI before the request is built.
    //
    // Conversion deliberately does NOT hand back any more. It used to, on the
    // reasoning that a drag cannot fill a wizard, which was wrong: the wizard
    // opens itself. Routing through `Mover para` only asked the operator to
    // confirm a destination they had just dropped the card on.
    if (dragHandsBackToDialog(target)) {
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
        <div className="flex items-center gap-2.5">
          <div
            aria-label="Alternar visualização"
            className={segmentedContainerClass}
            data-view-toggle="true"
            role="group"
          >
            <button
              aria-pressed={leadView === 'board'}
              className={`${segmentedButtonClass}${leadView === 'board' ? ' ' + segmentedButtonActiveClass : ''}`}
              data-view-option="board"
              onClick={() => setLeadView('board')}
              type="button"
            >
              <SquareKanban aria-hidden size={15} /> {BOARD_VIEW_LABEL.board}
            </button>
            <button
              aria-pressed={leadView === 'list'}
              className={`${segmentedButtonClass}${leadView === 'list' ? ' ' + segmentedButtonActiveClass : ''}`}
              data-view-option="list"
              onClick={() => setLeadView('list')}
              type="button"
            >
              <List aria-hidden size={15} /> {BOARD_VIEW_LABEL.list}
            </button>
            <button
              aria-pressed={leadView === 'funnel'}
              className={`${segmentedButtonClass}${leadView === 'funnel' ? ' ' + segmentedButtonActiveClass : ''}`}
              data-view-option="funnel"
              onClick={() => setLeadView('funnel')}
              type="button"
            >
              <Filter aria-hidden size={15} /> {BOARD_VIEW_LABEL.funnel}
            </button>
          </div>
          {sellerFilter ? (
            <div className="w-[220px]">
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
          ) : null}
        </div>
        {onCreateLead ? (
          <button
            className={`${primaryButtonClass} gap-1.5`}
            disabled={noStages}
            onClick={onCreateLead}
            type="button"
          >
            <Plus aria-hidden size={16} /> Novo lead
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
      {noStages ? (
        <div
          className="flex min-h-[220px] flex-col items-center justify-center gap-3 rounded-[18px] border-[1.5px] border-dashed border-[#e8e8ec] p-8 text-center"
          data-no-stages={canManageStages ? 'admin' : 'seller'}
        >
          <p className="text-[14px] text-[#57575f]">
            {canManageStages ? CONTACT_LEAD_COPY.emptyStagesAdmin : CONTACT_LEAD_COPY.emptyStagesSeller}
          </p>
          {canManageStages && onOpenStagesCadastro ? (
            <button
              className={primaryButtonClass}
              data-open-stages-cadastro
              onClick={onOpenStagesCadastro}
              type="button"
            >
              {CONTACT_LEAD_COPY.emptyStagesAdminAction}
            </button>
          ) : null}
        </div>
      ) : leadView === 'board' ? (
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
            // `visibleLeads`, so a card being converted shows in its destination
            // column while the wizard is open.
            const column = leadsInStage(visibleLeads, stage.id);
            const movableIds = column
              .filter((row) => !leadIsConverted(row))
              .map((row) => row.id);

            const c = colors.get(stage.id);
            const share = shareByStage(stage.id);

            return (
              <section
                className={columnClass}
                style={{ backgroundColor: c?.soft, borderColor: c?.border }}
                data-stage-column={stage.id}
                key={stage.id}
                {...(stageOpensConversion(stage) ? { 'data-conversion-column': 'true' } : {})}
              >
                <header className={columnHeaderCardClass}>
                  <div className="flex items-center gap-2">
                    <span
                      className="h-[9px] w-[9px] shrink-0 rounded-full"
                      style={{ backgroundColor: c?.dot }}
                    />
                    <span className="flex-1 truncate text-[13.5px] font-bold text-[#201f24]">
                      {stage.name}
                    </span>
                    <span
                      className="inline-flex min-w-[24px] shrink-0 justify-center whitespace-nowrap rounded-full px-2 py-0.5 text-[11.5px] font-bold tabular-nums"
                      data-stage-count
                      style={{ backgroundColor: c?.soft, color: c?.ink }}
                    >
                      {stageAggregate(aggregates, stage.id).count}
                    </span>
                    <button
                      aria-label={`${VIEW_IN_LIST_LABEL}: ${stage.name}`}
                      className={iconButtonClass}
                      data-view-in-list={stage.id}
                      onClick={() => {
                        setLeadStageFilter(stage.id);
                        setLeadView('list');
                      }}
                      type="button"
                    >
                      <List aria-hidden size={15} />
                    </button>
                  </div>
                  <div className="mt-2 flex items-baseline justify-between gap-2">
                    <span className="sales-ops-num text-[20px] font-bold text-[#201f24]" data-stage-total>
                      {fmtBrl0(stageAggregate(aggregates, stage.id).totalBrl)}
                    </span>
                    <span className="shrink-0 whitespace-nowrap text-[11.5px] font-semibold text-[#9b9ba3]">
                      {PERCENT_OF_TOTAL(share)}
                    </span>
                  </div>
                  <div className={`mt-2 ${proportionTrackClass}`}>
                    <div
                      className="h-full rounded-full"
                      data-stage-bar
                      style={{ width: `${share}%`, backgroundColor: c?.dot }}
                    />
                  </div>
                </header>

                <SortableContext items={movableIds} strategy={verticalListSortingStrategy}>
                  <StageDropZone dotColor={c?.dot ?? '#cfcfd6'} stageId={stage.id}>
                    {column.map((lead) => {
                      const targets = moveTargetsFor(lead, columns, hasConversionHandler);
                      if (targets.length === 0) {
                        return (
                          <LeadCard
                            fieldSet={fieldSet}
                            key={lead.id}
                            lead={lead}
                            lookups={lookups}
                            now={now}
                            onDelete={onDeleteLead}
                            onEdit={onEditLead}
                            onOpenSale={onOpenSale}
                            showDaysBadge={stageIsNormal(stage) && !leadIsConverted(lead)}
                          />
                        );
                      }
                      return (
                        <SortableLeadCard
                          fieldSet={fieldSet}
                          key={lead.id}
                          lead={lead}
                          lookups={lookups}
                          now={now}
                          onDelete={onDeleteLead}
                          onEdit={onEditLead}
                          onOpenSale={onOpenSale}
                          showDaysBadge={stageIsNormal(stage) && !leadIsConverted(lead)}
                        />
                      );
                    })}
                    {column.length === 0 ? (
                      <div
                        className="flex min-h-[80px] items-center justify-center rounded-lg border-[1.5px] border-dashed p-3 text-center text-[12.5px] text-[#9b9ba3]"
                        data-empty-column={stage.id}
                        style={{ borderColor: c?.border }}
                      >
                        {EMPTY_COLUMN_HINT}
                      </div>
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
              {/*
                `onDelete` only so the lifted copy keeps the kebab's slot and is a
                pixel clone of the card it lifts; nothing can reach its menu
                mid-drag.
              */}
              <LeadCard
                fieldSet={fieldSet}
                lead={activeLead}
                lookups={lookups}
                now={now}
                onDelete={onDeleteLead}
                showDaysBadge={false}
              />
            </div>
          ) : null}
        </DragOverlay>
      </DndContext>
      ) : leadView === 'funnel' ? (
        <LeadsFunnelView aggregates={aggregates} stages={stages} />
      ) : (
        <div className="flex flex-col gap-4" data-leads-list="true">
          <div className="flex flex-wrap gap-2">
            <button
              aria-pressed={leadStageFilter === ''}
              className={phaseChipClassName(leadStageFilter === '')}
              data-phase-chip=""
              onClick={() => setLeadStageFilter('')}
              type="button"
            >
              <span>{ALL_PHASES_LABEL}</span>
              <span className="sales-ops-num">{fmtBrl0(totalGeral)}</span>
              <span className="tabular-nums" data-phase-count>
                {allStages.count}
              </span>
            </button>
            {columns.map((stage) => {
              const color = colors.get(stage.id);
              return (
                <button
                  aria-pressed={leadStageFilter === stage.id}
                  className={phaseChipClassName(leadStageFilter === stage.id)}
                  data-phase-chip={stage.id}
                  key={stage.id}
                  onClick={() => setLeadStageFilter(stage.id)}
                  type="button"
                >
                  <span
                    className="inline-block h-2 w-2 rounded-full"
                    style={{ backgroundColor: color?.dot }}
                  />
                  <span>{stage.name}</span>
                  <span className="sales-ops-num opacity-75">
                    {fmtBrl0(stageAggregate(aggregates, stage.id).totalBrl)}
                  </span>
                  <span
                    className="inline-flex min-w-[20px] justify-center rounded-full px-1.5 text-[11px] font-semibold tabular-nums"
                    data-phase-count
                    style={{ backgroundColor: color?.soft, color: color?.ink }}
                  >
                    {stageAggregate(aggregates, stage.id).count}
                  </span>
                </button>
              );
            })}
          </div>

          <div className={listTableCardClass}>
            <div className="min-w-[900px]">
              <table className="w-full border-collapse text-left text-[13px]">
                <thead className={listTheadClass}>
                  {contact ? (
                    <tr>
                      <th className="px-4 py-2.5">{CONTACT_LIST_HEADERS.lead}</th>
                      <th className="px-4 py-2.5">{CONTACT_LIST_HEADERS.phase}</th>
                      <th className="px-4 py-2.5">{CONTACT_LIST_HEADERS.birthday}</th>
                      <th className="px-4 py-2.5">{CONTACT_LIST_HEADERS.seller}</th>
                      <th className="px-4 py-2.5">{CONTACT_LIST_HEADERS.inStage}</th>
                      <th className="px-4 py-2.5 text-right">{LIST_HEADERS.value}</th>
                      <th className="px-4 py-2.5 text-right">{CONTACT_LIST_HEADERS.actions}</th>
                    </tr>
                  ) : (
                    <tr>
                      <th className="px-4 py-2.5">{LIST_HEADERS.lead}</th>
                      <th className="px-4 py-2.5">{LIST_HEADERS.phase}</th>
                      <th className="px-4 py-2.5">{LIST_HEADERS.products}</th>
                      <th className="px-4 py-2.5">{LIST_HEADERS.seller}</th>
                      <th className="px-4 py-2.5">{LIST_HEADERS.inStage}</th>
                      <th className="px-4 py-2.5 text-right">{LIST_HEADERS.value}</th>
                      <th className="px-4 py-2.5 text-right">{LIST_HEADERS.actions}</th>
                    </tr>
                  )}
                </thead>
                <tbody>
                  {orderedLeads.map((row) => {
                    const rowStage = columns.find((s) => s.id === row.stageId);
                    const color = colors.get(row.stageId);
                    const converted = leadIsConverted(row);
                    const showBadge = rowStage ? stageIsNormal(rowStage) && !converted : false;
                    const days = daysInCurrentStage(row.stageChangedAt, now);
                    const products = contact ? [] : leadProductLabels(row, lookups);
                    const birthday = contact ? leadBirthdayLabel(row) : null;
                    const sellerLabel = leadSellerLabel(row, lookups);
                    return (
                      <tr className={listRowClass} data-list-row={row.id} key={row.id}>
                        <td className="px-4 py-3">
                          <div className="font-semibold text-[#201f24]">{row.contactName}</div>
                          {contact ? (
                            <div className="text-[12.5px] text-[#8b8b92]" data-row-contact>
                              {leadContactLine(row)}
                            </div>
                          ) : (
                            <div className="text-[12.5px] text-[#8b8b92]">
                              {leadCompanyLabel(row, lookups)}
                            </div>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          <span
                            className="inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[12px] font-semibold"
                            data-row-phase={row.stageId}
                            style={{ backgroundColor: color?.soft, color: color?.ink }}
                          >
                            <span
                              className="inline-block h-1.5 w-1.5 rounded-full"
                              style={{ backgroundColor: color?.dot }}
                            />
                            {rowStage?.name}
                          </span>
                        </td>
                        {contact ? (
                          <td className="px-4 py-3" data-row-birthday>
                            {birthday ?? NO_PRODUCTS_DASH}
                          </td>
                        ) : (
                          <td className="px-4 py-3">
                            {products.length > 0 ? products.join(', ') : NO_PRODUCTS_DASH}
                          </td>
                        )}
                        <td className="px-4 py-3">
                          {leadIsUnassigned(row) ? (
                            <UnassignedLeadMarker />
                          ) : (
                            <span className="inline-flex items-center gap-2">
                              <span className={avatarClass}>{avatarInitials(sellerLabel)}</span>
                              {sellerLabel}
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          {showBadge ? (
                            <span
                              className={`${daysBadgeClass} ${dayBadgeTone(days)}`}
                              data-days-in-stage={days}
                            >
                              {describeDaysInStage(days)}
                            </span>
                          ) : (
                            NO_PRODUCTS_DASH
                          )}
                        </td>
                        <td className="px-4 py-3 text-right">
                          <span className="sales-ops-num font-bold">
                            {fmtBrl0(row.estimatedValueBrl)}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center justify-end gap-2">
                            {converted && onOpenSale && row.saleCode && row.saleId ? (
                              <button
                                className={listActionButtonClass}
                                data-open-sale={row.saleId}
                                onClick={() => onOpenSale(row.saleId!)}
                                type="button"
                              >
                                <span className="font-mono">{row.saleCode}</span>
                              </button>
                            ) : null}
                            {!converted ? (
                              <button
                                className={listActionButtonClass}
                                data-move-trigger={row.id}
                                onClick={() => openMoveDialog(row)}
                                type="button"
                              >
                                {MOVE_LABEL}
                              </button>
                            ) : null}
                            <button
                              className={listActionButtonClass}
                              data-edit-lead={row.id}
                              onClick={() => onEditLead?.(row)}
                              type="button"
                            >
                              {EDIT_LABEL}
                            </button>
                            {!converted && onDeleteLead ? (
                              <button
                                className={listDangerActionButtonClass}
                                data-delete-lead={row.id}
                                onClick={() => onDeleteLead(row)}
                                type="button"
                              >
                                {LEAD_DELETE_COPY.menuLabel}
                              </button>
                            ) : null}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                  {orderedLeads.length === 0 ? (
                    <tr>
                      <td className="px-4 py-6 text-center text-[#8b8b92]" colSpan={7}>
                        {EMPTY_PHASE_LIST}
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
            <div className={listFooterClass}>
              <span>{scopeLeadsCount(scopeLabel, listCount)}</span>
              <span className="flex items-center gap-2">
                <span>{TOTAL_LABEL}</span>
                <span className="sales-ops-num" data-list-total>
                  {fmtBrl0(listTotalCents)}
                </span>
              </span>
            </div>
          </div>
        </div>
      )}

      {hasMore ? (
        <footer>
          <button
            className={cardButtonClass}
            data-load-more
            disabled={loadingMore}
            onClick={onLoadMore}
            type="button"
          >
            {loadMoreLabel(loadedCount, fromServer ? allStages.count : null)}
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
