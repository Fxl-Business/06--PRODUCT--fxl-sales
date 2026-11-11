import { Combobox, type ComboboxOption } from '@/components/ui/combobox';
import { formSelectClass } from '../leads/board-ui';
import { IMPORT_COPY } from './import-copy';
import type {
  ImportLeadStage,
  ImportStageTarget,
  StageMap,
  StageMapEntry,
} from './types';

/** What the operator decided for one spreadsheet etapa. `sheet`: the Etapas tab of the same file creates it. */
export type StageChoice = StageMapEntry | { sheet: true };
export type StageChoices = Record<string, StageChoice>;

const CREATE_VALUE = '__create';
const FIRST_VALUE = '__first';
const SHEET_VALUE = '__sheet';
const STAGE_PREFIX = 'stage:';

function choiceValue(choice: StageChoice | undefined): string | null {
  if (!choice) return null;
  if ('stageId' in choice) return `${STAGE_PREFIX}${choice.stageId}`;
  if ('create' in choice) return CREATE_VALUE;
  if ('first' in choice) return FIRST_VALUE;
  return SHEET_VALUE;
}

function valueChoice(value: string): StageChoice | null {
  if (value === CREATE_VALUE) return { create: true };
  if (value === FIRST_VALUE) return { first: true };
  if (value.startsWith(STAGE_PREFIX)) return { stageId: value.slice(STAGE_PREFIX.length) };
  return null;
}

/** The choices a fresh preview starts with: etapas already matched by name; the rest stay empty. */
export function defaultChoice(stage: ImportLeadStage): StageChoice | undefined {
  if (stage.resolution.kind !== 'existing') return undefined;
  return stage.resolution.stageId === null ? { sheet: true } : { stageId: stage.resolution.stageId };
}

/** The `stageMap` to send: every choice except the one the Etapas tab already covers. */
export function toStageMap(stages: ImportLeadStage[], choices: StageChoices): StageMap {
  const map: StageMap = {};
  for (const stage of stages) {
    const choice = choices[stage.name];
    if (choice && !('sheet' in choice)) map[stage.name] = choice;
  }
  return map;
}

export function allStagesResolved(stages: ImportLeadStage[], choices: StageChoices): boolean {
  return stages.every((stage) => choices[stage.name] !== undefined);
}

type StageMapStepProps = {
  choices: StageChoices;
  disabled: boolean;
  onChange: (name: string, choice: StageChoice) => void;
  onRevalidate: () => void;
  stages: ImportLeadStage[];
  targets: ImportStageTarget[];
};

export function StageMapStep({
  choices,
  disabled,
  onChange,
  onRevalidate,
  stages,
  targets,
}: StageMapStepProps) {
  const options: ComboboxOption[] = [
    ...targets.map((t) => ({ value: `${STAGE_PREFIX}${t.id}`, label: t.name })),
    { value: CREATE_VALUE, label: IMPORT_COPY.mapStagesCreate },
    { value: FIRST_VALUE, label: IMPORT_COPY.mapStagesFirst },
  ];
  return (
    <div className="flex flex-col gap-3" data-import-map-stages>
      <div>
        <h3 className="text-[14px] font-bold text-[#201f24]">{IMPORT_COPY.mapStagesTitle}</h3>
        <p className="mt-1 text-[13.5px] text-[#8b8b92]">{IMPORT_COPY.mapStagesText}</p>
      </div>
      <table className="w-full text-left text-[13.5px]">
        <thead>
          <tr className="text-[12px] font-semibold uppercase text-[#8b8b92]">
            <th className="py-2 pr-3">{IMPORT_COPY.mapStagesSheetColumn}</th>
            <th className="px-3 py-2 text-right">{IMPORT_COPY.mapStagesLeadsColumn}</th>
            <th className="py-2 pl-3">{IMPORT_COPY.mapStagesTargetColumn}</th>
          </tr>
        </thead>
        <tbody>
          {stages.map((stage) => {
            const choice = choices[stage.name];
            const unresolved = choice === undefined;
            return (
              <tr
                className="border-t border-[#e8e8ec] align-top"
                data-map-stage-row={stage.name}
                data-unresolved={unresolved ? '' : undefined}
                key={stage.name}
              >
                <td className="py-2 pr-3 font-semibold text-[#201f24]">{stage.name}</td>
                <td className="px-3 py-2 text-right tabular-nums">{stage.leads}</td>
                <td className="py-2 pl-3">
                  <Combobox
                    aria-label={`${IMPORT_COPY.mapStagesTargetColumn}: ${stage.name}`}
                    className={
                      unresolved ? `${formSelectClass} border-[#f1c9c4] bg-[#fdf2f1]` : formSelectClass
                    }
                    disabled={disabled}
                    onChange={(value) => {
                      const next = valueChoice(value);
                      if (next) onChange(stage.name, next);
                    }}
                    options={options}
                    placeholder={IMPORT_COPY.mapStagesPlaceholder}
                    searchPlaceholder={IMPORT_COPY.mapStagesSearch}
                    value={choiceValue(choice)}
                    valueLabel={choice && 'sheet' in choice ? IMPORT_COPY.mapStagesFromSheet : undefined}
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
