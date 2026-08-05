---
id: 02-org-scoped-history-read
milestone: v2.4.0
status: todo
depends_on: [01-audit-the-cadastro-lifecycle]
files_modified:
  - apps/api/src/domains/audit/history-service.ts
  - apps/api/src/domains/sales-ops/routes.ts
  - apps/api/src/db/schema.ts
  - apps/api/drizzle/0019_audit_log_org_history_idx.sql
  - apps/api/drizzle/meta/_journal.json
  - apps/api/drizzle/meta/0019_snapshot.json
  - apps/api/src/domains/sales-ops/__tests__/history-route.test.ts
  - apps/api/test/rls/audit-history-org-scope.test.ts
acceptance: "given hash-chained audit entries exist for org A and for org B, when an org A admin calls GET /api/v1/sales-ops/history over the non-superuser tenant connection, then only org A's entries come back - newest first, keyset paginated, each carrying entityLabel and naming its actor by display name or an explicit null and never by a bare account id - and org B's entries are absent even though that same connection can read them with the org filter removed"
---

# 02 - Org-scoped history read

API only.
No file under `apps/web/**` is touched by this slice.
`AuditActionSchema` and `writeAuditEntry` are NOT modified here - slice 01 owns them and this slice only reads what they produce.

## 0. Reconciliations applied at plan-check - read before anything else

Four things changed after the parallel planners were reconciled. They are woven into the sections below; this list exists so nothing is missed.

1. **Migration number is `0019`, not a clash.** Slice 01 originally also claimed `0019`. Cliente was deferred out of the feature, so slice 01 now carries **no migration at all** and does not touch `apps/api/src/db/schema.ts`. The highest tag on disk is `0018_professional_payable_identity` (journal `idx: 18`), so `drizzle-kit generate` emits `0019` for this slice's index. That is also the number the tool will actually pick, which matters because this plan forbids hand-editing `meta/_journal.json`.
2. **`apps/api/src/middleware/app-auth.ts` is now SLICE 01's file.** The `MinimalHubAuthContext` widening and `getHubActorDisplayName` moved there, because the write path needs the caller's name first (to snapshot `actorLabel`). This slice `depends_on` slice 01, so it **imports** the helper and must not re-add it. Section 4.5 is now a reminder, not an edit.
3. **The response carries `entityLabel`.** Slice 04 needs the ledger's name snapshot and cannot get it any other way. It is projected as the scalar `after_jsonb ->> 'label'`, never as the blob, so section 2.6's PII rule is intact. See section 4.1a.
4. **The `action` filter accepts a comma-separated SET.** Slice 04's panel shows exactly two actions (`cadastro.archived`, `cadastro.restored`) and must not burn its page budget on `commission.created` rows. One equality filter could not express that. See section 2.4.

## 1. What was verified before designing (facts, not assumptions)

Every claim below was checked against the repository and against the running local Docker test database.

**The existing admin audit router is a cross-tenant reader and must not be reused.**
`apps/api/src/domains/audit/routes.ts` reads via `getAdminDb()`, its header states *"audit_log is cross-tenant append-only"*, and neither of its two handlers applies an `org_id` predicate.
It is mounted in `apps/api/src/server.ts` at `/api/v1/admin/audit` behind `appAuthMiddleware, requireAdmin`.
`requireAdmin` (`apps/api/src/middleware/require-admin.ts`) is a one-line check of `c.get('userRole') === 'admin'`, and `userRole` comes from `getAppRolesFromHubClaims` in `apps/api/src/middleware/app-auth.ts`, which returns full access for `claims.isSuperAdmin`, for Hub **workspace** role `owner`/`admin`, or for a product role `admin`.
A Hub workspace owner is a tenant's own administrator, not a platform superuser.
Exposing that router - or copying its query shape - to a Sales Ops operator hands one tenant's admin every other tenant's audit trail.

**`audit_log` has no RLS at all.** Verified directly:

```
select relrowsecurity, relforcerowsecurity from pg_class where relname='audit_log';
 relrowsecurity | relforcerowsecurity
 f              | f
```

The initial migration says so in prose too (`apps/api/drizzle/0000_fancy_klaw.sql`: *"Tables without tenant RLS: ... audit_log - append-only; admin SELECT; system INSERT"*), and no later migration adds a policy.

**The app role can read every row of it.** Verified:

```
select grantee, privilege_type from information_schema.role_table_grants where table_name='audit_log';
 fxl_sales_test | SELECT   (also INSERT/UPDATE/DELETE)
select rolname, rolsuper, rolbypassrls from pg_roles where rolname in ('postgres','fxl_sales_test');
 postgres       | t | t
 fxl_sales_test | f | f
```

So the ordinary, non-superuser application role sees the whole cross-tenant ledger, and there is no database backstop whatsoever.
**The `WHERE actor_org_id = $orgId` clause in the service layer is the one and only control that enforces isolation for this endpoint.**
That is not a weakness of the design, it is the fact the design has to be built around - and it is also what makes the oracle test in section 6 genuinely able to fail: the tenant connection can see org B's rows, so if the filter is ever dropped the assertion breaks immediately.

**`actor_org_id` is not indexed.** Verified: the only index on `audit_log` is `audit_log_pkey` on `id`.
Any org-filtered read seq-scans an append-only table that only grows. Section 4.4 adds the index.

**`audit_log.id` is a JS `BigInt` and cannot be JSON-serialized.** Verified by probe against the local DB through the real Drizzle schema:

```
drizzle id typeof: bigint 1174
JSON.stringify THROWS: Do not know how to serialize a BigInt
```

`bigserial('id', { mode: 'bigint' })` maps to `BigInt`, so `c.json({ entries: rows })` on raw rows throws.
This is a **pre-existing latent bug in `GET /api/v1/admin/audit`**, which returns `entries: rows` verbatim and therefore 500s.
This slice is forbidden from changing that router, so the bug is recorded in section 8 (Risks) instead of fixed here; the new endpoint projects `String(row.id)` and a test pins it.

**There is no Hub account directory.** `@fxl-business/hub-sdk/server` exports exactly `createHubBff` and `requireHubAuth` - no member or account lookup of any kind (checked `dist/server.d.ts`).
`sales_ops_people` has **no** account-id column (`id, org_id, display_name, contact_email, status`, three deprecated boolean mirrors, timestamps), so a Hub account id has no join path to a pessoa.
The only tables in this database that map a Hub account id to a display name are `finders.account_id` (org-scoped, `UNIQUE`) and `sellers.account_id` (global, cross-org, no `org_id`).
The verified Hub access token does carry top-level `name` and `email` claims - `profileFromToken` in `apps/web/src/auth/react.tsx` reads `claims.name` / `claims.email` off the same payload the API's `auth.claims` exposes - but only for the **caller**, never for a third party.
Section 4.3 turns those facts into the actor-label decision.

**House patterns adopted here.** `salesOpsRouter` handlers read tenancy exclusively as `c.get('orgId')` and never from a body or query; `withTenant` in `apps/api/src/domains/sales-ops/service.ts` opens a transaction and calls `setTenantContext(tx, orgId)`; `listFinderClicks` in `apps/api/src/domains/links/service.ts` is the repo's keyset-pagination idiom (`cursor` in, `nextCursor: string | null` out, conditions array seeded with the mandatory scope predicate on its own first line).

## 2. Design decision

Add **one new authenticated, admin-gated, org-scoped read**:

```
GET /api/v1/sales-ops/history
```

mounted on `salesOpsRouter`, backed by a **new** module `apps/api/src/domains/audit/history-service.ts` whose single exported read takes `orgId` as a required parameter and cannot run without it.

### 2.1 Why this route path and this mount point

- Mounting on `salesOpsRouter` means the route inherits `app.use('/api/v1/sales-ops/*', appAuthMiddleware)` from `server.ts`, so `c.get('orgId')` and `c.get('userId')` are populated by the verified Hub token and there is no second place where auth could be forgotten. Nothing is added to `server.ts`.
- The segment is `history`, deliberately **not** `audit`. `/api/v1/admin/audit` already exists and is cross-tenant; giving the tenant-scoped read a different noun removes the invitation to "just reuse the audit endpoint".
- Rejected: a new top-level router in `server.ts` (needs its own `app.use(..., appAuthMiddleware)` line, one more place to get wrong, no benefit).
- Rejected: adding a tenant mode to `auditRouter` (a router that reads through `getAdminDb()` must never grow a tenant path; one file, two tenancy models, is exactly how a leak ships).

### 2.2 Why `requireAdmin`

The history renders in Configurações, which is `cadastros/geral`, and `getVisibleWorkspaces` shows the `cadastros` workspace only to `admin` (CLAUDE.md, Sales Ops Routing).
An audit trail also names colleagues and their actions, which is not seller- or finder-visible information.
So the route carries `requireAdmin` inline, exactly like `POST /people` and `PATCH /funcoes/:id` do:

```ts
salesOpsRouter.get('/history', requireAdmin, async (c) => { ... });
```

Note that `requireAdmin` is authorization *within* the tenant and contributes nothing to isolation - the `actorOrgId` filter is what does that, and it applies to admins too.

### 2.3 Why the default response is not filtered by action

The endpoint returns **every** `audit_log` row whose `actor_org_id` equals the caller's org, newest first, with optional narrowing by `entityType` and/or `action`.

- If the read hard-coded a list of cadastro actions, slice 01 adding a sixth cadastro action would produce a ledger entry that the history screen silently refuses to show. "The ledger recorded it but the history denies it" is the worst possible failure mode for an audit feature.
- Every returned row is already org-scoped, so a `commission.created` or `payout.mark_paid` row is the caller's own org's activity. Nothing is exposed that the org did not do.
- It removes all coupling to slice 01's enum values. This slice imports nothing from `apps/api/src/domains/audit/service.ts`, so slice 01 can name its actions however it likes and cannot break slice 02, and slice 02 cannot break the write path.
- Frame acceptance criterion 3 is satisfied: the cadastro events are present in the payload; the web slice decides presentation and passes the `action` filter (section 2.4).

`depends_on: [01]` is therefore a **sequencing** dependency (there is no cadastro history to read until slice 01 writes it) plus **one** code dependency: `getHubActorDisplayName`, which slice 01 adds to `apps/api/src/middleware/app-auth.ts`. The executor must still not import `AuditActionSchema`.

### 2.4 Why the `action` / `entityType` filters are bounded strings, and why `action` is a SET

`audit_log.action` and `audit_log.entity_type` are plain `text` columns and already hold pre-Phase-05 values that `AuditActionSchema` does not list.
Validating the filter against the enum would (a) import the file slice 01 edits and (b) make it impossible to filter for values that are genuinely stored.
Both filters are validated as bounded strings and applied as parameterized predicates.
A filter can only ever **narrow**; it is `AND`-ed after the org predicate and can never widen scope. The oracle test pins that.

**`action` accepts a comma-separated set of up to 10 values and applies `inArray`; `entityType` stays a single equality.**

That asymmetry is deliberate and is driven by a real consumer. Slice 04's Configurações panel is titled `Histórico de arquivamentos` and renders exactly two actions, `cadastro.archived` and `cadastro.restored`. With a single-value filter it would have to either fire two requests and merge two independently-paginated keyset streams (which cannot be merged correctly - two cursors, one list), or fetch unfiltered and drop most of the page client-side, which silently turns `limit=50` into "however many of the last 50 org events happened to be archives" and can render an empty panel for an org with a busy commission ledger.

The set is still just data: this slice hard-codes no action name, so section 2.3's argument ("the ledger recorded it but the history denies it") is unchanged - the *client* chooses the set, and a sixth cadastro action is a web-side change, recorded as a risk in section 8.

Validation: `action` splits on `,`, trims each part, rejects empty parts, caps each at 120 characters and the whole set at 10 members, and rejects a set of zero. `entityType` stays one trimmed string of 1..120 characters. Both are parameterized; neither is interpolated.

For the same reason the response type declares `action: string` and `entityType: string`, **not** `AuditAction`. Typing them as the enum would be a lie about what the column can contain.

### 2.5 Why keyset pagination, not `page` / `limit`

`audit_log` is append-only and grows at the head, so `OFFSET` shifts every page whenever a new entry lands mid-paging - the operator sees a row twice or never.
`id` is a `bigserial` and is strictly monotonic in append order, so `WHERE actor_org_id = $1 AND id < $cursor ORDER BY id DESC LIMIT n` is stable, cannot skip or duplicate, and is served end-to-end by the composite index added in 4.4.
It also lets the endpoint drop `count(*)`: the admin route's `total` is a second full scan of a forever-growing table, and the history screen needs "carregar mais", not a page count.

The repo already has this idiom (`listFinderClicks`: `cursor` in, `nextCursor` out), so this is the house pattern, not a new one.
The one deliberate improvement over that precedent: this read fetches `limit + 1` rows and returns `nextCursor` only when the extra row actually exists, instead of inferring "there may be more" from `rows.length === limit`. That removes the phantom "carregar mais" that renders an empty page.

`DEFAULT_LIMIT = 50` and `MAX_LIMIT = 200` are kept identical to the admin route so the codebase has one set of pagination numbers.

Rejected: `page`/`limit` (unstable on an append-only table, and forces the seq-scanning count).
Rejected: a `ts`-based cursor (`ts` is `now()` and can tie across rows written in the same transaction; `id` cannot).

### 2.6 Why the payload omits the jsonb BLOBS, `prev_hash`, `entry_hash` and `request_id` - but carries two scalars extracted from `after_jsonb`

- The screen needs who / what / when, plus a restore target. Restoring is `PATCH /sales-ops/{products|areas|funcoes|people}/:id { status: 'active' }`, which needs only `entityType` and `entityId`.
- The jsonb blobs are unbounded row snapshots that can carry PII (a payout's amounts, a pessoa's e-mail). Shipping them to a list screen that does not read them is gratuitous exposure and would dominate the payload. **The blobs are never selected.**
- `prev_hash` / `entry_hash` are chain-verification data whose only consumer is `verifyChain` on the existing admin route, which this slice does not touch.
- `request_id` is a support-correlation field with no UI.

**The two exceptions, both named scalar extractions, never the blob:**

| field | source | why |
| --- | --- | --- |
| `entityLabel: string \| null` | `after_jsonb ->> 'label'` | The ledger's name snapshot. Slice 04 discloses it as `antes: <nome>` when the cadastro has since been renamed, which is the only thing that keeps the record honest about what was archived. There is no other source: the live row carries only its *current* name. |
| `actorDisplayName` step 1 | `after_jsonb ->> 'actorLabel'` | The actor's name snapshotted at write time by slice 01. See 4.3. |

`->>` returns a scalar `text` and returns `NULL` for a key that is absent or for a non-object `after_jsonb`, so every pre-existing writer (`conversion.recorded`, `commission.*`, `payout.mark_paid`) yields `null` on both without shipping a byte of its blob.
This is what lets section 2.3's "return every action" design coexist with the PII rule: the projection is by name, not by inclusion.

**The executor must not "simplify" this into selecting `afterJsonb` and picking the keys in JS.** That would pull the whole blob across the wire from Postgres into the API process for every payout row on the page, which is exactly the exposure this section forbids.

### 2.7 Why the read runs inside a tenant transaction even though `audit_log` has no RLS

Two reasons, and the executor must not "optimize" the transaction away.

1. The actor-name resolution in 4.3 reads `finders`, which **is** `FORCE ROW LEVEL SECURITY`. Outside a transaction that has called `setTenantContext`, `current_setting('app.current_org_id', true)` is unset and the policy matches nothing - the lookup would silently resolve zero names and nobody would notice.
2. It keeps this read shaped like every other tenant read in the codebase, so the next person to touch it inherits the right habits.

It must be equally clear in the code comment that **for `audit_log` the transaction buys nothing**: there is no policy on that table, so `eq(auditLog.actorOrgId, orgId)` is load-bearing on its own.

## 3. How the org filter is made impossible to forget or bypass

Five independent mechanisms, all of which the executor must implement:

1. **Required parameter, no default, no overload.** `listOrgAuditHistory(db, orgId: string, opts)` - `orgId` is positional and required, `opts` never carries an org, and the module exports exactly one read function. There is no "unscoped" variant to reach for.
2. **Fail closed on a blank org.** The first statement of the function is
   `if (typeof orgId !== 'string' || orgId.trim() === '') throw new Error('org_id_required');`
   A blank org id must never degrade into an unfiltered read. Pinned by an assertion in the oracle test.
3. **The scope predicate is the array literal's first element.** The conditions array is *created* with it:
   `const conditions: SQL[] = [eq(auditLog.actorOrgId, orgId)];`
   Optional filters are `push`ed afterwards. There is no code path that builds a `where` without it, and a diff that removes it is a one-line, obvious deletion rather than a subtle reordering.
4. **The module never touches the admin connection.** `apps/api/src/domains/audit/history-service.ts` must not import `getAdminDb`, and a unit assertion reads the file's own source and fails if the string `getAdminDb` appears in it.
5. **The org can only come from the verified token.** The route reads `c.get('orgId')` and nothing else; the query schema declares no `orgId` / `actorOrgId` / `workspaceId` key, so such a parameter is simply never read. The oracle test smuggles `?orgId=<org B>` and `?actorOrgId=<org B>` and asserts the result is unchanged.

Additionally: `actor_org_id` is nullable, and `NULL` never equals anything, so system-written entries with no org (if any exist) are invisible to every tenant. That is the correct behaviour and the oracle test pins it.

## 4. Exact files and changes

### 4.1 NEW `apps/api/src/domains/audit/history-service.ts`

A new file rather than an addition to `apps/api/src/domains/audit/service.ts`, because slice 01 edits `service.ts` (`AuditActionSchema`) and because the "this module never touches `getAdminDb`" rule is only enforceable per-file - `service.ts` is the write path and the chain algorithm and has different rules.

Public surface:

```ts
export type OrgAuditHistoryEntry = {
  /** audit_log.id as a decimal string. NEVER a BigInt: c.json() cannot serialize one. */
  id: string;
  /** ISO 8601 UTC. */
  ts: string;
  /** Free text from the ledger. NOT AuditAction - the column predates the enum. */
  action: string;
  entityType: string;
  entityId: string;
  /**
   * The entity's name as snapshotted into the ledger at write time
   * (`after_jsonb ->> 'label'`). Null for every writer that does not set it.
   * NEVER the blob - see section 2.6.
   */
  entityLabel: string | null;
  /** Hub account id. DATA, never a label. See resolveActorNames. */
  actorUserId: string;
  /** Resolved display name, or null when no reliable mapping exists. */
  actorDisplayName: string | null;
};

export type ListOrgAuditHistoryOptions = {
  limit?: number;
  /** Exclusive upper bound on audit_log.id, as a decimal string. */
  cursor?: string;
  entityType?: string;
  /** A SET, applied with inArray. See section 2.4 for why this one is plural. */
  actions?: string[];
  /** The caller's own identity, resolved at the route boundary from the verified token. */
  selfActor?: { userId: string; displayName: string | null };
};

export type OrgAuditHistoryPage = {
  entries: OrgAuditHistoryEntry[];
  nextCursor: string | null;
};

export const HISTORY_DEFAULT_LIMIT = 50;
export const HISTORY_MAX_LIMIT = 200;

export async function listOrgAuditHistory(
  db: Db,
  orgId: string,
  opts: ListOrgAuditHistoryOptions = {},
): Promise<OrgAuditHistoryPage>;
```

Implementation, in order:

1. Fail-closed guard on `orgId` (section 3.2).
2. `const limit = Math.min(HISTORY_MAX_LIMIT, Math.max(1, Math.trunc(opts.limit ?? HISTORY_DEFAULT_LIMIT)));` - clamped, never trusted. A non-finite value that reached here would already have been rejected at the route (4.2), but the service clamps anyway so a future caller cannot ask for 100000 rows.
3. Open `db.transaction(async (tx) => { await setTenantContext(tx, orgId); ... })` (import `setTenantContext` from `../../middleware/auth.js`). Comment it exactly as section 2.7 explains: the tenant context is for the `finders` lookup; `audit_log` has no policy and is scoped only by the `WHERE`.
4. Build conditions:
   ```ts
   const conditions: SQL[] = [eq(auditLog.actorOrgId, orgId)];
   if (opts.cursor) conditions.push(lt(auditLog.id, BigInt(opts.cursor)));
   if (opts.entityType) conditions.push(eq(auditLog.entityType, opts.entityType));
   if (opts.actions?.length) conditions.push(inArray(auditLog.action, opts.actions));
   ```
   `opts.cursor` is already validated as `/^\d+$/` at the route; the service converts with `BigInt(...)` because the column maps to `bigint`.
   An empty `actions` array pushes nothing, which means "no action filter" - it must NOT degrade into `inArray(..., [])`, which some drivers render as a false predicate and others as a syntax error. The route rejects an empty set before it gets here; the `?.length` guard is the second line of defence.
5. Select **only** the eight needed fields with an explicit projection object - not `select()` - so the jsonb blobs and the hashes never leave the database:
   ```ts
   .select({
     id: auditLog.id,
     ts: auditLog.ts,
     action: auditLog.action,
     entityType: auditLog.entityType,
     entityId: auditLog.entityId,
     actorUserId: auditLog.actorUserId,
     // Named scalar extractions, never the blob. See section 2.6.
     entityLabel: sql<string | null>`${auditLog.afterJsonb} ->> 'label'`,
     actorLabelSnapshot: sql<string | null>`${auditLog.afterJsonb} ->> 'actorLabel'`,
   })
   ```
   Order `desc(auditLog.id)`, `.limit(limit + 1)`.
6. `const hasMore = rows.length > limit; const page = hasMore ? rows.slice(0, limit) : rows;`
   `nextCursor = hasMore ? String(page[page.length - 1]!.id) : null`.
7. Resolve actor names for `page` (section 4.3) and map each row to `OrgAuditHistoryEntry` with `id: String(row.id)` and `ts: row.ts.toISOString()`. `actorLabelSnapshot` is consumed by the resolution chain and is **not** itself a field of `OrgAuditHistoryEntry` - the response exposes only the resolved `actorDisplayName`, so there is exactly one field the web can render as a person.

### 4.2 MODIFY `apps/api/src/domains/sales-ops/routes.ts`

Add, immediately after the `GET /settings` + `PUT /settings` block at the end of the file (the Configurações neighbourhood), with a short comment stating that this is the tenant-scoped counterpart to the cross-tenant `/api/v1/admin/audit` router and must never be replaced by it:

```ts
const HISTORY_MAX_ACTIONS = 10;

const HistoryQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(HISTORY_MAX_LIMIT).optional(),
  cursor: z.string().regex(/^\d+$/).optional(),
  entityType: z.string().trim().min(1).max(120).optional(),
  /**
   * A comma-separated SET (section 2.4). Every part must be non-empty; a trailing
   * comma or a bare `?action=` is a 400, never a silently-dropped filter.
   */
  action: z
    .string()
    .transform((raw) => raw.split(',').map((part) => part.trim()))
    .refine(
      (parts) =>
        parts.length >= 1 &&
        parts.length <= HISTORY_MAX_ACTIONS &&
        parts.every((part) => part.length >= 1 && part.length <= 120),
      { message: 'action must be 1..10 non-empty values of at most 120 characters' },
    )
    .optional(),
});

salesOpsRouter.get('/history', requireAdmin, async (c) => {
  const parsed = HistoryQuerySchema.safeParse({
    limit: c.req.query('limit'),
    cursor: c.req.query('cursor'),
    entityType: c.req.query('entityType'),
    action: c.req.query('action'),
  });
  if (!parsed.success) {
    return c.json({ error: 'validation_error', issues: parsed.error.flatten() }, 400);
  }
  const { action, ...rest } = parsed.data;
  const page = await listOrgAuditHistory(getDb(), c.get('orgId'), {
    ...rest,
    actions: action,
    selfActor: {
      userId: c.get('userId'),
      displayName: getHubActorDisplayName(c.get('hubAuth')),
    },
  });
  return c.json(page);
});
```

Notes the executor must honour:

- The schema declares **no** org key. A `?orgId=` or `?actorOrgId=` parameter is not read at all - not rejected, simply never consulted. `c.get('orgId')` is the only source.
- A **present but malformed** `limit`, `cursor`, `entityType` or `action` is a `400 validation_error`, not a silent fallback. A silently ignored cursor returns page 1 forever and reads as a UI bug; a silently ignored `action` set returns a panel full of commission rows. Failing loudly is the honest behaviour. An **absent** parameter uses the default.
- `c.req.query()` returns `string | undefined`; `z.coerce.number()` on `undefined` stays `undefined` because of `.optional()` - keep `.optional()` on every key. On the `action` key `.optional()` must come **after** `.transform().refine()`, or an absent parameter is transformed and fails the refine.
- The wire query parameter stays singular (`action=`) because that is what a comma-separated set reads like in a URL; only the service option is plural (`actions`).
- Imports to add: `listOrgAuditHistory`, `HISTORY_MAX_LIMIT` from `../audit/history-service.js`, and `getHubActorDisplayName` from `../../middleware/app-auth.js` (**added by slice 01** - see section 4.5). `requireAdmin`, `getDb` and `z` are already imported in this file.

### 4.3 Actor display name - the decision, and what it must never do

**There is no reliable directory mapping a Hub account id to a person, so the name is snapshotted at write time by slice 01 and merely read here.**

Verified: the Hub SDK server half exposes no member lookup; `sales_ops_people` has no account-id column at all; the verified token carries `name`/`email` only for the caller.
That last fact is why slice 01 writes `after_jsonb.actorLabel` from the caller's own verified token on every cadastro entry - the write is the one moment the name exists. Without it, a second workspace admin's archives could never be attributed, and Frame acceptance criterion 3 would be unmeetable by any amount of work in this slice.

The resolution chain is therefore three steps, and `null` otherwise:

0. **The write-time snapshot.** If `row.actorLabelSnapshot` is a non-empty string, use it. This resolves **every** entry slice 01 wrote, for **any** actor, with no query and no directory. It is deliberately first: it is the only step that is exact for a third party, and a snapshot is what a ledger is supposed to hold.
1. **Self, from the verified token.** If `entry.actorUserId === opts.selfActor.userId`, use `opts.selfActor.displayName`. Covers pre-existing rows written before slice 01.
2. **`finders`, org-scoped.** One batched lookup over the distinct actor ids on the page that steps 0 and 1 did not resolve:
   ```ts
   .select({ accountId: finders.accountId, displayName: finders.displayName })
   .from(finders)
   .where(and(eq(finders.orgId, orgId), inArray(finders.accountId, actorIds)))
   ```
   Skipped entirely when `actorIds` is empty. `finders.account_id` is `UNIQUE`, so this is an index lookup bounded by the page size (<= 200). The explicit `eq(finders.orgId, orgId)` is kept even though the RLS policy also applies - CLAUDE.md requires every tenant query to carry it.
3. Otherwise `actorDisplayName: null`.

**Rejected: `sellers.account_id`.** `sellers` is global with no `org_id` and no RLS ("cross-org (FXL employees)"), and it is the affiliate product's employee roster, unrelated to a Sales Ops workspace. Reading it from a tenant path resolves names from outside the caller's tenancy boundary for near-zero real-world benefit.

**Rejected: matching `sales_ops_people` by name or e-mail.** There is no account-id column, so any match is a guess. In an audit trail, attributing an action to the wrong person is strictly worse than attributing it to nobody.

**Rejected: the API composing a label string.** The API returns `actorUserId` (data) and `actorDisplayName` (nullable name) as two separate fields and never concatenates or falls back to the id. The web slice binds `userLabel({ id: actorUserId, name: actorDisplayName })` from `apps/web/src/lib/displayNames.ts` and, per CLAUDE.md, renders the raw id **only** as muted monospace secondary text beneath an explicit `Autor não identificado` primary label when the name is null - never as the primary label itself (slice 04 section 1.3). Because the API never emits the id *as* the label, a future web change cannot accidentally promote it into one.

**`actorDisplayName` must never be set to `actorUserId` in any branch.** Pinned by oracle assertion 10.

### 4.4 MODIFY `apps/api/src/db/schema.ts` + generated migration

`audit_log` currently has only `audit_log_pkey`. The endpoint's query is
`WHERE actor_org_id = $1 [AND id < $2] ORDER BY id DESC LIMIT n`, which without an index seq-scans a table that only ever grows. Add:

```ts
export const auditLog = pgTable(
  'audit_log',
  {
    /* unchanged columns */
  },
  (t) => [
    // Serves the tenant history read: WHERE actor_org_id = $1 ORDER BY id DESC.
    // Partial, because a NULL-org (system) row is invisible to every tenant read.
    index('audit_log_actor_org_id_id_idx')
      .on(t.actorOrgId, t.id.desc())
      .where(sql`${t.actorOrgId} IS NOT NULL`),
  ],
);
```

`index` and `sql` are already imported in `schema.ts`.

Generate the migration - **do not hand-write it, and never hand-edit `meta/_journal.json` or the snapshot**:

```bash
pnpm --filter @fxl-sales/api exec drizzle-kit generate --name audit_log_org_history_idx
```

Expected output: `apps/api/drizzle/0019_audit_log_org_history_idx.sql` containing a single `CREATE INDEX` statement, plus `meta/0019_snapshot.json` and an appended `meta/_journal.json` entry `{"idx": 19, "version": "7", "when": <ts>, "tag": "0019_audit_log_org_history_idx", "breakpoints": true}`.
Review the generated SQL and confirm it is exactly the partial descending index above and touches nothing else.

**`0019` is the number the tool will pick, and it is correct.** The highest tag on disk is `0018_professional_payable_identity` and the journal's last `idx` is `18`; slice 01 carries no migration (cliente was deferred out of the feature at plan-check), so this is the only migration in the whole feature. If `drizzle-kit` emits anything other than `0019`, stop - something else landed on the branch first and the number must be taken from the tool, never forced.

This migration must **not** carry the `-- fxl-migration-mode: phased` header, which `apps/api/src/db/migration-runner.ts` accepts only for the hard-coded tag `0018_professional_payable_identity`.

**Plain `CREATE INDEX`, not `CONCURRENTLY`.** The phased migration runner in `apps/api/src/db/migration-runner.ts` is hard-pinned to `const phasedTag = '0018_professional_payable_identity'`, so any other migration is executed as an ordinary journaled migration - a `CREATE INDEX CONCURRENTLY` there would fail outright because it cannot run inside a transaction. `audit_log` is a low-volume append-only table, so the brief write lock is acceptable.

Apply it locally against the **local Docker test DB only**:

```bash
TEST_MIGRATE_DATABASE_URL=<local postgres superuser URL from apps/api/.env> \
  pnpm --filter @fxl-sales/api exec tsx src/db/migrate.ts
```

`apps/api/.env`'s `DATABASE_URL` points at **staging**. Never migrate against it. The integration suite's `globalSetup` applies migrations to the local DB automatically, so simply running the integration suite is the safest way to apply this one.

### 4.5 `apps/api/src/middleware/app-auth.ts` - DO NOT EDIT, slice 01 owns it

An earlier draft of this plan added the `MinimalHubAuthContext` widening and the `getHubActorDisplayName` helper here.
That edit **moved to slice 01** at plan-check, because the write path needs the caller's name first (to snapshot `after_jsonb.actorLabel`) and slice 01 lands before this one.

This slice therefore only **imports** it:

```ts
import { getHubActorDisplayName } from '../../middleware/app-auth.js';
```

If the helper is not there when this slice runs, slice 01 was not completed - do not re-add it, and do not write a local copy. Two slices exporting the same symbol from the same file is a merge conflict dressed up as a coincidence.

## 5. Response contract the web will bind to

**This block is the contract slice 04 binds to. It is authoritative; slice 04 has been rewritten against it.**

The request slice 04 actually issues:

```
GET /api/v1/sales-ops/history?limit=50&action=cadastro.archived,cadastro.restored
Authorization: Bearer <hub access token>
```

Full parameter list: `limit` (1..200, default 50), `cursor` (decimal string, exclusive upper bound on `id`), `entityType` (one of `produto` / `pessoa` / `funcao` / `area` for cadastro rows, though the column is free text), `action` (comma-separated set, 1..10 members).

`200`:

```json
{
  "entries": [
    {
      "id": "1174",
      "ts": "2026-08-05T21:04:11.221Z",
      "action": "cadastro.archived",
      "entityType": "produto",
      "entityId": "8f1b0d64-1111-4111-8111-111111111111",
      "entityLabel": "FXL Finance",
      "actorUserId": "usr_2xQ...",
      "actorDisplayName": "Cauet Pinciara"
    }
  ],
  "nextCursor": "1160"
}
```

- `entries` is ordered by `id` descending (**newest first**). The web must not re-sort.
- `nextCursor` is a decimal **string** on every page but the last, and `null` on the last page. It is also the only honest "there is more" signal: slice 04 derives its truncation footer from `nextCursor !== null`, never from `entries.length`.
- `entityLabel` is the ledger's name snapshot (`after_jsonb ->> 'label'`) or `null`.
- `actorDisplayName` is `null` when no reliable mapping exists, and is **never** equal to `actorUserId`.
- `id` and `nextCursor` are decimal **strings**, never numbers - `audit_log.id` is a bigint and would both throw on serialization and lose precision as a JS number.
- The response carries **exactly** these eight entry keys plus `nextCursor`. No `beforeJsonb`, no `afterJsonb`, no `prevHash`, no `entryHash`, no `requestId`, no `actorOrgId`. Pinned by oracle assertion 9.

Errors: `400 { "error": "validation_error", "issues": ... }` for a malformed `limit`/`cursor`/`entityType`/`action`; `401` from `appAuthMiddleware`; `402` when the `sales.core` entitlement is missing; `403 { "error": "forbidden", "reason": "admin_role_required" }` from `requireAdmin`.
There is no `404` (an empty history is `{ "entries": [], "nextCursor": null }`) and no `DELETE` verb anywhere in this slice.

## 6. Named oracle test

### 6.1 `apps/api/test/rls/audit-history-org-scope.test.ts` (the named oracle - proves cross-org isolation)

Runs under `pnpm --filter @fxl-sales/api test:integration`, which is pinned to the local Docker test DB by `apps/api/test/rls/setup-env.ts`.

**Connections - this is the point of the test.**

- `db` (the connection every assertion is made over): `postgres(process.env.TEST_DATABASE_URL, ...)` wrapped in Drizzle. That is the `fxl_sales_test` role: `rolsuper = f`, `rolbypassrls = f`, and it holds `SELECT` on `audit_log`, which has no RLS. **So this connection can see every org's audit rows.** An assertion made here is therefore load-bearing: delete the `eq(auditLog.actorOrgId, orgId)` filter and it fails.
- `seed`: `postgres(process.env.ADMIN_DATABASE_URL, { connection: { 'app.fxl_admin': 'true' } })` - the `postgres` superuser - used **only** to insert and delete fixtures, never to assert isolation. `ADMIN_DATABASE_URL` is `rolsuper + rolbypassrls`, so an admin-side isolation assertion would prove nothing; the test must not make one.

Follow the shape of `apps/api/test/rls/funcoes-rls.test.ts` (unique per-run org ids, `afterAll` cleanup, both clients closed).

**Fixtures**, inserted by `seed` with unique per-run org ids `orgA` / `orgB`:

- `N` `audit_log` rows for `orgA` and 3 for `orgB`, interleaved in insertion order so `id DESC` cannot accidentally segregate them, with distinct `entity_type` strings per org. `N` is whatever the actor and `after_jsonb` fixtures below require (5 as written); **derive every count assertion from the fixture array's own length, never from a hard-coded 3**, so adding a fixture row cannot silently invalidate assertions 1, 2 and 7.
- 1 `audit_log` row with `actor_org_id = NULL`.
- `prev_hash = ''` and `entry_hash = ''` on every seeded row. This is the documented pre-Phase-05 placeholder: `verifyChain` and `/api/v1/admin/audit/verify-chain` both filter on `entryHash.length === 64`, so these rows are outside the hash chain and **cannot perturb the chain assertions in `conversion-ingest.test.ts` / `conversion-webhook-contract.test.ts`**, which share this one database (`fileParallelism: false`). `afterAll` deletes them by `actor_org_id` and by the NULL row's captured id, so the ledger tail is restored.
- Actor ids: `actorSelf` (used on one orgA row), `actorFinderA` (one orgA row; a `finders` row is seeded in `orgA` with `account_id = actorFinderA`), `actorFinderB` (one orgA row, whose `finders` row is seeded in **orgB** - `finders.account_id` is globally `UNIQUE`, so this is how the test proves the name lookup is itself org-scoped), plus `actorStranger` (matching no `finders` row in any org, carrying `after_jsonb.actorLabel`) and arbitrary actors on the orgB rows.
- `after_jsonb` per row, so assertions 10 and 11 have something to extract: the `actorStranger` row gets `{"status":"archived","label":"Marketing","actorLabel":"Terceiro Admin"}`; the `actorSelf` and `actorFinderA`/`actorFinderB` rows get `{"status":"archived","label":"..."}` with **no** `actorLabel`, so the self and `finders` fallbacks are actually exercised; one extra row gets a large object with neither `label` nor `actorLabel`, for the "the blob never crossed the wire" half of assertion 11.
- Two distinct `action` values across the orgA rows, so assertion 5b's set filter can distinguish them.

**Assertions:**

1. *Positive control.* `listOrgAuditHistory(db, orgA)` returns exactly the orgA ids, ordered `id` descending.
2. **Cross-org isolation (the reason this slice exists).** For each of org B's 3 seeded ids, `expect(entryIds).not.toContain(idB)`, and `expect(entries).toHaveLength(orgARows.length)`. Symmetrically, `listOrgAuditHistory(db, orgB)` contains none of org A's ids.
3. **The assertion can actually fail.** Over the *same* `db` connection, a raw `SELECT id FROM audit_log WHERE id IN (<org B's 3 ids>)` returns 3 rows. This proves the database is not doing the scoping and that removing the service's `WHERE` would leak immediately - without it, assertion 2 could be passing for the wrong reason.
4. *NULL org.* The `actor_org_id IS NULL` row appears in neither org's result.
5. *A filter cannot widen scope.* `listOrgAuditHistory(db, orgA, { entityType: <org B's entity_type> })` returns `{ entries: [], nextCursor: null }`; same for `{ actions: [<org B's action>] }` and for `{ actions: [<org A's action>, <org B's action>] }` - the multi-value filter narrows within org A and still cannot reach org B.
5b. *The action SET matches more than one value.* Seed org A rows with two distinct actions; `{ actions: [a1, a2] }` returns both, `{ actions: [a1] }` returns only the first, and `{ actions: [] }` behaves as no filter at all (all 3 rows) rather than throwing or returning nothing.
6. *Fail closed.* `await expect(listOrgAuditHistory(db, '')).rejects.toThrow('org_id_required')` and the same for `'   '`.
7. *Keyset paging is stable and stays scoped.* `{ limit: 2 }` returns the 2 newest orgA rows and a non-null `nextCursor`; walking the cursor to exhaustion yields the remaining rows and a final `nextCursor: null`; the union of the pages equals the orgA ids with no repeat; and no page contains an orgB id. Also assert that the LAST page's `nextCursor` is `null` **even when it is exactly full** - that is the whole point of fetching `limit + 1`, and it is what slice 04's truncation footer depends on.
8. *Serialization.* `typeof entries[0].id === 'string'`, `typeof result.nextCursor` is `'string' | 'object'` (never `bigint`), and `expect(() => JSON.stringify(result)).not.toThrow()` - the BigInt hazard verified in section 1.
9. *Payload is minimal.* `Object.keys(entries[0]).sort()` equals exactly `['action','actorDisplayName','actorUserId','entityId','entityLabel','entityType','id','ts']`. No `beforeJsonb`, `afterJsonb`, `prevHash`, `entryHash`, `requestId`, `actorOrgId`, and **no `actorLabelSnapshot`** - the snapshot is an implementation detail of the resolution chain and must not leak as a second name field.
10. *Actor names, all four branches.* With `selfActor: { userId: actorSelf, displayName: 'Cauet Pinciara' }`:
    - a row seeded with `after_jsonb = {"label":"Marketing","actorLabel":"Terceiro Admin"}` and an actor id matching **nobody** resolves to `'Terceiro Admin'` - the write-time snapshot wins and is the only branch that can name a third party;
    - a row whose `after_jsonb` has **no** `actorLabel` and whose actor is `actorSelf` resolves to `'Cauet Pinciara'`;
    - the `actorFinderA` row (no snapshot) resolves to the seeded orgA finder's `display_name`;
    - the `actorFinderB` row resolves to `null` **even though a `finders` row with that exact `account_id` exists in orgB** - the name lookup is org-scoped too;
    - and in every case `actorDisplayName !== actorUserId`.
11. *`entityLabel` is extracted, and the blob is not.* A row seeded with `after_jsonb = {"status":"archived","label":"Marketing","actorLabel":"X"}` yields `entityLabel === 'Marketing'`. A row seeded with a `after_jsonb` that is a large object **without** a `label` key yields `entityLabel === null`, and `JSON.stringify(result)` contains none of that object's other keys - proof the projection is by name and the blob never crossed the wire.

### 6.2 `apps/api/src/domains/sales-ops/__tests__/history-route.test.ts` (route contract, runs in `pnpm test`)

Mirrors the mocking harness of `apps/api/src/domains/sales-ops/__tests__/routes.test.ts`: `vi.mock('../../audit/history-service.js', ...)` over a `vi.hoisted` spy, a test Hono app that sets `userId` / `orgId` / `userRole` / `userRoles` in a middleware, and `app.route('/', salesOpsRouter)`.

1. A `seller` role gets `403 { error: 'forbidden', reason: 'admin_role_required' }` and the service spy is never called.
2. An `admin` gets `200` and the spy is called with `orgId === 'verified-org'` - the value set by the fake auth middleware.
3. **`GET /history?orgId=other-org&actorOrgId=other-org` still calls the service with `'verified-org'`**, and neither string appears anywhere in the spy's arguments.
4. `?limit=abc`, `?limit=0`, `?limit=201`, `?cursor=abc`, `?cursor=-1` each return `400 validation_error` and never call the service.
5. `?limit=200` is accepted; the absent-`limit` case calls the service with `limit: undefined` (the service owns the default).
6. `?entityType=` (empty) and a 121-character `entityType` are `400`; a valid one is forwarded verbatim.
6b. **The `action` set.** `?action=cadastro.archived,cadastro.restored` calls the service with `actions: ['cadastro.archived','cadastro.restored']` - this is the exact request slice 04 issues, so this assertion is the contract between the two slices. `?action=cadastro.archived` yields a one-member array. `?action=a,,b`, `?action=a,`, `?action=` and an 11-member set each return `400` and never call the service. An absent `action` calls the service with `actions: undefined`.
7. `selfActor.userId` is the context `userId`, and `selfActor.displayName` is `null` when the token carries no `name`/`email`.
8. **Source guard:** `readFileSync` of `apps/api/src/domains/audit/history-service.ts` does not match `/getAdminDb/`. The org-scoped history read must never reach for the cross-tenant connection.

## 7. How to run

```bash
# from the repo root
pnpm run lint
pnpm run type-check
pnpm test                                        # includes 6.2
pnpm --filter @fxl-sales/api test:integration    # includes 6.1 (the named oracle)
pnpm run build
```

The integration suite's `globalSetup` migrates the **local Docker** test DB before any test connects, which is how migration 0019 gets applied locally. Confirm the DB container is up first:

```bash
docker ps --format '{{.Names}} {{.Ports}}' | grep fxl-sales-db   # expect 0.0.0.0:5006->5432/tcp
```

To run only the oracle:

```bash
pnpm --filter @fxl-sales/api exec vitest run test/rls/audit-history-org-scope.test.ts
# with VITEST_INTEGRATION=1 in the environment
```

Never point any of this at `apps/api/.env`'s `DATABASE_URL` - it is **staging**.

## 8. Risks

- **`audit_log` has no RLS, so there is no database backstop.** A future refactor that drops the `eq(auditLog.actorOrgId, orgId)` predicate leaks every tenant's ledger with no error and no policy violation. Mitigated by the five mechanisms in section 3 and by oracle assertions 2 and 3 (assertion 3 exists precisely so assertion 2 cannot pass for the wrong reason). Adding real RLS to `audit_log` would be a stronger control but is out of scope: the table is deliberately cross-tenant append-only and `writeAuditEntry` writes to it from admin and system contexts that no tenant policy would admit.
- **Pre-existing, and deliberately NOT fixed here: `GET /api/v1/admin/audit` 500s.** It returns raw rows whose `id` is a `BigInt`, which `JSON.stringify` cannot serialize (verified in section 1). That router is cross-tenant and out of this feature's blast radius; touching it would mean this slice modified a `getAdminDb()` reader, which is precisely the boundary the Frame's "security trap" section draws. The bug is therefore left exactly as it is, and **whoever runs the capture step MUST log it in `nexo/ROADMAP.md`** - this is a required capture-step action, not a suggestion. The new endpoint is immune (it projects `String(row.id)`, pinned by oracle assertion 8).
- **The actor name is `null` for pre-existing rows.** Slice 01 now snapshots `after_jsonb.actorLabel` on every cadastro entry, so every row this feature writes resolves for **any** actor, including a second workspace admin. Rows written **before** slice 01 (conversions, commissions, payouts) have no snapshot and fall back to self-or-`finders`-or-`null`. Slice 04's panel filters to the two cadastro actions, so in practice it never renders an unresolved row. What this slice guarantees regardless is that a raw account id is never emitted as a label.
- **The web chooses the action set, so a fifth cadastro action would be invisible.** Section 2.3's guarantee ("the ledger recorded it but the history denies it" must not happen) is now only true for the actions slice 04 asks for. If slice 01's `CADASTRO_LIFECYCLE_ACTIONS` ever grows a third member, `apps/web/src/sales-ops/cadastro-history.ts` must grow it too on the same commit. Record it beside the enum in both files.
- **Shared integration database.** The oracle inserts into the globally shared `audit_log`. Seeding with `entry_hash = ''` keeps the rows outside the hash chain (both `verifyChain` call paths filter on `entryHash.length === 64`), and `afterAll` deletes them, so the ledger tail is restored for the conversion tests that share the DB under `fileParallelism: false`. The executor must not seed 64-character fake hashes - that would put invalid links inside the verified chain and break `/verify-chain` for everyone.
- **Index build lock.** Migration 0019 takes a brief `SHARE` lock on `audit_log` while the index builds; writes to the ledger block for its duration. The table is low-volume and append-only, and `CONCURRENTLY` is not available because the phased runner is hard-pinned to tag `0018` (section 4.4).
- **`z.coerce.number()` on query strings.** `''` coerces to `0` and would fail `.min(1)` with a `400`, which is the intended behaviour; `undefined` stays `undefined` only because every key keeps `.optional()`. Dropping `.optional()` from any key would turn an absent parameter into a `400`. Pinned by route test 5.
- **`MinimalHubAuthContext` is widened by slice 01, in a security-critical shared middleware file.** Not this slice's edit any more (section 4.5), but this slice's route depends on it, so it is worth restating: the change is strictly additive (two optional claims plus one new pure export) and alters no existing signature or behaviour, and `apps/api/src/middleware/__tests__/app-auth.test.ts` must stay green unmodified.
- **`->>` returns `text`, so a non-string `label` would arrive stringified.** Slice 01 only ever writes strings (or `null`) into `label` and `actorLabel`, so this is inert today. If a future writer put a number or object there, `entityLabel` would silently become `"42"` or `"{...}"` rather than failing. Not worth guarding for now; noted so it is not a surprise.
