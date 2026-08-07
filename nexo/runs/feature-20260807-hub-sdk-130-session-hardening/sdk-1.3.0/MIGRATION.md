# Migrating `@fxl-business/hub-sdk` from 1.2.0 to 1.3.0

> ## Read this before running `pnpm update`
>
> **1.3.0 is a breaking change for any consumer with a custom session store, despite
> being a minor version.** The version number does not warn you. This document does.
>
> - Custom `HubSessionStore` implementation? **It will not work.** See
>   [The session store changed](#the-session-store-changed).
> - Using the default (no `sessionStore` passed) and deploying to production?
>   **Your app will refuse to boot.** That is deliberate - see
>   [Why the default now throws](#why-the-default-now-throws).
> - Neither? The upgrade is drop-in.

## Why this release exists

The hardened session contract landed on the Hub's `main` on 2026-07-13 but was never
version-bumped or republished. The repo carried a `1.2.0` whose public API differed
from the `1.2.0` on npm, so every consumer installed the weaker one.

The consequence, observed in production: a product wired `createHubBff(hubConfig)`
with no `sessionStore`, silently received the in-memory default, and **every API
restart, redeploy, or additional replica invalidated every user's login.** With more
than one replica, a session created on replica A was invisible to replica B, so the
same user was logged in and logged out depending on which instance answered.

If you are comparing surfaces, compare against the **npm 1.2.0** release. The Hub
repo's git history for `1.2.0` is not what you installed.

## The session store changed

`HubSessionStore` moved from a synchronous, id-keyed CRUD interface to an async,
transactional one.

### `HubSessionStore` members

| npm 1.2.0 | 1.3.0 | Change |
|---|---|---|
| `create(data): string` | `create(data): Promise<string>` | now async |
| `get(id): HubSessionRecord \| null` | *(removed)* | use `withSession` |
| `update(id, token): void` | *(removed)* | use `withSession` |
| `delete(id): void` | *(removed)* | use `withSession` |
| `createLogin(tx): string` | `createLoginTransaction(tx): Promise<string>` | renamed, now async |
| `consumeLogin(id): HubLoginTransaction \| null` | `consumeLoginTransaction(id): Promise<HubLoginTransaction \| null>` | renamed, now async |
| - | `withSession<T>(id, op): Promise<T>` | **new, required** |

### Types

| npm 1.2.0 | 1.3.0 | Change |
|---|---|---|
| `HubSessionRecord{hubRefreshToken, accountId?}` | `+ expiresAt?, absoluteExpiresAt?` | additive |
| `HubLoginTransaction{codeVerifier, state}` | `+ expiresAt?` | additive |
| - | `HubSessionTransaction{get, update, delete}` | **new** - the handle `withSession` passes to your callback |

### `createHubBff` options and the bundled store

| npm 1.2.0 | 1.3.0 | Change |
|---|---|---|
| - | `CreateHubBffOptions.now?: () => number` | additive, injectable clock |
| - | `CreateHubBffOptions.timeoutMs?: number` | additive, default 10 000 |
| - | `CreateHubBffOptions.sessionTtlSeconds?: number` | additive, default 7 776 000 (90d) |
| - | `CreateHubBffOptions.sessionAbsoluteTtlSeconds?: number` | additive, default 31 536 000 (365d) |
| `new InMemoryHubSessionStore()` | `new InMemoryHubSessionStore(now?)` | additive optional arg |

`InMemoryHubSessionStore` also retains a synchronous `get(id)` that is **not** part of
the `HubSessionStore` interface.
It exists for test convenience only.
Do not build against it: it is absent from any store you write and from
`SqlHubSessionStore`.

### Why `withSession` replaced `get`/`update`/`delete`

Not for tidiness. The separate accessors made a lost update **unavoidable** in any
correct implementation, because there was no way to express "read and write under one
lock".

The failure it caused:

1. Two requests for the same session arrive concurrently. Both call `get(id)` and read
   refresh token `RT1`.
2. Both call Hub `/auth/refresh` with `RT1`. The Hub rotates the family and issues
   `RT2` to the first caller, `RT3` to the second.
3. Both call `update(id, ...)`. The later write wins; the other rotated token is lost.
4. The stored token no longer matches the Hub's current family. The next refresh is
   treated as a **replay**, trips `reuse_detected`, and the family is revoked.
5. The user is force-logged-out, seemingly at random, under load.

`withSession(id, op)` gives the store a place to hold a lock across the entire
read-modify-write, which is what makes step 3 safe.

### Porting a custom store

Before (1.2.0):

```ts
class MyStore implements HubSessionStore {
  get(id: string) { return this.rows.get(id) ?? null; }
  update(id: string, hubRefreshToken: string) {
    const row = this.rows.get(id);
    if (row) this.rows.set(id, { ...row, hubRefreshToken });
  }
  delete(id: string) { this.rows.delete(id); }
  // ...
}
```

After (1.3.0) - the key move is that every read and write happens **inside** the
callback, under one transaction:

```ts
import type {
  HubSessionStore,
  HubSessionRecord,
  HubSessionTransaction,
} from '@fxl-business/hub-sdk';

class MyStore implements HubSessionStore {
  async withSession<T>(id: string, op: (tx: HubSessionTransaction) => Promise<T>): Promise<T> {
    return this.db.transaction(async (trx) => {
      // Take the row lock FIRST. Everything `op` does is serialized against
      // any other request touching this same session.
      const [row] = await trx.query(
        'SELECT * FROM my_sessions WHERE id = $1 FOR UPDATE',
        [id],
      );
      return op({
        get: async () => row ?? null,
        update: async (record) => { await trx.query('UPDATE my_sessions SET ... WHERE id = $1', [id]); },
        delete: async () => { await trx.query('DELETE FROM my_sessions WHERE id = $1', [id]); },
      });
    });
  }
  // ...
}
```

**The common mistake:** hydrating the session before the handler, mutating a
per-request copy, and flushing afterwards. That reintroduces exactly the lost update
above, because two requests each hold their own working set. The lock must span the
read and the write.

If you do not want to write this at all, use the bundled `SqlHubSessionStore`
(below), which already does it.

### You will get a clear error, not a mystery

Passing a 1.x store to 1.3.0 throws at **construction time**, in every environment:

```
hub-sdk: the supplied sessionStore does not implement `withSession`. This is the
pre-1.3.0 (published 1.2.0) store shape, which used synchronous get/update/delete.
The session contract is now async and transactional. See MIGRATION.md in
@fxl-business/hub-sdk for the 1.x to 1.3.0 upgrade, or use the bundled
`SqlHubSessionStore`.
```

Construction time, not first request, so a bad deploy fails before it serves anyone.

## Why the default now throws

`createHubBff(config)` with no `sessionStore` throws when `NODE_ENV === 'production'`:

```
sessionStore is required in production
```

In 1.2.0 this silently fell back to `InMemoryHubSessionStore`, which is what caused
the incident described above. The in-memory store remains the default **outside**
production, so local development is unchanged.

To fix: pass a persistent store. `SqlHubSessionStore` is bundled and needs only a
minimal adapter over whatever database client you already use - the SDK adds no
database dependency of its own. DDL ships at `schema/session-store.sql`.

## Sessions now expire

`HubSessionRecord` gained `expiresAt` and `absoluteExpiresAt`, and `createHubBff`
accepts `sessionTtlSeconds` (default 90 days) and `sessionAbsoluteTtlSeconds`
(default 365 days).

If you migrated from in-memory to a database on 1.2.0, check this. The 1.2.0 record
had no expiry fields at all, so a straight port produces **sessions that never
expire** - a stolen session id stays valid forever. Process restart used to be an
implicit TTL; persistence removed it without replacing it.

A store implementing `withSession` should treat a record past either timestamp as
absent: delete it inside the transaction and resolve `null`.

## Refresh failures are now classified

`POST /auth/refresh` and `POST /auth/switch` distinguish permanent from transient
failures rather than returning one undifferentiated error:

| Condition | Status | Body |
|---|---|---|
| Hub returned `invalid`, `expired`, `revoked`, `reuse_detected`, `no_session` | `401` | `{error: 'session_expired'}` |
| Network failure, timeout, `408`/`425`/`429`, any `5xx` | `503` | `{error: 'refresh_unavailable'}` |
| Malformed or unparseable Hub response | `502` | `{error: 'invalid_refresh_response'}` |
| Not a member of the requested workspace (`/auth/switch`) | `403` | `{error: 'forbidden', code: 'not_a_member'}` |

**Only `401` means the session is dead.** `503` and `502` must preserve the session
and be retried.

If your client has a retry ladder that guesses at this distinction, it can now read it
directly. Client-side heuristics over an unclassified response cannot tell a Hub
outage from a revoked token: retry too little and a transient blip logs users out,
retry too much and a genuinely revoked session hangs.

Upstream calls are also bounded by `timeoutMs` (default 10s), so a hung Hub surfaces
as a `503` instead of an open request.

## Upgrade checklist

1. `pnpm add @fxl-business/hub-sdk@^1.3.0`
2. Custom store? Port it to `withSession` (above), or switch to `SqlHubSessionStore`.
3. No store? Add one before deploying to production, or the process will not boot.
4. Confirm sessions expire. Check both `expiresAt` and `absoluteExpiresAt`.
5. Treat `503`/`502` from `/auth/refresh` as retryable and session-preserving; only
   `401` should surface a login affordance.
6. Deploy. **Everyone is logged out once**, as with any session-store change. After
   that, restarts stop logging people out.
