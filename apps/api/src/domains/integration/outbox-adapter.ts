import {
  enqueueIntegrationEvent,
  type IntegrationEventEnvelope,
  type SqlIntegrationAdapter,
} from '@fxl-business/fxl-contracts';
import { sql, type SQL } from 'drizzle-orm';
import { getAdminDb, type getDb } from '../../db/client.js';

/**
 * The in-progress drizzle transaction the repo hands around (`withTenant`,
 * `db.transaction`). Structural on purpose: only `execute` is needed.
 */
export type DrizzleTx = Pick<ReturnType<typeof getDb>, 'execute'>;

const PLACEHOLDER = /\$(\d+)/g;

/**
 * Turns the package's `$n` SQL into a drizzle SQL object. Every occurrence of
 * `$n` becomes its own bound parameter, so repeated or out-of-order placeholders
 * bind the right value.
 */
export function rawWithParams(text: string, params: readonly unknown[]): SQL {
  const chunks: SQL[] = [];
  let last = 0;
  for (const match of text.matchAll(PLACEHOLDER)) {
    const index = Number(match[1]);
    if (index < 1 || index > params.length) {
      throw new Error(`rawWithParams: $${index} has no bound parameter (${params.length} given)`);
    }
    chunks.push(sql.raw(text.slice(last, match.index)));
    // postgres.js refuses a Date bound through drizzle's untyped param path; an
    // ISO string is unambiguous for timestamptz.
    const value = params[index - 1];
    chunks.push(sql`${value instanceof Date ? value.toISOString() : value}`);
    last = match.index + match[0].length;
  }
  chunks.push(sql.raw(text.slice(last)));
  return sql.join(chunks, sql.raw(''));
}

const carried = new WeakMap<SqlIntegrationAdapter, DrizzleTx>();

function makeAdapter(
  runner: DrizzleTx,
  transaction: SqlIntegrationAdapter['transaction'],
): SqlIntegrationAdapter {
  const adapter: SqlIntegrationAdapter = {
    async query<R>(text: string, params: readonly unknown[]): Promise<R[]> {
      const result = await runner.execute(rawWithParams(text, params));
      return Array.from(result as unknown as ArrayLike<R>);
    },
    transaction,
  };
  carried.set(adapter, runner);
  return adapter;
}

/** Wraps an IN-PROGRESS business tx; `transaction` reuses it (never nests). */
export function createIntegrationTxAdapter(tx: DrizzleTx): SqlIntegrationAdapter {
  const adapter: SqlIntegrationAdapter = makeAdapter(tx, (operation) => operation(adapter));
  return adapter;
}

/**
 * Adapter over the admin (cross-tenant) pool. `transaction` opens a real drizzle
 * transaction (read committed) and yields an adapter that also carries it.
 */
export function createIntegrationPooledAdapter(): SqlIntegrationAdapter {
  const db = getAdminDb();
  return makeAdapter(db, (operation) =>
    db.transaction(
      (tx) => operation(createIntegrationTxAdapter(tx as unknown as DrizzleTx)),
      { isolationLevel: 'read committed' },
    ),
  );
}

export function hasDrizzleTx(adapter: SqlIntegrationAdapter): boolean {
  return carried.has(adapter);
}

export function drizzleTxOf(adapter: SqlIntegrationAdapter): DrizzleTx {
  const tx = carried.get(adapter);
  if (!tx) throw new Error('integration adapter does not carry a drizzle transaction');
  return tx;
}

/** Enqueue one event from INSIDE the business tx. */
export async function enqueueEvent(tx: DrizzleTx, event: IntegrationEventEnvelope): Promise<void> {
  await enqueueIntegrationEvent(createIntegrationTxAdapter(tx), event);
}

/** Enqueue several events on an adapter, in order. */
export async function enqueueSaleEvents(
  tx: SqlIntegrationAdapter,
  events: readonly IntegrationEventEnvelope[],
): Promise<void> {
  for (const event of events) {
    await enqueueIntegrationEvent(tx, event);
  }
}
