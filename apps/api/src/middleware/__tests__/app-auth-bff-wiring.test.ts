/**
 * Pins the WIRING of `createAppAuthBff()`, which nothing else does.
 *
 * The production bug this slice fixes is one missing option:
 * `createHubBff(config, { ... })` without `sessionStore`, which makes the SDK
 * fall back to `new InMemoryHubSessionStore()` (dist/server.js:300) and lose
 * every session on restart. The oracle in `test/rls/hub-bff-session-store.test.ts`
 * builds the durable store DIRECTLY, so it proves the store is durable but not
 * that the store ever reaches the SDK - deleting `sessionStore: session.store`
 * leaves that suite green. This file closes that gap: remove the option and
 * `hands the durable session store to createHubBff` goes red.
 *
 * It also pins Blocker A: the module graph is loaded with
 * `HUB_SESSION_ENCRYPTION_KEY=''`, which is the value `.env.dev.example` ships
 * and therefore the value the documented local setup produces. Reading
 * `process.env.HUB_SESSION_ENCRYPTION_KEY ?? secretKey` keeps that empty string,
 * `createSessionSealer('')` throws its 32-character floor, and `server.ts` calls
 * `createAppAuthBff()` at module top level - so the API would not boot at all.
 */
import { InMemoryHubSessionStore } from '@fxl-business/hub-sdk';
import type { Hono } from 'hono';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type {
  DurableHubSessionStore,
  HubSessionHydrateInput,
} from '../../auth/hub-session-store.js';

/** Long enough to clear the sealer's 32-character floor on its own. */
const HUB_SECRET_KEY = 'unit-test-hub-secret-key-0123456789abcdef';

type CapturedBffOptions = { sessionStore?: unknown } | undefined;

let bffOptions: CapturedBffOptions;
let sessionStoreKind: string | undefined;
let durableStore: DurableHubSessionStore | undefined;
let encryptionIkm: string | undefined;
let authBff: Hono | null = null;
let closeDb: (() => Promise<void>) | undefined;

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

  const appAuth = await import('../app-auth.js');
  // If Blocker A were unfixed this line would THROW, exactly as server.ts does.
  authBff = appAuth.createAppAuthBff() as Hono | null;
});

afterAll(async () => {
  await closeDb?.();
  vi.doUnmock('@fxl-business/hub-sdk/server');
  vi.doUnmock('../../auth/hub-session-store.js');
  vi.unstubAllEnvs();
  vi.resetModules();
});

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
    // the very instance the scope middleware hydrates and flushes.
    expect(bffOptions?.sessionStore).toBe(durableStore);
  });

  it('mounts the session-scope middleware on /auth/*', async () => {
    const store = durableStore;
    if (!store) {
      throw new Error('expected a durable store');
    }
    const inputs: HubSessionHydrateInput[] = [];
    // Short-circuit withRequest so the middleware needs no database at all; we
    // are asserting that it RAN and with which cookies, not what it loaded.
    const spy = vi
      .spyOn(store, 'withRequest')
      .mockImplementation(async (input: HubSessionHydrateInput) => {
        inputs.push(input);
        return undefined as never;
      });

    try {
      await authBff?.request('http://localhost/auth/refresh', {
        headers: { cookie: 'fxl_hub_session=session-alpha; fxl_hub_login=login-alpha' },
      });
    } finally {
      spy.mockRestore();
    }

    expect(inputs).toEqual([
      { sessionId: 'session-alpha', loginTxId: 'login-alpha', consumeLoginTx: false },
    ]);
  });
});
