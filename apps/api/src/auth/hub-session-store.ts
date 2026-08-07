/**
 * Durable Hub BFF session store, backed by Postgres.
 *
 * `createHubBff()` defaults to the SDK's `InMemoryHubSessionStore`, which keeps
 * sessions and login transactions in one process' `Map`. Every API restart or
 * redeploy therefore invalidated every logged-in session, and with more than one
 * replica a session created on A was invisible on B.
 *
 * `HubSessionStore` is ASYNC and TRANSACTIONAL as of
 * `@fxl-business/hub-sdk@1.3.0`, and the STORE owns the lock. `withSession(id,
 * op)` opens ONE `db.transaction`, takes `SELECT ... FOR UPDATE` on the session
 * row BEFORE `op` runs, and holds it until commit - so two concurrent refreshes
 * of one session id serialize at Postgres and a rotated refresh token cannot be
 * lost. There is no hydrate phase, no flush phase and no request-scoped working
 * set; the read, the Hub round trip and the write all happen inside the one
 * transaction.
 *
 * Because the operation's return value is never captured outside that
 * transaction, a commit failure cannot be returned as success. That was the
 * pre-1.3.0 hole: the flush phase swallowed its own failure, so the Hub had
 * rotated RT1 to RT2 while Postgres still held RT1, and the next refresh
 * replayed RT1 and tripped `reuse_detected`.
 *
 * `getAdminDb()` is the only connection, because `hub_bff_sessions` and
 * `hub_bff_login_txns` carry FORCE RLS with only the `app.fxl_admin` policy.
 *
 * Rotating `FXL_HUB_SECRET_KEY` invalidates every stored session - see
 * `session-crypto.ts`.
 */
import { randomBytes } from 'node:crypto';
import {
  InMemoryHubSessionStore,
  type HubLoginTransaction,
  type HubSessionRecord,
  type HubSessionStore,
  type HubSessionTransaction,
} from '@fxl-business/hub-sdk';
import { eq, lte } from 'drizzle-orm';
import { getAdminDb } from '../db/client.js';
import { hubBffLoginTxns, hubBffSessions } from '../db/schema.js';
import { createSessionSealer, type SessionSealer } from './session-crypto.js';

type NodeDb = ReturnType<typeof getAdminDb>;

/** Sliding: rewritten to now + 30 days on every refresh-token rotation. */
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
/** Matches the SDK's LOGIN_TX_MAX_AGE_SECONDS = 600 (1.3.0 dist/server.js:279). */
export const LOGIN_TX_TTL_MS = 10 * 60 * 1000;

/** Thrown when the store cannot answer, so the BFF router can answer 503. */
export class HubSessionStoreUnavailableError extends Error {
  constructor(message = 'hub session store is unavailable', options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'HubSessionStoreUnavailableError';
  }
}

function newId(): string {
  // 256 bits, above the interface's documented 128-bit floor.
  return randomBytes(32).toString('base64url');
}

class PostgresHubSessionStore implements HubSessionStore {
  readonly #db: NodeDb;
  readonly #sealer: SessionSealer;
  readonly #now: () => Date;

  constructor(deps: { db: NodeDb; sealer: SessionSealer; now?: () => Date }) {
    this.#db = deps.db;
    this.#sealer = deps.sealer;
    this.#now = deps.now ?? (() => new Date());
  }

  #unavailable(message: string, cause: unknown): HubSessionStoreUnavailableError {
    if (cause instanceof HubSessionStoreUnavailableError) {
      return cause;
    }
    console.error(`[hub-session-store] ${message}`, cause);
    return new HubSessionStoreUnavailableError(message, { cause });
  }

  async create(data: HubSessionRecord): Promise<string> {
    const id = newId();
    try {
      await this.#db.insert(hubBffSessions).values({
        id,
        hubRefreshTokenEnc: this.#sealer.seal(data.hubRefreshToken, id),
        accountId: data.accountId ?? null,
        // `data.expiresAt` and `data.absoluteExpiresAt` are deliberately IGNORED.
        // This store owns the expiry columns, the sliding rule and the nightly
        // sweeper; the SDK's create-time value is a fixed timestamp that cannot
        // express sliding, and honouring it would make the TTL depend on
        // `createHubBff`'s option defaults rather than on SESSION_TTL_MS.
        expiresAt: new Date(this.#now().getTime() + SESSION_TTL_MS),
      });
    } catch (err) {
      throw this.#unavailable('hub session create failed', err);
    }
    return id;
  }

  async withSession<T>(
    sessionId: string,
    operation: (tx: HubSessionTransaction) => Promise<T>,
  ): Promise<T> {
    try {
      return await this.#db.transaction(async (tx) => {
        // The lock is taken FIRST, before `operation` runs, and is held until
        // this transaction commits. That is the whole point of the 1.3.0
        // contract: the Hub round trip the operation makes happens under it.
        const rows = await tx
          .select()
          .from(hubBffSessions)
          .where(eq(hubBffSessions.id, sessionId))
          .for('update')
          .limit(1);

        const now = this.#now().getTime();
        let row = rows[0] ?? null;

        // Expired: deleted inside this transaction and reported absent.
        if (row && row.expiresAt.getTime() <= now) {
          await tx.delete(hubBffSessions).where(eq(hubBffSessions.id, sessionId));
          row = null;
        }

        // A seal that will not open reads as an unknown session and the row is
        // LEFT IN PLACE. This diverges from the bundled `SqlHubSessionStore`,
        // which throws: a key rotation must cost every user one re-login rather
        // than a wall of 503s, and deleting rows as a side effect of presenting
        // the wrong key would destroy data on a misconfigured deploy.
        const token = row ? this.#sealer.open(row.hubRefreshTokenEnc, row.id) : null;
        const live = token === null ? null : row;

        const handle: HubSessionTransaction = {
          get: async () =>
            live && token !== null
              ? {
                  hubRefreshToken: token,
                  ...(live.accountId ? { accountId: live.accountId } : {}),
                  expiresAt: live.expiresAt.toISOString(),
                }
              : null,
          update: async (record) => {
            await tx
              .update(hubBffSessions)
              .set({
                hubRefreshTokenEnc: this.#sealer.seal(record.hubRefreshToken, sessionId),
                accountId: record.accountId ?? null,
                // SLIDING, deliberately ignoring `record.expiresAt`: the SDK
                // spreads back the value it got from `get()` (dist/server.js:464),
                // so honouring it would freeze the TTL at 30 days from login.
                expiresAt: new Date(this.#now().getTime() + SESSION_TTL_MS),
                updatedAt: new Date(),
              })
              .where(eq(hubBffSessions.id, sessionId));
          },
          delete: async () => {
            await tx.delete(hubBffSessions).where(eq(hubBffSessions.id, sessionId));
          },
        };

        return await operation(handle);
      });
    } catch (err) {
      // ONE rule, no phase tracking: the lock read, a handle method, the
      // operation itself and the commit all land here, and the operation's
      // return value is never in scope - so there is nothing a catch could
      // hand back in place of a failure.
      throw this.#unavailable('hub session transaction failed', err);
    }
  }

  async createLoginTransaction(tx: HubLoginTransaction): Promise<string> {
    const id = newId();
    const supplied = tx.expiresAt ? Date.parse(tx.expiresAt) : Number.NaN;
    const expiresAt = Number.isFinite(supplied)
      ? new Date(supplied)
      : new Date(this.#now().getTime() + LOGIN_TX_TTL_MS);
    try {
      await this.#db.insert(hubBffLoginTxns).values({
        id,
        codeVerifierEnc: this.#sealer.seal(tx.codeVerifier, id),
        state: tx.state,
        expiresAt,
      });
    } catch (err) {
      throw this.#unavailable('hub login transaction create failed', err);
    }
    return id;
  }

  async consumeLoginTransaction(id: string): Promise<HubLoginTransaction | null> {
    let row: typeof hubBffLoginTxns.$inferSelect | undefined;
    try {
      // ONE `DELETE ... RETURNING`, atomic on its own and with no `WHERE` on
      // `expires_at`: only one replica's statement can return the row, so a
      // replayed /auth/callback cannot retry the PKCE verifier even across
      // replicas, and an expired row is removed rather than left for the sweeper.
      const rows = await this.#db
        .delete(hubBffLoginTxns)
        .where(eq(hubBffLoginTxns.id, id))
        .returning();
      row = rows[0];
    } catch (err) {
      throw this.#unavailable('hub login transaction consume failed', err);
    }

    if (!row || row.expiresAt.getTime() <= this.#now().getTime()) {
      return null;
    }
    const codeVerifier = this.#sealer.open(row.codeVerifierEnc, row.id);
    if (codeVerifier === null) {
      return null;
    }
    return { codeVerifier, state: row.state, expiresAt: row.expiresAt.toISOString() };
  }
}

export function createDurableHubSessionStore(deps: {
  db: NodeDb;
  sealer: SessionSealer;
  now?: () => Date;
}): HubSessionStore {
  return new PostgresHubSessionStore(deps);
}

/**
 * Env-reading factory used by app-auth. `kind` is what the wiring test asserts
 * to prove the durable path was taken, and what drives the memory-fallback warning.
 */
export function createHubSessionStore(deps: {
  databaseUrlPresent: boolean;
  nodeEnv: string;
  encryptionIkm: string;
}): { kind: 'durable' | 'memory'; store: HubSessionStore } {
  if (deps.databaseUrlPresent) {
    // getAdminDb() is reached only from inside this factory, never at module
    // import time, and postgres-js builds the pool without opening a socket
    // until the first query - so constructing the store forces no connection.
    return {
      kind: 'durable',
      store: createDurableHubSessionStore({
        db: getAdminDb(),
        sealer: createSessionSealer(deps.encryptionIkm),
      }),
    };
  }

  if (deps.nodeEnv === 'production') {
    throw new Error('DATABASE_URL is required for the durable Hub BFF session store in production');
  }

  console.warn(
    '[hub-session-store] DATABASE_URL is not set - falling back to the in-process session store; sessions will NOT survive a restart',
  );
  return { kind: 'memory', store: new InMemoryHubSessionStore() };
}

/** Cleanup, called by the nightly scheduler. Returns rows removed. */
export async function deleteExpiredHubBffSessions(
  db: NodeDb,
): Promise<{ sessions: number; loginTxns: number }> {
  const now = new Date();
  const removedSessions = await db
    .delete(hubBffSessions)
    .where(lte(hubBffSessions.expiresAt, now))
    .returning({ id: hubBffSessions.id });
  const removedLogins = await db
    .delete(hubBffLoginTxns)
    .where(lte(hubBffLoginTxns.expiresAt, now))
    .returning({ id: hubBffLoginTxns.id });
  return { sessions: removedSessions.length, loginTxns: removedLogins.length };
}
