import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PIPELINE_STAGES,
  DEFAULT_PIPELINE_TRANSITIONS,
} from '../default-pipeline.js';
import {
  accessiblePipelineIds,
  ALL_MODULES_ENABLED,
  CAPABILITY_MODULES,
  CRM_MODULE_KEYS,
  defaultStageBehavior,
  defaultStageRequiresReason,
  editionFromModules,
  effectiveStageBehavior,
  isCrmModuleKey,
  isOrgModules,
  modulesAllowCapability,
  modulesForEdition,
  planPipelineTransitions,
  stageActsAsOrcamento,
  SYSTEM_FIELD_CLIENTE,
  type OrgModules,
  type TransitionPlanStage,
} from '../crm-model.js';
import { editionCapabilities, hasCapability, type SalesCapability } from '../sales-edition.js';

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
    expect(planned).toHaveLength(30);
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
    expect(planned).toHaveLength(22);
    expect(planned.some(([a, b]) => a === 'x' || b === 'x')).toBe(false);
    expect(planned).toContainEqual(['n', 'e']);
    expect(planned).toContainEqual(['e', 'n']);
    expect(planned).toContainEqual(['z', 'p']);
    expect(planned).toContainEqual(['l', 'n']);
    expect(planned).toContainEqual(['g', 'n']);
  });

  it('planPipelineTransitions links every active ganho and perdido exit to every active open stage, and no exit to an exit', () => {
    const stages: TransitionPlanStage[] = [
      { id: 'n', name: 'Novo', position: 1, type: 'normal', exitKind: null, status: 'active' },
      { id: 'p', name: 'Proposta', position: 2, type: 'orcamento', exitKind: null, status: 'active' },
      { id: 'g', name: 'Ganho', position: 3, type: 'saida', exitKind: 'ganho', status: 'active' },
      { id: 'l', name: 'Perdido', position: 4, type: 'saida', exitKind: 'perdido', status: 'active' },
      { id: 'z', name: 'Pausado', position: 5, type: 'saida', exitKind: 'pausado', status: 'active' },
      { id: 'f', name: 'Venda faturada', position: 6, type: 'normal', exitKind: null, status: 'active' },
      { id: 'x', name: 'Antiga', position: 7, type: 'normal', exitKind: null, status: 'archived' },
      { id: 'a', name: 'Ganho antigo', position: 8, type: 'saida', exitKind: 'ganho', status: 'archived' },
    ];
    const planned = planPipelineTransitions(stages).map(([a, b]) => `${a}>${b}`);
    const open = ['n', 'p', 'f'];
    const exits = ['g', 'l', 'z'];
    for (const exit of exits) {
      expect(planned.filter((pair) => pair.startsWith(`${exit}>`)).sort(), exit).toEqual(open.map((to) => `${exit}>${to}`).sort());
    }
    for (const from of exits) for (const to of exits) expect(planned).not.toContain(`${from}>${to}`);
    expect(planned.some((pair) => pair.includes('x') || pair.includes('a'))).toBe(false);
    expect(new Set(planned).size).toBe(planned.length);
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

describe('org modules (phase 3)', () => {
  const CAPABILITIES: readonly SalesCapability[] = [
    'proposals',
    'commissions',
    'catalog',
    'clients',
    'import',
    'finders',
    'history',
    'leadFullFields',
  ];

  it('ALL_MODULES_ENABLED is frozen with every key true', () => {
    expect(Object.isFrozen(ALL_MODULES_ENABLED)).toBe(true);
    expect(CRM_MODULE_KEYS.every((key) => ALL_MODULES_ENABLED[key] === true)).toBe(true);
  });

  it.each(['full', 'leads'] as const)('modulesAllowCapability reproduces hasCapability for %s', (edition) => {
    const modules = modulesForEdition(edition);
    for (const capability of CAPABILITIES) {
      expect(modulesAllowCapability(modules, capability), capability).toBe(hasCapability(edition, capability));
    }
  });

  it('editionFromModules round-trips both editions', () => {
    expect(editionFromModules(modulesForEdition('full'))).toBe('full');
    expect(editionFromModules(modulesForEdition('leads'))).toBe('leads');
  });

  it('editionFromModules follows orcamentos alone', () => {
    expect(editionFromModules({ ...ALL_MODULES_ENABLED, orcamentos: false })).toBe('leads');
    expect(editionFromModules({ ...modulesForEdition('leads'), orcamentos: true })).toBe('full');
  });

  it('isOrgModules accepts a full record and rejects a missing key or a non-boolean', () => {
    expect(isOrgModules(ALL_MODULES_ENABLED)).toBe(true);
    const { catalogo: _missing, ...partial } = ALL_MODULES_ENABLED;
    expect(isOrgModules(partial)).toBe(false);
    expect(isOrgModules({ ...ALL_MODULES_ENABLED, clientes: 'yes' })).toBe(false);
    expect(isOrgModules(null)).toBe(false);
  });

  it('stageActsAsOrcamento needs orcamentos on, type orcamento and behavior opens_orcamentos', () => {
    const on: OrgModules = { ...ALL_MODULES_ENABLED };
    const off: OrgModules = { ...ALL_MODULES_ENABLED, orcamentos: false };
    for (const modules of [on, off]) {
      for (const type of ['orcamento', 'normal']) {
        for (const behavior of ['opens_orcamentos', 'none']) {
          const stage = { type, behavior };
          const expected = modules === on && type === 'orcamento' && behavior === 'opens_orcamentos';
          expect(stageActsAsOrcamento(stage, modules)).toBe(expected);
          expect(effectiveStageBehavior(stage, modules)).toBe(expected ? 'opens_orcamentos' : 'none');
        }
      }
    }
  });
});

describe('accessiblePipelineIds (pipeline access by função)', () => {
  const comercial = { id: 'p-comercial', isDefault: true, status: 'active', funcaoIds: [] as string[] } as const;
  const financeiro = { id: 'p-financeiro', isDefault: false, status: 'active', funcaoIds: ['f-fin'] } as const;
  const pos = { id: 'p-pos', isDefault: false, status: 'active', funcaoIds: ['f-fin', 'f-pos'] } as const;
  const antigo = { id: 'p-antigo', isDefault: false, status: 'archived', funcaoIds: ['f-vendedor'] } as const;

  it('a pessoa with only the vendedor função keeps exactly the default pipeline', () => {
    expect(accessiblePipelineIds([comercial, financeiro, pos], ['f-vendedor'])).toEqual(['p-comercial']);
    expect(accessiblePipelineIds([comercial, financeiro], [])).toEqual(['p-comercial']);
  });

  it('a linked função reaches only the pipelines linked to it, never the default by itself', () => {
    expect(accessiblePipelineIds([comercial, financeiro, pos], ['f-vendedor', 'f-fin'])).toEqual(['p-financeiro', 'p-pos']);
    expect(accessiblePipelineIds([comercial, financeiro, pos], ['f-pos'])).toEqual(['p-pos']);
  });

  it('the default pipeline is reached through a link like any other', () => {
    const linkedDefault = { ...comercial, funcaoIds: ['f-vendedor'] };
    expect(accessiblePipelineIds([linkedDefault, financeiro], ['f-vendedor', 'f-fin'])).toEqual(['p-comercial', 'p-financeiro']);
  });

  it('an archived pipeline is never reached, linked or as the fallback', () => {
    expect(accessiblePipelineIds([comercial, antigo], ['f-vendedor'])).toEqual(['p-comercial']);
    expect(accessiblePipelineIds([{ ...comercial, status: 'archived' }, financeiro], ['f-x'])).toEqual(['p-financeiro']);
    expect(accessiblePipelineIds([antigo], ['f-vendedor'])).toEqual([]);
  });

  it('without an is_default row the fallback is the first active pipeline in the given order', () => {
    expect(accessiblePipelineIds([financeiro, pos].map((p) => ({ ...p, funcaoIds: [] })), ['f-x'])).toEqual(['p-financeiro']);
  });
});
