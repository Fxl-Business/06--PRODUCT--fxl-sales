import { X } from 'lucide-react';
import { useState } from 'react';
import { Combobox, type ComboboxOption } from '@/components/ui/combobox';
import type { SalesOpsFuncao } from '../types';
import { formSelectClass } from './board-ui';

/**
 * Several funções in one field: the chosen ones as removable chips, and ONE `Combobox` (the only
 * picker this app allows) that adds the next one. Shared by `Funis e etapas` (the funções that
 * reach a pipeline) and the Vendedores dialog (a vendedor's extra funções).
 *
 * The `Combobox` registers its own inline layer, so Escape inside a dialog closes the panel and
 * never the dialog. A função already chosen and since archived keeps its chip (labelled
 * `(arquivada)`) and stays removable; only active funções are offered to add.
 */
export type FuncaoMultiPickerProps = {
  /** The org's catalogue, both statuses. */
  funcoes: readonly SalesOpsFuncao[];
  /** Which funções may be offered at all (the Vendedores dialog hides the system ones). */
  selectable?: (funcao: SalesOpsFuncao) => boolean;
  value: readonly string[];
  onChange: (ids: string[]) => void;
  /** Inline create by name. Absent hides the create row, so the copy never promises one. */
  onCreateFuncao?: (name: string) => Promise<SalesOpsFuncao | null>;
  'aria-label': string;
  placeholder: string;
  /** Shown under the field while nothing is chosen. */
  emptyHint: string;
  disabled?: boolean;
};

const chipClass =
  'inline-flex items-center gap-1.5 rounded-full border border-[#dcdce2] bg-[#fafafb] py-1 pl-3 pr-1 text-[12.5px] font-semibold text-[#201f24]';
const chipButtonClass =
  'inline-flex h-6 w-6 items-center justify-center rounded-full text-[#8b8b92] transition hover:bg-[#eeeef1] hover:text-[#201f24] disabled:cursor-not-allowed disabled:opacity-50';

export function FuncaoMultiPicker({
  funcoes,
  selectable = () => true,
  value,
  onChange,
  onCreateFuncao,
  'aria-label': ariaLabel,
  placeholder,
  emptyHint,
  disabled = false,
}: FuncaoMultiPickerProps) {
  /**
   * Funções created from this picker's own create row. The catalogue prop refreshes only once
   * the invalidated bootstrap lands, so without this a just-created chip would have no name.
   */
  const [created, setCreated] = useState<SalesOpsFuncao[]>([]);
  const catalogue = [...funcoes, ...created.filter((funcao) => !funcoes.some((known) => known.id === funcao.id))];
  const chosen = value.flatMap((id) => {
    const funcao = catalogue.find((candidate) => candidate.id === id);
    return funcao ? [funcao] : [];
  });
  const options: ComboboxOption[] = catalogue
    .filter((funcao) => funcao.status === 'active' && selectable(funcao) && !value.includes(funcao.id))
    .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'))
    .map((funcao) => ({ value: funcao.id, label: funcao.name }));

  function add(id: string) {
    if (!id || value.includes(id)) return;
    onChange([...value, id]);
  }

  async function create(name: string) {
    if (!onCreateFuncao || !name.trim()) return;
    const funcao = await onCreateFuncao(name.trim());
    if (!funcao) return;
    setCreated((current) => (current.some((row) => row.id === funcao.id) ? current : [...current, funcao]));
    add(funcao.id);
  }

  return (
    <div className="flex flex-col gap-2" data-funcao-multi-picker="">
      {chosen.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          {chosen.map((funcao) => (
            <span className={chipClass} data-funcao-chip={funcao.id} key={funcao.id}>
              {funcao.status === 'archived' ? `${funcao.name} (arquivada)` : funcao.name}
              <button
                aria-label={`Remover função ${funcao.name}`}
                className={chipButtonClass}
                disabled={disabled}
                onClick={() => onChange(value.filter((id) => id !== funcao.id))}
                title="Remover"
                type="button"
              >
                <X className="h-[13px] w-[13px]" />
              </button>
            </span>
          ))}
        </div>
      ) : (
        <p className="text-[12.5px] text-[#8b8b92]">{emptyHint}</p>
      )}
      <Combobox
        aria-label={ariaLabel}
        className={formSelectClass}
        disabled={disabled}
        emptyMessage="Nenhuma função disponível."
        entityGender="f"
        entityLabel="função"
        onChange={add}
        onCreate={onCreateFuncao ? (query) => void create(query) : undefined}
        options={options}
        placeholder={placeholder}
        searchPlaceholder="Buscar função..."
        value=""
      />
    </div>
  );
}
