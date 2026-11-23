import { normalizeFunil, toStageMap, type StageChoices } from './stage-map';
import type {
  ImportLeadPipeline,
  ImportLeadStage,
  ImportPipelineTarget,
  ImportStageTarget,
  PipelineMap,
  StageMap,
} from './types';

/**
 * The pure half of the Mapear funis step: the destination the operator chose for each
 * sheet funil, the `pipelineMap` and `stageMap` that travel to preview and commit, and
 * the rules that scope the etapa rows to a funil. Kept apart from `PipelineMapStep.tsx`
 * so that file exports only its component (fast refresh).
 */

/** Destination pipeline id per sheet funil, keyed by `normalizeFunil`. */
export type PipelineChoices = Record<string, string>;

export type ImportMaps = { stageMap: StageMap; pipelineMap: PipelineMap };

/** The step shows when a funil is not found, or when the organization has a funil to choose among. */
export function shouldShowPipelineStep(
  pipelines: ImportLeadPipeline[],
  targets: ImportPipelineTarget[],
): boolean {
  if (pipelines.length === 0) return false;
  return pipelines.some((p) => p.resolution.kind !== 'existing') || targets.length > 1;
}

/** The choices a fresh preview starts with: funis that already exist keep their own destination. */
export function defaultPipelineId(pipeline: ImportLeadPipeline): string | undefined {
  return pipeline.resolution.kind === 'existing' ? pipeline.resolution.pipelineId : undefined;
}

/** Keeps the operator's choice by funil and seeds the funis that have none yet. */
export function adoptPipelineChoices(
  pipelines: ImportLeadPipeline[],
  current: PipelineChoices,
): PipelineChoices {
  const next: PipelineChoices = {};
  for (const pipeline of pipelines) {
    const key = normalizeFunil(pipeline.name);
    const chosen = current[key] ?? defaultPipelineId(pipeline);
    if (chosen !== undefined) next[key] = chosen;
  }
  return next;
}

export function allPipelinesResolved(
  pipelines: ImportLeadPipeline[],
  choices: PipelineChoices,
): boolean {
  return pipelines.every((p) => choices[normalizeFunil(p.name)] !== undefined);
}

/** The etapa options of one sheet funil: its destination's etapas (a target with no funil is offered everywhere). */
export function targetsForFunil(
  targets: ImportStageTarget[],
  funil: string | null,
  choices: PipelineChoices,
): ImportStageTarget[] {
  if (funil === null) return targets;
  const destination = choices[normalizeFunil(funil)];
  return targets.filter(
    (t) => t.pipelineId === null || destination === undefined || t.pipelineId === destination,
  );
}

/**
 * `stageMap` carries the etapas of blank-funil rows only; `pipelineMap` carries, per sheet
 * funil, the destination (only when it differs from the one the funil resolves to by name)
 * and the etapa choices of that funil.
 */
export function buildMaps(
  stages: ImportLeadStage[],
  pipelines: ImportLeadPipeline[],
  pipelineChoices: PipelineChoices,
  stageChoices: StageChoices,
): ImportMaps {
  const stageMap = toStageMap(
    stages.filter((s) => s.funil === null),
    stageChoices,
  );
  const names = new Map<string, string>();
  for (const p of pipelines) names.set(normalizeFunil(p.name), p.name);
  for (const s of stages) {
    if (s.funil !== null && !names.has(normalizeFunil(s.funil))) {
      names.set(normalizeFunil(s.funil), s.funil);
    }
  }
  const pipelineMap: PipelineMap = {};
  for (const [key, name] of names) {
    const known = pipelines.find((p) => normalizeFunil(p.name) === key);
    const chosen = pipelineChoices[key];
    const entry: PipelineMap[string] = {};
    if (chosen !== undefined && (known === undefined || chosen !== defaultPipelineId(known))) {
      entry.pipelineId = chosen;
    }
    const own = toStageMap(
      stages.filter((s) => s.funil !== null && normalizeFunil(s.funil) === key),
      stageChoices,
    );
    if (Object.keys(own).length > 0) entry.stages = own;
    if (entry.pipelineId !== undefined || entry.stages !== undefined) pipelineMap[name] = entry;
  }
  return { stageMap, pipelineMap };
}

/** The identity of a validation: a different map than this one makes the shown preview stale. */
export function mapsKey(maps: ImportMaps): string {
  return JSON.stringify(maps);
}
