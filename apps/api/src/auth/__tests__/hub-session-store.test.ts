import { describe, expect, it, vi } from 'vitest';
import {
  SESSION_COOKIE,
  SESSION_COOKIE_SECURE,
  hubSessionCookieName,
} from '../hub-session-scope.js';
import {
  HubSessionScopeError,
  LOGIN_TX_TTL_MS,
  SESSION_TTL_MS,
  createDurableHubSessionStore,
  createHubSessionStore,
} from '../hub-session-store.js';
import { createSessionSealer } from '../session-crypto.js';

const IKM = 'hub-session-store-unit-test-ikm-0123456789';

/** The scope guard fires before any query, so no real connection is needed. */
function storeWithoutDb() {
  return createDurableHubSessionStore({
    db: undefined as never,
    sealer: createSessionSealer(IKM),
  });
}

function storeWithDb(db: unknown) {
  return createDurableHubSessionStore({
    db: db as never,
    sealer: createSessionSealer(IKM),
  });
}

describe('createHubSessionStore', () => {
  it('falls back to the in-process store outside production', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const result = createHubSessionStore({
        databaseUrlPresent: false,
        nodeEnv: 'development',
        encryptionIkm: IKM,
      });
      expect(result.kind).toBe('memory');
      expect(warn).toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });

  it('throws in production when DATABASE_URL is missing', () => {
    expect(() =>
      createHubSessionStore({
        databaseUrlPresent: false,
        nodeEnv: 'production',
        encryptionIkm: IKM,
      }),
    ).toThrow(/DATABASE_URL is required for the durable Hub BFF session store in production/);
  });
});

describe('request scope guard', () => {
  it('throws HubSessionScopeError when a store method runs outside withRequest', () => {
    const store = storeWithoutDb();
    expect(() => store.create({ hubRefreshToken: 'refresh-token-alpha' })).toThrow(
      HubSessionScopeError,
    );
    expect(() => store.get('any')).toThrow(HubSessionScopeError);
    expect(() => store.update('any', 'token')).toThrow(HubSessionScopeError);
    expect(() => store.delete('any')).toThrow(HubSessionScopeError);
    expect(() => store.createLogin({ codeVerifier: 'v', state: 's' })).toThrow(
      HubSessionScopeError,
    );
    expect(() => store.consumeLogin('any')).toThrow(HubSessionScopeError);
  });
});

describe('request transaction phases', () => {
  it('wraps transaction acquisition failure as hydrate unavailable and skips the handler', async () => {
    const cause = new Error('database unavailable');
    const handler = vi.fn();
    const store = storeWithDb({ transaction: vi.fn().mockRejectedValue(cause) });

    await expect(
      store.withRequest({ sessionId: 'session-alpha', consumeLoginTx: false }, handler),
    ).rejects.toMatchObject({
      name: 'HubSessionStoreUnavailableError',
      message: 'hub session hydrate failed',
      cause,
    });
    expect(handler).not.toHaveBeenCalled();
  });

  it('propagates the handler error object unchanged', async () => {
    const handlerError = new Error('handler failed');
    const store = storeWithDb({
      transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn({}),
    });

    await expect(
      store.withRequest({ consumeLoginTx: false }, async () => {
        throw handlerError;
      }),
    ).rejects.toBe(handlerError);
  });

  it('logs and swallows a flush failure after returning the handler value', async () => {
    const flushError = new Error('flush failed');
    const values = vi.fn().mockRejectedValue(flushError);
    const store = storeWithDb({
      transaction: async (fn: (tx: unknown) => Promise<unknown>) =>
        fn({ insert: vi.fn(() => ({ values })) }),
    });
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => {});

    try {
      const result = await store.withRequest({ consumeLoginTx: false }, async () => {
        store.create({ hubRefreshToken: 'token-alpha' });
        return 'formed-response';
      });
      expect(result).toBe('formed-response');
      expect(errorLog).toHaveBeenCalledWith('[hub-session-store] flush failed', flushError);
    } finally {
      errorLog.mockRestore();
    }
  });

  it('logs and swallows a transaction commit failure after returning the handler value', async () => {
    const commitError = new Error('commit failed');
    const store = storeWithDb({
      transaction: async (fn: (tx: unknown) => Promise<unknown>) => {
        await fn({});
        throw commitError;
      },
    });
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => {});

    try {
      const result = await store.withRequest({ consumeLoginTx: false }, async () =>
        'formed-response',
      );
      expect(result).toBe('formed-response');
      expect(errorLog).toHaveBeenCalledWith('[hub-session-store] flush failed', commitError);
    } finally {
      errorLog.mockRestore();
    }
  });
});

describe('cookie names', () => {
  it('mirrors the SDK constants', () => {
    // @fxl-business/hub-sdk@1.2.0 dist/server.js:271-272 -
    // SESSION_COOKIE / SESSION_COOKIE_SECURE. A bump must re-check those lines.
    expect(SESSION_COOKIE).toBe('fxl_hub_session');
    expect(SESSION_COOKIE_SECURE).toBe('__Host-fxl_hub_session');
    expect(hubSessionCookieName(true)).toBe('__Host-fxl_hub_session');
    expect(hubSessionCookieName(false)).toBe('fxl_hub_session');
  });
});

describe('TTLs', () => {
  it('pins the login transaction TTL to the SDK cookie max-age', () => {
    // dist/server.js:275 - LOGIN_TX_MAX_AGE_SECONDS = 600.
    expect(LOGIN_TX_TTL_MS).toBe(600_000);
  });

  it('keeps the session TTL at 30 days', () => {
    expect(SESSION_TTL_MS).toBe(30 * 24 * 60 * 60 * 1000);
  });
});
