import * as React from 'react';
import {
  isAfterTodayInSaoPaulo,
  isIsoDay,
  todayInSaoPaulo,
} from '@fxl-sales/shared-utils/sao-paulo-day';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import type { RecordSettlementPayload } from '../api';
import { formatMoneyBrl } from '../calculations';
import { settlementErrorMessage } from './settlement-errors';
import type { SettlementTarget } from './settlement-format';
import {
  blockedNoticeClass,
  fieldLabelClass,
  formInputClass,
  mutedStateClass,
  primaryButtonClass,
  secondaryButtonClass,
} from './settlement-ui';

/**
 * `Marcar como pago`: one baixa of the whole open amount on a civil day.
 *
 * Mount-scoped state, no reset effect: the parent mounts it only while open and
 * keys it by the row id (precedent `MoveLeadDialog`). "Today" is the São Paulo
 * day, captured once at mount, and is both the default and the `max`; a future
 * day is refused here before any request. The amount is shown, never sent.
 * No inline layer is used (the native date picker is browser chrome), so no
 * `useInlineLayer`.
 */
export function MarkPaidDialog({
  open,
  onOpenChange,
  target,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  target: SettlementTarget;
  onConfirm: (payload: RecordSettlementPayload) => Promise<unknown>;
}) {
  const [today] = React.useState(() => todayInSaoPaulo());
  const [paidOn, setPaidOn] = React.useState(today);
  const [serverError, setServerError] = React.useState<string | null>(null);
  const [pending, setPending] = React.useState(false);
  const mounted = React.useRef(true);
  React.useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const refusal = !isIsoDay(paidOn)
    ? 'Informe uma data de pagamento válida.'
    : isAfterTodayInSaoPaulo(paidOn)
      ? 'A data de pagamento não pode ser no futuro.'
      : null;
  const notice = refusal ?? serverError;

  async function confirm() {
    if (refusal !== null || pending) return;
    setPending(true);
    setServerError(null);
    try {
      await onConfirm({ targetKind: target.kind, targetId: target.id, paidOn });
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
          <DialogTitle>Marcar como pago</DialogTitle>
          <DialogDescription>{`${target.description} · Proposta ${target.saleCode}`}</DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <label className={fieldLabelClass} htmlFor="settlement-paid-on">
              Data do pagamento
            </label>
            <Input
              className={formInputClass}
              id="settlement-paid-on"
              max={today}
              onChange={(event) => {
                setPaidOn(event.target.value);
                setServerError(null);
              }}
              type="date"
              value={paidOn}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <span className={fieldLabelClass}>Valor</span>
            <span
              className="sales-ops-num text-[15px] font-bold text-[#201f24]"
              data-settlement-amount="true"
            >
              {formatMoneyBrl(target.amountBrl)}
            </span>
            <span className={mutedStateClass}>
              O pagamento é registrado pelo valor integral em aberto.
            </span>
          </div>

          {notice !== null ? (
            <p className={blockedNoticeClass} data-settlement-error="true" role="alert">
              {notice}
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
          {/*
            `type="button"` on EVERY render, never derived from state, and the save
            runs from `onClick`: Enter in the date field must never submit anything.
          */}
          <button
            className={primaryButtonClass}
            data-settlement-confirm="true"
            disabled={refusal !== null || pending}
            onClick={() => void confirm()}
            type="button"
          >
            {pending ? 'Registrando...' : 'Confirmar pagamento'}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
