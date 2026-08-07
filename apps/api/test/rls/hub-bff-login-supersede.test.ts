/**
 * The login supersede, end to end through the REAL SDK router.
 *
 * `hub-bff-session-store.test.ts` proves what `create()` does when it is handed a
 * login context, and `app-auth-bff-wiring.test.ts` proves the middleware is
 * mounted on `/auth/callback`. Neither covers the seam BETWEEN them: that the
 * `AsyncLocalStorage` context the middleware establishes is still in scope when
 * the SDK awaits `store.create` from deep inside its own handler, several awaits
 * and one `fetch` later. Nothing in this product controls that call, so it has to
 * be observed rather than assumed.
 *
 * So this file does what a browser does - `GET /auth/login`, keep the cookies,
 * `GET /auth/callback` with them - against real Postgres, twice in one cookie jar
 * and once in a second jar, and reads the rows afterwards. It is the standing
 * substitute for a manual two-browser-profile click-through, which cannot be run
 * here: the only Hub a dev server can reach is wired to the STAGING database, so
 * a manual login would create and delete session rows there.
 *
 * The Hub itself is stubbed at `fetchImpl` and nowhere else. Everything between
 * the request and the row - cookie names, the login transaction, PKCE state, the
 * order of `consumeLoginTransaction` and `create`, the middleware, the store - is
 * the code that ships.
 *
 * Run: pnpm --filter @fxl-sales/api test:integration
 */
import { randomUUID } from 'node:crypto';
import { createHubBff } from '@fxl-business/hub-sdk/server';
import type { HubSdkConfig } from '@fxl-business/hub-sdk';
import { drizzle } from 'drizzle-orm/postgres-js';
import { Hono } from 'hono';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { hubBffErrorHandler } from '../../src/auth/hub-bff-errors.js';
import { createHubLoginSupersedeMiddleware } from '../../src/auth/hub-login-scope.js';
import {
  createDurableHubSessionStore,
  type DurableHubSessionStore,
} from '../../src/auth/hub-session-store.js';
import { createSessionSealer } from '../../src/auth/session-crypto.js';
import * as schema from '../../src/db/schema.js';

const APP_DB_URL =
  process.env.TEST_DATABASE_URL ??
  process.env.DATABASE_URL ??
  'postgresql://postgres:postgres@localhost:5006/fxl_sales';
const ADMIN_DB_URL = process.env.ADMIN_DATABASE_URL ?? APP_DB_URL;
const ADMIN_CONNECTION_OPTIONS = { connection: { 'app.fxl_admin': 'true' } } as const;

const IKM = 'hub-bff-login-supersede-test-ikm-0123456789';
/** Unique per run: the SDK caches discovery per apiUrl for the process lifetime. */
const HUB_API_URL = `http://hub.invalid.${randomUUID()}`;
const TOKEN_ENDPOINT = `${HUB_API_URL}/oauth/token`;

const HUB_CONFIG: HubSdkConfig = {
  apiUrl: HUB_API_URL,
  publishableKey: 'pk_fxl-sales_integration-test-publishable-key',
  secretKey: 'integration-test-hub-secret-key-0123456789',
  audience: 'product.fxl-sales',
};

/** The only stub in the file: the Hub's discovery document and token exchange. */
const stubHub: typeof fetch = (async (input: RequestInfo | URL) => {
  const url = typeof input === 'string' ? input : input.toString();
  if (url.endsWith('/.well-known/oauth-authorization-server')) {
    return Response.json({
      issuer: HUB_API_URL,
      authorization_endpoint: `${HUB_API_URL}/oauth/authorize`,
      token_endpoint: TOKEN_ENDPOINT,
      fxl_web_url: HUB_API_URL,
    });
  }
  if (url === TOKEN_ENDPOINT) {
    return Response.json({
      access_token: 'access-token-stub',
      // Distinct per exchange, so a row can be traced back to the login that made it.
      refresh_token: `refresh-${randomUUID()}`,
    });
  }
  throw new Error(`unexpected Hub call: ${url}`);
}) as typeof fetch;

/** One browser: a cookie jar plus the two navigations a login is made of. */
class Browser {
  readonly #jar = new Map<string, string>();

  constructor(private readonly router: Hono) {}

  get sessionId(): string | undefined {
    return this.#jar.get('fxl_hub_session');
  }

  #absorb(res: Response): void {
    const raw = res.headers.getSetCookie?.() ?? [];
    for (const cookie of raw) {
      const [pair] = cookie.split(';');
      const eq = pair?.indexOf('=') ?? -1;
      if (!pair || eq < 0) continue;
      const name = pair.slice(0, eq);
      const value = pair.slice(eq + 1);
      // Max-Age=0 is how the SDK deletes a cookie.
      if (value === '' || /max-age=0/i.test(cookie)) {
        this.#jar.delete(name);
      } else {
        this.#jar.set(name, value);
      }
    }
  }

  #cookieHeader(): Record<string, string> {
    if (this.#jar.size === 0) return {};
    return {
      cookie: [...this.#jar].map(([name, value]) => `${name}=${value}`).join('; '),
    };
  }

  /** Exactly what a browser does: /auth/login, follow nothing, then /auth/callback. */
  async login(): Promise<string> {
    const start = await this.router.request(`http://localhost/auth/login`, {
      headers: this.#cookieHeader(),
    });
    expect(start.status).toBe(302);
    this.#absorb(start);
    const state = new URL(start.headers.get('location')!).searchParams.get('state');
    expect(state).toBeTruthy();

    const done = await this.router.request(
      `http://localhost/auth/callback?code=auth-code-stub&state=${encodeURIComponent(state!)}`,
      { headers: this.#cookieHeader() },
    );
    // 302 to postLoginRedirect. An error redirect would mean the callback never
    // reached store.create at all, which would make every assertion vacuous.
    expect(done.status).toBe(302);
    expect(done.headers.get('location')).toBe('http://localhost:8006');
    this.#absorb(done);

    const sessionId = this.sessionId;
    expect(sessionId).toBeTruthy();
    return sessionId!;
  }
}

describe('login supersede, through the real SDK BFF', () => {
  let adminClient: postgres.Sql;
  let store: DurableHubSessionStore;
  let router: Hono;
  const sessionIds: string[] = [];

  function track(id: string): string {
    sessionIds.push(id);
    return id;
  }

  async function rowCount(id: string): Promise<number> {
    const rows = await adminClient`SELECT id FROM hub_bff_sessions WHERE id = ${id}`;
    return rows.length;
  }

  beforeAll(() => {
    adminClient = postgres(ADMIN_DB_URL, { max: 5, ...ADMIN_CONNECTION_OPTIONS });
    store = createDurableHubSessionStore({
      db: drizzle(adminClient, { schema }),
      sealer: createSessionSealer(IKM),
    });

    const bff = createHubBff(HUB_CONFIG, {
      sessionStore: store,
      secureCookies: false,
      fetchImpl: stubHub,
      redirectUri: 'http://localhost:8006/auth/callback',
      postLoginRedirect: 'http://localhost:8006',
      postLoginErrorRedirect: 'http://localhost:8006/?error=auth',
    });

    // The same three lines createAppAuthBff assembles, in the same order.
    router = new Hono();
    router.use(
      '/auth/callback',
      createHubLoginSupersedeMiddleware(store, { secureCookies: false }),
    );
    router.onError(hubBffErrorHandler);
    router.route('', bff);
  });

  afterAll(async () => {
    for (const id of sessionIds) {
      await adminClient`DELETE FROM hub_bff_sessions WHERE id = ${id}`;
    }
    await adminClient.end();
  });

  it('leaves one live session after a re-login in the same browser, and none of the previous ones', async () => {
    const browser = new Browser(router);

    const first = track(await browser.login());
    expect(await rowCount(first)).toBe(1);

    const second = track(await browser.login());

    expect(second).not.toBe(first);
    // Before this slice there were two rows here, and the first still held a
    // live rotatable refresh token for up to 30 days.
    expect(await rowCount(first)).toBe(0);
    expect(await rowCount(second)).toBe(1);
    expect(await store.withSession(first, async (tx) => tx.get())).toBeNull();
  });

  it('does not touch a session held by a second browser', async () => {
    // THE MULTI-DEVICE OBSERVATION, and the whole justification for keying on the
    // presented session id. A second browser's cookie is never sent on the first
    // browser's callback, so its row cannot be reached from there.
    const laptop = new Browser(router);
    const desktop = new Browser(router);

    const laptopFirst = track(await laptop.login());
    const desktopSession = track(await desktop.login());
    expect(desktopSession).not.toBe(laptopFirst);

    const laptopSecond = track(await laptop.login());

    expect(await rowCount(laptopFirst)).toBe(0);
    expect(await rowCount(laptopSecond)).toBe(1);
    // Still resolvable, which is what "the desktop stays signed in" means.
    expect(await store.withSession(desktopSession, async (tx) => tx.get())).not.toBeNull();
  });

  it('creates a session for a browser that presents no prior one', async () => {
    // Non-vacuity for both tests above: a first login is not a supersede, and the
    // absence of a session cookie is never an error.
    const fresh = new Browser(router);
    expect(fresh.sessionId).toBeUndefined();

    const created = track(await fresh.login());

    expect(await rowCount(created)).toBe(1);
  });
});
