import { afterEach, describe, expect, it, vi } from 'vitest';
import { apiFetch } from '@/lib/api-client';
import { queryKeys } from '@/lib/query-keys';
import { crmApi } from '../crm-api';

vi.mock('@/lib/api-client', () => ({
  apiFetch: vi.fn(async () => ({})),
}));

type ApiFetchCall = [string, { method: string; token: string; body?: string }];

function calls(): ApiFetchCall[] {
  return vi.mocked(apiFetch).mock.calls as unknown as ApiFetchCall[];
}

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

describe('crmApi', () => {
  it('every crm endpoint sends the bearer token it was given', async () => {
    await crmApi.listPipelines('token-1');
    await crmApi.listFieldDefinitions('token-1');
    await crmApi.getLeadSummary('L1', 'token-1');
    await crmApi.advanceLead({ leadId: 'L1', toStageId: 'S2' }, 'token-1');
    await crmApi.addLeadNote({ leadId: 'L1', body: 'oi' }, 'token-1');
    await crmApi.addLeadFollowup({ leadId: 'L1', nextStep: 'ligar', dueOn: '2026-10-22' }, 'token-1');
    await crmApi.listFollowups({ scope: 'mine', status: 'open' }, 'token-1');
    await crmApi.markFollowupDone('F1', 'token-1');

    expect(calls()).toHaveLength(8);
    expect(calls().every((c) => c[1].token === 'token-1')).toBe(true);
  });

  it('uses the contract paths and verbs', async () => {
    await crmApi.listPipelines('t');
    await crmApi.listFieldDefinitions('t');
    await crmApi.getLeadSummary('L1', 't');
    await crmApi.advanceLead({ leadId: 'L1', toStageId: 'S2' }, 't');
    await crmApi.addLeadNote({ leadId: 'L1', body: 'oi' }, 't');
    await crmApi.addLeadFollowup({ leadId: 'L1', nextStep: 'ligar', dueOn: '2026-10-22' }, 't');
    await crmApi.markFollowupDone('F1', 't');

    expect(call(0)[0]).toBe('/api/v1/sales-ops/pipelines');
    expect(call(0)[1].method).toBe('GET');
    expect(call(1)[0]).toBe('/api/v1/sales-ops/field-definitions');
    expect(call(1)[1].method).toBe('GET');
    expect(call(2)[0]).toBe('/api/v1/sales-ops/leads/L1/summary');
    expect(call(2)[1].method).toBe('GET');
    expect(call(3)[0]).toBe('/api/v1/sales-ops/leads/L1/advance');
    expect(call(3)[1].method).toBe('POST');
    expect(call(4)[0]).toBe('/api/v1/sales-ops/leads/L1/notes');
    expect(call(4)[1].method).toBe('POST');
    expect(call(5)[0]).toBe('/api/v1/sales-ops/leads/L1/followups');
    expect(call(5)[1].method).toBe('POST');
    expect(call(6)[0]).toBe('/api/v1/sales-ops/followups/F1/done');
    expect(call(6)[1].method).toBe('POST');
  });

  it('advanceLead sends only the keys that carry a value and never the lead id', async () => {
    await crmApi.advanceLead({ leadId: 'L1', toStageId: 'S2' }, 't');
    expect(bodyOf(call(0))).toEqual({ toStageId: 'S2' });

    await crmApi.advanceLead(
      { leadId: 'L1', toStageId: 'S2', nextStep: 'ligar', dueOn: '2026-10-22', note: 'n', reason: 'r' },
      't',
    );
    expect(bodyOf(call(1))).toEqual({ toStageId: 'S2', nextStep: 'ligar', dueOn: '2026-10-22', note: 'n', reason: 'r' });

    await crmApi.advanceLead({ leadId: 'L1', toStageId: 'S2', nextStep: '', dueOn: '', note: '', reason: '' }, 't');
    expect(bodyOf(call(2))).toEqual({ toStageId: 'S2' });
  });

  it('addLeadFollowup omits ownerPersonId when absent', async () => {
    await crmApi.addLeadFollowup({ leadId: 'L1', nextStep: 'ligar', dueOn: '2026-10-22' }, 't');
    expect(bodyOf(call(0))).toEqual({ nextStep: 'ligar', dueOn: '2026-10-22' });

    await crmApi.addLeadFollowup({ leadId: 'L1', nextStep: 'ligar', dueOn: '2026-10-22', ownerPersonId: 'P1' }, 't');
    expect(bodyOf(call(1))).toEqual({ nextStep: 'ligar', dueOn: '2026-10-22', ownerPersonId: 'P1' });
  });

  it('listFollowups builds the query with URLSearchParams', async () => {
    await crmApi.listFollowups({ scope: 'team', status: 'open', from: '2026-10-01', to: '2026-10-31' }, 't');
    expect(call(0)[0]).toBe('/api/v1/sales-ops/followups?scope=team&status=open&from=2026-10-01&to=2026-10-31');

    await crmApi.listFollowups({ scope: 'mine', status: 'all' }, 't');
    expect(call(1)[0]).toBe('/api/v1/sales-ops/followups?scope=mine&status=all');
  });

  it('queryKeys.leads exposes the new keys under the leads root and leaves board and summary untouched', () => {
    expect(queryKeys.leads.pipelines()[0]).toBe('leads');
    expect(queryKeys.leads.fieldDefinitions()[0]).toBe('leads');
    expect(queryKeys.leads.detail('L1')).toEqual(['leads', 'detail', 'L1']);
    expect(queryKeys.leads.followups({ scope: 'mine', status: 'open' })[0]).toBe('leads');
    expect(queryKeys.leads.board(undefined)).toEqual(['leads', 'board', null]);
    expect(queryKeys.leads.summary(undefined)).toEqual(['leads', 'summary', null]);
  });
});
