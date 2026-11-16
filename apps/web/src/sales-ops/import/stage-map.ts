import type { ImportLeadStage, StageMap, StageMapEntry } from './types';

/**
 * The pure half of the Mapear etapas step: what the operator chose for each spreadsheet etapa,
 * how a choice travels through the Combobox value, and the `stageMap` the preview and commit send.
 * Kept apart from `StageMapStep.tsx` so that file exports only its component (fast refresh).
 */

/** What the operator decided for one spreadsheet etapa. `sheet`: the Etapas tab of the same file creates it. */
export type StageChoice = StageMapEntry | { sheet: true };
export type StageChoices = Record<string, StageChoice>;

export const CREATE_VALUE = '__create';
export const FIRST_VALUE = '__first';
const SHEET_VALUE = '__sheet';
export const STAGE_PREFIX = 'stage:';

export function choiceValue(choice: StageChoice | undefined): string | null {
  if (!choice) return null;
  if ('stageId' in choice) return `${STAGE_PREFIX}${choice.stageId}`;
  if ('create' in choice) return CREATE_VALUE;
  if ('first' in choice) return FIRST_VALUE;
  return SHEET_VALUE;
}

export function valueChoice(value: string): StageChoice | null {
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
