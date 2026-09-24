import { sql } from 'drizzle-orm';
import { salesOpsPayables, salesOpsReceivables } from '../../db/schema.js';

/**
 * C7: spread into every `.set()` that changes a receivable. Same statement,
 * never a second UPDATE, and never on a row whose columns did not change.
 */
export function receivableRevisionBump() {
  return { revision: sql<number>`${salesOpsReceivables.revision} + 1`, updatedAt: sql<Date>`now()` };
}

/** C7: spread into every `.set()` that changes a payable. */
export function payableRevisionBump() {
  return { revision: sql<number>`${salesOpsPayables.revision} + 1`, updatedAt: sql<Date>`now()` };
}
