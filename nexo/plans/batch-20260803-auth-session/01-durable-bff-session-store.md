---
id: 01-durable-bff-session-store
milestone: v2.4.0
status: todo
depends_on: []
files_modified: [apps/api/src/auth/session-crypto.ts, apps/api/src/auth/hub-session-store.ts, apps/api/src/auth/hub-session-scope.ts, apps/api/src/auth/__tests__/session-crypto.test.ts, apps/api/src/auth/__tests__/hub-session-store.test.ts, apps/api/src/middleware/app-auth.ts, apps/api/src/db/schema.ts, apps/api/src/env.ts, apps/api/src/jobs/nightly-job.ts, apps/api/drizzle/0016_hub_bff_session_store.sql, apps/api/drizzle/meta/_journal.json, apps/api/drizzle/meta/0016_snapshot.json, apps/api/test/rls/hub-bff-session-store.test.ts, apps/api/.env.dev.example]
acceptance: "given a Hub BFF session created through one store instance backed by Postgres, when a second, independent store instance is constructed against the same database (which is what an API restart or a second replica is), then that second instance resolves the session and its most recently rotated Hub refresh token, while the SDK's InMemoryHubSessionStore resolves null for the same session id"
---

# 01 - durable BFF session store

## Problem restated

`createAppAuthBff()` in `apps/api/src/middleware/app-auth.ts` calls `createHubBff(hubSdkConfig, { redirectUri, postLoginRedirect, postLoginErrorRedirect })` and passes no `sessionStore`.
`createHubBff` therefore does `const store = options.sessionStore ?? new InMemoryHubSessionStore()` (`dist/server.js:300`), and that class is documented as "Sessions + login txns live only in this process - gone on restart."
The browser holds only the opaque `fxl_hub_session` cookie; the Hub refresh token lives only in that in-process `Map`.
So every restart or redeploy invalidates every session, and with more than one replica a session created on A is invisible on B.

## The hard constraint

`HubSessionStore` is **synchronous** (`session-store-DWZng0L9.d.ts`):

```ts
create(data: HubSessionRecord): string;
get(sessionId: string): HubSessionRecord | null;
update(sessionId: string, hubRefreshToken: string): void;
delete(sessionId: string): void;
createLogin(tx: HubLoginTransaction): string;
consumeLogin(txId: string): HubLoginTransaction | null;
```

No method may `await`.
`get` in particular is called inline inside `/auth/refresh`, `/auth/switch` and `/auth/logout`, and its result is used immediately to build the Hub back-channel `Cookie` header.

## Design decision

**Hydrate-around-the-handler: a request-scoped in-memory working set, loaded from Postgres before the BFF handler runs and flushed to Postgres after it returns.**

The store keeps a per-request unit of work in an `AsyncLocalStorage`.
A Hono middleware mounted on `/auth/*`, *inside* the router that `createAppAuthBff()` returns, does exactly three things:

1. reads the `fxl_hub_session` and `fxl_hub_login` cookies off the request,
2. `await`s a hydrate that loads those two rows (and only those) into a fresh unit of work,
3. runs the BFF handler inside that scope, then `await`s a flush that writes every buffered mutation in one transaction.

Inside the handler every store method is a pure `Map` operation, which satisfies the synchronous interface exactly.
All I/O happens at the async boundary the middleware owns.
This is the same shape `express-session` has used for two decades: async load in middleware, synchronous access in the handler, async save on the way out.

The working set is **request-scoped, not a long-lived cache**.
It is discarded when the request ends.
That is deliberate and it is the property that makes replicas correct: the Hub rotates the refresh token on every `/auth/refresh` (`parseRotatedRefresh` -> `store.update`), so replica B must never serve a token it cached before replica A rotated it.
Re-reading one indexed primary-key row per auth request is negligible next to the Hub HTTP round trip that same request already makes, and it removes cache invalidation, cache size caps and cross-replica staleness from the design entirely.

Login transactions get one extra property: hydration consumes them with `DELETE ... WHERE id = $1 AND expires_at > now() RETURNING *`.
Only one replica's `DELETE` can return the row, so the PKCE verifier is genuinely single-use at the database level rather than single-use per process.
That consume-hydrate runs only when the request path ends in `/auth/callback`, which is the only route that consumes a login transaction; on any other route the `fxl_hub_login` cookie is left untouched.

### Rejected alternative 1: stateless, sealed session id (no store at all)

Make the session id itself an AEAD-sealed blob carrying the refresh token, so `get` is a synchronous decrypt and needs no backing store.
This is attractive and it is **wrong here**, for one decisive reason: `update(sessionId, hubRefreshToken)` returns `void` and the BFF never re-sets the session cookie after it (`dist/server.js:412-413` rotates and then returns JSON).
A stateless id therefore has nowhere to record a rotated refresh token, and the browser keeps presenting a sealed id containing the token the Hub has already retired.
The first rotation would silently kill the session, which is a worse failure than the one being fixed.
Rejected.

### Rejected alternative 2: write-through in-memory cache plus fire-and-forget async persistence

Writes go to a `Map` and are asynchronously mirrored to Postgres.
This fixes nothing on the read path, which is the path that is broken.
`get` and `consumeLogin` are synchronous, so a cold process (restart) or a foreign replica has nothing in its `Map` and cannot `await` the read that would repair it.
It would pass a naive CRUD test and still fail the restart oracle.
Rejected.

### Rejected alternative 3: synchronous database access via `Atomics.wait` and a worker thread

Technically possible (the `synckit` / `sync-rpc` pattern) and it would satisfy the interface literally.
It blocks the Node event loop for the whole database round trip on every session read, serializing every other in-flight request behind it.
Unacceptable in a web API.
Rejected.

### Rejected alternative 4: Redis

Redis has no synchronous client either, so it would need the identical hydrate-around-the-handler wrapper.
It also adds an infrastructure component this repo does not have (`docker-compose.yml` ships Postgres only) for zero additional correctness.
Postgres is already the durable, shared, backed-up store.
Rejected.

### Storage of the refresh token: encrypted at rest

The Hub refresh token is a live bearer credential.
Database access control alone is not enough, because the blast radius of a plaintext column includes every logical backup, every staging dump taken from production, every replication stream and every `SELECT` from any code path that reaches the admin connection.
Every stored secret is sealed with **AES-256-GCM**, with the row's own id as the AEAD additional data so a ciphertext cannot be moved between rows.

The key is derived with **HKDF-SHA256** from `FXL_HUB_SECRET_KEY` unless `HUB_SESSION_ENCRYPTION_KEY` is set, in which case that is the input keying material.
Deriving from the Hub secret key by default means **zero new required environment variables**: `loadHubAuthConfig` already makes `FXL_HUB_SECRET_KEY` mandatory wherever the BFF exists, so there is no deploy in which the BFF runs and the key is missing.
The key material is also exactly as sensitive as what it protects: anyone holding the Hub client secret can already act as this product against the Hub, so this adds no new secret to guard.
The explicit override exists for operators who want to rotate session encryption independently of the Hub client secret.

Consequence, and it is documented in the module header: rotating `FXL_HUB_SECRET_KEY` invalidates every stored session.
Decryption failure is treated exactly as "unknown session", so the user simply logs in again.

### RLS and grants on a non-tenant table

A BFF session row exists **before a workspace is known**.
`store.create({ hubRefreshToken })` is called at `/auth/callback` with no workspace and no account id, and the active workspace only appears later inside the access token.
There is therefore no `org_id` to key a tenant policy on, and the standard `sales_ops_*` tenant policy is inapplicable by construction.

The precedent for a global table in this schema is `webhook_events`, which carries no RLS at all.
That precedent is **not** followed here, because these rows are bearer credentials rather than idempotency keys.
Both new tables get `ENABLE ROW LEVEL SECURITY` plus `FORCE ROW LEVEL SECURITY` and exactly one policy, the existing `app.fxl_admin` admin-context policy:

```sql
USING (current_setting('app.fxl_admin', true) = 'true')
WITH CHECK (current_setting('app.fxl_admin', true) = 'true')
```

The effect is a real boundary rather than a decoration: the ordinary tenant connection returned by `getDb()` never sets `app.fxl_admin`, so from every tenant-scoped route in the application these tables contain zero rows and accept zero writes.
An injection or a stray join in a tenant route cannot exfiltrate a refresh token.
The store reads and writes through `getAdminDb()`, whose pool sets `app.fxl_admin = 'true'` in the connection startup packet (`apps/api/src/db/client.ts:38-42`), so it is the only code path with access.

Grants stay out of the migration, matching `test/rls/global-setup.ts` ("Cluster roles are provisioned outside application migrations") and the existing `drizzle/*.sql` files, none of which contains a `GRANT`.
See Risks for the local `fxl_sales_test` grant if the integration run reports `permission denied`.

### TTL and cleanup

- `SESSION_TTL_MS = 30 days`, sliding: `expires_at` is rewritten to `now + 30 days` on every `update`, which is every refresh-token rotation.
  Thirty idle days means re-login.
  The Hub's own refresh-token lifetime remains authoritative; this bound exists so the table cannot grow without limit and so an abandoned session stops being a usable credential.
- `LOGIN_TX_TTL_MS = 10 minutes`, matching the SDK's `LOGIN_TX_MAX_AGE_SECONDS = 600` cookie max-age byte for byte (`dist/server.js:275`).
- Expiry is enforced **on read**, not only by the sweeper: every hydrate query carries `AND expires_at > now()`, so an expired row can never resolve even if cleanup has not run.
- Cleanup is a second `node-cron` task registered by the existing `setupNightlyJob()` in `apps/api/src/jobs/nightly-job.ts`, at `15 3 * * *`, with its own `try`/`catch` so a failure in one task cannot skip the other.
  That file's header explicitly requires new jobs to register on this scheduler rather than starting a second one, and it keeps `server.ts` unchanged.

### Failure semantics, and why they matter to the rest of the batch

- **Hydrate fails (database down).** The middleware answers `503 {error:'unavailable', code:'session_store_unavailable'}` and never calls `next()`.
  It must not degrade to an empty working set, because the BFF would then see `store.get(...) === null`, answer `401 no_session` **and delete the session cookie** (`dist/server.js:382-384`).
  A two-second database blip would permanently log out every user.
  A `503` is the honest signal and leaves the cookie intact.
- **Flush fails.** Logged at error, never rethrown.
  The response has already been formed and rethrowing would turn a successful login into a 500.
  The cost of a lost flush is bounded: a lost `create` means the next refresh 401s and the user logs in again; a lost `update` means the next refresh presents a retired token and the user logs in again.
- **Store methods called outside a request scope.** Throw `HubSessionScopeError`.
  This is loud on purpose.
  The only mount point is inside `createAppAuthBff()`, where the middleware cannot be forgotten, and a silent fallback to process-local state would reintroduce exactly the bug this slice removes.

## Files to create

### 1. `apps/api/src/auth/session-crypto.ts` (new)

```ts
import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'node:crypto';

const HKDF_SALT = 'fxl-sales/hub-bff-session/v1';
const HKDF_INFO = 'aes-256-gcm';
const FORMAT_VERSION = 'v1';
const IV_BYTES = 12;
const MIN_IKM_LENGTH = 32;

export type SessionSealer = {
  /** AES-256-GCM seal. `aad` binds the ciphertext to its row id. */
  seal(plaintext: string, aad: string): string;
  /** Returns null on ANY failure: bad format, wrong key, tampered ciphertext, wrong aad. */
  open(sealed: string, aad: string): string | null;
};

export function deriveSessionKey(ikm: string): Buffer { /* hkdfSync('sha256', ikm, HKDF_SALT, HKDF_INFO, 32) */ }

export function createSessionSealer(ikm: string): SessionSealer { /* ... */ }
```

- `createSessionSealer` throws `new Error('hub session encryption key must be at least 32 characters')` when `ikm.length < MIN_IKM_LENGTH`.
  HKDF accepts arbitrary-length input keying material, so there is deliberately no base64 or hex format requirement; a length floor is the only ops-facing rule.
- Sealed format: `v1.<b64url(iv)>.<b64url(authTag)>.<b64url(ciphertext)>`.
- `open` returns `null` rather than throwing, for every failure mode, so callers have exactly one branch: no plaintext means "unknown session".
- Module header must state that rotating `FXL_HUB_SECRET_KEY` invalidates every stored session.

### 2. `apps/api/src/auth/hub-session-store.ts` (new)

Exports:

```ts
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
export const LOGIN_TX_TTL_MS = 10 * 60 * 1000;   // === the SDK's LOGIN_TX_MAX_AGE_SECONDS

export class HubSessionScopeError extends Error {}
export class HubSessionStoreUnavailableError extends Error {}

export type HubSessionHydrateInput = {
  sessionId?: string | undefined;
  loginTxId?: string | undefined;
  /** Consume-on-hydrate. True only on /auth/callback. */
  consumeLoginTx: boolean;
};

export interface DurableHubSessionStore extends HubSessionStore {
  withRequest<T>(input: HubSessionHydrateInput, fn: () => Promise<T>): Promise<T>;
}

export function createDurableHubSessionStore(deps: {
  db: NodeDb;                 // drizzle instance; the ADMIN connection
  sealer: SessionSealer;
  now?: () => Date;           // injectable for the expiry test
}): DurableHubSessionStore;

/** Env-reading factory used by app-auth. Explicit union so the caller cannot mis-wire the middleware. */
export function createHubSessionStore(deps: {
  databaseUrlPresent: boolean;
  nodeEnv: string;
  encryptionIkm: string;
}): { kind: 'durable'; store: DurableHubSessionStore } | { kind: 'memory'; store: HubSessionStore };

/** Cleanup, called by the nightly scheduler. Returns rows removed. */
export function deleteExpiredHubBffSessions(db: NodeDb): Promise<{ sessions: number; loginTxns: number }>;
```

`HubSessionStore`, `HubSessionRecord`, `HubLoginTransaction` and `InMemoryHubSessionStore` are all imported from the package **root** `@fxl-business/hub-sdk` (verified: `dist/index.d.ts:2` re-exports all four; `/server` does not).

Internal unit of work:

```ts
type SessionOp =
  | { kind: 'session.create'; id: string; tokenEnc: string; accountId: string | null; expiresAt: Date }
  | { kind: 'session.update'; id: string; tokenEnc: string; expiresAt: Date }
  | { kind: 'session.delete'; id: string }
  | { kind: 'login.create'; id: string; verifierEnc: string; state: string; expiresAt: Date }
  | { kind: 'login.delete'; id: string };

type UnitOfWork = {
  sessions: Map<string, { record: HubSessionRecord; expiresAt: Date }>;
  logins: Map<string, { tx: HubLoginTransaction; durablyRemoved: boolean }>;
  ops: SessionOp[];
};
```

Method behaviour, exactly:

- `#scope()` returns `this.#als.getStore()` or throws `HubSessionScopeError('hub session store used outside a request scope')`.
- `create(data)`: `id = randomBytes(32).toString('base64url')` (256 bits, above the interface's 128-bit floor).
  `expiresAt = now() + SESSION_TTL_MS`.
  Set the cache entry, push `session.create` with `sealer.seal(data.hubRefreshToken, id)` and `accountId: data.accountId ?? null`.
  Return `id`.
- `get(id)`: cache lookup; return `null` when absent or when `expiresAt <= now()`; otherwise return a **shallow copy** of the record so the SDK cannot mutate the working set.
- `update(id, token)`: no-op when absent (the interface documents "no-op if unknown").
  Otherwise mutate the cached record, set `entry.expiresAt = now() + SESSION_TTL_MS`, push `session.update`.
- `delete(id)`: drop from cache and push `session.delete` unconditionally, so the op is idempotent even if the row was never hydrated.
- `createLogin(tx)`: `id = randomBytes(32).toString('base64url')`, `expiresAt = now() + LOGIN_TX_TTL_MS`, cache with `durablyRemoved: false`, push `login.create` with `sealer.seal(tx.codeVerifier, id)`.
  `state` is stored in plaintext: it is a CSRF nonce that also travels in the query string, it is worthless without the verifier, and keeping it readable makes a stuck-callback incident diagnosable.
- `consumeLogin(id)`: read the cache entry, delete it from the cache, push `login.delete` **only when `durablyRemoved === false`**, return `entry.tx` or `null`.
- `#hydrate(uow, input)`:
  - when `input.sessionId`: `select ... where and(eq(id, sessionId), gt(expiresAt, now()))`; on a hit, `sealer.open(row.hubRefreshTokenEnc, row.id)`; a `null` open is skipped (leaving the working set empty for that id, which reads as an unknown session).
  - when `input.loginTxId && input.consumeLoginTx`: `db.delete(hubBffLoginTxns).where(and(eq(id, loginTxId), gt(expiresAt, now()))).returning()`; on a returned row, `sealer.open(row.codeVerifierEnc, row.id)` and cache with `durablyRemoved: true`.
  - any thrown database error is wrapped and rethrown as `HubSessionStoreUnavailableError`.
- `#flush(uow)`: returns immediately when `uow.ops.length === 0`; otherwise applies every op **in order** inside one `db.transaction`.
  `session.create` and `login.create` are plain inserts; `session.update` writes `hub_refresh_token_enc`, `updated_at = now()` and the slid `expires_at`.
  The whole call is wrapped in `try`/`catch` that logs `[hub-session-store] flush failed` at error and swallows.
- `withRequest(input, fn)`: build a fresh `UnitOfWork`, `als.run(uow, async () => { await hydrate(uow, input); try { return await fn(); } finally { await flush(uow); } })`.
  Hydrate sits **before** the `try`, so a hydrate failure skips both the handler and the flush.
- `createHubSessionStore`: returns `{kind:'durable'}` when `databaseUrlPresent`.
  When it is false and `nodeEnv === 'production'`, **throw** `new Error('DATABASE_URL is required for the durable Hub BFF session store in production')`, mirroring the production-throw precedent in `resolveHubRedirectUri`.
  Otherwise `console.warn('[hub-session-store] DATABASE_URL is not set - falling back to the in-process session store; sessions will NOT survive a restart')` and return `{kind:'memory', store: new InMemoryHubSessionStore()}`.
  The durable branch calls `getAdminDb()` lazily so that constructing the store never forces a connection at import time.

### 3. `apps/api/src/auth/hub-session-scope.ts` (new)

```ts
import { getCookie } from 'hono/cookie';

/** Mirrors dist/server.js:271-273 exactly. */
export const SESSION_COOKIE = 'fxl_hub_session';
export const SESSION_COOKIE_SECURE = '__Host-fxl_hub_session';
export const LOGIN_TX_COOKIE = 'fxl_hub_login';

export function hubSessionCookieName(secureCookies: boolean): string {
  return secureCookies ? SESSION_COOKIE_SECURE : SESSION_COOKIE;
}

export function createHubSessionScopeMiddleware(
  store: DurableHubSessionStore,
  options: { secureCookies: boolean },
): MiddlewareHandler;
```

The middleware:

1. `const sessionId = getCookie(c, hubSessionCookieName(options.secureCookies))`,
2. `const loginTxId = getCookie(c, LOGIN_TX_COOKIE)`,
3. `const consumeLoginTx = c.req.path.endsWith('/auth/callback')`,
4. `await store.withRequest({ sessionId, loginTxId, consumeLoginTx }, async () => { await next(); })`,
5. `catch (err)`: when `err instanceof HubSessionStoreUnavailableError`, log at error and `return c.json({ error: 'unavailable', code: 'session_store_unavailable' }, 503)`; anything else rethrows.

The cookie-name rule is derived from the **same boolean** that is handed to `createHubBff` as `secureCookies`, so the two can never disagree.
This is the one place that couples to SDK internals, and the constants carry a comment naming `@fxl-business/hub-sdk@1.2.0 dist/server.js:271-273` so a bump has an obvious review point.

### 4. `apps/api/test/rls/hub-bff-session-store.test.ts` (new) - the oracle

See "Oracle tests" below.

### 5. `apps/api/src/auth/__tests__/session-crypto.test.ts` and `apps/api/src/auth/__tests__/hub-session-store.test.ts` (new)

Unit suites, no database.
`vitest.config.ts` already includes `src/**/__tests__/**/*.test.ts`, so no config change is needed.

## Files to modify

### 6. `apps/api/src/db/schema.ts`

Append two tables at the end, with a section comment matching the file's existing banner style and stating that these are **global, non-tenant** tables that carry sealed bearer credentials and are readable only under the admin session context.

```ts
export const hubBffSessions = pgTable(
  'hub_bff_sessions',
  {
    id: text('id').primaryKey(),                                   // opaque, 256-bit, base64url
    hubRefreshTokenEnc: text('hub_refresh_token_enc').notNull(),   // AES-256-GCM, aad = id
    accountId: text('account_id'),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index('hub_bff_sessions_expires_at_idx').on(t.expiresAt)],
);

export const hubBffLoginTxns = pgTable(
  'hub_bff_login_txns',
  {
    id: text('id').primaryKey(),
    codeVerifierEnc: text('code_verifier_enc').notNull(),          // AES-256-GCM, aad = id
    state: text('state').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index('hub_bff_login_txns_expires_at_idx').on(t.expiresAt)],
);
```

### 7. `apps/api/src/env.ts`

Add one optional key to the zod schema, beside the other `FXL_HUB_*` entries:

```ts
  // Optional override for the Hub BFF session encryption key. Defaults to an
  // HKDF-SHA256 derivation from FXL_HUB_SECRET_KEY, so no deploy needs this set.
  HUB_SESSION_ENCRYPTION_KEY: emptyToUndefined,
```

### 8. `apps/api/src/middleware/app-auth.ts`

Rewrite `createAppAuthBff()` only.
Everything above it is untouched, so `app-auth.test.ts` keeps passing verbatim.

```ts
export function createAppAuthBff() {
  if (!hubSdkConfig || !hubAuthConfig) {
    return null;
  }

  // ONE boolean drives both the SDK's cookie name and our cookie read.
  const secureCookies = (process.env.NODE_ENV ?? 'development') === 'production';

  const session = createHubSessionStore({
    databaseUrlPresent: Boolean(env.DATABASE_URL),
    nodeEnv: process.env.NODE_ENV ?? 'development',
    encryptionIkm: process.env.HUB_SESSION_ENCRYPTION_KEY ?? hubAuthConfig.secretKey,
  });

  const bff = createHubBff(hubSdkConfig, {
    sessionStore: session.store,
    secureCookies,
    redirectUri: resolveHubRedirectUri(process.env),
    postLoginRedirect: resolveHubPostLoginRedirect(process.env),
    postLoginErrorRedirect: resolveHubPostLoginErrorRedirect(process.env),
  });

  if (session.kind === 'memory') {
    return bff;
  }

  // The hydrate/flush scope is mounted INSIDE the returned router, so server.ts
  // stays `app.route('', authBff)` and the middleware cannot be forgotten.
  const router = new Hono();
  router.use('/auth/*', createHubSessionScopeMiddleware(session.store, { secureCookies }));
  router.route('', bff);
  return router;
}
```

New imports in this file: `Hono` from `hono`, `env` from `../env.js`, `createHubSessionStore` from `../auth/hub-session-store.js`, `createHubSessionScopeMiddleware` from `../auth/hub-session-scope.js`.

`apps/api/src/server.ts` is **not** modified.

### 9. `apps/api/src/jobs/nightly-job.ts`

Add a second scheduled task inside the existing `setupNightlyJob()`, keep the existing single-instance guard shape, and stop it in `stopNightlyJob()`.

```ts
let sessionCleanupTask: ScheduledTask | null = null;
// inside setupNightlyJob(), after the hold-promotion task:
sessionCleanupTask = cron.schedule('15 3 * * *', async () => {
  try {
    const removed = await deleteExpiredHubBffSessions(getAdminDb());
    console.log(`[nightly-job] hub session cleanup: ${removed.sessions} sessions, ${removed.loginTxns} login txns removed`);
  } catch (err) {
    console.error('[nightly-job] hub session cleanup failed:', err);
  }
});
```

Also export `runHubSessionCleanup()` beside `runHoldPromotion()` for symmetry and testability.

### 10. `apps/api/.env.dev.example`

Document the optional key beside the other `FXL_HUB_*` entries, with a comment saying it defaults to a derivation from `FXL_HUB_SECRET_KEY` and that changing either one invalidates all logged-in sessions.

```dotenv
# Optional. Overrides the Hub BFF session encryption key (>= 32 chars).
# Defaults to an HKDF-SHA256 derivation of FXL_HUB_SECRET_KEY, so it can stay blank.
# Changing this value (or FXL_HUB_SECRET_KEY) logs every user out.
HUB_SESSION_ENCRYPTION_KEY=
```

## Migration

Generate with `pnpm --filter @fxl-sales/api db:generate` (which writes `drizzle/0016_*.sql`, `drizzle/meta/0016_snapshot.json` and the `_journal.json` entry), **rename the generated file to `0016_hub_bff_session_store.sql`** and update its `tag` in `_journal.json` to match, then hand-append the RLS block after the generated statements.
This is the same two-step used by `0012_sales_ops_funcoes.sql`.

```sql
-- Durable Hub BFF session store.
--
-- createHubBff() previously fell back to InMemoryHubSessionStore, so every API
-- restart or redeploy invalidated every logged-in session, and a second replica
-- could not see a session created by the first.
--
-- Neither table is tenant-scoped, and neither can be: a session row is written at
-- /auth/callback, BEFORE any workspace is known, so there is no org_id to key a
-- tenant policy on. They are still FORCE RLS with the admin-context policy only,
-- because these rows are bearer credentials: from the ordinary tenant connection
-- (getDb(), which never sets app.fxl_admin) both tables are empty and unwritable.
-- The store reads and writes exclusively through getAdminDb().
--
-- hub_refresh_token_enc and code_verifier_enc are AES-256-GCM sealed with the
-- row id as AEAD additional data, so a dump alone yields no usable credential.
--
-- Down path: DROP TABLE both tables. No data migration exists in either direction;
-- dropping them logs every user out, which is the pre-migration behaviour anyway.

CREATE TABLE "hub_bff_sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"hub_refresh_token_enc" text NOT NULL,
	"account_id" text,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "hub_bff_login_txns" (
	"id" text PRIMARY KEY NOT NULL,
	"code_verifier_enc" text NOT NULL,
	"state" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "hub_bff_sessions_expires_at_idx" ON "hub_bff_sessions" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "hub_bff_login_txns_expires_at_idx" ON "hub_bff_login_txns" USING btree ("expires_at");--> statement-breakpoint
ALTER TABLE hub_bff_sessions ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE hub_bff_sessions FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY hub_bff_sessions_admin_context ON hub_bff_sessions
  AS PERMISSIVE FOR ALL
  USING (current_setting('app.fxl_admin', true) = 'true')
  WITH CHECK (current_setting('app.fxl_admin', true) = 'true');--> statement-breakpoint
ALTER TABLE hub_bff_login_txns ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE hub_bff_login_txns FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY hub_bff_login_txns_admin_context ON hub_bff_login_txns
  AS PERMISSIVE FOR ALL
  USING (current_setting('app.fxl_admin', true) = 'true')
  WITH CHECK (current_setting('app.fxl_admin', true) = 'true');
```

## Oracle tests

### Named oracle

**File:** `apps/api/test/rls/hub-bff-session-store.test.ts`
**Test:** `describe('durable Hub BFF session store') > it('resolves a session created by another store instance, which the in-memory default cannot')`

This is the test that proves the slice.
It demonstrates restart survival, not CRUD, and it carries its own non-vacuity control.

```
// storeA and storeB are INDEPENDENT objects over the same admin connection.
// A second store instance is exactly what an API restart, or a second replica, is.
const sid = await storeA.withRequest({ consumeLoginTx: false }, async () =>
  storeA.create({ hubRefreshToken: 'refresh-token-alpha' }));

const resolved = await storeB.withRequest({ sessionId: sid, consumeLoginTx: false }, async () =>
  storeB.get(sid));
expect(resolved).toEqual({ hubRefreshToken: 'refresh-token-alpha' });

// Non-vacuity: the SDK default fails this exact assertion.
const memA = new InMemoryHubSessionStore();
const memSid = memA.create({ hubRefreshToken: 'refresh-token-alpha' });
const memB = new InMemoryHubSessionStore();          // the "restarted process"
expect(memB.get(memSid)).toBeNull();
expect(memA.get(memSid)).not.toBeNull();             // memA proves memB's null is about the RESTART
```

The last line matters: without it, `memB.get(...) === null` would also pass if `create` were simply broken.

### Supporting integration tests, same file

1. **`it('carries a rotated refresh token across store instances')`** - `storeA` creates, `storeB` (fresh instance) hydrates and calls `update(sid, 'refresh-token-beta')`, `storeC` (third fresh instance) resolves `'refresh-token-beta'`.
   This is the assertion a stateless sealed session id provably cannot satisfy, so it pins the rejected alternative out of the design.
2. **`it('never stores the Hub refresh token in plaintext')`** - raw `SELECT hub_refresh_token_enc FROM hub_bff_sessions WHERE id = $1` over the admin client; assert the column does **not** contain `'refresh-token-alpha'` and that it starts with `'v1.'`.
   Also assert a sealer built from a **different** key resolves the same row to `null`.
3. **`it('consumes a login transaction exactly once across instances')`** - `storeA.createLogin({codeVerifier, state})`; `storeB.withRequest({loginTxId, consumeLoginTx: true}, ...)` returns the transaction verbatim; `storeC` with the same id returns `null`, and the row is gone from the table.
4. **`it('does not touch the login transaction on a non-callback request')`** - `withRequest({loginTxId, consumeLoginTx: false})`, then a later `consumeLoginTx: true` on a fresh instance still resolves it.
5. **`it('refuses an expired session and an expired login transaction')`** - build a store with an injected `now` far in the future, hydrate, assert `get` is `null` and the row is still present (proving expiry is enforced on READ, not only by the sweeper).
6. **`it('is invisible to the ordinary tenant connection')`** - `SELECT count(*) FROM hub_bff_sessions` over the non-admin `TEST_DATABASE_URL` connection returns `0` while the admin connection sees the row, and an `INSERT` over the tenant connection is rejected.
   This is the RLS decision made testable.
7. **`it('removes only expired rows')`** - `deleteExpiredHubBffSessions` deletes the expired fixture and leaves the live one.

Fixtures follow `test/rls/product-funcao-costs-rls.test.ts`: an `appClient` on `TEST_DATABASE_URL`, an `adminClient` with `{ connection: { 'app.fxl_admin': 'true' } }`, both `end()`ed in `afterAll`, and every row created by the file deleted in `afterAll` by id.

### Supporting unit tests (no database)

`apps/api/src/auth/__tests__/session-crypto.test.ts`

- seals and opens a round trip;
- opening with a **different aad** returns `null` (proves the row binding);
- opening a ciphertext whose last character was flipped returns `null` (proves GCM authentication);
- opening with a sealer built from a different ikm returns `null`;
- two seals of the same plaintext differ (proves a fresh IV);
- an ikm shorter than 32 characters throws.

`apps/api/src/auth/__tests__/hub-session-store.test.ts`

- `createHubSessionStore({databaseUrlPresent:false, nodeEnv:'development', ...})` returns `kind: 'memory'`;
- the same call with `nodeEnv:'production'` throws;
- `hubSessionCookieName(true) === '__Host-fxl_hub_session'` and `hubSessionCookieName(false) === 'fxl_hub_session'`, with a comment naming the SDK constants they mirror;
- calling `create()` outside `withRequest` throws `HubSessionScopeError`;
- `LOGIN_TX_TTL_MS === 600_000`, pinned against the SDK's `LOGIN_TX_MAX_AGE_SECONDS`.

## How to run

```bash
pnpm --filter @fxl-sales/api db:generate       # writes drizzle/0016_*, then rename + append the RLS block
pnpm --filter @fxl-sales/api db:migrate        # against the LOCAL docker DB only; check DATABASE_URL first
pnpm --filter @fxl-sales/api test              # unit: src/auth/__tests__/**
pnpm --filter @fxl-sales/api test:integration  # the oracle; global-setup applies 0016 automatically
pnpm run lint
pnpm run type-check
pnpm test
pnpm run build
```

`apps/api/.env` points `DATABASE_URL` at **staging** in this repo; `test/rls/setup-env.ts` hard-overrides it to `TEST_DATABASE_URL` for the integration run, so `test:integration` is safe, but a bare `db:migrate` is **not**.
Run `db:migrate` with an explicit local `DATABASE_URL` on the command line.

## Risks and rollback

1. **The `fxl_sales_test` role may lack privileges on the two new tables.**
   `ALTER DEFAULT PRIVILEGES` only covers new tables when the grantor matches the creating role.
   If `test:integration` fails with `permission denied for table hub_bff_sessions`, run the local provisioning GRANT from `nexo/knowledge/decisions/2026-07-29-integration-tests-are-hermetic-local.md`.
   This is local provisioning, never an application migration.
2. **Cookie-name drift against the SDK.**
   The `__Host-` prefix and the `fxl_hub_login` name are read out of `@fxl-business/hub-sdk@1.2.0` internals.
   Mitigated by deriving both from the single `secureCookies` boolean that is also passed to `createHubBff`, by naming the source file and line in a comment, and by the unit test pinning both names.
   A future SDK bump must re-check `dist/server.js:271-273`.
3. **The store throws outside a request scope.**
   If the middleware is ever unmounted, every `/auth/*` route 500s immediately and loudly.
   That is the intended failure mode, and it cannot happen through `server.ts` because the middleware lives inside the router `createAppAuthBff()` returns.
4. **A lost flush costs one re-login.**
   Bounded and logged; see "Failure semantics".
5. **Rotating `FXL_HUB_SECRET_KEY` logs everyone out.**
   Documented in the module header and in `.env.dev.example`.
   Operators who want to rotate the Hub secret without a mass logout set `HUB_SESSION_ENCRYPTION_KEY` **before** rotating.
6. **The admin pool is `max: 5`.**
   Auth routes now take one admin connection per request for the duration of the hydrate and the flush, not for the Hub round trip in between.
   If `/auth/refresh` volume ever saturates it, raise the admin pool cap; do not move the store onto `getDb()`, which the RLS policy deliberately blocks.
7. **Existing sessions are invalidated once on deploy.**
   There are no rows to migrate, since the old store was process memory.
   Every user logs in again exactly once, which is what a redeploy already did before this slice.

**Rollback:** revert the commit and run `DROP TABLE hub_bff_sessions, hub_bff_login_txns;` plus the `_journal.json` entry removal.
Behaviour returns to the in-process store, which is the current production behaviour, so rollback is strictly a return to the status quo with no data loss beyond the one re-login every user already suffers on any redeploy.

## Out of scope for this slice

- Anything under `apps/web/**`; slices 02 and 03 own the blank-bearer-token laundering and the hard-redirect teardown.
- Any change to `@fxl-business/hub-sdk`; the `sessionStore` seam already exists and is sufficient.
- `CLAUDE.md` is not edited here (this slice is confined to `apps/api/**`); the batch capture step should add a "Hub BFF session" paragraph recording that the store is Postgres-backed, request-scoped, sealed at rest and admin-context-only.
