/**
 * The trusted-origin shim in front of the Hub BFF.
 *
 * `@fxl-business/hub-sdk@1.3.x` added an undocumented CSRF guard to every POST
 * the BFF serves (`dist/server.js`, the `app.use("*")` at the top of
 * `createHubBff`):
 *
 *   if (site === "cross-site" || (origin && origin !== new URL(c.req.url).origin))
 *     return c.json({ error: "forbidden" }, 403);
 *
 * `1.2.0` had NO such guard, and `MIGRATION.md` does not mention it, so it is a
 * silent breaking change for any consumer whose browser origin differs from the
 * origin its BFF is served on.
 *
 * That is exactly this product in production: the web app is
 * `https://sales.fxlbusiness.com` and the API is `https://sales-api.fxlbusiness.com`.
 * Every `/auth/refresh` therefore answered `403 {"error":"forbidden"}`, the web
 * retry ladder read a non-401 as transient and retried, the ladder exhausted,
 * the login loop guard tripped, and the operator got a blank screen followed by
 * `Nao foi possivel restabelecer sua sessao` - while being perfectly entitled to
 * the product.
 *
 * Local development never saw it, and could not have: `apps/web/vite.config.ts`
 * proxies `/auth/*` to the API, so the browser request is genuinely SAME-ORIGIN
 * there, which is the architecture `CLAUDE.md` describes. The gap was that
 * nothing exercised a cross-origin `Origin` header against the real SDK.
 *
 * WHY A SHIM AND NOT A DEPLOYMENT CHANGE. Serving the API under the web origin
 * would also fix it and is arguably the nicer end state, but it is an infra
 * change across two hosts, and this is a production outage. This shim is fully
 * inside the application, is reversible, and keeps the protection the SDK guard
 * exists to provide: an EXPLICIT allowlist replaces the SDK's origin-equality
 * test. A browser sets `Origin` itself and script cannot forge it, so an
 * allowlist check on that header is a sound CSRF control - it is what the `cors`
 * middleware beside it already relies on.
 *
 * The request is REBUILT rather than mutated because incoming `Request` headers
 * are immutable in undici, and Hono's `c.req` is a getter over a private field
 * with no setter. So the shim calls the sub-app's own `fetch` with a fresh
 * Request instead of mounting it with `route()`.
 */
import type { Context, Hono } from 'hono';

/** Trailing slashes make `new URL(x).origin` and a raw env string disagree. */
export function normalizeOrigin(value: string): string | null {
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

export type HubBffOriginShimOptions = {
  /**
   * Browser origins this API vouches for. Anything not listed is handed to the
   * SDK untouched, so its own guard still rejects a genuine cross-site POST.
   */
  trustedOrigins: readonly string[];
};

/**
 * Returns a Hono handler that forwards `/auth/*` into the SDK's BFF, rewriting
 * `Origin` to the API's own origin when - and only when - the caller's origin is
 * on the allowlist.
 */
export function createHubBffOriginShim(
  bff: Hono,
  options: HubBffOriginShimOptions,
): (c: Context) => Promise<Response> {
  const trusted = new Set(
    options.trustedOrigins
      .map(normalizeOrigin)
      .filter((origin): origin is string => origin !== null),
  );

  return async (c) => {
    const raw = c.req.raw;
    const origin = raw.headers.get('origin');
    const selfOrigin = new URL(raw.url).origin;

    // No Origin at all (a server-to-server call, or a top-level GET navigation
    // like /auth/login and /auth/callback) already satisfies the SDK guard,
    // whose `origin &&` short-circuits. Same-origin needs no help either. An
    // untrusted origin is deliberately passed through UNCHANGED so the SDK
    // answers its own 403 - this shim only ever widens to the allowlist.
    if (origin === null || origin === selfOrigin || !trusted.has(origin)) {
      return bff.fetch(raw);
    }

    const headers = new Headers(raw.headers);
    headers.set('origin', selfOrigin);
    // Consistency with the rewritten Origin. For the real deployment the browser
    // already sends `same-site` (one registrable domain), so this is defensive
    // rather than load-bearing.
    if (headers.get('sec-fetch-site') === 'cross-site') {
      headers.set('sec-fetch-site', 'same-origin');
    }

    // Buffered rather than streamed: a streaming body would need `duplex: 'half'`
    // and these are auth payloads of a few dozen bytes at most.
    const body =
      raw.method === 'GET' || raw.method === 'HEAD' ? undefined : await raw.arrayBuffer();

    return bff.fetch(
      new Request(raw.url, {
        method: raw.method,
        headers,
        body,
        // The BFF 302s on /auth/login and /auth/callback. Without this the
        // fetch would try to follow them server-side and the browser would
        // never see the redirect.
        redirect: 'manual',
      }),
    );
  };
}
