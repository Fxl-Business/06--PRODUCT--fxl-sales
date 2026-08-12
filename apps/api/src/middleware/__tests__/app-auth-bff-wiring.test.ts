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
import type {
  HubSdkConfig,
  HubSessionRecord,
  HubSessionStore,
  HubSessionTransaction,
} from '@fxl-business/hub-sdk';
import { InMemoryHubSessionStore } from '@fxl-business/hub-sdk';
import { Hono } from 'hono';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type {
  DurableHubSessionStore,
  HubLoginContext,
} from '../../auth/hub-session-store.js';
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
      fetchImpl?: unknown;
      timeoutMs?: number;
      sessionTtlSeconds?: number;
      sessionAbsoluteTtlSeconds?: number;
    }
  | undefined;

/** What the SDK expects back from `withSession` on /auth/refresh. */
const REFRESH_OK = { status: 200, body: { ok: true }, clear: false };

let bffOptions: CapturedBffOptions;
let sessionStoreKind: string | undefined;
/**
 * `DurableHubSessionStore`, not the SDK's `HubSessionStore`: the assignment below
 * only compiles because `createHubSessionStore`'s return is DISCRIMINATED, so
 * `result.kind === 'durable'` narrows the store to the one that can supersede.
 * Collapsing that union back to a single type is a type error here.
 */
let durableStore: DurableHubSessionStore | undefined;
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
  // The rotated-cookie oracles below stub globalThis.fetch. Each restores its own
  // stub in a `finally`; this is the backstop, because a leaked fetch stub makes
  // an unrelated later file fail in a way that reads as a different bug.
  vi.unstubAllGlobals();
  vi.resetModules();
});

function requireDurableStore(): DurableHubSessionStore {
  if (!durableStore) {
    throw new Error('expected a durable store');
  }
  return durableStore;
}

const HUB_ROTATION_PROD =
  '__Host-fxl_hub_session=RT2; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=2592000';
const HUB_ROTATION_DEV = 'fxl_hub_session=RT2; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000';
const HUB_UNRELATED = 'hub_edge=iad1; Path=/; Expires=Wed, 21 Oct 2026 07:28:00 GMT';
const HUB_REFRESH_BODY = { accessToken: 'AT2', expiresIn: 120 };
const HUB_SWITCH_BODY = {
  accessToken: 'AT3',
  expiresIn: 120,
  workspace: { id: 'ws-2', name: 'Segunda' },
};

type RecordedCall = { op: 'get' | 'update' | 'delete'; token?: string };

/**
 * A recording, in-memory stand-in for ONE durable transaction. It honours the
 * withSession contract the SDK is written against - a single transaction object,
 * `get` first, `update` writing through - so the SDK's real handler runs its
 * whole read-modify-write with no database.
 */
function recordingSession(initialToken = 'RT1') {
  const calls: RecordedCall[] = [];
  let record: HubSessionRecord | null = {
    hubRefreshToken: initialToken,
    expiresAt: new Date(Date.now() + 600_000).toISOString(),
    absoluteExpiresAt: new Date(Date.now() + 3_600_000).toISOString(),
  };
  const tx: HubSessionTransaction = {
    get: async () => {
      calls.push({ op: 'get' });
      return record;
    },
    update: async (next) => {
      calls.push({ op: 'update', token: next.hubRefreshToken });
      record = next;
    },
    delete: async () => {
      calls.push({ op: 'delete' });
      record = null;
    },
  };
  return { calls, tx, stored: () => record?.hubRefreshToken ?? null };
}

/** Points the DURABLE store's withSession at that transaction, so no Postgres is reached. */
function useRecordingSession(session: ReturnType<typeof recordingSession>) {
  return vi
    .spyOn(requireDurableStore(), 'withSession')
    .mockImplementation(((_id: string, operation: (tx: HubSessionTransaction) => Promise<unknown>) =>
      operation(session.tx)) as never);
}

/** The fake Hub, as a bare fetch. Production shape: the rotation is `__Host-` prefixed. */
function fakeHubFetch(setCookies: readonly string[], body: unknown, status = 200) {
  const seen: string[] = [];
  const impl = (async (input: RequestInfo | URL) => {
    seen.push(String(input));
    const headers = new Headers({ 'content-type': 'application/json' });
    for (const cookie of setCookies) headers.append('set-cookie', cookie);
    return new Response(JSON.stringify(body), { status, headers });
  }) as typeof fetch;
  return { impl, seen };
}

/**
 * Installs that fake Hub as the ambient global fetch. The wrapper resolves
 * `globalThis.fetch` at CALL time, which is what makes stubbing it here - long
 * after `createAppAuthBff()` ran in beforeAll - reach the real production wiring.
 */
function stubHub(setCookies: readonly string[], body: unknown, status = 200) {
  const { impl, seen } = fakeHubFetch(setCookies, body, status);
  vi.stubGlobal('fetch', impl);
  return seen;
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

/**
 * The `/auth/refresh` CONTRACT pin, on behalf of `apps/web/src/auth/refresh.ts`.
 *
 * That module posts to `<bffBasePath>/auth/refresh` itself, because
 * `HubClient.getToken()` discards `res.status` and so hides the BFF's 401/503/502
 * classification from every consumer. The web-side test asserts our own literal
 * against our own literal, which is the exact weakness the cookie-name pin above
 * removed: if a future SDK moves the path or the method, that test stays green
 * while the app silently 404s - and a 404 is neither a 401 nor a 5xx, so every
 * page load would burn the full revalidation ladder and then bounce to a login.
 *
 * This lives here rather than beside `refresh.test.ts` because `hono` is not
 * resolvable from `apps/web`, and adding it there to host one test would put a
 * server framework in the browser package's dependency graph. What is being
 * pinned is the SDK's server-side route table, which is this package's business.
 */
describe('the SDK BFF route contract apps/web/src/auth/refresh.ts is coupled to', () => {
  async function realBff() {
    const actual = await vi.importActual<typeof import('@fxl-business/hub-sdk/server')>(
      '@fxl-business/hub-sdk/server',
    );
    const config: HubSdkConfig = {
      apiUrl: 'http://localhost:9016',
      publishableKey: 'pk_fxl-sales_unit-test-publishable-key',
      secretKey: HUB_SECRET_KEY,
      audience: 'product.fxl-sales',
    };
    return actual.createHubBff(config, {
      sessionStore: new InMemoryHubSessionStore(),
      fetchImpl: (() => {
        throw new Error('a cookieless refresh must never reach the Hub');
      }) as unknown as typeof fetch,
    });
  }

  it('answers 401 to a cookieless POST /auth/refresh, which is the verdict the web classifier keys on', async () => {
    const bff = await realBff();

    const res = await bff.request('http://localhost/auth/refresh', { method: 'POST' });

    expect(res.status).toBe(401);
  });

  it('does not route a neighbouring path, so a moved endpoint cannot pass as a live one', async () => {
    // Without this, the 401 above would also be satisfied by a catch-all, and the
    // pin would prove nothing about the path itself.
    const bff = await realBff();

    const res = await bff.request('http://localhost/auth/refreshx', { method: 'POST' });

    expect(res.status).toBe(404);
  });
});

/**
 * The login-supersede MOUNT pin.
 *
 * The integration oracles in `test/rls/hub-bff-session-store.test.ts` call
 * `withLoginContext` themselves, so they stay green with the `router.use(...)`
 * line deleted and the feature entirely unreachable in production. This is the
 * only test that fails on that deletion - the same gap the file header describes
 * for `sessionStore`.
 */
describe('createAppAuthBff login supersede', () => {
  it('mounts the login-supersede middleware on /auth/callback', async () => {
    const store = requireDurableStore();
    const seen: HubLoginContext[] = [];
    const loginSpy = vi
      .spyOn(store, 'withLoginContext')
      .mockImplementation(async (context, fn) => {
        seen.push(context);
        return fn();
      });
    // Both routes would otherwise reach a database that does not exist.
    const refreshSpy = vi
      .spyOn(store, 'withSession')
      .mockImplementation(async () => REFRESH_OK as never);
    const loginTxSpy = vi.spyOn(store, 'consumeLoginTransaction').mockImplementation(async () => null);

    try {
      await authBff?.request('http://localhost/auth/callback?state=x', {
        headers: { cookie: 'fxl_hub_session=session-prior; fxl_hub_login=login-alpha' },
      });
      // Scoped to /auth/callback only: store.create is called from exactly one
      // place in the SDK bundle (dist/server.js:408) and it is inside that
      // handler, so no other route may acquire a supersede context.
      await authBff?.request('http://localhost/auth/refresh', {
        method: 'POST',
        headers: { cookie: 'fxl_hub_session=session-prior' },
      });
    } finally {
      loginSpy.mockRestore();
      refreshSpy.mockRestore();
      loginTxSpy.mockRestore();
    }

    expect(seen).toEqual([{ priorSessionId: 'session-prior' }]);
  });
});

describe('createAppAuthBff trusted-origin mount', () => {
  it('does not 403 a cross-origin refresh from CORS_ORIGIN, through the real mount', async () => {
    /*
      The oracle for the 2026-08-10 production outage, and specifically for the
      MOUNT rather than the shim. `hub-bff-origin.test.ts` proves the shim works;
      this proves `createAppAuthBff` actually uses it. Reverting the mount to
      `router.route('', bff)` left all 391 API tests green while reproducing the
      outage exactly, so without this a future "simplify back to route()" cleanup
      re-breaks production with a green suite.

      CORS_ORIGIN is stubbed to http://localhost:8006 in this file's setup, and
      the request is issued from http://localhost - a DIFFERENT origin, which is
      the whole point.
    */
    if (!authBff) {
      throw new Error('expected an auth BFF router');
    }
    const app = new Hono();
    app.route('', authBff);

    const res = await app.request('http://localhost/auth/refresh', {
      method: 'POST',
      headers: { origin: 'http://localhost:8006', 'sec-fetch-site': 'same-site' },
    });

    // 401 is the cookieless-session verdict. 403 means the SDK's CSRF guard
    // rejected us, which is the outage.
    expect(res.status).not.toBe(403);
    expect(res.status).toBe(401);
  });

  it('still 403s a cross-origin refresh from an origin that is not CORS_ORIGIN', async () => {
    // The other half: the mount must not have widened into a blanket bypass.
    if (!authBff) {
      throw new Error('expected an auth BFF router');
    }
    const app = new Hono();
    app.route('', authBff);

    const res = await app.request('http://localhost/auth/refresh', {
      method: 'POST',
      headers: { origin: 'https://evil.example.test', 'sec-fetch-site': 'cross-site' },
    });

    expect(res.status).toBe(403);
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

/**
 * The oracle for the production defect of 2026-08-12: every session died one to
 * three minutes after login.
 *
 * The Hub runs with `NODE_ENV=production` and rotates the session cookie as
 * `__Host-fxl_hub_session=`, which the SDK's `parseRotatedRefresh`
 * (`dist/server.js:301`) cannot match. `tx.update` was therefore never called on
 * the rotation path, Postgres kept the refresh token that had just been spent,
 * the BFF still answered 200, and the Hub revoked the whole token family on the
 * second replay. `apps/api/src/auth/hub-rotated-cookie.ts` is the fix, wired
 * through `createHubBff`'s documented `fetchImpl` option.
 *
 * Until now nothing in this repository had ever executed the SDK's real refresh
 * handler: every test here stubbed `withSession` to return a canned `REFRESH_OK`,
 * and every rotation test elsewhere called `handle.update(...)` directly. That
 * gap is what let this ship, so these tests drive the whole real path and fake
 * only the Hub and the transaction body.
 *
 * NOTE, because it is the first thing a reviewer will challenge: this file stubs
 * `NODE_ENV=test`, so `secureCookies` is false and the BFF reads the browser's
 * session id from the UNPREFIXED request cookie. That is correct and does not
 * weaken the oracle. The defect is in how the SDK parses the Hub's RESPONSE, and
 * the SDK's response parser is the same code in both modes. The request-side
 * `__Host-` behaviour is pinned separately by
 * `reads the __Host- session cookie when secureCookies is on` above.
 */
describe('createAppAuthBff rotated Hub session cookie, against the real SDK handlers', () => {
  it('persists the rotated refresh token when the Hub rotates __Host-fxl_hub_session on /auth/refresh', async () => {
    // THE oracle. Without `fetchImpl: createHubRotatedCookieFetch()` in
    // app-auth.ts the SDK's regex misses, `calls` is [{ op: 'get' }], the stored
    // token stays 'RT1' and the route still answers 200 - the production symptom,
    // reproduced.
    const session = recordingSession();
    const spy = useRecordingSession(session);
    const seen = stubHub([HUB_UNRELATED, HUB_ROTATION_PROD], HUB_REFRESH_BODY);

    try {
      await authBff?.request('http://localhost/auth/refresh', {
        method: 'POST',
        headers: { cookie: 'fxl_hub_session=session-alpha' },
      });
    } finally {
      spy.mockRestore();
      vi.unstubAllGlobals();
    }

    expect(session.calls).toEqual([{ op: 'get' }, { op: 'update', token: 'RT2' }]);
    expect(session.stored()).toBe('RT2');
    expect(seen).toHaveLength(1);
    expect(seen[0]).toContain('/auth/refresh');
  });

  it('persists the rotated refresh token when the Hub rotates __Host-fxl_hub_session on /auth/switch', async () => {
    // A workspace switch that loses its rotation kills the session exactly like a
    // refresh that does, and the SDK repeats the same two lines at
    // dist/server.js:518-519. Both routes must be pinned.
    const session = recordingSession();
    const spy = useRecordingSession(session);
    const seen = stubHub([HUB_UNRELATED, HUB_ROTATION_PROD], HUB_SWITCH_BODY);

    let res: Response | undefined;
    try {
      res = await authBff?.request('http://localhost/auth/switch', {
        method: 'POST',
        headers: { cookie: 'fxl_hub_session=session-alpha', 'content-type': 'application/json' },
        body: JSON.stringify({ workspaceId: 'ws-2' }),
      });
    } finally {
      spy.mockRestore();
      vi.unstubAllGlobals();
    }

    expect(res?.status).toBe(200);
    expect(session.calls).toEqual([{ op: 'get' }, { op: 'update', token: 'RT2' }]);
    expect(session.stored()).toBe('RT2');
    expect(seen).toHaveLength(1);
    expect(seen[0]).toContain('/auth/switch');
  });

  it('still persists the rotated refresh token when the Hub sends the unprefixed fxl_hub_session', async () => {
    // The local-development path, which always worked. The wrapper must not have
    // broken it on the way past.
    const session = recordingSession();
    const spy = useRecordingSession(session);
    stubHub([HUB_ROTATION_DEV], HUB_REFRESH_BODY);

    try {
      await authBff?.request('http://localhost/auth/refresh', {
        method: 'POST',
        headers: { cookie: 'fxl_hub_session=session-alpha' },
      });
    } finally {
      spy.mockRestore();
      vi.unstubAllGlobals();
    }

    expect(session.calls).toEqual([{ op: 'get' }, { op: 'update', token: 'RT2' }]);
    expect(session.stored()).toBe('RT2');
  });

  it('does not write to the session when the Hub sends no Set-Cookie at all', async () => {
    const session = recordingSession();
    const spy = useRecordingSession(session);
    stubHub([], HUB_REFRESH_BODY);

    let res: Response | undefined;
    try {
      res = await authBff?.request('http://localhost/auth/refresh', {
        method: 'POST',
        headers: { cookie: 'fxl_hub_session=session-alpha' },
      });
    } finally {
      spy.mockRestore();
      vi.unstubAllGlobals();
    }

    expect(res?.status).toBe(200);
    expect(session.calls).toEqual([{ op: 'get' }]);
    expect(session.stored()).toBe('RT1');
  });

  it('answers the accessToken and status the SDK produced, unchanged by the wrapper', async () => {
    const session = recordingSession();
    const spy = useRecordingSession(session);
    stubHub([HUB_UNRELATED, HUB_ROTATION_PROD], HUB_REFRESH_BODY);

    let res: Response | undefined;
    try {
      res = await authBff?.request('http://localhost/auth/refresh', {
        method: 'POST',
        headers: { cookie: 'fxl_hub_session=session-alpha' },
      });
    } finally {
      spy.mockRestore();
      vi.unstubAllGlobals();
    }

    expect(res?.status).toBe(200);
    expect(await res?.json()).toEqual(HUB_REFRESH_BODY);
  });

  it('does not leak the Hub Set-Cookie headers to the browser', async () => {
    // The behavioural form of the backchannel-versus-browser rule: the rotated
    // REFRESH TOKEN must never appear on a response the browser can see.
    const session = recordingSession();
    const spy = useRecordingSession(session);
    stubHub([HUB_UNRELATED, HUB_ROTATION_PROD], HUB_REFRESH_BODY);

    let res: Response | undefined;
    try {
      res = await authBff?.request('http://localhost/auth/refresh', {
        method: 'POST',
        headers: { cookie: 'fxl_hub_session=session-alpha' },
      });
    } finally {
      spy.mockRestore();
      vi.unstubAllGlobals();
    }

    expect(res?.headers.getSetCookie()).toEqual([]);
  });

  it('hands createHubBff a wrapped fetchImpl rather than the bare global fetch', () => {
    // Weak on its own, deliberately kept: deleting the option fails here with a
    // one-line diagnosis before it fails the oracle above with a longer one.
    expect(bffOptions?.fetchImpl).toBeDefined();
    expect(bffOptions?.fetchImpl).not.toBe(globalThis.fetch);
  });
});

/**
 * The non-vacuity control, following the
 * `proves the guard is real by 403ing that same request without the shim`
 * precedent in `hub-bff-origin.test.ts`.
 */
describe('the SDK rotation defect this wrapper exists for', () => {
  it('proves the rotation is genuinely lost without the wrapper, through the same real SDK handler', async () => {
    const actual = await vi.importActual<typeof import('@fxl-business/hub-sdk/server')>(
      '@fxl-business/hub-sdk/server',
    );
    const session = recordingSession();
    const probe: HubSessionStore = {
      create: async () => 'probe-session',
      withSession: ((_id: string, operation: (tx: HubSessionTransaction) => Promise<unknown>) =>
        operation(session.tx)) as never,
      createLoginTransaction: async () => 'probe-login',
      consumeLoginTransaction: async () => null,
    };
    const config: HubSdkConfig = {
      apiUrl: 'http://localhost:9016',
      publishableKey: 'pk_fxl-sales_unit-test-publishable-key',
      secretKey: HUB_SECRET_KEY,
      audience: 'product.fxl-sales',
    };
    const hub = fakeHubFetch([HUB_UNRELATED, HUB_ROTATION_PROD], HUB_REFRESH_BODY);

    // The UNWRAPPED fake Hub, which is exactly what production ran before this
    // slice: the SDK's own `options.fetchImpl ?? fetch`.
    const bff = actual.createHubBff(config, { sessionStore: probe, fetchImpl: hub.impl });

    const res = await bff.request('http://localhost/auth/refresh', {
      method: 'POST',
      headers: { cookie: 'fxl_hub_session=session-alpha' },
    });

    // 200 with no update: the silent write loss, verbatim. If this ever goes
    // green with an `update`, the SDK was fixed upstream and
    // apps/api/src/auth/hub-rotated-cookie.ts can be deleted.
    expect(res.status).toBe(200);
    expect(session.calls).toEqual([{ op: 'get' }]);
    expect(session.stored()).toBe('RT1');
  });
});
