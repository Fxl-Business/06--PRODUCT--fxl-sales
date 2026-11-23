/**
 * Acceptance 01-api-plano-por-funil: the Etapas tab per funil, no_open_stage per funil, vendedor access to the funil
 * and the admin gate, on the REAL router and database.
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
  archiveStage,
  cleanupOrgs,
  countStages,
  createFuncao,
  createPessoa,
  errorsOf,
  leadsOf,
  send,
  stageIdsOf,
  twoFunis,
  vendedorFuncaoId,
  workbook,
  createPipeline,
  type Json,
} from './_fixtures.js';

afterEach(cleanupOrgs);
afterAll(closeDb);

describe('Etapas tab per funil', () => {
  it('creates the same etapa name in both funis', async () => {
    const t = await twoFunis('etapas-both');
    const bytes = await workbook({
      etapas: [
        { nome: 'Diagnóstico', funil: t.defaultName },
        { nome: 'Diagnóstico', funil: 'Parcerias' },
      ],
    });
    const preview = await send(t.org, '/import/preview', bytes);
    expect(((await preview.json()) as Json).ok).toBe(true);
    expect(await countStages(t.org)).toBe(14);
    expect((await send(t.org, '/import/commit', bytes)).status).toBe(201);
    expect(Object.keys(await stageIdsOf(t.org, t.defaultId))).toContain('Diagnóstico');
    expect(Object.keys(await stageIdsOf(t.org, t.parceriasId))).toContain('Diagnóstico');
    expect(await countStages(t.org)).toBe(16);
  });

  it('lands a lead in an etapa the same file creates in its funil', async () => {
    const t = await twoFunis('etapas-lead');
    const bytes = await workbook({
      etapas: [{ nome: 'Diagnóstico', funil: 'Parcerias' }],
      leads: [{ contato: 'A', funil: 'Parcerias', etapa: 'Diagnóstico' }],
    });
    expect((await send(t.org, '/import/commit', bytes)).status).toBe(201);
    const parcerias = await stageIdsOf(t.org, t.parceriasId);
    expect((await leadsOf(t.org))['A']).toEqual({ stageId: parcerias['Diagnóstico'], pipelineId: t.parceriasId });
  });

  it('an etapa created for one funil is not an etapa of the other', async () => {
    const t = await twoFunis('etapas-scope');
    const bytes = await workbook({
      etapas: [{ nome: 'Diagnóstico', funil: 'Parcerias' }],
      leads: [{ contato: 'A', funil: t.defaultName, etapa: 'Diagnóstico' }],
    });
    const body = (await (await send(t.org, '/import/preview', bytes)).json()) as Json;
    expect(body.ok).toBe(false);
    expect(errorsOf(body).some((i) => i.sheet === 'leads' && i.row === 2 && i.column === 'Etapa')).toBe(true);
    expect((await send(t.org, '/import/commit', bytes)).status).toBe(422);
    expect(await countStages(t.org)).toBe(14);
  });

  it('duplicate_in_sheet is per funil and duplicate_existing is per funil', async () => {
    const t = await twoFunis('etapas-dup');
    const bytes = await workbook({
      etapas: [
        { nome: 'Diagnóstico', funil: t.defaultName },
        { nome: 'Diagnóstico', funil: 'Parcerias' },
        { nome: 'Diagnóstico', funil: t.defaultName },
        { nome: 'Novo', funil: 'Parcerias' },
      ],
    });
    const body = (await (await send(t.org, '/import/preview', bytes)).json()) as Json;
    const errs = errorsOf(body).filter((i) => i.sheet === 'etapas');
    expect(errs.filter((i) => i.code === 'duplicate_in_sheet').map((i) => i.row)).toEqual([4]);
    expect(errs.filter((i) => i.code === 'duplicate_existing').map((i) => i.row)).toEqual([5]);
    expect((await send(t.org, '/import/commit', bytes)).status).toBe(422);
    expect(await countStages(t.org)).toBe(14);
  });

  it('a name that exists only in the other funil is not a duplicate', async () => {
    const t = await twoFunis('etapas-nodup');
    const { getAdminDb } = await import('../../../apps/api/src/db/client.js');
    const { salesOpsPipelineStages } = await import('../../../apps/api/src/db/schema.js');
    const { eq } = await import('drizzle-orm');
    await getAdminDb().update(salesOpsPipelineStages).set({ name: 'Pausa B' }).where(eq(salesOpsPipelineStages.id, t.parceriasStages['Pausado']!));
    const bytes = await workbook({ etapas: [{ nome: 'Pausado', funil: 'Parcerias' }] });
    expect((await send(t.org, '/import/commit', bytes)).status).toBe(201);
  });

  it('refuses a blank Funil with two active funis (funil_required) and an unknown one (unknown_ref), on the Funil column', async () => {
    const t = await twoFunis('etapas-funil');
    const bytes = await workbook({
      etapas: [
        { nome: 'Diagnóstico' },
        { nome: 'Outra', funil: 'Inexistente' },
      ],
    });
    const body = (await (await send(t.org, '/import/preview', bytes)).json()) as Json;
    const errs = errorsOf(body).filter((i) => i.sheet === 'etapas' && i.column === 'Funil');
    expect(errs.find((i) => i.row === 2)!.code).toBe('funil_required');
    expect(errs.find((i) => i.row === 3)!.code).toBe('unknown_ref');
    expect((await send(t.org, '/import/commit', bytes)).status).toBe(422);
    expect(await countStages(t.org)).toBe(14);
  });
});

describe('no_open_stage per funil', () => {
  it('is one file-level error for a funil used by the Leads tab with no open etapa', async () => {
    const t = await twoFunis('noopen');
    for (const id of Object.values(t.parceriasStages)) await archiveStage(t.org, id);
    const bytes = await workbook({ leads: [{ contato: 'A', funil: 'Parcerias' }, { contato: 'B', funil: t.defaultName, etapa: 'Novo' }] });
    const body = (await (await send(t.org, '/import/preview', bytes)).json()) as Json;
    expect(body.ok).toBe(false);
    expect(errorsOf(body).some((i) => i.code === 'no_open_stage')).toBe(true);
    expect((await send(t.org, '/import/commit', bytes)).status).toBe(422);
    expect(await leadsOf(t.org)).toEqual({});
  });

  it('an Etapas tab row of that funil counts as open', async () => {
    const t = await twoFunis('noopen-ok');
    for (const id of Object.values(t.parceriasStages)) await archiveStage(t.org, id);
    const bytes = await workbook({
      etapas: [{ nome: 'Diagnóstico', funil: 'Parcerias' }],
      leads: [{ contato: 'A', funil: 'Parcerias' }],
    });
    expect((await send(t.org, '/import/commit', bytes)).status).toBe(201);
    const parcerias = await stageIdsOf(t.org, t.parceriasId);
    expect((await leadsOf(t.org))['A']!.stageId).toBe(parcerias['Diagnóstico']);
  });

  it('a funil with no open etapa that the Leads tab does not use raises nothing', async () => {
    const t = await twoFunis('noopen-unused');
    for (const id of Object.values(t.parceriasStages)) await archiveStage(t.org, id);
    const bytes = await workbook({ leads: [{ contato: 'A', funil: t.defaultName, etapa: 'Novo' }] });
    expect((await send(t.org, '/import/commit', bytes)).status).toBe(201);
  });
});

describe('vendedor access to the funil', () => {
  async function setup(tag: string) {
    const org = await twoFunis(tag);
    const comercialB = await createFuncao(org.org, 'Comercial B');
    // a third funil linked to Comercial B decides who reaches it
    const restrictedId = await createPipeline(org.org, 'Restrito', [comercialB]);
    const vendedor = await vendedorFuncaoId(org.org);
    await createPessoa(org.org, 'Rita Sem Acesso', [vendedor]);
    await createPessoa(org.org, 'Bia Com Acesso', [vendedor, comercialB]);
    return { ...org, restrictedId, restrictedStages: await stageIdsOf(org.org, restrictedId) };
  }

  it('refuses a vendedor who does not reach the funil, on the Vendedor column', async () => {
    const t = await setup('acc-no');
    const bytes = await workbook({ leads: [{ contato: 'A', funil: 'Restrito', etapa: 'Novo', vendedor: 'Rita Sem Acesso' }] });
    const body = (await (await send(t.org, '/import/preview', bytes)).json()) as Json;
    expect(body.ok).toBe(false);
    expect(errorsOf(body).find((i) => i.code === 'seller_without_pipeline_access')).toMatchObject({ sheet: 'leads', row: 2, column: 'Vendedor' });
    expect((await send(t.org, '/import/commit', bytes)).status).toBe(422);
    expect(await leadsOf(t.org)).toEqual({});
  });

  it('accepts a vendedor whose função is linked to the funil', async () => {
    const t = await setup('acc-yes');
    const bytes = await workbook({ leads: [{ contato: 'A', funil: 'Restrito', etapa: 'Novo', vendedor: 'Bia Com Acesso' }] });
    expect((await send(t.org, '/import/commit', bytes)).status).toBe(201);
    expect((await leadsOf(t.org))['A']).toEqual({ stageId: t.restrictedStages['Novo'], pipelineId: t.restrictedId });
  });

  it('a vendedor with no linked função reaches the default funil only', async () => {
    const t = await setup('acc-default');
    const ok = await workbook({ leads: [{ contato: 'A', funil: t.defaultName, etapa: 'Novo', vendedor: 'Rita Sem Acesso' }] });
    expect((await send(t.org, '/import/commit', ok)).status).toBe(201);
    const bad = await workbook({ leads: [{ contato: 'B', funil: 'Parcerias', etapa: 'Novo', vendedor: 'Rita Sem Acesso' }] });
    const body = (await (await send(t.org, '/import/preview', bad)).json()) as Json;
    expect(errorsOf(body).some((i) => i.code === 'seller_without_pipeline_access')).toBe(true);
  });

  it('judges a blank Funil by the only active funil', async () => {
    const t = await setup('acc-blank');
    // archive the extra funis so a blank Funil resolves
    const { archivePipeline } = await import('./_fixtures.js');
    await archivePipeline(t.org, t.parceriasId);
    await archivePipeline(t.org, t.restrictedId);
    const bytes = await workbook({ leads: [{ contato: 'A', etapa: 'Novo', vendedor: 'Rita Sem Acesso' }] });
    expect((await send(t.org, '/import/commit', bytes)).status).toBe(201);
  });

  it('a vendedor without access is not judged on a row whose Funil failed', async () => {
    const t = await setup('acc-failed');
    const bytes = await workbook({ leads: [{ contato: 'A', funil: 'Inexistente', etapa: 'Novo', vendedor: 'Rita Sem Acesso' }] });
    const body = (await (await send(t.org, '/import/preview', bytes)).json()) as Json;
    expect(errorsOf(body).some((i) => i.code === 'seller_without_pipeline_access')).toBe(false);
    expect(errorsOf(body).some((i) => i.column === 'Funil')).toBe(true);
  });
});

describe('admin gate', () => {
  it('refuses a non-admin on preview and commit and writes nothing', async () => {
    const t = await twoFunis('gate');
    const bytes = await workbook({ leads: [{ contato: 'A', funil: 'Parcerias', etapa: 'Novo' }] });
    for (const path of ['/import/preview', '/import/commit'] as const) {
      const res = await send(t.org, path, bytes, { pipelineMap: {} }, 'seller');
      expect(res.status, path).toBe(403);
    }
    expect(await leadsOf(t.org)).toEqual({});
    expect(await countStages(t.org)).toBe(14);
  });
});
