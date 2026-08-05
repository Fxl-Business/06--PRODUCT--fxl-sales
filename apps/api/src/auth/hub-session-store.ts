/**
 * Durable Hub BFF session store, backed by Postgres.
 *
 * `createHubBff()` defaults to the SDK's `InMemoryHubSessionStore`, which keeps
 * sessions and login transactions in one process' `Map`. Every API restart or
 * redeploy therefore invalidated every logged-in session, and with more than one
 * replica a session created on A was invisible on B.
 *
 * `HubSessionStore` is SYNCHRONOUS - no method may `await`, and `get()` is
 * called inline inside /auth/refresh to build the Hub back-channel Cookie
 * header. The shape used here is HYDRATE-AROUND-THE-HANDLER: a request-scoped
 * unit of work held in an `AsyncLocalStorage`, loaded from Postgres before the
 * BFF handler runs and flushed back after it returns. Inside the handler every
 * store method is a pure `Map` operation; all I/O happens at the async boundary
 * `createHubSessionScopeMiddleware` owns. This is `express-session`'s shape.
 *
 * The working set is REQUEST-SCOPED, never a long-lived cache. The Hub rotates
 * the refresh token on every /auth/refresh, so a replica must never serve a
 * token it cached before another replica rotated it. Re-reading one indexed
 * primary-key row per auth request is negligible next to the Hub HTTP round
 * trip that same request already makes.
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
} from '@fxl-business/hub-sdk';
import { and, eq, gt, lte } from 'drizzle-orm';
import { getAdminDb } from '../db/client.js';
import { hubBffLoginTxns, hubBffSessions } from '../db/schema.js';
import { createSessionSealer, type SessionSealer } from './session-crypto.js';

type NodeDb = ReturnType<typeof getAdminDb>;
type RequestDb = Parameters<Parameters<NodeDb['transaction']>[0]>[0];
type RequestPhase = 'hydrate' | 'handler' | 'flush';

/** Sliding: rewritten to now + 30 days on every refresh-token rotation. */
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
/** Matches the SDK's LOGIN_TX_MAX_AGE_SECONDS = 600 (dist/server.js:275) byte for byte. */
export const LOGIN_TX_TTL_MS = 10 * 60 * 1000;

/** Thrown when a store method is called outside `withRequest`. Loud on purpose. */
export class HubSessionScopeError extends Error {
  constructor(message = 'hub session store used outside a request scope') {
    super(message);
    this.name = 'HubSessionScopeError';
  }
}

/** Thrown when the hydrate read fails, so the middleware can answer 503. */
export class HubSessionStoreUnavailableError extends Error {
  constructor(message = 'hub session store is unavailable', options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'HubSessionStoreUnavailableError';
  }
}

export type HubSessionHydrateInput = {
  sessionId?: string | undefined;
  loginTxId?: string | undefined;
  /** Consume-on-hydrate. True only on /auth/callback. */
  consumeLoginTx: boolean;
};

export interface DurableHubSessionStore extends HubSessionStore {
  withRequest<T>(input: HubSessionHydrateInput, fn: () => Promise<T>): Promise<T>;
}

type SessionOp =
  | {
      kind: 'session.create';
      id: string;
      tokenEnc: string;
      accountId: string | null;
      expiresAt: Date;
    }
  | { kind: 'session.update'; id: string; tokenEnc: string; expiresAt: Date }
  | { kind: 'session.delete'; id: string }
  | { kind: 'login.create'; id: string; verifierEnc: string; state: string; expiresAt: Date }
  | { kind: 'login.delete'; id: string };

type UnitOfWork = {
  sessions: Map<string, { record: HubSessionRecord; expiresAt: Date }>;
  logins: Map<string, { tx: HubLoginTransaction; durablyRemoved: boolean }>;
  ops: SessionOp[];
};

function newId(): string {
  // 256 bits, above the interface's documented 128-bit floor.
  return randomBytes(32).toString('base64url');
}

class PostgresHubSessionStore implements DurableHubSessionStore {
  readonly #als = new AsyncLocalStorage<UnitOfWork>();
  readonly #db: NodeDb;
  readonly #sealer: SessionSealer;
  readonly #now: () => Date;

  constructor(deps: { db: NodeDb; sealer: SessionSealer; now?: () => Date }) {
    this.#db = deps.db;
    this.#sealer = deps.sealer;
    this.#now = deps.now ?? (() => new Date());
  }

  #scope(): UnitOfWork {
    const uow = this.#als.getStore();
    if (!uow) {
      throw new HubSessionScopeError();
    }
    return uow;
  }

  create(data: HubSessionRecord): string {
    const uow = this.#scope();
    const id = newId();
    const expiresAt = new Date(this.#now().getTime() + SESSION_TTL_MS);
    uow.sessions.set(id, { record: { ...data }, expiresAt });
    uow.ops.push({
      kind: 'session.create',
      id,
      tokenEnc: this.#sealer.seal(data.hubRefreshToken, id),
      accountId: data.accountId ?? null,
      expiresAt,
    });
    return id;
  }

  get(sessionId: string): HubSessionRecord | null {
    const entry = this.#scope().sessions.get(sessionId);
    if (!entry || entry.expiresAt.getTime() <= this.#now().getTime()) {
      return null;
    }
    // Shallow copy so the SDK cannot mutate the working set.
    return { ...entry.record };
  }

  update(sessionId: string, hubRefreshToken: string): void {
    const uow = this.#scope();
    const entry = uow.sessions.get(sessionId);
    if (!entry) {
      return; // The interface documents "no-op if unknown".
    }
    entry.record.hubRefreshToken = hubRefreshToken;
    entry.expiresAt = new Date(this.#now().getTime() + SESSION_TTL_MS);
    uow.ops.push({
      kind: 'session.update',
      id: sessionId,
      tokenEnc: this.#sealer.seal(hubRefreshToken, sessionId),
      expiresAt: entry.expiresAt,
    });
  }

  delete(sessionId: string): void {
    const uow = this.#scope();
    uow.sessions.delete(sessionId);
    // Unconditional, so the op is idempotent even if the row was never hydrated.
    uow.ops.push({ kind: 'session.delete', id: sessionId });
  }

  createLogin(tx: HubLoginTransaction): string {
    const uow = this.#scope();
    const id = newId();
    const expiresAt = new Date(this.#now().getTime() + LOGIN_TX_TTL_MS);
    uow.logins.set(id, { tx: { ...tx }, durablyRemoved: false });
    uow.ops.push({
      kind: 'login.create',
      id,
      verifierEnc: this.#sealer.seal(tx.codeVerifier, id),
      state: tx.state,
      expiresAt,
    });
    return id;
  }

  consumeLogin(txId: string): HubLoginTransaction | null {
    const uow = this.#scope();
    const entry = uow.logins.get(txId);
    if (!entry) {
      return null;
    }
    uow.logins.delete(txId);
    if (!entry.durablyRemoved) {
      uow.ops.push({ kind: 'login.delete', id: txId });
    }
    return entry.tx;
  }

  async #hydrate(
    db: RequestDb,
    uow: UnitOfWork,
    input: HubSessionHydrateInput,
  ): Promise<void> {
    const now = this.#now();
    if (input.sessionId) {
      const rows = await db
        .select()
        .from(hubBffSessions)
        .where(and(eq(hubBffSessions.id, input.sessionId), gt(hubBffSessions.expiresAt, now)))
        .for('update')
        .limit(1);
      const row = rows[0];
      if (row) {
        const token = this.#sealer.open(row.hubRefreshTokenEnc, row.id);
        // A null open leaves the working set empty for that id, which reads
        // downstream as an unknown session.
        if (token !== null) {
          uow.sessions.set(row.id, {
            record: row.accountId
              ? { hubRefreshToken: token, accountId: row.accountId }
              : { hubRefreshToken: token },
            expiresAt: row.expiresAt,
          });
        }
      }
    }

    if (input.loginTxId && input.consumeLoginTx) {
      // Consume-on-hydrate: only one replica's DELETE can return the row, so
      // the PKCE verifier is single-use at the DATABASE level rather than
      // single-use per process.
      const rows = await db
        .delete(hubBffLoginTxns)
        .where(and(eq(hubBffLoginTxns.id, input.loginTxId), gt(hubBffLoginTxns.expiresAt, now)))
        .returning();
      const row = rows[0];
      if (row) {
        const verifier = this.#sealer.open(row.codeVerifierEnc, row.id);
        if (verifier !== null) {
          uow.logins.set(row.id, {
            tx: { codeVerifier: verifier, state: row.state },
            durablyRemoved: true,
          });
        }
      }
    }
  }

  async #flush(db: RequestDb, uow: UnitOfWork): Promise<void> {
    if (uow.ops.length === 0) {
      return;
    }
    for (const op of uow.ops) {
      switch (op.kind) {
        case 'session.create':
          await db.insert(hubBffSessions).values({
            id: op.id,
            hubRefreshTokenEnc: op.tokenEnc,
            accountId: op.accountId,
            expiresAt: op.expiresAt,
          });
          break;
        case 'session.update':
          await db
            .update(hubBffSessions)
            .set({
              hubRefreshTokenEnc: op.tokenEnc,
              expiresAt: op.expiresAt,
              updatedAt: new Date(),
            })
            .where(eq(hubBffSessions.id, op.id));
          break;
        case 'session.delete':
          await db.delete(hubBffSessions).where(eq(hubBffSessions.id, op.id));
          break;
        case 'login.create':
          await db.insert(hubBffLoginTxns).values({
            id: op.id,
            codeVerifierEnc: op.verifierEnc,
            state: op.state,
            expiresAt: op.expiresAt,
          });
          break;
        case 'login.delete':
          await db.delete(hubBffLoginTxns).where(eq(hubBffLoginTxns.id, op.id));
          break;
      }
    }
  }

  async withRequest<T>(input: HubSessionHydrateInput, fn: () => Promise<T>): Promise<T> {
    const uow: UnitOfWork = { sessions: new Map(), logins: new Map(), ops: [] };
    let phase: RequestPhase = 'hydrate';
    let handlerResult: { value: T } | undefined;

    return this.#als.run(uow, async () => {
      try {
        return await this.#db.transaction(async (tx) => {
          await this.#hydrate(tx, uow, input);
          phase = 'handler';
          const value = await fn();
          handlerResult = { value };
          phase = 'flush';
          await this.#flush(tx, uow);
          return value;
        });
      } catch (err) {
        if (phase === 'hydrate') {
          if (err instanceof HubSessionStoreUnavailableError) {
            throw err;
          }
          throw new HubSessionStoreUnavailableError('hub session hydrate failed', { cause: err });
        }
        if (phase === 'handler') {
          throw err;
        }
        console.error('[hub-session-store] flush failed', err);
        return handlerResult!.value;
      }
    });
  }
}

export function createDurableHubSessionStore(deps: {
  db: NodeDb;
  sealer: SessionSealer;
  now?: () => Date;
}): DurableHubSessionStore {
  return new PostgresHubSessionStore(deps);
}

/**
 * Env-reading factory used by app-auth. The explicit union is what stops the
 * caller mounting the hydrate/flush middleware around an in-memory store, or
 * forgetting to mount it around a durable one.
 */
export function createHubSessionStore(deps: {
  databaseUrlPresent: boolean;
  nodeEnv: string;
  encryptionIkm: string;
}): { kind: 'durable'; store: DurableHubSessionStore } | { kind: 'memory'; store: HubSessionStore } {
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
