import * as React from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { todayInSaoPaulo } from '@fxl-sales/shared-utils/sao-paulo-day';
import { useAuthProfile } from '@/auth/react';
import type { ComboboxOption } from '@/components/ui/combobox';
import { Skeleton } from '@/components/ui/skeleton';
import { buildSalesOpsPath, type SalesOpsWorkspace } from '../navigation';
import type { SalesOpsClient, SalesOpsProduct } from '../types';
import type { LeadWritePayload } from './api';
import { AdvanceDialog } from './AdvanceDialog';
import { useSaveLead, useDeleteLead, useMoveLead } from './hooks';
import {
  useAddLeadFollowup,
  useAddLeadNote,
  useAdvanceLead,
  useFieldDefinitions,
  useLeadSummary,
  useMarkFollowupDone,
  usePipelines,
} from './crm-hooks';
import { leadIsConverted } from './calculations';
import { pickPipeline, stageOpensOrcamentos } from './crm-pipeline';
import { mutedStateClass, secondaryButtonClass } from './board-ui';
import { LeadDeleteDialog } from './LeadDeleteDialog';
import { LeadForm } from './LeadForm';
import { CLIENTE_FIELD_KEY, leadToWriteSeed } from './lead-form';
import type { LeadConversionRequest } from './LeadsBoard';
import { LeadSummary } from './LeadSummary';
import { isLeadSummaryOpenedInApp } from './lead-summary-nav';
import { FollowupComposer, NoteComposer } from './SummaryComposers';
import { UndoLayer } from './UndoLayer';
import { UNDO_CONFLICT, UndoConflictError } from './undo-conflict';
import { useUndoNotice } from './use-undo-notice';
import type { SalesOpsLead } from './types';

/*
 * The lead summary route (`/:workspace/leads/:leadId`). The ONLY file of the
 * summary that names hooks; `LeadSummary` is props in, callbacks out.
 */

const LEAD_NOT_FOUND = 'Lead não encontrado.';
const LOAD_FAILED = 'Não foi possível carregar o lead.';

export type LeadSummaryContainerProps = {
  leadId: string;
  workspace: SalesOpsWorkspace;
  clients: SalesOpsClient[];
  products: SalesOpsProduct[];
  sellers: ComboboxOption[];
  onCreateClient?: (name: string) => Promise<ComboboxOption | null>;
  onOpenSale?: (saleId: string) => void;
  /** The conversion door of the board, reused: a conversion destination opens the proposta wizard. */
  onRequestConversion?: (request: LeadConversionRequest) => Promise<string | null>;
};

function isNotFoundError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { status?: unknown }).status === 404;
}

export function LeadSummaryContainer({
  leadId,
  workspace,
  clients,
  products,
  sellers,
  onCreateClient,
  onOpenSale,
  onRequestConversion,
}: LeadSummaryContainerProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const isAdmin = useAuthProfile().roles.includes('admin');
  const summaryQuery = useLeadSummary(leadId);
  const definitionsQuery = useFieldDefinitions();
  const saveLead = useSaveLead();
  const deleteLead = useDeleteLead();
  const undo = useUndoNotice();
  const advance = useAdvanceLead();
  const addNote = useAddLeadNote();
  const addFollowup = useAddLeadFollowup();
  const markDone = useMarkFollowupDone();
  const moveLead = useMoveLead(undefined);
  const pipelinesQuery = usePipelines();
  const [editOpen, setEditOpen] = React.useState(false);
  const [deleteOpen, setDeleteOpen] = React.useState(false);
  const [advanceOpen, setAdvanceOpen] = React.useState(false);
  // Stable per mount, as on the board: the day counters need days, not milliseconds.
  const today = React.useMemo(() => todayInSaoPaulo(), []);
  const now = React.useMemo(() => new Date(), []);

  const summary = summaryQuery.data;
  const lead = summary?.lead;
  const definitions = definitionsQuery.data ?? [];
  const backPath = buildSalesOpsPath({ workspace, view: 'funil' });
  const pipeline = React.useMemo(
    () => pickPipeline(pipelinesQuery.data ?? [], summaryQuery.data?.pipeline.id ?? null),
    [pipelinesQuery.data, summaryQuery.data?.pipeline.id],
  );
  // The destinations that open the proposta: the same set the board's conversion door uses.
  const opensConversionIds = React.useMemo(
    () => new Set((pipeline?.stages ?? []).filter((stage) => stageOpensOrcamentos(stage)).map((stage) => stage.id)),
    [pipeline],
  );

  function goBack() {
    if (isLeadSummaryOpenedInApp(location.state)) navigate(-1);
    else navigate(backPath, { replace: true });
  }

  if (summaryQuery.isPending) {
    return <Skeleton className="h-[320px] w-full" />;
  }

  if (summaryQuery.isError || !summary || !lead) {
    const notFound = isNotFoundError(summaryQuery.error);
    return (
      <div className="flex flex-col items-start gap-3">
        <p className={mutedStateClass}>{notFound ? LEAD_NOT_FOUND : LOAD_FAILED}</p>
        <button className={secondaryButtonClass} onClick={goBack} type="button">
          Voltar
        </button>
      </div>
    );
  }

  /*
    The inverse of an edit is only offered while the lead is still what this edit
    left: a fresh read must equal the response to the forward write (the board's rule).
  */
  async function requireUnchangedLead(expected: SalesOpsLead) {
    const fresh = await summaryQuery.refetch({ throwOnError: true });
    if (JSON.stringify(fresh.data?.lead) !== JSON.stringify(expected)) {
      throw new UndoConflictError(UNDO_CONFLICT);
    }
  }

  async function saveWithUndo(payload: LeadWritePayload) {
    const previous = lead!;
    const result = await saveLead.mutateAsync(payload);
    // The Cliente travels as clientId, never as a field entry, so it never counts as "added".
    const previousIds = new Set((previous.fields ?? []).map((f) => f.fieldId));
    const added = (result.lead.fields ?? [])
      .filter((f) => f.key !== CLIENTE_FIELD_KEY && !previousIds.has(f.fieldId))
      .map((f) => f.fieldId);
    // The inverse omits the contact keys, so it cannot take a contact away again: an edit that
    // gives a contactless lead its first contact is not undoable (the API keeps one contact).
    const addedFirstContact = !previous.contactPhone && !previous.contactEmail
      && (Boolean(result.lead.contactPhone) || Boolean(result.lead.contactEmail));
    if (addedFirstContact) return;
    undo.publish('Lead editado', async () => {
      await requireUnchangedLead(result.lead);
      return saveLead.mutateAsync(leadToWriteSeed(previous, added));
    });
  }

  /** Resolves `true` once the proposta exists and the lead has moved; `false` when the operator cancelled the wizard. */
  async function convert(stage: { id: string }): Promise<boolean> {
    if (!onRequestConversion) throw new Error('conversion_unavailable');
    const saleId = await onRequestConversion({ lead: lead!, toStageId: stage.id, toIndex: 0 });
    if (saleId === null) return false;
    await moveLead.mutateAsync({ leadId: lead!.id, toStageId: stage.id, toIndex: 0, saleId });
    return true;
  }

  async function confirmDelete(target: SalesOpsLead) {
    await deleteLead.mutateAsync(target.id);
    // The lead is gone and this page with it, so the restore notice would die here:
    // the lead stays restorable from Cadastros > Leads excluídos.
    navigate(backPath, { replace: true });
  }

  return (
    <>
      <LeadSummary
        definitions={definitions}
        now={now}
        notesSlot={(
          <>
            <NoteComposer onAdd={(body) => addNote.mutateAsync({ leadId: lead.id, body })} pending={addNote.isPending} />
            <FollowupComposer
              onAdd={(followup) => addFollowup.mutateAsync({ leadId: lead.id, ...followup })}
              pending={addFollowup.isPending}
              today={today}
            />
          </>
        )}
        onAdvance={leadIsConverted(lead) ? undefined : () => setAdvanceOpen(true)}
        onBack={goBack}
        onEdit={() => setEditOpen(true)}
        onOpenSale={onOpenSale}
        renderFollowupAction={(followup) => (
          <button
            className={secondaryButtonClass}
            data-followup-done={followup.id}
            onClick={() => markDone.mutate(followup.id)}
            type="button"
          >
            Concluir
          </button>
        )}
        summary={summary}
        today={today}
      />
      {advanceOpen ? (
        <AdvanceDialog
          key="advance"
          leadName={lead.contactName}
          nextStages={summary.nextStages}
          onConvert={convert}
          onOpenChange={setAdvanceOpen}
          onSubmit={(payload) => advance.mutateAsync({ leadId: lead.id, ...payload })}
          open
          opensConversionIds={opensConversionIds}
          today={today}
        />
      ) : null}
      {editOpen && !definitionsQuery.isPending ? (
        <LeadForm
          clients={clients}
          definitions={definitions}
          initial={lead}
          key={lead.id}
          onCreateClient={onCreateClient}
          onDelete={leadIsConverted(lead) ? undefined : () => setDeleteOpen(true)}
          onOpenChange={setEditOpen}
          onSubmit={saveWithUndo}
          open
          pending={saveLead.isPending}
          products={products}
          sellers={sellers}
          showSellerPicker={isAdmin}
        />
      ) : null}
      {deleteOpen ? (
        <LeadDeleteDialog
          key={`delete:${lead.id}`}
          lead={lead}
          onConfirm={confirmDelete}
          onOpenChange={(next) => {
            if (!next) setDeleteOpen(false);
          }}
          open
        />
      ) : null}
      <UndoLayer undo={undo} />
    </>
  );
}
