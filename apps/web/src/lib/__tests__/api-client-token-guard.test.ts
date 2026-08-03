import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { apiFetch, apiFetchBlob } from '../api-client';
import { AuthTokenUnavailableError, isAuthFailure, requireToken } from '../require-token';

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe('apiFetch bearer-token chokepoint', () => {
  it('rejects an empty token without calling fetch', async () => {
    await expect(apiFetch('/x', { method: 'GET', token: '' })).rejects.toBeInstanceOf(
      AuthTokenUnavailableError,
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects a whitespace-only token without calling fetch', async () => {
    await expect(apiFetch('/x', { method: 'GET', token: '   ' })).rejects.toBeInstanceOf(
      AuthTokenUnavailableError,
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects an empty token in apiFetchBlob without calling fetch', async () => {
    await expect(apiFetchBlob('/x', { method: 'GET', token: '' })).rejects.toBeInstanceOf(
      AuthTokenUnavailableError,
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('sends Bearer for a real token', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ ok: 1 }) });
    await apiFetch('/x', { method: 'GET', token: 'abc' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer abc');
  });
});

describe('require-token helpers', () => {
  it('requireToken throws when the reader resolves null', async () => {
    await expect(requireToken(async () => null)).rejects.toBeInstanceOf(
      AuthTokenUnavailableError,
    );
  });

  it('isAuthFailure recognises a 401 ApiError', () => {
    expect(isAuthFailure({ error: 'unauthorized', status: 401 })).toBe(true);
    expect(isAuthFailure({ error: 'request_failed', status: 500 })).toBe(false);
  });
});
