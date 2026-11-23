import { beforeEach, describe, expect, it, vi } from 'vitest';

const apiUpload = vi.hoisted(() =>
  vi.fn(async (_path: string, _init: { token: string; form: FormData }) => ({})),
);
vi.mock('@/lib/api-client', () => ({ apiUpload, apiFetchBlob: vi.fn() }));

import { importApi } from '../api';

const file = new File([new Uint8Array(3)], 'p.xlsx');
const sentForm = () => apiUpload.mock.calls.at(-1)![1].form;

beforeEach(() => apiUpload.mockClear());

describe.each(['preview', 'commit'] as const)('importApi.%s', (verb) => {
  it('appends pipelineMap and stageMap as JSON when they have keys', async () => {
    await importApi[verb](file, 't', { Novo: { first: true } }, { Vendas: { pipelineId: 'p1' } });
    expect(apiUpload.mock.calls.at(-1)![0]).toContain(`/${verb}`);
    expect(JSON.parse(String(sentForm().get('pipelineMap')))).toEqual({ Vendas: { pipelineId: 'p1' } });
    expect(JSON.parse(String(sentForm().get('stageMap')))).toEqual({ Novo: { first: true } });
  });

  it('appends neither map when empty or absent', async () => {
    await importApi[verb](file, 't', {}, {});
    expect(sentForm().has('pipelineMap')).toBe(false);
    expect(sentForm().has('stageMap')).toBe(false);
    await importApi[verb](file, 't');
    expect(sentForm().has('pipelineMap')).toBe(false);
  });
});
