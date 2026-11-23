/**
 * Acceptance 01-api-plano-por-funil: leads of one file landing in each funil, Funil resolution and the preview
 * fields, on the REAL router and database. Issue columns are the header texts.
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
  archiveStage,
  cleanupOrgs,
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

describe('two funis with the same etapa names', () => {
  it('lands each lead of one file in the etapa of its own funil, in preview and commit', async () => {
    const t = await twoFunis('same');
    const bytes = await workbook({
      leads: [
        { contato: 'A', funil: t.defaultName, etapa: 'Novo' },
        { contato: 'B', funil: 'Parcerias', etapa: 'Novo' },
        { contato: 'C', funil: 'Parcerias', etapa: 'Qualificação' },
      ],
    });
    const preview = await send(t.org, '/import/preview', bytes);
    expect(preview.status).toBe(200);
    expect(((await preview.json()) as Json).ok).toBe(true);
    expect(await leadsOf(t.org)).toEqual({});

    const commit = await send(t.org, '/import/commit', bytes);
    expect(commit.status).toBe(201);
    expect(await leadsOf(t.org)).toEqual({
      A: { stageId: t.defaultStages['Novo'], pipelineId: t.defaultId },
      B: { stageId: t.parceriasStages['Novo'], pipelineId: t.parceriasId },
      C: { stageId: t.parceriasStages['Qualificação'], pipelineId: t.parceriasId },
    });
  });

  it('matches the Funil name ignoring case', async () => {
    const t = await twoFunis('case');
    const commit = await send(t.org, '/import/commit', await workbook({ leads: [{ contato: 'A', funil: 'parcerias', etapa: 'Novo' }] }));
    expect(commit.status).toBe(201);
    expect((await leadsOf(t.org))['A']).toEqual({ stageId: t.parceriasStages['Novo'], pipelineId: t.parceriasId });
  });

  it('puts a blank Etapa in the first open etapa of ITS funil', async () => {
    const t = await twoFunis('blank');
    const commit = await send(t.org, '/import/commit', await workbook({ leads: [{ contato: 'A', funil: 'Parcerias' }, { contato: 'B', funil: t.defaultName }] }));
    expect(commit.status).toBe(201);
    const leads = await leadsOf(t.org);
    expect(leads['A']).toEqual({ stageId: t.parceriasStages['Novo'], pipelineId: t.parceriasId });
    expect(leads['B']).toEqual({ stageId: t.defaultStages['Novo'], pipelineId: t.defaultId });
  });

  it('skips an archived first etapa of the second funil', async () => {
    const t = await twoFunis('skip');
    await archiveStage(t.org, t.parceriasStages['Novo']!);
    const commit = await send(t.org, '/import/commit', await workbook({ leads: [{ contato: 'A', funil: 'Parcerias' }] }));
    expect(commit.status).toBe(201);
    expect((await leadsOf(t.org))['A']).toEqual({ stageId: t.parceriasStages['Qualificação'], pipelineId: t.parceriasId });
  });

  it('refuses an etapa that exists only in another funil, on the Etapa column', async () => {
    const t = await twoFunis('other');
    // rename the etapa Pausado of Parcerias away so the name exists only in the default funil
    const { getAdminDb } = await import('../../../apps/api/src/db/client.js');
    const { salesOpsPipelineStages } = await import('../../../apps/api/src/db/schema.js');
    const { eq } = await import('drizzle-orm');
    await getAdminDb().update(salesOpsPipelineStages).set({ name: 'Pausa B' }).where(eq(salesOpsPipelineStages.id, t.parceriasStages['Pausado']!));
    const bytes = await workbook({ leads: [{ contato: 'A', funil: 'Parcerias', etapa: 'Pausado' }] });
    const preview = await send(t.org, '/import/preview', bytes);
    const body = (await preview.json()) as Json;
    expect(body.ok).toBe(false);
    expect(errorsOf(body).some((i) => i.sheet === 'leads' && i.row === 2 && i.column === 'Etapa')).toBe(true);
    expect((await send(t.org, '/import/commit', bytes)).status).toBe(422);
    expect(await leadsOf(t.org)).toEqual({});
  });
});

describe('blank Funil', () => {
  it('works while the org has exactly one active funil', async () => {
    const org = newOrgId('one');
    const defaultId = await seedDefaultPipeline(org);
    const stages = await stageIdsOf(org, defaultId);
    const commit = await send(org, '/import/commit', await workbook({ leads: [{ contato: 'A', etapa: 'Novo' }, { contato: 'B' }] }));
    expect(commit.status).toBe(201);
    expect(await leadsOf(org)).toEqual({
      A: { stageId: stages['Novo'], pipelineId: defaultId },
      B: { stageId: stages['Novo'], pipelineId: defaultId },
    });
  });

  it('works when the second funil is archived (one active funil left)', async () => {
    const t = await twoFunis('archblank');
    await archivePipeline(t.org, t.parceriasId);
    const commit = await send(t.org, '/import/commit', await workbook({ leads: [{ contato: 'A', etapa: 'Novo' }] }));
    expect(commit.status).toBe(201);
    expect((await leadsOf(t.org))['A']).toEqual({ stageId: t.defaultStages['Novo'], pipelineId: t.defaultId });
  });

  it('is funil_required on the Funil column with two active funis, and nothing is written', async () => {
    const t = await twoFunis('required');
    const bytes = await workbook({
      leads: [
        { contato: 'Bom', funil: 'Parcerias', etapa: 'Novo' },
        { contato: 'Sem funil', etapa: 'Novo' },
      ],
    });
    const preview = await send(t.org, '/import/preview', bytes);
    const body = (await preview.json()) as Json;
    expect(body.ok).toBe(false);
    const hits = errorsOf(body).filter((i) => i.code === 'funil_required');
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({ sheet: 'leads', row: 3, column: 'Funil' });

    const commit = await send(t.org, '/import/commit', bytes);
    expect(commit.status).toBe(422);
    expect(await leadsOf(t.org)).toEqual({});
  });

  it('is judged by the Funil alone: a failed Funil raises no Etapa issue on that row', async () => {
    const t = await twoFunis('noetapa');
    const body = (await (await send(t.org, '/import/preview', await workbook({ leads: [{ contato: 'A', funil: 'Inexistente', etapa: 'Etapa que nao existe' }] }))).json()) as Json;
    const rowErrors = errorsOf(body).filter((i) => i.sheet === 'leads' && i.row === 2);
    expect(rowErrors.some((i) => i.column === 'Funil')).toBe(true);
    expect(rowErrors.some((i) => i.column === 'Etapa')).toBe(false);
  });
});

describe('unknown and archived Funil', () => {
  it('is unknown_ref for a name no funil has and archived_ref for an archived funil', async () => {
    const t = await twoFunis('refs');
    const archivedId = await createPipeline(t.org, 'Antigo');
    await archivePipeline(t.org, archivedId);
    const bytes = await workbook({
      leads: [
        { contato: 'A', funil: 'Inexistente', etapa: 'Novo' },
        { contato: 'B', funil: 'Antigo', etapa: 'Novo' },
      ],
    });
    const body = (await (await send(t.org, '/import/preview', bytes)).json()) as Json;
    const funilErrors = errorsOf(body).filter((i) => i.column === 'Funil');
    expect(funilErrors.find((i) => i.row === 2)).toMatchObject({ sheet: 'leads', code: 'unknown_ref' });
    expect(funilErrors.find((i) => i.row === 3)).toMatchObject({ sheet: 'leads', code: 'archived_ref' });
    expect((await send(t.org, '/import/commit', bytes)).status).toBe(422);
    expect(await leadsOf(t.org)).toEqual({});
  });
});

describe('preview fields', () => {
  it('reports leadPipelines, pipelineTargets, leadStages.funil and stageTargets.pipelineId', async () => {
    const t = await twoFunis('fields');
    const archivedId = await createPipeline(t.org, 'Antigo');
    await archivePipeline(t.org, archivedId);
    const bytes = await workbook({
      leads: [
        { contato: 'A', funil: t.defaultName, etapa: 'Novo' },
        { contato: 'B', funil: 'Parcerias', etapa: 'Novo' },
        { contato: 'C', funil: 'Parcerias', etapa: 'Novo' },
        { contato: 'D', funil: 'Antigo', etapa: 'Novo' },
        { contato: 'E', funil: 'Fantasma', etapa: 'Novo' },
      ],
    });
    const body = (await (await send(t.org, '/import/preview', bytes)).json()) as Json;

    const pipelines = body.leadPipelines as Array<{ name: string; leads: number; resolution: { kind: string; pipelineId?: string } }>;
    const byName = Object.fromEntries(pipelines.map((p) => [p.name, p]));
    expect(Object.keys(byName).sort()).toEqual(['Antigo', 'Fantasma', 'Parcerias', t.defaultName].sort());
    expect(byName['Parcerias']).toMatchObject({ leads: 2, resolution: { kind: 'existing', pipelineId: t.parceriasId } });
    expect(byName[t.defaultName]).toMatchObject({ leads: 1, resolution: { kind: 'existing', pipelineId: t.defaultId } });
    expect(byName['Antigo']!.resolution.kind).toBe('not_found');
    expect(byName['Fantasma']!.resolution.kind).toBe('not_found');

    const targets = body.pipelineTargets as Array<{ id: string; name: string; isDefault: boolean }>;
    expect(targets.map((p) => p.id).sort()).toEqual([t.defaultId, t.parceriasId].sort());
    expect(targets.find((p) => p.id === t.defaultId)!.isDefault).toBe(true);
    expect(targets.find((p) => p.id === t.parceriasId)!.isDefault).toBe(false);

    const leadStages = body.leadStages as Array<{ name: string; leads: number; funil: string | null }>;
    const novoParcerias = leadStages.find((s) => s.name === 'Novo' && s.funil === 'Parcerias');
    expect(novoParcerias).toMatchObject({ leads: 2 });
    expect(leadStages.find((s) => s.name === 'Novo' && s.funil === t.defaultName)).toMatchObject({ leads: 1 });
    // an etapa whose funil does not resolve is left out
    expect(leadStages.some((s) => s.funil === 'Fantasma' || s.funil === 'Antigo')).toBe(false);

    const stageTargets = body.stageTargets as Array<{ id: string; name: string; kind: string; pipelineId: string }>;
    const ofParcerias = stageTargets.filter((s) => s.pipelineId === t.parceriasId).map((s) => s.id);
    const ofDefault = stageTargets.filter((s) => s.pipelineId === t.defaultId).map((s) => s.id);
    expect(ofParcerias).toContain(t.parceriasStages['Novo']);
    expect(ofParcerias).not.toContain(t.parceriasStages['Proposta']);
    expect(ofDefault).toContain(t.defaultStages['Novo']);
    expect(ofDefault).not.toContain(t.defaultStages['Proposta']);
    expect(stageTargets.every((s) => s.pipelineId === t.defaultId || s.pipelineId === t.parceriasId)).toBe(true);
  });

  it('reports the Funil names of the Etapas tab too', async () => {
    const t = await twoFunis('etapasnames');
    const body = (await (await send(t.org, '/import/preview', await workbook({ etapas: [{ nome: 'Diagnóstico', funil: 'Parcerias' }] }))).json()) as Json;
    const names = (body.leadPipelines as Array<{ name: string }>).map((p) => p.name);
    expect(names).toContain('Parcerias');
  });

  it('never shows another organization funil or etapa', async () => {
    const t = await twoFunis('mine');
    const other = await twoFunis('theirs');
    const otherSecret = await createPipeline(other.org, 'Segredo');
    const body = (await (await send(t.org, '/import/preview', await workbook({ leads: [{ contato: 'A', funil: 'Segredo', etapa: 'Novo' }] }))).json()) as Json;
    const text = JSON.stringify(body);
    for (const id of [other.defaultId, other.parceriasId, otherSecret, ...Object.values(other.defaultStages), ...Object.values(other.parceriasStages)]) {
      expect(text).not.toContain(id);
    }
    expect(errorsOf(body).some((i) => i.column === 'Funil' && i.code === 'unknown_ref')).toBe(true);
    expect(await countStages(t.org)).toBe(14);
  });
});
