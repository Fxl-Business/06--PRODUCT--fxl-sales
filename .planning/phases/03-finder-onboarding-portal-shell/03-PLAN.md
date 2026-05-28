# Phase 03 — Finder onboarding + portal shell

**Milestone:** v1.0 — FXL Finders MVP
**Status:** ⏳ pending
**Wave:** W2 (parallel with Phase 02; both depend on Phase 01)
**Mode:** full-stack UI-heavy — `/gsd-ui-phase` IS REQUIRED

---

## PREREQUISITE — Run `/gsd-ui-phase` before T01

This phase contains significant UI surface area across two apps:
- `apps/site`: public signup form (`/signup`) + legal pages + landing copy refresh
- `apps/web`: admin approval queue + finder portal shell + seller portal shell

**Executor: invoke `/gsd-ui-phase 03` before starting T01.** The UI phase produces
component sketches and design tokens that T01–T07 consume. Do not skip.

---

## Scope

Deliver all user-facing entry points and authenticated shells for every role in v1.0.
After this phase:
- A prospective finder can sign up publicly at `/signup` on apps/site
- An admin can review pending finders, approve (triggering Clerk invitation), or suspend
- An approved finder can log in to apps/web and see the finder portal shell (links / commissions / payouts placeholders)
- A seller can log in to apps/web and see `/seller/deals` (placeholder)
- Role routing (`admin` / `finder` / `seller`) is fully wired via Clerk `publicMetadata.role`
- apps/site landing page copy describes FXL Finders (not the template placeholder)
- LGPD consent is captured at signup (granular checkboxes, version-stamped, stored on `finders` row)

---

## Context sources (read before executing any task)

1. `.planning/plan-brief.md` — cascading decisions + stack conventions (READ FIRST)
2. `docs/superpowers/specs/2026-05-28-fxl-finders-v1-design.md` — canonical spec (§ 3 system boundaries, § 4 data model finders/sellers, § 7 phase plan)
3. `.planning/ROADMAP.md` — phase list and wave dependencies
4. `CLAUDE.md` — FXL contract (non-negotiable rules)
5. `.planning/phases/01-schema-foundation-clerk-auth-rls/01-PLAN.md` — Phase 01 schema decisions (finders table, sellers table, auth middleware exports)

---

## Autopilot decisions (logged inline per `/nexo:autopilot` rule)

| # | Decision | Choice | Reason |
|---|---|---|---|
| A1 | i18n in apps/site | Inline JSON translation object + `getTranslations()` helper (no `next-intl` package) | `next-intl` adds a package + provider overhead. apps/site is Next.js 15 App Router with server components; a thin local `src/i18n/pt-BR.json` + `getTranslations()` utility (typed, ~15 LOC) has the smallest footprint and zero new dependencies. PT-BR only in apps/site (the spec's "EN secondary" applies to apps/web; the site's public-facing pages are PT-BR only in v1.0). |
| A2 | LGPD consent columns | Add `lgpd_consent_essential boolean NOT NULL DEFAULT false`, `lgpd_consent_marketing boolean NOT NULL DEFAULT false`, `lgpd_consent_version text NOT NULL DEFAULT ''`, `lgpd_consented_at timestamptz` to `finders` table via a Phase 03 migration | Phase 01 spec did not include LGPD columns. Rather than re-opening Phase 01, Phase 03 ships a separate Drizzle migration adding these 4 columns with sensible defaults. Logged as a Phase 01 follow-up gap in the failure list. |
| A3 | Signup POST route — no Clerk auth | `POST /api/v1/finders/signup` is in `apps/api/src/domains/finders/public-routes.ts`, mounted UNAUTHENTICATED in `apps/api/src/server.ts` (D-R: server.ts, NOT index.ts). The route Zod-validates the body, inserts a `finders` row with `status='pending'`, `org_id=''` (empty string placeholder — Clerk org doesn't exist yet), and returns `{ id, status }`. Uses `getDb()` (D-H). | Finder has no Clerk account at signup time — no JWT is available. `org_id` will be backfilled to the real Clerk `clerk_org_id` when admin approves and Clerk org is created. Empty string is safe: RLS on `finders` uses `current_setting('app.current_org_id')` which is only set for authenticated requests; the public insert route does not call `setTenantContext`. |
| A4 | Honeypot field name | `<input type="text" name="website" tabIndex={-1} aria-hidden="true" />` (hidden via CSS, not `display:none`). **D-R supersedes the validator detail:** the Zod validator declares `website: z.string().optional()` (it MUST accept any string); the honeypot DECISION is made in the route handler — a non-empty `website` returns a silent 201 with NO DB insert (bot must not learn it tripped the trap). Never `z.string().max(0)`. | Simple, dependency-free, industry-standard pattern. No Turnstile in v1.0 per spec § out-of-scope. |
| A5 | Clerk invitation flow | Backend calls `clerkClient.invitations.createInvitation({ emailAddress, publicMetadata: { role: 'finder' } })`. The `clerkClient` singleton is imported from `apps/api/src/lib/clerk.ts` (Phase 01, D-I) — NOT from `@clerk/backend` directly. Finder receives Clerk-hosted email, clicks link, completes their Clerk account, lands on apps/web at `/finder/dashboard`. | Standard Clerk invite flow per spec constraint. Clerk org is created BEFORE the invitation is sent (admin approve handler creates the org, then invites). |
| A6 | Seller invitation flow | Same pattern as A5 but `role: 'seller'`. Admin creates `sellers` row first, then calls `clerkClient.invitations.createInvitation`. No Clerk org for sellers (cross-org entity). | Sellers do not need an org; only a Clerk user account with `publicMetadata.role='seller'`. |
| A7 | Role routing in apps/web | Single router with `RoleGuard` component that reads `user.publicMetadata.role` from `useUser()`. Renders the appropriate shell (`AdminShell`, `FinderShell`, `SellerShell`) or redirects to an error page. The three shells share the same `AppShell` frame (Sidebar + TopBar already exist in template). | Cleanest extension of the existing `router.tsx` pattern without rewriting the router wholesale. |
| A8 | Clerk org creation on approve | Admin approve handler calls `clerkClient.organizations.createOrganization({ name: finder.displayName, createdBy: adminUserId })` then updates `finders` row: `clerk_org_id = org.id`, `status = 'approved'`, `approved_at = now()`, `approved_by_user_id = adminUserId`. Then sends invitation. | Each finder = one Clerk org (plan-brief Wave 0 locked decision). The org must exist before the invitation so the invite can carry `org_id` in metadata. |

---

## Phase 01 follow-up gaps (logged, not blocking Phase 03)

- **LGPD columns on `finders`**: Phase 01 `finders` schema (T02 in 01-PLAN.md) does not include LGPD consent columns. Phase 03 adds them via a separate migration (T01 below). Coordinate: if Phase 01 has not yet been executed when Phase 03 starts, the Phase 01 executor should add these 4 columns to T02 instead of running a separate migration.
- **`finders.org_id` initial value**: Phase 01 schema defines `org_id text NOT NULL`. At public signup time (before approval), the finder has no Clerk org. Phase 03 inserts `org_id = ''` (empty string) as a placeholder. This is a constraint gap in Phase 01's design — the column should either be nullable or have a sentinel value convention. Logged here; Phase 01 can be updated to document this convention without code change.

---

## Tasks

---

### T01 · Migration — LGPD consent columns on `finders`

**App:** `apps/api`
**File(s):** New Drizzle migration in `apps/api/drizzle/` + update `apps/api/src/db/schema.ts`

**What:** Add 4 LGPD consent columns to the `finders` table. If Phase 01 has already been executed and the table exists in the DB, this ships as a separate `ALTER TABLE` migration. If Phase 01 has not yet executed, add the columns directly to Phase 01's T02 schema definition instead (no separate migration needed).

**Schema additions to `finders`:**
```typescript
lgpdConsentEssential: boolean('lgpd_consent_essential').notNull().default(false),
lgpdConsentMarketing: boolean('lgpd_consent_marketing').notNull().default(false),
lgpdConsentVersion: text('lgpd_consent_version').notNull().default(''),
lgpdConsentedAt: timestamp('lgpd_consented_at', { withTimezone: true }),
```

**Autopilot decision A2 applies.**

**Migration SQL (if Phase 01 already executed):**
```sql
ALTER TABLE finders
  ADD COLUMN lgpd_consent_essential boolean NOT NULL DEFAULT false,
  ADD COLUMN lgpd_consent_marketing boolean NOT NULL DEFAULT false,
  ADD COLUMN lgpd_consent_version text NOT NULL DEFAULT '',
  ADD COLUMN lgpd_consented_at timestamptz;
```

**Acceptance criteria:**
- [ ] All 4 LGPD columns present in `schema.ts` `finders` table definition
- [ ] Migration file (or updated Phase 01 schema) reflects the columns
- [ ] `pnpm --filter @fxl-finders/api type-check` passes
- [ ] `lgpd_consent_version` defaults to `''` (empty string, not NULL — version-stamped means always set)

---

### T02 · API — public signup route (`POST /api/v1/finders/signup`)

**App:** `apps/api`
**File(s):**
- `apps/api/src/domains/finders/public-routes.ts` (new)
- `apps/api/src/domains/finders/signup-schema.ts` (new)
- `apps/api/src/server.ts` (mount public router WITHOUT `clerkAuthMiddleware` — **D-R: server.ts, NOT index.ts**)

**What:** Create a public (no-auth) Hono route that accepts a finder signup, validates with Zod, and inserts a `finders` row with `status='pending'`.

**Decision D-R (honeypot) applies:** the honeypot field `website` is `z.string().optional()` in the Zod validator (it MUST validate, never reject) — the honeypot *decision* is made in the handler: a non-empty `website` returns a silent `201` with NO DB insert. Do NOT use `z.string().max(0)` (that would surface a validation error and tell a bot it tripped the trap).

**Decision D-H (DB access) applies:** import `getDb` from `../../db/client.js` and call `const db = getDb()` inside the handler. There is NO `db` singleton and NO `db/index.js`.

**Zod schema (`signup-schema.ts`):**
```typescript
import { z } from 'zod';

export const PIX_KEY_TYPES = ['cpf', 'email', 'phone', 'random'] as const;

export const finderSignupSchema = z.object({
  displayName: z.string().min(2).max(100),
  contactEmail: z.string().email(),
  cpf: z.string().regex(/^\d{11}$/, 'CPF deve ter 11 dígitos').optional(),
  phone: z.string().min(10).max(20).optional(),
  pixKey: z.string().min(1).max(100).optional(),
  pixKeyType: z.enum(PIX_KEY_TYPES).optional(),
  payoutAddress: z.object({
    street: z.string().optional(),
    city: z.string().optional(),
    state: z.string().length(2).optional(),
    zip: z.string().regex(/^\d{8}$/).optional(),
  }).optional(),
  lgpdConsentEssential: z.literal(true, {
    errorMap: () => ({ message: 'Consentimento essencial é obrigatório' }),
  }),
  lgpdConsentMarketing: z.boolean(),
  lgpdConsentVersion: z.string().min(1),
  // Honeypot (D-R) — validator MUST accept any string; the decision is in the handler.
  // Never z.string().max(0) — that returns 400 and tells a bot it tripped the trap.
  website: z.string().optional(),
});

export type FinderSignupInput = z.infer<typeof finderSignupSchema>;
```

**Route handler (`public-routes.ts`):**
```typescript
import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { getDb } from '../../db/client.js';   // D-H — lazy getDb(), no db singleton, no db/index.js
import { finders } from '../../db/schema.js';
import { finderSignupSchema } from './signup-schema.js';

export const findersPublicRouter = new Hono();

findersPublicRouter.post(
  '/signup',
  zValidator('json', finderSignupSchema),
  async (c) => {
    const body = c.req.valid('json');

    // Honeypot decision (D-R) — non-empty website => silent 201, NO insert.
    // The validator already accepts any string; the trap is decided HERE, not in Zod.
    if (body.website && body.website.length > 0) {
      // Silent success — bot must not learn it was rejected; no DB row created.
      return c.json({ id: crypto.randomUUID(), status: 'pending' }, 201);
    }

    const db = getDb();   // D-H — lazy connection inside handler
    const [finder] = await db
      .insert(finders)
      .values({
        orgId: '',              // placeholder until admin approves + Clerk org created (A3)
        clerkUserId: '',        // placeholder until Clerk invite accepted
        clerkOrgId: '',         // placeholder until Clerk org created
        status: 'pending',
        displayName: body.displayName,
        contactEmail: body.contactEmail,
        cpf: body.cpf,
        phone: body.phone,
        pixKey: body.pixKey,
        pixKeyType: body.pixKeyType,
        payoutAddress: body.payoutAddress ?? null,
        lgpdConsentEssential: body.lgpdConsentEssential,
        lgpdConsentMarketing: body.lgpdConsentMarketing,
        lgpdConsentVersion: body.lgpdConsentVersion,
        lgpdConsentedAt: new Date(),
      })
      .returning({ id: finders.id, status: finders.status });

    return c.json({ id: finder.id, status: finder.status }, 201);
  },
);
```

**Mount in `apps/api/src/server.ts`** (D-R — server.ts is where the Hono app is composed, NOT index.ts). Mount `findersPublicRouter` UNAUTHENTICATED, and create the admin group guarded by `clerkAuthMiddleware` (Phase 01, D-B) + `requireAdmin` (T03 owns this guard):
```typescript
import { clerkAuthMiddleware } from './middleware/auth.js';   // D-B — Phase 01 export (alias: authMiddleware)
import { requireAdmin } from './middleware/require-admin.js';  // T03 owns this single guard (D-B)
import { findersPublicRouter } from './domains/finders/public-routes.js';
import { findersAdminRouter } from './domains/finders/admin-routes.js';   // T03
import { sellersAdminRouter } from './domains/sellers/admin-routes.js';   // T04

// Public — NO auth middleware (finder has no Clerk account at signup)
app.route('/api/v1/finders', findersPublicRouter);

// Admin group — clerkAuthMiddleware verifies JWT + sets userRole; requireAdmin gates role==='admin'
const adminApp = new Hono();
adminApp.use('*', clerkAuthMiddleware);
adminApp.use('*', requireAdmin);
adminApp.route('/finders', findersAdminRouter);
adminApp.route('/sellers', sellersAdminRouter);
app.route('/api/v1/admin', adminApp);
```

> Mount order matters: the public `/api/v1/finders` router is registered with no middleware; admin routes live under the separately-guarded `/api/v1/admin` group so the public signup path is never caught by `clerkAuthMiddleware`.

**Acceptance criteria:**
- [ ] `findersPublicRouter` mounted in `apps/api/src/server.ts` (D-R) — `grep -n "findersPublicRouter" apps/api/src/index.ts` returns 0 results
- [ ] `POST /api/v1/finders/signup` reachable without `Authorization` header (public, no `clerkAuthMiddleware`)
- [ ] Admin group `/api/v1/admin/*` is wrapped in `clerkAuthMiddleware` + `requireAdmin` in `server.ts`
- [ ] Zod validates all fields; returns 400 on invalid body
- [ ] `lgpdConsentEssential: false` → 400 (Zod `z.literal(true)`)
- [ ] Honeypot `website` is `z.string().optional()` in the validator (D-R) — `grep -n "z.string().max(0)" apps/api/src/domains/finders/signup-schema.ts` returns 0 results
- [ ] Honeypot decision lives in the handler: non-empty `website` → silent 201 with NO DB insert (assert no `finders` row created in test)
- [ ] DB access uses `getDb()` from `../../db/client.js` — `grep -rn "db/index" apps/api/src/domains/finders/` returns 0 results (D-H)
- [ ] `status='pending'` on all real inserts
- [ ] `pnpm --filter @fxl-finders/api type-check` passes

---

### T03 · API — admin finders service (list, detail, approve, suspend)

**App:** `apps/api`
**File(s):**
- `apps/api/src/domains/finders/admin-routes.ts` (new)
- `apps/api/src/domains/finders/admin-service.ts` (new)
- `apps/api/src/middleware/require-admin.ts` (new — **T03 owns the ONE admin guard**, D-B)
- `apps/api/test/finders/finder-state-machine.test.ts` (new — TDD, see "State-machine TDD" below)

**What:** Hono routes mounted under `clerkAuthMiddleware` (Phase 01) + `requireAdmin` (this task). Provides the data the admin approval queue UI needs.

**Admin-vs-RLS access model (D-C) — AUTHORITATIVE:**
`finders` is `FORCE ROW LEVEL SECURITY`. Admin/cross-tenant routes here (list, detail, approve, suspend) need to read/write rows across ALL finder orgs, so they MUST use the dedicated BYPASSRLS connection `getAdminDb()` (Phase 01 creates role `fxl_finders_admin` LOGIN BYPASSRLS + `ADMIN_DATABASE_URL` + `getAdminDb()` in `db/client.ts`). These routes MUST NEVER call `setTenantContext` (that helper is for tenant-scoped finder/seller-facing requests, not admin). Every admin mutation (approve/suspend) still writes an `audit_log` row. This is the same pattern Phase 05/06 admin routes use. Rationale: an admin running as the app role would be blocked by RLS (its `app.current_org_id` is unset/single-tenant); BYPASSRLS is the deliberate cross-tenant escape hatch, audited rather than RLS-gated.

**Decision D-H applies:** every handler/service fn does `const db = getAdminDb();` from `../../db/client.js`. NO `db` singleton, NO `db/index.js`.

**Decision D-I applies:** import `clerkClient` from `../../lib/clerk.ts` (the singleton Phase 01 creates). Do NOT `import { clerkClient } from '@clerk/backend'` — it is not a bound default export in `@clerk/backend` v1.x.

**Routes:**
- `GET /api/v1/admin/finders?status=pending|approved|suspended` — paginated list (50/page, cursor-based)
- `GET /api/v1/admin/finders/:id` — detail
- `POST /api/v1/admin/finders/:id/approve` — approve finder (creates Clerk org + sends Clerk invite)
- `POST /api/v1/admin/finders/:id/suspend` — suspend finder (requires `{ reason: string }` body)

**Admin role guard middleware — T03 owns the ONE guard (D-B):**
This phase creates the single `require-admin.ts` guard for the whole codebase. Phase 02 consumes the SAME `requireAdmin` (it deletes any `adminAuth.ts`/`adminAuthMiddleware`/`isAdmin` it had); Phases 05/06 also reference it. Do NOT build a second guard anywhere.
```typescript
// apps/api/src/middleware/require-admin.ts (new — D-B, single source of truth)
import type { MiddlewareHandler } from 'hono';

export const requireAdmin: MiddlewareHandler = async (c, next) => {
  // c.get('userRole') is typed via ContextVariableMap augmentation OWNED BY PHASE 01 (D-B).
  const role = c.get('userRole'); // string | undefined — set by clerkAuthMiddleware from JWT publicMetadata.role
  if (role !== 'admin') {
    return c.json({ error: 'forbidden' }, 403);
  }
  return next();
};
```

**ContextVariableMap + `userRole` extraction is OWNED BY PHASE 01 (D-B) — T03 only CONSUMES it.**
Phase 01's `clerkAuthMiddleware` (renamed from `authMiddleware`; `authMiddleware` kept as an alias) augments Hono's `ContextVariableMap` with `userId: string`, `orgId: string`, `userRole: string | undefined`, and sets `c.set('userRole', (payload.publicMetadata as Record<string, unknown> | undefined)?.role as string | undefined)` from the verified JWT. T03 MUST NOT re-declare `ContextVariableMap` or re-extract the role — that would create a second auth mechanism. If, at execute time, Phase 01 has not yet shipped the `userRole` augmentation, the executor folds it into Phase 01's auth middleware task (NOT here), then proceeds.

**Type-check requirement:** `c.get('userRole')` MUST resolve to `string | undefined` (no `any`, no `// @ts-expect-error`). If TS complains, the Phase 01 `ContextVariableMap` augmentation is missing — fix it in Phase 01, do not cast here.

**Approve handler (core logic in `admin-service.ts`) — idempotent (WARN):**
```typescript
import { clerkClient } from '../../lib/clerk.js';   // D-I — singleton from Phase 01; NOT from '@clerk/backend'
import { getAdminDb } from '../../db/client.js';     // D-C/D-H — BYPASSRLS conn for cross-tenant admin
import { and, eq, sql } from 'drizzle-orm';
import { finders, auditLog } from '../../db/schema.js';

export async function approveFinder(finderId: string, adminUserId: string) {
  const db = getAdminDb();   // D-C — BYPASSRLS; NEVER setTenantContext on admin routes

  // Wrap in a transaction with SELECT ... FOR UPDATE to make approve idempotent under
  // concurrent double-clicks (WARN: approve idempotency).
  return db.transaction(async (tx) => {
    const [finder] = await tx
      .select()
      .from(finders)
      .where(eq(finders.id, finderId))
      .for('update')   // SELECT ... FOR UPDATE — row lock for the duration of the tx
      .limit(1);

    if (!finder) throw new Error('not_found');

    // Idempotency: a finder already approved (status !== 'pending' OR clerk_org_id present)
    // should not create a second Clerk org or re-invite. Reject re-approve of non-pending.
    if (finder.status !== 'pending') {
      // Double-approve is a no-op (idempotent) if already approved; otherwise invalid transition.
      if (finder.status === 'approved') return { id: finder.id, status: finder.status };
      throw new Error('invalid_state');   // e.g. suspended -> approve not allowed here
    }

    // 1. Create Clerk org ONLY if clerk_org_id is empty (idempotency: avoid duplicate orgs on retry)
    let clerkOrgId = finder.clerkOrgId;
    if (!clerkOrgId) {
      const org = await clerkClient.organizations.createOrganization({
        name: finder.displayName,
        createdBy: adminUserId,
      });
      clerkOrgId = org.id;
    }

    // 2. Flip status + backfill org ids
    await tx.update(finders)
      .set({
        status: 'approved',
        clerkOrgId,
        orgId: clerkOrgId,        // backfill orgId with real Clerk org_id
        approvedAt: new Date(),
        approvedByUserId: adminUserId,
        updatedAt: new Date(),
      })
      .where(and(eq(finders.id, finderId), eq(finders.status, 'pending')));   // guard: only flip pending

    // 3. Audit (D-C — every admin money/state mutation writes audit_log)
    await tx.insert(auditLog).values({
      actorUserId: adminUserId,
      action: 'finder.approved',
      entityType: 'finder',
      entityId: finder.id,
      metadata: { clerkOrgId },
    });

    // 4. Send Clerk invite — handle send failure EXPLICITLY (WARN).
    //    Org + status are already committed inside the tx; an invite failure must surface
    //    a typed error so the admin UI can offer "resend invite" rather than silently succeeding.
    try {
      await clerkClient.invitations.createInvitation({
        emailAddress: finder.contactEmail,
        publicMetadata: { role: 'finder', finderId: finder.id },
        redirectUrl: process.env.CLERK_FINDER_REDIRECT_URL ?? 'http://localhost:8006/finder/dashboard',
      });
    } catch (err) {
      throw new Error('invite_send_failed');   // status/org persisted; admin can re-trigger invite
    }

    return { id: finder.id, status: 'approved' as const };
  });
}
```

> Note on invite failure: because org creation is guarded by "only if `clerk_org_id` empty" and the status flip is guarded by `status = 'pending'`, re-calling `approveFinder` after an `invite_send_failed` does NOT create a second org and is safe to retry; it returns the already-approved row and re-attempts the invite. Route handler maps `invite_send_failed` to a 502 with a "convite não enviado, tente reenviar" message; `invalid_state` → 409; `not_found` → 404.

**Suspend handler — state-guarded (D-R):**
```typescript
export async function suspendFinder(finderId: string, adminUserId: string, reason: string) {
  const db = getAdminDb();   // D-C — BYPASSRLS
  return db.transaction(async (tx) => {
    const [finder] = await tx
      .select()
      .from(finders)
      .where(eq(finders.id, finderId))
      .for('update')
      .limit(1);
    if (!finder) throw new Error('not_found');
    // Guard: only an 'approved' (or already 'suspended', idempotent no-op) finder can be suspended.
    if (finder.status === 'suspended') return { id: finder.id, status: finder.status };
    if (finder.status !== 'approved') throw new Error('invalid_state');   // cannot suspend a pending finder

    await tx.update(finders)
      .set({ status: 'suspended', suspendedAt: new Date(), suspendedReason: reason, updatedAt: new Date() })
      .where(and(eq(finders.id, finderId), eq(finders.status, 'approved')));

    await tx.insert(auditLog).values({
      actorUserId: adminUserId,
      action: 'finder.suspended',
      entityType: 'finder',
      entityId: finder.id,
      metadata: { reason },
    });
    return { id: finder.id, status: 'suspended' as const };
  });
}
```

**State-machine TDD (new — `apps/api/test/finders/finder-state-machine.test.ts`):** write these tests BEFORE the service implementation (TDD). Mock `clerkClient` (org create + invitation) and use `getAdminDb()` against the test DB:
- `pending → approved` happy path: status flips to `approved`, `clerkOrgId`/`orgId` backfilled, invite sent once, an `audit_log` row written.
- reject `approve` when `status !== 'pending'`: a `suspended` finder → throws `invalid_state` (no Clerk org created, no invite).
- double-approve idempotency: calling `approveFinder` twice on the same finder creates EXACTLY ONE Clerk org (assert `createOrganization` called once) and sends exactly one invite on the first call; second call returns the approved row without a new org.
- invite-send failure: `createInvitation` rejects → `approveFinder` throws `invite_send_failed`, but `status='approved'` + `clerkOrgId` are persisted (re-invoke does not create a second org).
- `suspend` guard: suspending a `pending` finder throws `invalid_state`; suspending an `approved` finder sets `status='suspended'` + `suspendedReason`; suspending an already-`suspended` finder is an idempotent no-op.

**Acceptance criteria:**
- [ ] All 4 endpoints respond correctly
- [ ] DB access uses `getAdminDb()` from `../../db/client.js` (D-C/D-H); `setTenantContext` is NEVER called in this domain — `grep -rn "setTenantContext" apps/api/src/domains/finders/admin-*.ts` returns 0 results
- [ ] No `db/index` import in this domain — `grep -rn "db/index" apps/api/src/domains/finders/` returns 0 results (D-H)
- [ ] `clerkClient` imported from `../../lib/clerk.js` (D-I) — `grep -rn "from '@clerk/backend'" apps/api/src/domains/finders/` returns 0 results for a `clerkClient` import
- [ ] `GET /api/v1/admin/finders?status=pending` returns only pending finders across ALL orgs (BYPASSRLS cross-tenant read)
- [ ] Approve is idempotent: uses `SELECT ... FOR UPDATE`; creates a Clerk org ONLY when `clerk_org_id` is empty; second approve does NOT create a second org (TDD asserts `createOrganization` called once)
- [ ] Approve: Clerk org created, `finders.clerk_org_id` + `org_id` backfilled, invitation sent, `status='approved'`, `audit_log` row written
- [ ] Invite-send failure throws `invite_send_failed` AFTER status/org persist (handled explicitly, not swallowed); route maps it to 502
- [ ] Suspend is state-guarded: `pending` finder → `invalid_state`; `approved` → `status='suspended'` + `suspended_reason`; already-`suspended` → idempotent no-op; `audit_log` row written
- [ ] `requireAdmin` middleware rejects non-admin callers with 403; `c.get('userRole')` type-checks as `string | undefined` (D-B, no cast)
- [ ] State-machine TDD (`finder-state-machine.test.ts`) passes: pending→approved happy, reject-approve-when-not-pending, double-approve idempotency, invite-send-failure, suspend guard
- [ ] `pnpm --filter @fxl-finders/api type-check` passes

---

### T04 · API — admin sellers service (create + invite)

**App:** `apps/api`
**File(s):**
- `apps/api/src/domains/sellers/admin-routes.ts` (new)
- `apps/api/src/domains/sellers/admin-service.ts` (new)

**What:** Admin creates a `sellers` row and sends a Clerk invitation. No org for sellers.

**Decision D-H applies:** `sellers` is admin-managed cross-tenant (no RLS). Use `const db = getAdminDb()` from `../../db/client.js` for consistency with the other admin routes (D-C), so admin sellers reads/writes are never RLS-gated. NO `db` singleton, NO `db/index.js`. `setTenantContext` is NEVER called here.

**Decision D-I applies:** import `clerkClient` from `../../lib/clerk.ts` (Phase 01 singleton), NOT from `@clerk/backend`.

**Routes (mounted under the `clerkAuthMiddleware` + `requireAdmin` admin group in `server.ts`, see T02):**
- `GET /api/v1/admin/sellers` — list all sellers
- `POST /api/v1/admin/sellers` — create seller row + send Clerk invite
- `PATCH /api/v1/admin/sellers/:id/status` — set `status: 'active' | 'inactive'`

**Create handler (core logic):**
```typescript
import { clerkClient } from '../../lib/clerk.js';   // D-I — singleton; NOT from '@clerk/backend'
import { getAdminDb } from '../../db/client.js';     // D-H — lazy admin conn; no db singleton, no db/index.js
import { sellers } from '../../db/schema.js';

export async function createSellerAndInvite(
  input: { displayName: string; contactEmail: string },
  adminUserId: string,
) {
  const db = getAdminDb();   // D-H/D-C

  const [seller] = await db.insert(sellers).values({
    clerkUserId: '',   // placeholder until invite accepted (Phase 05 user.created webhook backfills)
    displayName: input.displayName,
    contactEmail: input.contactEmail,
    status: 'active',
  }).returning();

  await clerkClient.invitations.createInvitation({
    emailAddress: input.contactEmail,
    publicMetadata: { role: 'seller', sellerId: seller.id },
    redirectUrl: process.env.CLERK_SELLER_REDIRECT_URL ?? 'http://localhost:8006/seller/deals',
  });

  return seller;
}
```

**Note:** `sellers.clerk_user_id` is backfilled to the real Clerk user_id via a webhook (Phase 05 adds the Clerk webhook handler). Phase 03 ships with the empty-string placeholder — the seller row is created first, Clerk sends the invite, and when the seller completes signup, the Clerk `user.created` webhook backfills `clerk_user_id`. This is acceptable for Phase 03 (sellers cannot log in yet in a meaningful way until Phase 04+).

**Autopilot decision logged:** `sellers.clerk_user_id` backfill via Clerk webhook is deferred to Phase 05. Phase 03 only creates the row and sends the invite. The seller portal shell (T08) will still render on login because role routing uses `publicMetadata.role='seller'` (set at invite time), not a DB lookup.

**Acceptance criteria:**
- [ ] `POST /api/v1/admin/sellers` creates a `sellers` row and sends Clerk invite
- [ ] `GET /api/v1/admin/sellers` returns all sellers (no RLS — cross-org)
- [ ] DB access uses `getAdminDb()` from `../../db/client.js` (D-H) — `grep -rn "db/index" apps/api/src/domains/sellers/` returns 0 results; `setTenantContext` never called
- [ ] `clerkClient` imported from `../../lib/clerk.js` (D-I), not `@clerk/backend`
- [ ] Mounted under the `clerkAuthMiddleware` + `requireAdmin` admin group (T02)
- [ ] Clerk invite carries `{ role: 'seller', sellerId }` in `publicMetadata`
- [ ] `pnpm --filter @fxl-finders/api type-check` passes

---

### T05 · apps/site — i18n utility

**App:** `apps/site`
**File(s):**
- `apps/site/src/i18n/pt-BR.json` (new)
- `apps/site/src/i18n/index.ts` (new)

**What:** Minimal typed i18n helper for apps/site (autopilot decision A1 — no external package).

**`pt-BR.json` (initial keys — extend as needed in T06–T09):**
```json
{
  "app": {
    "name": "FXL Finders",
    "tagline": "Indique, venda, receba."
  },
  "nav": {
    "signup": "Quero ser Finder",
    "login": "Entrar",
    "privacy": "Privacidade",
    "terms": "Termos de Uso"
  },
  "signup": {
    "title": "Cadastre-se como Finder",
    "subtitle": "Preencha os dados abaixo. Nossa equipe revisará sua solicitação em até 48 horas.",
    "fields": {
      "displayName": "Nome completo",
      "contactEmail": "E-mail",
      "cpf": "CPF",
      "phone": "Telefone",
      "pixKey": "Chave PIX",
      "pixKeyType": "Tipo de chave PIX",
      "payoutAddress": "Endereço de cobrança"
    },
    "pixKeyTypes": {
      "cpf": "CPF",
      "email": "E-mail",
      "phone": "Telefone",
      "random": "Chave aleatória"
    },
    "lgpd": {
      "essential": "Concordo com o tratamento dos meus dados pessoais para execução dos serviços da plataforma FXL Finders (obrigatório).",
      "marketing": "Aceito receber comunicações sobre novas oportunidades e atualizações da plataforma (opcional).",
      "version": "v1.0"
    },
    "submit": "Enviar cadastro",
    "submitting": "Enviando...",
    "success": {
      "title": "Cadastro recebido!",
      "body": "Você receberá um e-mail em breve com as próximas etapas."
    },
    "errors": {
      "required": "Campo obrigatório",
      "invalidEmail": "E-mail inválido",
      "invalidCpf": "CPF deve ter 11 dígitos",
      "lgpdRequired": "Você precisa aceitar os termos essenciais para continuar",
      "generic": "Ocorreu um erro. Tente novamente."
    }
  },
  "legal": {
    "privacy": {
      "title": "Política de Privacidade",
      "lastUpdated": "Atualizado em: maio de 2026"
    },
    "terms": {
      "title": "Termos de Uso",
      "lastUpdated": "Atualizado em: maio de 2026"
    }
  },
  "hero": {
    "badge": "Plataforma de Afiliados B2B",
    "headline": "Indique o melhor software do mercado e ganhe comissões recorrentes.",
    "body": "FXL Finders é a plataforma que conecta indicadores (Finders) às soluções FXL. Gere seu link personalizado, acompanhe cliques e conversões, e receba sua comissão automaticamente.",
    "cta": "Quero ser Finder",
    "secondary": "Ver como funciona"
  },
  "features": {
    "title": "Por que ser um Finder?",
    "items": [
      {
        "title": "Links rastreados",
        "body": "Gere links exclusivos para cada produto. Acompanhe cliques e conversões em tempo real."
      },
      {
        "title": "Comissões transparentes",
        "body": "Saiba exatamente quanto você vai receber antes mesmo de fechar a venda. Bandas de preço públicas."
      },
      {
        "title": "Pagamento via PIX",
        "body": "Comissões pagas diretamente na sua chave PIX após o período de garantia."
      }
    ]
  },
  "howItWorks": {
    "title": "Como funciona",
    "steps": [
      { "title": "Cadastre-se", "body": "Preencha o formulário e aguarde aprovação em até 48 horas." },
      { "title": "Gere seu link", "body": "No painel, crie links rastreados para os produtos FXL." },
      { "title": "Compartilhe", "body": "Envie o link para potenciais clientes por qualquer canal." },
      { "title": "Receba", "body": "Quando o cliente paga, sua comissão é registrada automaticamente." }
    ]
  },
  "footer": {
    "copy": "© 2026 FXL Finders. Todos os direitos reservados.",
    "links": {
      "privacy": "Privacidade",
      "terms": "Termos"
    }
  }
}
```

**`index.ts`:**
```typescript
import ptBR from './pt-BR.json';

type Translations = typeof ptBR;

// Simple typed dot-path accessor — no runtime library needed
export function getT(): Translations {
  return ptBR;
}
```

**Acceptance criteria:**
- [ ] `getT()` returns the full translation object, fully typed
- [ ] No runtime i18n package added to `apps/site/package.json`
- [ ] `pnpm --filter @fxl-finders/site type-check` passes

---

### T06 · apps/site — signup page (`/signup`)

**App:** `apps/site`
**File(s):**
- `apps/site/src/app/signup/page.tsx` (new — server component wrapper)
- `apps/site/src/app/signup/SignupForm.tsx` (new — `'use client'` form)
- `apps/site/src/app/signup/actions.ts` (new — server action)
- `apps/site/src/app/signup/signup-schema-client.ts` (new — looser client Zod, WARN) — see "Client schema" below

**What:** Public finder signup flow. Server component page with a `'use client'` form component. Submission via Next.js Server Action (no client-side fetch in the happy path).

**Client schema (`signup-schema-client.ts`) — WARN fix (referenced by `actions.ts`):**
The API schema (T02) uses `z.literal(true)` for `lgpdConsentEssential`, which breaks HTML form / FormData round-tripping (a missing/unchecked checkbox is not the literal `true`). The client schema is the same shape but uses `z.boolean()` plus a `.refine(...)` that asserts `lgpdConsentEssential === true`. The server action re-validates with this client schema before POSTing; the API still enforces `z.literal(true)` server-side.
```typescript
// apps/site/src/app/signup/signup-schema-client.ts
import { z } from 'zod';

export const PIX_KEY_TYPES = ['cpf', 'email', 'phone', 'random'] as const;

export const finderSignupClientSchema = z
  .object({
    displayName: z.string().min(2).max(100),
    contactEmail: z.string().email(),
    cpf: z.string().regex(/^\d{11}$/).optional(),
    phone: z.string().min(10).max(20).optional(),
    pixKey: z.string().min(1).max(100).optional(),
    pixKeyType: z.enum(PIX_KEY_TYPES).optional(),
    lgpdConsentEssential: z.boolean(),           // looser than API's z.literal(true)
    lgpdConsentMarketing: z.boolean(),
    lgpdConsentVersion: z.string().min(1),
    website: z.string().optional(),              // honeypot — accept anything (D-R)
  })
  .refine((d) => d.lgpdConsentEssential === true, {
    path: ['lgpdConsentEssential'],
    message: 'Você precisa aceitar os termos essenciais para continuar',
  });

export type FinderSignupClientInput = z.infer<typeof finderSignupClientSchema>;
```

**Architecture note:** The form calls a Server Action (`actions.ts`) which internally POSTs to `apps/api/src/domains/finders/public-routes.ts`. The Server Action is the correct Next.js 15 App Router pattern for form submission — it avoids exposing the API URL to the client and keeps the form progressive-enhancement-ready.

**`actions.ts` (server action):**
```typescript
'use server';

import { z } from 'zod';
import { finderSignupClientSchema } from './signup-schema-client';

const API_URL = process.env.API_URL ?? 'http://localhost:3006';
const LGPD_VERSION = 'v1.0';

export type SignupState =
  | { status: 'idle' }
  | { status: 'success'; id: string }
  | { status: 'error'; message: string };

export async function signupAction(
  _prev: SignupState,
  formData: FormData,
): Promise<SignupState> {
  const raw = {
    displayName: formData.get('displayName'),
    contactEmail: formData.get('contactEmail'),
    cpf: formData.get('cpf') || undefined,
    phone: formData.get('phone') || undefined,
    pixKey: formData.get('pixKey') || undefined,
    pixKeyType: formData.get('pixKeyType') || undefined,
    lgpdConsentEssential: formData.get('lgpdConsentEssential') === 'true',
    lgpdConsentMarketing: formData.get('lgpdConsentMarketing') === 'true',
    lgpdConsentVersion: LGPD_VERSION,
    website: formData.get('website') ?? '',   // honeypot
  };

  const parsed = finderSignupClientSchema.safeParse(raw);
  if (!parsed.success) {
    return { status: 'error', message: parsed.error.issues[0]?.message ?? 'Dados inválidos' };
  }

  try {
    const res = await fetch(`${API_URL}/api/v1/finders/signup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(parsed.data),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      return { status: 'error', message: (err as { message?: string }).message ?? 'Erro no servidor' };
    }
    const data = await res.json() as { id: string };
    return { status: 'success', id: data.id };
  } catch {
    return { status: 'error', message: 'Não foi possível conectar ao servidor. Tente novamente.' };
  }
}
```

**`page.tsx`:**
```typescript
import { getT } from '@/i18n';
import { SignupForm } from './SignupForm';

export function generateMetadata() {
  const t = getT();
  return {
    title: `${t.signup.title} — ${t.app.name}`,
    description: t.signup.subtitle,
  };
}

export default function SignupPage() {
  const t = getT();
  return (
    <main className="mx-auto max-w-xl px-6 py-16">
      <h1 className="text-3xl font-semibold tracking-tight">{t.signup.title}</h1>
      <p className="mt-3 text-muted-foreground">{t.signup.subtitle}</p>
      <SignupForm />
    </main>
  );
}
```

**`SignupForm.tsx` (key structure — full implementation during execution):**
```typescript
'use client';
import { useActionState } from 'react';
import { signupAction, type SignupState } from './actions';

const INITIAL_STATE: SignupState = { status: 'idle' };

export function SignupForm() {
  const [state, formAction, isPending] = useActionState(signupAction, INITIAL_STATE);

  if (state.status === 'success') {
    return <SuccessMessage />;
  }

  return (
    <form action={formAction} className="mt-8 space-y-6">
      {/* Honeypot — hidden from real users */}
      <input
        type="text"
        name="website"
        tabIndex={-1}
        aria-hidden="true"
        className="absolute -left-[9999px] opacity-0"
        autoComplete="off"
      />
      {/* Fields: displayName, contactEmail, cpf, phone, pixKey, pixKeyType, payoutAddress */}
      {/* LGPD section — granular checkboxes */}
      {/* lgpdConsentEssential (required) */}
      {/* lgpdConsentMarketing (optional) */}
      {state.status === 'error' && <ErrorBanner message={state.message} />}
      <SubmitButton isPending={isPending} />
    </form>
  );
}
```

**Validation note:** Client-side validation uses `signup-schema-client.ts` (created in this task, see "Client schema" above) — a looser version of the API schema: same shape but uses `z.boolean()` + `.refine(lgpdConsentEssential === true)` instead of `z.literal(true)` (which breaks HTML/FormData checkbox round-tripping), and `website: z.string().optional()` for the honeypot (D-R). The server action re-validates with this client schema before POSTing; the API enforces the strict `z.literal(true)` schema server-side.

**Note on `/signup` rate-limiting (DEFER, D-R):** no rate-limiting on the signup endpoint in v1.0 — deferred to v1.1. Do NOT add Upstash/Turnstile here.

**Acceptance criteria:**
- [ ] `apps/site/src/app/signup/signup-schema-client.ts` exists and exports `finderSignupClientSchema`; `actions.ts` imports it (no broken import)
- [ ] Client schema uses `z.boolean()` + `.refine(lgpdConsentEssential === true)` (NOT `z.literal(true)`); honeypot `website: z.string().optional()`
- [ ] `/signup` page renders a form with all required fields: `displayName`, `contactEmail`, `cpf`, `phone`, `pixKey`, `pixKeyType`, `payoutAddress`
- [ ] LGPD section has two named checkboxes: `lgpdConsentEssential` (required) and `lgpdConsentMarketing` (optional)
- [ ] Honeypot `name="website"` input present, visually hidden, `tabIndex={-1}`, `aria-hidden="true"`
- [ ] Success state renders confirmation message (no redirect — stays on page)
- [ ] Error state renders inline error message
- [ ] Server action calls `POST /api/v1/finders/signup` on the API
- [ ] `generateMetadata` returns page title + description
- [ ] `pnpm --filter @fxl-finders/site type-check` passes
- [ ] No Turnstile / no external CAPTCHA library; no rate-limiting added (deferred to v1.1)

---

### T07 · apps/site — legal pages (`/legal/privacy`, `/legal/terms`)

**App:** `apps/site`
**File(s):**
- `apps/site/src/app/legal/privacy/page.tsx` (new)
- `apps/site/src/app/legal/terms/page.tsx` (new)
- `apps/site/src/components/LegalLayout.tsx` (new — shared prose wrapper)

**What:** Static LGPD-compliant legal pages in PT-BR. Copy is placeholder-quality but structure is real (all required LGPD sections present). Both are server components (no client interactivity needed).

**Required LGPD sections for Privacy Policy (`/legal/privacy`):**
1. Controlador dos dados (data controller identity: FXL — CNPJ + email placeholder)
2. Dados coletados (enumerate: display_name, contact_email, CPF, phone, PIX key, payout address, click telemetry via cookies)
3. Finalidade do tratamento (commission payment, platform operation, anti-fraud)
4. Base legal (Art. 7° da LGPD — execução de contrato; consentimento para marketing)
5. Compartilhamento de dados (not shared with third parties except Clerk for auth)
6. Retenção (data kept for contract duration + 5 years for accounting)
7. Direitos do titular (access, correction, deletion, portability, withdrawal of consent — contact: privacy@fxl.com.br)
8. Cookies (HttpOnly click tracking cookie `fxl_ref`, 90-day lifetime)
9. Contato DPO (privacy@fxl.com.br — placeholder)

**Required sections for Terms of Use (`/legal/terms`):**
1. Objeto (describe the platform — FXL Finders affiliate program)
2. Cadastro e aprovação (public signup + admin approval workflow)
3. Obrigações do Finder (truthful information, no self-referral, compliance with applicable law)
4. Comissões (reference to commission rules; payout via PIX after hold period)
5. Vedações (prohibited: fraud, spam, misleading representations)
6. Suspensão e cancelamento (admin can suspend for violations)
7. Propriedade intelectual (FXL owns the platform)
8. Lei aplicável (Brazilian law, São Paulo jurisdiction)

**`LegalLayout.tsx`:**
```typescript
import Link from 'next/link';

export function LegalLayout({ title, lastUpdated, children }: {
  title: string;
  lastUpdated: string;
  children: React.ReactNode;
}) {
  return (
    <div className="mx-auto max-w-3xl px-6 py-16">
      <Link href="/" className="text-sm text-muted-foreground hover:underline">← Voltar</Link>
      <h1 className="mt-6 text-3xl font-semibold">{title}</h1>
      <p className="mt-2 text-sm text-muted-foreground">{lastUpdated}</p>
      <div className="prose prose-neutral mt-8 max-w-none dark:prose-invert">
        {children}
      </div>
    </div>
  );
}
```

**Acceptance criteria:**
- [ ] `/legal/privacy` renders with all 9 required LGPD sections (headings + body text)
- [ ] `/legal/terms` renders with all 8 required sections
- [ ] Both pages are server components (no `'use client'`)
- [ ] `generateMetadata` on each page
- [ ] Links from Footer component to `/legal/privacy` and `/legal/terms` (update Footer in T09)
- [ ] `pnpm --filter @fxl-finders/site type-check` passes

---

### T08 · apps/site — landing page copy refresh

**App:** `apps/site`
**File(s):**
- `apps/site/src/components/Hero.tsx` (update)
- `apps/site/src/components/Features.tsx` (update)
- `apps/site/src/components/HowItWorks.tsx` (update)
- `apps/site/src/components/Footer.tsx` (update)

**What:** Replace all template-placeholder copy in the existing landing page components with FXL Finders content from the i18n file (T05). Keep component structure and Tailwind classes; swap only the strings.

**Hero changes:**
- Badge: `t.hero.badge`
- Headline: `t.hero.headline`
- Body: `t.hero.body`
- Primary CTA: `t.hero.cta` → links to `/signup`
- Secondary CTA: `t.hero.secondary` → scrolls to `#howItWorks`

**Features changes:**
- Section title: `t.features.title`
- 3 feature cards from `t.features.items`

**HowItWorks changes:**
- Section title: `t.howItWorks.title`
- 4 steps from `t.howItWorks.steps`

**Footer changes:**
- Copyright: `t.footer.copy`
- Add links to `/legal/privacy` and `/legal/terms`

**Note:** All landing page components are server components in Next.js 15 App Router. They call `getT()` directly (no `useTranslation` hook needed). No `'use client'` directive required.

**Acceptance criteria:**
- [ ] No template placeholder text visible anywhere on `/` (grep `"Substitua este texto"` → 0 results)
- [ ] Hero CTA "Quero ser Finder" links to `/signup`
- [ ] Footer has working links to `/legal/privacy` and `/legal/terms`
- [ ] All 4 components compile with `pnpm --filter @fxl-finders/site type-check`

---

### T09 · apps/web — role routing + `RoleGuard`

**App:** `apps/web`
**File(s):**
- `apps/web/src/router.tsx` (update)
- `apps/web/src/components/auth/RoleGuard.tsx` (new)
- `apps/web/src/pages/errors/NoRolePage.tsx` (new)

**What:** Extend the existing React Router v6 router to support three role-based shells. `RoleGuard` reads `user.publicMetadata.role` from `useUser()` and renders the appropriate layout.

**`RoleGuard.tsx`:** (apps/web is Vite, NOT Next.js — there is NO `'use client'` directive in any apps/web file)
```typescript
import { useUser } from '@clerk/clerk-react';
import { Navigate } from 'react-router-dom';

type Role = 'admin' | 'finder' | 'seller';

export function RoleGuard({ role, children }: { role: Role; children: React.ReactNode }) {
  const { user, isLoaded } = useUser();

  if (!isLoaded) return <FullPageSkeleton />;

  const userRole = user?.publicMetadata?.role as Role | undefined;
  if (userRole !== role) {
    return <Navigate to="/no-role" replace />;
  }

  return <>{children}</>;
}
```

**Updated `router.tsx` (role-based routes):**
```typescript
const routes: RouteObject[] = [
  {
    path: '/',
    element: (
      <Protected>
        <RoleRouter />   // reads role → redirects to /admin, /finder, or /seller
      </Protected>
    ),
  },
  // Admin shell
  {
    path: '/admin',
    element: (
      <Protected>
        <RoleGuard role="admin">
          <AdminShell />
        </RoleGuard>
      </Protected>
    ),
    children: [
      { path: 'finders', element: <AdminFindersPage /> },
      { path: 'finders/:id', element: <AdminFinderDetailPage /> },
      { path: 'sellers', element: <AdminSellersPage /> },
    ],
  },
  // Finder shell
  {
    path: '/finder',
    element: (
      <Protected>
        <RoleGuard role="finder">
          <FinderShell />
        </RoleGuard>
      </Protected>
    ),
    children: [
      { path: 'dashboard', element: <FinderDashboardPage /> },
      { path: 'links', element: <LinksPlaceholderPage /> },
      { path: 'commissions', element: <CommissionsPlaceholderPage /> },
      { path: 'payouts', element: <PayoutsPlaceholderPage /> },
    ],
  },
  // Seller shell
  {
    path: '/seller',
    element: (
      <Protected>
        <RoleGuard role="seller">
          <SellerShell />
        </RoleGuard>
      </Protected>
    ),
    children: [
      { path: 'deals', element: <SellerDealsPlaceholderPage /> },
    ],
  },
  { path: '/no-role', element: <NoRolePage /> },
  { path: '*', element: <Navigate to="/" replace /> },
];
```

**`RoleRouter` component** (replaces the old `HomePage` as the root redirect):
```typescript
function RoleRouter() {
  const { user, isLoaded } = useUser();
  if (!isLoaded) return <FullPageSkeleton />;
  const role = user?.publicMetadata?.role as string | undefined;
  if (role === 'admin') return <Navigate to="/admin/finders" replace />;
  if (role === 'finder') return <Navigate to="/finder/dashboard" replace />;
  if (role === 'seller') return <Navigate to="/seller/deals" replace />;
  return <Navigate to="/no-role" replace />;
}
```

**Dev role-set method (NIT — for local routing tests):** in local dev there is no invite flow setting `publicMetadata.role`. To exercise role routing, set the role on the test user via the Clerk Dashboard (User → Metadata → Public metadata → `{"role":"admin"}`) OR via the backend once: `clerkClient.users.updateUser(userId, { publicMetadata: { role: 'admin' } })` from a throwaway script. The custom-claim must also be configured in the Clerk session token (Phase 01 D-B handoff) so the JWT carries `publicMetadata.role`. Document this in the phase handoff so the verifier can flip roles to test all four routing branches.

**Acceptance criteria:**
- [ ] No `'use client'` directive anywhere in apps/web (Vite) — `grep -rn "use client" apps/web/src/` returns 0 results (NIT)
- [ ] Logged-in admin navigating to `/` → redirected to `/admin/finders`
- [ ] Logged-in finder navigating to `/` → redirected to `/finder/dashboard`
- [ ] Logged-in seller navigating to `/` → redirected to `/seller/deals`
- [ ] User with no role → `/no-role` page
- [ ] Finder cannot access `/admin/*` (RoleGuard redirects)
- [ ] `pnpm --filter @fxl-finders/web type-check` passes

---

### T10 · apps/web — admin shell + finder approval queue UI

**App:** `apps/web`
**File(s):**
- `apps/web/src/components/layout/AdminShell.tsx` (new)
- `apps/web/src/admin/finders/AdminFindersPage.tsx` (new)
- `apps/web/src/admin/finders/AdminFinderDetailPage.tsx` (new)
- `apps/web/src/admin/finders/hooks/useFinders.ts` (new)
- `apps/web/src/admin/sellers/AdminSellersPage.tsx` (new)
- `apps/web/src/admin/sellers/hooks/useSellers.ts` (new)

**What:** Admin approval queue. List pending finders, view detail, approve or suspend.

**`AdminShell.tsx`** — reuses `AppShell` pattern from template but with admin-specific sidebar nav:
```typescript
// Sidebar items for admin:
const adminItems = [
  { to: '/admin/finders', icon: Users, key: 'nav.finders' },
  { to: '/admin/sellers', icon: Briefcase, key: 'nav.sellers' },
  // Phase 02 adds: apps, products, payouts, audit
];
```

**`useFinders.ts` hook — D-J (use `apiFetch`, pass Clerk token, build query string manually):**
All authed calls go through the existing `apiFetch(path, { method, token, body })` helper (prepends `VITE_API_URL`, attaches the Bearer token). Pass the Clerk token from `useAuth().getToken()`. Do NOT use `apiClient.get`/`params` (does not exist per D-J) and do NOT use bare `fetch('/api/...')`. Build query strings manually with `URLSearchParams`.
```typescript
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@clerk/clerk-react';
import { apiFetch } from '@/lib/api-fetch';   // existing helper (D-J)

export function useFinders(status?: 'pending' | 'approved' | 'suspended') {
  const { getToken } = useAuth();
  return useQuery({
    queryKey: ['admin', 'finders', status],
    queryFn: async () => {
      const token = await getToken();
      const qs = status ? `?${new URLSearchParams({ status }).toString()}` : '';
      return apiFetch<FinderRow[]>(`/api/v1/admin/finders${qs}`, { method: 'GET', token });
    },
    select: (data) => (Array.isArray(data) ? data : []),
  });
}

// Approve / suspend mutations — invalidate BOTH the list key and the detail key (WARN: invalidation)
export function useApproveFinder() {
  const { getToken } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const token = await getToken();
      return apiFetch(`/api/v1/admin/finders/${id}/approve`, { method: 'POST', token });
    },
    onSuccess: (_data, id) => {
      qc.invalidateQueries({ queryKey: ['admin', 'finders'] });
      qc.invalidateQueries({ queryKey: ['admin', 'finders', id] });
    },
  });
}

export function useSuspendFinder() {
  const { getToken } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, reason }: { id: string; reason: string }) => {
      const token = await getToken();
      return apiFetch(`/api/v1/admin/finders/${id}/suspend`, { method: 'POST', token, body: { reason } });
    },
    onSuccess: (_data, { id }) => {
      qc.invalidateQueries({ queryKey: ['admin', 'finders'] });
      qc.invalidateQueries({ queryKey: ['admin', 'finders', id] });
    },
  });
}
```

> `useSellers.ts` follows the same `apiFetch` + `getToken()` + manual-query-string pattern (D-J). The seller-invite mutation invalidates `['admin','sellers']`.

> **Port note (D-J/NIT):** confirm `api-fetch.ts` / `VITE_API_URL` default points at port **3006** (not 3000). If `api-client.ts` ships a `3000` default, fix it to `3006`.

**`AdminFindersPage.tsx` — list view:**
- Status tab filter: Pending / Approved / Suspended
- Table columns: Name, Email, CPF (last 3 digits + mask), PIX key, Created at, Status badge, Actions
- Loading: skeleton rows (3 rows)
- Empty: `EmptyState` component ("Nenhum finder encontrado")
- Pending row action: "Ver detalhe" button → `/admin/finders/:id`

**`AdminFinderDetailPage.tsx` — detail + action:**
- Shows all finder fields (read-only)
- LGPD consent status display (essential / marketing checkboxes read-only, version + timestamp)
- **Raw-ID handling (WARN, FXL contract):** `approved_by_user_id` (a `user_*` Clerk id) and `clerk_org_id`/`org_id` (an `org_*` id) MUST NOT render as raw Clerk identifiers in user-facing UI. Prefer resolving to a display name (per-endpoint `display_name` field per D-R deferral); if no name is available, render via the raw-ID fallback class `font-mono text-xs text-muted-foreground` (never inline plain text). Approval timestamp may render normally.
- "Aprovar" button → uses `useApproveFinder()` (POST `/api/v1/admin/finders/:id/approve`) → on success invalidates BOTH `['admin','finders']` AND `['admin','finders', id]` (WARN: invalidation)
- "Suspender" button → opens confirmation dialog with reason input → uses `useSuspendFinder()` (POST `/api/v1/admin/finders/:id/suspend`) → invalidates BOTH `['admin','finders']` AND `['admin','finders', id]`
- Loading: `KPICard`-style skeleton for each field
- Mutations use TanStack Query `useMutation` + `invalidateQueries` (never `resetQueries`)

**i18n keys to add to `apps/web/src/i18n/pt-BR.json`:**
```json
{
  "nav": {
    "finders": "Finders",
    "sellers": "Vendedores"
  },
  "admin": {
    "finders": {
      "title": "Finders",
      "tabs": { "pending": "Pendentes", "approved": "Aprovados", "suspended": "Suspensos" },
      "columns": { "name": "Nome", "email": "E-mail", "cpf": "CPF", "pixKey": "Chave PIX", "createdAt": "Cadastro", "status": "Status" },
      "actions": { "view": "Ver detalhe", "approve": "Aprovar", "suspend": "Suspender" },
      "approveConfirm": "Ao aprovar, um e-mail de convite será enviado para o finder.",
      "suspendLabel": "Motivo da suspensão",
      "empty": "Nenhum finder encontrado",
      "lgpd": { "essential": "Consentimento essencial", "marketing": "Consentimento marketing", "version": "Versão LGPD", "consentedAt": "Consentiu em" }
    },
    "sellers": {
      "title": "Vendedores",
      "invite": "Convidar vendedor",
      "fields": { "name": "Nome", "email": "E-mail" },
      "empty": "Nenhum vendedor cadastrado"
    }
  }
}
```

**Acceptance criteria:**
- [ ] All API calls use `apiFetch(path, { method, token, body })` with `token` from `useAuth().getToken()` (D-J) — `grep -rn "apiClient.get\|params:" apps/web/src/admin/` returns 0 results; no bare `fetch('/api/`
- [ ] Query strings built manually via `URLSearchParams` (D-J), not a `params` option
- [ ] `AdminFindersPage` renders table with 3 loading skeleton rows while fetching
- [ ] Status tab filter works (changes query param → refetches)
- [ ] `AdminFinderDetailPage` shows all finder fields including LGPD consent section
- [ ] "Aprovar" creates Clerk org + sends invite + flips status; invalidates BOTH `['admin','finders']` AND `['admin','finders', id]` (WARN)
- [ ] "Suspender" requires reason text; dialog confirm required; invalidates BOTH `['admin','finders']` AND `['admin','finders', id]` (WARN)
- [ ] `AdminSellersPage` shows seller list + "Convidar vendedor" form (uses `apiFetch` + `getToken()`)
- [ ] Seller invite form: `displayName` + `contactEmail` → `POST /api/v1/admin/sellers`
- [ ] All strings via `useTranslation()`
- [ ] FXL contract: `KPICard` for metrics, `isLoading` → skeleton, `!isLoading && empty` → empty state
- [ ] No raw Clerk IDs rendered in UI: `approved_by_user_id`/`clerk_org_id`/`org_id` resolved to a display name or rendered via `font-mono text-xs text-muted-foreground` fallback (WARN: raw-ID)
- [ ] `pnpm --filter @fxl-finders/web type-check` passes

---

### T11 · apps/web — finder portal shell

**App:** `apps/web`
**File(s):**
- `apps/web/src/components/layout/FinderShell.tsx` (new)
- `apps/web/src/finder/dashboard/FinderDashboardPage.tsx` (new)
- `apps/web/src/finder/links/LinksPlaceholderPage.tsx` (new)
- `apps/web/src/finder/commissions/CommissionsPlaceholderPage.tsx` (new)
- `apps/web/src/finder/payouts/PayoutsPlaceholderPage.tsx` (new)

**What:** Auth-gated finder portal layout with sidebar navigation. Placeholder pages for all 3 main sections. Real content lands in Phase 04 (links) and Phase 05 (commissions, payouts).

**`FinderShell.tsx`** — sidebar items:
```typescript
const finderItems = [
  { to: '/finder/links', icon: Link2, key: 'nav.links' },
  { to: '/finder/commissions', icon: BarChart2, key: 'nav.commissions' },
  { to: '/finder/payouts', icon: Wallet, key: 'nav.payouts' },
];
```

**`FinderDashboardPage.tsx`** — placeholder with KPICards:
- KPICard: "Links ativos" — value `—`, icon `Link2`, colorScheme `default`, `isLoading=false`
- KPICard: "Comissões pendentes" — value `—`, icon `BarChart2`, colorScheme `default`, `isLoading=false`
- KPICard: "Próximo pagamento" — value `—`, icon `Wallet`, colorScheme `default`, `isLoading=false`
- Banner: "Dashboard completo disponível em breve. Seu portal está sendo configurado."

**Placeholder pages** (same pattern for all 3):
```typescript
export function LinksPlaceholderPage() {
  const { t } = useTranslation();
  return (
    <EmptyState
      title={t('finder.links.comingSoon')}
      description={t('finder.links.comingSoonDesc')}
    />
  );
}
```

**i18n keys to add:**
```json
{
  "nav": {
    "links": "Meus Links",
    "commissions": "Comissões",
    "payouts": "Pagamentos"
  },
  "finder": {
    "dashboard": {
      "title": "Dashboard",
      "kpi": {
        "activeLinks": "Links ativos",
        "pendingCommissions": "Comissões pendentes",
        "nextPayout": "Próximo pagamento"
      },
      "banner": "Dashboard completo disponível em breve."
    },
    "links": { "comingSoon": "Meus Links", "comingSoonDesc": "Geração de links disponível na próxima fase." },
    "commissions": { "comingSoon": "Comissões", "comingSoonDesc": "Histórico de comissões disponível em breve." },
    "payouts": { "comingSoon": "Pagamentos", "comingSoonDesc": "Histórico de pagamentos disponível em breve." }
  }
}
```

**Acceptance criteria:**
- [ ] Finder portal sidebar shows: Links / Comissões / Pagamentos
- [ ] `/finder/dashboard` renders 3 KPICards (value `—`, not loading)
- [ ] `/finder/links`, `/finder/commissions`, `/finder/payouts` render placeholder `EmptyState`
- [ ] Accessing `/finder/*` without `finder` role → redirected by `RoleGuard`
- [ ] All strings via `useTranslation()`
- [ ] `pnpm --filter @fxl-finders/web type-check` passes

---

### T12 · apps/web — seller portal shell

**App:** `apps/web`
**File(s):**
- `apps/web/src/components/layout/SellerShell.tsx` (new)
- `apps/web/src/seller/deals/SellerDealsPlaceholderPage.tsx` (new)

**What:** Auth-gated seller portal. Minimal shell — one page placeholder. Real content lands in Phase 05+ (commission views for seller's deals).

**`SellerShell.tsx`** — sidebar with single item:
```typescript
const sellerItems = [
  { to: '/seller/deals', icon: ShoppingBag, key: 'nav.deals' },
];
```

**`SellerDealsPlaceholderPage.tsx`:**
```typescript
export function SellerDealsPlaceholderPage() {
  const { t } = useTranslation();
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">{t('seller.deals.title')}</h1>
      <EmptyState
        title={t('seller.deals.comingSoon')}
        description={t('seller.deals.comingSoonDesc')}
      />
    </div>
  );
}
```

**i18n keys:**
```json
{
  "nav": { "deals": "Minhas Vendas" },
  "seller": {
    "deals": {
      "title": "Minhas Vendas",
      "comingSoon": "Painel disponível em breve",
      "comingSoonDesc": "Visualização de comissões e conversões será disponibilizada na próxima fase."
    }
  }
}
```

**Acceptance criteria:**
- [ ] `/seller/deals` renders placeholder with EmptyState
- [ ] Accessing `/seller/*` without `seller` role → `RoleGuard` redirects
- [ ] All strings via `useTranslation()`
- [ ] `pnpm --filter @fxl-finders/web type-check` passes

---

### T13 · apps/web — `NoRolePage` + env wiring

**App:** `apps/web`
**File(s):**
- `apps/web/src/pages/errors/NoRolePage.tsx` (new)
- `apps/web/.env.dev.example` (update — add `VITE_SITE_URL`)
- `apps/api/.env.dev.example` (update — add `CLERK_FINDER_REDIRECT_URL`, `CLERK_SELLER_REDIRECT_URL`)

**What:** Error page for authenticated users with no assigned role. Also wires environment variables needed for Clerk redirect URLs.

**`NoRolePage.tsx`:**
```typescript
export function NoRolePage() {
  const { t } = useTranslation();
  const { signOut } = useClerk();
  return (
    <div className="flex h-screen flex-col items-center justify-center gap-4 px-6 text-center">
      <h1 className="text-2xl font-semibold">{t('errors.noRole.title')}</h1>
      <p className="text-muted-foreground max-w-md">{t('errors.noRole.body')}</p>
      <Button variant="outline" onClick={() => signOut()}>
        {t('errors.noRole.signOut')}
      </Button>
    </div>
  );
}
```

**i18n keys:**
```json
{
  "errors": {
    "noRole": {
      "title": "Acesso não autorizado",
      "body": "Sua conta ainda não tem um perfil associado na plataforma FXL Finders. Entre em contato com o administrador.",
      "signOut": "Sair"
    }
  }
}
```

**Env additions:**

`apps/web/.env.dev.example`:
```
# Site URL (apps/site) — used for links to public pages
VITE_SITE_URL=http://localhost:4006
```

`apps/api/.env.dev.example`:
```
# Clerk redirect URLs — where users land after accepting invite
CLERK_FINDER_REDIRECT_URL=http://localhost:8006/finder/dashboard
CLERK_SELLER_REDIRECT_URL=http://localhost:8006/seller/deals
```

**Acceptance criteria:**
- [ ] `/no-role` page renders with title, body, and sign-out button
- [ ] Sign-out calls `signOut()` from `useClerk()`
- [ ] Env vars documented in both `.env.dev.example` files
- [ ] `pnpm --filter @fxl-finders/web type-check` passes

---

### T13b · apps/web — i18n key merge (PT-BR + EN) + resolution assertion

**App:** `apps/web`
**File(s):**
- `apps/web/src/i18n/pt-BR.json` (update — merge ALL new keys)
- `apps/web/src/i18n/en.json` (update — merge the SAME key set, EN translations)
- `apps/web/src/i18n/__tests__/keys-resolve.test.ts` (new — resolution assertion)

**What (D-R i18n):** Every new apps/web string introduced by T10–T13 (`nav.finders`, `nav.sellers`, `nav.links`, `nav.commissions`, `nav.payouts`, `nav.deals`, the whole `admin.*`, `finder.*`, `seller.*`, and `errors.noRole.*` trees) MUST be written into BOTH `pt-BR.json` AND `en.json`. apps/web is bilingual (PT-BR primary, EN secondary per the FXL contract) — a key present only in PT-BR renders the raw key string when the locale is EN. This task is the single merge point so no T10–T13 key is forgotten in either file.

**Steps:**
1. Collect every i18n key referenced via `useTranslation()`/`t('...')` in the files created by T10, T11, T12, T13.
2. Add each key (with PT-BR copy from those tasks' inline JSON blocks) to `pt-BR.json`.
3. Add the SAME key set to `en.json` with English translations.
4. Write `keys-resolve.test.ts` asserting (a) the PT-BR and EN key sets are identical (no missing/extra keys in either), and (b) i18next resolves a representative sample (`admin.finders.title`, `finder.dashboard.title`, `seller.deals.title`, `errors.noRole.title`, `nav.finders`) to a non-empty value that is NOT equal to the key itself (proves no raw-key render).

**Acceptance criteria:**
- [ ] All new T10–T13 keys present in BOTH `pt-BR.json` and `en.json`
- [ ] PT-BR and EN top-level key sets are identical (test asserts deep key-set equality)
- [ ] `keys-resolve.test.ts` passes: sampled keys resolve to non-empty strings ≠ the key (no raw-key render) in both locales
- [ ] `grep -rn "t('" apps/web/src/admin apps/web/src/finder apps/web/src/seller apps/web/src/pages/errors` — every referenced key exists in both JSON files
- [ ] `pnpm --filter @fxl-finders/web type-check` passes

---

### T14 · Type-check + lint gate (all apps)

**What:** Final gate across all three apps touched in this phase.

**Commands:**
```bash
pnpm --filter @fxl-finders/api type-check
pnpm --filter @fxl-finders/web type-check
pnpm --filter @fxl-finders/site type-check
pnpm --filter @fxl-finders/api lint
pnpm --filter @fxl-finders/web lint
pnpm --filter @fxl-finders/site lint
```

**Acceptance criteria:**
- [ ] All 6 commands exit 0
- [ ] No `any` types in any new TypeScript file
- [ ] Named exports only (no default export in any new file)
- [ ] No `resetQueries()` calls (only `invalidateQueries()`)
- [ ] All user-facing strings via `useTranslation()` in apps/web; via `getT()` in apps/site
- [ ] No raw Clerk IDs (`user_*`, `org_*`) rendered anywhere in UI components

---

## Dependency map

```
T01 (LGPD migration)
  └─ T02 (public signup route — needs lgpd columns in schema)
       └─ T06 (signup form — calls signup route)

T03 (admin finders service — owns require-admin.ts; TDD finder-state-machine.test.ts)
  └─ T10 (admin finders UI — consumes admin routes via apiFetch)

T04 (admin sellers service)
  └─ T10 (admin sellers UI)

T05 (i18n utility)
  └─ T06 (signup page — also creates signup-schema-client.ts)
  └─ T07 (legal pages)
  └─ T08 (landing copy)

T09 (role routing)
  └─ T10 (admin shell wired into router)
  └─ T11 (finder shell wired into router)
  └─ T12 (seller shell wired into router)
  └─ T13 (NoRolePage wired into router)

T10 + T11 + T12 + T13
  └─ T13b (merge ALL new web keys into pt-BR.json + en.json; assert i18next resolves)

T14 (gate) — depends on all T01–T13b
```

**Parallel execution opportunity:** T01–T04 (backend) and T05–T08 (apps/site) can run in parallel. T09–T13 (apps/web) depend only on T01–T04 being defined (interfaces known), not executed. T13b must run AFTER T10–T13 (it harvests their keys).

> **Cross-phase coordination (D-B):** T03 creates the SINGLE `apps/api/src/middleware/require-admin.ts`. Phase 02 must consume this same `requireAdmin` (deleting any `adminAuth.ts`/`isAdmin` it built); Phases 05/06 reference it. Do not build a second admin guard in any phase.

---

## Failure list

1. **LGPD columns gap from Phase 01**: `finders` table in Phase 01 T02 does not include `lgpd_consent_*` columns. Phase 03 ships a separate migration (T01). If Phase 01 is re-opened before execution, add columns there instead — T01 becomes a no-op. **Resolution: T01 handles both cases with a conditional migration pattern.**

2. **`finders.org_id` empty-string at signup**: Phase 01 defines `org_id text NOT NULL` but provides no convention for pre-approval rows. Phase 03 uses `''` (empty string) as a placeholder. This is a minor schema design gap — not blocked, but noted for review. A future migration could add a `CHECK (status = 'pending' OR org_id != '')` constraint.

3. **`sellers.clerk_user_id` backfill**: Cannot be backfilled until the seller accepts the Clerk invite. Phase 03 ships with `''` placeholder. Phase 05 adds the Clerk webhook handler that backfills this column when `user.created` fires. Seller portal shell (T12) works on login via `publicMetadata.role='seller'` without a DB lookup. **Not blocking Phase 03.**

4. **`clerkClient` initialization (D-I)**: Phase 01 creates the singleton `apps/api/src/lib/clerk.ts` → `export const clerkClient = createClerkClient({ secretKey: env.CLERK_SECRET_KEY })`. Phase 03 (T03, T04) imports `clerkClient` from `../../lib/clerk.ts` and calls `clerkClient.organizations.createOrganization(...)` and `clerkClient.invitations.createInvitation(...)`. Do NOT `import { clerkClient } from '@clerk/backend'` (not a bound default export in v1.x). If Phase 01 did not create `lib/clerk.ts`, the executor creates it as a prerequisite sub-step (folded into Phase 01, not duplicated here). **Verify `@clerk/backend` v1.x surface before coding** (training data may be stale): confirm `createClerkClient`, `client.organizations.createOrganization({ name, createdBy })`, and `client.invitations.createInvitation({ emailAddress, publicMetadata, redirectUrl })` exist and match these signatures in the installed version (`pnpm --filter @fxl-finders/api why @clerk/backend`; check `node_modules/@clerk/backend` types or current Clerk docs). Adjust call shape if the v1.x API differs.

5. **`@hono/zod-validator` availability**: T02 uses `zValidator` from `@hono/zod-validator`. If this package is not already in `apps/api/package.json`, T02 must add it (`pnpm add @hono/zod-validator --filter @fxl-finders/api`).

---

## Autopilot decisions summary

See inline `**Autopilot decision Ax:**` callouts above (A1–A8). All gray-area decisions made to minimize scope, dependencies, and deferred technical debt consistent with v1.0 goals.

---

## Phase dependencies

**This phase depends on:** Phase 01 (schema + auth middleware + `setTenantContext`)
**This phase unblocks:** Phase 04 (referral links — needs finder portal shell + approved finder users)
**Parallel with:** Phase 02 (apps/products/price-bands admin — same dependency on Phase 01, no overlap)

---

## Verify gate

After execution, run:
```bash
/gsd-verify-work 03
```

Verify checklist (confirm before marking phase complete):
- [ ] Public signup router mounted in `apps/api/src/server.ts` (NOT index.ts) — `grep -n findersPublicRouter apps/api/src/index.ts` → 0 (D-R)
- [ ] `POST /api/v1/finders/signup` responds 201 with `{ id, status: 'pending' }` (no auth header)
- [ ] Honeypot: validator is `website: z.string().optional()`; `website: "bot"` in body → silent 201, no DB row inserted (D-R)
- [ ] `lgpdConsentEssential: false` → 400 from API
- [ ] `signup-schema-client.ts` exists; `actions.ts` import resolves (WARN)
- [ ] `/signup` page renders all form fields + LGPD checkboxes; no rate-limit added (v1.1 deferral)
- [ ] Backend admin routes use `getAdminDb()` (BYPASSRLS) — `grep -rn "db/index\|setTenantContext" apps/api/src/domains/finders/admin-*.ts apps/api/src/domains/sellers/` → 0 (D-C/D-H)
- [ ] `clerkClient` imported from `lib/clerk.ts` everywhere in this phase — `grep -rn "clerkClient } from '@clerk/backend'" apps/api/src/domains/` → 0 (D-I)
- [ ] Admin: `GET /api/v1/admin/finders?status=pending` lists pending finders (cross-tenant BYPASSRLS)
- [ ] Admin approve (idempotent): Clerk org created once, `finders.status = 'approved'`, invite sent, `audit_log` row written; second approve does not create a 2nd org
- [ ] State-machine TDD `finder-state-machine.test.ts` passes (happy, reject-non-pending, double-approve idempotency, invite-failure, suspend guard)
- [ ] Admin suspend: state-guarded; `finders.status = 'suspended'`, `suspended_reason` set; pending→suspend → `invalid_state`
- [ ] Admin sellers: `POST /api/v1/admin/sellers` creates row + sends invite
- [ ] apps/web hooks use `apiFetch` + `getToken()` (D-J) — `grep -rn "apiClient.get\|params:" apps/web/src/admin` → 0
- [ ] approve/suspend mutations invalidate BOTH `['admin','finders']` AND `['admin','finders', id]` (WARN)
- [ ] `/` (apps/web) — admin → `/admin/finders`, finder → `/finder/dashboard`, seller → `/seller/deals`, no role → `/no-role`
- [ ] Finder role guard: accessing `/admin/*` as finder → redirect
- [ ] `/finder/dashboard` renders 3 KPICards
- [ ] `/legal/privacy` and `/legal/terms` render with all required LGPD sections
- [ ] Landing page at `/` has no template placeholder text
- [ ] Footer links to `/legal/privacy` and `/legal/terms` are functional
- [ ] i18n: all new web keys present in BOTH `pt-BR.json` AND `en.json`; `keys-resolve.test.ts` proves no raw-key render (D-R)
- [ ] No `'use client'` in apps/web — `grep -rn "use client" apps/web/src/` → 0 (NIT)
- [ ] `pnpm --filter @fxl-finders/api type-check` exits 0
- [ ] `pnpm --filter @fxl-finders/web type-check` exits 0
- [ ] `pnpm --filter @fxl-finders/site type-check` exits 0
- [ ] No `any` types in any new file
- [ ] No raw Clerk IDs in UI (`approved_by_user_id`/`clerk_org_id` resolved or `font-mono` fallback)
