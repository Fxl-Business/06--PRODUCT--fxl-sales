import * as React from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { todayInSaoPaulo } from '@fxl-sales/shared-utils/sao-paulo-day';
import { useAuthProfile } from '@/auth/react';
import type { ComboboxOption } from '@/components/ui/combobox';
import { Skeleton } from '@/components/ui/skeleton';
import { buildSalesOpsPath, type SalesOpsWorkspace } from '../navigation';
import type { SalesOpsClient, SalesOpsProduct } from '../types';
import type { LeadWritePayload } from './api';
import { useSaveLead, useDeleteLead } from './hooks';
import { useFieldDefinitions, useLeadSummary } from './crm-hooks';
import { leadIsConverted } from './calculations';
import { mutedStateClass, secondaryButtonClass } from './board-ui';
import { LeadDeleteDialog } from './LeadDeleteDialog';
import { LeadForm } from './LeadForm';
import { CLIENTE_FIELD_KEY, leadToWriteSeed } from './lead-form';
import { LeadSummary } from './LeadSummary';
import { isLeadSummaryOpenedInApp } from './lead-summary-nav';
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
}: LeadSummaryContainerProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const isAdmin = useAuthProfile().roles.includes('admin');
  const summaryQuery = useLeadSummary(leadId);
  const definitionsQuery = useFieldDefinitions();
  const saveLead = useSaveLead();
  const deleteLead = useDeleteLead();
  const undo = useUndoNotice();
  const [editOpen, setEditOpen] = React.useState(false);
  const [deleteOpen, setDeleteOpen] = React.useState(false);
  // Stable per mount, as on the board: the day counters need days, not milliseconds.
  const today = React.useMemo(() => todayInSaoPaulo(), []);
  const now = React.useMemo(() => new Date(), []);

  const summary = summaryQuery.data;
  const lead = summary?.lead;
  const definitions = definitionsQuery.data ?? [];
  const backPath = buildSalesOpsPath({ workspace, view: 'funil' });

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
    undo.publish('Lead editado', async () => {
      await requireUnchangedLead(result.lead);
      return saveLead.mutateAsync(leadToWriteSeed(previous, added));
    });
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
        onBack={goBack}
        onEdit={() => setEditOpen(true)}
        onOpenSale={onOpenSale}
        summary={summary}
        today={today}
      />
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
