import { describe, expect, it, vi } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';
import {
  createIntegrationTxAdapter,
  drizzleTxOf,
  hasDrizzleTx,
  rawWithParams,
} from '../outbox-adapter.js';

vi.mock('../../../db/client.js', () => ({ getAdminDb: () => ({}) }));

const dialect = new PgDialect();

describe('rawWithParams', () => {
  it('binds repeated and out-of-order placeholders per occurrence', () => {
    const q = dialect.sqlToQuery(rawWithParams('SELECT $2, $1, $2::jsonb', ['a', 'b']));
    expect(q.sql).toBe('SELECT $1, $2, $3::jsonb');
    expect(q.params).toEqual(['b', 'a', 'b']);
  });
  it('rejects a placeholder with no param', () => {
    expect(() => rawWithParams('SELECT $2', ['a'])).toThrow();
  });
});

describe('tx adapter', () => {
  it('runs on the same tx, carries it, and never nests', async () => {
    const execute = vi.fn(async () => [{ x: 1 }]);
    const tx = { execute } as never;
    const adapter = createIntegrationTxAdapter(tx);
    expect(await adapter.query('SELECT $1', [1])).toEqual([{ x: 1 }]);
    expect(execute).toHaveBeenCalledTimes(1);
    expect(hasDrizzleTx(adapter)).toBe(true);
    expect(drizzleTxOf(adapter)).toBe(tx);
    await adapter.transaction(async (inner) => expect(inner).toBe(adapter));
    expect(() => drizzleTxOf({ query: vi.fn(), transaction: vi.fn() })).toThrow();
  });
});
