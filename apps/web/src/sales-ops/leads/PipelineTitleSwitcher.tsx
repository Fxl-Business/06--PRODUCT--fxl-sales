import * as React from 'react';
import { Combobox } from '@/components/ui/combobox';
import { usePipelines } from './crm-hooks';
import { pickPipeline } from './crm-pipeline';

type Props = {
  /** The shell's pipeline choice; `null` means the default (resolved by `pickPipeline`). */
  value: string | null;
  onChange: (pipelineId: string) => void;
};

export const PIPELINE_SWITCHER_LABEL = 'Funil ativo';

const pillClass =
  'inline-flex h-9 items-center gap-2 rounded-full border border-[#d9d3f7] bg-white px-3.5 text-[14.5px] font-semibold text-[#3f3590] shadow-[0_1px_2px_rgba(24,24,27,0.05)]';

/**
 * The Funil page's title control: it NAMES the active pipeline next to the page
 * title and, when there is more than one to choose from, switches it. It resolves
 * the active pipeline with the same `pickPipeline` the board container uses, so
 * the name shown is always the one whose columns are on screen.
 */
export function PipelineTitleSwitcher({ value, onChange }: Props) {
  const pipelinesQuery = usePipelines();
  const pipelines = React.useMemo(() => pipelinesQuery.data ?? [], [pipelinesQuery.data]);
  const active = pickPipeline(pipelines, value);
  const options = React.useMemo(
    () =>
      pipelines
        .filter((candidate) => candidate.status === 'active')
        .sort((a, b) => a.position - b.position)
        .map((candidate) => ({ value: candidate.id, label: candidate.name })),
    [pipelines],
  );

  if (!active) return null;

  const dot = <span aria-hidden className="block h-2 w-2 shrink-0 rounded-full bg-[#6b5bd1]" />;

  if (options.length < 2) {
    return (
      <span className={pillClass} data-pipeline-title="">
        {dot}
        <span className="max-w-[260px] truncate">{active.name}</span>
      </span>
    );
  }

  return (
    <div className="relative" data-pipeline-title="" data-pipeline-switcher="">
      <Combobox
        aria-label={PIPELINE_SWITCHER_LABEL}
        className={`${pillClass} w-auto max-w-[320px] justify-start pl-[30px] ring-offset-[#f3f3f5] transition hover:border-[#b9aef0] hover:bg-[#f7f5ff] [&>span]:truncate [&>svg]:opacity-70`}
        markSelected
        onChange={onChange}
        options={options}
        panelClassName="w-[280px]"
        searchPlaceholder="Buscar funil..."
        value={active.id}
      />
      <span className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2">{dot}</span>
    </div>
  );
}
