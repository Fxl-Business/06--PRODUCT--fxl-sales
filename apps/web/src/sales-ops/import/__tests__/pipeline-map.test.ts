import { describe, expect, it } from 'vitest';
import {
  adoptPipelineChoices,
  allPipelinesResolved,
  buildMaps,
  shouldShowPipelineStep,
  targetsForFunil,
} from '../pipeline-map';
import { dropFunilChoices, stageKey } from '../stage-map';
import {
  readLeadPipelines,
  readLeadStages,
  readPipelineTargets,
  readStageTargets,
  type ImportLeadPipeline,
  type ImportLeadStage,
} from '../types';

const existing = (name: string, id: string): ImportLeadPipeline => ({
  name,
  leads: 1,
  resolution: { kind: 'existing', pipelineId: id },
});
const missing = (name: string): ImportLeadPipeline => ({ name, leads: 1, resolution: { kind: 'not_found' } });
const stage = (name: string, funil: string | null): ImportLeadStage => ({
  name,
  funil,
  leads: 1,
  resolution: { kind: 'not_found' },
});

describe('shouldShowPipelineStep', () => {
  const two = [
    { id: 'a', name: 'A', isDefault: true },
    { id: 'b', name: 'B', isDefault: false },
  ];
  it('hides with no sheet funil', () => expect(shouldShowPipelineStep([], two)).toBe(false));
  it('hides when all exist and the org has one funil', () =>
    expect(shouldShowPipelineStep([existing('A', 'a')], two.slice(0, 1))).toBe(false));
  it('shows when one is missing', () =>
    expect(shouldShowPipelineStep([missing('X')], two.slice(0, 1))).toBe(true));
  it('shows when the org has several funis', () =>
    expect(shouldShowPipelineStep([existing('A', 'a')], two)).toBe(true));
});

describe('buildMaps', () => {
  it('sends no pipelineId while a funil keeps the destination it resolves to by name', () => {
    const pipelines = [existing('Vendas', 'p1')];
    const choices = adoptPipelineChoices(pipelines, {});
    expect(buildMaps([], pipelines, choices, {})).toEqual({ stageMap: {}, pipelineMap: {} });
  });

  it('sends the chosen destination and keeps etapa choices apart per funil', () => {
    const pipelines = [missing('Novo funil'), existing('Vendas', 'p1')];
    const stages = [stage('Novo', 'Novo funil'), stage('Novo', 'Vendas'), stage('Solto', null)];
    const choices = { 'novo funil': 'p2', vendas: 'p1' };
    const stageChoices = {
      [stageKey(stages[0]!)]: { stageId: 's-a' },
      [stageKey(stages[1]!)]: { create: true as const },
      [stageKey(stages[2]!)]: { first: true as const },
    };
    expect(buildMaps(stages, pipelines, choices, stageChoices)).toEqual({
      stageMap: { Solto: { first: true } },
      pipelineMap: {
        'Novo funil': { pipelineId: 'p2', stages: { Novo: { stageId: 's-a' } } },
        Vendas: { stages: { Novo: { create: true } } },
      },
    });
  });

  it('omits the etapas the Etapas tab covers', () => {
    const stages = [stage('Novo', 'Vendas')];
    const out = buildMaps(stages, [existing('Vendas', 'p1')], { vendas: 'p1' }, { [stageKey(stages[0]!)]: { sheet: true } });
    expect(out.pipelineMap).toEqual({});
  });
});

describe('choices', () => {
  it('dropFunilChoices removes only that funil', () => {
    const a = stage('Novo', 'A');
    const b = stage('Novo', 'B');
    const out = dropFunilChoices({ [stageKey(a)]: { create: true }, [stageKey(b)]: { first: true } }, 'a');
    expect(Object.keys(out)).toEqual([stageKey(b)]);
  });
  it('stageKey ignores case and accents of the funil only', () => {
    expect(stageKey(stage('Novo', 'Vendas'))).toBe(stageKey(stage('Novo', ' vêndas ')));
    expect(stageKey(stage('Novo', 'A'))).not.toBe(stageKey(stage('Novo', 'B')));
  });
  it('allPipelinesResolved needs a destination for every funil', () => {
    expect(allPipelinesResolved([missing('X')], {})).toBe(false);
    expect(allPipelinesResolved([missing('X')], { x: 'p' })).toBe(true);
  });
  it('targetsForFunil scopes to the destination and offers a funil-less target everywhere', () => {
    const targets = [
      { id: '1', name: 'A', kind: 'normal' as const, pipelineId: 'p1' },
      { id: '2', name: 'B', kind: 'normal' as const, pipelineId: 'p2' },
      { id: '3', name: 'C', kind: 'normal' as const, pipelineId: null },
    ];
    expect(targetsForFunil(targets, 'X', { x: 'p2' }).map((t) => t.id)).toEqual(['2', '3']);
    expect(targetsForFunil(targets, null, {}).map((t) => t.id)).toEqual(['1', '2', '3']);
  });
});

describe('defensive readers', () => {
  it('reads an older API as empty and null', () => {
    expect(readLeadPipelines({ ok: true, counts: {}, issues: [], truncated: false })).toEqual([]);
    expect(readPipelineTargets(null)).toEqual([]);
    expect(readStageTargets({ ok: true, counts: {}, issues: [], truncated: false, stageTargets: [{ id: 'x', name: 'Y' }] } as never)[0]?.pipelineId).toBeNull();
    expect(readLeadStages({ ok: true, counts: {}, issues: [], truncated: false, leadStages: [{ name: 'N', leads: 1, resolution: { kind: 'not_found' } }] } as never)[0]?.funil).toBeNull();
  });
  it('drops malformed rows and reads an unknown resolution as not_found', () => {
    const body = {
      ok: true, counts: {}, issues: [], truncated: false,
      leadPipelines: [{ name: 3 }, { name: 'A', leads: 2, resolution: { kind: 'weird' } }, { name: 'B', resolution: { kind: 'existing', pipelineId: 'p' } }],
      pipelineTargets: [{ id: 1 }, { id: 'p', name: 'B', isDefault: true }],
    };
    expect(readLeadPipelines(body as never)).toEqual([
      { name: 'A', leads: 2, resolution: { kind: 'not_found' } },
      { name: 'B', leads: 0, resolution: { kind: 'existing', pipelineId: 'p' } },
    ]);
    expect(readPipelineTargets(body as never)).toEqual([{ id: 'p', name: 'B', isDefault: true }]);
  });
});
