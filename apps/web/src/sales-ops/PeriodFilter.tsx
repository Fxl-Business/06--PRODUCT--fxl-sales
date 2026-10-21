import { Combobox } from '@/components/ui/combobox';
import { Input } from '@/components/ui/input';
import { comboboxTriggerClass } from './leads/board-ui';
import {
  DEFAULT_PERIOD_PRESETS,
  PERIOD_COPY,
  PERIOD_PRESET_LABEL,
  periodError,
  type PeriodPreset,
  type PeriodSelection,
} from './period';

export type PeriodFilterProps = {
  value: PeriodSelection;
  onChange: (next: PeriodSelection) => void;
  presets?: readonly PeriodPreset[];
  'aria-label'?: string;
};

/** Controlled period picker. It holds no state and never fetches. */
export function PeriodFilter({
  value,
  onChange,
  presets = DEFAULT_PERIOD_PRESETS,
  'aria-label': ariaLabel = PERIOD_COPY.label,
}: PeriodFilterProps) {
  const error = periodError(value);
  return (
    <div className="flex flex-wrap items-center gap-2" data-period-filter="">
      <Combobox
        aria-label={ariaLabel}
        className={`w-[190px] ${comboboxTriggerClass}`}
        onChange={(next) => onChange({ preset: next as PeriodPreset, from: value.from, to: value.to })}
        options={presets.map((preset) => ({ value: preset, label: PERIOD_PRESET_LABEL[preset] }))}
        searchPlaceholder="Buscar período..."
        value={value.preset}
      />
      {value.preset === 'custom' ? (
        <>
          <Input
            aria-label={PERIOD_COPY.from}
            className="h-10 w-[150px] rounded-md border-[#dcdce2] bg-[#fafafb] px-3 text-sm"
            data-period-from=""
            max={value.to || undefined}
            onChange={(event) => onChange({ ...value, from: event.target.value })}
            type="date"
            value={value.from}
          />
          <Input
            aria-label={PERIOD_COPY.to}
            className="h-10 w-[150px] rounded-md border-[#dcdce2] bg-[#fafafb] px-3 text-sm"
            data-period-to=""
            min={value.from || undefined}
            onChange={(event) => onChange({ ...value, to: event.target.value })}
            type="date"
            value={value.to}
          />
        </>
      ) : null}
      {error !== null ? (
        <p className="text-[13px] font-medium text-[#a5341c]" data-period-error="" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
