import * as React from 'react';
import { useRecordSalesOpsSettlement, useReverseSalesOpsSettlement, useSaleSettlements } from '../hooks';
import { MarkPaidDialog } from './MarkPaidDialog';
import { ReverseSettlementDialog } from './ReverseSettlementDialog';
import { SettlementHistoryDialog } from './SettlementHistory';
import { activeBaixasFor, formatCivilDay, type SettlementTarget } from './settlement-format';
import { paidOnNoteClass, rowActionButtonClass } from './settlement-ui';

/**
 * `Pago em DD/MM/AAAA` under a paid row's badge, for EVERY viewer: it is a fact
 * about the row, read from the bootstrap's reducer-backed `paidOn` and formatted
 * by string. Pure, no hooks.
 */
export function PaidOnNote({
  status,
  paidOn,
}: {
  status: 'open' | 'paid' | 'void';
  paidOn: string | null | undefined;
}) {
  if (status !== 'paid' || !paidOn) return null;
  return (
    <span className={paidOnNoteClass} data-paid-on="true">
      Pago em {formatCivilDay(paidOn)}
    </span>
  );
}

type OpenDialog = 'mark-paid' | 'reverse' | 'history' | null;

/**
 * The admin row actions of one receivable or payable. The CALLER decides who is
 * an admin and mounts this only then; the server's `requireAdmin` stays the real
 * gate. Which action shows is a pure function of the row and its proposta:
 * `Marcar como pago` on an open row of a won proposta, `Estornar` on a paid row
 * that has a `paidOn`, nothing on a void row.
 *
 * The wrapper stops click propagation, which also covers the portalled dialogs
 * (React events bubble through the component tree), so no click here ever
 * reaches a table row's `onClick`.
 */
export function SettlementRowActions({
  target,
  withHistory,
}: {
  target: SettlementTarget;
  withHistory: boolean;
}) {
  const [openDialog, setOpenDialog] = React.useState<OpenDialog>(null);
  const record = useRecordSalesOpsSettlement();
  const reverse = useReverseSalesOpsSettlement();
  const history = useSaleSettlements(target.saleId, openDialog === 'reverse');

  if (target.status === 'void') return null;
  const canMarkPaid = target.status === 'open' && target.saleStatus === 'won';
  const canReverse = target.status === 'paid' && target.paidOn !== null;
  if (!canMarkPaid && !canReverse && !withHistory) return null;

  const close = (open: boolean) => {
    if (!open) setOpenDialog(null);
  };

  return (
    <div className="flex flex-wrap items-center gap-1.5" onClick={(event) => event.stopPropagation()}>
      {canMarkPaid ? (
        <button
          className={rowActionButtonClass}
          data-settlement-action="mark-paid"
          onClick={() => setOpenDialog('mark-paid')}
          type="button"
        >
          Marcar como pago
        </button>
      ) : null}
      {canReverse ? (
        <button
          className={rowActionButtonClass}
          data-settlement-action="reverse"
          onClick={() => setOpenDialog('reverse')}
          type="button"
        >
          Estornar
        </button>
      ) : null}
      {withHistory ? (
        <button
          className={rowActionButtonClass}
          data-settlement-action="history"
          onClick={() => setOpenDialog('history')}
          type="button"
        >
          Histórico
        </button>
      ) : null}

      {openDialog === 'mark-paid' ? (
        <MarkPaidDialog
          key={target.id}
          onConfirm={(payload) => record.mutateAsync(payload)}
          onOpenChange={close}
          open
          target={target}
        />
      ) : null}
      {openDialog === 'reverse' ? (
        <ReverseSettlementDialog
          activeBaixa={activeBaixasFor(history.data ?? [], target)[0] ?? null}
          key={target.id}
          loading={history.isLoading}
          onConfirm={(payload) => reverse.mutateAsync(payload)}
          onOpenChange={close}
          open
          target={target}
        />
      ) : null}
      {openDialog === 'history' ? (
        <SettlementHistoryDialog
          descriptions={new Map([[target.id, target.description]])}
          key={target.id}
          onOpenChange={close}
          open
          target={target}
        />
      ) : null}
    </div>
  );
}
