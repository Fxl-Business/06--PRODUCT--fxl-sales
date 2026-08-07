---
id: 02-session-absolute-ttl
milestone: v2.6.0
status: todo
depends_on: [01-sdk-130-store-port]
files_modified: [apps/api/drizzle/0021_hub_session_absolute_ttl.sql, apps/api/drizzle/meta/0021_snapshot.json, apps/api/drizzle/meta/_journal.json, apps/api/src/db/schema.ts, apps/api/src/auth/hub-session-store.ts, apps/api/src/middleware/app-auth.ts, apps/api/src/auth/__tests__/hub-session-store.test.ts, apps/api/src/middleware/__tests__/app-auth-bff-wiring.test.ts, apps/api/test/rls/hub-bff-session-store.test.ts, CLAUDE.md]
acceptance: A session row carries a NOT NULL `absolute_expires_at` written once at create from `SESSION_ABSOLUTE_TTL_MS`, no rotation ever moves it, `withSession` deletes the row inside its own transaction and reports absent when EITHER `expires_at` or `absolute_expires_at` has passed, and `deleteExpiredHubBffSessions` removes a row expired by either timestamp - each proven by the named oracles below.
---

# 02 - Absolute session lifetime

## Context

`SESSION_TTL_MS` is 30 days and it is SLIDING: `update()` rewrites `expires_at` to `now + 30 days` on every refresh-token rotation.
An idle session dies after 30 days; an active one never dies at all.
A stolen session id that the attacker keeps refreshing therefore stays valid forever, and there is no upper bound at which the operator is forced back through the Hub.

This is the narrower of the two defects `MIGRATION.md` describes under "Sessions now expire".
We are **not** carrying the "sessions that never expire" regression the Hub warned about: that one happens when a 1.2.0 record shape (no expiry fields at all) is ported verbatim onto a database, and our 1.2.0 store already wrote and enforced a real `expires_at` column.
What we are missing is only the hard ceiling.

The fix is one column, one constant, one extra term in one predicate, and one extra term in the nightly sweep.
Everything else in the session layer - the RLS posture, `getAdminDb()`, the AES-256-GCM sealer keyed by HKDF-SHA256 from `FXL_HUB_SECRET_KEY` with the row id as AEAD additional data - is unchanged and must not be touched.

## How this composes with slice 01

Slice 01 established the invariant this slice must not undo.

The SDK spreads the stored record straight back into `tx.update` (`dist/server.js:464`, `/auth/refresh`, and `519` in `/auth/switch`):

```js
if (rotated) await tx.update({ ...record, hubRefreshToken: rotated });
```

`record` is exactly what our `tx.get()` returned.
The SDK does not slide `expiresAt` and it does not touch `absoluteExpiresAt`.
So a store that naively honours the timestamps coming back in `record` turns our 30-day SLIDING window into a hard 30-day CAP measured from login.

Slice 01's decision, which this slice keeps verbatim: **our `update` deliberately ignores `record.expiresAt` and recomputes `expires_at = now + SESSION_TTL_MS`.**
Do not re-litigate it.

The two expiries now travel on the same record through that same spread, so state the interaction plainly:

- `expiresAt` is **ignored on the way in and recomputed** on every `update`. That is the sliding rule.
- `absoluteExpiresAt` is **ignored on the way in and not written at all** on `update`. It is absent from the `.set({...})` object entirely, so the stored value survives untouched. That is the absolute rule.

Both fields arrive from the SDK and neither is honoured, but for opposite reasons, and the reasons must both be in comments at the call site.
The symmetry is the point: our store is the sole author of both columns, so no SDK-side value can move either one.

There is a second SDK interaction that only becomes live in this slice.
`/auth/refresh` and `/auth/switch` re-check the record we hand back, immediately after `tx.get()`:

```js
if (!record || record.expiresAt && now() >= Date.parse(record.expiresAt) || record.absoluteExpiresAt && now() >= Date.parse(record.absoluteExpiresAt)) {
  if (record) await tx.delete();
  return { status: 401, body: { error: "no_session" }, clear: true };
}
```

Today that branch is inert for the absolute field, because slice 01's `get()` returns no `absoluteExpiresAt`.
Once this slice returns it, the SDK gains a redundant second gate over the same value our own predicate already checked microseconds earlier inside the same transaction.
That is fine and is defence in depth: our check fires first and deletes the row, so the SDK's can only fire on a clock reading taken between the two, and both agree because both read the same value.

Note the `Date.parse` in that branch.
It is why constraint 6 below is not cosmetic: hand the SDK a `Date` object instead of an ISO string and `Date.parse(<Date>)` is `NaN`, `now() >= NaN` is `false`, and the SDK's gate silently disarms without any type error.

## The migration

New file `apps/api/drizzle/0021_hub_session_absolute_ttl.sql`.
This is an ORDINARY migration, not a phased one: `apps/api/src/db/migration-runner.ts:71` hardcodes `0018_professional_payable_identity` as the only phased tag and rejects the phased header on any other, so 0021 must NOT carry `-- fxl-migration-mode: phased` or any `-- fxl-phase:` marker.
It runs inside the runner's standard single transaction, which is also what makes the `set_config` below hold across the statements.

### The SQL, verbatim

```sql
-- Absolute session lifetime for the Hub BFF session store.
--
-- expires_at is SLIDING: hub-session-store.ts rewrites it to now + SESSION_TTL_MS
-- (30 days) on every refresh-token rotation. An idle session dies; an ACTIVE one
-- never did, so a stolen session id that the attacker keeps refreshing stayed valid
-- forever. absolute_expires_at is the hard ceiling: written ONCE at session create
-- and never moved by a rotation.
--
-- Backfill: created_at + 90 days, the same window a session created after this
-- migration gets. created_at is the row's only creation anchor and it is NOT NULL
-- with a now() default since 0016, so it is exact rather than approximate.
--
-- This backfill logs NOBODY out. hub_bff_sessions was created by
-- 0016_hub_bff_session_store on 2026-08-03, so on the day this ships no row can be
-- more than a few days old and no backfilled value can already be in the past.
-- That safety argument HAS A SHELF LIFE: it holds only while the oldest row is under
-- 90 days old. If this migration sits unshipped past 2026-11-01, any row older than
-- 90 days would be backfilled into the past and die on its next access. Re-check
-- before shipping if this is delayed.
-- The two alternatives were both rejected: leaving the column NULL on existing rows
-- makes every currently-live session immortal forever, which is the exact defect
-- this migration exists to close; anchoring on now() instead of created_at grants
-- every existing session a fresh full window and quietly rewards the session that
-- has been alive longest.
--
-- NOT NULL, deliberately, and with NO column default. The SDK's bundled DDL leaves
-- both expiry columns nullable because its store treats a missing value as "no
-- expiry" - which is precisely the state that must be unrepresentable here. With no
-- default, an INSERT that forgets the column fails loudly instead of silently
-- minting an uncapped session, and Drizzle's inferred insert type makes the omission
-- a compile error.
--
-- hub_bff_sessions is FORCE ROW LEVEL SECURITY with only the app.fxl_admin policy,
-- so in a deployment whose migration role is the table owner rather than a
-- superuser the UPDATE below would match ZERO rows without an admin session
-- context. Same reason and same shape as the backfill in 0020 and the system-função
-- seed in 0012. If it were ever dropped the SET NOT NULL that follows would fail on
-- the remaining NULLs, so the failure mode is loud, not silent.
--
-- Down path: ALTER TABLE hub_bff_sessions DROP COLUMN absolute_expires_at, and drop
-- the index. No data is lost that is not derivable from created_at.

ALTER TABLE "hub_bff_sessions" ADD COLUMN "absolute_expires_at" timestamp with time zone;--> statement-breakpoint
SELECT set_config('app.fxl_admin', 'true', true);--> statement-breakpoint
UPDATE "hub_bff_sessions" SET "absolute_expires_at" = "created_at" + interval '90 days' WHERE "absolute_expires_at" IS NULL;--> statement-breakpoint
ALTER TABLE "hub_bff_sessions" ALTER COLUMN "absolute_expires_at" SET NOT NULL;--> statement-breakpoint
-- The nightly sweep deletes on `expires_at <= now OR absolute_expires_at <= now`.
-- A row can be past the absolute ceiling while its sliding expiry is still 29 days
-- in the future - that is the whole point of the column - so the OR branch is
-- genuinely reachable and the existing hub_bff_sessions_expires_at_idx does not
-- serve it.
CREATE INDEX "hub_bff_sessions_absolute_expires_at_idx" ON "hub_bff_sessions" USING btree ("absolute_expires_at");
```

`hub_bff_login_txns` is NOT touched.
A login transaction lives 10 minutes and is deleted on consume whether expired or not (slice 01, `consumeLoginTransaction`), so a second ceiling on it would bound nothing that is not already bounded.

### The journal and snapshot

Generate with `pnpm --filter @fxl-sales/api db:generate` and then REPLACE the generated `0021_*.sql` body with the SQL above, keeping the generated `meta/0021_snapshot.json` and the generated `_journal.json` entry (`"idx": 21`, `"version": "7"`, `"tag": "0021_hub_session_absolute_ttl"`, `"breakpoints": true`).
Rename the generated file to `0021_hub_session_absolute_ttl.sql` and update the `tag` to match; drizzle-kit's random name is never kept in this repo (see `0016`, `0017`, `0020`).
Do not hand-write the snapshot.

## The schema change

`apps/api/src/db/schema.ts`, in `hubBffSessions` (currently lines 947-958):

```ts
export const hubBffSessions = pgTable(
  'hub_bff_sessions',
  {
    id: text('id').primaryKey(), // opaque, 256-bit, base64url
    hubRefreshTokenEnc: text('hub_refresh_token_enc').notNull(), // AES-256-GCM, aad = id
    accountId: text('account_id'),
    /** SLIDING: rewritten to now + SESSION_TTL_MS on every rotation. */
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    /**
     * ABSOLUTE ceiling: written once at create, never moved by a rotation. NOT NULL
     * with no default so an uncapped session is unrepresentable and a forgotten
     * insert is a compile error rather than an immortal session.
     */
    absoluteExpiresAt: timestamp('absolute_expires_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index('hub_bff_sessions_expires_at_idx').on(t.expiresAt),
    index('hub_bff_sessions_absolute_expires_at_idx').on(t.absoluteExpiresAt),
  ],
);
```

## The chosen TTL values

```ts
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
```

Restated for the record, because constraint 4 is about NOT drifting into the SDK's numbers by inaction:

- **Sliding stays 30 days.** The SDK's default is 90. Adopting it silently would triple our re-authentication window as a side effect of an SDK bump, which is a security regression nobody decided on.
- **Absolute is 90 days.** The SDK's default is 365. Same reasoning in the other direction: a default chosen for a generic SDK is not a decision this product made.

Both are passed to `createHubBff` explicitly (below), so the two numbers appear once each and the SDK's defaults are never in play.

## The store changes

All in `apps/api/src/auth/hub-session-store.ts`, on top of the shape slice 01 leaves behind.

### The ONE conversion boundary (constraint 6)

Our columns are `timestamptz` and Drizzle hands back a `Date`.
`HubSessionRecord` types both expiry fields as an optional ISO `string`, and the SDK reads them with `Date.parse`.
Slice 01 does that conversion inline inside `get`; with two fields it becomes a named module-private function, and it is the ONLY place a `Date` becomes an SDK string:

```ts
type HubBffSessionRow = typeof hubBffSessions.$inferSelect;

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
```

### `create` - the ONE place `absolute_expires_at` is written

```ts
const now = this.#now().getTime();
// ...
await this.#db.insert(hubBffSessions).values({
  id,
  hubRefreshTokenEnc: this.#sealer.seal(data.hubRefreshToken, id),
  accountId: data.accountId ?? null,
  expiresAt: new Date(now + SESSION_TTL_MS),
  // Written ONCE, here, and nowhere else in this file. No rotation moves it; that
  // is the entire point of the column. `data.absoluteExpiresAt` from the SDK is
  // deliberately ignored for the same reason `data.expiresAt` is: this store owns
  // both columns, the nightly sweeper and the sliding rule, and it has to be
  // correct standing alone rather than only when the caller remembered to pass
  // sessionAbsoluteTtlSeconds. createHubBff IS given matching values so the two
  // views agree - see app-auth.ts - but nothing here depends on that.
  absoluteExpiresAt: new Date(now + SESSION_ABSOLUTE_TTL_MS),
});
```

Read the clock ONCE per `create` into `now` and derive both timestamps from it, so the two can never be anchored to different milliseconds.

### `withSession` - the expiry predicate

Slice 01 wrote the branch as one predicate over the row precisely so this slice adds a term and restructures nothing:

```ts
const now = this.#now().getTime();
let row = rows[0] ?? null;

// Past EITHER timestamp: delete inside this transaction and report absent, per
// MIGRATION.md ("A store implementing withSession should treat a record past
// either timestamp as absent: delete it inside the transaction and resolve null").
// The absolute term is not redundant with the sliding one: a row rotated yesterday
// has expires_at 29 days in the future while absolute_expires_at may already have
// passed, and that row is exactly the one this slice exists to kill.
if (
  row &&
  (row.expiresAt.getTime() <= now || row.absoluteExpiresAt.getTime() <= now)
) {
  await tx.delete(hubBffSessions).where(eq(hubBffSessions.id, sessionId));
  row = null;
}
```

The delete-and-report-absent path is unchanged from slice 01 and is not re-derived here: the row is deleted on the SAME `tx` handle that holds the `SELECT ... FOR UPDATE`, so it commits or rolls back with everything else in the transaction, and `row = null` makes `tx.get()` resolve `null` for the rest of the operation.
The SDK then answers `401 no_session` with `clear: true` and deletes the session cookie, which is correct - the session really is over.

`tx.get` becomes `live && token !== null ? toSessionRecord(live, token) : null`.

### `withSession` - `tx.update` must NOT carry the column

```ts
update: async (record) => {
  await tx
    .update(hubBffSessions)
    .set({
      hubRefreshTokenEnc: this.#sealer.seal(record.hubRefreshToken, sessionId),
      accountId: record.accountId ?? null,
      // SLIDING, deliberately ignoring record.expiresAt: the SDK spreads back the
      // value it got from get() (dist/server.js:464), so honouring it would freeze
      // the TTL at 30 days from login.
      expiresAt: new Date(this.#now().getTime() + SESSION_TTL_MS),
      // absoluteExpiresAt is ABSENT from this object ON PURPOSE, and record
      // .absoluteExpiresAt is ignored for the mirror-image reason. A rotation must
      // never extend the ceiling, so the safest expression of that is to have no
      // statement here that could write it. Adding it back - even as
      // `record.absoluteExpiresAt` - restores the immortal session.
      updatedAt: new Date(),
    })
    .where(eq(hubBffSessions.id, sessionId));
},
```

### `deleteExpiredHubBffSessions`

```ts
import { eq, lte, or } from 'drizzle-orm';

/** Cleanup, called by the nightly scheduler. Returns rows removed. */
export async function deleteExpiredHubBffSessions(
  db: NodeDb,
): Promise<{ sessions: number; loginTxns: number }> {
  const now = new Date();
  // EITHER timestamp, matching withSession's predicate and the SDK's bundled DDL
  // sweep (schema/session-store.sql, "expiry sweep"). withSession already deletes an
  // expired row on access, so this is only about rows nobody comes back for - which
  // is exactly the stolen-and-abandoned session the absolute ceiling is for.
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
```

`apps/api/src/jobs/nightly-job.ts` needs no change - `runHubSessionCleanup` already delegates - and `apps/api/src/jobs/__tests__/nightly-job.test.ts` mocks the function, so neither is in `files_modified`.

### `app-auth.ts` - wiring the SDK's view (constraint 4)

Slice 01 says not to pass these options, on the grounds that the store ignores the record fields they produce.
Slice 02 supersedes that specific line and passes both, because the SDK's own post-`get()` gate at `dist/server.js:424` and `483` now reads the values our `get()` returns, and because a silent 90/365 default sitting behind an unset option is the exact drift constraint 4 exists to stop.

In `createAppAuthBff()`, add the import and the option:

```ts
import {
  createHubSessionStore,
  SESSION_ABSOLUTE_TTL_MS,
  SESSION_TTL_MS,
} from '../auth/hub-session-store.js';

const bff = createHubBff(hubSdkConfig, {
  sessionStore: session.store,
  secureCookies,
  redirectUri: resolveHubRedirectUri(process.env),
  postLoginRedirect: resolveHubPostLoginRedirect(process.env),
  postLoginErrorRedirect: resolveHubPostLoginErrorRedirect(process.env),
  timeoutMs: HUB_BFF_TIMEOUT_MS,
  // Derived from the store's own constants, so the SDK's view of a session's
  // lifetime and the store's cannot disagree. The store ignores the values the SDK
  // computes from these (it owns both columns), so passing them is DECLARATIVE - it
  // exists to keep the SDK's 90-day sliding / 365-day absolute DEFAULTS out of play
  // and to make a future divergence a test failure rather than a surprise.
  sessionTtlSeconds: SESSION_TTL_MS / 1000,
  sessionAbsoluteTtlSeconds: SESSION_ABSOLUTE_TTL_MS / 1000,
});
```

## RED tests - the locked oracle

Write these FIRST; each must fail before the change and pass after.

### 1. `apps/api/src/auth/__tests__/hub-session-store.test.ts`

Uses the hand-rolled fake `db` harness slice 01 introduces in `describe('withSession failure semantics')`; no database needed.
Extend that fake so `transaction` yields a `tx` whose `select().from().where().for('update').limit()` resolves a controllable row array and whose `update`/`delete` record their arguments.

In `describe('TTLs')`:

- `it('keeps the session TTL at 30 days and caps it with a 90-day absolute TTL')`
  Pins both constants, and asserts `SESSION_ABSOLUTE_TTL_MS > SESSION_TTL_MS` so the pair can never be inverted into a ceiling that pre-empts the sliding window.

New `describe('absolute session lifetime')`:

- `it('sets the absolute expiry once at create from the store constant, ignoring the value the SDK supplies')`
  Call `create({ hubRefreshToken: 't', expiresAt: <+10y ISO>, absoluteExpiresAt: <+10y ISO> })` with a frozen `now`.
  Assert the inserted `absoluteExpiresAt` is exactly `now + SESSION_ABSOLUTE_TTL_MS` and the inserted `expiresAt` is exactly `now + SESSION_TTL_MS`.
- `it('does not extend the absolute expiry when the SDK spreads the record back into update')`
  **The constraint-2 oracle.**
  Drive `withSession` with an operation that reproduces `dist/server.js:464` byte for byte: `const record = await tx.get(); await tx.update({ ...record, hubRefreshToken: 'rotated' });`.
  Assert the captured `.set()` payload has NO `absoluteExpiresAt` key at all (`expect('absoluteExpiresAt' in setArg).toBe(false)`), and, as the non-vacuity half, that the same payload's `expiresAt` DID move forward.
  Asserting the key's absence rather than its value is deliberate: a `set` that writes back the same value would pass a value comparison today and become an extension the moment `#now()` leaks into it.
- `it('deletes the row inside the transaction and reports absent when only the absolute expiry has passed')`
  Row with `expiresAt` 29 days in the future and `absoluteExpiresAt` one second in the past.
  Assert `tx.get()` resolved `null`, and that a `delete` was issued on the SAME `tx` handle before the operation observed anything.
  This is the branch that is red without the new term and green with it.
- `it('deletes the row and reports absent when only the sliding expiry has passed')`
  The mirror, so a future edit cannot fix the absolute term by breaking the sliding one.
- `it('reports a live record when neither expiry has passed')`
  The non-vacuity control for both tests above.
- `it('hands the SDK both expiries as ISO strings the SDK can Date.parse')`
  **The constraint-6 oracle.**
  Assert `typeof record.expiresAt === 'string'`, `typeof record.absoluteExpiresAt === 'string'`, and `Number.isFinite(Date.parse(record.absoluteExpiresAt))`.
  Without it, returning the raw Drizzle `Date` type-checks against `string` nowhere useful at runtime and silently disarms the SDK's own gate.

### 2. `apps/api/src/middleware/__tests__/app-auth-bff-wiring.test.ts`

Keep every existing assertion, including the store-instance identity and `timeoutMs`.

- `it('wires the SDK session TTLs to the store constants so the two views cannot disagree')`
  `expect(bffOptions?.sessionTtlSeconds).toBe(SESSION_TTL_MS / 1000)` and `expect(bffOptions?.sessionAbsoluteTtlSeconds).toBe(SESSION_ABSOLUTE_TTL_MS / 1000)`.
  Then assert the resolved numbers directly - `2_592_000` and `7_776_000` - so deleting the option and letting the SDK default to `7_776_000` / `31_536_000` fails on the second assertion even if someone "simplified" the first into a tautology.

### 3. `apps/api/test/rls/hub-bff-session-store.test.ts`

Against real Postgres over the admin connection, as the file already does.

First, a mechanical fix the NOT NULL forces: the two raw `INSERT INTO hub_bff_sessions (id, hub_refresh_token_enc, expires_at)` statements (around lines 435 and 448) must supply `absolute_expires_at`.
Give the pre-existing rows a far-future value so their meaning is unchanged.

- `it('treats a session past only its absolute expiry as absent and deletes the row inside the transaction')`
  Insert with `expires_at = now() + interval '29 days'` and `absolute_expires_at = now() - interval '1 second'`.
  Run `withSession` with an operation that returns `await tx.get()`; assert it resolved `null` and that `SELECT id FROM hub_bff_sessions WHERE id = ...` is empty afterwards.
- `it('does not move absolute_expires_at when a rotation slides expires_at')`
  **The integration-grade constraint-2 oracle.**
  Read both columns, run `withSession` with the `{ ...record, hubRefreshToken: 'rotated' }` spread, re-read both.
  Assert `expires_at` moved strictly forward AND `absolute_expires_at` is byte-identical to the value read before.
  This is what catches a port that "helpfully" persists `record.absoluteExpiresAt`.
- `it('removes rows expired by either timestamp and keeps a row expired by neither')`
  Rewrite of the existing `removes only expired rows`, with three sessions: live/live, past-sliding/future-absolute, and future-sliding/past-absolute.
  Assert the first survives and the other two are gone.
  The THIRD row is the non-vacuity: drop the `or(...)` term and it survives while everything else in the test still passes.
  Keep the login-transaction half of the existing assertions unchanged.
- Keep every other test in the file as slice 01 leaves it, adding `absolute_expires_at` to any helper that inserts a session row.

## Verify

Run once, never in watch mode.

```bash
# The named oracles, unit.
pnpm --filter @fxl-sales/api exec vitest run \
  src/auth/__tests__/hub-session-store.test.ts \
  src/middleware/__tests__/app-auth-bff-wiring.test.ts

# Apply the migration to the local Docker test database, then the integration oracle.
pnpm --filter @fxl-sales/api exec vitest run --config vitest.config.ts src/db/__tests__/migration-runner.test.ts
pnpm --filter @fxl-sales/api exec env VITEST_INTEGRATION=1 vitest run \
  test/rls/hub-bff-session-store.test.ts

# Lint the diff.
pnpm --filter @fxl-sales/api lint

# Full gate.
pnpm run lint
pnpm run type-check
pnpm test
pnpm run build
pnpm --filter @fxl-sales/api test:integration
```

Then confirm the migration is well-formed and actually landed:

```bash
# 0021 must NOT be phased - the runner hardcodes 0018 as the only phased tag.
grep -c "fxl-migration-mode: phased\|fxl-phase:" apps/api/drizzle/0021_hub_session_absolute_ttl.sql

# The journal must carry idx 21 with the matching tag.
tail -12 apps/api/drizzle/meta/_journal.json
```

The first command must print `0`.

## Risks and rollback

- **Does deploying this log anyone out? No, with one bounded exception.**
  The backfill writes `created_at + 90 days`, and `hub_bff_sessions` was created by `0016_hub_bff_session_store` on 2026-08-03, so on the day this ships the oldest possible row is a few days old and no backfilled ceiling is in the past.
  Every existing session keeps working until its own 90-day mark.
  Independently of this slice, slice 01's own risk note stands: the SDK bump itself does not truncate the table.
- **The one exception is the rolling-deploy window on `/auth/callback`.**
  Migrations run in the production entrypoint before the server starts (`apps/api/src/config/__tests__/docker-migration-contract.test.ts` pins this), so a single replica's code and schema are atomic.
  But during a rolling deploy an OLD replica still running the slice-01 `create` inserts without `absolute_expires_at`, which the new `NOT NULL` rejects.
  Effect: for the overlap window, a NEW login on an old replica fails.
  It surfaces as `hubBffErrorHandler`'s `503`, not as a cookie-clearing `401`, so no existing session is harmed and the operator succeeds on retry.
  This is accepted rather than engineered around: the alternatives are a column default (which reintroduces the silent uncapped-session path this migration exists to remove) or a two-release expand/contract for a table that is four days old and holds only re-creatable credentials.
- **Rejected alternative, do not re-litigate.**
  Keeping the column NULLABLE and having the read path treat `NULL` as `created_at + SESSION_ABSOLUTE_TTL_MS` would remove that window entirely.
  It was rejected because it puts two sources of truth on one fact, forces a `COALESCE` expression into the nightly sweep's `WHERE`, and leaves a `NULL` branch that can never be retired.
- **Index cost.** One extra btree on a table that holds at most one row per live session. Negligible, and the sweep's `OR` branch is unservable without it.
- **A wrong `SESSION_ABSOLUTE_TTL_MS` is a slow-motion mass logout.** Ninety days after deploy, every account created around the same time hits the ceiling within days of each other, so the first real exercise of this code is a synchronized re-login wave. That is the intended behaviour and needs no mitigation, but it should not be a surprise to whoever is on call that week.
- **Rollback** is `git revert` of the commit plus a down migration:
  `DROP INDEX "hub_bff_sessions_absolute_expires_at_idx"; ALTER TABLE "hub_bff_sessions" DROP COLUMN "absolute_expires_at";`
  No session data is lost - the reverted code reads and writes the remaining columns exactly as slice 01 left them, and the dropped value was derivable from `created_at` anyway.
  Reverting restores the immortal-active-session gap, so it is a stopgap, not a resting state.

## CLAUDE.md

Extend the Auth Model paragraph slice 01 rewrote (the one beginning "`HubSessionStore` is ASYNC and TRANSACTIONAL as of `@fxl-business/hub-sdk@1.3.0`").
Replace its sentence "A row past `expires_at` is deleted inside the same transaction and reported absent..." with:

> A row past EITHER `expires_at` or `absolute_expires_at` is deleted inside the same transaction and reported absent; a seal that will not open reports absent and LEAVES the row, because a wrong key must cost one re-login rather than destroy data.
> `expires_at` is SLIDING (30 days, rewritten by `update`) and `absolute_expires_at` is a hard ceiling (90 days, written ONCE by `create` and absent from `update`'s `set` object entirely), so a continuously refreshing session cannot live forever.
> `update` deliberately ignores BOTH timestamps the SDK spreads back from `get` (`dist/server.js:464`): honouring `expiresAt` would freeze the sliding TTL at 30 days from login, and honouring `absoluteExpiresAt` would let a rotation extend the ceiling.
> `createHubBff` is given `sessionTtlSeconds` and `sessionAbsoluteTtlSeconds` derived from those same constants, so the SDK's 90-day sliding / 365-day absolute defaults are never in play, and both expiries reach the SDK as ISO strings through the single `toSessionRecord` boundary - the SDK reads them with `Date.parse`, and a `Date` object there yields `NaN` and silently disarms its own gate.
> The nightly `deleteExpiredHubBffSessions` sweeps on either timestamp.
