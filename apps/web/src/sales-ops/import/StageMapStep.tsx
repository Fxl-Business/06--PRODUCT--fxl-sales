import { Fragment } from 'react';
import { Combobox, type ComboboxOption } from '@/components/ui/combobox';
import { formSelectClass } from '../leads/board-ui';
import { IMPORT_COPY } from './import-copy';
import {
  CREATE_VALUE,
  FIRST_VALUE,
  STAGE_PREFIX,
  choiceValue,
  normalizeFunil,
  stageKey,
  valueChoice,
  type StageChoice,
  type StageChoices,
} from './stage-map';
import type { ImportLeadStage, ImportStageTarget } from './types';

type StageMapStepProps = {
  choices: StageChoices;
  disabled: boolean;
  onChange: (stage: ImportLeadStage, choice: StageChoice) => void;
  onRevalidate: () => void;
  stages: ImportLeadStage[];
  /** The etapa options of one sheet funil (the destination funil's etapas). */
  targetsFor: (funil: string | null) => ImportStageTarget[];
};

type Group = { key: string; funil: string | null; stages: ImportLeadStage[] };

/** Rows grouped by sheet funil, in the order the funis first appear. */
function groupByFunil(stages: ImportLeadStage[]): Group[] {
  const groups = new Map<string, Group>();
  for (const stage of stages) {
    const key = normalizeFunil(stage.funil);
    const group = groups.get(key) ?? { key, funil: stage.funil, stages: [] };
    group.stages.push(stage);
    groups.set(key, group);
  }
  return [...groups.values()];
}

export function StageMapStep({
  choices,
  disabled,
  onChange,
  onRevalidate,
  stages,
  targetsFor,
}: StageMapStepProps) {
  const groups = groupByFunil(stages);
  // A heading only tells funis apart: a lone blank-funil group needs none.
  const showHeadings = stages.some((s) => s.funil !== null);
  return (
    <div className="flex flex-col gap-3" data-import-map-stages>
      <div>
        <h3 className="text-[14px] font-bold text-[#201f24]">{IMPORT_COPY.mapStagesTitle}</h3>
        <p className="mt-1 text-[13.5px] text-[#8b8b92]">{IMPORT_COPY.mapStagesText}</p>
      </div>
      {/* No overflow wrapper: the Combobox panel is inline and would be clipped by it. */}
      <table className="w-full text-left text-[13.5px]">
        <thead>
          <tr className="text-[12px] font-semibold uppercase text-[#8b8b92]">
            <th className="py-2 pr-3">{IMPORT_COPY.mapStagesSheetColumn}</th>
            <th className="px-3 py-2 text-right">{IMPORT_COPY.mapStagesLeadsColumn}</th>
            <th className="py-2 pl-3">{IMPORT_COPY.mapStagesTargetColumn}</th>
          </tr>
        </thead>
        <tbody>
          {groups.map((group) => {
            const options: ComboboxOption[] = [
              ...targetsFor(group.funil).map((t) => ({
                value: `${STAGE_PREFIX}${t.id}`,
                label: t.name,
              })),
              { value: CREATE_VALUE, label: IMPORT_COPY.mapStagesCreate },
              { value: FIRST_VALUE, label: IMPORT_COPY.mapStagesFirst },
            ];
            return (
              <Fragment key={group.key}>
                {showHeadings ? (
                  <tr
                    className="border-t border-[#e8e8ec]"
                    data-map-stage-funil-heading={group.funil ?? ''}
                  >
                    <th
                      className="[overflow-wrap:anywhere] bg-[#f7f7f9] px-0 py-2 text-[12.5px] font-bold text-[#57575f]"
                      colSpan={3}
                    >
                      {group.funil === null
                        ? IMPORT_COPY.mapStagesNoFunilHeading
                        : IMPORT_COPY.mapStagesFunilHeading(group.funil)}
                    </th>
                  </tr>
                ) : null}
                {group.stages.map((stage) => {
                  const choice = choices[stageKey(stage)];
                  const unresolved = choice === undefined;
                  const label = `${IMPORT_COPY.mapStagesTargetColumn}: ${
                    stage.funil === null ? '' : `${stage.funil} - `
                  }${stage.name}`;
                  return (
                    <tr
                      className="border-t border-[#e8e8ec] align-top"
                      data-map-stage-row={stage.name}
                      data-map-stage-funil={stage.funil ?? undefined}
                      data-unresolved={unresolved ? '' : undefined}
                      key={stageKey(stage)}
                    >
                      <td className="[overflow-wrap:anywhere] py-2 pr-3 font-semibold text-[#201f24]">
                        {stage.name}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">{stage.leads}</td>
                      <td className="w-[55%] min-w-[150px] py-2 pl-3">
                        <Combobox
                          aria-label={label}
                          className={
                            unresolved
                              ? `${formSelectClass} border-[#f1c9c4] bg-[#fdf2f1]`
                              : formSelectClass
                          }
                          disabled={disabled}
                          onChange={(value) => {
                            const next = valueChoice(value);
                            if (next) onChange(stage, next);
                          }}
                          options={options}
                          placeholder={IMPORT_COPY.mapStagesPlaceholder}
                          searchPlaceholder={IMPORT_COPY.mapStagesSearch}
                          value={choiceValue(choice)}
                          valueLabel={
                            choice && 'sheet' in choice ? IMPORT_COPY.mapStagesFromSheet : undefined
                          }
                        />
                        {stage.resolution.kind === 'conversion' && unresolved ? (
                          <p className="mt-1 text-[12.5px] text-[#c93d32]">
                            {IMPORT_COPY.mapStagesConversion}
                          </p>
                        ) : null}
                      </td>
                    </tr>
                  );
                })}
              </Fragment>
            );
          })}
        </tbody>
      </table>
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
    </div>
  );
}
