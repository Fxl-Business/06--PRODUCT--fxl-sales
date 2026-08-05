/**
 * Slice 01 (durable Hub BFF session store) integration coverage.
 *
 * The oracle here is NOT CRUD: it is restart survival. Two INDEPENDENT store
 * instances over the same Postgres database are exactly what an API restart, or
 * a second replica, is. The SDK's InMemoryHubSessionStore - the default this
 * slice replaces - provably cannot satisfy the same assertion, and that control
 * is asserted inline so the oracle can never pass vacuously.
 *
 * Run: pnpm --filter @fxl-sales/api test:integration
 */
import { randomUUID } from 'node:crypto';
import { InMemoryHubSessionStore } from '@fxl-business/hub-sdk';
import { drizzle } from 'drizzle-orm/postgres-js';
import { Hono } from 'hono';
import { deleteCookie } from 'hono/cookie';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createHubSessionScopeMiddleware } from '../../src/auth/hub-session-scope.js';
import {
  type DurableHubSessionStore,
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
  function newStore(now?: () => Date): DurableHubSessionStore {
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

  beforeAll(() => {
    appClient = postgres(APP_DB_URL, { max: 5 });
    adminClient = postgres(ADMIN_DB_URL, { max: 5, ...ADMIN_CONNECTION_OPTIONS });
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

    const sid = trackSession(
      await storeA.withRequest({ consumeLoginTx: false }, async () =>
        storeA.create({ hubRefreshToken: 'refresh-token-alpha' }),
      ),
    );

    const resolved = await storeB.withRequest({ sessionId: sid, consumeLoginTx: false }, async () =>
      storeB.get(sid),
    );
    expect(resolved).toEqual({ hubRefreshToken: 'refresh-token-alpha' });

    // Non-vacuity: the SDK default fails this exact assertion.
    const memA = new InMemoryHubSessionStore();
    const memSid = memA.create({ hubRefreshToken: 'refresh-token-alpha' });
    const memB = new InMemoryHubSessionStore(); // the "restarted process"
    expect(memB.get(memSid)).toBeNull();
    // memA proves memB's null is about the RESTART, not about a broken create.
    expect(memA.get(memSid)).not.toBeNull();
  });

  it('carries a rotated refresh token across store instances', async () => {
    const storeA = newStore();
    const storeB = newStore();
    const storeC = newStore();

    const sid = trackSession(
      await storeA.withRequest({ consumeLoginTx: false }, async () =>
        storeA.create({ hubRefreshToken: 'refresh-token-alpha' }),
      ),
    );

    await storeB.withRequest({ sessionId: sid, consumeLoginTx: false }, async () => {
      expect(storeB.get(sid)).toEqual({ hubRefreshToken: 'refresh-token-alpha' });
      storeB.update(sid, 'refresh-token-beta');
    });

    const resolved = await storeC.withRequest({ sessionId: sid, consumeLoginTx: false }, async () =>
      storeC.get(sid),
    );
    expect(resolved).toEqual({ hubRefreshToken: 'refresh-token-beta' });
  });

  it('serializes a stale refresh rejection behind a committed token rotation across replicas', async () => {
    const storeA = newStore();
    const storeB = newStore();
    const finalStore = newStore();
    const sessionId = trackSession(
      await storeA.withRequest({ consumeLoginTx: false }, async () =>
        storeA.create({ hubRefreshToken: 'token-old' }),
      ),
    );
    const otherSessionId = trackSession(
      await storeA.withRequest({ consumeLoginTx: false }, async () =>
        storeA.create({ hubRefreshToken: 'token-other' }),
      ),
    );

    const rotationEntered = deferred<void>();
    const releaseRotation = deferred<void>();
    const staleTokenObserved = deferred<void>();
    const releaseStaleDelete = deferred<void>();

    const rotatingApp = new Hono();
    rotatingApp.use(
      '/auth/*',
      createHubSessionScopeMiddleware(storeA, { secureCookies: false }),
    );
    rotatingApp.post('/auth/refresh', async (c) => {
      expect(storeA.get(sessionId)).toEqual({ hubRefreshToken: 'token-old' });
      rotationEntered.resolve();
      await releaseRotation.promise;
      storeA.update(sessionId, 'token-new');
      return c.json({ ok: true });
    });

    const competingApp = new Hono();
    competingApp.use(
      '/auth/*',
      createHubSessionScopeMiddleware(storeB, { secureCookies: false }),
    );
    competingApp.post('/auth/refresh', async (c) => {
      const session = storeB.get(sessionId);
      if (session?.hubRefreshToken === 'token-old') {
        staleTokenObserved.resolve();
        await releaseStaleDelete.promise;
        storeB.delete(sessionId);
        deleteCookie(c, 'fxl_hub_session', { path: '/' });
        return c.json({ error: 'session_expired' }, 401);
      }
      expect(session).toEqual({ hubRefreshToken: 'token-new' });
      return c.json({ ok: true });
    });

    const startedRequests: Promise<unknown>[] = [];
    try {
      const firstResponsePromise = rotatingApp.request('http://localhost/auth/refresh', {
        method: 'POST',
        headers: { cookie: `fxl_hub_session=${sessionId}` },
      });
      startedRequests.push(firstResponsePromise);
      await rotationEntered.promise;

      const secondResponsePromise = competingApp.request('http://localhost/auth/refresh', {
        method: 'POST',
        headers: { cookie: `fxl_hub_session=${sessionId}` },
      });
      startedRequests.push(secondResponsePromise);
      const otherSessionPromise = storeB.withRequest(
        { sessionId: otherSessionId, consumeLoginTx: false },
        async () => storeB.get(otherSessionId),
      );
      startedRequests.push(otherSessionPromise);

      const otherWhileLocked = await Promise.race([
        otherSessionPromise,
        delay(1_000).then(() => 'blocked' as const),
      ]);
      const staleBeforeRelease = await Promise.race([
        staleTokenObserved.promise.then(() => true),
        delay(1_000).then(() => false),
      ]);

      releaseRotation.resolve();
      const firstResponse = await firstResponsePromise;
      releaseStaleDelete.resolve();
      const secondResponse = await secondResponsePromise;
      const finalSession = await finalStore.withRequest(
        { sessionId, consumeLoginTx: false },
        async () => finalStore.get(sessionId),
      );

      expect({
        firstStatus: firstResponse.status,
        secondStatus: secondResponse.status,
        secondClearedCookie: secondResponse.headers.get('set-cookie') !== null,
        staleBeforeRelease,
        otherWhileLocked,
        finalSession,
      }).toEqual({
        firstStatus: 200,
        secondStatus: 200,
        secondClearedCookie: false,
        staleBeforeRelease: false,
        otherWhileLocked: { hubRefreshToken: 'token-other' },
        finalSession: { hubRefreshToken: 'token-new' },
      });
    } finally {
      releaseRotation.resolve();
      releaseStaleDelete.resolve();
      await Promise.allSettled(startedRequests);
    }
  });

  it('rolls back every buffered mutation when persistence fails after the handler returns', async () => {
    const store = newStore();
    let createdSessionId = '';
    let conflictingLoginId = '';
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => {});

    try {
      const result = await store.withRequest({ consumeLoginTx: false }, async () => {
        createdSessionId = trackSession(store.create({ hubRefreshToken: 'token-rollback' }));
        conflictingLoginId = trackLogin(
          store.createLogin({ codeVerifier: 'verifier-rollback', state: 'state-rollback' }),
        );
        await adminClient`
          INSERT INTO hub_bff_login_txns (id, code_verifier_enc, state, expires_at)
          VALUES (${conflictingLoginId}, 'v1.a.b.c', 'conflict', now() + interval '10 minutes')
        `;
        return 'formed-response';
      });

      expect(result).toBe('formed-response');
      expect(errorLog).toHaveBeenCalledWith('[hub-session-store] flush failed', expect.anything());
      expect(
        await adminClient`SELECT id FROM hub_bff_sessions WHERE id = ${createdSessionId}`,
      ).toHaveLength(0);
      expect(
        await adminClient`SELECT id FROM hub_bff_login_txns WHERE id = ${conflictingLoginId}`,
      ).toHaveLength(1);
    } finally {
      errorLog.mockRestore();
    }
  });

  it('propagates handler failure and leaves the durable token unchanged', async () => {
    const creator = newStore();
    const failingStore = newStore();
    const finalStore = newStore();
    const sessionId = trackSession(
      await creator.withRequest({ consumeLoginTx: false }, async () =>
        creator.create({ hubRefreshToken: 'token-old' }),
      ),
    );
    const handlerError = new Error('handler failed');

    await expect(
      failingStore.withRequest({ sessionId, consumeLoginTx: false }, async () => {
        failingStore.update(sessionId, 'token-never-committed');
        throw handlerError;
      }),
    ).rejects.toBe(handlerError);

    const finalSession = await finalStore.withRequest(
      { sessionId, consumeLoginTx: false },
      async () => finalStore.get(sessionId),
    );
    expect(finalSession).toEqual({ hubRefreshToken: 'token-old' });
  });

  it('never stores the Hub refresh token in plaintext', async () => {
    const storeA = newStore();
    const sid = trackSession(
      await storeA.withRequest({ consumeLoginTx: false }, async () =>
        storeA.create({ hubRefreshToken: 'refresh-token-alpha' }),
      ),
    );

    const [row] = await adminClient<{ hub_refresh_token_enc: string }[]>`
      SELECT hub_refresh_token_enc FROM hub_bff_sessions WHERE id = ${sid}
    `;
    expect(row?.hub_refresh_token_enc).toBeDefined();
    expect(row?.hub_refresh_token_enc).not.toContain('refresh-token-alpha');
    expect(row?.hub_refresh_token_enc.startsWith('v1.')).toBe(true);

    // A sealer built from a different key resolves the same row to nothing.
    const foreign = createDurableHubSessionStore({
      db: adminDb,
      sealer: createSessionSealer(OTHER_IKM),
    });
    const resolved = await foreign.withRequest(
      { sessionId: sid, consumeLoginTx: false },
      async () => foreign.get(sid),
    );
    expect(resolved).toBeNull();
  });

  it('consumes a login transaction exactly once across instances', async () => {
    const storeA = newStore();
    const storeB = newStore();
    const storeC = newStore();

    const state = `state-${randomUUID()}`;
    const txId = trackLogin(
      await storeA.withRequest({ consumeLoginTx: false }, async () =>
        storeA.createLogin({ codeVerifier: 'verifier-alpha', state }),
      ),
    );

    const consumed = await storeB.withRequest(
      { loginTxId: txId, consumeLoginTx: true },
      async () => storeB.consumeLogin(txId),
    );
    expect(consumed).toEqual({ codeVerifier: 'verifier-alpha', state });

    const again = await storeC.withRequest({ loginTxId: txId, consumeLoginTx: true }, async () =>
      storeC.consumeLogin(txId),
    );
    expect(again).toBeNull();

    const rows = await adminClient`SELECT id FROM hub_bff_login_txns WHERE id = ${txId}`;
    expect(rows).toHaveLength(0);
  });

  it('does not touch the login transaction on a non-callback request', async () => {
    const storeA = newStore();
    const storeB = newStore();
    const storeC = newStore();

    const state = `state-${randomUUID()}`;
    const txId = trackLogin(
      await storeA.withRequest({ consumeLoginTx: false }, async () =>
        storeA.createLogin({ codeVerifier: 'verifier-alpha', state }),
      ),
    );

    // A /auth/refresh-shaped request carries the cookie but must not consume it.
    await storeB.withRequest({ loginTxId: txId, consumeLoginTx: false }, async () => {
      expect(storeB.consumeLogin(txId)).toBeNull();
    });

    const consumed = await storeC.withRequest(
      { loginTxId: txId, consumeLoginTx: true },
      async () => storeC.consumeLogin(txId),
    );
    expect(consumed).toEqual({ codeVerifier: 'verifier-alpha', state });
  });

  it('refuses an expired session and an expired login transaction', async () => {
    const storeA = newStore();
    const state = `state-${randomUUID()}`;
    const sid = trackSession(
      await storeA.withRequest({ consumeLoginTx: false }, async () =>
        storeA.create({ hubRefreshToken: 'refresh-token-alpha' }),
      ),
    );
    const txId = trackLogin(
      await storeA.withRequest({ consumeLoginTx: false }, async () =>
        storeA.createLogin({ codeVerifier: 'verifier-alpha', state }),
      ),
    );

    // 400 days on: past both the 30-day session TTL and the 10-minute login TTL.
    const future = new Date(Date.now() + 400 * 24 * 60 * 60 * 1000);
    const futureStore = newStore(() => future);

    const resolved = await futureStore.withRequest(
      { sessionId: sid, loginTxId: txId, consumeLoginTx: true },
      async () => ({ session: futureStore.get(sid), login: futureStore.consumeLogin(txId) }),
    );
    expect(resolved.session).toBeNull();
    expect(resolved.login).toBeNull();

    // Expiry is enforced on READ - the rows are still sitting in the table.
    expect(await adminClient`SELECT id FROM hub_bff_sessions WHERE id = ${sid}`).toHaveLength(1);
    expect(await adminClient`SELECT id FROM hub_bff_login_txns WHERE id = ${txId}`).toHaveLength(1);
  });

  it('is invisible to the ordinary tenant connection', async () => {
    const storeA = newStore();
    const sid = trackSession(
      await storeA.withRequest({ consumeLoginTx: false }, async () =>
        storeA.create({ hubRefreshToken: 'refresh-token-alpha' }),
      ),
    );

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
        INSERT INTO hub_bff_sessions (id, hub_refresh_token_enc, expires_at)
        VALUES (${smuggledId}, 'v1.x.y.z', now() + interval '1 day')
      `,
    ).rejects.toThrow();
  });

  it('removes only expired rows', async () => {
    const liveSid = trackSession(`live_${randomUUID()}`);
    const deadSid = trackSession(`dead_${randomUUID()}`);
    const liveTx = trackLogin(`live_${randomUUID()}`);
    const deadTx = trackLogin(`dead_${randomUUID()}`);

    await adminClient`
      INSERT INTO hub_bff_sessions (id, hub_refresh_token_enc, expires_at) VALUES
        (${liveSid}, 'v1.a.b.c', now() + interval '1 day'),
        (${deadSid}, 'v1.a.b.c', now() - interval '1 day')
    `;
    await adminClient`
      INSERT INTO hub_bff_login_txns (id, code_verifier_enc, state, expires_at) VALUES
        (${liveTx}, 'v1.a.b.c', 'state-live', now() + interval '1 day'),
        (${deadTx}, 'v1.a.b.c', 'state-dead', now() - interval '1 day')
    `;

    const removed = await deleteExpiredHubBffSessions(adminDb);
    expect(removed.sessions).toBeGreaterThanOrEqual(1);
    expect(removed.loginTxns).toBeGreaterThanOrEqual(1);

    expect(await adminClient`SELECT id FROM hub_bff_sessions WHERE id = ${deadSid}`).toHaveLength(0);
    expect(await adminClient`SELECT id FROM hub_bff_sessions WHERE id = ${liveSid}`).toHaveLength(1);
    expect(await adminClient`SELECT id FROM hub_bff_login_txns WHERE id = ${deadTx}`).toHaveLength(
      0,
    );
    expect(await adminClient`SELECT id FROM hub_bff_login_txns WHERE id = ${liveTx}`).toHaveLength(
      1,
    );
  });
});
