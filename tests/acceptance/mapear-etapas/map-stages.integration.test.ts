/**
 * Acceptance: POST /import/preview and /import/commit with the optional multipart `stageMap`, on the REAL
 * router and database.
 *
 * Run: VITEST_INTEGRATION=1 vitest run -c tests/acceptance/mapear-etapas/vitest.api.config.ts
 *
 * The contract fixes the REQUEST (`stageMap`: sheet name -> {stageId} | {create: true} | {first: true}) but not the
 * names of the new preview fields, so the preview body is read by VALUE: the list of sheet etapas is the array of
 * objects that mentions the sheet names, the targets are the array of objects that mentions the stage ids.
 */
import { and, count, eq } from 'drizzle-orm';
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

import { closeDb, getAdminDb } from '../../../apps/api/src/db/client.js';
import { salesOpsCrmLeads, salesOpsPipelineStages } from '../../../apps/api/src/db/schema.js';
import {
  archiveStage,
  cleanupOrgs,
  leadStages,
  leadsWorkbook,
  newOrgId,
  seedStages,
  send,
  stageIds,
} from './_fixtures.js';

afterEach(cleanupOrgs);
afterAll(closeDb);

type Json = Record<string, unknown>;

function arraysOfObjects(value: unknown, out: Json[][] = []): Json[][] {
  if (Array.isArray(value)) {
    if (value.length > 0 && value.every((v) => typeof v === 'object' && v !== null && !Array.isArray(v))) out.push(value as Json[]);
    value.forEach((v) => arraysOfObjects(v, out));
  } else if (typeof value === 'object' && value !== null) {
    Object.values(value).forEach((v) => arraysOfObjects(v, out));
  }
  return out;
}

const stringValues = (o: Json): string[] => Object.values(o).filter((v): v is string => typeof v === 'string');

/** The array of the preview whose elements mention each given string somewhere among their values. */
function arrayMentioning(body: unknown, needles: string[]): Json[] | undefined {
  return arraysOfObjects(body).find((arr) => needles.every((n) => arr.some((el) => stringValues(el).includes(n))));
}

const rowFor = (arr: Json[], name: string): Json => {
  const row = arr.find((el) => stringValues(el).includes(name));
  if (!row) throw new Error(`no entry for ${name}`);
  return row;
};

const errors = (body: Json) => (body.issues as Array<Json>).filter((i) => i.severity === 'error');

describe('preview: the etapas of the Leads tab', () => {
  it('lists each distinct sheet etapa with its row count and resolution, and the choosable destination etapas without the conversion one', async () => {
    const org = newOrgId('dest');
    const ids = await seedStages(org);
    const bytes = await leadsWorkbook([
      ['A', 'Contato'],
      ['B', 'Contato'],
      ['C', 'Novo'],
      ['D', 'Proposta'],
    ]);
    const res = await send(org, '/import/preview', bytes);
    expect(res.status).toBe(200);
    const body = (await res.json()) as Json;

    const list = arrayMentioning(body, ['Contato', 'Novo', 'Proposta']);
    expect(list, 'list of etapa names of the sheet').toBeDefined();
    expect(list).toHaveLength(3);
    const [contato, novo, proposta] = ['Contato', 'Novo', 'Proposta'].map((n) => rowFor(list!, n));
    expect(Object.values(contato!)).toContain(2);
    expect(Object.values(novo!)).toContain(1);
    expect(Object.values(proposta!)).toContain(1);
    // not found / found by name / conversion are three different resolutions
    const resolution = (row: Json, name: string) => stringValues(row).filter((v) => v !== name && v !== ids[name]);
    const resolutions = [resolution(contato!, 'Contato'), resolution(novo!, 'Novo'), resolution(proposta!, 'Proposta')].map((r) => r.join('|'));
    expect(new Set(resolutions).size).toBe(3);

    const targets = arrayMentioning(body, [ids['Novo']!, ids['Perdido']!]);
    expect(targets, 'list of destination etapas').toBeDefined();
    const targetIds = targets!.flatMap(stringValues);
    for (const name of ['Novo', 'Qualificação', 'Em negociação', 'Ganho', 'Perdido', 'Pausado']) {
      expect(targetIds).toContain(ids[name]);
    }
    expect(targetIds).not.toContain(ids['Proposta']);
  });

  it('leaves out archived etapas from the destinations', async () => {
    const org = newOrgId('arch');
    const ids = await seedStages(org);
    await archiveStage(org, ids['Pausado']!);
    const res = await send(org, '/import/preview', await leadsWorkbook([['A', 'Contato']]));
    const body = (await res.json()) as Json;
    const targets = arrayMentioning(body, [ids['Novo']!]);
    expect(targets!.flatMap(stringValues)).not.toContain(ids['Pausado']);
  });
});

describe('without stageMap the import behaves as today', () => {
  it('refuses an unknown etapa and commits a known one', async () => {
    const org = newOrgId('plain');
    const ids = await seedStages(org);
    const bad = await send(org, '/import/commit', await leadsWorkbook([['A', 'Contato']]));
    expect(bad.status).toBe(422);
    expect(errors((await bad.json()) as Json).length).toBeGreaterThan(0);
    expect(await leadStages(org)).toEqual({});

    const good = await send(org, '/import/commit', await leadsWorkbook([['B', 'Novo']]));
    expect(good.status).toBe(201);
    expect(await leadStages(org)).toEqual({ B: ids['Novo'] });
  });
});

describe('stageMap', () => {
  it('imports a lead whose etapa does not exist at the destination into the chosen etapa', async () => {
    const org = newOrgId('map');
    const ids = await seedStages(org);
    const bytes = await leadsWorkbook([
      ['A', 'Contato'],
      ['B', 'Novo'],
    ]);
    const stageMap = { Contato: { stageId: ids['Qualificação'] } };
    const preview = await send(org, '/import/preview', bytes, stageMap);
    expect(preview.status).toBe(200);
    const previewBody = (await preview.json()) as Json;
    expect(previewBody.ok).toBe(true);
    expect(errors(previewBody)).toEqual([]);
    expect(await leadStages(org)).toEqual({});

    const commit = await send(org, '/import/commit', bytes, stageMap);
    expect(commit.status).toBe(201);
    expect(await leadStages(org)).toEqual({ A: ids['Qualificação'], B: ids['Novo'] });
  });

  it('{first: true} puts the lead in the first open etapa', async () => {
    const org = newOrgId('first');
    const ids = await seedStages(org);
    const commit = await send(org, '/import/commit', await leadsWorkbook([['A', 'Contato']]), { Contato: { first: true } });
    expect(commit.status).toBe(201);
    expect(await leadStages(org)).toEqual({ A: ids['Novo'] });
  });

  it('{create: true} creates the etapa with the sheet name once and places the leads in it', async () => {
    const org = newOrgId('create');
    const before = await seedStages(org);
    const bytes = await leadsWorkbook([
      ['A', 'Contato'],
      ['B', 'Contato'],
    ]);
    const preview = await send(org, '/import/preview', bytes, { Contato: { create: true } });
    expect(preview.status).toBe(200);
    expect(((await preview.json()) as Json).ok).toBe(true);
    expect(await stageIds(org)).toEqual(before);

    const commit = await send(org, '/import/commit', bytes, { Contato: { create: true } });
    expect(commit.status).toBe(201);
    const after = await stageIds(org);
    expect(Object.keys(after).sort()).toEqual([...Object.keys(before), 'Contato'].sort());
    const [created] = await getAdminDb()
      .select({ type: salesOpsPipelineStages.type, status: salesOpsPipelineStages.status })
      .from(salesOpsPipelineStages)
      .where(eq(salesOpsPipelineStages.id, after['Contato']!));
    expect(created).toEqual({ type: 'normal', status: 'active' });
    expect(await leadStages(org)).toEqual({ A: after['Contato'], B: after['Contato'] });
  });

  it('a stageId that is not usable is a row error and nothing is written', async () => {
    const dest = newOrgId('dest');
    const other = newOrgId('other');
    const ids = await seedStages(dest);
    const otherIds = await seedStages(other);
    await archiveStage(dest, ids['Pausado']!);
    const bytes = await leadsWorkbook([['A', 'Contato']]);
    const stagesBefore = await stageIds(dest);

    const bad: Record<string, string> = {
      'another organization': otherIds['Novo']!,
      'unknown id': '00000000-0000-4000-8000-000000000abc',
      archived: ids['Pausado']!,
      conversion: ids['Proposta']!,
    };
    for (const [label, stageId] of Object.entries(bad)) {
      const stageMap = { Contato: { stageId } };
      const preview = await send(dest, '/import/preview', bytes, stageMap);
      const previewBody = (await preview.json()) as Json;
      expect(previewBody.ok, label).toBe(false);
      const leadErrors = errors(previewBody).filter((i) => i.sheet === 'leads');
      expect(leadErrors.length, label).toBeGreaterThan(0);
      expect(leadErrors.every((i) => i.row === 2), label).toBe(true);

      const commit = await send(dest, '/import/commit', bytes, stageMap);
      expect(commit.status, label).toBe(422);
      expect(await leadStages(dest), label).toEqual({});
      expect(await stageIds(dest), label).toEqual(stagesBefore);
    }
    // the other org was never touched either
    expect(await leadStages(other)).toEqual({});
  });

  it('keeps the lost-reason rule on a mapped etapa', async () => {
    const org = newOrgId('lost');
    const ids = await seedStages(org);
    const stageMap = { Contato: { stageId: ids['Perdido'] } };
    const without = await send(org, '/import/commit', await leadsWorkbook([['A', 'Contato']]), stageMap);
    expect(without.status).toBe(422);
    expect(await leadStages(org)).toEqual({});

    const withReason = await send(org, '/import/commit', await leadsWorkbook([['A', 'Contato', 'Sem retorno']]), stageMap);
    expect(withReason.status).toBe(201);
    expect(await leadStages(org)).toEqual({ A: ids['Perdido'] });
  });

  it('is all or nothing: a good mapped row is not written when another row fails', async () => {
    const org = newOrgId('atomic');
    const ids = await seedStages(org);
    const bytes = await leadsWorkbook([
      ['A', 'Contato'],
      ['B', 'Outra etapa'],
    ]);
    const commit = await send(org, '/import/commit', bytes, { Contato: { stageId: ids['Novo'] } });
    expect(commit.status).toBe(422);
    const [{ n }] = await getAdminDb()
      .select({ n: count() })
      .from(salesOpsCrmLeads)
      .where(and(eq(salesOpsCrmLeads.orgId, org)));
    expect(n).toBe(0);
  });

  it('refuses a malformed stageMap with 400 and writes nothing', async () => {
    const org = newOrgId('malformed');
    await seedStages(org);
    const bytes = await leadsWorkbook([['A', 'Novo']]);
    for (const bad of ['not json', '[]', '{"Contato":{"nope":1}}', '{"Contato":"Novo"}']) {
      const res = await send(org, '/import/commit', bytes, bad);
      expect(res.status, bad).toBe(400);
    }
    expect(await leadStages(org)).toEqual({});
  });
});
