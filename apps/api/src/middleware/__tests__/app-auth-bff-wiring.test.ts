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
 * `SALES_SESSION_ENCRYPTION_IKM=''`, which is the value `.env.dev.example` ships
 * and therefore the value the documented local setup produces. Reading
 * `process.env.SALES_SESSION_ENCRYPTION_IKM ?? secretKey` keeps that empty string,
 * `createSessionSealer('')` throws its 32-character floor, and `server.ts` calls
 * `createAppAuthBff()` at module top level - so the API would not boot at all.
 */
import type {
  HubConfig,
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

/**
 * Obviously synthetic fixtures. The secret is long enough to clear the sealer's
 * 32-character floor on its own.
 */
const HUB_CLIENT_ID = 'pk_fxl-sales_development_unit-test-only-0123456789';
const HUB_CLIENT_SECRET = 'sk_fxl-sales_development_unit-test-only-not-a-real-secret-0123456789';

type CapturedBffOptions =
  | {
      sessionStore?: unknown;
      fetchImpl?: unknown;
      timeoutMs?: number;
      sessionTtlSeconds?: number;
      sessionAbsoluteTtlSeconds?: number;
      redirectUri?: unknown;
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

/**
 * The fake Hub currently in play, or null for "no test has installed one".
 *
 * It is a MUTABLE indirection rather than a per-test `vi.stubGlobal`, and that is
 * forced by the SDK: `createHubBff` binds `options.fetchImpl ?? fetch` ONCE at
 * construction, and construction happens in `beforeAll`. While this app passed a
 * `fetchImpl` wrapper the binding was resolved per call, so a later stub reached
 * it; with the wrapper deleted in favour of 2.2.0's own parser, a later stub
 * would never be seen and every request would escape to whatever
 * `FXL_HUB_API_URL` names. So the global is stubbed ONCE, before construction,
 * and each test swaps the handler behind it.
 */
let hubHandler: typeof fetch | null = null;
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
  // NODE_ENV is stubbed to 'test' in this very block, so this file is a live
  // demonstration that the Hub environment and the process environment are
  // independent: the Hub environment is explicit configuration and is never
  // inferred.
  vi.stubEnv('FXL_HUB_ENVIRONMENT', 'development');
  vi.stubEnv('FXL_HUB_CLIENT_ID', HUB_CLIENT_ID);
  vi.stubEnv('FXL_HUB_CLIENT_SECRET', HUB_CLIENT_SECRET);
  vi.stubEnv('FXL_HUB_AUDIENCE', 'app.fxl-sales');
  // Blank reads as unset. A developer's own apps/api/.env could otherwise carry
  // the JSON form and make this file throw on ambiguity at import.
  vi.stubEnv('FXL_HUB_CONFIG', '');
  vi.stubEnv('FXL_HUB_REDIRECT_URI', 'http://localhost:8006/auth/callback');
  vi.stubEnv('FXL_HUB_POST_LOGIN_REDIRECT', 'http://localhost:8006');
  vi.stubEnv('FXL_HUB_POST_LOGIN_ERROR_REDIRECT', 'http://localhost:8006/?error=auth');
  // BLOCKER A: exactly what .env.dev.example ships.
  vi.stubEnv('SALES_SESSION_ENCRYPTION_IKM', '');

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
  // BEFORE construction, so the SDK's one-time `fetchImpl ?? fetch` binding
  // captures this indirection rather than the real global.
  vi.stubGlobal('fetch', ((...args: Parameters<typeof fetch>) => {
    if (hubHandler === null) {
      return Promise.reject(new Error('no fake Hub installed for this test'));
    }
    return hubHandler(...args);
  }) as typeof fetch);

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

type RecordedCall = { op: 'read' | 'update' | 'delete'; token?: string };

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
    read: async () => {
      calls.push({ op: 'read' });
      return record === null ? { status: 'absent' as const } : { status: 'found' as const, record };
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
 * Points the already-installed global stub at a fresh fake Hub. See `hubHandler`
 * for why this cannot be a `vi.stubGlobal` of its own.
 */
function stubHub(setCookies: readonly string[], body: unknown, status = 200) {
  const { impl, seen } = fakeHubFetch(setCookies, body, status);
  hubHandler = impl as unknown as typeof fetch;
  return seen;
}

describe('createAppAuthBff wiring', () => {
  it('boots with the blank SALES_SESSION_ENCRYPTION_IKM that .env.dev.example ships', () => {
    // The blank override must read as "unset" and fall back to the documented
    // HKDF-from-FXL_HUB_CLIENT_SECRET default, not reach the sealer as ''.
    expect(encryptionIkm).toBe(HUB_CLIENT_SECRET);
    expect(authBff).not.toBeNull();
  });

  /**
   * The BLANK case above and this ABSENT case are different inputs to the same
   * `??`: blank travels through `emptyToUndefined` in env.ts, absent never
   * reaches zod at all. This one is the property a careless rename drops - move
   * the declaration to the new name and leave the READ on the old one and the
   * variable is simply never resolved, which nothing else here would notice
   * because the fallback would still produce the client secret by accident.
   * So the module graph is reloaded with the key genuinely deleted from
   * `process.env`, and the captured seam value is compared to the secret.
   *
   * The shared capture variables are snapshotted and restored, because every
   * other test in this file reads the objects the `beforeAll` load produced.
   */
  it('falls back to the client secret when SALES_SESSION_ENCRYPTION_IKM is absent', async () => {
    const saved = { encryptionIkm, bffOptions, sessionStoreKind, durableStore, authBff };
    const previous = process.env.SALES_SESSION_ENCRYPTION_IKM;
    // `vi.stubEnv` cannot express "absent" here without also being undone by the
    // afterAll unstub, so the key is deleted directly and restored in `finally`.
    delete process.env.SALES_SESSION_ENCRYPTION_IKM;

    let closeSecondDb: (() => Promise<void>) | undefined;
    try {
      vi.resetModules();
      const dbClient = await import('../../db/client.js');
      closeSecondDb = dbClient.closeDb;
      const appAuth = await import('../app-auth.js');

      const reloaded = appAuth.createAppAuthBff();

      expect(reloaded).not.toBeNull();
      // Drop `?? hubAuthConfig.clientSecret` and this is `undefined`.
      expect(encryptionIkm).toBe(HUB_CLIENT_SECRET);
      expect(encryptionIkm).not.toBe('');
    } finally {
      await closeSecondDb?.();
      if (previous === undefined) {
        delete process.env.SALES_SESSION_ENCRYPTION_IKM;
      } else {
        process.env.SALES_SESSION_ENCRYPTION_IKM = previous;
      }
      encryptionIkm = saved.encryptionIkm;
      bffOptions = saved.bffOptions;
      sessionStoreKind = saved.sessionStoreKind;
      durableStore = saved.durableStore;
      authBff = saved.authBff;
    }
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

  it("points the BFF callback at this app's own origin rather than the Hub's", () => {
    // 2.x's createHubBff defaults redirectUri to `${config.apiUrl}/auth/callback`,
    // which is the HUB's origin and is always wrong for this app.
    expect(bffOptions?.redirectUri).toBe('http://localhost:8006/auth/callback');
    expect(String(bffOptions?.redirectUri)).not.toContain('localhost:9016');
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
      kind: 'persistent',
      create: async () => 'probe-session',
      withSession: async (sessionId) => {
        seen.push(sessionId);
        return REFRESH_OK as never;
      },
      createLoginTransaction: async () => 'probe-login',
      consumeLoginTransaction: async () => null,
    };
    const config: HubConfig = {
      apiUrl: 'http://localhost:9016',
      environment: 'development',
      clientId: 'pk_fxl-sales_development_unit-test-client-id',
      clientSecret: HUB_CLIENT_SECRET,
      audience: 'app.fxl-sales',
    };

    const bff = actual.createHubBff(config, {
      sessionStore: probe,
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
    const config: HubConfig = {
      apiUrl: 'http://localhost:9016',
      environment: 'development',
      clientId: 'pk_fxl-sales_development_unit-test-client-id',
      clientSecret: HUB_CLIENT_SECRET,
      audience: 'app.fxl-sales',
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
      The oracle for the 2026-08-10 production outage. This app once carried a
      hand-rolled origin shim for it; 2.2.0 makes the guard configurable, so the
      protection now rides `createHubBff`'s own `trustedOrigins` option and this
      test proves `createAppAuthBff` actually passes it. Dropping that option
      leaves the rest of the API suite green while reproducing the outage
      exactly, which is why this test keeps its title across the change.

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

    /*
      The two LOAD-BEARING properties are unchanged and are why this test exists:
      a store outage answers 503 rather than the 401 that would read as "no
      session", and it clears no cookie. A 401 here logs every user out over a
      brief database blip.

      The BODY changed with the bump, and that is upstream rather than a
      regression. 2.2.0 catches the store failure itself and answers
      `{error:'session_store_unavailable'}` with `clear: false`, so it never
      reaches this repo's `hubBffErrorHandler` on this path. Nothing in apps/web
      reads this body: `requestHubAccessToken` classifies on the STATUS, and only
      a 401 ends the session.
    */
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: 'session_store_unavailable' });
    expect(res.headers.get('set-cookie')).toBeNull();
  });
});

/**
 * The oracle for the production defect of 2026-08-12: every session died one to
 * three minutes after login.
 *
 * The Hub runs with `NODE_ENV=production` and rotates the session cookie as
 * `__Host-fxl_hub_session=`, which `parseRotatedRefresh` could not match through
 * 1.3.1. `tx.update` was therefore never called on the rotation path, Postgres
 * kept the refresh token that had just been spent, the BFF still answered 200,
 * and the Hub revoked the whole token family on the second replay, measured in
 * production on 2026-08-12. This app bridged it at the `fetchImpl` seam for one
 * wave; `@fxl-business/hub-sdk@2.2.0` fixes it upstream (`dist/server.js:307-316`,
 * the `__Host-` name tried first and the plain name as fallback), so the bridge
 * is deleted and these tests now prove the SDK's OWN parser.
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
    // THE oracle. Through 1.3.1 the SDK's regex missed, `calls` was
    // [{ op: 'read' }], the stored token stayed 'RT1' and the route still
    // answered 200 - the production symptom. On 2.2.0 the update must land.
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
      hubHandler = null;
    }

    // TWO updates, and that is 2.2.0 behaviour rather than a double write of the
    // token: the first carries the rotated refresh token, the second re-writes
    // the record to slide `expiresAt` forward. This store ignores both
    // timestamps by design, so the second is inert here; what matters is that the
    // rotation landed and that the last word is still RT2.
    expect(session.calls).toEqual([
      { op: 'read' },
      { op: 'update', token: 'RT2' },
      { op: 'update', token: 'RT2' },
    ]);
    expect(session.stored()).toBe('RT2');
    expect(seen).toHaveLength(1);
    expect(seen[0]).toContain('/auth/refresh');
  });

  it('persists the rotated refresh token when the Hub rotates __Host-fxl_hub_session on an Organization switch', async () => {
    // `POST /auth/switch` was DELETED in 2.0.0. An Organization switch now rides
    // `POST /auth/refresh` with an `organizationId` body, so it goes through the
    // SAME handler and the SAME parseRotatedRefresh call as an ordinary renewal.
    // A switch that loses its rotation kills the session exactly like a refresh
    // that does, so the case is still pinned - it just no longer needs a second
    // route to pin it.
    const session = recordingSession();
    const spy = useRecordingSession(session);
    const seen = stubHub([HUB_UNRELATED, HUB_ROTATION_PROD], HUB_SWITCH_BODY);

    let res: Response | undefined;
    try {
      res = await authBff?.request('http://localhost/auth/refresh', {
        method: 'POST',
        headers: { cookie: 'fxl_hub_session=session-alpha', 'content-type': 'application/json' },
        body: JSON.stringify({ organizationId: 'ws-2' }),
      });
    } finally {
      spy.mockRestore();
      hubHandler = null;
    }

    expect(res?.status).toBe(200);
    expect(session.stored()).toBe('RT2');
    expect(session.calls.filter((call) => call.op === 'update')).toContainEqual({
      op: 'update',
      token: 'RT2',
    });
    expect(seen).toHaveLength(1);
    expect(seen[0]).toContain('/auth/refresh');
  });

  it('still persists the rotated refresh token when the Hub sends the unprefixed fxl_hub_session', async () => {
    // The local-development path, which always worked: 2.2.0 tries the `__Host-`
    // name first and falls back to this one, so both shapes rotate.
    //
    // The harness note that used to sit here is gone with the wrapper. It warned
    // that deleting `fetchImpl` would redden this test for a harness reason
    // rather than a real one, because `createHubBff` binds `fetchImpl ?? fetch`
    // once at construction. That is still true of the SDK, and it is now handled
    // where it belongs: the global stub is installed BEFORE construction and each
    // test swaps the handler behind it. See `hubHandler`.
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
      hubHandler = null;
    }

    expect(session.calls).toEqual([
      { op: 'read' },
      { op: 'update', token: 'RT2' },
      { op: 'update', token: 'RT2' },
    ]);
    expect(session.stored()).toBe('RT2');
  });

  it('does not rotate the stored token when the Hub sends no Set-Cookie at all', async () => {
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
      hubHandler = null;
    }

    expect(res?.status).toBe(200);
    /*
      Through 1.3.1 this asserted `calls === [{op:'read'}]`, because no
      Set-Cookie meant no write at all. 2.2.0 still writes the record back to
      slide `expiresAt`, so the shape changed while the RULE did not: no
      Set-Cookie must never invent a new refresh token.

      The session is READ and the token is unchanged, asserted positively. An
      earlier version of this looped over `calls` checking each update carried
      RT1, which passes vacuously when there are no calls at all and would have
      gone green on a regression that stopped touching the store entirely.
    */
    expect(session.stored()).toBe('RT1');
    expect(session.calls[0]).toEqual({ op: 'read' });
    expect(session.calls.filter((call) => call.op === 'update')).toEqual([
      { op: 'update', token: 'RT1' },
    ]);
    expect(session.calls.some((call) => call.op === 'delete')).toBe(false);
  });

  it('answers the accessToken and status the SDK produced', async () => {
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
      hubHandler = null;
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
      hubHandler = null;
    }

    const setCookies = res?.headers.getSetCookie() ?? [];

    // The Hub's rotated refresh token must NEVER reach the browser. That is the
    // property, and it is asserted directly on the value rather than on the
    // header being empty.
    for (const cookie of setCookies) {
      expect(cookie).not.toContain('RT2');
      expect(cookie).not.toContain('hub_edge');
    }

    // What the browser legitimately receives is the BFF's OWN session cookie,
    // carrying the session ID and not a token, re-issued with a fresh Max-Age
    // because 2.2.0's session lifetime slides on every refresh. 1.3.1 set no
    // cookie on this path at all, which is why this assertion changed shape.
    expect(setCookies).toHaveLength(1);
    expect(setCookies[0]).toContain('fxl_hub_session=session-alpha');
    expect(setCookies[0]).toContain('HttpOnly');
  });

  it('passes no fetchImpl, so the rotation parser that runs is the SDK own one', () => {
    // 2.2.0 matches `__Host-fxl_hub_session` natively, so this app hands the BFF
    // nothing and the SDK falls back to the global `fetch`. The rotation itself
    // is proven by the tests above, through the real handler.
    expect(bffOptions?.fetchImpl).toBeUndefined();
  });
});
