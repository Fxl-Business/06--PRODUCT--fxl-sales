import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { apiFetch, apiFetchBlob } from '../api-client';
import {
  AuthTokenUnavailableError,
  isAuthFailure,
  isEntitlementFailure,
  requireToken,
} from '../require-token';

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

describe('402 missing_entitlement classification', () => {
  it('isEntitlementFailure recognises the 402 missing_entitlement ApiError', () => {
    expect(
      isEntitlementFailure({
        error: 'payment_required',
        code: 'missing_entitlement',
        status: 402,
      }),
    ).toBe(true);
  });

  it('isEntitlementFailure is false for a 401, a 500, an AuthTokenUnavailableError and a non-object', () => {
    expect(isEntitlementFailure({ error: 'unauthorized', status: 401 })).toBe(false);
    expect(isEntitlementFailure({ error: 'request_failed', status: 500 })).toBe(false);
    expect(isEntitlementFailure(new AuthTokenUnavailableError())).toBe(false);
    expect(isEntitlementFailure(null)).toBe(false);
    expect(isEntitlementFailure(undefined)).toBe(false);
    // A string pins that the check is `===` and never a coercion.
    expect(isEntitlementFailure('402')).toBe(false);
  });

  it('isEntitlementFailure is true for a 402 that carries no code at all', () => {
    expect(isEntitlementFailure({ error: 'payment_required', status: 402 })).toBe(true);
  });

  it('isAuthFailure is false for the 402 missing_entitlement ApiError', () => {
    // The 402 must never render "Sessao expirada" either.
    expect(
      isAuthFailure({ error: 'payment_required', code: 'missing_entitlement', status: 402 }),
    ).toBe(false);
  });

  it('apiFetch surfaces the body code on the thrown ApiError for a 402', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 402,
      json: async () => ({ error: 'payment_required', code: 'missing_entitlement' }),
    });
    await expect(apiFetch('/x', { method: 'GET', token: 'abc' })).rejects.toMatchObject({
      error: 'payment_required',
      code: 'missing_entitlement',
      status: 402,
    });
  });

  it('apiFetchBlob surfaces the body code on the thrown ApiError for a 402', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 402,
      json: async () => ({ error: 'payment_required', code: 'missing_entitlement' }),
    });
    await expect(apiFetchBlob('/x', { method: 'GET', token: 'abc' })).rejects.toMatchObject({
      error: 'payment_required',
      code: 'missing_entitlement',
      status: 402,
    });
  });
});
