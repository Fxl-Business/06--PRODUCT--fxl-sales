# Frame - safe delete, history and restore for the cadastros

Milestone: v2.4.0
Trunk: `master` (promotion mode: master -> staging -> production)
Mode: `--auto` (Gate 1 skipped by explicit user flag; Gate 3 is NOT covered by it)

## What was asked

> add an option to delete entities, like products, persons, roles and so on, but in a secure way,
> so that in the configs we have a history about who did what, and able to revert some deletions

Three things: a delete affordance across the cadastros, an audit history surfaced in Configurações,
and the ability to undo a deletion.

## What the codebase already gives us, verified not assumed

- **Soft delete already exists and is the law.** `status: 'active' | 'archived'` is on produtos,
  áreas and funções; pessoas carry `'active' | 'inactive'`.

  > **CORRECTION, made during plan-check.** An earlier draft of this Frame also listed **clientes**.
  > That is wrong: `sales_ops_clients` has **no `status` column** at all. Two planners caught it
  > independently and it was confirmed against `apps/api/src/db/schema.ts` and the 0018 snapshot.
  >
  > **RESOLUTION, made during plan-check.** Cliente is **deferred out of this feature entirely.**
  > An earlier version of slice 01 planned to add the column plus its zod key and service plumbing.
  > That was struck: slices 03 and 04 had each independently and correctly declined to build any
  > cliente affordance, so slice 01's half would have shipped an irreversible migration behind a code
  > path with no caller anywhere in the product. The user asked for "products, persons, roles and so
  > on" and did not name clientes. See "Deferred: archiving a cliente" at the foot of this file for
  > exactly what a future slice must do.
  >
  > Consequence: **slice 01 carries no migration at all.** The only migration in this feature is
  > slice 02's `audit_log` index, which takes `0019` (highest tag on disk is `0018`, journal `idx: 18`).

  CLAUDE.md states it outright:
  *"A função is never deleted, only archived via `status`, exactly like an área. `salesOpsRouter` has
  no DELETE verb."* Confirmed by inspection: there is no DELETE verb on any of the 24 sales-ops routes.
  So "delete" here means **archive**, and the feature is mostly about EXPOSING and REVERSING it, not
  about adding destruction.
- **A hash-chained audit ledger already exists.** `apps/api/src/domains/audit/service.ts` implements
  an append-only `audit_log` where `entry_hash = sha256(prev_hash || canonical_json(row))`, with
  `writeAuditEntry` (which takes `FOR UPDATE` on the tail row to serialize writers) and a
  `verifyChain` endpoint. This is the "who did what" backbone and must be reused, not reinvented.
- **Sales-ops writes nothing to it today.** `grep -c writeAuditEntry` in the sales-ops service is
  **0**. Only conversions, commissions, payouts and admin/apps write entries. So the ledger exists
  and the cadastros are simply absent from it.
- **`AuditActionSchema` is a closed enum** of five Phase-05 actions
  (`conversion.recorded`, `commission.created`, `commission.approve`, `commission.reverse`,
  `payout.mark_paid`). Cadastro actions have to be added to it.
- **Configurações is `cadastros/geral`**, rendered by `SettingsView` in
  `apps/web/src/sales-ops/SalesOpsApp.tsx`. That is where the history belongs.

## The security trap this feature must not fall into

`apps/api/src/domains/audit/routes.ts` reads through `getAdminDb()` and its own header says
*"audit_log is cross-tenant append-only"*. It applies **no `org_id` filter at all**, and is mounted
at `/api/v1/admin/audit` behind `requireAdmin`.

`requireAdmin` is the in-app admin role, which in this product is synthesized from a Hub **workspace**
owner/admin flag - it is emphatically not a platform superuser. Exposing that router, or its query
shape, to a Sales Ops operator would hand one tenant's admin the audit trail of every other tenant.

The history read for this feature MUST therefore be a new, org-scoped read filtered by
`actorOrgId = c.get('orgId')`. Reusing `/admin/audit` is a data breach, not a shortcut.

## Acceptance criteria (feature level)

1. Every **status-bearing** cadastro (produto, pessoa, função, área) can be archived from the UI,
   behind a confirmation that names what is being archived and what it affects.
   *Amended at plan-check: cliente is deferred, see the correction above and the note at the foot.*
2. Archiving and restoring both append a hash-chained `audit_log` entry recording actor, org, entity,
   action and timestamp, inside the same transaction as the write.
3. Configurações shows a history of those events, scoped to the caller's org, naming the actor as a
   person rather than a raw Hub account id.
4. An archived cadastro can be restored from that history, and the restore is a NEW ledger entry -
   the chain is append-only and is never rewritten to "undo" the archive.
5. `verifyChain` still reports the ledger valid after archive and restore traffic.

## Scope limits (YAGNI)

- **No hard DELETE, and no DELETE verb.** CLAUDE.md forbids it and the referential integrity of
  propostas depends on it: an archived produto still permanently occupies its `code_suffix` slot, and
  archived funções stay visible on the people who already carry them.
- No restore of a proposta, receivable or payable. Those have their own lifecycle
  (`transition` / `cancel-contract`) and are out of scope.
- No retention policy, export, or purge of the ledger.
- No change to the five existing Phase-05 audit actions or to the chain algorithm.
- The system funções `vendedor` and `finder` remain unarchivable - the API already answers
  `409 funcao_is_system` and the UI exposes no edit affordance for them at all.

## Must not break

- `salesOpsRouter` still has no DELETE verb.
- Tenant isolation: every new query filters by `orgId`; the new history read must be proven not to
  leak across orgs over a non-superuser connection (note `ADMIN_DATABASE_URL` is the `postgres`
  superuser and BYPASSRLS, so an admin-side assertion proves nothing - the tenant side carries it).
- Never render a raw account or workspace id in user-facing UI; use `userLabel` / `orgLabel`.
- The existing audit chain: `verifyChain` must stay green, and pre-Phase-05 rows with `entry_hash=''`
  must keep being treated as "no chain yet".
- Archived rows stay visible on records that already reference them and disappear only from pickers.

## Deferred: archiving a cliente (ROADMAP-ready)

Decided at plan-check. **Do not implement any part of this inside the current feature** - it is recorded
here so the deferral is a decision with a price tag rather than an omission.

**Why it is out.** `sales_ops_clients` has no `status` column (`apps/api/src/db/schema.ts` lines
683-699, confirmed against `apps/api/drizzle/meta/0018_snapshot.json`), `ClientSchema` declares no
`status` key, and `SalesOpsClient` in `apps/web/src/sales-ops/types.ts` carries none. Because zod strips
unknown keys, a `PATCH /clients/:id {"status":"archived"}` today returns **200 with an unchanged row** -
a silent no-op that reads as success. Two planners hit that independently and both declined to ship a
control for it. Adding only the API half would have meant an irreversible migration plus zod plus
service plumbing with no caller in the product.

**What a future slice must do, in this order.** Every item was verified against the code at plan-check.

1. `apps/api/src/db/schema.ts` - add `status: text('status').notNull().default('active')` to
   `salesOpsClients`, after `legalRepDocument`. Deliberately **no** CHECK constraint: `salesOpsAreas`,
   `salesOpsFuncoes`, `salesOpsProducts` and `salesOpsPeople` all leave `status` unconstrained at the
   database level, and a lone constraint here would give this one table a different failure mode.
2. Generate the migration, never hand-write it and never hand-edit `meta/_journal.json`:
   `pnpm --filter @fxl-sales/api exec drizzle-kit generate --name cadastro_client_status`.
   It must emit exactly `ALTER TABLE "sales_ops_clients" ADD COLUMN "status" text DEFAULT 'active' NOT NULL;`
   `NOT NULL DEFAULT 'active'` backfills every existing row as active in one statement, so there is no
   separate backfill pass. It must **not** carry the `-- fxl-migration-mode: phased` header, which
   `apps/api/src/db/migration-runner.ts` accepts only for the hard-coded tag `0018_professional_payable_identity`.
   Never migrate against `apps/api/.env`'s bare `DATABASE_URL` - it points at **staging**.
3. `apps/api/src/domains/sales-ops/service.ts` - add
   `status: z.enum(['active','archived']).default('active')` to `ClientSchema`, matching `AreaSchema`
   character for character; have `createClient` write it; give `updateClient` a `current` select with
   `.for('update')` as its first statement, a `return null` when absent, and a **conditional** spread
   `...(data.status !== undefined ? { status: data.status } : {})` in its `.set({...})` patch - matching
   how `name` is treated, not the unconditional `clearableText` treatment the optional text fields get.
   The route's `ClientSchema.partial()` makes an omitted key parse to `undefined`, which is what keeps an
   ordinary cliente edit from writing a ledger entry.
4. Audit it exactly as the other four are audited: add `'cliente'` to `CadastroEntityTypeSchema` in
   `apps/api/src/domains/audit/service.ts`, give `updateClient` the `actor: CadastroActor` parameter and
   the trailing `auditCadastroLifecycle` call (last statement in the `withTenant` transaction, `tx` and
   never `db`), and thread the actor from `c.get('userId')` plus `getHubActorDisplayName(c.get('hubAuth'))`
   in the `PATCH /clients/:id` handler. Extend the rollback oracle in
   `apps/api/test/rls/cadastro-archive-audit.test.ts`, and replace its assertion 5b - which currently
   pins that a cliente write produces **no** ledger row - with the positive case.
   `apps/api/test/rls/client-legal-fields.test.ts` will need the new `updateClient` signature.
5. Web: add `status` to `SalesOpsClient` in `apps/web/src/sales-ops/types.ts`; add `'clients'` to
   `CadastroResource` and `'cliente'` to `CadastroKind` in the slice-03 surface, plus one row to the
   `cadastroArchive` copy table and the three-line archive/restore block to `ClientsView`; add
   `'cliente'` to `HistoryEntityKind` and its `Cliente` kind label in
   `apps/web/src/sales-ops/cadastro-history.ts`, and flip that module's `restoreStateFor` cliente test
   from `{ state: 'none' }` to the available case.
6. Give the proposta wizard's **client picker** the `selectableProducts` treatment - active clientes plus
   the one the stored proposta already references, labelled `(arquivado)` - or the confirmation copy
   promising that an archived cliente leaves the pickers will be false.

**Note for whoever picks it up:** `getSalesOpsSnapshot` selects `*`, so `bootstrap.clients[].status`
appears on the wire the moment step 1 lands, before the web type declares it. That is additive and
harmless, but the web type must be updated before any picker can filter on it.
