---
id: 01-session-store-read-contract
milestone: v2.8.0
status: done
depends_on: []
files_modified:
  - apps/api/src/auth/hub-session-store.ts
  - apps/api/src/auth/__tests__/hub-session-store.test.ts
  - apps/api/src/auth/__tests__/hub-login-scope.test.ts
  - CLAUDE.md
acceptance: "given a session row that cannot be unsealed, when withSession reads it, then read() reports absent and the row is left in place, while a row past either expiry reports expired and is deleted in the same transaction"
goal: "Port the session store transaction to the 2.x three-state read contract and declare store kind, on the 1.3.1 SDK, keeping master green"
must_not_break:
  - "the single db.transaction with SELECT ... FOR UPDATE taken before op runs"
  - "absolute_expires_at written once by create and absent from update's set object"
  - "update ignoring both timestamps the SDK spreads back from get"
  - "HubSessionStoreUnavailableError on any throw inside withSession"
  - "the createHubSessionStore discriminated union narrowing that gates the login-context middleware"
rules:
  - "no em dash and no en dash on any added line"
  - "get() must be implemented in terms of read() so the two cannot drift"
  - "an unopenable seal is absent and never expired, and never deletes the row"
verifier_focus: "that expired and absent are never conflated, and that no failure mode was turned into a logout"
---

# 01 - Session store read contract

## Context

`@fxl-business/hub-sdk@2.1.0` replaced `HubSessionTransaction.get(): Promise<HubSessionRecord | null>`
with `read(): Promise<HubSessionReadResult>`, a three-state discriminated result, and made
`HubSessionStore.kind` a REQUIRED self-describing property.
The frame is `nexo/plans/feature-20260827-hub-sdk-210-access-model/00-OVERVIEW.md`; the exact 2.1.0
surface is `nexo/runs/feature-20260827-hub-sdk-210-access-model/recon-sdk-surface.md`; the exact
current shape of this repo's store is section 4 of
`nexo/runs/feature-20260827-hub-sdk-210-access-model/recon-api.md`.

This slice ports the STORE to the 2.x read contract WITHOUT bumping the SDK.
The dependency stays at `^1.3.1`, `get()` stays on the handle because the 1.3.1 BFF still calls it
(`dist/server.js:464`), and master therefore stays green.
Slice 04 flips the SDK, deletes `get()`, and swaps three locally declared types for the SDK's.

The distinction being introduced is the entire point of the rename and is a production hazard in
both directions:

- `expired` is a definitive end of session and clears the session cookie.
- `absent` is not definitive and never clears it.

So a store that reports `expired` where it cannot actually prove expiry converts an infrastructure
condition into a logout. `CLAUDE.md` already states the rule this slice is encoding:
a row past EITHER `expires_at` or `absolute_expires_at` is deleted inside the same transaction and
reported absent under 1.3.x semantics (it becomes `expired` here), and a seal that will not open
reports absent and LEAVES the row, "because a wrong key must cost one re-login rather than destroy
data".

### Verified facts this plan is built on

Read out of the unpacked 2.1.0 tarball, `dist/session-store-DOWOoBx8.d.ts`:

```ts
type HubSessionStoreKind = 'ephemeral' | 'persistent';

type HubSessionReadResult =
  | { status: 'found'; record: HubSessionRecord }
  | { status: 'expired' }
  | { status: 'absent' };

interface HubSessionTransaction {
  read(): Promise<HubSessionReadResult>;
  update(record: HubSessionRecord): Promise<void>;
  delete(): Promise<void>;
}

interface HubSessionStore {
  readonly kind: HubSessionStoreKind;
  create(data: HubSessionRecord): Promise<string>;
  withSession<T>(id: string, operation: (tx: HubSessionTransaction) => Promise<T>): Promise<T>;
  createLoginTransaction(tx: HubLoginTransaction): Promise<string>;
  consumeLoginTransaction(id: string): Promise<HubLoginTransaction | null>;
}

declare class InMemoryHubSessionStore implements HubSessionStore {
  readonly kind: 'ephemeral';
}
```

There is no `set()`, and `read` has no arguments. `InMemoryHubSessionStore` in 2.1.0 declares
`kind = 'ephemeral'` itself; in the INSTALLED 1.3.1 it has no `kind` at all, which is why this
slice has to supply one for the fallback branch.

Current repo facts, `apps/api/src/auth/hub-session-store.ts`:

- The handle literal is at `:260-285` and has exactly `get`, `update`, `delete`.
- `kind` today lives ONLY on the factory envelope, `createHubSessionStore` at `:370-398`, as the
  discriminated union `{kind: 'durable'; store: DurableHubSessionStore} | {kind: 'memory'; store: HubSessionStore}`.
  `apps/api/src/middleware/app-auth.ts:250` narrows on `session.kind === 'durable'` before mounting
  `createHubLoginSupersedeMiddleware`, because `InMemoryHubSessionStore` has no `withLoginContext`.
  That envelope, and those two envelope tags, DO NOT CHANGE in this slice.
  The store's own `kind` is a SECOND, different property with SDK-defined values, and the two
  coexist: `{kind: 'durable', store: {kind: 'persistent'}}`.
- `PostgresHubSessionStore` (`:128`) has no `kind`.

## Design

One lookup, resolved once, before `operation` runs, under the row lock.
`read()` returns that resolved value; `get()` projects it. Nothing recomputes anything, so the two
accessors cannot drift, and `get()` cannot trigger a second delete.

The state machine, in this exact order:

1. no row at all: `{status: 'absent'}`, nothing is deleted.
2. row past `expires_at` OR past `absolute_expires_at`: `DELETE` on the SAME `tx`, then
   `{status: 'expired'}`.
3. row present and unexpired, seal opens: `{status: 'found', record: toSessionRecord(row, token)}`.
4. row present and unexpired, seal does NOT open: `{status: 'absent'}`, and the row is LEFT.

The expiry test comes BEFORE the seal is opened, deliberately. Expiry is readable from two
timestamptz columns and needs no key, so an expired row is expired whatever the key is; and a row
the sweeper would delete tonight is not data a wrong key is destroying. Reversing the two would make
an expired row with a rotated key report `absent`, which is the weaker answer, but it would also
leave rows the ceiling exists to kill.

Nothing else in the transaction moves: the `SELECT ... FOR UPDATE LIMIT 1` stays first, `update`
keeps sliding `expiresAt` and keeps `absoluteExpiresAt` out of its `set` object, `delete` is
unchanged, and the single `catch` still wraps everything in `HubSessionStoreUnavailableError`.

## Exact type declarations

In `apps/api/src/auth/hub-session-store.ts`. Names are chosen so slice 04 deletes the declaration
and adds the identifier to the existing SDK import, with no rename anywhere else.

Change the import block (`:32-38`) to alias the SDK's transaction type out of the way:

```ts
import {
  InMemoryHubSessionStore,
  type HubLoginTransaction,
  type HubSessionRecord,
  type HubSessionStore,
  type HubSessionTransaction as SdkHubSessionTransaction,
} from '@fxl-business/hub-sdk';
```

Add, immediately above `HubLoginContext` (so it sits with the other contract types):

```ts
/**
 * The 2.x session contract, declared HERE while the dependency is still 1.3.1.
 *
 * These three names are byte-for-byte the SDK 2.1.0 names
 * (dist/session-store-DOWOoBx8.d.ts:17-43). Slice 04 deletes these declarations and
 * adds the identifiers to the import above; nothing else in the repo changes, which
 * is the whole reason they are spelled the same.
 */
export type HubSessionStoreKind = 'ephemeral' | 'persistent';

/**
 * Why this is not `HubSessionRecord | null`.
 *
 * Under `null`, a session that had EXPIRED and one that simply is not here looked
 * identical, so the BFF treated both as definitive and deleted the session cookie: a
 * database blip logged the operator out with no way back. With the status
 * discriminated, `expired` clears and `absent` never does.
 *
 * The asymmetry is the design rule for this file. `absent` costs a retry; `expired`
 * costs a logout. Anything this store cannot positively prove is expiry is therefore
 * reported `absent`.
 */
export type HubSessionReadResult =
  | { status: 'found'; record: HubSessionRecord }
  | { status: 'expired' }
  | { status: 'absent' };

/**
 * The 2.x handle, plus the 1.3.1 `get()` the INSTALLED SDK still calls
 * (dist/server.js:464). Slice 04 deletes this interface, imports
 * `HubSessionTransaction` from the SDK, and deletes `get` from the handle literal.
 * Until then `get()` is implemented in terms of `read()` and never as a second
 * lookup.
 */
export interface HubSessionTransaction extends SdkHubSessionTransaction {
  read(): Promise<HubSessionReadResult>;
}
```

Replace the `DurableHubSessionStore` interface body (keep its existing doc comment, add to it):

```ts
export interface DurableHubSessionStore extends HubSessionStore {
  /**
   * 2.x makes the store describe its OWN durability, because the boot assertion has
   * to be able to refuse an ephemeral store outside development and cannot do that by
   * class name. This one is Postgres, so it is persistent by construction. It is NOT
   * the same property as `createHubSessionStore`'s envelope tag below.
   */
  readonly kind: 'persistent';
  /** Narrowed to the handle that has `read()`. */
  withSession<T>(id: string, operation: (tx: HubSessionTransaction) => Promise<T>): Promise<T>;
  withLoginContext<T>(context: HubLoginContext, fn: () => Promise<T>): Promise<T>;
}
```

FALLBACK, and the only one in this plan: if `tsc` rejects the `withSession` redeclaration against
the inherited member, change the first line to
`export interface DurableHubSessionStore extends Omit<HubSessionStore, 'withSession'> {`
and change nothing else. Do not solve it any other way, and do not cast.

Add, directly above `createHubSessionStore`:

```ts
/**
 * The in-process fallback, with the `kind` the installed 1.3.1
 * `InMemoryHubSessionStore` does not have yet. 2.1.0's own class declares
 * `kind = 'ephemeral'`, so slice 04 deletes this class and uses the SDK's directly.
 * The subclass adds a property and overrides no behaviour.
 */
class EphemeralHubSessionStore extends InMemoryHubSessionStore {
  readonly kind = 'ephemeral' as const;
}
```

And in `createHubSessionStore`, keep BOTH envelope tags exactly as they are and change only the
memory branch's store type and construction:

```ts
export function createHubSessionStore(deps: {
  databaseUrlPresent: boolean;
  nodeEnv: string;
  encryptionIkm: string;
}):
  | { kind: 'durable'; store: DurableHubSessionStore }
  | { kind: 'memory'; store: EphemeralHubSessionStore } {
```

and

```ts
  return { kind: 'memory', store: new EphemeralHubSessionStore() };
```

The envelope stays `'durable' | 'memory'`. Renaming those tags to `'persistent' | 'ephemeral'` is
OUT OF SCOPE and would break `app-auth.ts:250`, `app-auth-bff-wiring.test.ts:242` and
`app-auth-bff-memory-path.test.ts:73`.

## Exact implementation of withSession

Replace `:237-287` (from the `const now` line through `return await operation(handle)`), keeping
every existing comment that still applies and updating the two that describe `null`:

```ts
        const now = this.#now().getTime();
        const row = rows[0] ?? null;

        // ONE lookup, resolved here, under the lock, BEFORE `operation` runs, and
        // never recomputed. `read()` hands this value back and `get()` projects it,
        // so the two accessors cannot disagree and `get()` cannot re-delete.
        //
        // The order is deliberate and is the safety rule of this whole file:
        // `expired` clears the browser's session cookie and `absent` does not, so
        // only a state this store can PROVE from its own columns is reported
        // expired. Everything else is absent, which costs a retry instead of a
        // logout.
        let outcome: HubSessionReadResult;
        if (row === null) {
          // Not here. Possibly never was, possibly not on this replica. Not proof of
          // expiry, so it must not read as one.
          outcome = { status: 'absent' };
        } else if (row.expiresAt.getTime() <= now || row.absoluteExpiresAt.getTime() <= now) {
          // Past EITHER timestamp: deleted inside THIS transaction and reported
          // expired. The absolute term is not redundant with the sliding one: a row
          // rotated yesterday has expires_at 29 days in the future while
          // absolute_expires_at may already have passed, and that row is exactly the
          // one the ceiling exists to kill.
          //
          // Checked BEFORE the seal is opened on purpose. Expiry is readable from two
          // columns and needs no key, so this answer is correct even under a rotated
          // key, and the row is one the nightly sweep would remove anyway.
          await tx.delete(hubBffSessions).where(eq(hubBffSessions.id, sessionId));
          outcome = { status: 'expired' };
        } else {
          const token = this.#sealer.open(row.hubRefreshTokenEnc, row.id);
          // A seal that will not open reads as an UNKNOWN session, never an expired
          // one, and the row is LEFT IN PLACE. This diverges from the bundled
          // `SqlHubSessionStore`, which throws: a key rotation must cost every user
          // one re-login rather than a wall of 503s, and deleting rows as a side
          // effect of presenting the wrong key would destroy data on a misconfigured
          // deploy. Reporting `expired` here would do the same damage in the other
          // direction, by making the misconfiguration sign everyone out.
          outcome =
            token === null
              ? { status: 'absent' }
              : { status: 'found', record: toSessionRecord(row, token) };
        }

        const read = async (): Promise<HubSessionReadResult> => outcome;

        const handle: HubSessionTransaction = {
          read,
          // The 1.3.1 BFF still calls this (dist/server.js:464). It is a PROJECTION of
          // `read()` and never a second lookup, so the two cannot drift while both
          // exist. Slice 04 deletes it with the SDK bump.
          get: async () => {
            const result = await read();
            return result.status === 'found' ? result.record : null;
          },
          update: async (record) => {
            // ... unchanged ...
          },
          delete: async () => {
            // ... unchanged ...
          },
        };

        return await operation(handle);
```

Do not touch `update`, `delete`, the `try`/`catch`, `create`, `toSessionRecord`,
`createLoginTransaction`, `consumeLoginTransaction` or `deleteExpiredHubBffSessions`.
Delete the now-dead `live` and `token` locals from the old body; `noUnusedLocals` is on.

Also update the file's doc header (`:1-29`) minimally: the sentence pinning the contract to
`@fxl-business/hub-sdk@1.3.0` gains one line saying the handle already speaks the 2.x
`read()` contract while the dependency is still `1.3.1`, and that `get()` is a projection due for
deletion in the SDK flip. No line may contain an em dash or an en dash.

### Adopted from slice 02: the header comment at `:27`

This slice ALSO makes the one line edit slice 02 originally planned at
`apps/api/src/auth/hub-session-store.ts:27`, inside the doc header block this slice is already
rewriting:

> Rotating `FXL_HUB_SECRET_KEY` invalidates every stored session - see `session-crypto.ts`.

becomes

> Rotating `FXL_HUB_CLIENT_SECRET` invalidates every stored session - see `session-crypto.ts`.

It moved here because `:27` sits inside the header block above and two wave-1 slices declaring one
file is a guaranteed textual merge conflict; slice 02 has dropped the file from its
`files_modified` accordingly. Slice 02 renames the actual variable, `FXL_HUB_SECRET_KEY` to
`FXL_HUB_CLIENT_SECRET` in `apps/api/src/env.ts` and everywhere it is read, in this SAME wave, so
the comment is correct by the end of wave 1. It is a comment, so it is inert in either merge order
and nothing in this slice's tests or in slice 02's depends on which lands first.
Slice 02 keeps its own comment-only edit at `apps/api/src/auth/session-crypto.ts:6,10`; that file
is not declared here.

## Tests

RED FIRST. Write the whole new `describe` block below, watch it fail, and only then touch
`hub-session-store.ts`. Once written, these titles and assertions are IMMUTABLE.

### New: `apps/api/src/auth/__tests__/hub-session-store.test.ts`

Add one new `describe('the three-state read contract')` block at the END of the file. Nothing above
it is edited. Reuse the existing `fakeTx`, `fakeDb`, `sessionRow`, `frozenStore`, `SESSION_ID`,
`FROZEN`, `DAY_MS`, `IKM` helpers exactly as they are.

Add ONE module-level constant beside `IKM` (a second, unrelated key, so a seal made with it cannot
open under `IKM`):

```ts
/** A different key entirely, i.e. what a rotated FXL_HUB_SECRET_KEY looks like to an old row. */
const OTHER_IKM = 'a-completely-different-key-0123456789abcd';
```

The block must import `HubSessionReadResult` from `../hub-session-store.js` as a type.

The named oracles, verbatim titles:

1. `it('reports absent and leaves the row when the seal will not open, so a wrong key costs one re-login rather than data')`
   Row is live on both timestamps (`FROZEN + 29 days`, `FROZEN + 60 days`) but its
   `hubRefreshTokenEnc` is sealed with `OTHER_IKM`:
   `{ ...sessionRow({ expiresAt, absoluteExpiresAt }), hubRefreshTokenEnc: createSessionSealer(OTHER_IKM).seal('token-old', SESSION_ID) }`.
   Assert `result.status === 'absent'`, assert `result.status` is NOT `'expired'` explicitly, and
   assert `tx.recorded.deletes` is `0`.
   NON-VACUITY, in the same test: run the identical row sealed with `IKM` through a second
   `frozenStore` and assert `status === 'found'`, proving the fixture is broken by the KEY and by
   nothing else.

2. `it('reports expired and deletes the row inside the same transaction when only the absolute expiry has passed')`
   `expiresAt: FROZEN + 29 days`, `absoluteExpiresAt: FROZEN - 1_000`.
   Capture `tx.recorded.deletes` INSIDE the operation, immediately after `await handle.read()`.
   Assert `status === 'expired'` and that the observed delete count is `1`, i.e. the delete landed
   on the same `tx` handle and before the operation could see anything else.

3. `it('reports expired and deletes the row inside the same transaction when only the sliding expiry has passed')`
   The mirror of 2: `expiresAt: FROZEN - 1_000`, `absoluteExpiresAt: FROZEN + 60 days`.
   Same two assertions, so a future edit cannot fix one term by breaking the other.

4. `it('reports absent and deletes nothing when there is no row at all')`
   `fakeTx([])`. Assert `status === 'absent'` and `tx.recorded.deletes` is `0`.
   This is the test that pins the `absent` versus `expired` split at its cheapest point: a store
   that answered `expired` here would log out every user of a replica that lost its row.

5. `it('reports found with the stored refresh token when neither expiry has passed')`
   The non-vacuity control for 2 and 3. Assert `status === 'found'`,
   `result.record.hubRefreshToken === 'token-old'`, and `tx.recorded.deletes` is `0`.

6. `it('never lets get() and read() disagree about the same locked row')`
   THE NO-DRIFT ORACLE. In ONE test body, iterate over four cases built with the helpers above:
   live, sliding-expired, absolute-expired, and unopenable-seal. For each, open ONE `withSession`
   and call `const result = await handle.read()` then `const legacy = await handle.get()` on the
   SAME handle, then assert, for that case:
   - `legacy === null` exactly when `result.status !== 'found'`;
   - when `result.status === 'found'`, `legacy` deep-equals `result.record`;
   - `tx.recorded.deletes` is unchanged by the extra `get()` call, i.e. `1` for the two expired
     cases and `0` for the other two, proving `get()` performed no second lookup and no second
     delete.
   Give each case a `label` and pass it into the assertions so a failure names the case.

7. `it('declares kind persistent on the durable store and ephemeral on the in-process fallback, without moving the factory envelope tags')`
   Assert `frozenStore(db).kind === 'persistent'`.
   Assert, with `console.warn` spied out exactly as the existing fallback test does, that
   `createHubSessionStore({databaseUrlPresent: false, nodeEnv: 'development', encryptionIkm: IKM})`
   returns `kind === 'memory'` on the ENVELOPE and `store.kind === 'ephemeral'` on the STORE.
   Both halves are required: the envelope tag is what `app-auth.ts:250` narrows on to mount the
   login-supersede middleware, and renaming it is how this slice would silently 500 every local
   `/auth/callback`.
   The three assertions this test writes are, exactly and exhaustively:
   `expect(frozenStore(db).kind).toBe('persistent')`, `expect(session.kind).toBe('memory')` on the
   ENVELOPE, and `expect(session.store.kind).toBe('ephemeral')` on the STORE.
   It writes NO `toBeInstanceOf` assertion of any kind, and in particular none against
   `EphemeralHubSessionStore` or `InMemoryHubSessionStore`. Slice 04 quotes this test when it
   retargets the memory branch at 2.1.0's own `InMemoryHubSessionStore`, so it must quote these
   three property assertions and not an instance check that is not here. This is stated so the
   quotation cannot drift; it neither adds nor weakens a claim.

Every one of these tests must FAIL before the implementation change, most of them at type-check or
with `handle.read is not a function`. If any of them passes before the change, the test is wrong.

### Changed tests, and exactly how

Only one existing test file needs an edit, and it is an ADDITION, not a weakening.

`apps/api/src/auth/__tests__/hub-login-scope.test.ts:19-27` builds a `DurableHubSessionStore`
object literal. `readonly kind: 'persistent'` is a new REQUIRED member of that interface, so the
literal no longer satisfies it. Add exactly one line to that literal:

```ts
    kind: 'persistent',
```

Change nothing else in that file. All four of its titles stay as they are.

### Tests that must NOT change

- `apps/api/src/auth/__tests__/hub-session-store.test.ts:125-367`, every existing test. They call
  `handle.get()`, `get()` still exists, and they must stay green UNEDITED. In particular
  `does not extend the absolute expiry when the SDK spreads the record back into update`,
  `deletes the row inside the transaction and reports absent when only the absolute expiry has passed`,
  `deletes the row and reports absent when only the sliding expiry has passed`,
  `reports a live record when neither expiry has passed` and
  `hands the SDK both expiries as ISO strings the SDK can Date.parse` are load-bearing and are the
  proof that `get()` did not change meaning under the port. Their titles still say "reports absent"
  where the new contract says `expired`; that wording is slice 04's to fix, when `get()` is deleted
  and the assertions move to `read()`. Do not touch them here.
- `apps/api/src/middleware/__tests__/app-auth-bff-wiring.test.ts`. Its `recordingSession()` fake at
  `:185` is typed as the SDK's 1.3.1 `HubSessionTransaction` and is fed to the REAL SDK handler,
  which calls `get()`. It compiles and passes unchanged because the spy is already cast.
- `apps/api/src/middleware/__tests__/app-auth-bff-memory-path.test.ts`. Still asserts the envelope
  tag `'memory'`, which this slice preserves.
- `apps/api/test/rls/hub-bff-session-store.test.ts` and
  `apps/api/test/rls/hub-bff-login-supersede.test.ts`. They call `tx.get()` at
  `:81, 128, 153, 163, 207, 281, 321, 514` and `:204, 223`; `get()` survives this slice, so they are
  untouched. They are integration tests behind `VITEST_INTEGRATION=1` and are not part of the green
  bar this slice has to hold.

## Doctrine

This slice is the SOLE owner of `CLAUDE.md` in wave 1, confirmed. Slice 02 has dropped the file
from its `files_modified` entirely and its documentation bullet lands in slice 03, in wave 2, where
03 is the only slice in its wave. So no other wave-1 slice appends into the Auth Model list, and the
second merge of this wave cannot conflict here. Do not widen this slice's `CLAUDE.md` edit to cover
slice 02's subject matter; the paragraph below is the whole of it.

`CLAUDE.md`, Auth Model section, the paragraph beginning "`HubSessionStore` is ASYNC and
TRANSACTIONAL". Replace the single sentence

> A row past EITHER `expires_at` or `absolute_expires_at` is deleted inside the same transaction and reported absent; a seal that will not open reports absent and LEAVES the row, because a wrong key must cost one re-login rather than destroy data.

with three sentences carrying the new contract, and no others:

> The transaction handle answers `read()` with a three-state `{status: 'found', record} | {status: 'expired'} | {status: 'absent'}`, because `expired` clears the browser's session cookie and `absent` never does, so collapsing the two turns a database blip into a logout the operator cannot recover from.
> A row past EITHER `expires_at` or `absolute_expires_at` is deleted inside the same transaction and reported `expired`; a missing row is `absent`; a seal that will not open is `absent` and LEAVES the row, because a wrong key must cost one re-login rather than destroy data, and anything the store cannot positively prove is expiry is `absent` by rule.
> `get()` survives only until the SDK flip and is a PROJECTION of `read()`, never a second lookup, so the two cannot drift.

Do not touch any other line of `CLAUDE.md`. No em dash, no en dash.

## Sequence and commits

Three atomic Conventional Commits, in this order.

1. `test(auth): pin the three-state session read contract` - the new `describe` block and the
   `OTHER_IKM` constant only. RED, and the executor records that it is red.
2. `feat(auth): answer the session transaction with a three-state read` - the type declarations,
   the `withSession` body, `EphemeralHubSessionStore`, the factory's memory branch, the
   `hub-login-scope.ts` test literal's `kind` line, and the file header comment. GREEN.
3. `docs(claude): record the three-state session read contract` - the `CLAUDE.md` paragraph.

## Verification

```
pnpm --filter @fxl-sales/api test
pnpm --filter @fxl-sales/api type-check
pnpm --filter @fxl-sales/api lint
pnpm test
```

The last one is the repo-wide bar and includes `scripts/no-legacy-auth.mjs`.
The integration suite (`pnpm --filter @fxl-sales/api test:integration`) needs Postgres and is not a
gate for this slice; it is untouched by design.

Nothing added by this slice may log a secret, a refresh token, a seal, a session id payload or a
`HubSessionRecord`. The only logging in the file stays `#unavailable`'s existing
`console.error` of the message and the cause, and the existing fallback `console.warn`.

## Risks

- The `DurableHubSessionStore.withSession` redeclaration is the one place `tsc` could object.
  The `Omit<HubSessionStore, 'withSession'>` fallback above is prescribed; take it without
  redesigning anything.
- `EphemeralHubSessionStore` is `instanceof InMemoryHubSessionStore`. The only `toBeInstanceOf`
  assertion on that class is `app-auth-bff-wiring.test.ts:250`, which runs on the DURABLE path and
  asserts NOT an instance, so the subclass cannot flip it.
- The memory fallback's transaction handle still has no `read()`, because it is the 1.3.1 SDK's own
  class. Nothing in this repo calls `read()` on it in this slice, and slice 04 gets it from 2.1.0
  for free. Do not shim it here.
