import type { HubSessionRecord } from '@fxl-business/hub-sdk';
import { describe, expect, it, vi } from 'vitest';
import type { hubBffSessions } from '../../db/schema.js';
import {
  LOGIN_TX_TTL_MS,
  SESSION_ABSOLUTE_TTL_MS,
  SESSION_TTL_MS,
  createDurableHubSessionStore,
  createHubSessionStore,
} from '../hub-session-store.js';
import { createSessionSealer } from '../session-crypto.js';

const IKM = 'hub-session-store-unit-test-ikm-0123456789';
const DAY_MS = 24 * 60 * 60 * 1000;

function storeWithDb(db: unknown) {
  return createDurableHubSessionStore({
    db: db as never,
    sealer: createSessionSealer(IKM),
  });
}

/**
 * The minimum of drizzle's builder surface that `withSession` touches. No
 * database is needed to pin the failure semantics, which are about WHICH
 * error escapes and whether the operation's value can escape with it, nor the
 * expiry semantics, which are about WHICH columns are read and written.
 *
 * `recorded` is test-only; the store never reads it.
 */
function fakeTx(rows: unknown[] = []) {
  const selectChain = {
    from: () => selectChain,
    where: () => selectChain,
    for: () => selectChain,
    limit: () => Promise.resolve(rows),
  };
  const sets: Record<string, unknown>[] = [];
  const recorded = { sets, deletes: 0 };
  return {
    select: () => selectChain,
    delete: () => {
      recorded.deletes += 1;
      return { where: () => Promise.resolve(undefined) };
    },
    update: () => ({
      set: (values: Record<string, unknown>) => {
        sets.push(values);
        return { where: () => Promise.resolve(undefined) };
      },
    }),
    recorded,
  };
}

/** A `db` whose `transaction` always yields `tx`, and whose inserts are captured. */
function fakeDb(tx: ReturnType<typeof fakeTx>) {
  const inserted: Record<string, unknown>[] = [];
  return {
    inserted,
    db: {
      insert: () => ({
        values: (values: Record<string, unknown>) => {
          inserted.push(values);
          return Promise.resolve(undefined);
        },
      }),
      transaction: async (fn: (handle: unknown) => Promise<unknown>) => fn(tx),
    },
  };
}

const SESSION_ID = 'session-alpha';
/** Frozen clock, so every expiry assertion is an exact equality. */
const FROZEN = new Date('2026-08-07T12:00:00.000Z');
/** What the SDK would compute from its own TTL options and hand to `create`. */
const SDK_SUPPLIED = new Date('2036-08-07T12:00:00.000Z').toISOString();

function sessionRow(overrides: {
  expiresAt: Date;
  absoluteExpiresAt: Date;
}): typeof hubBffSessions.$inferSelect {
  return {
    id: SESSION_ID,
    hubRefreshTokenEnc: createSessionSealer(IKM).seal('token-old', SESSION_ID),
    accountId: null,
    createdAt: new Date(FROZEN.getTime() - DAY_MS),
    updatedAt: new Date(FROZEN.getTime() - DAY_MS),
    ...overrides,
  };
}

function frozenStore(db: unknown) {
  return createDurableHubSessionStore({
    db: db as never,
    sealer: createSessionSealer(IKM),
    now: () => FROZEN,
  });
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

  it('keeps the session TTL at 30 days and caps it with a 90-day absolute TTL', () => {
    // Neither number is the SDK's. dist/server.js:324-325 defaults to a 90-day
    // SLIDING window and a 365-day absolute one; adopting either by inaction
    // would change this product's security posture as a side effect of an SDK
    // bump. Both are passed to createHubBff explicitly - see app-auth.ts.
    expect(SESSION_TTL_MS).toBe(30 * 24 * 60 * 60 * 1000);
    expect(SESSION_ABSOLUTE_TTL_MS).toBe(90 * 24 * 60 * 60 * 1000);
    // Inverting the pair would make the ceiling pre-empt the sliding window and
    // silently cut every session short.
    expect(SESSION_ABSOLUTE_TTL_MS).toBeGreaterThan(SESSION_TTL_MS);
  });
});

describe('absolute session lifetime', () => {
  it('sets the absolute expiry once at create from the store constant, ignoring the value the SDK supplies', async () => {
    const { db, inserted } = fakeDb(fakeTx());

    await frozenStore(db).create({
      hubRefreshToken: 'token-new',
      expiresAt: SDK_SUPPLIED,
      absoluteExpiresAt: SDK_SUPPLIED,
    });

    // Both timestamps are derived from ONE clock read, so they can never be
    // anchored to different milliseconds, and neither honours the SDK's value.
    expect(inserted).toHaveLength(1);
    expect(inserted[0]?.expiresAt).toEqual(new Date(FROZEN.getTime() + SESSION_TTL_MS));
    expect(inserted[0]?.absoluteExpiresAt).toEqual(
      new Date(FROZEN.getTime() + SESSION_ABSOLUTE_TTL_MS),
    );
  });

  it('does not extend the absolute expiry when the SDK spreads the record back into update', async () => {
    // THE CONSTRAINT-2 ORACLE. A rotation must never move the ceiling.
    const row = sessionRow({
      expiresAt: new Date(FROZEN.getTime() + 29 * DAY_MS),
      absoluteExpiresAt: new Date(FROZEN.getTime() + 60 * DAY_MS),
    });
    const tx = fakeTx([row]);
    const { db } = fakeDb(tx);

    let spread: HubSessionRecord | null = null;
    await frozenStore(db).withSession(SESSION_ID, async (handle) => {
      // EXACTLY what dist/server.js:464 does: the record spread back with only
      // hubRefreshToken replaced.
      spread = await handle.get();
      await handle.update({ ...spread!, hubRefreshToken: 'rotated' });
    });

    // Non-vacuity: the hazard exists only because get() really does hand the SDK
    // an absoluteExpiresAt for it to spread straight back in.
    expect(typeof (spread as HubSessionRecord | null)?.absoluteExpiresAt).toBe('string');

    const setArg = tx.recorded.sets[0];
    expect(setArg).toBeDefined();
    // Key ABSENCE, not value equality: writing back the same value would pass a
    // value comparison today and become an extension the moment #now() leaks in.
    expect('absoluteExpiresAt' in setArg!).toBe(false);
    // The other half of the pair still slides, so this cannot pass by writing
    // nothing at all.
    expect(setArg!.expiresAt).toEqual(new Date(FROZEN.getTime() + SESSION_TTL_MS));
  });

  it('deletes the row inside the transaction and reports absent when only the absolute expiry has passed', async () => {
    const row = sessionRow({
      expiresAt: new Date(FROZEN.getTime() + 29 * DAY_MS),
      absoluteExpiresAt: new Date(FROZEN.getTime() - 1_000),
    });
    const tx = fakeTx([row]);
    const { db } = fakeDb(tx);

    let deletesWhenObserved = -1;
    const seen = await frozenStore(db).withSession(SESSION_ID, async (handle) => {
      const record = await handle.get();
      deletesWhenObserved = tx.recorded.deletes;
      return record;
    });

    expect(seen).toBeNull();
    // On the SAME tx handle, and before the operation could observe anything.
    expect(deletesWhenObserved).toBe(1);
  });

  it('deletes the row and reports absent when only the sliding expiry has passed', async () => {
    // The mirror, so a future edit cannot fix the absolute term by breaking this one.
    const row = sessionRow({
      expiresAt: new Date(FROZEN.getTime() - 1_000),
      absoluteExpiresAt: new Date(FROZEN.getTime() + 60 * DAY_MS),
    });
    const tx = fakeTx([row]);
    const { db } = fakeDb(tx);

    let deletesWhenObserved = -1;
    const seen = await frozenStore(db).withSession(SESSION_ID, async (handle) => {
      const record = await handle.get();
      deletesWhenObserved = tx.recorded.deletes;
      return record;
    });

    expect(seen).toBeNull();
    expect(deletesWhenObserved).toBe(1);
  });

  it('reports a live record when neither expiry has passed', async () => {
    // The non-vacuity control for both deletion tests above.
    const row = sessionRow({
      expiresAt: new Date(FROZEN.getTime() + 29 * DAY_MS),
      absoluteExpiresAt: new Date(FROZEN.getTime() + 60 * DAY_MS),
    });
    const tx = fakeTx([row]);
    const { db } = fakeDb(tx);

    const seen = await frozenStore(db).withSession(SESSION_ID, async (handle) => handle.get());

    expect(seen?.hubRefreshToken).toBe('token-old');
    expect(tx.recorded.deletes).toBe(0);
  });

  it('hands the SDK both expiries as ISO strings the SDK can Date.parse', async () => {
    // THE CONSTRAINT-6 ORACLE. Drizzle returns a Date for a timestamptz column,
    // HubSessionRecord types both expiry fields as an ISO string, and the SDK
    // reads them with Date.parse (dist/server.js:424). Date.parse of a Date is
    // NaN, `now() >= NaN` is false, and the SDK's own expiry gate silently stops
    // firing - with no type error anywhere at runtime.
    const expiresAt = new Date(FROZEN.getTime() + 29 * DAY_MS);
    const absoluteExpiresAt = new Date(FROZEN.getTime() + 60 * DAY_MS);
    const { db } = fakeDb(fakeTx([sessionRow({ expiresAt, absoluteExpiresAt })]));

    const record = await frozenStore(db).withSession(SESSION_ID, async (handle) => handle.get());

    expect(typeof record?.expiresAt).toBe('string');
    expect(typeof record?.absoluteExpiresAt).toBe('string');
    expect(Number.isFinite(Date.parse(record!.absoluteExpiresAt!))).toBe(true);
    expect(Date.parse(record!.absoluteExpiresAt!)).toBe(absoluteExpiresAt.getTime());
    expect(Date.parse(record!.expiresAt!)).toBe(expiresAt.getTime());
  });
});
