import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PIPELINE_KEY,
  DEFAULT_PIPELINE_NAME,
  DEFAULT_PIPELINE_NEW_STAGE_KEYS,
  DEFAULT_PIPELINE_STAGES,
  DEFAULT_PIPELINE_TRANSITIONS,
  LEGACY_LEAD_STAGE_COUNTERPART,
  type DefaultPipelineStageKey,
} from '../default-pipeline.js';

const EXPECTED_TRANSITIONS: readonly (readonly [string, string])[] = [
  ['novo', 'qualificacao'],
  ['qualificacao', 'em-negociacao'],
  ['em-negociacao', 'proposta'],
  ['qualificacao', 'novo'],
  ['em-negociacao', 'qualificacao'],
  ['proposta', 'em-negociacao'],
  ['novo', 'ganho'],
  ['novo', 'perdido'],
  ['novo', 'pausado'],
  ['qualificacao', 'ganho'],
  ['qualificacao', 'perdido'],
  ['qualificacao', 'pausado'],
  ['em-negociacao', 'ganho'],
  ['em-negociacao', 'perdido'],
  ['em-negociacao', 'pausado'],
  ['proposta', 'ganho'],
  ['proposta', 'perdido'],
  ['proposta', 'pausado'],
  ['pausado', 'novo'],
  ['pausado', 'qualificacao'],
  ['pausado', 'em-negociacao'],
  ['pausado', 'proposta'],
];

const OPEN_KEYS = ['novo', 'qualificacao', 'em-negociacao', 'proposta'] as const;
const EXIT_KEYS = ['ganho', 'perdido', 'pausado'] as const;

describe('default CRM pipeline', () => {
  it('has seven stages with unique keys and contiguous orders 1..7', () => {
    const keys = DEFAULT_PIPELINE_STAGES.map((s) => s.key);
    expect(new Set(keys).size).toBe(keys.length);
    expect(DEFAULT_PIPELINE_STAGES.map((s) => s.order)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(DEFAULT_PIPELINE_STAGES.map((s) => s.label)).toEqual([
      'Novo',
      'Qualificação',
      'Em negociação',
      'Proposta',
      'Ganho',
      'Perdido',
      'Pausado',
    ]);
  });

  it('exposes a stable key and name', () => {
    expect(DEFAULT_PIPELINE_KEY).toBe('crm-padrao');
    expect(DEFAULT_PIPELINE_NAME).toBe('Funil CRM padrão');
  });

  it('types and exit kinds agree', () => {
    const orcamento = DEFAULT_PIPELINE_STAGES.filter((s) => s.type === 'orcamento');
    expect(orcamento.map((s) => s.key)).toEqual(['proposta']);
    const saida = DEFAULT_PIPELINE_STAGES.filter((s) => s.type === 'saida');
    expect(saida.map((s) => s.exitKind)).toEqual(['ganho', 'perdido', 'pausado']);
    for (const stage of DEFAULT_PIPELINE_STAGES) {
      if (stage.type !== 'saida') expect(stage.exitKind).toBeNull();
    }
  });

  it('transitions are exactly the documented 22', () => {
    expect(DEFAULT_PIPELINE_TRANSITIONS.map(([a, b]) => [a, b])).toEqual(EXPECTED_TRANSITIONS);
    expect(DEFAULT_PIPELINE_TRANSITIONS).toHaveLength(22);
    const pairs = new Set(DEFAULT_PIPELINE_TRANSITIONS.map(([a, b]) => `${a}>${b}`));
    expect(pairs.size).toBe(22);
    const known = new Set<string>(DEFAULT_PIPELINE_STAGES.map((s) => s.key));
    for (const [a, b] of DEFAULT_PIPELINE_TRANSITIONS) {
      expect(known.has(a)).toBe(true);
      expect(known.has(b)).toBe(true);
    }
  });

  it('transitions follow the rule (derived independently)', () => {
    const derived = new Set<string>();
    OPEN_KEYS.forEach((key, i) => {
      if (i + 1 < OPEN_KEYS.length) derived.add(`${key}>${OPEN_KEYS[i + 1]}`);
      if (i > 0) derived.add(`${key}>${OPEN_KEYS[i - 1]}`);
      for (const exit of EXIT_KEYS) derived.add(`${key}>${exit}`);
    });
    for (const target of OPEN_KEYS) derived.add(`pausado>${target}`);
    const actual = new Set(DEFAULT_PIPELINE_TRANSITIONS.map(([a, b]) => `${a}>${b}`));
    expect(actual).toEqual(derived);
  });

  it('ganho and perdido are terminal, pausado returns only to open stages', () => {
    const froms = DEFAULT_PIPELINE_TRANSITIONS.map(([a]) => a);
    expect(froms).not.toContain('ganho');
    expect(froms).not.toContain('perdido');
    const pausadoTargets = DEFAULT_PIPELINE_TRANSITIONS.filter(([a]) => a === 'pausado').map(([, b]) => b);
    expect([...pausadoTargets].sort()).toEqual([...OPEN_KEYS].sort());
    const exitToExit = DEFAULT_PIPELINE_TRANSITIONS.filter(
      ([a, b]) => (EXIT_KEYS as readonly string[]).includes(a) && (EXIT_KEYS as readonly string[]).includes(b),
    );
    expect(exitToExit).toEqual([]);
  });

  it('legacy counterpart covers exactly the four legacy names and the new keys are the rest', () => {
    expect(Object.keys(LEGACY_LEAD_STAGE_COUNTERPART).sort()).toEqual(
      ['Em negociação', 'Novo', 'Perdido', 'Proposta'].sort(),
    );
    const mapped = Object.values(LEGACY_LEAD_STAGE_COUNTERPART) as DefaultPipelineStageKey[];
    const newKeys = DEFAULT_PIPELINE_NEW_STAGE_KEYS as readonly DefaultPipelineStageKey[];
    expect(mapped.some((k) => newKeys.includes(k))).toBe(false);
    const all = [...mapped, ...newKeys].sort();
    expect(all).toEqual(DEFAULT_PIPELINE_STAGES.map((s) => s.key).sort());
  });
});
