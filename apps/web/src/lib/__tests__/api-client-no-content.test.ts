import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { apiFetch } from '../api-client';

/**
 * A `204 No Content` carries no body, so `res.json()` rejects. `apiFetch` used to
 * call it unconditionally, which turned every successful 204 write (the lead
 * lixeira `POST /leads/:id/delete`, the finder link revoke) into a failure the
 * caller would roll back.
 */

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe('apiFetch on 204 No Content', () => {
  it('resolves undefined without reading a body', async () => {
    const json = vi.fn(async () => {
      throw new SyntaxError('Unexpected end of JSON input');
    });
    fetchMock.mockResolvedValue({ ok: true, status: 204, headers: new Headers(), json });

    await expect(
      apiFetch<void>('/api/v1/sales-ops/leads/L1/delete', { method: 'POST', token: 'abc' }),
    ).resolves.toBeUndefined();
    expect(json).not.toHaveBeenCalled();
  });

  it('still parses the body of a 200', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers(),
      json: async () => ({ lead: { id: 'L1' } }),
    });

    await expect(
      apiFetch<{ lead: { id: string } }>('/api/v1/sales-ops/leads/L1', { method: 'GET', token: 'abc' }),
    ).resolves.toEqual({ lead: { id: 'L1' } });
  });
});
