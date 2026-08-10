/**
 * The oracle for the production outage of 2026-08-10.
 *
 * `@fxl-business/hub-sdk@1.3.x` added a CSRF guard that 403s any POST whose
 * `Origin` differs from the origin the BFF is served on. Production serves the
 * web app and the API on different hosts, so every `/auth/refresh` answered 403.
 *
 * Every test here drives the REAL `createHubBff`. A fake would have proved
 * nothing: the guard lives inside the SDK, and the reason this shipped is that
 * no test ever sent a cross-origin `Origin` header at it. The one assertion that
 * matters is `cross-origin refresh from the trusted web origin is not 403`, and
 * it fails against `master` at the time this was written.
 */
import { InMemoryHubSessionStore } from '@fxl-business/hub-sdk';
import { createHubBff } from '@fxl-business/hub-sdk/server';
import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import { createHubBffOriginShim, normalizeOrigin } from '../hub-bff-origin.js';

const API_ORIGIN = 'https://sales-api.example.test';
const WEB_ORIGIN = 'https://sales.example.test';
const EVIL_ORIGIN = 'https://evil.example.test';

/**
 * A BFF that can answer without any network. `apiUrl` is never reached, because
 * every request below is rejected or answered before the Hub round trip: the
 * guard runs first, and a cookieless refresh short-circuits on "no session".
 */
function buildBff() {
  return createHubBff(
    {
      apiUrl: 'https://hub.example.test',
      publishableKey: 'pk_test_origin_shim',
      secretKey: 'sk_test_origin_shim',
    } as Parameters<typeof createHubBff>[0],
    { sessionStore: new InMemoryHubSessionStore(), fetchImpl: (async () =>
        new Response('{}', { status: 500 })) as unknown as typeof fetch },
  );
}

function mount(trustedOrigins: readonly string[]) {
  const app = new Hono();
  app.all('/auth/*', createHubBffOriginShim(buildBff(), { trustedOrigins }));
  return app;
}

function refresh(origin: string | null, secFetchSite?: string) {
  const headers = new Headers();
  if (origin !== null) headers.set('origin', origin);
  if (secFetchSite) headers.set('sec-fetch-site', secFetchSite);
  return new Request(`${API_ORIGIN}/auth/refresh`, { method: 'POST', headers });
}

describe('hub BFF trusted-origin shim', () => {
  it('does not 403 a refresh from the trusted web origin on a different host', async () => {
    // THE regression oracle. Without the shim the SDK's guard answers 403 here,
    // which is precisely what took production down.
    const res = await mount([WEB_ORIGIN]).fetch(refresh(WEB_ORIGIN, 'same-site'));

    expect(res.status).not.toBe(403);
    // A cookieless refresh is a dead session, which is the honest answer and is
    // what the web ladder is built to read as permanent.
    expect(res.status).toBe(401);
  });

  it('proves the guard is real by 403ing that same request without the shim', async () => {
    // Non-vacuity. If this ever stops being 403 the SDK dropped the guard and
    // the shim above became dead code rather than a fix.
    const bare = new Hono();
    bare.route('', buildBff());

    const res = await bare.fetch(refresh(WEB_ORIGIN, 'same-site'));

    expect(res.status).toBe(403);
    await expect(res.json()).resolves.toEqual({ error: 'forbidden' });
  });

  it('still 403s an origin that is not on the allowlist', async () => {
    const res = await mount([WEB_ORIGIN]).fetch(refresh(EVIL_ORIGIN, 'cross-site'));

    expect(res.status).toBe(403);
    await expect(res.json()).resolves.toEqual({ error: 'forbidden' });
  });

  it('leaves a same-origin request alone', async () => {
    const res = await mount([WEB_ORIGIN]).fetch(refresh(API_ORIGIN, 'same-origin'));

    expect(res.status).not.toBe(403);
  });

  it('leaves a request with no Origin header alone', async () => {
    // Top-level GET navigations and server-to-server calls send no Origin, and
    // the SDK guard short-circuits on that. The shim must not invent one.
    const res = await mount([WEB_ORIGIN]).fetch(refresh(null));

    expect(res.status).not.toBe(403);
  });

  it('accepts a trusted origin written with a trailing slash in config', async () => {
    // CORS_ORIGIN is operator-supplied and `new URL(x).origin` never carries a
    // trailing slash, so an unnormalized compare would silently fail closed and
    // reproduce the outage with a correct-looking config.
    const res = await mount([`${WEB_ORIGIN}/`]).fetch(refresh(WEB_ORIGIN, 'same-site'));

    expect(res.status).not.toBe(403);
  });

  it('ignores an unparseable trusted origin rather than throwing at boot', async () => {
    const res = await mount(['not a url', WEB_ORIGIN]).fetch(refresh(WEB_ORIGIN, 'same-site'));

    expect(res.status).not.toBe(403);
  });

  describe('normalizeOrigin', () => {
    it('strips path and trailing slash', () => {
      expect(normalizeOrigin('https://sales.example.test/')).toBe(WEB_ORIGIN);
      expect(normalizeOrigin('https://sales.example.test/app')).toBe(WEB_ORIGIN);
    });

    it('returns null for a value that is not a URL', () => {
      expect(normalizeOrigin('sales.example.test')).toBeNull();
      expect(normalizeOrigin('')).toBeNull();
    });
  });
});
