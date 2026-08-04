import {
  defaultSplitBp,
  splitCentsByWeights,
  SPLIT_BP_TOTAL,
} from '@fxl-sales/shared-utils/professional-split';
import { InfoHint } from '@/components/ui/info-hint';
import { Input } from '@/components/ui/input';
import {
  bpToPercentInput,
  formatIsoDateBr,
  formatMoneyBrl,
  formatSplitPercent,
  percentInputToBp,
} from './calculations';

/** One installment row of the wizard's step-2 plan, already resolved to cents. */
export type SplitParcela = { dueDate: string; amountCents: number };

/**
 * `Detalhe de pagamento` - the per-professional payment schedule editor.
 *
 * IN FLOW, never a layer. It is rendered as a `col-span-full` sibling inside the
 * professionals table's own grid row and it deliberately does NOT call
 * `useInlineLayer`: that hook exists for ABSOLUTELY POSITIONED panels (`Combobox`'s
 * list, `InfoHint`'s disclosure) where an Escape aimed at the layer would otherwise
 * reach `DialogContent` and discard the operator's typed work. An expander that
 * pushes content down is not such a layer, and the established precedent is
 * `SaleItemForm.descriptionOpen`, which does the same thing the same way.
 *
 * WYSIWYG: the amounts printed here come from the SAME `defaultSplitBp` /
 * `splitCentsByWeights` the API calls in `resolveProfessionalSplit`, over the same
 * installment rows the server will split against (the recorrência is separate state
 * in the wizard and `M`-labelled server side, and is excluded on both sides). So a
 * line in this panel is the `professional_cost` payable that will be written at win.
 *
 * It is its own module rather than another 140 lines of JSX inside the 8k-line
 * `SalesOpsApp.tsx`, which also makes the no-parcela branch below directly
 * renderable from a test - the wizard's own step-2 gate (`planRowsValid` requires
 * every amount `> 0`) means the operator cannot reach step 3 with an empty plan.
 */
export function ProfessionalSplitPanel({
  costCents,
  onChange,
  parcelas,
  personName,
  rowNumber,
  splitBp,
}: {
  /** The row's resolved `CUSTO ALOCADO`, in cents. */
  costCents: number;
  /** `null` restores the default pro-rata; an array is a stored override. */
  onChange: (next: number[] | null) => void;
  parcelas: SplitParcela[];
  personName: string;
  /** 1-based, matching every other `profissional N` label in this table. */
  rowNumber: number;
  splitBp: number[] | null;
}) {
  /*
    The default is computed, never materialized: a row whose `costSplitBp` is `null`
    stays `null` until the operator clicks `Personalizar divisão`, so the API keeps
    storing NULL and keeps re-deriving the pro rata against whatever the plan later
    becomes.
  */
  const weightsBp = splitBp ?? defaultSplitBp(parcelas.map((parcela) => parcela.amountCents));
  const partCents = splitCentsByWeights(costCents, weightsBp);
  const sumBp = weightsBp.reduce((sum, part) => sum + part, 0);
  const label = personName.trim();

  return (
    <div
      className="col-span-full rounded-[10px] border border-[#e8e8ec] bg-[#fafafb] px-3 py-3"
      data-split-panel={rowNumber}
    >
      <div className="mb-2 flex items-center gap-1.5">
        <span className="text-[12.5px] font-bold text-[#201f24]">
          Detalhe de pagamento{label ? ` · ${label}` : ''}
        </span>
        <InfoHint label="Detalhe de pagamento">
          Por padrão o custo é dividido entre as parcelas na mesma proporção do plano de
          pagamento. Você pode definir uma divisão própria para este profissional.
        </InfoHint>
      </div>

      {parcelas.length === 0 ? (
        <div className="text-[12.5px] leading-5 text-[#6a6a72]">
          Defina o plano de pagamento na etapa 2 para dividir este custo.
        </div>
      ) : splitBp === null ? (
        <div className="flex flex-col gap-1.5">
          {parcelas.map((parcela, partIndex) => (
            <div
              className="flex items-center justify-between gap-3 text-[12.5px] text-[#57575f]"
              key={partIndex}
            >
              <span>
                Parcela {partIndex + 1} · {formatIsoDateBr(parcela.dueDate)}
              </span>
              <span className="sales-ops-num font-semibold text-[#201f24]">
                {formatSplitPercent(weightsBp[partIndex] ?? 0)} ·{' '}
                {formatMoneyBrl(partCents[partIndex] ?? 0)}
              </span>
            </div>
          ))}
          <div className="mt-1 flex items-center justify-between gap-3 border-t border-[#e8e8ec] pt-2 text-[12.5px]">
            <span className="font-semibold text-[#6a6a72]">Total</span>
            <span className="sales-ops-num font-bold text-[#201f24]">
              {formatMoneyBrl(costCents)}
            </span>
          </div>
          <div>
            <button
              aria-label={`Personalizar divisão do profissional ${rowNumber}`}
              className="mt-1 text-[11px] font-semibold text-[#6a6a72] underline transition hover:text-[#201f24]"
              /*
                Seeds the EDITOR with the default rather than with an empty form, so
                the operator adjusts numbers that already sum to 100% instead of
                authoring a vector from nothing.
              */
              onClick={() => onChange([...weightsBp])}
              type="button"
            >
              Personalizar divisão
            </button>
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-1.5">
          {splitBp.map((partBp, partIndex) => (
            <div className="flex items-center gap-2 text-[12.5px] text-[#57575f]" key={partIndex}>
              <span className="w-[62px] flex-none font-semibold">Parte {partIndex + 1}</span>
              <Input
                aria-label={`Parte ${partIndex + 1} do profissional ${rowNumber}`}
                className="sales-ops-num h-9 w-[86px] flex-none rounded-[8px] border-[#dcdce2] bg-white px-2 text-right text-[13px] text-[#201f24] shadow-none outline-none ring-0 transition focus-visible:border-[#eaa81a] focus-visible:ring-0 focus-visible:ring-offset-0"
                onChange={(event) =>
                  onChange(
                    splitBp.map((current, index) =>
                      index === partIndex ? percentInputToBp(event.target.value) : current,
                    ),
                  )
                }
                type="number"
                value={bpToPercentInput(partBp)}
              />
              <span className="flex-none text-[12.5px] font-semibold text-[#6a6a72]">%</span>
              <span className="sales-ops-num flex-1 text-right font-semibold text-[#201f24]">
                = {formatMoneyBrl(partCents[partIndex] ?? 0)}
              </span>
              {partIndex < parcelas.length ? (
                <span className="w-[86px] flex-none text-right text-[11.5px] text-[#6a6a72]">
                  {formatIsoDateBr(parcelas[partIndex]!.dueDate)}
                </span>
              ) : (
                <span className="w-[86px] flex-none" />
              )}
              {splitBp.length > 1 ? (
                <button
                  aria-label={`Remover parte ${partIndex + 1} do profissional ${rowNumber}`}
                  className="flex-none text-[11px] font-semibold text-[#b23a22] underline"
                  onClick={() => onChange(splitBp.filter((_, index) => index !== partIndex))}
                  type="button"
                >
                  Remover
                </button>
              ) : null}
            </div>
          ))}

          {splitBp.length < parcelas.length ? (
            <div className="text-[11.5px] leading-5 text-[#6a6a72]">
              As parcelas {splitBp.length + 1} em diante não pagam este profissional.
            </div>
          ) : null}

          <div className="mt-1 flex items-center justify-between gap-3 border-t border-[#e8e8ec] pt-2 text-[12.5px]">
            <span className="font-semibold text-[#6a6a72]">Soma</span>
            <span
              className={`sales-ops-num font-bold ${
                sumBp === SPLIT_BP_TOTAL ? 'text-[#6a6a72]' : 'text-[#b23a22]'
              }`}
            >
              {formatSplitPercent(sumBp)}
            </span>
          </div>

          <div className="mt-1 flex flex-wrap items-center gap-3">
            <button
              aria-label={`Adicionar parte ao profissional ${rowNumber}`}
              className="text-[11px] font-semibold text-[#6a6a72] underline transition hover:text-[#201f24] disabled:cursor-not-allowed disabled:text-[#b6b6bd] disabled:no-underline"
              /*
                A new part arrives at 0%, which is the honest reading of "add a part":
                nothing is renormalized behind the operator, exactly as step 2 refuses
                to renormalize a hand-edited `Soma das parcelas`.
              */
              disabled={splitBp.length >= parcelas.length}
              onClick={() => onChange([...splitBp, 0])}
              type="button"
            >
              + parte
            </button>
            <button
              aria-label={`Distribuir igualmente entre as partes do profissional ${rowNumber}`}
              className="text-[11px] font-semibold text-[#6a6a72] underline transition hover:text-[#201f24]"
              /*
                Through `splitCentsByWeights` and not through a bespoke division, so
                the editor obeys the same last-part-absorbs-the-remainder rule as the
                payables it previews: three parts are 33,33 / 33,33 / 33,34.
              */
              onClick={() =>
                onChange(splitCentsByWeights(SPLIT_BP_TOTAL, splitBp.map(() => 1)))
              }
              type="button"
            >
              Distribuir igualmente
            </button>
            <button
              aria-label={`Usar divisão padrão do profissional ${rowNumber}`}
              className="text-[11px] font-semibold text-[#6a6a72] underline transition hover:text-[#201f24]"
              onClick={() => onChange(null)}
              type="button"
            >
              Usar padrão
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
