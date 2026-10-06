import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { apiFetch } from '../api-client';

/**
 * SEAM A1: the API answers a lead create with no active normal etapa with
 * `400 {"error":"validation_error","reason":"no_open_stage","itemIndex":-1}`.
 * `apiFetch` must carry `reason` so the screen can pick its copy; it is set only
 * when the body sends one, so no other error gains an `undefined` key.
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

function answer(status: number, body: unknown) {
  fetchMock.mockResolvedValue({
    ok: false,
    status,
    headers: new Headers(),
    json: async () => body,
  });
}

async function rejection(): Promise<unknown> {
  try {
    await apiFetch('/api/v1/sales-ops/leads', { method: 'POST', token: 'abc', body: '{}' });
  } catch (error) {
    return error;
  }
  throw new Error('apiFetch resolved');
}

describe('apiFetch error reason', () => {
  it('carries the validation reason of a 400 body', async () => {
    answer(400, { error: 'validation_error', reason: 'no_open_stage', itemIndex: -1 });
    expect(await rejection()).toMatchObject({
      status: 400,
      error: 'validation_error',
      reason: 'no_open_stage',
    });
  });

  it('adds no reason key when the body has none', async () => {
    answer(400, { error: 'validation_error' });
    const err = (await rejection()) as object;
    expect(err).toMatchObject({ status: 400, error: 'validation_error' });
    expect('reason' in err).toBe(false);
  });

  it('ignores a non-string reason', async () => {
    answer(400, { error: 'validation_error', reason: 42 });
    const err = (await rejection()) as object;
    expect('reason' in err).toBe(false);
  });
});
