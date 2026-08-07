import { describe, expect, it, vi } from 'vitest';
import { requestHubAccessToken } from '../refresh';

const BFF_BASE = 'http://localhost:3006';

function fetchReturning(response: Response) {
  return vi.fn<typeof fetch>().mockResolvedValue(response);
}

describe('requestHubAccessToken', () => {
  it.each([
    ['the revoked-family verdict', { error: 'session_expired' }],
    ['the missing-or-expired-record verdict', { error: 'no_session' }],
    ['an empty body', {}],
  ])(
    'classifies every 401 as session_expired, whichever body the BFF sends (%s)',
    async (_label, body) => {
      const fetchImpl = fetchReturning(
        new Response(JSON.stringify(body), {
          status: 401,
          headers: { 'content-type': 'application/json' },
        }),
      );

      await expect(requestHubAccessToken(BFF_BASE, fetchImpl)).resolves.toEqual({
        token: null,
        failure: 'session_expired',
      });
    },
  );

  it.each([503, 502, 500, 429, 418])(
    'classifies a transient status as transient so the session survives a Hub outage (%i)',
    async (status) => {
      const fetchImpl = fetchReturning(new Response(null, { status }));

      await expect(requestHubAccessToken(BFF_BASE, fetchImpl)).resolves.toEqual({
        token: null,
        failure: 'transient',
      });
    },
  );

  it('classifies a network throw as transient', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockRejectedValue(new TypeError('Failed to fetch'));

    await expect(requestHubAccessToken(BFF_BASE, fetchImpl)).resolves.toEqual({
      token: null,
      failure: 'transient',
    });
  });

  it.each([
    ['no accessToken at all', '{}'],
    ['a non-string accessToken', '{"accessToken":42}'],
    ['an empty accessToken', '{"accessToken":""}'],
    ['a body that is not JSON', 'not json at all'],
  ])('classifies a 200 whose body is not a refresh response as transient (%s)', async (
    _label,
    body,
  ) => {
    const fetchImpl = fetchReturning(new Response(body, { status: 200 }));

    await expect(requestHubAccessToken(BFF_BASE, fetchImpl)).resolves.toEqual({
      token: null,
      failure: 'transient',
    });
  });

  it('returns the access token on a 200 refresh response', async () => {
    const fetchImpl = fetchReturning(
      new Response(JSON.stringify({ accessToken: 'header.payload.signature', expiresIn: 120 }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );

    await expect(requestHubAccessToken(BFF_BASE, fetchImpl)).resolves.toEqual({
      token: 'header.payload.signature',
    });
  });

  it('posts to the BFF refresh endpoint with credentials included', async () => {
    const fetchImpl = fetchReturning(new Response(null, { status: 401 }));

    await requestHubAccessToken(BFF_BASE, fetchImpl);
    expect(fetchImpl).toHaveBeenCalledWith('http://localhost:3006/auth/refresh', {
      method: 'POST',
      credentials: 'include',
    });

    // A same-origin deployment leaves the base path empty; the result must stay a
    // rooted path rather than becoming a relative one.
    const sameOrigin = fetchReturning(new Response(null, { status: 401 }));
    await requestHubAccessToken('', sameOrigin);
    expect(sameOrigin).toHaveBeenCalledWith('/auth/refresh', {
      method: 'POST',
      credentials: 'include',
    });
  });
});
