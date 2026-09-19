import { afterEach, describe, expect, it, vi } from 'vitest';
import { apiFetch } from '@/lib/api-client';
import { queryKeys } from '@/lib/query-keys';
import { LEADS_PATH, LEAD_STAGES_PATH, leadsApi } from '../api';

vi.mock('@/lib/api-client', () => ({
  apiFetch: vi.fn(async () => ({})),
}));

type ApiFetchCall = [string, { method: string; token: string; body?: string }];

function calls(): ApiFetchCall[] {
  return vi.mocked(apiFetch).mock.calls as unknown as ApiFetchCall[];
}

/** Indexed access is checked, so a missing call is a loud failure and not `undefined`. */
function call(index: number): ApiFetchCall {
  const entry = calls()[index];
  if (!entry) throw new Error(`apiFetch was not called ${index + 1} time(s)`);
  return entry;
}

function bodyOf(entry: ApiFetchCall): Record<string, unknown> {
  return JSON.parse(entry[1].body ?? '{}') as Record<string, unknown>;
}

afterEach(() => {
  vi.clearAllMocks();
});

describe('leadsApi', () => {
  it('every leads endpoint sends the bearer token it was given', async () => {
    await leadsApi.listLeads({ stageId: 'S1' }, 'token-1');
    await leadsApi.saveLead({ contactName: 'Ana', clientName: 'Acme' }, 'token-1');
    await leadsApi.saveLead({ id: 'L1', contactName: 'Ana', clientName: 'Acme' }, 'token-1');
    await leadsApi.moveLead({ leadId: 'L1', toStageId: 'S2', toIndex: 0 }, 'token-1');
    await leadsApi.listStages('token-1');
    await leadsApi.saveStage({ name: 'Contato' }, 'token-1');
    await leadsApi.setStageStatus({ id: 'S1', status: 'archived' }, 'token-1');
    await leadsApi.reorderStages({ stageIds: ['S1', 'S2'] }, 'token-1');

    expect(calls()).toHaveLength(8);
    for (const entry of calls()) {
      expect(entry[1].token).toBe('token-1');
    }
  });

  it('refuses a blank bearer token before any request is built', async () => {
    // Drives the REAL apiFetch, with fetch stubbed, exactly as
    // sales-ops/__tests__/blank-bearer-token.test.tsx does.
    vi.resetModules();
    vi.doUnmock('@/lib/api-client');
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    try {
      const realApi = await vi.importActual<typeof import('../api')>('../api');
      const { AuthTokenUnavailableError } = await vi.importActual<
        typeof import('@/lib/require-token')
      >('@/lib/require-token');

      await expect(realApi.leadsApi.listLeads({ stageId: 'S1' }, '')).rejects.toBeInstanceOf(
        AuthTokenUnavailableError,
      );
      await expect(
        realApi.leadsApi.moveLead({ leadId: 'L1', toStageId: 'S2', toIndex: 0 }, '   '),
      ).rejects.toBeInstanceOf(AuthTokenUnavailableError);
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('setStageStatus sends only the status key', async () => {
    await leadsApi.setStageStatus({ id: 'S1', status: 'archived' }, 'token-1');
    const [path, init] = call(0);
    expect(path).toBe(`${LEAD_STAGES_PATH}/S1`);
    expect(init.method).toBe('PATCH');
    expect(bodyOf(call(0))).toEqual({ status: 'archived' });
  });

  it('listLeads encodes the cursor and omits absent params', async () => {
    await leadsApi.listLeads({ stageId: 'S1' }, 'token-1');
    expect(call(0)[0]).toBe(`${LEADS_PATH}?stageId=S1&limit=100`);

    vi.clearAllMocks();
    await leadsApi.listLeads(
      { stageId: 'S1', cursor: '12:aaaa+bbbb&cccc', sellerPersonId: 'p-1', limit: 25 },
      'token-1',
    );
    const url = new URL(`http://x${call(0)[0]}`);
    expect(url.searchParams.get('cursor')).toBe('12:aaaa+bbbb&cccc');
    expect(url.searchParams.get('sellerPersonId')).toBe('p-1');
    expect(url.searchParams.get('limit')).toBe('25');
    expect(call(0)[0]).toContain('cursor=12%3Aaaaa%2Bbbbb%26cccc');
  });

  it('moveLead posts to the lead own move path and never to a transition path', async () => {
    await leadsApi.moveLead(
      { leadId: 'L1', toStageId: 'S2', toIndex: 3, reason: '', saleId: undefined },
      'token-1',
    );
    const [path, init] = call(0);
    expect(path).toBe(`${LEADS_PATH}/L1/move`);
    expect(path).not.toContain('/transition');
    expect(init.method).toBe('POST');
    // The wire names, and NOTHING else: MoveLeadSchema is .strict().
    expect(bodyOf(call(0))).toEqual({ stageId: 'S2', position: 3 });

    vi.clearAllMocks();
    await leadsApi.moveLead(
      { leadId: 'L1', toStageId: 'S2', toIndex: 0, reason: 'sem verba', saleId: 'sale-1' },
      'token-1',
    );
    expect(bodyOf(call(0))).toEqual({
      stageId: 'S2',
      position: 0,
      reason: 'sem verba',
      saleId: 'sale-1',
    });
  });

  it('the leads query keys are account- and org-agnostic', () => {
    expect(queryKeys.leads.all).toEqual(['leads']);
    expect(queryKeys.leads.stages()).toEqual(['leads', 'stages']);
    expect(queryKeys.leads.board(undefined)).toEqual(['leads', 'board', null]);
    expect(queryKeys.leads.board({ sellerPersonId: 'x' })).toEqual([
      'leads',
      'board',
      { sellerPersonId: 'x' },
    ]);
  });
});
