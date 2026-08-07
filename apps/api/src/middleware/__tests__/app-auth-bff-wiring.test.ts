/**
 * Pins the WIRING of `createAppAuthBff()`, which nothing else does.
 *
 * The production bug this originally fixed is one missing option:
 * `createHubBff(config, { ... })` without `sessionStore`. Under
 * `@fxl-business/hub-sdk@1.3.0` that now THROWS at construction when
 * `NODE_ENV === 'production'` (dist/server.js:312-314), and a pre-1.3.0-shaped
 * store throws at construction unconditionally (`assertModernSessionStore`,
 * dist/server.js:304-310). Outside production the SDK still silently falls back
 * to `new InMemoryHubSessionStore()`, so the identity assertion below stays the
 * thing that proves our durable store reaches the SDK: the oracle in
 * `test/rls/hub-bff-session-store.test.ts` builds the store DIRECTLY and would
 * stay green with `sessionStore: session.store` deleted.
 *
 * It also pins Blocker A: the module graph is loaded with
 * `HUB_SESSION_ENCRYPTION_KEY=''`, which is the value `.env.dev.example` ships
 * and therefore the value the documented local setup produces. Reading
 * `process.env.HUB_SESSION_ENCRYPTION_KEY ?? secretKey` keeps that empty string,
 * `createSessionSealer('')` throws its 32-character floor, and `server.ts` calls
 * `createAppAuthBff()` at module top level - so the API would not boot at all.
 */
import type { HubSdkConfig, HubSessionStore } from '@fxl-business/hub-sdk';
import { InMemoryHubSessionStore } from '@fxl-business/hub-sdk';
import { Hono } from 'hono';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
/**
 * Plain numbers, so unlike `HubSessionStoreUnavailableError` below these are safe
 * to take from this file's own module registry: `vi.resetModules()` gives them a
 * different module object but the same values, and there is no `instanceof` here.
 */
import {
  SESSION_ABSOLUTE_TTL_MS,
  SESSION_TTL_MS,
} from '../../auth/hub-session-store.js';

/** Long enough to clear the sealer's 32-character floor on its own. */
const HUB_SECRET_KEY = 'unit-test-hub-secret-key-0123456789abcdef';

type CapturedBffOptions =
  | {
      sessionStore?: unknown;
      timeoutMs?: number;
      sessionTtlSeconds?: number;
      sessionAbsoluteTtlSeconds?: number;
    }
  | undefined;

/** What the SDK expects back from `withSession` on /auth/refresh. */
const REFRESH_OK = { status: 200, body: { ok: true }, clear: false };

let bffOptions: CapturedBffOptions;
let sessionStoreKind: string | undefined;
let durableStore: HubSessionStore | undefined;
let encryptionIkm: string | undefined;
let authBff: Hono | null = null;
let closeDb: (() => Promise<void>) | undefined;
/**
 * Taken from the module graph `app-auth.ts` itself loaded, NOT from a top-level
 * import. `vi.resetModules()` gives this file's static imports a different
 * registry, so a top-level `HubSessionStoreUnavailableError` is a DIFFERENT
 * class object and `hubBffErrorHandler`'s `instanceof` misses it - the outage
 * test then sees a 500 and reads as a broken mount rather than as a broken test.
 */
let StoreUnavailable: typeof import('../../auth/hub-session-store.js').HubSessionStoreUnavailableError;

beforeAll(async () => {
  vi.resetModules();

  // dotenv inside env.ts does not override keys already present on process.env,
  // so these stubs win over apps/api/.env - including its STAGING DATABASE_URL.
  vi.stubEnv('NODE_ENV', 'test');
  vi.stubEnv('CORS_ORIGIN', 'http://localhost:8006');
  vi.stubEnv('DATABASE_URL', 'postgresql://postgres:postgres@localhost:5006/fxl_sales_wiring_test');
  vi.stubEnv('ADMIN_DATABASE_URL', '');
  vi.stubEnv('FXL_HUB_API_URL', 'http://localhost:9016');
  vi.stubEnv('FXL_HUB_PUBLISHABLE_KEY', 'pk_fxl-sales_unit-test-publishable-key');
  vi.stubEnv('FXL_HUB_SECRET_KEY', HUB_SECRET_KEY);
  vi.stubEnv('FXL_HUB_AUDIENCE', 'product.fxl-sales');
  vi.stubEnv('FXL_HUB_REDIRECT_URI', 'http://localhost:8006/auth/callback');
  vi.stubEnv('FXL_HUB_POST_LOGIN_REDIRECT', 'http://localhost:8006');
  vi.stubEnv('FXL_HUB_POST_LOGIN_ERROR_REDIRECT', 'http://localhost:8006/?error=auth');
  // BLOCKER A: exactly what .env.dev.example ships.
  vi.stubEnv('HUB_SESSION_ENCRYPTION_KEY', '');

  vi.doMock('@fxl-business/hub-sdk/server', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@fxl-business/hub-sdk/server')>();
    return {
      ...actual,
      createHubBff: (config: Parameters<typeof actual.createHubBff>[0], options: never) => {
        bffOptions = options as CapturedBffOptions;
        return actual.createHubBff(config, options);
      },
    };
  });

  vi.doMock('../../auth/hub-session-store.js', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../../auth/hub-session-store.js')>();
    return {
      ...actual,
      createHubSessionStore: (deps: Parameters<typeof actual.createHubSessionStore>[0]) => {
        encryptionIkm = deps.encryptionIkm;
        const result = actual.createHubSessionStore(deps);
        sessionStoreKind = result.kind;
        if (result.kind === 'durable') {
          durableStore = result.store;
        }
        return result;
      },
    };
  });

  const dbClient = await import('../../db/client.js');
  closeDb = dbClient.closeDb;

  const storeModule = await import('../../auth/hub-session-store.js');
  StoreUnavailable = storeModule.HubSessionStoreUnavailableError;

  const appAuth = await import('../app-auth.js');
  // If Blocker A were unfixed this line would THROW, exactly as server.ts does.
  // So would a store that still had the pre-1.3.0 synchronous shape.
  authBff = appAuth.createAppAuthBff() as Hono | null;
});

afterAll(async () => {
  await closeDb?.();
  vi.doUnmock('@fxl-business/hub-sdk/server');
  vi.doUnmock('../../auth/hub-session-store.js');
  vi.unstubAllEnvs();
  vi.resetModules();
});

function requireDurableStore(): HubSessionStore {
  if (!durableStore) {
    throw new Error('expected a durable store');
  }
  return durableStore;
}

describe('createAppAuthBff wiring', () => {
  it('boots with the blank HUB_SESSION_ENCRYPTION_KEY that .env.dev.example ships', () => {
    // The blank override must read as "unset" and fall back to the documented
    // HKDF-from-FXL_HUB_SECRET_KEY default, not reach the sealer as ''.
    expect(encryptionIkm).toBe(HUB_SECRET_KEY);
    expect(authBff).not.toBeNull();
  });

  it('builds a durable session store rather than the SDK in-memory default', () => {
    expect(sessionStoreKind).toBe('durable');
    expect(durableStore).toBeDefined();
  });

  it('hands the durable session store to createHubBff', () => {
    // Delete `sessionStore: session.store` from createAppAuthBff and this test
    // is the one that goes red: the option is simply absent.
    expect(bffOptions?.sessionStore).toBeDefined();
    expect(bffOptions?.sessionStore).not.toBeInstanceOf(InMemoryHubSessionStore);
    // Identity, not merely "some durable-looking object": the SDK must receive
    // the very instance that owns the Postgres transaction.
    expect(bffOptions?.sessionStore).toBe(durableStore);
  });

  it('bounds the upstream Hub call with timeoutMs', () => {
    // The BFF calls the Hub over HTTP from INSIDE the transaction holding the
    // session row lock. Unbounded, a hung Hub pins a getAdminDb() connection
    // (pool max 5, shared with audit and history) with an open transaction.
    expect(bffOptions?.timeoutMs).toBe(5_000);
  });

  it('wires the SDK session TTLs to the store constants so the two views cannot disagree', () => {
    // The store owns both expiry columns and ignores the values the SDK computes
    // from these options, so passing them is DECLARATIVE: it keeps the SDK's
    // 90-day sliding / 365-day absolute defaults (dist/server.js:324-325) out of
    // play, and makes a future divergence a test failure rather than a surprise.
    expect(bffOptions?.sessionTtlSeconds).toBe(SESSION_TTL_MS / 1000);
    expect(bffOptions?.sessionAbsoluteTtlSeconds).toBe(SESSION_ABSOLUTE_TTL_MS / 1000);
    // The resolved numbers, spelled out: deleting either option and letting the
    // SDK default to 7_776_000 / 31_536_000 fails here even if someone
    // "simplified" the two assertions above into a tautology.
    expect(bffOptions?.sessionTtlSeconds).toBe(2_592_000);
    expect(bffOptions?.sessionAbsoluteTtlSeconds).toBe(7_776_000);
  });
});

/**
 * The cookie-name pin. `@fxl-business/hub-sdk@1.3.0` declares
 * `SESSION_COOKIE = "fxl_hub_session"`, `SESSION_COOKIE_SECURE =
 * "__Host-fxl_hub_session"` and `LOGIN_TX_COOKIE = "fxl_hub_login"` at
 * dist/server.js:275-277, unchanged from 1.2.0's 271-273.
 *
 * These behavioural assertions - not a string constant - are what a future SDK
 * bump re-checks. Comparing our own constant against our own literal only ever
 * proved it matched itself; asserting that a request carrying
 * `fxl_hub_session=<id>` makes the REAL SDK call `withSession('<id>')` goes red
 * if the SDK renames the cookie, which a constant never could.
 */
describe('createAppAuthBff cookie routing, against the real SDK', () => {
  it('routes the fxl_hub_session cookie into withSession on /auth/refresh', async () => {
    const store = requireDurableStore();
    const seen: string[] = [];
    const spy = vi.spyOn(store, 'withSession').mockImplementation(async (sessionId: string) => {
      seen.push(sessionId);
      return REFRESH_OK as never;
    });

    try {
      await authBff?.request('http://localhost/auth/refresh', {
        method: 'POST',
        headers: { cookie: 'fxl_hub_session=session-alpha; fxl_hub_login=login-alpha' },
      });
    } finally {
      spy.mockRestore();
    }

    expect(seen).toEqual(['session-alpha']);
  });

  it('routes the fxl_hub_login cookie into consumeLoginTransaction on /auth/callback', async () => {
    const store = requireDurableStore();
    const seen: string[] = [];
    const spy = vi
      .spyOn(store, 'consumeLoginTransaction')
      .mockImplementation(async (loginTxId: string) => {
        seen.push(loginTxId);
        return null;
      });

    try {
      await authBff?.request('http://localhost/auth/callback?state=x', {
        headers: { cookie: 'fxl_hub_session=session-alpha; fxl_hub_login=login-alpha' },
      });
    } finally {
      spy.mockRestore();
    }

    expect(seen).toEqual(['login-alpha']);
  });

  it('reads the __Host- session cookie when secureCookies is on', async () => {
    const actual = await vi.importActual<typeof import('@fxl-business/hub-sdk/server')>(
      '@fxl-business/hub-sdk/server',
    );
    const seen: string[] = [];
    const probe: HubSessionStore = {
      create: async () => 'probe-session',
      withSession: async (sessionId) => {
        seen.push(sessionId);
        return REFRESH_OK as never;
      },
      createLoginTransaction: async () => 'probe-login',
      consumeLoginTransaction: async () => null,
    };
    const config: HubSdkConfig = {
      apiUrl: 'http://localhost:9016',
      publishableKey: 'pk_fxl-sales_unit-test-publishable-key',
      secretKey: HUB_SECRET_KEY,
      audience: 'product.fxl-sales',
    };

    const bff = actual.createHubBff(config, {
      sessionStore: probe,
      secureCookies: true,
      fetchImpl: (() => {
        throw new Error('the probe short-circuits before any Hub call');
      }) as unknown as typeof fetch,
    });

    await bff.request('http://localhost/auth/refresh', {
      method: 'POST',
      headers: { cookie: '__Host-fxl_hub_session=right; fxl_hub_session=wrong' },
    });

    expect(seen).toEqual(['right']);
  });
});

describe('createAppAuthBff store outage', () => {
  it("answers 503 rather than a cookie-clearing 401 when withSession rejects, through app.route('', authBff)", async () => {
    // The end-to-end constraint-2 proof, against the REAL SDK and through the
    // exact mount server.ts uses. hono's `route()` flattens a sub-app's routes
    // into the parent and only wraps them in the sub-app's errorHandler when it
    // is non-default, so this is the shape that can regress on a hono bump.
    const store = requireDurableStore();
    const spy = vi
      .spyOn(store, 'withSession')
      .mockRejectedValue(new StoreUnavailable('hub session transaction failed'));
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => {});

    const app = new Hono();
    if (!authBff) {
      throw new Error('expected an auth BFF router');
    }
    app.route('', authBff);

    let res: Response;
    try {
      res = await app.request('http://localhost/auth/refresh', {
        method: 'POST',
        headers: { cookie: 'fxl_hub_session=session-alpha' },
      });
    } finally {
      spy.mockRestore();
      errorLog.mockRestore();
    }

    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: 'unavailable', code: 'session_store_unavailable' });
    expect(res.headers.get('set-cookie')).toBeNull();
  });
});
