/**
 * Acceptance 01-api-plano-por-funil: the optional multipart pipelineMap (and the stageMap inside it), on the REAL
 * router and database.
 *
 * Run: VITEST_INTEGRATION=1 vitest run -c tests/acceptance/01-api-plano-por-funil/vitest.api.config.ts
 */
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  for (const name of [
    'FXL_HUB_CONFIG',
    'FXL_HUB_API_URL',
    'FXL_HUB_ENVIRONMENT',
    'FXL_HUB_CLIENT_ID',
    'FXL_HUB_CLIENT_SECRET',
    'FXL_HUB_AUDIENCE',
    'SALES_ENV_FILE',
    'SALES_AUTH_FAKE',
  ]) {
    process.env[name] = '';
  }
});

import { closeDb } from '../../../apps/api/src/db/client.js';
import {
  archivePipeline,
  cleanupOrgs,
  countPipelines,
  countStages,
  createPipeline,
  errorsOf,
  leadsOf,
  newOrgId,
  seedDefaultPipeline,
  send,
  stageIdsOf,
  twoFunis,
  workbook,
  type Json,
} from './_fixtures.js';

afterEach(cleanupOrgs);
afterAll(closeDb);

describe('pipelineMap with pipelineId', () => {
  it('solves an unknown Funil name by pointing it at an existing funil', async () => {
    const t = await twoFunis('unk');
    const bytes = await workbook({ leads: [{ contato: 'A', funil: 'Vendas Norte', etapa: 'Novo' }] });
    expect(((await (await send(t.org, '/import/preview', bytes)).json()) as Json).ok).toBe(false);
    expect((await send(t.org, '/import/commit', bytes)).status).toBe(422);

    const maps = { pipelineMap: { 'Vendas Norte': { pipelineId: t.parceriasId } } };
    const preview = await send(t.org, '/import/preview', bytes, maps);
    expect(((await preview.json()) as Json).ok).toBe(true);
    expect(await leadsOf(t.org)).toEqual({});
    expect((await send(t.org, '/import/commit', bytes, maps)).status).toBe(201);
    expect(await leadsOf(t.org)).toEqual({ A: { stageId: t.parceriasStages['Novo'], pipelineId: t.parceriasId } });
  });

  it('matches the map key as the sheet writes it, ignoring case', async () => {
    const t = await twoFunis('key');
    const bytes = await workbook({ leads: [{ contato: 'A', funil: 'VENDAS norte', etapa: 'Novo' }] });
    const commit = await send(t.org, '/import/commit', bytes, { pipelineMap: { 'Vendas Norte': { pipelineId: t.defaultId } } });
    expect(commit.status).toBe(201);
    expect((await leadsOf(t.org))['A']!.pipelineId).toBe(t.defaultId);
  });

  it('solves an archived Funil name the same way', async () => {
    const t = await twoFunis('arch');
    const oldId = await createPipeline(t.org, 'Antigo');
    await archivePipeline(t.org, oldId);
    const bytes = await workbook({ leads: [{ contato: 'A', funil: 'Antigo', etapa: 'Novo' }] });
    const refused = await send(t.org, '/import/commit', bytes);
    expect(refused.status).toBe(422);
    expect(await leadsOf(t.org)).toEqual({});
    const ok = await send(t.org, '/import/commit', bytes, { pipelineMap: { Antigo: { pipelineId: t.parceriasId } } });
    expect(ok.status).toBe(201);
    expect((await leadsOf(t.org))['A']!.pipelineId).toBe(t.parceriasId);
  });

  it('refuses a pipelineId of another org, an archived funil or a random id with invalid_pipeline_target and writes nothing', async () => {
    const t = await twoFunis('bad');
    const other = await twoFunis('bad-other');
    const oldId = await createPipeline(t.org, 'Antigo');
    await archivePipeline(t.org, oldId);
    const bytes = await workbook({
      leads: [
        { contato: 'Bom', funil: 'Parcerias', etapa: 'Novo' },
        { contato: 'Ruim', funil: 'Vendas Norte', etapa: 'Novo' },
      ],
    });
    const stagesBefore = await countStages(t.org);
    const pipelinesBefore = await countPipelines(t.org);
    const bad: Record<string, string> = {
      'another organization': other.parceriasId,
      archived: oldId,
      random: '00000000-0000-4000-8000-000000000abc',
    };
    for (const [label, pipelineId] of Object.entries(bad)) {
      const maps = { pipelineMap: { 'Vendas Norte': { pipelineId } } };
      const body = (await (await send(t.org, '/import/preview', bytes, maps)).json()) as Json;
      expect(body.ok, label).toBe(false);
      const hits = errorsOf(body).filter((i) => i.code === 'invalid_pipeline_target');
      expect(hits.length, label).toBeGreaterThan(0);
      expect(hits.every((i) => i.sheet === 'leads' && i.row === 3 && i.column === 'Funil'), label).toBe(true);
      expect((await send(t.org, '/import/commit', bytes, maps)).status, label).toBe(422);
      expect(await leadsOf(t.org), label).toEqual({});
      expect(await countStages(t.org), label).toBe(stagesBefore);
      expect(await countPipelines(t.org), label).toBe(pipelinesBefore);
    }
    expect(await leadsOf(other.org)).toEqual({});
  });

  it('refuses a malformed pipelineMap with 400 and writes nothing', async () => {
    const t = await twoFunis('malformed');
    const bytes = await workbook({ leads: [{ contato: 'A', funil: 'Parcerias', etapa: 'Novo' }] });
    for (const bad of ['not json', '[]', '{"X":"Y"}', '{"X":{"nope":1}}', '{"X":{"pipelineId":""}}', '{"X":{"pipelineId":5}}']) {
      for (const path of ['/import/preview', '/import/commit'] as const) {
        expect((await send(t.org, path, bytes, { pipelineMap: bad })).status, `${path} ${bad}`).toBe(400);
      }
    }
    expect(await leadsOf(t.org)).toEqual({});
  });

  it('treats a blank pipelineMap as none', async () => {
    const t = await twoFunis('blankmap');
    const bytes = await workbook({ leads: [{ contato: 'A', funil: 'Parcerias', etapa: 'Novo' }] });
    expect((await send(t.org, '/import/commit', bytes, { pipelineMap: '' })).status).toBe(201);
  });

  it('is all or nothing: a good row is not written when another row fails', async () => {
    const t = await twoFunis('atomic');
    const bytes = await workbook({
      leads: [
        { contato: 'Bom', funil: 'Parcerias', etapa: 'Novo' },
        { contato: 'Ruim', funil: 'Vendas Norte', etapa: 'Novo' },
      ],
    });
    expect((await send(t.org, '/import/commit', bytes)).status).toBe(422);
    expect(await leadsOf(t.org)).toEqual({});
  });
});

describe('pipelineMap[funil].stages', () => {
  const sheet = () => workbook({ leads: [{ contato: 'A', funil: 'Parcerias', etapa: 'Contato' }] });

  it('accepts a stageId of the right funil', async () => {
    const t = await twoFunis('stage-ok');
    const maps = { pipelineMap: { Parcerias: { stages: { Contato: { stageId: t.parceriasStages['Qualificação'] } } } } };
    expect((await send(t.org, '/import/commit', await sheet(), maps)).status).toBe(201);
    expect(await leadsOf(t.org)).toEqual({ A: { stageId: t.parceriasStages['Qualificação'], pipelineId: t.parceriasId } });
  });

  it('refuses a stageId of the OTHER funil with invalid_stage_target and writes nothing', async () => {
    const t = await twoFunis('stage-other');
    const maps = { pipelineMap: { Parcerias: { stages: { Contato: { stageId: t.defaultStages['Qualificação'] } } } } };
    const body = (await (await send(t.org, '/import/preview', await sheet(), maps)).json()) as Json;
    expect(body.ok).toBe(false);
    expect(errorsOf(body).some((i) => i.sheet === 'leads' && i.row === 2 && i.code === 'invalid_stage_target')).toBe(true);
    expect((await send(t.org, '/import/commit', await sheet(), maps)).status).toBe(422);
    expect(await leadsOf(t.org)).toEqual({});
  });

  it('refuses the conversion etapa of the right funil', async () => {
    const t = await twoFunis('stage-conv');
    const maps = { pipelineMap: { Parcerias: { stages: { Contato: { stageId: t.parceriasStages['Proposta'] } } } } };
    expect((await send(t.org, '/import/commit', await sheet(), maps)).status).toBe(422);
    expect(await leadsOf(t.org)).toEqual({});
  });

  it('{create: true} creates the etapa in that funil only, once', async () => {
    const t = await twoFunis('stage-create');
    const bytes = await workbook({
      leads: [
        { contato: 'A', funil: 'Parcerias', etapa: 'Contato' },
        { contato: 'B', funil: 'Parcerias', etapa: 'contato' },
      ],
    });
    const maps = { pipelineMap: { Parcerias: { stages: { Contato: { create: true } } } } };
    const preview = await send(t.org, '/import/preview', bytes, maps);
    expect(((await preview.json()) as Json).ok).toBe(true);
    expect(await countStages(t.org)).toBe(14);

    expect((await send(t.org, '/import/commit', bytes, maps)).status).toBe(201);
    const parcerias = await stageIdsOf(t.org, t.parceriasId);
    expect(Object.keys(parcerias)).toContain('Contato');
    expect(Object.keys(await stageIdsOf(t.org, t.defaultId))).not.toContain('Contato');
    expect(await countStages(t.org)).toBe(15);
    expect(await leadsOf(t.org)).toEqual({
      A: { stageId: parcerias['Contato'], pipelineId: t.parceriasId },
      B: { stageId: parcerias['Contato'], pipelineId: t.parceriasId },
    });
  });

  it('{create: true} on two sheet funis mapped to the same pipeline makes one etapa', async () => {
    const t = await twoFunis('stage-create-merge');
    const bytes = await workbook({
      leads: [
        { contato: 'A', funil: 'Norte', etapa: 'Contato' },
        { contato: 'B', funil: 'Sul', etapa: 'Contato' },
      ],
    });
    const maps = {
      pipelineMap: {
        Norte: { pipelineId: t.parceriasId, stages: { Contato: { create: true } } },
        Sul: { pipelineId: t.parceriasId, stages: { Contato: { create: true } } },
      },
    };
    expect((await send(t.org, '/import/commit', bytes, maps)).status).toBe(201);
    expect(await countStages(t.org)).toBe(15);
    const parcerias = await stageIdsOf(t.org, t.parceriasId);
    expect(await leadsOf(t.org)).toEqual({
      A: { stageId: parcerias['Contato'], pipelineId: t.parceriasId },
      B: { stageId: parcerias['Contato'], pipelineId: t.parceriasId },
    });
  });

  it('{first: true} puts the lead in the first open etapa of that funil', async () => {
    const t = await twoFunis('stage-first');
    const maps = { pipelineMap: { Parcerias: { stages: { Contato: { first: true } } } } };
    expect((await send(t.org, '/import/commit', await sheet(), maps)).status).toBe(201);
    expect(await leadsOf(t.org)).toEqual({ A: { stageId: t.parceriasStages['Novo'], pipelineId: t.parceriasId } });
  });

  it('pipelineId and stages combine in one entry', async () => {
    const t = await twoFunis('combo');
    const bytes = await workbook({ leads: [{ contato: 'A', funil: 'Vendas Norte', etapa: 'Contato' }] });
    const maps = { pipelineMap: { 'Vendas Norte': { pipelineId: t.parceriasId, stages: { Contato: { stageId: t.parceriasStages['Ganho'] } } } } };
    expect((await send(t.org, '/import/commit', bytes, maps)).status).toBe(201);
    expect(await leadsOf(t.org)).toEqual({ A: { stageId: t.parceriasStages['Ganho'], pipelineId: t.parceriasId } });
  });
});

describe('the top-level stageMap', () => {
  it('applies to a row whose Funil is blank', async () => {
    const org = newOrgId('top-blank');
    const defaultId = await seedDefaultPipeline(org);
    const stages = await stageIdsOf(org, defaultId);
    const bytes = await workbook({ leads: [{ contato: 'A', etapa: 'Contato' }] });
    expect((await send(org, '/import/commit', bytes, { stageMap: { Contato: { stageId: stages['Qualificação'] } } })).status).toBe(201);
    expect(await leadsOf(org)).toEqual({ A: { stageId: stages['Qualificação'], pipelineId: defaultId } });
  });

  it('does NOT apply to a row that names its Funil', async () => {
    const t = await twoFunis('top-named');
    const bytes = await workbook({ leads: [{ contato: 'A', funil: 'Parcerias', etapa: 'Contato' }] });
    const maps = { stageMap: { Contato: { stageId: t.parceriasStages['Qualificação'] } } };
    const body = (await (await send(t.org, '/import/preview', bytes, maps)).json()) as Json;
    expect(body.ok).toBe(false);
    expect(errorsOf(body).some((i) => i.sheet === 'leads' && i.row === 2 && i.column === 'Etapa')).toBe(true);
    expect((await send(t.org, '/import/commit', bytes, maps)).status).toBe(422);
    expect(await leadsOf(t.org)).toEqual({});
  });

  it('a pipelineMap entry does not leak into a row of another sheet funil', async () => {
    const t = await twoFunis('no-leak');
    const bytes = await workbook({
      leads: [
        { contato: 'A', funil: 'Parcerias', etapa: 'Contato' },
        { contato: 'B', funil: t.defaultName, etapa: 'Contato' },
      ],
    });
    const maps = { pipelineMap: { Parcerias: { stages: { Contato: { first: true } } } } };
    const body = (await (await send(t.org, '/import/preview', bytes, maps)).json()) as Json;
    const errs = errorsOf(body).filter((i) => i.sheet === 'leads');
    expect(errs.some((i) => i.row === 3 && i.column === 'Etapa')).toBe(true);
    expect(errs.some((i) => i.row === 2)).toBe(false);
    expect((await send(t.org, '/import/commit', bytes, maps)).status).toBe(422);
    expect(await leadsOf(t.org)).toEqual({});
  });
});
