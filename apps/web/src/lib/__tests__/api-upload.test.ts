import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { apiUpload } from '../api-client';
import { AuthTokenUnavailableError } from '../require-token';

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe('apiUpload', () => {
  it('rejects an empty token without calling fetch', async () => {
    await expect(apiUpload('/x', { token: '', form: new FormData() })).rejects.toBeInstanceOf(
      AuthTokenUnavailableError,
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('posts the FormData with a Bearer header and no Content-Type', async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => ({ ok: true }) });
    const form = new FormData();
    form.append('file', new Blob(['x']), 'a.xlsx');
    await expect(apiUpload('/x', { token: 'abc', form })).resolves.toEqual({ ok: true });
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(init.method).toBe('POST');
    expect(init.body).toBe(form);
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer abc');
    expect(Object.keys(headers).map((k) => k.toLowerCase())).not.toContain('content-type');
  });

  it('throws an ApiError carrying status and the parsed body', async () => {
    const body = { ok: false, counts: {}, issues: [], truncated: false };
    fetchMock.mockResolvedValue({ ok: false, status: 422, json: async () => body });
    await expect(apiUpload('/x', { token: 'abc', form: new FormData() })).rejects.toMatchObject({
      status: 422,
      error: 'request_failed',
      body,
    });
  });

  it('maps error and message strings from the body', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 409,
      json: async () => ({ error: 'conflict', reason: 'import_execution_failed', message: 'x' }),
    });
    await expect(apiUpload('/x', { token: 'abc', form: new FormData() })).rejects.toMatchObject({
      error: 'conflict',
      message: 'x',
      status: 409,
    });
  });
});
