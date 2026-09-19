/**
 * The ONE door from `leads/` into the tenant-scoped transaction.
 *
 * `setTenantContext` must be a transaction body's FIRST statement, and a
 * transaction-local `set_config` is invisible outside its own transaction. Three
 * hand-maintained copies of that rule would be three places for it to rot, and
 * the failure mode is SILENT: RLS matches nothing and the query returns zero
 * rows rather than raising. So there is exactly one implementation, in
 * `service.ts`, and this module is how every file under `leads/` reaches it
 * without importing the 2800-line service directly.
 *
 * It re-exports and adds nothing. A wrapper here would be a second place for the
 * ordering rule to live.
 */
export { withTenant } from '../service.js';
