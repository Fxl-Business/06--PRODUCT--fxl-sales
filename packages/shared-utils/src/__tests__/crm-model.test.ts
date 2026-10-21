import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PIPELINE_STAGES,
  DEFAULT_PIPELINE_TRANSITIONS,
} from '../default-pipeline.js';
import {
  CAPABILITY_MODULES,
  CRM_MODULE_KEYS,
  defaultStageBehavior,
  defaultStageRequiresReason,
  isCrmModuleKey,
  modulesForEdition,
  planPipelineTransitions,
  SYSTEM_FIELD_CLIENTE,
  type TransitionPlanStage,
} from '../crm-model.js';
import { editionCapabilities } from '../sales-edition.js';

const defaultStages: TransitionPlanStage[] = DEFAULT_PIPELINE_STAGES.map((stage) => ({
  id: stage.key,
  name: stage.label,
  position: stage.order,
  type: stage.type,
  exitKind: stage.exitKind,
  status: 'active',
}));

describe('crm-model', () => {
  it('planPipelineTransitions over the default stages equals DEFAULT_PIPELINE_TRANSITIONS', () => {
    const planned = planPipelineTransitions(defaultStages).map(([a, b]) => `${a}>${b}`).sort();
    const expected = DEFAULT_PIPELINE_TRANSITIONS.map(([a, b]) => `${a}>${b}`).sort();
    expect(planned).toEqual(expected);
    expect(planned).toHaveLength(22);
  });

  it('planPipelineTransitions ignores archived stages and adapts to a legacy-shaped pipeline', () => {
    const legacy: TransitionPlanStage[] = [
      { id: 'n', name: 'Prospecção', position: 1, type: 'normal', exitKind: null, status: 'active' },
      { id: 'e', name: 'Em negociação', position: 2, type: 'normal', exitKind: null, status: 'active' },
      { id: 'p', name: 'Proposta', position: 3, type: 'orcamento', exitKind: null, status: 'active' },
      { id: 'l', name: 'Perdido', position: 4, type: 'saida', exitKind: 'perdido', status: 'active' },
      { id: 'x', name: 'Antiga', position: 5, type: 'normal', exitKind: null, status: 'archived' },
      { id: 'g', name: 'Ganho', position: 6, type: 'saida', exitKind: 'ganho', status: 'active' },
      { id: 'z', name: 'Pausado', position: 7, type: 'saida', exitKind: 'pausado', status: 'active' },
    ];
    const planned = planPipelineTransitions(legacy);
    expect(planned).toHaveLength(16);
    expect(planned.some(([a, b]) => a === 'x' || b === 'x')).toBe(false);
    expect(planned).toContainEqual(['n', 'e']);
    expect(planned).toContainEqual(['e', 'n']);
    expect(planned).toContainEqual(['z', 'p']);
    expect(planned).not.toContainEqual(['l', 'n']);
    expect(planned).not.toContainEqual(['g', 'n']);
  });

  it('default stage behavior and reason rules', () => {
    expect(DEFAULT_PIPELINE_STAGES.map((s) => defaultStageBehavior(s))).toEqual([
      'none', 'none', 'none', 'opens_orcamentos', 'none', 'none', 'none',
    ]);
    expect(DEFAULT_PIPELINE_STAGES.filter((s) => defaultStageRequiresReason(s)).map((s) => s.key)).toEqual(['perdido']);
  });

  it('modulesForEdition reproduces each edition exactly', () => {
    expect(Object.keys(modulesForEdition('full')).sort()).toEqual([...CRM_MODULE_KEYS].sort());
    expect(Object.values(modulesForEdition('full')).every(Boolean)).toBe(true);
    const leads = modulesForEdition('leads');
    expect(Object.entries(leads).filter(([, on]) => on).map(([key]) => key).sort()).toEqual(['clientes', 'importacao']);
  });

  it('every capability maps to known modules and every module is reachable', () => {
    const mapped = new Set(Object.values(CAPABILITY_MODULES).flat());
    for (const key of CRM_MODULE_KEYS) expect(mapped.has(key), key).toBe(true);
    for (const capability of editionCapabilities('full')) expect(CAPABILITY_MODULES[capability].length).toBeGreaterThan(0);
    expect(isCrmModuleKey('orcamentos')).toBe(true);
    expect(isCrmModuleKey('sales.core')).toBe(false);
  });

  it('the Cliente system field is not removable', () => {
    expect(SYSTEM_FIELD_CLIENTE).toMatchObject({ isSystem: true, removable: false, backingColumn: 'client_id' });
  });
});
