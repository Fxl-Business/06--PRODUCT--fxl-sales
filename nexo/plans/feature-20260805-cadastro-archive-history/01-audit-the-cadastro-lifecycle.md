---
id: 01-audit-the-cadastro-lifecycle
milestone: v2.4.0
status: todo
depends_on: []
files_modified:
  - apps/api/src/domains/audit/service.ts
  - apps/api/src/domains/sales-ops/service.ts
  - apps/api/src/domains/sales-ops/routes.ts
  - apps/api/src/middleware/app-auth.ts
  - apps/api/test/rls/cadastro-archive-audit.test.ts
  - apps/api/test/rls/areas-rls.test.ts
  - apps/api/test/rls/funcoes-rls.test.ts
  - apps/api/test/rls/product-commission-contract.test.ts
  - apps/api/test/rls/product-funcao-costs-rls.test.ts
  - apps/api/test/rls/funcoes-concurrency.test.ts
  - apps/api/src/domains/sales-ops/__tests__/routes.test.ts
acceptance: "given an authenticated operator archiving a sales-ops cadastro (produto, pessoa, funcao or area) through its PATCH route, when the status write commits, then exactly one hash-chained audit_log row was appended in the SAME transaction carrying that operator's Hub account id, the caller's org id, the entity type and id, action cadastro.archived, and the before/after status plus an entity name snapshot and an actor display-name snapshot - and when either half fails, neither the status change nor the ledger row survives, with verifyChain still reporting the ledger valid"
---

# 01 - audit the cadastro lifecycle

## Problem restated

`grep -c writeAuditEntry apps/api/src/domains/sales-ops/service.ts` is **0**.
The four status-bearing sales-ops cadastros are archived and restored by flipping a `status` column through the existing PATCH routes, and nothing anywhere records who did it.
`apps/api/src/domains/audit/service.ts` already implements the hash-chained, append-only ledger the rest of the product uses (conversions, commissions, payouts), so this slice does not build a ledger - it enrolls the cadastros in the one that exists.

## Cliente is OUT of this feature, and this slice carries no migration

**Decision taken at plan-check, binding on all four slices.**

`sales_ops_clients` in `apps/api/src/db/schema.ts` (lines 683-699) has columns `id, org_id, name, contact, legal_name, document, address, legal_rep_name, legal_rep_document, created_at, updated_at` and **no `status`**, confirmed against `apps/api/drizzle/meta/0018_snapshot.json`.
`ClientSchema` has no `status` key either, and `updateClient` writes no such column.

An earlier draft of this slice proposed adding the column here.
That was rejected: slices 03 and 04 each independently and correctly declined to build any cliente affordance, so the column plus its zod key plus its service plumbing would have shipped as a migration and a code path with **no caller anywhere in the product**.
The user's request named "products, persons, roles and so on" and did not name clientes.
Dead code behind an irreversible migration is worse than a smaller coherent feature.

Consequences the executor must honour:

- This slice touches **no** file under `apps/api/drizzle/**` and **does not** modify `apps/api/src/db/schema.ts`. It has no migration at all.
- `CadastroEntityTypeSchema` has **four** members, not five.
- `updateClient` and `ClientSchema` are **not** modified. `PATCH /clients/:id` keeps its current signature and writes no ledger row.
- Feature acceptance criterion 1 is amended in `nexo/runs/feature-20260805-cadastro-archive-history/00-OVERVIEW.md` to name the four status-bearing cadastros, with the deferred cliente work recorded there for `nexo/ROADMAP.md`.

The only migration in this whole feature is slice 02's `audit_log` index, which therefore takes `0019` (the highest tag on disk is `0018_professional_payable_identity`, journal `idx: 18`).

## Design decision

**Two lifecycle actions, `cadastro.archived` and `cadastro.restored`, appended by a single domain-local helper called with the tenant transaction handle as the last statement of each of the four update functions, fired only on an actual status transition.**

### The action names

`AuditActionSchema` grows from five members to seven:

```ts
export const AuditActionSchema = z.enum([
  'conversion.recorded',
  'commission.created',
  'commission.approve',
  'commission.reverse',
  'payout.mark_paid',
  'cadastro.archived',
  'cadastro.restored',
]);
```

Two actions, not ten.
The entity type is carried by the existing `entity_type` column, which is exactly what that column is for and what `conversion` / `commission` / `payout` already put there.
The four values are pinned by a new exported enum so the set is closed:

```ts
/** The four sales-ops cadastros whose archive/restore lifecycle is audited. */
export const CadastroEntityTypeSchema = z.enum(['produto', 'pessoa', 'funcao', 'area']);
export type CadastroEntityType = z.infer<typeof CadastroEntityTypeSchema>;

/** The two lifecycle actions the cadastro history reads back. */
export const CADASTRO_LIFECYCLE_ACTIONS = ['cadastro.archived', 'cadastro.restored'] as const;
```

**These four strings and these two action names are a WIRE CONTRACT, not an internal detail.**
Slice 02 returns `entityType` and `action` verbatim as free text, and slice 04's `normalizeHistoryEntityKind` / `normalizeHistoryVerb` match against exactly these eight literals.
Renaming any of them silently turns every history row read-only in the UI.
Slice 02 deliberately does NOT import this file (see its section 2.3), so nothing but this paragraph and slice 04's unit tests hold the two ends together.

Rationale for two-over-ten: the history UI's two axes are "what happened" and "to what kind of thing", and they are already two columns.
Ten actions would encode the second axis twice, would make slice 04's request `action IN (<ten literals>)` instead of `action IN (<two>)`, and would have to be extended every time a fifth cadastro appears - whereas a fifth cadastro under this scheme only adds a member to `CadastroEntityTypeSchema`.

Rationale for the pt-BR entity type values: `produto`, `pessoa`, `funcao` and `area` are the exact words the routes, the error sentinels (`funcao_is_system`, `funcao_required`, `unknown_funcao`, `area_name_taken`) and CLAUDE.md already use for these four things, and they are the words the UI renders.
Inventing an English noun for `função` would create a word that exists nowhere else in the product.
Diacritics are dropped (`funcao`, `area`, not `função`, `área`) because the value is a machine key that lands in a URL query string in slice 02, matching how `slugifyFuncao` already treats these names.

Rejected: keeping `AuditActionSchema` untouched and writing a raw string.
`writeAuditEntry` types `action: AuditAction`, so an unregistered string does not compile - and that closed enum is the mechanism that keeps the ledger's vocabulary reviewable.
The Frame's scope limit is "no change to the five existing Phase-05 audit actions", not "no new actions"; the five stay untouched, byte for byte.

Rejected: `packages/shared-types/src/audit.ts`.
That file's `AUDIT_ACTIONS` registry has zero importers anywhere in `apps/` or `packages/` - it is unused template scaffolding, still holding `org.placeholder.created`.
Wiring the API's live enum to a dead registry would be a cross-package refactor with no consumer, and the constraint for this slice is `apps/api/**` only.

### What goes in beforeJsonb / afterJsonb

```ts
beforeJsonb: { status: <the stored status before the write> }
afterJsonb:  {
  status: <the stored status after the write>,
  label: <the cadastro's display name at the time>,
  actorLabel: <the actor's display name at the time, or null>,
}
```

Nothing else.

`status` on both sides is the literal the database stores, so a pessoa reads `{status:'active'}` -> `{status:'inactive'}` while an área reads `{status:'active'}` -> `{status:'archived'}`.
The ledger records what the column holds; the *action* names the lifecycle event.
That is why one pair of actions covers a column with two different archived spellings, and why a future third spelling needs no new action.

`label` is a snapshot of the human name at the moment of the event (`displayName` for a pessoa, `name` for the other three).
It is there for one reason: CLAUDE.md forbids rendering a raw account or workspace id in user-facing UI, and `entity_id` is a bare uuid.
Snapshotting the label is what lets slice 04 render "Arquivou o produto *FXL Custom*" without joining back to a row that may since have been renamed, or worse, rendering the uuid.
It sits in `afterJsonb` only, not both: archive and restore are status-only writes, so the label is invariant across the event and storing it twice would only double the bytes inside the hash input.

**`actorLabel` is the same argument applied to the actor, and it is what makes feature acceptance criterion 3 reachable at all.**
`actor_user_id` is a raw Hub account id, which CLAUDE.md forbids as a user-facing label.
There is no Hub account directory: `@fxl-business/hub-sdk/server` exports only `createHubBff` and `requireHubAuth`, and `sales_ops_people` has no account-id column, so **nothing downstream can ever resolve a third party's account id to a name**.
The one moment in the entire system where that name is available is right here, on the verified token of the person doing the write.
Snapshotting it is therefore not an optimization, it is the only path: without it, every archive performed by a second workspace admin renders as an unnamed actor forever, and criterion 3 ("naming the actor as a person rather than a raw Hub account id") is not met by the feature.

`null` is a legitimate stored value (a token carrying neither `name` nor `email`), and slice 04 renders the pt-BR primary label `Autor não identificado` for it - never the id as the headline. See slice 02 section 4.3 for how the read layer consumes this and what it falls back to for pre-existing rows that have no `actorLabel`.

**Do not dump whole rows** - including for the actor. `actorLabel` is one scalar string, chosen so that slice 02 can project it with `after_jsonb ->> 'actorLabel'` without ever shipping the blob.

A `sales_ops_products` row carries commission percentages and price cents; a `sales_ops_people` row carries `contact_email`.
`audit_log` has no `org_id` column, no RLS, no retention policy and no purge path (Frame scope limit), and it is read today through `getAdminDb()` with no tenant filter.
Copying tenant PII into a table with those properties is a liability that the history UI gets nothing from - it needs "what kind of thing, which one, called what, from which state to which state", and that is precisely the four fields above plus the two existing columns.
The existing money writers do pass whole rows (`afterJsonb: payout`, `afterJsonb: conversion`); this slice deliberately does not follow them there, because a payout row is the audited fact itself whereas a cadastro row is mostly fields the lifecycle event did not touch.

### Only the lifecycle, not every UPDATE

**Recommendation: audit archive and restore only. Do not audit renames, price edits or any other ordinary field write.**

The ask was "a history about who did what" scoped to deletions, plus the ability to revert them, and archive/restore is the entirety of what is revertible.
An entry for a rename would be a read-only curiosity that no screen in this feature can act on.

Three concrete reasons beyond scope discipline:

1. **Cost per save.** `writeAuditEntry` takes `FOR UPDATE` on the ledger's tail row, which is a single global lock point (see Concurrency below). Auditing every field write would put every produto save in the product wizard behind that lock. Auditing only the lifecycle puts a human-scale event rate behind it - a handful per org per day.
2. **Unbounded growth against a ledger that cannot be purged.** The chain is `entry_hash = sha256(prev_hash || canonical_json(row))`; deleting old rows breaks every row after them. So a retention policy is not a later add-on, it is a chain redesign. Every row written is written forever, which is an argument for writing only rows that matter.
3. **A field diff is a different design.** "Who renamed what to what" needs a before/after diff shape, a per-field renderer and a decision about which fields are even auditable (is `updated_at` a change?). That is a feature, not a line of code, and it has no requester.

Creates are not audited either, for the same reason: a created row already carries `created_at`, nothing about it is revertible, and the ask is about deletions.

If the appetite for full-mutation auditing returns, it belongs in `nexo/ROADMAP.md` as its own item; do not smuggle it in here.

### Atomicity

`writeAuditEntry`'s contract is "MUST be called inside the caller's transaction (pass the tx handle)".
Every one of the four update functions already runs its whole body inside `withTenant(db, orgId, async (tx) => ...)`, which is `db.transaction()` with `setTenantContext` as its first statement.
So the guarantee is obtained by construction and by exactly one rule:

> **Pass the `tx` handle from the `withTenant` callback. Never pass `db`.**

Passing `db` would check out a second pooled connection and open a second, independent transaction; the audit row would then commit even when the status write rolled back, and the whole point of the slice would be silently gone with every test still green except the rollback oracle.
The `Db` type alias in the sales-ops service is applied to both `db` and `tx`, so TypeScript will **not** catch this. It is a review item and it is what oracle assertions 8 and 9 exist to catch.

Two placement rules follow:

- The audit call is the **last** statement in the transaction body, after the row UPDATE and after any child-table writes (`replaceProductFuncaoCosts`, `replacePersonFuncoes`). This minimizes how long the global tail lock is held before COMMIT.
- In `updateFuncao` the row UPDATE runs inside a **nested** drizzle transaction, which is a Postgres SAVEPOINT opened to absorb a unique violation. The audit call goes **after** that nested block returns, still inside the outer `withTenant` transaction - never inside the savepoint. Inside it, a rolled-back rename savepoint would take the audit row with it while the outer transaction committed something else, or (worse ordering) leave the tail lock taken inside a rolled-back subtransaction.

### Which connection, and what RLS applies

**`getDb()` - specifically, the `tx` handle that `withTenant` derives from it.**

There is no choice to make once atomicity is required: the status change happens on the tenant connection inside `withTenant`, and "same transaction" means the same handle.
This differs from `commissions/service.ts` and `payouts/service.ts`, which pass a `getAdminDb()` transaction, and the difference is not an inconsistency - those are admin, cross-tenant domains whose *mutation* runs on the admin connection, so their audit write is on the admin connection for the same reason: it is the transaction the mutation is in.
The house pattern is "whatever transaction the mutation is in", and this slice follows it exactly.
`conversions/service.ts` is the same story with `'system'` as the actor, because a webhook has no user.

What RLS applies to the audit write: **none**.
`audit_log` is created in `0000_fancy_klaw.sql` and is deliberately absent from the `ENABLE ROW LEVEL SECURITY` list in `0008_single_role_rls_context.sql`; that file's own footer names it - "audit_log - append-only; admin SELECT; system INSERT".
It has no `org_id` column, so `setTenantContext`'s `app.current_org_id` has no effect on it, and the tail-row `SELECT ... FOR UPDATE` sees the true global tail regardless of which org's transaction is running.
Tenant scoping of the ledger is therefore a **query-time** property, carried by `actor_org_id`, which is why the Frame is right that slice 02 must filter on `actorOrgId = c.get('orgId')` and must not reuse `/api/v1/admin/audit`.
This slice's job on that front is to make sure `actorOrgId` is **always** populated for cadastro entries - it is optional in `WriteAuditEntryInput` and null for a row would make that row invisible to slice 02's org-scoped read forever.

### Concurrency

`writeAuditEntry` runs `SELECT entry_hash FROM audit_log ORDER BY id DESC LIMIT 1 FOR UPDATE`.
That is a lock on **one row - the global tail** - and it is held until COMMIT.

- **Throughput.** Every audited write in the entire cluster, across all orgs and all domains, serializes at that point. The effective ceiling is one audited transaction at a time, for as long as the slowest such transaction takes to commit. This is a pre-existing property of the ledger, not something this slice introduces; the slice adds cadastro archives to the queue. Cadastro archives are a human action at human rates, so the ceiling is not a practical constraint here. Keeping the audit call last in the transaction is what keeps the hold window to "one INSERT plus COMMIT".
- **Can two concurrent archives in different orgs deadlock? No.** A deadlock needs two locks acquired in opposite orders by two transactions. Both writers take exactly two locks: the cadastro row lock (implicitly, from the `SELECT ... FOR UPDATE` on the row and then the UPDATE) and the audit tail lock. The rows are different (different orgs), so there is no contention on the first. The second is one row that both want, taken by every writer in the same position in the sequence, so it can only ever queue - never cycle.
- **The rule that keeps that true, and which the executor must not break:** in each function the cadastro row is locked **first** and the audit tail **last**. If any future writer took the audit tail before its row lock, a two-transaction cycle would become constructible. Write it in the comment beside the helper.
- **Same row, same org, two concurrent archives:** the second blocks on the row lock, and once it proceeds it re-reads the row under the lock and sees `archived`, so `cadastroLifecycleEvent` returns `null` and no duplicate entry is written. This is why the "before" read must be a `SELECT ... FOR UPDATE` and not a plain read - see the next section.

## Exact files and changes

### 1. `apps/api/src/domains/audit/service.ts`

- Extend `AuditActionSchema` with `'cadastro.archived'` and `'cadastro.restored'`, appended **after** the five existing members. Do not reorder or reword the existing five.
- Add the exported `CadastroEntityTypeSchema`, `CadastroEntityType` and `CADASTRO_LIFECYCLE_ACTIONS` shown above, with the comment recording that these eight literals are the wire contract slice 04 matches on.
- Nothing else in this file changes. `writeAuditEntry`, `computeEntryHash`, `canonicalJson` and `verifyChain` are untouched; the chain algorithm is a Frame scope limit.

**This slice has NO migration and does NOT modify `apps/api/src/db/schema.ts`.** See "Cliente is OUT of this feature" above. `apps/api/drizzle/**` is slice 02's alone, and its index migration is `0019`.

### 2. `apps/api/src/middleware/app-auth.ts`

Purely additive, so the actor's own display name can be read off the **verified** token without an `any` cast (`@typescript-eslint/no-explicit-any` is `error` in `apps/api/eslint.config.js`).

Widen `MinimalHubAuthContext['claims']` with two optional fields and export one pure helper:

```ts
export type MinimalHubAuthContext = {
  accountId: string;
  workspaceId: string;
  claims: {
    entitlements: { modules: string[] };
    roles: { productRoles?: unknown; workspace: string };
    isSuperAdmin?: boolean;
    /** Present on the Hub access token; the web reads the same two claims. */
    name?: string;
    email?: string;
  };
};

/**
 * The caller's own display name from the VERIFIED token. Returns null rather
 * than falling back to the account id - a raw account id is never a label.
 */
export function getHubActorDisplayName(auth: MinimalHubAuthContext | undefined): string | null {
  const name = auth?.claims?.name;
  if (typeof name === 'string' && name.trim() !== '') return name;
  const email = auth?.claims?.email;
  if (typeof email === 'string' && email.trim() !== '') return email;
  return null;
}
```

Nothing existing in this file changes: no signature, no middleware behaviour, no role derivation, and `apps/api/src/middleware/__tests__/app-auth.test.ts` must stay green unmodified.

**This helper lives in slice 01, not slice 02.** Slice 02 originally planned the identical edit; the write path needs it first (to snapshot `actorLabel`) and slice 02 `depends_on` slice 01, so slice 02 imports it and must not re-add it. Two slices adding the same export to the same file is a merge conflict, not a coincidence.

### 3. `apps/api/src/domains/sales-ops/service.ts`

**a. Imports.** Add `import { writeAuditEntry, type CadastroEntityType } from '../audit/service.js';`.

**b. The actor type.** Export it, next to the other shared types:

```ts
/**
 * Who is performing a cadastro write. An OBJECT, not a bare string, on purpose:
 * `orgId`, `id` and the actor id are all strings, and a fifth positional string
 * parameter would let a transposition compile silently on the one field the
 * audit ledger exists to record.
 *
 * `displayName` is the actor's name from the VERIFIED token, snapshotted into the
 * ledger entry. It is the ONLY moment that name is knowable: there is no Hub
 * account directory and no join from an account id to a pessoa, so a reader who
 * does not find it here can never recover it. `null` is legitimate.
 */
export type CadastroActor = { userId: string; displayName: string | null };
```

**c. The transition classifier - pure, and the only place the rule lives:**

```ts
/**
 * The archived spelling per cadastro: pessoas use 'inactive', everything else
 * uses 'archived'. Read by cadastroLifecycleEvent and by nothing else.
 */
type ArchivedStatus = 'archived' | 'inactive';

/**
 * Classifies a status write as a lifecycle event, or as nothing at all.
 *
 * `null` for "no transition" is load-bearing, not defensive: the produto dialog
 * and the pessoa dialog both submit their FULL row on every save, `status`
 * included, so an ordinary rename arrives as a PATCH carrying status:'active'
 * on an already-active row. Without this guard every save would append a
 * spurious 'restored' entry and the history would be unreadable.
 */
function cadastroLifecycleEvent(
  before: string,
  after: string,
  archived: ArchivedStatus,
): 'cadastro.archived' | 'cadastro.restored' | null {
  if (before === after) return null;
  if (after === archived) return 'cadastro.archived';
  if (after === 'active') return 'cadastro.restored';
  return null;
}
```

**d. The single writer:**

```ts
/**
 * Appends the archive/restore ledger entry for one cadastro write.
 *
 * MUST be handed the `tx` from withTenant, never `db`: writeAuditEntry takes
 * FOR UPDATE on the ledger's tail row and the entry has to be atomic with the
 * status change that produced it. Both parameters are typed `Db`, so passing
 * `db` compiles - it just silently commits the entry outside the status write's
 * transaction. See cadastro-archive-audit.test.ts for the rollback oracle.
 *
 * Call it LAST in the transaction body. The tail lock is global (audit_log has
 * no org_id and no RLS), so it is held from here until COMMIT, and the cadastro
 * row must already be locked before it - locking in that order is what makes a
 * cycle between two concurrent archives impossible.
 */
async function auditCadastroLifecycle(
  tx: Db,
  input: {
    actor: CadastroActor;
    orgId: string;
    entityType: CadastroEntityType;
    entityId: string;
    label: string;
    before: string;
    after: string;
    archived: ArchivedStatus;
  },
): Promise<void> {
  const action = cadastroLifecycleEvent(input.before, input.after, input.archived);
  if (!action) return;
  await writeAuditEntry(tx, {
    actorUserId: input.actor.userId,
    // Never null for a cadastro entry: slice 02's history read is scoped by
    // actor_org_id, so a null here would hide the row from its own tenant forever.
    actorOrgId: input.orgId,
    action,
    entityType: input.entityType,
    entityId: input.entityId,
    beforeJsonb: { status: input.before },
    // `actorLabel` is snapshotted here because this is the only place it is
    // knowable: there is no Hub account directory, so a reader can never resolve
    // actor_user_id to a name. Slice 02 projects it with `after_jsonb ->> 'actorLabel'`.
    afterJsonb: { status: input.after, label: input.label, actorLabel: input.actor.displayName },
  });
}
```

`requestId` is deliberately omitted.
No writer in the codebase populates it and the API mounts no request-id middleware - `grep -rn "requestId" apps/api/src` returns only the audit schema, the audit writer and the audit read route.
Inventing correlation-id plumbing is a separate concern and is not in this Frame.

**e. The four update functions.** Each one gains an `actor: CadastroActor` parameter appended to its signature, a `FOR UPDATE` on its "before" read, and one `auditCadastroLifecycle` call as its last statement.

`updateClient` is **not** in this list and is not modified. See "Cliente is OUT of this feature" above.

The `FOR UPDATE` on the before-read is required, not cosmetic: without it two concurrent archives of the same row can each read `active` and each append an `archived` entry.
`lockCommission` in `apps/api/src/domains/commissions/service.ts` already does exactly this (`.limit(1).for('update')`) for the same reason, so this is the house precedent, not a new idea.

| function | before-read | archived spelling | entityType | label source |
| --- | --- | --- | --- | --- |
| `updateProduct` | existing `current` select, add `.for('update')` | `archived` | `produto` | `product.name` |
| `updatePerson` | existing `current` select, add `.for('update')` | `inactive` | `pessoa` | `person.displayName` |
| `updateFuncao` | existing `current` select, add `.for('update')` | `archived` | `funcao` | `funcao.name` |
| `updateArea` | **add** a `current` select with `.for('update')` | `archived` | `area` | `area.name` |

Per-function detail:

- **`updateProduct(db, orgId, id, data, actor)`** - after `if (!product) return null;` and after the `data.productFuncaoCosts !== undefined` replace, before building the return value, call the helper with `before: current.status, after: product.status`.
- **`updatePerson(db, orgId, id, data, actor)`** - it has two return paths (with and without a resolved função set). Restructure so both compute the `PersonWithFuncoes` into one local, then call the helper once with `before: current.status, after: person.status`, then return. Do not duplicate the call down both branches.
- **`updateFuncao(db, orgId, id, data, actor)`** - the `is_system` guard already returns before any write, so a system função can never reach the helper; that is the mechanism behind oracle assertion 6. Place the call after the `try`/`catch` nested-transaction block returns a non-null `funcao`, using `before: current.status, after: funcao.status`. Keep it out of the savepoint.
- **`updateArea(db, orgId, id, data, actor)`** - add the `current` select as the FIRST statement in the body, `return null` when it is absent, then keep the existing duplicate-name probe and the UPDATE unchanged, then call the helper with `before: current.status, after: area.status`. Returning null early for an unknown or cross-org id preserves today's behaviour exactly (the UPDATE matched nothing and returned null), which is what `areas-rls.test.ts:70` asserts.

### 4. `apps/api/src/domains/sales-ops/routes.ts`

Four PATCH handlers pass the actor from the **verified** context, never from the body:

```ts
const person = await updatePerson(getDb(), c.get('orgId'), c.req.param('id'), parsed.data, {
  userId: c.get('userId'),
  displayName: getHubActorDisplayName(c.get('hubAuth')),
});
```

Same shape for `/products/:id`, `/areas/:id`, `/funcoes/:id`. `/clients/:id` is **unchanged**.
`c.get('userId')` is the Hub account id set by `appAuthMiddleware` from the verified token (`apps/api/src/middleware/app-auth.ts:151`), and it is typed `string` by the `ContextVariableMap` declaration in `apps/api/src/middleware/auth.ts`.
`getHubActorDisplayName` is the helper added in section 2 of this slice; import it from `../../middleware/app-auth.js`.
`/api/v1/sales-ops/*` is behind `appAuthMiddleware` in `server.ts`, so both are always populated.
No new middleware, no new route, **no DELETE verb**, and no change to any response body at all.

## The named oracle test

**`apps/api/test/rls/cadastro-archive-audit.test.ts`** - new file, integration suite.

Modelled on `apps/api/test/rls/funcoes-rls.test.ts`: an app (non-superuser `fxl_sales_test`) connection driving the real service functions, plus an admin (`app.fxl_admin`) `postgres.Sql` for seeding, raw assertions, trigger management and cleanup.
Driving the writes over the **app** connection is deliberate - it also proves the tenant role can actually `INSERT` into `audit_log` and take `FOR UPDATE` on its tail, which is a live failure mode (see Risks).

Fixtures: two fresh org ids per test group (`org_audit_<label>_a_<stamp>`), a constant actor `const ACTOR = { userId: 'acct_audit_test_' + stamp, displayName: 'Auditor de Teste' }`, and cadastros created through the real `createArea` / `createProduct` / `createFuncao` / `createPerson`.

**`beforeAll`** must additionally run, over the admin client:

```sql
DELETE FROM audit_log WHERE length(entry_hash) = 64
```

This gives the ledger a deterministic genesis so `verifyChain` over the whole table is a meaningful assertion.
It preserves the pre-Phase-05 placeholder rows (`entry_hash = ''`), which the product deliberately treats as outside the chain.
It is safe: `apps/api/vitest.config.ts` sets `fileParallelism: false` for the integration project precisely because the suite shares one ledger, and `conversion-ingest.test.ts` / `conversion-webhook-contract.test.ts` already delete their own rows in `afterAll` for the same reason.

**`afterAll`** deletes `audit_log WHERE actor_org_id = <each org>`, then the cadastro rows per org (person_funcoes, funcoes, people, product_funcao_costs, products, areas, and the one cliente assertion 5b creates), then drops both test triggers defensively, then closes both clients.

**Why the ledger cleanup in this file and in `areas-rls` / `funcoes-rls` cannot punch a hole in the chain.** `apps/api/vitest.config.ts` sets `fileParallelism: false` for the integration project, so a file's `afterAll` runs before the next file's first statement. Every row a file wrote is therefore still the ledger **tail** when that file deletes it, and a tail delete leaves the remaining chain contiguous. Were `fileParallelism` ever turned on, these deletes would start removing rows from the middle of the chain and `verifyChain` would fail everywhere. Say so in a comment at the top of each `afterAll` that touches `audit_log`.

### Assertions

1. **Archive writes the entry, with the right everything.** `createArea(db, orgA, {name:'Marketing', status:'active'})`, then `updateArea(db, orgA, area.id, {status:'archived'}, ACTOR)`. Read `audit_log WHERE actor_org_id = orgA ORDER BY id ASC`: exactly one row, with `actor_user_id === ACTOR.userId`, `actor_org_id === orgA`, `action === 'cadastro.archived'`, `entity_type === 'area'`, `entity_id === area.id`, `before_jsonb` deep-equal `{status:'active'}`, `after_jsonb` deep-equal `{status:'archived', label:'Marketing', actorLabel:'Auditor de Teste'}`, `prev_hash` = 64 zeros, `entry_hash` matching `/^[a-f0-9]{64}$/`.
2. **Restore is a NEW append, never a rewrite.** `updateArea(db, orgA, area.id, {status:'active'}, ACTOR)`. Now exactly **two** rows; the second has `action === 'cadastro.restored'`, `before_jsonb` `{status:'archived'}`, `after_jsonb` `{status:'active', label:'Marketing', actorLabel:'Auditor de Teste'}`, and `rows[1].prev_hash === rows[0].entry_hash`. The first row is byte-identical to what assertion 1 read (re-read it and compare) - the chain is append-only and archiving is never "undone" in place.
2b. **A null actor display name is stored as null, never as the account id.** `updateArea(db, orgA, area2.id, {status:'archived'}, { userId: ACTOR.userId, displayName: null })`. Assert `after_jsonb.actorLabel === null` and, decisively, `after_jsonb.actorLabel !== ACTOR.userId`. This is what stops a well-meaning executor from writing `displayName ?? userId` and smuggling a raw Hub account id into the field slice 04 renders as a person's name.
3. **The chain is valid.** Select **all** rows `WHERE length(entry_hash) = 64 ORDER BY id ASC`, map them into `AuditChainRow` exactly as `apps/api/src/domains/audit/routes.ts:toChainRow` does, and assert `verifyChain(...)` returns `{valid: true, brokenAt: null}`. This is the same query and the same function `/api/v1/admin/audit/verify-chain` runs, so a pass here is a pass there.
4. **A non-transition writes nothing.** From a clean per-test org: `updateArea(..., {name:'Renomeada'}, ACTOR)` (no status key at all) and `updateArea(..., {status:'active'}, ACTOR)` on an already-active row. Both must succeed and both must leave `count(*) FROM audit_log WHERE actor_org_id = <org>` at `0`. This is the assertion that fails if the executor drops the `before === after` guard, and it is the one that protects the history from being flooded by ordinary saves.
5. **All four entity types, one entry each.** Archive one produto, one pessoa, one funcao (a non-system one) and one area in a dedicated org. Assert the four `entity_type` values are exactly `{produto, pessoa, funcao, area}` - these are the literals slice 04 matches on, so a typo here is a silently read-only history - that the pessoa's row carries `after_jsonb.status === 'inactive'` while the other three carry `'archived'` (the pt-BR archived-spelling split), that each `label` equals the cadastro's own name, and that `verifyChain` over the whole ledger is still valid.
5b. **A cliente write produces no ledger row.** `updateClient(db, org, client.id, {name:'Renomeado'})` succeeds and leaves `count(*) FROM audit_log WHERE entity_id = client.id` at `0`. Cliente is deliberately out of this feature; this pins that `updateClient` was not quietly instrumented.
6. **A system função is refused and logs nothing.** Seed a `vendedor` row with `is_system = true` over the admin client, call `updateFuncao(db, org, id, {status:'archived'}, ACTOR)`, expect the `'is_system'` sentinel, and assert zero audit rows for that `entity_id`. Positive control in the same org: an org-created função archives and does produce exactly one row.
7. **A cross-org write is refused and logs nothing.** `updateArea(db, orgB, areaOfOrgA.id, {status:'archived'}, ACTOR)` returns `null`, the área is still `active` when read raw, and there is no `audit_log` row with that `entity_id`. A write that never happened must never appear in the history.
8. **ROLLBACK PROOF - a failing ledger write takes the status change with it.** Over the admin client, create

   ```sql
   CREATE FUNCTION fxl_audit_rollback_probe() RETURNS trigger AS $$
   BEGIN RAISE EXCEPTION 'fxl_audit_rollback_probe'; END $$ LANGUAGE plpgsql;
   CREATE TRIGGER fxl_audit_rollback_probe_trg BEFORE INSERT ON audit_log
     FOR EACH ROW WHEN (NEW.entity_id = '<sentinel area id>')
     EXECUTE FUNCTION fxl_audit_rollback_probe();
   ```

   then `await expect(updateArea(db, org, sentinelArea.id, {status:'archived'}, ACTOR)).rejects.toThrow(/fxl_audit_rollback_probe/)`.
   Assert over the admin client that the área's `status` is **still `'active'`** and that no `audit_log` row exists for that `entity_id`.
   Drop the trigger and the function in a `finally`.
   This is the assertion that cannot be satisfied by a fire-and-forget or after-commit audit write, and it is the one that fails if the executor passes `db` instead of `tx`. The predicate is pinned to a sentinel id so nothing else in the suite can trip it.
9. **ROLLBACK PROOF, other direction - a failing status write leaves no entry.** Same technique with `BEFORE UPDATE ON sales_ops_areas ... WHEN (NEW.status = 'archived' AND NEW.id = '<second sentinel id>')`. Expect the rejection, assert the row is still `active` and that no `audit_log` row carries that `entity_id`.
10. **The chain survives both rollbacks.** Re-run assertion 3's full-ledger `verifyChain` at the end of the file: still `{valid: true, brokenAt: null}`. A partially-applied entry would have broken it.

### Existing tests that must change

Signature change (`actor` appended), plus audit cleanup where the test now produces ledger rows:

- `apps/api/test/rls/areas-rls.test.ts` - `updateArea` call sites, **and** add `DELETE FROM audit_log WHERE actor_org_id = ${orgId}` to the per-org `afterAll` loop (line 72 archives an área, so this file now writes to the ledger and must clean up after itself or it corrupts `conversion-ingest.test.ts`'s genesis-anchored chain assertion).
- `apps/api/test/rls/funcoes-rls.test.ts` - `updateFuncao` / `updatePerson` call sites, **and** the same `afterAll` cleanup line (lines 106 and 178-184 archive funções).
- `apps/api/test/rls/product-funcao-costs-rls.test.ts`, `apps/api/test/rls/product-commission-contract.test.ts`, `apps/api/test/rls/funcoes-concurrency.test.ts` - `update*` call sites only. None of them touches `status`, verified by `grep -rn "'archived'\|'inactive'" apps/api/test/rls/`, so none writes a ledger row and none needs cleanup. Do not add cleanup they do not need.
- `apps/api/test/rls/client-legal-fields.test.ts` is **not** in this list and needs no edit: `updateClient` keeps its current signature.
- `apps/api/src/domains/sales-ops/__tests__/routes.test.ts` - the `toHaveBeenCalledWith(mockedDb, 'verified-org', <id>, <data>)` assertions on `updatePerson`, `updateArea` and `updateFuncao` gain a fifth expected argument `{ userId: 'verified-account', displayName: <whatever the fake context's hubAuth claims yield> }`. Keep it as a literal, not `expect.anything()`: it is what proves the route threads the **verified** account id and the **verified** token's name rather than anything from the request body, which is the same class of assertion the file already makes about `orgId`. Add one case where the fake `hubAuth` carries no `name`/`email` and assert `displayName: null` - never the account id.

No `apps/web/**` change is planned or permitted here (slices 03 and 04 own it), and no history read endpoint is planned (slice 02 owns it).

## How to run

```bash
pnpm --filter @fxl-sales/api lint
pnpm --filter @fxl-sales/api type-check
pnpm --filter @fxl-sales/api test          # unit; routes.test.ts lives here

# Integration - pinned to the LOCAL Docker DB. setup-env.ts hard-overrides
# DATABASE_URL. This slice adds no migration, so nothing new is applied here.
TEST_DATABASE_URL=postgresql://fxl_sales_test:<pw>@localhost:5006/fxl_sales \
TEST_MIGRATE_DATABASE_URL=postgresql://postgres:<pw>@localhost:5006/fxl_sales \
ADMIN_DATABASE_URL=postgresql://postgres:<pw>@localhost:5006/fxl_sales \
pnpm --filter @fxl-sales/api test:integration

# Then the repo gates.
pnpm run lint && pnpm run type-check && pnpm test && pnpm run build
```

The credentials are the ones in `apps/api/.env` under `TEST_*` / `ADMIN_DATABASE_URL`, per `nexo/knowledge/decisions/2026-07-29-integration-tests-are-hermetic-local.md`.
`apps/api/.env`'s bare `DATABASE_URL` points at **staging** - never migrate against it.

## Risks

1. **`db` passed where `tx` was meant.** Both are typed `Db`, so it compiles and every test passes except oracle assertion 8. This is the single highest-value review point of the slice, and the reason assertion 8 is written the way it is.
2. **The `before === after` guard being dropped or inverted.** The produto and pessoa dialogs submit their full row including `status` on every save, so a missing guard turns every ordinary save into a `cadastro.restored` entry, floods the ledger and makes slice 03's history useless. Oracle assertion 4 is the guard's guard.
3. **The app role may lack privileges on `audit_log`.** `SELECT ... FOR UPDATE` requires `UPDATE` privilege in Postgres, not just `SELECT`. The documented local grant (`GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO fxl_sales_test`) covers it, and in deployed environments the app connects as the owning role. But if `test:integration` reports `permission denied for table audit_log`, re-run that grant from the knowledge doc - it is local provisioning, not an application migration. Note for the record: no migration ever `REVOKE`s anything on `audit_log`, so the "append-only; admin SELECT; system INSERT" comment in `0000_fancy_klaw.sql` is documentation of intent, not an enforced grant. If anyone ever enforces it by revoking `UPDATE`, `writeAuditEntry`'s tail lock breaks for **every** writer in the product, not just this one.
4. **Ledger cleanup between integration files.** `conversion-ingest.test.ts` asserts `verifyChain` over rows filtered to its own org, which is only valid because its first row is the ledger genesis. Any file that writes ledger rows and does not delete them will break it, depending on file order. This slice adds three such files (the new oracle plus `areas-rls` and `funcoes-rls`), and all three must clean up. If `conversion-ingest.test.ts` starts failing at its chain assertion, a missing `DELETE FROM audit_log` is the first place to look.
5. **The eight wire literals are unenforced across the API/web boundary.** `entity_type` (`produto`/`pessoa`/`funcao`/`area`) and `action` (`cadastro.archived`/`cadastro.restored`) are plain text on the wire; slice 02 passes them through as free strings by design and slice 04 matches them exactly. Nothing type-checks the pair. A rename here degrades silently: the history still lists the row but renders it read-only with no restore. Slice 04's pure-function tests pin the literals from the web side, and oracle assertion 5 pins them from the API side; those two are the only guard.
6. **`actorLabel` is a snapshot, so a later rename in the Hub does not propagate.** That is the correct behaviour for a ledger (it records what was true at the instant), but an operator who renames themselves will see the old name on old rows. Do not "fix" this by resolving live - there is nothing to resolve against.
7. **Pre-existing ledger rows carry no `actorLabel`.** Every row written before this slice - conversions, commissions, payouts - has an `after_jsonb` with no such key. Slice 02's read must fall back gracefully (it does; see its 4.3), and slice 04's panel filters to the two cadastro actions anyway, so in practice the panel only ever sees rows this slice wrote.
7. **The tail lock is a global serialization point.** Pre-existing, and irrelevant at cadastro-archive rates, but it is a real ceiling shared with conversions and commissions. If a future slice ever audits high-frequency writes, this is where it will hurt, and the fix is a chain redesign rather than an index.
