import { describe, expect, it } from 'vitest';
import { ALL_MODULES_ENABLED } from '@fxl-sales/shared-utils/crm-model';
import type { CrmPipeline } from '../crm-types';
import {
  legacyKindOf,
  pickPipeline,
  pipelineStagesAsBoardStages,
  stageOpensOrcamentos,
  summaryStageKind,
  sellersReachingPipeline,
} from '../crm-pipeline';

function pipeline(overrides: Partial<CrmPipeline> = {}): CrmPipeline {
  return {
    id: 'P1',
    name: 'Vendas',
    isDefault: true,
    position: 1,
    status: 'active',
    funcaoIds: [],
    stages: [],
    transitions: [],
    ...overrides,
  };
}

describe('crm-pipeline', () => {
  it('derives the legacy kind from the EFFECTIVE behavior and the exit kind by lookup', () => {
    expect(legacyKindOf({ behavior: 'opens_orcamentos', exitKind: null })).toBe('conversion');
    expect(legacyKindOf({ behavior: 'none', exitKind: null })).toBe('normal');
    expect(legacyKindOf({ behavior: 'opens_orcamentos', exitKind: 'perdido' })).toBe('lost');
    expect(legacyKindOf({ behavior: 'none', exitKind: 'ganho' })).toBe('normal');
    expect(legacyKindOf({ behavior: 'none', exitKind: 'pausado' })).toBe('normal');
  });

  it('summaryStageKind reads the modules: the summary carries no behavior, so the seeded rule applies per organization', () => {
    const orcamento = { type: 'orcamento' as const, exitKind: null };
    const orcamentosOff = { ...ALL_MODULES_ENABLED, orcamentos: false };
    expect(summaryStageKind(orcamento, ALL_MODULES_ENABLED)).toBe('conversion');
    expect(summaryStageKind(orcamento, orcamentosOff)).toBe('normal');
    // Outside the shell (no modules in context) the whole product applies.
    expect(summaryStageKind(orcamento, null)).toBe('conversion');
    expect(summaryStageKind({ type: 'saida', exitKind: 'perdido' }, orcamentosOff)).toBe('lost');
  });

  it('an orcamento stage with behavior none (orcamentos off) maps to kind normal', () => {
    // The API projects the EFFECTIVE behavior: with orcamentos off the stored type stays
    // 'orcamento', but the stage is an ordinary board stage, never the proposta wizard.
    const p = pipeline({
      stages: [
        { id: 'S-o', name: 'Proposta', position: 1, type: 'orcamento', behavior: 'none', exitKind: null, requiresReason: false, status: 'active' },
      ],
    });
    const [stage] = pipelineStagesAsBoardStages(p);
    expect(stage).toMatchObject({ kind: 'normal', type: 'orcamento', behavior: 'none' });
  });

  it('pipelineStagesAsBoardStages keeps active stages in position order and fills the additive fields', () => {
    const p = pipeline({
      id: 'P1',
      stages: [
        { id: 'S-a', name: 'Arquivada', position: 3, type: 'normal', behavior: 'none', exitKind: null, requiresReason: false, status: 'archived' },
        { id: 'S-b', name: 'Orçamento', position: 1, type: 'orcamento', behavior: 'opens_orcamentos', exitKind: null, requiresReason: false, status: 'active' },
        { id: 'S-c', name: 'Perdido', position: 2, type: 'saida', behavior: 'none', exitKind: 'perdido', requiresReason: true, status: 'active' },
      ],
    });
    const stages = pipelineStagesAsBoardStages(p);
    expect(stages.map((s) => s.id)).toEqual(['S-b', 'S-c']);
    expect(stages[0]).toMatchObject({
      pipelineId: 'P1',
      type: 'orcamento',
      behavior: 'opens_orcamentos',
      exitKind: null,
      requiresReason: false,
      kind: 'conversion',
    });
    expect(stages[1]).toMatchObject({ exitKind: 'perdido', requiresReason: true, kind: 'lost' });
    expect(pipelineStagesAsBoardStages(undefined)).toEqual([]);
  });

  it('pickPipeline prefers the selected, then the default, then the first active', () => {
    const archived = pipeline({ id: 'P-arch', status: 'archived', isDefault: false, position: 1 });
    const def = pipeline({ id: 'P-def', isDefault: true, position: 2 });
    const other = pipeline({ id: 'P-other', isDefault: false, position: 3 });
    expect(pickPipeline([archived, def, other], 'P-arch')?.id).toBe('P-def');
    expect(pickPipeline([other, pipeline({ id: 'P-x', isDefault: false })], null)?.id).toBe('P-other');
    expect(pickPipeline([], null)).toBeUndefined();
  });

  it('stageOpensOrcamentos keys on the behavior string only', () => {
    expect(stageOpensOrcamentos({ behavior: 'opens_orcamentos' })).toBe(true);
    expect(stageOpensOrcamentos({ behavior: 'none' })).toBe(false);
    expect(stageOpensOrcamentos(undefined)).toBe(false);
  });
});

describe('sellersReachingPipeline (vários funis)', () => {
  const comercial = pipeline({ id: 'P-com', isDefault: true });
  const financeiro = pipeline({ id: 'P-fin', isDefault: false, position: 2, funcaoIds: ['F-fin'] });
  const sellers = [
    { value: 'ana', label: 'Ana' },
    { value: 'bia', label: 'Bia' },
    { value: 'ghost', label: 'Sem pessoa' },
  ];
  const people = [
    { id: 'ana', funcaoIds: ['F-vendedor'] },
    { id: 'bia', funcaoIds: ['F-vendedor', 'F-fin'] },
  ];

  it('keeps only the vendedores who reach the pipeline, by the shared access rule', () => {
    expect(sellersReachingPipeline(sellers, people, [comercial, financeiro], 'P-com').map((o) => o.value)).toEqual(['ana']);
    expect(sellersReachingPipeline(sellers, people, [comercial, financeiro], 'P-fin').map((o) => o.value)).toEqual(['bia']);
  });

  it('passes every option through when no pipeline is in hand', () => {
    expect(sellersReachingPipeline(sellers, people, [comercial, financeiro], null)).toEqual(sellers);
  });
});
