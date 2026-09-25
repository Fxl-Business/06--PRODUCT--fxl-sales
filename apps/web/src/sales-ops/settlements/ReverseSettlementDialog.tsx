import * as React from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import type { ReverseSettlementPayload } from '../api';
import { formatMoneyBrl } from '../calculations';
import type { SalesOpsSettlement } from '../types';
import { settlementErrorMessage } from './settlement-errors';
import { formatCivilDay, REVERSE_REASON_MAX, type SettlementTarget } from './settlement-format';
import {
  blockedNoticeClass,
  fieldLabelClass,
  formTextareaClass,
  mutedStateClass,
  primaryButtonClass,
  secondaryButtonClass,
} from './settlement-ui';

/**
 * `Estornar pagamento`: reverses the row's newest active baixa, read from the
 * sale history (the bootstrap carries no settlement id). The reason is optional,
 * trimmed, and omitted when blank. Mount-scoped state like `MarkPaidDialog`.
 */
export function ReverseSettlementDialog({
  open,
  onOpenChange,
  target,
  activeBaixa,
  loading,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  target: SettlementTarget;
  activeBaixa: SalesOpsSettlement | null;
  loading: boolean;
  onConfirm: (payload: ReverseSettlementPayload) => Promise<unknown>;
}) {
  const [draft, setDraft] = React.useState('');
  const [serverError, setServerError] = React.useState<string | null>(null);
  const [pending, setPending] = React.useState(false);
  const mounted = React.useRef(true);
  React.useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  async function confirm() {
    if (!activeBaixa || loading || pending) return;
    const reason = draft.trim();
    setPending(true);
    setServerError(null);
    try {
      await onConfirm(
        reason ? { settlementId: activeBaixa.id, reason } : { settlementId: activeBaixa.id },
      );
      if (mounted.current) onOpenChange(false);
    } catch (error) {
      if (mounted.current) setServerError(settlementErrorMessage(error));
    } finally {
      if (mounted.current) setPending(false);
    }
  }

  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Estornar pagamento</DialogTitle>
          <DialogDescription>{`${target.description} · Proposta ${target.saleCode}`}</DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          {loading ? (
            <p className={mutedStateClass}>Carregando pagamento...</p>
          ) : activeBaixa ? (
            <p className="text-[13.5px] leading-[1.5] text-[#57575f]">
              {`O pagamento de ${formatCivilDay(activeBaixa.paidOn)} (${formatMoneyBrl(activeBaixa.amountBrl)}) será estornado e a linha volta a ficar em aberto.`}
            </p>
          ) : (
            <p className={blockedNoticeClass}>
              Nenhum pagamento ativo encontrado para esta linha. Atualize a página.
            </p>
          )}

          <div className="flex flex-col gap-1.5">
            <label className={fieldLabelClass} htmlFor="settlement-reverse-reason">
              Motivo (opcional)
            </label>
            <textarea
              className={formTextareaClass}
              id="settlement-reverse-reason"
              maxLength={REVERSE_REASON_MAX}
              onChange={(event) => setDraft(event.target.value)}
              value={draft}
            />
          </div>

          {serverError !== null ? (
            <p className={blockedNoticeClass} data-settlement-error="true" role="alert">
              {serverError}
            </p>
          ) : null}
        </div>

        <DialogFooter>
          <button
            className={secondaryButtonClass}
            onClick={() => onOpenChange(false)}
            type="button"
          >
            Cancelar
          </button>
          <button
            className={primaryButtonClass}
            data-settlement-reverse-confirm="true"
            disabled={!activeBaixa || loading || pending}
            onClick={() => void confirm()}
            type="button"
          >
            {pending ? 'Estornando...' : 'Estornar'}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
