import { describe, expect, it, vi } from 'vitest';
import {
  LOGIN_TX_TTL_MS,
  SESSION_TTL_MS,
  createDurableHubSessionStore,
  createHubSessionStore,
} from '../hub-session-store.js';
import { createSessionSealer } from '../session-crypto.js';

const IKM = 'hub-session-store-unit-test-ikm-0123456789';

function storeWithDb(db: unknown) {
  return createDurableHubSessionStore({
    db: db as never,
    sealer: createSessionSealer(IKM),
  });
}

/**
 * The minimum of drizzle's builder surface that `withSession` touches. No
 * database is needed to pin the failure semantics, which are about WHICH
 * error escapes and whether the operation's value can escape with it.
 */
function fakeTx(rows: unknown[] = []) {
  const selectChain = {
    from: () => selectChain,
    where: () => selectChain,
    for: () => selectChain,
    limit: () => Promise.resolve(rows),
  };
  return {
    select: () => selectChain,
    delete: () => ({ where: () => Promise.resolve(undefined) }),
    update: () => ({ set: () => ({ where: () => Promise.resolve(undefined) }) }),
  };
}

/** Distinguishes "rejected" from "resolved with the operation's value". */
async function settle<T>(
  promise: Promise<T>,
): Promise<{ resolved: T } | { rejected: unknown }> {
  return promise.then(
    (value) => ({ resolved: value }),
    (error: unknown) => ({ rejected: error }),
  );
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

describe('withSession failure semantics', () => {
  it('rejects with HubSessionStoreUnavailableError when the commit fails, and never resolves the operation value', async () => {
    // THE CONSTRAINT-3 ORACLE. The pre-1.3.0 store captured the handler's value
    // and returned it from the catch, so a rolled-back transaction read as
    // success: the Hub had rotated RT1 to RT2 while Postgres still held RT1.
    // This goes red again the moment a `return handlerResult.value` comes back.
    const commitError = new Error('commit failed');
    const store = storeWithDb({
      transaction: async (fn: (tx: unknown) => Promise<unknown>) => {
        await fn(fakeTx());
        throw commitError;
      },
    });
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => {});

    try {
      const outcome = await settle(store.withSession('session-alpha', async () => 'formed-response'));

      expect(outcome).not.toHaveProperty('resolved');
      expect(outcome).toMatchObject({
        rejected: {
          name: 'HubSessionStoreUnavailableError',
          message: 'hub session transaction failed',
          cause: commitError,
        },
      });
    } finally {
      errorLog.mockRestore();
    }
  });

  it('rejects with HubSessionStoreUnavailableError when the row lock cannot be taken, and never runs the operation', async () => {
    const cause = new Error('database unavailable');
    const operation = vi.fn();
    const store = storeWithDb({ transaction: vi.fn().mockRejectedValue(cause) });
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => {});

    try {
      await expect(store.withSession('session-alpha', operation)).rejects.toMatchObject({
        name: 'HubSessionStoreUnavailableError',
        message: 'hub session transaction failed',
        cause,
      });
      expect(operation).not.toHaveBeenCalled();
    } finally {
      errorLog.mockRestore();
    }
  });

  it('rejects with HubSessionStoreUnavailableError when the operation itself throws', async () => {
    // One rule, no phase tracking. A later "let handler errors through" refactor
    // has to change this assertion, which makes it a conscious decision.
    const operationError = new Error('operation failed');
    const store = storeWithDb({
      transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn(fakeTx()),
    });
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => {});

    try {
      await expect(
        store.withSession('session-alpha', async () => {
          throw operationError;
        }),
      ).rejects.toMatchObject({
        name: 'HubSessionStoreUnavailableError',
        message: 'hub session transaction failed',
        cause: operationError,
      });
    } finally {
      errorLog.mockRestore();
    }
  });
});

describe('TTLs', () => {
  it('pins the login transaction TTL to the SDK cookie max-age', () => {
    // @fxl-business/hub-sdk@1.3.0 dist/server.js:279 - LOGIN_TX_MAX_AGE_SECONDS = 600.
    expect(LOGIN_TX_TTL_MS).toBe(600_000);
  });

  it('keeps the session TTL at 30 days', () => {
    expect(SESSION_TTL_MS).toBe(30 * 24 * 60 * 60 * 1000);
  });
});
