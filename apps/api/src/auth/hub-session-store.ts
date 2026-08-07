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
import { AsyncLocalStorage } from 'node:async_hooks';
import { randomBytes } from 'node:crypto';
import {
  InMemoryHubSessionStore,
  type HubLoginTransaction,
  type HubSessionRecord,
  type HubSessionStore,
  type HubSessionTransaction,
} from '@fxl-business/hub-sdk';
import { eq, lte, or } from 'drizzle-orm';
import { getAdminDb } from '../db/client.js';
import { hubBffLoginTxns, hubBffSessions } from '../db/schema.js';
import { createSessionSealer, type SessionSealer } from './session-crypto.js';

type NodeDb = ReturnType<typeof getAdminDb>;
type HubBffSessionRow = typeof hubBffSessions.$inferSelect;

/** Sliding: rewritten to now + 30 days on every refresh-token rotation. */
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * ABSOLUTE ceiling, set once at create and never extended. A continuously
 * refreshing session dies here no matter how active it is, which is the only thing
 * that bounds a stolen session id.
 *
 * 90 days, not the SDK's 365-day default: the numbers a product picks here are a
 * security posture, and 365 days means the ceiling almost never binds - a user idle
 * for 30 days is already killed by the sliding TTL, so a 365-day cap only ever
 * catches someone who has been active for a year. 90 days is exactly 3x the sliding
 * window, so a daily user really is forced back through the Hub once a quarter.
 *
 * That 90 days happens to equal the SDK's SLIDING default (7 776 000s) is a
 * coincidence, not an adoption. Our sliding window stays at 30 days.
 */
export const SESSION_ABSOLUTE_TTL_MS = 90 * 24 * 60 * 60 * 1000;

/** Matches the SDK's LOGIN_TX_MAX_AGE_SECONDS = 600 (1.3.0 dist/server.js:279). */
export const LOGIN_TX_TTL_MS = 10 * 60 * 1000;

/**
 * The ONE conversion boundary between our timestamptz columns, which Drizzle hands
 * back as Date objects, and HubSessionRecord, which types both expiry fields as an
 * optional ISO string.
 *
 * It only runs in this direction. Nothing ever parses the SDK's strings back into a
 * Date: `create` and `update` ignore `record.expiresAt` and `record.absoluteExpiresAt`
 * entirely and compute their own Dates from `#now()`, so there is no inbound half to
 * keep in sync.
 *
 * Handing the SDK a Date instead of a string type-errors on nothing at runtime and
 * fails silently: dist/server.js:424 does `now() >= Date.parse(record.absoluteExpiresAt)`,
 * and Date.parse of a Date object is NaN, so the SDK's own expiry gate would just
 * stop firing. That is what the 'hands the SDK both expiries as ISO strings' oracle
 * pins.
 */
function toSessionRecord(row: HubBffSessionRow, hubRefreshToken: string): HubSessionRecord {
  return {
    hubRefreshToken,
    ...(row.accountId ? { accountId: row.accountId } : {}),
    expiresAt: row.expiresAt.toISOString(),
    absoluteExpiresAt: row.absoluteExpiresAt.toISOString(),
  };
}

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

/**
 * What a login knows about the session the browser was carrying a moment before
 * it logged in again. One optional string, and nothing else will ever be added:
 * see `hub-login-scope.ts` for why this reaches `create()` out of band at all.
 */
export type HubLoginContext = { priorSessionId: string | undefined };

/**
 * The durable store's extra member, over and above the SDK's interface.
 *
 * Slice 01 deleted this interface because `withRequest` was its only member and
 * an empty extension is noise. `withLoginContext` makes it non-empty again, so
 * that reasoning no longer applies - do not delete it a second time. It is what
 * lets `createAppAuthBff` narrow `session.kind === 'durable'` to a store that can
 * actually supersede: the SDK's `InMemoryHubSessionStore` cannot, and mounting
 * the middleware over it would make every local `/auth/callback` throw.
 */
export interface DurableHubSessionStore extends HubSessionStore {
  withLoginContext<T>(context: HubLoginContext, fn: () => Promise<T>): Promise<T>;
}

class PostgresHubSessionStore implements DurableHubSessionStore {
  readonly #db: NodeDb;
  readonly #sealer: SessionSealer;
  readonly #now: () => Date;
  readonly #newId: () => string;
  readonly #loginAls = new AsyncLocalStorage<HubLoginContext>();

  constructor(deps: {
    db: NodeDb;
    sealer: SessionSealer;
    now?: () => Date;
    newId?: () => string;
  }) {
    this.#db = deps.db;
    this.#sealer = deps.sealer;
    this.#now = deps.now ?? (() => new Date());
    this.#newId = deps.newId ?? newId;
  }

  /**
   * Runs `fn` with a login context in scope, so the `create()` the SDK makes from
   * inside its own `/auth/callback` handler can see which session this browser
   * presented. The store owns the `AsyncLocalStorage` because the store is what
   * reads it; the middleware only fills it.
   */
  withLoginContext<T>(context: HubLoginContext, fn: () => Promise<T>): Promise<T> {
    return this.#loginAls.run(context, fn);
  }

  #unavailable(message: string, cause: unknown): HubSessionStoreUnavailableError {
    if (cause instanceof HubSessionStoreUnavailableError) {
      return cause;
    }
    console.error(`[hub-session-store] ${message}`, cause);
    return new HubSessionStoreUnavailableError(message, { cause });
  }

  async create(data: HubSessionRecord): Promise<string> {
    const id = this.#newId();
    // ONE clock read for both timestamps, so they can never be anchored to
    // different milliseconds.
    const now = this.#now().getTime();
    // Read OUTSIDE the transaction callback: the callback is an async boundary
    // drizzle may schedule freely, and the context has to be the one belonging to
    // the request that called create().
    const priorSessionId = this.#loginAls.getStore()?.priorSessionId;
    try {
      await this.#db.transaction(async (tx) => {
        // SUPERSEDE FIRST, in the SAME transaction as the insert. The row this
        // deletes is one the SDK is about to orphan anyway - it overwrites the
        // session cookie two lines after create() returns (dist/server.js:414) -
        // and until this slice it stayed live and rotatable for up to 30 days.
        //
        // The two statements are one transaction or the feature is unsound.
        // Deleting afterwards leaves the orphan live if the insert fails;
        // deleting in a transaction of its own leaves the browser with no session
        // at all when the insert fails, i.e. a failed login signs the operator
        // out. `keeps the prior session when the new insert fails` is the oracle.
        //
        // Absence of a prior id is NEVER an error: a fresh browser, and every
        // direct create() in the integration suite, arrives without one.
        // `priorSessionId !== id` is cheap defence that cannot fire against a
        // 256-bit random id.
        if (priorSessionId !== undefined && priorSessionId !== id) {
          await tx.delete(hubBffSessions).where(eq(hubBffSessions.id, priorSessionId));
        }
        await tx.insert(hubBffSessions).values({
          id,
          hubRefreshTokenEnc: this.#sealer.seal(data.hubRefreshToken, id),
          // ALWAYS NULL under 1.3.0 - the BFF never supplies it. See the column
          // comment in db/schema.ts before building anything on it.
          accountId: data.accountId ?? null,
          // `data.expiresAt` and `data.absoluteExpiresAt` are deliberately IGNORED.
          // This store owns the expiry columns, the sliding rule and the nightly
          // sweeper; the SDK's create-time value is a fixed timestamp that cannot
          // express sliding, and honouring it would make the TTL depend on
          // `createHubBff`'s option defaults rather than on our own constants.
          expiresAt: new Date(now + SESSION_TTL_MS),
          // Written ONCE, here, and nowhere else in this file. No rotation moves
          // it; that is the entire point of the column. `createHubBff` IS given
          // matching values so the two views agree - see app-auth.ts - but nothing
          // here depends on that, because the store has to be correct standing
          // alone rather than only when the caller remembered to pass
          // `sessionAbsoluteTtlSeconds`.
          absoluteExpiresAt: new Date(now + SESSION_ABSOLUTE_TTL_MS),
        });
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

        // Past EITHER timestamp: deleted inside this transaction and reported
        // absent, per MIGRATION.md ("A store implementing withSession should
        // treat a record past either timestamp as absent: delete it inside the
        // transaction and resolve null"). The absolute term is not redundant
        // with the sliding one: a row rotated yesterday has expires_at 29 days
        // in the future while absolute_expires_at may already have passed, and
        // that row is exactly the one the ceiling exists to kill.
        if (row && (row.expiresAt.getTime() <= now || row.absoluteExpiresAt.getTime() <= now)) {
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
          get: async () => (live && token !== null ? toSessionRecord(live, token) : null),
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
                // `absoluteExpiresAt` is ABSENT from this object ON PURPOSE, and
                // `record.absoluteExpiresAt` is ignored for the mirror-image
                // reason. A rotation must never extend the ceiling, so the safest
                // expression of that is to have no statement here that could
                // write it. Adding it back - even as `record.absoluteExpiresAt` -
                // restores the immortal session.
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
  /**
   * TEST-ONLY, and it must stay that way. It defaults to `randomBytes(32)` and is
   * never overridden by `createHubSessionStore`; wiring it to anything but a test
   * stops `hub_bff_sessions.id` being unguessable, which is the one property that
   * column has to have. It exists so the atomicity oracle can force a primary-key
   * collision deterministically, and it is the same shape as `now`.
   */
  newId?: () => string;
}): DurableHubSessionStore {
  return new PostgresHubSessionStore(deps);
}

/**
 * Env-reading factory used by app-auth. `kind` is what the wiring test asserts
 * to prove the durable path was taken, and what drives the memory-fallback warning.
 *
 * The return is a DISCRIMINATED union, not `{kind; store: HubSessionStore}`:
 * `kind === 'durable'` has to narrow `store` to `DurableHubSessionStore`, because
 * the login-supersede middleware may only be mounted over a store that has
 * `withLoginContext`. Collapsing the union makes that mount a runtime TypeError
 * on every local dev machine without `DATABASE_URL` instead of a type error here.
 */
export function createHubSessionStore(deps: {
  databaseUrlPresent: boolean;
  nodeEnv: string;
  encryptionIkm: string;
}):
  | { kind: 'durable'; store: DurableHubSessionStore }
  | { kind: 'memory'; store: HubSessionStore } {
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
  // EITHER timestamp, matching withSession's predicate and the SDK's bundled DDL
  // sweep (schema/session-store.sql, "expiry sweep"). withSession already deletes
  // an expired row on access, so this is only about rows nobody comes back for -
  // which is exactly the stolen-and-abandoned session the ceiling is for.
  const removedSessions = await db
    .delete(hubBffSessions)
    .where(or(lte(hubBffSessions.expiresAt, now), lte(hubBffSessions.absoluteExpiresAt, now)))
    .returning({ id: hubBffSessions.id });
  const removedLogins = await db
    .delete(hubBffLoginTxns)
    .where(lte(hubBffLoginTxns.expiresAt, now))
    .returning({ id: hubBffLoginTxns.id });
  return { sessions: removedSessions.length, loginTxns: removedLogins.length };
}
