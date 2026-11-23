import { describe, expect, it } from 'vitest';
import { buildPipelineIndex } from '../pipeline-resolution.js';
import { IDS, pipelineRow, seededCatalog } from './plan-fixtures.js';

const two = () =>
  seededCatalog({
    pipelines: [
      pipelineRow(IDS.pipelineMain, 'Vendas', 0),
      pipelineRow(IDS.pipelineSecond, 'Pós-venda', 1),
      pipelineRow('00000000-0000-4000-8000-0000000000c9', 'Antigo', 2, { status: 'archived' }),
    ],
  });

describe('buildPipelineIndex.resolve', () => {
  it('matches the name ignoring case, accents and spaces', () => {
    const index = buildPipelineIndex(two());
    expect(index.resolve('  pos-VENDA ')).toMatchObject({ ok: true, pipelineId: IDS.pipelineSecond });
    expect(index.resolve('pós-venda')).toEqual({ ok: true, pipelineId: IDS.pipelineSecond, name: 'Pós-venda' });
    expect(index.resolve('VENDAS')).toEqual({ ok: true, pipelineId: IDS.pipelineMain, name: 'Vendas' });
  });

  it('reads a name nobody has as unknown_ref and an archived one as archived_ref', () => {
    const index = buildPipelineIndex(two());
    expect(index.resolve('Fantasma')).toMatchObject({ ok: false, code: 'unknown_ref' });
    expect(index.resolve('antigo')).toMatchObject({ ok: false, code: 'archived_ref' });
  });

  it('lets an active funil win over an archived one with the same name', () => {
    const catalog = seededCatalog({
      pipelines: [
        pipelineRow(IDS.pipelineMain, 'Vendas', 0),
        pipelineRow(IDS.pipelineSecond, 'vendas', 1, { status: 'archived' }),
      ],
    });
    expect(buildPipelineIndex(catalog).resolve('Vendas')).toMatchObject({ ok: true, pipelineId: IDS.pipelineMain });
  });

  it('picks the exact spelling among several active name matches, else unknown_ref', () => {
    const catalog = seededCatalog({
      pipelines: [pipelineRow(IDS.pipelineMain, 'Vendas', 0), pipelineRow(IDS.pipelineSecond, 'VENDAS', 1)],
    });
    const index = buildPipelineIndex(catalog);
    expect(index.resolve('VENDAS')).toMatchObject({ ok: true, pipelineId: IDS.pipelineSecond });
    expect(index.resolve(' Vendas ')).toMatchObject({ ok: true, pipelineId: IDS.pipelineMain });
    expect(index.resolve('vendas')).toMatchObject({ ok: false, code: 'unknown_ref' });
  });

  it('answers a blank with the only active funil, and funil_required otherwise', () => {
    const one = seededCatalog({
      pipelines: [pipelineRow(IDS.pipelineMain, 'Vendas', 0), pipelineRow(IDS.pipelineSecond, 'Velho', 1, { status: 'archived' })],
    });
    expect(buildPipelineIndex(one).resolve(null)).toMatchObject({ ok: true, pipelineId: IDS.pipelineMain });
    expect(buildPipelineIndex(one).resolve('   ')).toMatchObject({ ok: true, pipelineId: IDS.pipelineMain });
    expect(buildPipelineIndex(two()).resolve(null)).toMatchObject({ ok: false, code: 'funil_required' });
    expect(buildPipelineIndex(seededCatalog({ pipelines: [] })).resolve(null)).toMatchObject({ ok: false, code: 'funil_required' });
  });

  it('lets a map entry with pipelineId win over the name', () => {
    const index = buildPipelineIndex(two(), { vendas: { pipelineId: IDS.pipelineSecond }, Fantasma: { pipelineId: IDS.pipelineMain } });
    expect(index.resolve('Vendas')).toMatchObject({ ok: true, pipelineId: IDS.pipelineSecond, name: 'Pós-venda' });
    expect(index.resolve('Fantasma')).toMatchObject({ ok: true, pipelineId: IDS.pipelineMain });
    expect(index.resolveUnmapped('Vendas')).toMatchObject({ ok: true, pipelineId: IDS.pipelineMain });
    expect(index.resolveUnmapped('Fantasma')).toMatchObject({ ok: false, code: 'unknown_ref' });
  });

  it('refuses a map target that is archived, of another org or unknown as invalid_pipeline_target', () => {
    const index = buildPipelineIndex(two(), {
      A: { pipelineId: '00000000-0000-4000-8000-0000000000c9' },
      B: { pipelineId: '11111111-1111-4111-8111-111111111111' },
    });
    expect(index.resolve('A')).toMatchObject({ ok: false, code: 'invalid_pipeline_target' });
    expect(index.resolve('B')).toMatchObject({ ok: false, code: 'invalid_pipeline_target' });
  });

  it('ignores the map for a blank funil and for an entry that carries only stages', () => {
    const index = buildPipelineIndex(two(), { vendas: { stages: { x: { first: true } } } });
    expect(index.resolve(null)).toMatchObject({ ok: false, code: 'funil_required' });
    expect(index.resolve('Vendas')).toMatchObject({ ok: true, pipelineId: IDS.pipelineMain });
  });
});

describe('buildPipelineIndex.stageEntry', () => {
  it('applies the top-level stage map only to a blank funil and the funil stages only to that funil', () => {
    const index = buildPipelineIndex(
      two(),
      { Vendas: { stages: { Contato: { create: true } } } },
      { Contato: { first: true }, Outra: { stageId: 'x' } },
    );
    expect(index.stageEntry(null, ' contato ')).toEqual({ first: true });
    expect(index.stageEntry('', 'outra')).toEqual({ stageId: 'x' });
    expect(index.stageEntry('vendas', 'CONTATO')).toEqual({ create: true });
    expect(index.stageEntry('vendas', 'Outra')).toBeUndefined();
    expect(index.stageEntry('Pós-venda', 'Contato')).toBeUndefined();
  });
});
