/**
 * Durable Hub BFF session store, integration coverage.
 *
 * Two oracles live here, and neither is CRUD.
 *
 * 1. RESTART SURVIVAL. Two INDEPENDENT store instances over the same Postgres
 *    database are exactly what an API restart, or a second replica, is. The
 *    SDK's InMemoryHubSessionStore - the default this store replaces - provably
 *    cannot satisfy the same assertion, and that control is asserted inline so
 *    the oracle can never pass vacuously.
 * 2. SERIALIZATION. `withSession` takes `SELECT ... FOR UPDATE` on the session
 *    row before the operation runs and holds it to commit, so two concurrent
 *    refreshes on one id cannot lose a rotation. Deleting the `.for('update')`
 *    turns `bSaw` from 'token-a' back into 'token-old'.
 *
 * Run: pnpm --filter @fxl-sales/api test:integration
 */
import { randomUUID } from 'node:crypto';
import { InMemoryHubSessionStore, type HubSessionStore } from '@fxl-business/hub-sdk';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  createDurableHubSessionStore,
  deleteExpiredHubBffSessions,
} from '../../src/auth/hub-session-store.js';
import { createSessionSealer } from '../../src/auth/session-crypto.js';
import * as schema from '../../src/db/schema.js';

const APP_DB_URL =
  process.env.TEST_DATABASE_URL ??
  process.env.DATABASE_URL ??
  'postgresql://postgres:postgres@localhost:5006/fxl_sales';
const ADMIN_DB_URL = process.env.ADMIN_DATABASE_URL ?? APP_DB_URL;
const ADMIN_CONNECTION_OPTIONS = { connection: { 'app.fxl_admin': 'true' } } as const;

const IKM = 'hub-bff-session-store-test-ikm-0123456789';
const OTHER_IKM = 'a-completely-different-key-0123456789abcd';

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe('durable Hub BFF session store', () => {
  let appClient: postgres.Sql;
  let adminClient: postgres.Sql;
  let adminDb: ReturnType<typeof drizzle<typeof schema>>;
  const sessionIds: string[] = [];
  const loginTxIds: string[] = [];

  /** A fresh store object over the same connection == a restarted process. */
  function newStore(now?: () => Date): HubSessionStore {
    return createDurableHubSessionStore({
      db: adminDb,
      sealer: createSessionSealer(IKM),
      ...(now ? { now } : {}),
    });
  }

  function trackSession(id: string): string {
    sessionIds.push(id);
    return id;
  }

  function trackLogin(id: string): string {
    loginTxIds.push(id);
    return id;
  }

  /** Reads a session through a fresh store instance, outside any lock. */
  async function readToken(store: HubSessionStore, sessionId: string) {
    return store.withSession(sessionId, async (tx) => (await tx.get())?.hubRefreshToken ?? null);
  }

  beforeAll(() => {
    appClient = postgres(APP_DB_URL, { max: 5 });
    // max: 8 so the concurrency tests below can hold two transactions open and
    // still have connections left for the assertions running beside them.
    adminClient = postgres(ADMIN_DB_URL, { max: 8, ...ADMIN_CONNECTION_OPTIONS });
    adminDb = drizzle(adminClient, { schema });
  });

  afterAll(async () => {
    for (const id of sessionIds) {
      await adminClient`DELETE FROM hub_bff_sessions WHERE id = ${id}`;
    }
    for (const id of loginTxIds) {
      await adminClient`DELETE FROM hub_bff_login_txns WHERE id = ${id}`;
    }
    await appClient.end();
    await adminClient.end();
  });

  it('resolves a session created by another store instance, which the in-memory default cannot', async () => {
    const storeA = newStore();
    const storeB = newStore();

    const sid = trackSession(await storeA.create({ hubRefreshToken: 'refresh-token-alpha' }));

    expect(await readToken(storeB, sid)).toBe('refresh-token-alpha');

    // Non-vacuity: the SDK default fails this exact assertion.
    const memA = new InMemoryHubSessionStore();
    const memSid = await memA.create({ hubRefreshToken: 'refresh-token-alpha' });
    const memB = new InMemoryHubSessionStore(); // the "restarted process"
    expect(memB.get(memSid)).toBeNull();
    // memA proves memB's null is about the RESTART, not about a broken create.
    expect(memA.get(memSid)).not.toBeNull();
  });

  it('carries a rotated refresh token across store instances', async () => {
    const storeA = newStore();
    const storeB = newStore();
    const storeC = newStore();

    const sid = trackSession(await storeA.create({ hubRefreshToken: 'refresh-token-alpha' }));

    await storeB.withSession(sid, async (tx) => {
      const record = await tx.get();
      expect(record?.hubRefreshToken).toBe('refresh-token-alpha');
      await tx.update({ ...record!, hubRefreshToken: 'refresh-token-beta' });
    });

    expect(await readToken(storeC, sid)).toBe('refresh-token-beta');
  });

  it('serializes two concurrent refreshes on one session id so no rotation is lost', async () => {
    const storeA = newStore();
    const storeB = newStore();
    const finalStore = newStore();
    const sessionId = trackSession(await storeA.create({ hubRefreshToken: 'token-old' }));

    const aHoldsLock = deferred<void>();
    const releaseA = deferred<void>();
    const bEntered = deferred<void>();
    const releaseB = deferred<void>();

    let aSaw: string | null | undefined;
    let bSaw: string | null | undefined;

    const started: Promise<unknown>[] = [];
    try {
      const aPromise = storeA.withSession(sessionId, async (tx) => {
        aSaw = (await tx.get())?.hubRefreshToken ?? null;
        aHoldsLock.resolve();
        await releaseA.promise;
        await tx.update({ hubRefreshToken: 'token-a' });
      });
      started.push(aPromise);
      await aHoldsLock.promise;

      const bPromise = storeB.withSession(sessionId, async (tx) => {
        bEntered.resolve();
        bSaw = (await tx.get())?.hubRefreshToken ?? null;
        await releaseB.promise;
        await tx.update({ hubRefreshToken: 'token-b' });
      });
      started.push(bPromise);

      // B must not get past the row lock while A holds it. The deferred proves
      // B's callback body never ran, not merely that its promise had not settled.
      const bWhileLocked = await Promise.race([
        bEntered.promise.then(() => 'entered' as const),
        delay(1_000).then(() => 'blocked' as const),
      ]);

      releaseA.resolve();
      await aPromise;
      releaseB.resolve();
      await bPromise;

      expect({ aSaw, bWhileLocked, bSaw, final: await readToken(finalStore, sessionId) }).toEqual({
        aSaw: 'token-old',
        bWhileLocked: 'blocked',
        // The non-vacuity check: without `.for('update')` this reads 'token-old'.
        bSaw: 'token-a',
        final: 'token-b',
      });
    } finally {
      releaseA.resolve();
      releaseB.resolve();
      await Promise.allSettled(started);
    }
  });

  it('does not block a different session id while one row lock is held', async () => {
    const storeA = newStore();
    const storeB = newStore();
    const lockedId = trackSession(await storeA.create({ hubRefreshToken: 'token-locked' }));
    const otherId = trackSession(await storeA.create({ hubRefreshToken: 'token-other' }));

    const aHoldsLock = deferred<void>();
    const releaseA = deferred<void>();

    const started: Promise<unknown>[] = [];
    try {
      const aPromise = storeA.withSession(lockedId, async (tx) => {
        await tx.get();
        aHoldsLock.resolve();
        await releaseA.promise;
      });
      started.push(aPromise);
      await aHoldsLock.promise;

      const otherPromise = readToken(storeB, otherId);
      started.push(otherPromise);
      const otherWhileLocked = await Promise.race([
        otherPromise,
        delay(1_000).then(() => 'blocked' as const),
      ]);

      expect(otherWhileLocked).toBe('token-other');
    } finally {
      releaseA.resolve();
      await Promise.allSettled(started);
    }
  });

  it('rolls back the update and rejects when the operation fails after writing', async () => {
    const creator = newStore();
    const failingStore = newStore();
    const finalStore = newStore();
    const sessionId = trackSession(await creator.create({ hubRefreshToken: 'token-old' }));
    const operationError = new Error('operation failed');
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => {});

    try {
      await expect(
        failingStore.withSession(sessionId, async (tx) => {
          await tx.update({ hubRefreshToken: 'token-never-committed' });
          throw operationError;
        }),
      ).rejects.toMatchObject({
        name: 'HubSessionStoreUnavailableError',
        cause: operationError,
      });
    } finally {
      errorLog.mockRestore();
    }

    expect(await readToken(finalStore, sessionId)).toBe('token-old');
  });

  it('treats an expired session as absent and deletes the row inside the transaction', async () => {
    const storeA = newStore();
    const sid = trackSession(await storeA.create({ hubRefreshToken: 'refresh-token-alpha' }));

    // 400 days on: past the 30-day session TTL.
    const future = new Date(Date.now() + 400 * 24 * 60 * 60 * 1000);
    const futureStore = newStore(() => future);

    expect(await readToken(futureStore, sid)).toBeNull();
    // 1.3.0 deletes rather than leaving the row for the sweeper, per MIGRATION.md.
    expect(await adminClient`SELECT id FROM hub_bff_sessions WHERE id = ${sid}`).toHaveLength(0);
  });

  it('slides expires_at on update instead of persisting the expiresAt the SDK hands back', async () => {
    const storeA = newStore();
    const sid = trackSession(await storeA.create({ hubRefreshToken: 'token-old' }));
    const readExpiresAt = async (): Promise<number> => {
      const [row] = await adminClient<{ expires_at: string | Date }[]>`
        SELECT expires_at FROM hub_bff_sessions WHERE id = ${sid}
      `;
      return new Date(row!.expires_at).getTime();
    };
    const before = await readExpiresAt();

    // A day on, so the slide is measurable without waiting.
    const later = new Date(Date.now() + 24 * 60 * 60 * 1000);
    const laterStore = newStore(() => later);
    await laterStore.withSession(sid, async (tx) => {
      const record = await tx.get();
      // EXACTLY what dist/server.js:464 does - the record spread back with only
      // hubRefreshToken replaced, expiresAt untouched.
      await tx.update({ ...record!, hubRefreshToken: 'token-new' });
    });

    // Honouring record.expiresAt would leave this equal and silently turn the
    // sliding TTL into a hard 30-day cap.
    expect(await readExpiresAt()).toBeGreaterThan(before);
  });

  it('treats a session past only its absolute expiry as absent and deletes the row inside the transaction', async () => {
    const sid = trackSession(`abs_${randomUUID()}`);
    // The sliding window is 29 days from now, so ONLY the ceiling has passed.
    // This is the row the whole slice exists to kill: an attacker refreshing a
    // stolen session id keeps expires_at permanently in the future.
    await adminClient`
      INSERT INTO hub_bff_sessions (id, hub_refresh_token_enc, expires_at, absolute_expires_at)
      VALUES (${sid}, 'v1.a.b.c', now() + interval '29 days', now() - interval '1 second')
    `;

    expect(await readToken(newStore(), sid)).toBeNull();
    expect(await adminClient`SELECT id FROM hub_bff_sessions WHERE id = ${sid}`).toHaveLength(0);
  });

  it('does not move absolute_expires_at when a rotation slides expires_at', async () => {
    const storeA = newStore();
    const sid = trackSession(await storeA.create({ hubRefreshToken: 'token-old' }));
    const readExpiries = async (): Promise<{ sliding: number; absolute: string }> => {
      const [row] = await adminClient<{ expires_at: string | Date; absolute_expires_at: string }[]>`
        SELECT expires_at, absolute_expires_at FROM hub_bff_sessions WHERE id = ${sid}
      `;
      // The absolute value is compared as the RAW column text, so a rewrite that
      // happens to land on the same millisecond is still caught.
      return { sliding: new Date(row!.expires_at).getTime(), absolute: String(row!.absolute_expires_at) };
    };
    const before = await readExpiries();

    const later = new Date(Date.now() + 24 * 60 * 60 * 1000);
    await newStore(() => later).withSession(sid, async (tx) => {
      const record = await tx.get();
      // dist/server.js:464 verbatim - the record spread back with only
      // hubRefreshToken replaced, BOTH expiries untouched by the SDK.
      await tx.update({ ...record!, hubRefreshToken: 'token-new' });
    });

    const after = await readExpiries();
    expect(after.sliding).toBeGreaterThan(before.sliding);
    // Persisting record.absoluteExpiresAt would move this and restore the
    // immortal active session.
    expect(after.absolute).toBe(before.absolute);
  });

  it('never stores the Hub refresh token in plaintext', async () => {
    const storeA = newStore();
    const sid = trackSession(await storeA.create({ hubRefreshToken: 'refresh-token-alpha' }));

    const [row] = await adminClient<{ hub_refresh_token_enc: string }[]>`
      SELECT hub_refresh_token_enc FROM hub_bff_sessions WHERE id = ${sid}
    `;
    expect(row?.hub_refresh_token_enc).toBeDefined();
    expect(row?.hub_refresh_token_enc).not.toContain('refresh-token-alpha');
    expect(row?.hub_refresh_token_enc.startsWith('v1.')).toBe(true);

    // A sealer built from a different key resolves the same row to nothing, and
    // deliberately LEAVES the row: a wrong key costs one re-login, never data.
    const foreign = createDurableHubSessionStore({
      db: adminDb,
      sealer: createSessionSealer(OTHER_IKM),
    });
    expect(await readToken(foreign, sid)).toBeNull();
    expect(await adminClient`SELECT id FROM hub_bff_sessions WHERE id = ${sid}`).toHaveLength(1);
  });

  it('consumes a login transaction exactly once across instances', async () => {
    const storeA = newStore();
    const storeB = newStore();
    const storeC = newStore();

    const state = `state-${randomUUID()}`;
    const txId = trackLogin(
      await storeA.createLoginTransaction({ codeVerifier: 'verifier-alpha', state }),
    );

    const consumed = await storeB.consumeLoginTransaction(txId);
    expect(consumed).toMatchObject({ codeVerifier: 'verifier-alpha', state });

    expect(await storeC.consumeLoginTransaction(txId)).toBeNull();
    expect(await adminClient`SELECT id FROM hub_bff_login_txns WHERE id = ${txId}`).toHaveLength(0);
  });

  it('deletes an expired login transaction on consume and returns null', async () => {
    const storeA = newStore();
    const state = `state-${randomUUID()}`;
    const txId = trackLogin(
      await storeA.createLoginTransaction({ codeVerifier: 'verifier-alpha', state }),
    );

    const future = new Date(Date.now() + 60 * 60 * 1000);
    const futureStore = newStore(() => future);
    expect(await futureStore.consumeLoginTransaction(txId)).toBeNull();
    // The row is gone either way, so a replayed callback cannot retry a stale
    // verifier even if the sweeper has not run.
    expect(await adminClient`SELECT id FROM hub_bff_login_txns WHERE id = ${txId}`).toHaveLength(0);
  });

  it('is invisible to the ordinary tenant connection', async () => {
    const storeA = newStore();
    const sid = trackSession(await storeA.create({ hubRefreshToken: 'refresh-token-alpha' }));

    // Positive control: the admin context sees it.
    expect(await adminClient`SELECT id FROM hub_bff_sessions WHERE id = ${sid}`).toHaveLength(1);

    // The ordinary tenant connection never sets app.fxl_admin, so the whole
    // table reads as empty and refuses writes.
    const visible = await appClient<{ count: string }[]>`SELECT count(*) FROM hub_bff_sessions`;
    expect(Number(visible[0]?.count)).toBe(0);
    expect(await appClient`SELECT id FROM hub_bff_sessions WHERE id = ${sid}`).toHaveLength(0);

    const smuggledId = `smuggled_${randomUUID()}`;
    await expect(
      appClient`
        INSERT INTO hub_bff_sessions (id, hub_refresh_token_enc, expires_at, absolute_expires_at)
        VALUES (${smuggledId}, 'v1.x.y.z', now() + interval '1 day', now() + interval '90 days')
      `,
    ).rejects.toThrow();
  });

  it('removes rows expired by either timestamp and keeps a row expired by neither', async () => {
    const liveSid = trackSession(`live_${randomUUID()}`);
    const deadSid = trackSession(`dead_${randomUUID()}`);
    const cappedSid = trackSession(`capped_${randomUUID()}`);
    const liveTx = trackLogin(`live_${randomUUID()}`);
    const deadTx = trackLogin(`dead_${randomUUID()}`);

    await adminClient`
      INSERT INTO hub_bff_sessions (id, hub_refresh_token_enc, expires_at, absolute_expires_at) VALUES
        (${liveSid}, 'v1.a.b.c', now() + interval '1 day', now() + interval '90 days'),
        (${deadSid}, 'v1.a.b.c', now() - interval '1 day', now() + interval '90 days'),
        (${cappedSid}, 'v1.a.b.c', now() + interval '29 days', now() - interval '1 second')
    `;
    await adminClient`
      INSERT INTO hub_bff_login_txns (id, code_verifier_enc, state, expires_at) VALUES
        (${liveTx}, 'v1.a.b.c', 'state-live', now() + interval '1 day'),
        (${deadTx}, 'v1.a.b.c', 'state-dead', now() - interval '1 day')
    `;

    const removed = await deleteExpiredHubBffSessions(adminDb);
    expect(removed.sessions).toBeGreaterThanOrEqual(2);
    expect(removed.loginTxns).toBeGreaterThanOrEqual(1);

    expect(await adminClient`SELECT id FROM hub_bff_sessions WHERE id = ${deadSid}`).toHaveLength(0);
    // The non-vacuity row: drop the `or(...)` term from the sweep and this one
    // survives while every other assertion in this test still passes.
    expect(await adminClient`SELECT id FROM hub_bff_sessions WHERE id = ${cappedSid}`).toHaveLength(
      0,
    );
    expect(await adminClient`SELECT id FROM hub_bff_sessions WHERE id = ${liveSid}`).toHaveLength(1);
    expect(await adminClient`SELECT id FROM hub_bff_login_txns WHERE id = ${deadTx}`).toHaveLength(
      0,
    );
    expect(await adminClient`SELECT id FROM hub_bff_login_txns WHERE id = ${liveTx}`).toHaveLength(
      1,
    );
  });
});
