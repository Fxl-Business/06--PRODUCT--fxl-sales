import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { salesOpsApi, type RecordSettlementPayload } from '../../api';

/**
 * The settlement transport. v1 is full payment only and the server derives the
 * amount, so the record body is built field by field: an extra key on the
 * payload must never ride along.
 */

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

function call(index: number): { url: string; init: RequestInit } {
  const [url, init] = fetchMock.mock.calls[index] as [string, RequestInit];
  return { url, init };
}

describe('salesOpsApi settlements', () => {
  it('POSTs the settlement body with targetKind, targetId and paidOn only', async () => {
    const payload = {
      targetKind: 'receivable',
      targetId: 'rec-1',
      paidOn: '2026-09-20',
      // As if a caller leaked the amount through the payload.
      amountBrl: 150000,
    } as RecordSettlementPayload;

    await salesOpsApi.recordSettlement(payload, 'token');

    const { url, init } = call(0);
    expect(url.endsWith('/api/v1/sales-ops/settlements')).toBe(true);
    expect(init.method).toBe('POST');
    expect(JSON.parse(String(init.body))).toEqual({
      targetKind: 'receivable',
      targetId: 'rec-1',
      paidOn: '2026-09-20',
    });
  });

  it('POSTs the reverse with the reason and omits a blank one', async () => {
    await salesOpsApi.reverseSettlement({ settlementId: 's1', reason: 'Duplicado' }, 'token');
    await salesOpsApi.reverseSettlement({ settlementId: 's1' }, 'token');

    expect(call(0).url.endsWith('/api/v1/sales-ops/settlements/s1/reverse')).toBe(true);
    expect(call(0).init.method).toBe('POST');
    expect(JSON.parse(String(call(0).init.body))).toEqual({ reason: 'Duplicado' });
    expect(call(1).url.endsWith('/api/v1/sales-ops/settlements/s1/reverse')).toBe(true);
    expect(JSON.parse(String(call(1).init.body))).toEqual({});
  });

  it('GETs the sale history from the sale-scoped path', async () => {
    await salesOpsApi.saleSettlements('sale 1', 'token');

    const { url, init } = call(0);
    expect(url.endsWith('/api/v1/sales-ops/sales/sale%201/settlements')).toBe(true);
    expect(init.method).toBe('GET');
    expect(init.body).toBeUndefined();
  });
});
