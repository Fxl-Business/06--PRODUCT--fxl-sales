import * as React from 'react';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { formatMoneyBrl } from '../calculations';
import { useSaleSettlements } from '../hooks';
import type { SalesOpsSettlement } from '../types';
import { formatCivilDay, formatRecordedAt, type SettlementTarget } from './settlement-format';
import {
  blockedNoticeClass,
  historyBadgeBaixaClass,
  historyBadgeEstornoClass,
  mutedStateClass,
  secondaryButtonClass,
} from './settlement-ui';

/**
 * The baixas and estornos of a proposta or of one row, in the order the server
 * returns them (newest first). It names the author by the snapshotted
 * `actorName` and NEVER renders `actorUserId` or any id (CLAUDE.md, UI
 * Identifiers); the target is named from the bootstrap descriptions.
 */
export function SettlementHistoryList({
  entries,
  descriptions,
  showTarget,
}: {
  entries: readonly SalesOpsSettlement[];
  descriptions: Map<string, string>;
  showTarget: boolean;
}) {
  if (entries.length === 0) {
    return <p className={`${mutedStateClass} px-4 py-3`}>Nenhum pagamento registrado.</p>;
  }
  const reversed = new Set(
    entries
      .filter((entry) => entry.type === 'estorno' && entry.reversesSettlementId !== null)
      .map((entry) => entry.reversesSettlementId),
  );

  return (
    <ul className="divide-y divide-[#eeeef1]">
      {entries.map((entry) => {
        const isBaixa = entry.type === 'baixa';
        const rowId = entry.targetKind === 'receivable' ? entry.receivableId : entry.payableId;
        const target = rowId ? descriptions.get(rowId) : undefined;
        const wasReversed = isBaixa && (entry.reversedBySettlementId !== null || reversed.has(entry.id));
        return (
          <li
            className="flex flex-col gap-1 px-4 py-3 text-[13px] text-[#57575f]"
            data-settlement-entry={entry.type}
            key={entry.id}
          >
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <Badge className={isBaixa ? historyBadgeBaixaClass : historyBadgeEstornoClass}>
                {isBaixa ? 'Baixa' : 'Estorno'}
              </Badge>
              {wasReversed ? <span className="text-[12px] text-[#8b8b92]">Estornada</span> : null}
              {showTarget ? (
                <span className="font-semibold text-[#201f24]">{target ?? 'Linha removida'}</span>
              ) : null}
              <span className="sales-ops-num ml-auto font-bold text-[#201f24]">
                {formatMoneyBrl(entry.amountBrl)}
              </span>
            </div>
            <div className="flex flex-wrap gap-x-3 gap-y-0.5">
              <span>{`${isBaixa ? 'Pago em' : 'Estornado em'} ${formatCivilDay(entry.paidOn)}`}</span>
              <span>{entry.actorName ?? 'Autor não identificado'}</span>
              <span className="text-[#8b8b92]">{`Registrado em ${formatRecordedAt(entry.recordedAt)}`}</span>
            </div>
            {entry.reason ? (
              <p className="break-words text-[12.5px] text-[#57575f]">{`Motivo: ${entry.reason}`}</p>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}

function HistoryBody({
  query,
  entries,
  descriptions,
  showTarget,
}: {
  query: { isLoading: boolean; isError: boolean };
  entries: readonly SalesOpsSettlement[];
  descriptions: Map<string, string>;
  showTarget: boolean;
}) {
  if (query.isLoading) {
    return <p className={`${mutedStateClass} px-4 py-3`}>Carregando histórico...</p>;
  }
  if (query.isError) {
    return <p className={`${blockedNoticeClass} px-4 py-3`}>Não foi possível carregar o histórico.</p>;
  }
  return <SettlementHistoryList descriptions={descriptions} entries={entries} showTarget={showTarget} />;
}

/**
 * The sale detail's `Histórico de pagamentos`: an IN-FLOW disclosure (precedent
 * `Detalhe de pagamento`, so no `useInlineLayer`) that reads the history only
 * once expanded.
 */
export function SettlementHistorySection({
  saleId,
  descriptions,
}: {
  saleId: string;
  descriptions: Map<string, string>;
}) {
  const [expanded, setExpanded] = React.useState(false);
  const history = useSaleSettlements(saleId, expanded);

  return (
    <div className="overflow-hidden rounded-[14px] border border-[#e8e8ec]">
      <div
        className={`flex items-center justify-between gap-3 bg-[#fafafb] px-4 py-[10px] text-[13px] font-bold ${
          expanded ? 'border-b border-[#eeeef1]' : ''
        }`}
      >
        <span>Histórico de pagamentos</span>
        <button
          aria-expanded={expanded}
          className="rounded-md px-1.5 py-0.5 text-[12.5px] font-semibold text-[#9c7210] transition hover:bg-[#f5f2ea]"
          onClick={() => setExpanded((value) => !value)}
          type="button"
        >
          {expanded ? 'Ocultar' : 'Mostrar'}
        </button>
      </div>
      {expanded ? (
        <HistoryBody
          descriptions={descriptions}
          entries={history.data ?? []}
          query={history}
          showTarget
        />
      ) : null}
    </div>
  );
}

/** One row's history, as a dialog: the `operacional/comissoes` list's `Histórico`. */
export function SettlementHistoryDialog({
  open,
  onOpenChange,
  target,
  descriptions,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  target: SettlementTarget;
  descriptions: Map<string, string>;
}) {
  const history = useSaleSettlements(target.saleId, open);
  const entries = (history.data ?? []).filter(
    (entry) => (target.kind === 'receivable' ? entry.receivableId : entry.payableId) === target.id,
  );

  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Histórico de pagamentos</DialogTitle>
          <DialogDescription>{`${target.description} · Proposta ${target.saleCode}`}</DialogDescription>
        </DialogHeader>
        <div className="max-h-[50vh] overflow-y-auto rounded-[14px] border border-[#e8e8ec]">
          <HistoryBody
            descriptions={descriptions}
            entries={entries}
            query={history}
            showTarget={false}
          />
        </div>
        <DialogFooter>
          <button
            className={secondaryButtonClass}
            onClick={() => onOpenChange(false)}
            type="button"
          >
            Fechar
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
