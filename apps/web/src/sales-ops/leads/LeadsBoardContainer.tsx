import * as React from 'react';
import { useNavigate } from 'react-router-dom';
import { type LeadFieldSet, leadFieldSet } from '@fxl-sales/shared-utils/sales-edition';
import { useAuthProfile, useSalesEdition } from '@/auth/react';
import type { ComboboxOption } from '@/components/ui/combobox';
import { Skeleton } from '@/components/ui/skeleton';
import { buildLeadStagePath, buildSalesOpsPath, type SalesOpsWorkspace } from '../navigation';
import type { SalesOpsClient, SalesOpsPerson, SalesOpsProduct } from '../types';
import type { MoveLeadPayload, SaveContactLeadPayload, SaveLeadPayload } from './api';
import { buildLabelLookups } from './board-labels';
import { stageOpensConversion } from './board-move';
import { mutedStateClass } from './board-ui';
import { boardStages, leadIsConverted } from './calculations';
import { ContactLeadDialog } from './ContactLeadDialog';
import { leadToContactSeed } from './contact-lead';
import { LeadDeleteDialog } from './LeadDeleteDialog';
import { LeadDialog } from './LeadDialog';
import { LeadsBoard, type LeadConversionRequest } from './LeadsBoard';
import { RestoreUndoNotice, UndoNotice } from './UndoNotice';
import {
  useDeleteLead,
  useLeadsBoard,
  useLeadStageSummary,
  useLeadStages,
  useMoveLead,
  useSaveLead,
} from './hooks';
import type { LeadBoardFilters, SalesOpsLead } from './types';

/**
 * The ONLY file in this slice that names a hook. Everything above it -
 * `LeadsBoard`, `LeadCard`, `MoveLeadDialog`, `LeadDialog` - is pure props in,
 * callbacks out, which is what lets every board oracle drive the real components
 * with no query client at all.
 *
 * It classifies no auth or entitlement failure: `SalesOpsApp` already owns that
 * chain one level up, and a second classifier would be a second gate.
 */

const BOARD_LOAD_FAILED = 'Não foi possível carregar o funil de leads.';
const SELLER_PERSON_UNMAPPED =
  'Seu acesso ainda não está vinculado a um vendedor. Peça ao gestor para conferir seu cadastro em Vendedores.';
const UNDO_CONFLICT = 'Este lead foi alterado por outra pessoa. Atualize o funil antes de desfazer.';

class UndoConflictError extends Error {}

function sameLeadSnapshot(current: SalesOpsLead | undefined, expected: SalesOpsLead): boolean {
  // The response to the forward write is the expected server state. A fresh
  // board read must still match it before a compensating write can be offered.
  // Comparing the whole wire row also detects changes outside this edition.
  return current !== undefined && JSON.stringify(current) === JSON.stringify(expected);
}

/**
 * The board read failure copy. Only the leads edition names the one refusal an
 * operator can fix: `403 {reason:'seller_person_unmapped'}`, which survives the
 * server's auto-provision only when the cadastro is ambiguous (two pessoas, an
 * inactive one) or the token carries no e-mail. Keyed on the status plus
 * `ApiError.reason`, like every other leads-edition refusal. The full edition
 * keeps the generic copy byte-for-byte.
 */
function boardLoadErrorCopy(error: unknown, fieldSet: LeadFieldSet): string {
  if (
    fieldSet === 'contact' &&
    typeof error === 'object' &&
    error !== null &&
    (error as { status?: unknown }).status === 403 &&
    (error as { reason?: unknown }).reason === 'seller_person_unmapped'
  ) {
    return SELLER_PERSON_UNMAPPED;
  }
  return BOARD_LOAD_FAILED;
}

export type LeadsBoardContainerProps = {
  routedMode?: 'board' | 'stage';
  selectedStageId?: string;
  workspace?: SalesOpsWorkspace;
  clients: SalesOpsClient[];
  people: SalesOpsPerson[];
  products: SalesOpsProduct[];
  /** Built by the routing layer with `hasFuncao(person, FUNCAO_SLUG_VENDEDOR)`. */
  sellers: ComboboxOption[];
  /**
   * Whether to OFFER the vendedor narrowing filter. `true` under `operacional`
   * (the team board), `false` under `meus-dados`.
   *
   * It is NOT a scope switch and must never be read as one. A seller's board is
   * narrowed SERVER-side inside `withTenant` from the verified token; this boolean
   * only decides whether an admin is offered a control, and setting it `true` for
   * a seller would add a picker, not data.
   *
   * The STATE behind it lives here and not in `SalesOpsApp.tsx`, unlike
   * `productKind`: that one is hoisted because the shell's header action READS it,
   * and nothing in the shell chrome reads this one. It is component state and not
   * URL state for the same reason `productKind` is - the URL is the source of
   * truth for the painel and the page, and a narrowing filter is neither.
   */
  showSellerFilter?: boolean;
  /** Forwarded verbatim to `LeadsBoard`. The conversion flow's entire attachment surface. */
  onRequestConversion?: (request: LeadConversionRequest) => Promise<string | null>;
  /** Opens the proposta a converted lead became. Forwarded verbatim. */
  onOpenSale?: (saleId: string) => void;
  /**
   * Leads edition only: create a client by name inline from the contact dialog's
   * empresa picker. Owned by `SalesOpsApp` (the one client-create seam), so this
   * container keeps naming only leads hooks. Absent means the Criar row is hidden.
   */
  onCreateClient?: (name: string) => Promise<ComboboxOption | null>;
};

/** The edit path maps a rendered lead back into the write payload the dialog seeds from. */
function leadToSeed(lead: SalesOpsLead): SaveLeadPayload {
  return {
    id: lead.id,
    contactName: lead.contactName,
    clientId: lead.clientId,
    clientName: lead.clientNameSnapshot,
    estimatedValueBrl: lead.estimatedValueBrl,
    description: lead.description,
    sellerPersonId: lead.sellerPersonId,
    products: lead.products.map((row) =>
      row.productId ? { productId: row.productId } : { productName: row.productNameSnapshot },
    ),
  };
}

export function LeadsBoardContainer({
  routedMode,
  selectedStageId,
  workspace,
  clients,
  people,
  products,
  sellers,
  showSellerFilter = false,
  onRequestConversion,
  onOpenSale,
  onCreateClient,
}: LeadsBoardContainerProps) {
  // The edition is read ONCE here and handed down as `fieldSet`, so every
  // presentational leads component stays free of auth hooks.
  const fieldSet = leadFieldSet(useSalesEdition());
  // One admin read serves both decisions: managing etapas and, in the leads
  // edition, being offered the vendedor picker (D-07.1b). A seller's own lead
  // is assigned to them by the API, so they are never asked to pick themselves.
  const isAdmin = useAuthProfile().roles.includes('admin');
  const canManageStages = isAdmin;
  const navigate = useNavigate();
  const [contactSeed, setContactSeed] = React.useState<SaveContactLeadPayload | null>(null);
  const [sellerPersonId, setSellerPersonId] = React.useState<string | null>(null);
  // The columns are resolved FIRST: the board query fans out one request per
  // stage and the API requires a `stageId`, so without the stage list there is
  // nothing to ask for.
  const stagesQuery = useLeadStages();
  const stages = React.useMemo(() => stagesQuery.data ?? [], [stagesQuery.data]);

  // A filter that is not OFFERED can never narrow: an operator who filters under
  // `operacional` and then opens their own board must not carry that narrowing
  // into a query the server has already scoped.
  const sellerFilterValue = showSellerFilter ? sellerPersonId : null;
  /*
    Memoized on the VALUE alone, and the same object reaches the board read, the
    move and the stage summary: the move patches the board and summary entries
    the board renders, so a mismatch would silently degrade to no optimistic
    write at all.
  */
  const filters = React.useMemo<LeadBoardFilters>(
    () => (sellerFilterValue ? { sellerPersonId: sellerFilterValue } : undefined),
    [sellerFilterValue],
  );

  const boardQuery = useLeadsBoard(stages, filters);
  const summaryQuery = useLeadStageSummary(filters);
  const moveLead = useMoveLead(filters);
  const saveLead = useSaveLead();
  const deleteLead = useDeleteLead();
  const [undoNotice, setUndoNotice] = React.useState<{
    id: number;
    label: string;
    undo?: () => Promise<unknown>;
    restoreLeadId?: string;
  } | null>(null);
  const [undoError, setUndoError] = React.useState<string | null>(null);
  const [undoBusy, setUndoBusy] = React.useState(false);
  const undoSequence = React.useRef(0);
  const undoInFlight = React.useRef(false);

  React.useEffect(() => {
    if (!undoNotice || undoBusy || undoError) return;
    const timer = window.setTimeout(() => setUndoNotice((current) =>
      current?.id === undoNotice.id ? null : current,
    ), 5000);
    return () => window.clearTimeout(timer);
  }, [undoNotice, undoBusy, undoError]);

  function publishUndo(label: string, undo: () => Promise<unknown>) {
    setUndoError(null);
    setUndoNotice({ id: ++undoSequence.current, label, undo });
  }

  function publishDeleteUndo(leadId: string) {
    setUndoError(null);
    setUndoNotice({ id: ++undoSequence.current, label: 'Lead excluído', restoreLeadId: leadId });
  }

  async function runUndo(restore?: () => Promise<unknown>) {
    if (!undoNotice || undoInFlight.current) return;
    const active = undoNotice;
    const action = restore ?? active.undo;
    if (!action) return;
    undoInFlight.current = true;
    setUndoBusy(true);
    setUndoError(null);
    try {
      await action();
      setUndoNotice((current) => current?.id === active.id ? null : current);
      setUndoError(null);
    } catch (error) {
      setUndoError(error instanceof UndoConflictError
        ? UNDO_CONFLICT
        : 'Não foi possível desfazer. Tente novamente.');
    } finally {
      undoInFlight.current = false;
      setUndoBusy(false);
    }
  }

  async function requireUnchangedLead(expected: SalesOpsLead) {
    const fresh = await boardQuery.refetch({ throwOnError: true });
    if (!sameLeadSnapshot(fresh.data?.leads.find((row) => row.id === expected.id), expected)) {
      throw new UndoConflictError(UNDO_CONFLICT);
    }
  }

  async function moveWithUndo(payload: MoveLeadPayload) {
    const rows = boardQuery.data?.leads ?? [];
    const previous = rows.find((row) => row.id === payload.leadId);
    const sourceColumn = previous
      ? rows.filter((row) => row.stageId === previous.stageId).sort((a, b) => a.position - b.position)
      : [];
    const sourceIndex = sourceColumn.findIndex((row) => row.id === payload.leadId);
    const result = await moveLead.mutateAsync(payload);
    if (!previous || sourceIndex < 0 || payload.saleId ||
      stageOpensConversion(stages.find((stage) => stage.id === payload.toStageId))) return;
    publishUndo('Lead movido', async () => {
      await requireUnchangedLead(result.lead);
      return moveLead.mutateAsync({
        leadId: payload.leadId,
        toStageId: previous.stageId,
        toIndex: sourceIndex,
        ...(previous.lostReason ? { reason: previous.lostReason } : {}),
      });
    });
  }

  async function saveWithUndo(payload: SaveLeadPayload | SaveContactLeadPayload) {
    const previous = editingLead?.id === payload.id ? editingLead : null;
    const result = await saveLead.mutateAsync(payload);
    if (previous) publishUndo('Lead editado', async () => {
      await requireUnchangedLead(result.lead);
      return saveLead.mutateAsync(
        fieldSet === 'contact' ? leadToContactSeed(previous) : leadToSeed(previous),
      );
    });
  }

  const lookups = React.useMemo(
    () => buildLabelLookups({ clients, people, products }),
    [clients, people, products],
  );

  /*
    Stable per mount. It used to be a bare `new Date()`, so every render handed
    every card a new object and defeated their memoisation - during a drag that
    is one full re-render of the board per pointer move. The badge it feeds
    counts DAYS, so a clock that advances only on remount is exact enough.
  */
  const now = React.useMemo(() => new Date(), []);

  const [dialogOpen, setDialogOpen] = React.useState(false);
  const [dialogSeed, setDialogSeed] = React.useState<SaveLeadPayload | null>(null);
  /** The lead the open edit form is editing; null while creating. */
  const [editingLead, setEditingLead] = React.useState<SalesOpsLead | null>(null);
  /** The lead whose delete confirmation is open; null when none is. */
  const [deleteTarget, setDeleteTarget] = React.useState<SalesOpsLead | null>(null);

  /*
    The edit form offers `Excluir lead` only for a lead that can be deleted: a
    converted one answers 409 and gets no button at all.
  */
  const requestDeleteFromForm =
    editingLead !== null && !leadIsConverted(editingLead)
      ? () => setDeleteTarget(editingLead)
      : undefined;

  async function confirmDelete(lead: SalesOpsLead) {
    await deleteLead.mutateAsync(lead.id);
    publishDeleteUndo(lead.id);
    // The edit dialog is modal, so a delete confirmed while it is open came from
    // it: its lead is gone, so the form closes with the confirmation.
    if (editingLead?.id === lead.id) setDialogOpen(false);
  }

  const clientOptions = React.useMemo(
    () => clients.map((row) => ({ value: row.id, label: row.name })),
    [clients],
  );
  const productOptions = React.useMemo(
    () => products.map((row) => ({ value: row.id, label: row.name })),
    [products],
  );

  // `useLeadsBoard` is disabled while there are zero stage rows, so its query
  // stays pending forever; waiting on it would leave a fresh leads-edition org
  // on the Skeleton instead of its empty-state. FXL always has stage rows, so
  // its behaviour is unchanged.
  if (stagesQuery.isPending || (stages.length > 0 && boardQuery.isPending)) {
    return <Skeleton className="h-[420px] w-full" />;
  }

  if (stagesQuery.isError || boardQuery.isError) {
    const copy = boardQuery.isError
      ? boardLoadErrorCopy(boardQuery.error, fieldSet)
      : BOARD_LOAD_FAILED;
    return <p className={mutedStateClass}>{copy}</p>;
  }

  if (routedMode === 'stage' && !boardStages(stages).some((stage) => stage.id === selectedStageId)) {
    return <p className={mutedStateClass}>Esta etapa não está disponível.</p>;
  }

  // One clock per render, handed down, so no presentational component reads it.

  return (
    <>
      <LeadsBoard
        routedMode={routedMode}
        selectedStageId={selectedStageId}
        onOpenStage={workspace ? (stageId) => navigate(buildLeadStagePath(workspace, stageId)) : undefined}
        canManageStages={canManageStages}
        fieldSet={fieldSet}
        hasMore={boardQuery.data?.hasMore ?? false}
        leads={boardQuery.data?.leads ?? []}
        loadingMore={boardQuery.isFetchingNextPage}
        lookups={lookups}
        movePending={moveLead.isPending}
        now={now}
        onCreateLead={() => {
          setDialogSeed(null);
          setContactSeed(null);
          setEditingLead(null);
          setDialogOpen(true);
        }}
        onDeleteLead={setDeleteTarget}
        onEditLead={(lead) => {
          setDialogSeed(leadToSeed(lead));
          setContactSeed(leadToContactSeed(lead));
          setEditingLead(lead);
          setDialogOpen(true);
        }}
        onLoadMore={() => {
          void boardQuery.fetchNextPage();
        }}
        onMoveLead={(payload) => { void moveWithUndo(payload).catch(() => undefined); }}
        // The leads edition has no proposta, so the board is never handed the
        // conversion door, even if a conversion-kind etapa somehow exists:
        // `moveTargetsFor` then excludes it and `emitMove` returns early.
        onOpenSale={fieldSet === 'full' ? onOpenSale : undefined}
        onOpenStagesCadastro={() =>
          navigate(buildSalesOpsPath({ workspace: 'cadastros', view: 'etapas' }))
        }
        onRequestConversion={fieldSet === 'full' ? onRequestConversion : undefined}
        {...(showSellerFilter
          ? {
              sellerFilter: {
                value: sellerPersonId,
                options: sellers,
                onChange: setSellerPersonId,
              },
            }
          : {})}
        stageSummary={summaryQuery.data}
        stages={stages}
      />

      {dialogOpen && fieldSet === 'full' ? (
        <LeadDialog
          clients={clientOptions}
          initial={dialogSeed}
          // `LeadDialog` seeds its fields at MOUNT, so the identity of what is
          // being edited has to be the identity of the component.
          key={dialogSeed?.id ?? 'novo'}
          onDelete={requestDeleteFromForm}
          onOpenChange={setDialogOpen}
          onSubmit={saveWithUndo}
          open
          pending={saveLead.isPending}
          products={productOptions}
          sellers={sellers}
        />
      ) : null}

      {dialogOpen && fieldSet === 'contact' ? (
        <ContactLeadDialog
          clients={clientOptions}
          initial={contactSeed}
          key={contactSeed?.id ?? 'novo'}
          onCreateClient={onCreateClient}
          onDelete={requestDeleteFromForm}
          onOpenChange={setDialogOpen}
          // The dialog awaits the save: it closes on success and, on a rejection
          // (400 no_open_stage included), stays open with the typed values and
          // the mapped error inline (D-07.1c).
          onSubmit={saveWithUndo}
          open
          pending={saveLead.isPending}
          sellers={sellers}
          showSellerPicker={isAdmin}
        />
      ) : null}

      {/*
        The ONE delete confirmation, for the card menu, the Lista action and both
        forms. Rendered last so it stacks above an open edit form; keyed by the
        lead so its error never leaks to the next one. The `delete:` prefix is
        load-bearing: the edit form beside it is keyed by the SAME lead id, and
        two siblings sharing a key make React keep a stale edit form mounted.
      */}
      {deleteTarget ? (
        <LeadDeleteDialog
          key={`delete:${deleteTarget.id}`}
          lead={deleteTarget}
          onConfirm={confirmDelete}
          onOpenChange={(next) => {
            if (!next) setDeleteTarget(null);
          }}
          open
        />
      ) : null}
      {undoNotice?.restoreLeadId ? (
        <RestoreUndoNotice leadId={undoNotice.restoreLeadId} busy={undoBusy} onUndo={(restore) => { void runUndo(restore); }} />
      ) : undoNotice ? <UndoNotice label={undoNotice.label} busy={undoBusy} onUndo={() => { void runUndo(); }} /> : null}
      {undoError ? <p className="fixed bottom-20 right-6 z-50 rounded-lg border bg-background px-4 py-3 text-destructive shadow-lg" role="alert">{undoError}</p> : null}
    </>
  );
}
