/**
 * The oracle for the production defect measured on 2026-08-12: every FXL Sales
 * session died one to three minutes after login.
 *
 * The Hub runs with `NODE_ENV=production`, so it rotates the session cookie as
 * `__Host-fxl_hub_session=`. `@fxl-business/hub-sdk@1.3.1` recovers the rotated
 * refresh token with `/(?:^|[,\s])fxl_hub_session=([^;]+)/` and nothing else, so
 * the `-` before the name makes the match fail, `tx.update` is never called and
 * Postgres keeps the refresh token that was just spent - while the BFF answers
 * 200. The second replay trips the Hub's `reuse_detected` and the whole token
 * family is revoked. See `hub-rotated-cookie.ts` and
 * `nexo/runs/feature-20260812-session-survives-one-refresh/evidence.md`.
 *
 * This file drives the wrapper in isolation with a fake inner fetch. The
 * end-to-end proof, through the REAL SDK refresh and switch handlers, is in
 * `apps/api/src/middleware/__tests__/app-auth-bff-wiring.test.ts`.
 */
import { describe, expect, it, vi } from 'vitest';
import { assertSetCookieSupport, createHubRotatedCookieFetch } from '../hub-rotated-cookie.js';

/** The SDK's own parser, copied verbatim from 1.3.1 dist/server.js:301. */
const SDK_ROTATION_REGEX = /(?:^|[,\s])fxl_hub_session=([^;]+)/;
/** The upstream fix filed in nexo/ROADMAP.md, for the forward-compatibility pin. */
const FIXED_SDK_ROTATION_REGEX = /(?:^|[,\s])(?:__Host-)?fxl_hub_session=([^;]+)/;

const PROD_ROTATION =
  '__Host-fxl_hub_session=RT2; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=2592000';
const DEV_ROTATION = 'fxl_hub_session=RT2; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000';
const UNRELATED = 'hub_edge=iad1; Path=/; Expires=Wed, 21 Oct 2026 07:28:00 GMT';

function hubResponse(setCookies: readonly string[], status = 200): Response {
  const headers = new Headers({ 'content-type': 'application/json' });
  for (const cookie of setCookies) headers.append('set-cookie', cookie);
  return new Response(JSON.stringify({ accessToken: 'AT2', expiresIn: 120 }), {
    status,
    statusText: 'OK',
    headers,
  });
}

function rotatedTokenTheSdkWouldSee(res: Response): string | undefined {
  return SDK_ROTATION_REGEX.exec(res.headers.get('set-cookie') ?? '')?.[1];
}

describe('hub rotated session cookie fetch wrapper', () => {
  it('renames __Host-fxl_hub_session so the SDK rotation regex can see the token', async () => {
    // THE unit oracle. Without the rename this is `undefined`, which is exactly
    // the `if (rotated)` the SDK skips on every production refresh.
    const wrapped = createHubRotatedCookieFetch(async () => hubResponse([PROD_ROTATION]));

    const out = await wrapped('https://hub.example.test/auth/refresh');

    expect(rotatedTokenTheSdkWouldSee(out)).toBe('RT2');
  });

  it('keeps every other Set-Cookie byte-identical and in order', async () => {
    const wrapped = createHubRotatedCookieFetch(async () =>
      hubResponse([UNRELATED, PROD_ROTATION]),
    );

    const out = await wrapped('https://hub.example.test/auth/refresh');

    expect(out.headers.getSetCookie()).toEqual([
      UNRELATED,
      PROD_ROTATION.replace('__Host-', ''),
    ]);
  });

  it('finds the rotated token even when an earlier cookie carries a comma', async () => {
    // `Expires=Wed, 21 Oct 2026 ...` is what makes the JOINED header ambiguous,
    // and it is why this wrapper works per cookie rather than on the join.
    const wrapped = createHubRotatedCookieFetch(async () =>
      hubResponse([UNRELATED, PROD_ROTATION]),
    );

    const out = await wrapped('https://hub.example.test/auth/refresh');

    expect(rotatedTokenTheSdkWouldSee(out)).toBe('RT2');
  });

  it('returns the original Response object untouched when nothing matched', async () => {
    const res = hubResponse(['hub_edge=iad1; Path=/']);
    const wrapped = createHubRotatedCookieFetch(async () => res);

    const out = await wrapped('https://hub.example.test/auth/refresh');

    // Identity, not equality: a refactor that always rebuilds is caught here.
    expect(out).toBe(res);
  });

  it('returns the original Response object untouched when there is no Set-Cookie at all', async () => {
    const res = hubResponse([]);
    const wrapped = createHubRotatedCookieFetch(async () => res);

    const out = await wrapped('https://hub.example.test/auth/refresh');

    expect(out).toBe(res);
  });

  it('leaves an already unprefixed fxl_hub_session alone', async () => {
    // The local-development path, which always worked and must keep working.
    const res = hubResponse([DEV_ROTATION]);
    const wrapped = createHubRotatedCookieFetch(async () => res);

    const out = await wrapped('https://hub.example.test/auth/refresh');

    expect(out).toBe(res);
    expect(rotatedTokenTheSdkWouldSee(out)).toBe('RT2');
  });

  it('does not rewrite a cookie whose name merely resembles the session cookie', async () => {
    const res = hubResponse([
      '__Secure-fxl_hub_session=X; Path=/',
      '__Host-fxl_hub_session_v2=Y; Path=/',
      'x__Host-fxl_hub_session=Z; Path=/',
      '__Host-fxl_hub_login=W; Path=/',
    ]);
    const wrapped = createHubRotatedCookieFetch(async () => res);

    const out = await wrapped('https://hub.example.test/auth/refresh');

    expect(out).toBe(res);
  });

  it('preserves status, statusText, other headers and the body on the rewrite path', async () => {
    const res = hubResponse([PROD_ROTATION], 200);
    const wrapped = createHubRotatedCookieFetch(async () => res);

    const out = await wrapped('https://hub.example.test/auth/refresh');

    expect(out).not.toBe(res);
    expect(out.status).toBe(200);
    expect(out.statusText).toBe('OK');
    expect(out.headers.get('content-type')).toBe('application/json');
    expect(await out.json()).toEqual({ accessToken: 'AT2', expiresIn: 120 });
  });

  it('passes input and init through to the inner fetch unchanged', async () => {
    const seen: { input?: unknown; init?: unknown } = {};
    const wrapped = createHubRotatedCookieFetch(async (input, init) => {
      seen.input = input;
      seen.init = init;
      return hubResponse([PROD_ROTATION]);
    });
    // The shape the SDK actually sends: a Cookie header plus the AbortSignal that
    // enforces `timeoutMs`.
    const init: RequestInit = {
      method: 'POST',
      headers: { Cookie: 'fxl_hub_session=RT1' },
      signal: new AbortController().signal,
    };

    await wrapped('https://hub.example.test/auth/refresh?productId=product.fxl-sales', init);

    expect(seen.input).toBe('https://hub.example.test/auth/refresh?productId=product.fxl-sales');
    expect(seen.init).toBe(init);
  });

  it('resolves the ambient global fetch at call time when no inner fetch is given', async () => {
    // The no-stale-binding oracle. The wrapper is built BEFORE the stub exists,
    // which is exactly the order the end-to-end oracle depends on: it stubs
    // globalThis.fetch long after createAppAuthBff() has run.
    const wrapped = createHubRotatedCookieFetch();
    try {
      vi.stubGlobal('fetch', (async () => hubResponse([PROD_ROTATION])) as typeof fetch);

      const out = await wrapped('https://hub.example.test/auth/refresh');

      expect(rotatedTokenTheSdkWouldSee(out)).toBe('RT2');
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('stays correct if the SDK parser is fixed to accept both names', async () => {
    // When upstream lands the `(?:__Host-)?` fix this wrapper becomes inert
    // rather than wrong, so it can be deleted on its own schedule.
    const wrapped = createHubRotatedCookieFetch(async () => hubResponse([PROD_ROTATION]));

    const out = await wrapped('https://hub.example.test/auth/refresh');
    const header = out.headers.get('set-cookie') ?? '';

    expect(SDK_ROTATION_REGEX.exec(header)?.[1]).toBe('RT2');
    expect(FIXED_SDK_ROTATION_REGEX.exec(header)?.[1]).toBe('RT2');
  });

  it('throws rather than silently skipping when a response carries a Headers without getSetCookie', async () => {
    // A silent `[]` here would hand the response back untouched and reinstate the
    // exact production defect, with a green suite. Loud beats quiet.
    const wrapped = createHubRotatedCookieFetch(
      async () => ({ status: 200, headers: { get: () => null } }) as unknown as Response,
    );

    await expect(wrapped('https://hub.example.test/auth/refresh')).rejects.toThrow(
      /getSetCookie/,
    );
  });

  it('refuses to load on a runtime whose Headers has no getSetCookie', () => {
    expect(() => assertSetCookieSupport({})).toThrow(/Node 20/);
  });

  it('accepts the real Headers of the runtime this ships to', () => {
    // Pins the "unreachable in production" assumption, so a runtime downgrade
    // fails a test rather than a deploy.
    expect(() => assertSetCookieSupport()).not.toThrow();
  });
});
