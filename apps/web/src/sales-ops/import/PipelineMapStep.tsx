import { Combobox, type ComboboxOption } from '@/components/ui/combobox';
import { formSelectClass } from '../leads/board-ui';
import { IMPORT_COPY } from './import-copy';
import { normalizeFunil } from './stage-map';
import type { PipelineChoices } from './pipeline-map';
import type { ImportLeadPipeline, ImportPipelineTarget } from './types';

type PipelineMapStepProps = {
  choices: PipelineChoices;
  disabled: boolean;
  onChange: (funil: ImportLeadPipeline, pipelineId: string) => void;
  onRevalidate: () => void;
  pipelines: ImportLeadPipeline[];
  /** The one Validar novamente button sits under the last step; this one renders it only when it is the last. */
  showRevalidate: boolean;
  targets: ImportPipelineTarget[];
};

export function PipelineMapStep({
  choices,
  disabled,
  onChange,
  onRevalidate,
  pipelines,
  showRevalidate,
  targets,
}: PipelineMapStepProps) {
  const options: ComboboxOption[] = targets.map((t) => ({ value: t.id, label: t.name }));
  return (
    <div className="flex flex-col gap-3" data-import-map-pipelines>
      <div>
        <h3 className="text-[14px] font-bold text-[#201f24]">{IMPORT_COPY.mapPipelinesTitle}</h3>
        <p className="mt-1 text-[13.5px] text-[#8b8b92]">{IMPORT_COPY.mapPipelinesText}</p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-[13.5px]">
          <thead>
            <tr className="text-[12px] font-semibold uppercase text-[#8b8b92]">
              <th className="py-2 pr-3">{IMPORT_COPY.mapPipelinesSheetColumn}</th>
              <th className="px-3 py-2 text-right">{IMPORT_COPY.mapStagesLeadsColumn}</th>
              <th className="py-2 pl-3">{IMPORT_COPY.mapPipelinesTargetColumn}</th>
            </tr>
          </thead>
          <tbody>
            {pipelines.map((pipeline) => {
              const choice = choices[normalizeFunil(pipeline.name)];
              const unresolved = choice === undefined;
              return (
                <tr
                  className="border-t border-[#e8e8ec] align-top"
                  data-map-pipeline-row={pipeline.name}
                  data-unresolved={unresolved ? '' : undefined}
                  key={normalizeFunil(pipeline.name)}
                >
                  <td className="break-words py-2 pr-3 font-semibold text-[#201f24]">
                    {pipeline.name}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">{pipeline.leads}</td>
                  <td className="min-w-[180px] py-2 pl-3">
                    <Combobox
                      aria-label={`${IMPORT_COPY.mapPipelinesAriaLabel}: ${pipeline.name}`}
                      className={
                        unresolved
                          ? `${formSelectClass} border-[#f1c9c4] bg-[#fdf2f1]`
                          : formSelectClass
                      }
                      disabled={disabled}
                      onChange={(value) => onChange(pipeline, value)}
                      options={options}
                      placeholder={IMPORT_COPY.mapPipelinesPlaceholder}
                      searchPlaceholder={IMPORT_COPY.mapPipelinesSearch}
                      value={choice ?? null}
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {showRevalidate ? (
        <div>
          <button
            className="inline-flex cursor-pointer items-center gap-2 rounded-[11px] border border-[#dcdce2] bg-white px-5 py-[11px] text-sm font-semibold text-[#57575f] transition hover:bg-[#f2f2f4] disabled:cursor-not-allowed disabled:opacity-60"
            data-import-revalidate
            disabled={disabled}
            onClick={onRevalidate}
            type="button"
          >
            {IMPORT_COPY.mapStagesRevalidate}
          </button>
        </div>
      ) : null}
    </div>
  );
}
