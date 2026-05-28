---
phase: "02"
name: "Apps + products + price bands admin"
milestone: "v1.0 — FXL Finders MVP"
status: "planned"
wave: "W2"
depends_on: ["01"]
plan_count: 7
mode: standard
autonomous: true
---

# Phase 02 — Apps + products + price bands admin

**Milestone:** v1.0 — FXL Finders MVP
**Status:** ⏳ planned
**Wave:** W2 (depends on Phase 01; parallelizable with Phase 03)

## UI-SPEC Prerequisite (REQUIRED BEFORE T01)

> `/gsd:ui-phase` MUST be run before executing any task in this phase.
> This phase contains heavy admin CRUD UI — tables, dialogs, reveal modals,
> badge status indicators, and multi-step key rotation flows. The UI-SPEC
> contract produced by `/gsd:ui-phase 02` defines the visual/interaction
> spec that all frontend tasks in T01–T03 must follow.
>
> **Command to run first:**
> ```
> /gsd:ui-phase 02
> ```
> After UI-SPEC is written (`.planning/phases/02-*/02-UI-SPEC.md`), proceed with T01.

---

## Context sources (read before executing any task)

1. `.planning/plan-brief.md` — cascading decisions (read first, especially Wave 0 + Wave 1)
2. `docs/superpowers/specs/2026-05-28-fxl-finders-v1-design.md` — canonical spec (§ 4 data model, § 5 auth, § 9 security)
3. `.planning/ROADMAP.md` — phase list and dependencies
4. `CLAUDE.md` — FXL contract (non-negotiable)
5. `.planning/phases/01-schema-foundation-clerk-auth-rls/01-PLAN.md` — Phase 01 decisions (auth middleware, setTenantContext, DB role pattern)

---

## Critical architectural note — no RLS for admin tables

> **Apps, products, price_bands, and commission_rules are global admin-managed tables
> with NO tenant RLS.** Do NOT call `setTenantContext` in any admin route handler that
> touches only these tables. The `fxl_finders_app` runtime role has direct SELECT/INSERT/UPDATE
> grants on these tables (see Phase 01 T09); access is gated by asserting
> `publicMetadata.role === 'admin'` in the Hono admin middleware, not by RLS policies.
>
> **Admin DB connection:** Admin routes use the same `fxl_finders_app` DB role but apply
> no `set_config('app.current_org_id')` — these tables have no RLS. The shared `requireAdmin`
> guard (Phase 01/03 `apps/api/src/middleware/require-admin.ts`, consumed in T02) validates the
> admin role by reading `c.get('userRole')` (set by `clerkAuthMiddleware` from the verified
> JWT `publicMetadata.role` claim — NEVER via `clerkClient.users.getUser()`), then routes query
> the table directly.
>
> **The only place `setTenantContext` is relevant in this phase is if an admin route also
> touches `finders` or `leads` (tenant-scoped). None do in Phase 02 — call this out explicitly
> in every relevant route file.**

---

## New shadcn/ui components required for this phase

The following components are not yet installed in `apps/web/src/components/ui/`:
- `table` — data tables (apps list, products list, price bands list, commission rules list)
- `dialog` — create/edit/delete modals and key reveal modal
- `badge` — status badges (`active`, `disabled`, `archived`)
- `select` — form dropdowns (component type, basis type)
- `tabs` — product detail tabbed layout (price bands tab + commission tab)
- `alert-dialog` — destructive confirmations (delete actions)

Install via shadcn CLI before executing T01:
```bash
pnpm dlx shadcn@latest add table dialog badge select tabs alert-dialog --cwd apps/web
```

Verify components appear in `apps/web/src/components/ui/` before proceeding.

---

## Key generation scheme (locked decisions)

| Key type | Format | Storage |
|---|---|---|
| Publishable key | `pk_<32-char random hex>` | Stored in plaintext (`apps.publishable_key`) — safe to display anytime |
| Secret key | `sk_<32-char random hex>` | SHA-256 hashed (`apps.secret_key_hash`); prefix `sk_xxx` stored in `apps.secret_key_prefix`; plaintext shown ONCE on creation/rotation via reveal modal then NEVER again |
| Webhook signing secret | `whs_<32-char random hex>` | Stored in plaintext (`apps.webhook_signing_secret`) — needed for HMAC verification at runtime; shown once on rotation |

Key generation utility lives at `apps/api/src/domains/admin/apps/keys.ts`.
Generation uses `crypto.randomBytes(32).toString('hex')`.
SHA-256 via Node's built-in `crypto.createHash('sha256')`.

---

## Plan summary (7 plans across 3 waves)

| Plan | ID | Wave | Objective |
|---|---|---|---|
| P01 | `02-P01` | W1 | Install new shadcn/ui components + admin layout scaffold |
| P02 | `02-P02` | W1 | Admin backend — Hono router consuming shared `requireAdmin` guard + app key generation |
| P03 | `02-P03` | W2 | Admin backend — apps CRUD service + routes (`/api/v1/admin/apps`) |
| P04 | `02-P04` | W2 | Admin backend — products + price bands + commission rules service + routes |
| P05 | `02-P05` | W3 | Admin frontend — Apps list page + create/edit/status dialog |
| P06 | `02-P06` | W3 | Admin frontend — Products list + price bands + commission rules management |
| P07 | `02-P07` | W3 | Admin frontend — Key rotation UX (reveal-once modal + rotate flows) |

---

## Tasks

---

### T01 · Install shadcn/ui components + create admin section scaffold

**Plan:** `02-P01` — Wave 1
**Files:**
- `apps/web/src/components/ui/table.tsx` (new — shadcn generated)
- `apps/web/src/components/ui/dialog.tsx` (new — shadcn generated)
- `apps/web/src/components/ui/badge.tsx` (new — shadcn generated)
- `apps/web/src/components/ui/select.tsx` (new — shadcn generated)
- `apps/web/src/components/ui/tabs.tsx` (new — shadcn generated)
- `apps/web/src/components/ui/alert-dialog.tsx` (new — shadcn generated)
- `apps/web/src/admin/layout/AdminShell.tsx` (new)
- `apps/web/src/admin/layout/AdminNav.tsx` (new)
- `apps/web/src/router.tsx` (update — add `/admin/*` routes)

<read_first>
- `apps/web/src/router.tsx` — current routing structure + Protected wrapper pattern
- `apps/web/src/components/ui/kpi-card.tsx` — component pattern reference (named exports, no default)
- `apps/web/src/components/ui/empty-state.tsx` — component pattern reference
- `apps/web/src/components/layout/AppShell.tsx` — existing shell pattern to mirror for admin
- `CLAUDE.md` — named exports, no default exports, no class components, i18n required
</read_first>

<action>
1. Run `pnpm dlx shadcn@latest add table dialog badge select tabs alert-dialog --cwd apps/web` and verify each component file appears in `apps/web/src/components/ui/`.

2. Create `apps/web/src/admin/layout/AdminShell.tsx`:
   - Layout wrapper with sidebar nav for admin section
   - Named export `AdminShell`
   - Renders `<AdminNav />` + `<Outlet />` (React Router v6 layout pattern)
   - Uses `useTranslation()` for all labels

3. Create `apps/web/src/admin/layout/AdminNav.tsx`:
   - Named export `AdminNav`
   - Nav links: `t('admin.nav.apps')` → `/admin/apps`, `t('admin.nav.products')` → `/admin/products`, `t('admin.nav.finders')` → `/admin/finders`, `t('admin.nav.payouts')` → `/admin/payouts`, `t('admin.nav.audit')` → `/admin/audit`
   - Active link uses `NavLink` from `react-router-dom` with `className={({ isActive }) => ...}` pattern

4. Create `apps/web/src/admin/AdminGuard.tsx`:
   - Named export `AdminGuard`
   - Uses Clerk `useUser()` hook; reads `user.publicMetadata.role`
   - If `role !== 'admin'`: redirect to `/` with `<Navigate to="/" replace />`
   - If loading: return skeleton (1 `<Skeleton className="h-screen" />`)
   - If admin: render `<>{children}</>`

5. Update `apps/web/src/router.tsx`:
   - Add admin route group under `/admin`:
     ```
     { path: 'admin', element: <Protected><AdminGuard><AdminShell /></AdminGuard></Protected>,
       children: [
         { index: true, element: <Navigate to="/admin/apps" replace /> },
         { path: 'apps', element: <AdminAppsPage /> },
         { path: 'products', element: <AdminProductsPage /> },
         { path: 'finders', element: <div>TBD Phase 03</div> },
         { path: 'payouts', element: <div>TBD Phase 05</div> },
         { path: 'audit', element: <div>TBD Phase 05</div> },
       ]
     }
     ```
   - Import `AdminAppsPage` from `./admin/apps/AppsPage` and `AdminProductsPage` from `./admin/products/ProductsPage` (these pages are created in T05 and T06 — the router can reference them as lazy imports or stubs)
   - Autopilot decision: use `React.lazy` + `<Suspense>` for admin pages to keep initial bundle small

6. Add i18n keys to `apps/web/src/i18n/` PT-BR and EN locale files:
   - `admin.nav.apps`, `admin.nav.products`, `admin.nav.finders`, `admin.nav.payouts`, `admin.nav.audit`
   - PT-BR: "Apps", "Produtos", "Finders", "Pagamentos", "Auditoria"
</action>

<acceptance_criteria>
- [ ] All 6 shadcn components present in `apps/web/src/components/ui/` with valid TypeScript exports
- [ ] `apps/web/src/admin/layout/AdminShell.tsx` exports named `AdminShell`
- [ ] `apps/web/src/admin/layout/AdminNav.tsx` exports named `AdminNav` with all 5 nav links
- [ ] `apps/web/src/admin/AdminGuard.tsx` exports named `AdminGuard`; redirects non-admin to `/`
- [ ] Router has `/admin` route group with AdminShell as layout element
- [ ] `pnpm --filter @fxl-finders/web type-check` exits 0
- [ ] No default exports in any new file
- [ ] All user-facing strings wrapped in `t()` from `useTranslation()`
</acceptance_criteria>

---

### T02 · Admin Hono router + admin auth guard (consume shared `requireAdmin`)

**Plan:** `02-P02` — Wave 1 (parallel with T01)
**Files:**
- `apps/api/src/domains/admin/index.ts` (new — admin router mount point)
- `apps/api/src/server.ts` (update — mount admin router behind `clerkAuthMiddleware` + `requireAdmin`)

> **D-B (LOCKED — overrides any conflicting text in this PLAN):** There is exactly ONE admin auth mechanism.
> - Phase 01's `clerkAuthMiddleware` OWNS role extraction. It verifies the Clerk JWT and sets `c.set('userId')`, `c.set('orgId')`, **and** `c.set('userRole', payload.publicMetadata?.role)` — reading the role from the verified JWT claim ONLY. The Hono `ContextVariableMap` is augmented in Phase 01 with `userId: string`, `orgId: string`, `userRole: string | undefined`.
> - The ONLY admin guard is `apps/api/src/middleware/require-admin.ts` → `requireAdmin`, created in Phase 01/03, which reads `c.get('userRole') === 'admin'` and returns 403 otherwise. Phase 02 does **NOT** create its own guard.
> - **Phase 02 DELETES** the previously-planned `apps/api/src/middleware/adminAuth.ts`, the `adminAuthMiddleware` export, and the `isAdmin` context var. They no longer exist.
> - **NEVER** call `clerkClient.users.getUser()` (or any `users.getUser`) in a request path to read the role. The role comes from the verified JWT claim. This resolves the prior T02-action-vs-autopilot-decision-#8 contradiction decisively in favour of the JWT-claim path.
> - Depends on Phase 01 having configured the Clerk session-token custom claim that injects `publicMetadata.role` into the JWT (D-B). If that claim is absent, `userRole` is `undefined` → every admin request 403s. Treat this as a hard cross-phase dependency on Phase 01.

<read_first>
- `apps/api/src/middleware/auth.ts` — `clerkAuthMiddleware` (renamed from `authMiddleware`, alias kept) verifies the JWT and sets `c.get('userId')`, `c.get('orgId')`, `c.get('userRole')`; also exports `setTenantContext` (NOT used in admin routes)
- `apps/api/src/middleware/require-admin.ts` — `requireAdmin` guard (Phase 01/03) reading `c.get('userRole') === 'admin'`; if this file does not exist yet at execute time, create it per D-B (reads ONLY `c.get('userRole')`, never `users.getUser()`)
- `apps/api/src/server.ts` — how `healthRouter` is mounted; CORS + error middleware order
- `apps/api/src/routes/health.ts` — Hono router pattern (named export, `.route()` mount)
- `CLAUDE.md` — Hono domain pattern: `domains/{name}/routes.ts` + `service.ts`
- `docs/superpowers/specs/2026-05-28-fxl-finders-v1-design.md` § 5 — admin role gate via verified JWT claim
</read_first>

<action>
1. Do NOT create `apps/api/src/middleware/adminAuth.ts`. If a previous run created it, DELETE the file, the `adminAuthMiddleware` export, and any `isAdmin` entry in the `hono` `ContextVariableMap`. Phase 02 consumes the shared `requireAdmin` instead.

2. Verify `apps/api/src/middleware/require-admin.ts` exports `requireAdmin` (a `MiddlewareHandler`) that:
   - reads `c.get('userRole')` (set by `clerkAuthMiddleware` from the verified JWT `publicMetadata.role` claim)
   - returns `c.json({ error: 'forbidden', reason: 'admin_role_required' }, 403)` when `userRole !== 'admin'`
   - calls `next()` when `userRole === 'admin'`
   - performs ZERO network/SDK calls — specifically NO `clerkClient.users.getUser()`
   If the file is missing at execute time (Phase 01/03 not yet run), create it exactly as above. Do NOT duplicate JWT verification — that is `clerkAuthMiddleware`'s job.

3. Create `apps/api/src/domains/admin/index.ts`:
   - Named export `adminRouter` as a `new Hono()` instance
   - Apply both guards in order to all routes: `adminRouter.use('*', clerkAuthMiddleware)` then `adminRouter.use('*', requireAdmin)`
   - Sub-router mounts: `adminRouter.route('/apps', adminAppsRouter)` and `adminRouter.route('/products', adminProductsRouter)` (imported from their respective domain files, created in T04 and T05)

4. Update `apps/api/src/server.ts`:
   - Import `adminRouter` from `./domains/admin/index.js`
   - Mount: `app.route('/api/v1/admin', adminRouter)`
   - Mount order: after `corsMiddleware` + `errorMiddleware`, before `app.notFound`
   - DO NOT apply auth at app level for all routes — `clerkAuthMiddleware` + `requireAdmin` are applied by the admin router itself

5. Verify `CLERK_SECRET_KEY` is present in `apps/api/src/env.ts` (used by Phase 01's `clerkClient` singleton / JWT verification). Do NOT instantiate a separate Clerk client in admin middleware — admin auth makes no Clerk API calls.
</action>

<acceptance_criteria>
- [ ] `apps/api/src/middleware/adminAuth.ts` does NOT exist (deleted/never created); no `adminAuthMiddleware` export anywhere; no `isAdmin` key in `ContextVariableMap`
- [ ] `apps/api/src/domains/admin/index.ts` exports named `adminRouter`
- [ ] `adminRouter` applies `clerkAuthMiddleware` then `requireAdmin` on `'*'` — all admin routes behind both guards
- [ ] `requireAdmin` returns 403 for non-admin users based solely on `c.get('userRole')` (verified JWT claim)
- [ ] `grep -rn 'users.getUser' apps/api/src/domains/admin apps/api/src/middleware/require-admin.ts` returns 0 results (role NEVER read via Clerk API in a request path)
- [ ] `/api/v1/admin` mounted in `server.ts`
- [ ] `pnpm --filter @fxl-finders/api type-check` exits 0
- [ ] No `any` types; no `setTenantContext` call (admin tables have no RLS)
</acceptance_criteria>

---

### T03 · Key generation utilities

**Plan:** `02-P02` — Wave 1 (same plan as T02)
**Files:**
- `apps/api/src/domains/admin/apps/keys.ts` (new)
- `apps/api/src/domains/admin/apps/__tests__/keys.test.ts` (new — TDD)

<read_first>
- `apps/api/src/db/schema.ts` — `apps` table shape: `publishableKey`, `secretKeyHash`, `secretKeyPrefix`, `webhookSigningSecret` column names
- `docs/superpowers/specs/2026-05-28-fxl-finders-v1-design.md` § 4 `apps` table — key format spec
- `CLAUDE.md` — named exports; strict TypeScript; no `any`
</read_first>

<action>
Create `apps/api/src/domains/admin/apps/keys.ts` with these named exports:

```
generatePublishableKey(): string
  → 'pk_' + crypto.randomBytes(32).toString('hex')

generateSecretKeyPair(): { plaintext: string; hash: string; prefix: string }
  → plaintext = 'sk_' + crypto.randomBytes(32).toString('hex')
  → hash = sha256(plaintext) as hex string using crypto.createHash('sha256')
  → prefix = plaintext.slice(0, 8) + 'xxx'   // e.g. 'sk_a1b2cxxx'

generateWebhookSigningSecret(): string
  → 'whs_' + crypto.randomBytes(32).toString('hex')
```

All three use Node's built-in `crypto` module only (no third-party dependency).

Create `apps/api/src/domains/admin/apps/__tests__/keys.test.ts` with Vitest unit tests:
- `generatePublishableKey()` returns string starting with `'pk_'` and length 67 (3 + 64)
- `generateSecretKeyPair()` returns `{ plaintext, hash, prefix }` where:
  - `plaintext` starts with `'sk_'`
  - `hash` is a 64-char hex string (SHA-256)
  - `hash === sha256(plaintext)` (verify round-trip with `crypto.createHash`)
  - `prefix` starts with `'sk_'` and ends with `'xxx'`
- `generateWebhookSigningSecret()` returns string starting with `'whs_'` and length 68 (4 + 64)
- All three return different values on repeated calls (non-deterministic test: call twice, assert `!==`)
</action>

<acceptance_criteria>
- [ ] `apps/api/src/domains/admin/apps/keys.ts` exports 3 named functions
- [ ] All key generators use `crypto.randomBytes` (Node built-in, no third-party)
- [ ] SHA-256 hash computed with `crypto.createHash('sha256')`
- [ ] Unit tests in `__tests__/keys.test.ts` — all 7 assertions listed above present
- [ ] `pnpm --filter @fxl-finders/api test` (unit project) passes including `keys.test.ts`
- [ ] `pnpm --filter @fxl-finders/api type-check` exits 0
</acceptance_criteria>

---

### T04 · Admin backend — Apps CRUD service + routes

**Plan:** `02-P03` — Wave 2 (after T02 + T03)
**Files:**
- `apps/api/src/domains/admin/apps/service.ts` (new)
- `apps/api/src/domains/admin/apps/routes.ts` (new)
- `apps/api/src/domains/admin/apps/__tests__/app-schema.test.ts` (new — TDD, slug immutability + hostname validation)

<read_first>
- `apps/api/src/db/schema.ts` — `apps` table (all column names for Drizzle queries)
- `apps/api/src/middleware/require-admin.ts` + `apps/api/src/middleware/auth.ts` — admin guard `requireAdmin` and the `c.get('userId')` / `c.get('userRole')` context vars set by `clerkAuthMiddleware`
- `apps/api/src/domains/admin/apps/keys.ts` — key generation functions
- `apps/api/src/middleware/auth.ts` — `setTenantContext` (NOT used here — admin tables have no RLS)
- `docs/superpowers/specs/2026-05-28-fxl-finders-v1-design.md` § 4 `apps` table — field names + constraints
- `CLAUDE.md` — Hono domain pattern, Zod schemas in service.ts
</read_first>

<action>
Create `apps/api/src/domains/admin/apps/service.ts`:

Zod schemas (named exports):
- A reusable hostname rule (NOT `z.string().url()`): `const hostnameSchema = z.string().min(1).max(253).regex(/^(?=.{1,253}$)(?!-)[a-z0-9-]{1,63}(?<!-)(\.(?!-)[a-z0-9-]{1,63}(?<!-))+$/i, { message: 'must be a bare hostname (e.g. checkout.fxlfinanciero.com.br), not a URL' })`. This rejects scheme/path/port/query — only a bare host passes.
- `CreateAppSchema`: `{ slug: z.string().min(1).max(64), name: z.string().min(1), allowedRedirectHosts: z.array(hostnameSchema).min(1), attributionWindowDays: z.number().int().positive().default(30), commissionHoldDays: z.number().int().positive().default(30) }`

  > **WARN (LOCKED):** `allowed_redirect_hosts` stores BARE HOSTNAMES (e.g. `checkout.fxlfinanciero.com.br`), NOT full URLs. Do NOT use `z.string().url()` — it would accept `https://host/path?x=1`, defeating the security check. Phase 04 builds the redirect URL from `https://<first_allowed_host>/...` and MUST compare the redirect target host against this list by EXACT host equality (no substring/prefix match). Carry this constraint into Phase 04 (it owns the redirect resolution + host-equality check).
- `UpdateAppSchema`: `CreateAppSchema.omit({ slug: true }).partial()` — slug is immutable (cannot be supplied on update at all). (D-R NIT)
- `AppIdSchema`: `z.object({ id: z.string().uuid() })`

Service functions (named exports, all return typed results):
- `listApps(db)` — `SELECT * FROM apps ORDER BY created_at DESC` — returns array; never uses `setTenantContext`
- `getApp(db, id)` — `SELECT * FROM apps WHERE id = $1`
- `createApp(db, data, createdByUserId)`:
  - Generate `publishableKey` via `generatePublishableKey()`
  - Generate secret via `generateSecretKeyPair()`
  - Generate `webhookSigningSecret` via `generateWebhookSigningSecret()`
  - INSERT into `apps` with all fields, setting `created_by_user_id = createdByUserId`
  - Write an `audit_log` entry `{ action: 'app.created', actor_user_id: createdByUserId, target: appId }` (see audit note below)
  - Return `{ app: AppRow, secretKeyPlaintext: string, webhookSigningSecretPlaintext: string }` — plaintext returned ONLY on creation, never again
- `updateApp(db, id, data)` — UPDATE `apps` by id; `data` comes from `UpdateAppSchema` which OMITS `slug`, so slug can never be changed (no slug key is present in the payload to apply)
- `rotateSecretKey(db, id, actorUserId)`:
  - Generate new secret pair
  - UPDATE `apps SET secret_key_hash = $hash, secret_key_prefix = $prefix WHERE id = $id`
  - Write an `audit_log` entry `{ action: 'app.rotate_secret_key', actor_user_id, target: id }` (see audit note below)
  - Return `{ secretKeyPlaintext: string }` — plaintext returned ONLY on rotation
- `rotateWebhookSigningSecret(db, id, actorUserId)`:
  - Generate new `webhookSigningSecret`
  - UPDATE `apps SET webhook_signing_secret = $secret WHERE id = $id`
  - Write an `audit_log` entry `{ action: 'app.rotate_webhook_secret', actor_user_id, target: id }` (see audit note below)
  - Return `{ webhookSigningSecretPlaintext: string }`
- `setAppStatus(db, id, status: 'active' | 'disabled', actorUserId)` — UPDATE status field; write an `audit_log` entry `{ action: 'app.set_status', actor_user_id, target: id, meta: { status } }` (see audit note below)

> **WARN — audit logging (LOCKED):** `createApp`, `rotateSecretKey`, `rotateWebhookSigningSecret`, and `setAppStatus` are security-sensitive admin mutations and SHOULD record an `audit_log` row. **v1.0 decision (D-R defer):** the tamper-evident hash-chain (`prev_hash`/`entry_hash`, `writeAuditEntry`) is implemented in Phase 05. For Phase 02, write a PLAIN `audit_log` row per mutation (action + `actor_user_id = c.get('userId')` + target appId + minimal meta) WITHOUT the hash-chain fields, and add a code comment `// TODO(Phase 05): route through writeAuditEntry hash-chain (D-R)`. Phase 05's hash-chain task backfills/wraps these. If `audit_log` does not yet exist at execute time (Phase 01 not run), this step is the explicit deferral: leave the `// TODO(Phase 05)` comment and skip the insert — do NOT block the phase. The `actor_user_id` MUST come from the verified JWT (`c.get('userId')`), never from the request body.

Create `apps/api/src/domains/admin/apps/routes.ts`:

Named export `adminAppsRouter` as `new Hono()`. All routes are already behind `clerkAuthMiddleware` + `requireAdmin` (inherited from the parent `adminRouter` mount in T02) — do NOT re-apply or duplicate auth here.

Endpoints:
- `GET /` → `listApps(db)` → 200 + `{ apps: AppRow[] }`
- `GET /:id` → `getApp(db, id)` → 200 + `{ app: AppRow }` or 404
- `POST /` → parse `CreateAppSchema`, call `createApp(db, data, c.get('userId'))` → 201 + `{ app, secretKeyPlaintext, webhookSigningSecretPlaintext }` (the ONLY time plaintexts are returned)
- `PATCH /:id` → parse `UpdateAppSchema`, call `updateApp(db, id, data)` → 200 + `{ app: AppRow }`
- `POST /:id/rotate-secret-key` → call `rotateSecretKey(db, id, c.get('userId'))` → 200 + `{ secretKeyPlaintext }`
- `POST /:id/rotate-webhook-secret` → call `rotateWebhookSigningSecret(db, id, c.get('userId'))` → 200 + `{ webhookSigningSecretPlaintext }`
- `PATCH /:id/status` → parse `z.object({ status: z.enum(['active', 'disabled']) })`, call `setAppStatus(db, id, status, c.get('userId'))` → 200 + `{ app: AppRow }`

Error handling: 404 if app not found; 409 if slug already exists (catch unique constraint); 400 for Zod parse failures.

Create `apps/api/src/domains/admin/apps/__tests__/app-schema.test.ts` (Vitest unit project — pure `.safeParse` tests, no DB) — **WARN/TDD (LOCKED):**
- Slug immutability: `UpdateAppSchema` does NOT carry a `slug` key — parsing `{ slug: 'changed' }` STRIPS slug (Zod default behavior with omitted key) so an update can never mutate slug; assert `UpdateAppSchema.parse({ slug: 'x', name: 'y' })` has NO `slug` property in the result. Optionally, if a `.strict()` variant is used, assert it REJECTS an extra `slug` key. Either way the test proves slug cannot flow through an update.
- Hostname validation: `CreateAppSchema` ACCEPTS `allowedRedirectHosts: ['checkout.fxlfinanciero.com.br']`; REJECTS `['https://checkout.fxlfinanciero.com.br']` (scheme), `['host.com/path']` (path), `['host.com:443']` (port), and `[]` (empty — `.min(1)`).
</action>

<acceptance_criteria>
- [ ] `listApps`, `getApp`, `createApp`, `updateApp`, `rotateSecretKey`, `rotateWebhookSigningSecret`, `setAppStatus` all exported from `service.ts`
- [ ] `allowedRedirectHosts` is validated by the bare-hostname rule (NOT `z.string().url()`); a value containing a scheme/path/port (e.g. `https://host/x`) is REJECTED, and a bare host (e.g. `checkout.fxlfinanciero.com.br`) is ACCEPTED
- [ ] `UpdateAppSchema === CreateAppSchema.omit({ slug: true }).partial()` — slug cannot be supplied on update
- [ ] `__tests__/app-schema.test.ts` exists and asserts (a) slug-immutability via `UpdateAppSchema` and (b) the hostname accept/reject matrix; `pnpm --filter @fxl-finders/api test` passes including this file
- [ ] `createApp` returns `{ app, secretKeyPlaintext, webhookSigningSecretPlaintext }` — plaintext keys included; sets `created_by_user_id`
- [ ] `rotateSecretKey` returns `{ secretKeyPlaintext }` — only the new plaintext
- [ ] `createApp`, `rotateSecretKey`, `rotateWebhookSigningSecret`, `setAppStatus` each write a plain `audit_log` row (action + `actor_user_id` from JWT) OR carry the explicit `// TODO(Phase 05): writeAuditEntry hash-chain (D-R)` deferral comment if `audit_log` is not present at execute time
- [ ] `secret_key_hash` is SHA-256 of plaintext (never store plaintext in DB)
- [ ] `webhook_signing_secret` is stored plaintext (needed for HMAC at runtime)
- [ ] No `setTenantContext` call anywhere in service or routes (admin-only tables)
- [ ] All endpoints present in `adminAppsRouter`
- [ ] `POST /:id/rotate-secret-key` returns 200 + `{ secretKeyPlaintext }` (not the hash)
- [ ] `pnpm --filter @fxl-finders/api type-check` exits 0
</acceptance_criteria>

---

### T05 · Admin backend — products, price bands, commission rules service + routes

**Plan:** `02-P04` — Wave 2 (parallel with T04)
**Files:**
- `apps/api/src/domains/admin/products/service.ts` (new)
- `apps/api/src/domains/admin/products/routes.ts` (new)
- `apps/api/src/domains/admin/products/__tests__/schemas.test.ts` (new — TDD, price-band boundary cases)
- `apps/api/src/domains/admin/index.ts` (update — mount products router)

<read_first>
- `apps/api/src/db/schema.ts` — `products`, `priceBands`, `commissionRules` tables (column names, FK constraints, unique indexes)
- `apps/api/src/domains/admin/apps/service.ts` — established service pattern to mirror (Zod schemas + Drizzle queries)
- `docs/superpowers/specs/2026-05-28-fxl-finders-v1-design.md` § 4 — products, price_bands, commission_rules schemas; money = int cents; rates = numeric(5,2)
- `CLAUDE.md` — Hono domain pattern
</read_first>

<action>
Create `apps/api/src/domains/admin/products/service.ts`:

Zod schemas:
- `CreateProductSchema`: `{ appId: z.string().uuid(), slug: z.string().min(1).max(64), name: z.string().min(1), description: z.string().optional(), status: z.enum(['active', 'archived']).default('active') }`
- `UpdateProductSchema`: `CreateProductSchema.omit({ appId: true }).partial()` (appId immutable)
- `UpsertPriceBandSchema`: `{ component: z.enum(['setup', 'monthly']), minBrl: z.number().int().nonnegative(), listBrl: z.number().int().nonnegative(), maxBrl: z.number().int().nonnegative() }` with `.refine(data => data.minBrl <= data.listBrl && data.listBrl <= data.maxBrl, { message: 'min <= list <= max required' })`
- `UpsertCommissionRuleSchema`: `{ setupRatePct: z.number().min(0).max(100), recurringRatePct: z.number().min(0).max(100), recurringMonths: z.number().int().nonnegative(), basis: z.enum(['quoted_net', 'list_net']).default('quoted_net') }`

Service functions:
- `listProducts(db, appId?)` — list all products, optionally filtered by `appId`; JOIN with `apps` to include `apps.name` and `apps.slug` in response
- `getProduct(db, id)` — single product with price bands and commission rule (3-way join or sequential queries)
- `createProduct(db, data)` — INSERT into `products`
- `updateProduct(db, id, data)` — UPDATE `products`
- `upsertPriceBand(db, productId, data: UpsertPriceBandSchema)`:
  - INSERT INTO `price_bands` with `ON CONFLICT (product_id, component) DO UPDATE SET min_brl = EXCLUDED.min_brl, list_brl = EXCLUDED.list_brl, max_brl = EXCLUDED.max_brl, updated_at = now()`
  - Drizzle `onConflictDoUpdate` builder
- `upsertCommissionRule(db, productId, data)`:
  - INSERT INTO `commission_rules` with `ON CONFLICT (product_id) DO UPDATE SET ...`
- `listPriceBands(db, productId)` — SELECT * FROM price_bands WHERE product_id = $1
- `getCommissionRule(db, productId)` — SELECT * FROM commission_rules WHERE product_id = $1

Create `apps/api/src/domains/admin/products/routes.ts`:

Named export `adminProductsRouter`. Endpoints:
- `GET /` → `listProducts(db)` with optional `?appId=<uuid>` query param → 200 + `{ products }`
- `GET /:id` → `getProduct(db, id)` → 200 + `{ product, priceBands, commissionRule }` or 404
- `POST /` → parse `CreateProductSchema`, call `createProduct` → 201 + `{ product }`
- `PATCH /:id` → parse `UpdateProductSchema`, call `updateProduct` → 200 + `{ product }`
- `PUT /:id/price-bands/:component` → parse `UpsertPriceBandSchema`, call `upsertPriceBand` → 200 + `{ priceBand }`
- `GET /:id/price-bands` → `listPriceBands(db, id)` → 200 + `{ priceBands }`
- `PUT /:id/commission-rule` → parse `UpsertCommissionRuleSchema`, call `upsertCommissionRule` → 200 + `{ commissionRule }`
- `GET /:id/commission-rule` → `getCommissionRule(db, id)` → 200 + `{ commissionRule }` or 404

Update `apps/api/src/domains/admin/index.ts`:
- Add `adminRouter.route('/products', adminProductsRouter)`

Create `apps/api/src/domains/admin/products/__tests__/schemas.test.ts` (Vitest unit project — pure schema `.safeParse` tests, no DB) — **WARN/TDD (LOCKED): cover the price-band boundary cases explicitly:**
- `UpsertPriceBandSchema` ACCEPTS `min < list < max` (e.g. `{ component: 'setup', minBrl: 80000, listBrl: 100000, maxBrl: 150000 }`)
- ACCEPTS the equality boundaries: `min === list === max` (all equal), `min === list < max`, `min < list === max`
- REJECTS `min > list` (e.g. `min: 100, list: 50, max: 200`) with the `'min <= list <= max required'` message
- REJECTS `list > max` (e.g. `min: 0, list: 200, max: 100`)
- REJECTS a negative value (`minBrl: -1` fails `nonnegative`)
- `UpsertCommissionRuleSchema` REJECTS `setupRatePct: 101` and `recurringRatePct: -1` (out of `0..100`)
</action>

<acceptance_criteria>
- [ ] `listProducts`, `getProduct`, `createProduct`, `updateProduct`, `upsertPriceBand`, `upsertCommissionRule`, `listPriceBands`, `getCommissionRule` all exported from `service.ts`
- [ ] `upsertPriceBand` uses Drizzle `onConflictDoUpdate` (not separate select + insert)
- [ ] `UpsertPriceBandSchema` has `.refine` for `min <= list <= max`
- [ ] `__tests__/schemas.test.ts` exists and asserts the price-band boundary matrix: accepts `min<list<max`, accepts the three equality boundaries, rejects `min>list`, rejects `list>max`, rejects negatives; plus commission-rate out-of-range rejections
- [ ] `pnpm --filter @fxl-finders/api test` passes including `schemas.test.ts`
- [ ] Price band money columns flow through as `int` (cents) — no conversion to `float` in service
- [ ] Rate columns (`setupRatePct`, `recurringRatePct`) are validated as `z.number().min(0).max(100)`
- [ ] All 8 routes present in `adminProductsRouter`
- [ ] No `setTenantContext` call (admin-only tables)
- [ ] `adminProductsRouter` mounted in `domains/admin/index.ts`
- [ ] `pnpm --filter @fxl-finders/api type-check` exits 0
</acceptance_criteria>

---

### T06 · Admin frontend — Apps list page + create/edit dialog

**Plan:** `02-P05` — Wave 3 (after T04 which delivers the API)
**Files:**
- `apps/web/src/admin/apps/AppsPage.tsx` (new)
- `apps/web/src/admin/apps/AppDialog.tsx` (new)
- `apps/web/src/admin/apps/useApps.ts` (new — TanStack Query hooks)
- `apps/web/src/lib/api-client.ts` (update — fix default port + add admin apps API calls)

> **D-J (LOCKED — overrides any bare-fetch text below):** ALL frontend admin calls go through the
> existing `apiFetch(path, { method, token, body })` helper in `apps/web/src/lib/api-client.ts`,
> which prepends `VITE_API_URL` and attaches the `Authorization: Bearer <token>` header.
> - NO bare relative `fetch('/api/...')`. NO `apiClient.get(...)` style.
> - Every authed call receives the Clerk token via `useAuth().getToken()` passed in as `{ token }`.
> - FIX `api-client.ts`: change the `VITE_API_URL` fallback default from `http://localhost:3000`
>   to `http://localhost:3006` (the API port). Apply this fix once here in T06.

<read_first>
- `apps/web/src/lib/api-client.ts` — existing `apiFetch(path, { method, token, body })` signature + `VITE_API_URL` base + current default-port value (to fix 3000→3006)
- `apps/web/src/components/ui/table.tsx` — table component API (installed in T01)
- `apps/web/src/components/ui/dialog.tsx` — dialog component API
- `apps/web/src/components/ui/badge.tsx` — badge component API
- `apps/web/src/components/ui/empty-state.tsx` — EmptyState props and usage
- `apps/web/src/components/ui/skeleton.tsx` — Skeleton component
- `apps/web/src/components/ui/kpi-card.tsx` — KPICard props (reference pattern)
- `CLAUDE.md` — loading state rules; query invalidation; named exports; no default; `useTranslation()`
- `apps/api/src/domains/admin/apps/routes.ts` — exact request/response shapes (read in T04)
</read_first>

<action>
0. Fix `apps/web/src/lib/api-client.ts`: change the `VITE_API_URL` fallback default `http://localhost:3000` → `http://localhost:3006`. Do NOT change the `apiFetch(path, { method, token, body })` signature.

Add admin apps API calls in `apps/web/src/lib/api-client.ts` using `apiFetch` (NEVER bare `fetch`, NEVER `apiClient.get`). Every call takes a `token: string` argument (the Clerk token) which the page/hook obtains via `useAuth().getToken()`:
```
adminAppsApi = {
  list: (token) => apiFetch('/api/v1/admin/apps', { method: 'GET', token }),
  get: (id, token) => apiFetch(`/api/v1/admin/apps/${id}`, { method: 'GET', token }),
  create: (data, token) => apiFetch('/api/v1/admin/apps', { method: 'POST', token, body: data }),
  update: (id, data, token) => apiFetch(`/api/v1/admin/apps/${id}`, { method: 'PATCH', token, body: data }),
  setStatus: (id, status, token) => apiFetch(`/api/v1/admin/apps/${id}/status`, { method: 'PATCH', token, body: { status } }),
  rotateSecretKey: (id, token) => apiFetch(`/api/v1/admin/apps/${id}/rotate-secret-key`, { method: 'POST', token }),
  rotateWebhookSecret: (id, token) => apiFetch(`/api/v1/admin/apps/${id}/rotate-webhook-secret`, { method: 'POST', token }),
}
```
`apiFetch` already prepends `VITE_API_URL` and sets the `Authorization: Bearer ${token}` header — do not re-implement either.

Create `apps/web/src/admin/apps/useApps.ts` with TanStack Query hooks. Each hook calls `useAuth().getToken()` and threads the token into the `adminAppsApi` call:
- `useAdminApps()` — `const { getToken } = useAuth();` `useQuery({ queryKey: ['admin', 'apps'], queryFn: async () => adminAppsApi.list(await getToken() ?? ''), select: (d) => Array.isArray(d.apps) ? d.apps : [] })`
- `useCreateApp()` — `useMutation({ mutationFn: async (data) => adminAppsApi.create(data, await getToken() ?? ''), onSuccess: () => queryClient.invalidateQueries({ queryKey: ['admin', 'apps'] }) })`
- `useUpdateApp()` — `useMutation` (token via `getToken()`) with `invalidateQueries(['admin', 'apps'])` + `(['admin', 'apps', id])`
- `useSetAppStatus()` — `useMutation` (token via `getToken()`) with same invalidation
- `useRotateSecretKey()` — `useMutation` (token via `getToken()`); does NOT invalidate apps list (returns plaintext; caller handles reveal modal)
- `useRotateWebhookSecret()` — same as above

Create `apps/web/src/admin/apps/AppDialog.tsx`:
- Named export `AppDialog`
- Props: `{ open: boolean; onOpenChange: (open: boolean) => void; app?: AppRow }` (app=undefined → create mode; app=defined → edit mode)
- Fields: `slug` (disabled in edit mode; in edit mode the slug is NOT sent — `UpdateAppSchema` omits it), `name`, `allowedRedirectHosts` (textarea, newline-separated BARE HOSTNAMES e.g. `checkout.fxlfinanciero.com.br` — NOT URLs; placeholder/help text must say "um host por linha, sem https:// nem caminho"; parsed to array on submit), `attributionWindowDays` (number input), `commissionHoldDays` (number input)
- Uses `useCreateApp()` or `useUpdateApp()` depending on mode
- On success: close dialog + show toast `t('admin.apps.created')` / `t('admin.apps.updated')`
- All labels via `t()`; status display via `<Badge>` component

Create `apps/web/src/admin/apps/AppsPage.tsx`:
- Named export `AppsPage`
- Uses `useAdminApps()` for data fetching
- Loading: `<Skeleton className="h-8 w-full" />` × 5 rows in a table shape
- Empty state: `<EmptyState title={t('admin.apps.empty')} description={t('admin.apps.emptyDesc')} action={<Button onClick={() => setDialogOpen(true)}>{t('admin.apps.create')}</Button>} />`
- Content: `<Table>` with columns: Name, Slug, Publishable Key (full text — safe to display), Secret Key (show prefix only e.g. `sk_a1b2cxxx`), Status (Badge), Actions (Edit button, Status toggle button, Rotate keys button)
- "Rotate secret key" → opens `KeyRevealModal` (created in T07)
- "Create app" button → opens `AppDialog` in create mode
- Row click or Edit button → opens `AppDialog` in edit mode
</action>

<acceptance_criteria>
- [ ] `useAdminApps()`, `useCreateApp()`, `useUpdateApp()`, `useSetAppStatus()`, `useRotateSecretKey()`, `useRotateWebhookSecret()` all exported from `useApps.ts`
- [ ] `api-client.ts` `VITE_API_URL` fallback default is `http://localhost:3006` (NOT 3000)
- [ ] All admin API calls go through `apiFetch(path, { method, token, body })` — `grep -rn "fetch('/api" apps/web/src/admin apps/web/src/lib/api-client.ts` returns 0 bare relative fetches; no `apiClient.get` usage
- [ ] Every authed call passes a Clerk token obtained via `useAuth().getToken()`
- [ ] Every mutation hook calls `queryClient.invalidateQueries()` on success (never `resetQueries`)
- [ ] `select: (d) => Array.isArray(d.apps) ? d.apps : []` on `useAdminApps` query
- [ ] `AppsPage` shows skeleton when `isLoading`, empty state when `!isLoading && data.length === 0`, table when `!isLoading && data.length > 0`
- [ ] Secret key column renders `secretKeyPrefix` (e.g. `sk_a1b2cxxx`), never the full key
- [ ] All user-facing strings via `t()`
- [ ] Named exports only; no default exports
- [ ] `pnpm --filter @fxl-finders/web type-check` exits 0
</acceptance_criteria>

---

### T07 · Admin frontend — Products list + price bands + commission rules management

**Plan:** `02-P06` — Wave 3 (parallel with T06)
**Files:**
- `apps/web/src/admin/products/ProductsPage.tsx` (new)
- `apps/web/src/admin/products/ProductDialog.tsx` (new)
- `apps/web/src/admin/products/ProductDetail.tsx` (new — tabbed view with price bands + commission)
- `apps/web/src/admin/products/PriceBandForm.tsx` (new)
- `apps/web/src/admin/products/CommissionRuleForm.tsx` (new)
- `apps/web/src/admin/products/useProducts.ts` (new — TanStack Query hooks)
- `apps/web/src/lib/api-client.ts` (update — add admin products API calls)

<read_first>
- `apps/web/src/components/ui/tabs.tsx` — Tabs component API (installed in T01)
- `apps/web/src/components/ui/table.tsx` — Table component (installed in T01)
- `apps/web/src/components/ui/dialog.tsx` — Dialog component (installed in T01)
- `apps/web/src/components/ui/select.tsx` — Select component (installed in T01)
- `apps/web/src/admin/apps/useApps.ts` — established hook pattern to mirror
- `apps/api/src/domains/admin/products/routes.ts` — exact request/response shapes
- `CLAUDE.md` — loading state rules; money display (int cents → R$ display); `useTranslation()`
- `docs/superpowers/specs/2026-05-28-fxl-finders-v1-design.md` § 4 products/price_bands/commission_rules
</read_first>

> **D-J (LOCKED):** Same rule as T06 — admin products calls use `apiFetch(path, { method, token, body })`
> against `VITE_API_URL`. NO bare relative `fetch`, NO `apiClient.get`. Token from `useAuth().getToken()`.

<action>
Update `apps/web/src/lib/api-client.ts` with admin products API calls using `apiFetch` (NEVER bare `fetch`). Each call takes a Clerk `token`:
```
adminProductsApi = {
  list: (appId, token) => apiFetch(`/api/v1/admin/products${appId ? `?appId=${appId}` : ''}`, { method: 'GET', token }),
  get: (id, token) => apiFetch(`/api/v1/admin/products/${id}`, { method: 'GET', token }),
  create: (data, token) => apiFetch('/api/v1/admin/products', { method: 'POST', token, body: data }),
  update: (id, data, token) => apiFetch(`/api/v1/admin/products/${id}`, { method: 'PATCH', token, body: data }),
  upsertPriceBand: (id, component, data, token) => apiFetch(`/api/v1/admin/products/${id}/price-bands/${component}`, { method: 'PUT', token, body: data }),
  upsertCommissionRule: (id, data, token) => apiFetch(`/api/v1/admin/products/${id}/commission-rule`, { method: 'PUT', token, body: data }),
}
```

Create `apps/web/src/admin/products/useProducts.ts` (each hook resolves the token via `useAuth().getToken()` and threads it into the `adminProductsApi` call):
- `useAdminProducts(appId?)` — query `['admin', 'products', appId]`
- `useAdminProduct(id)` — query `['admin', 'products', id]`
- `useCreateProduct()` — invalidates `['admin', 'products']`
- `useUpdateProduct()` — invalidates `['admin', 'products']` + `['admin', 'products', id]`
- `useUpsertPriceBand(productId)` — invalidates `['admin', 'products', productId]`
- `useUpsertCommissionRule(productId)` — invalidates `['admin', 'products', productId]`

Create `apps/web/src/admin/products/PriceBandForm.tsx`:
- Named export `PriceBandForm`
- Props: `{ productId: string; component: 'setup' | 'monthly'; initialData?: PriceBand }`
- Fields: `minBrl` (labeled `t('admin.products.priceBand.min')`), `listBrl`, `maxBrl` — all displayed as R$ but stored/submitted as int cents (conversion: display value × 100 on submit, ÷ 100 on load)
- Validation: real-time `min <= list <= max` client-side check; disable submit if invalid
- Uses `useUpsertPriceBand(productId)` mutation
- On success: show toast `t('admin.products.priceBand.saved')`

Create `apps/web/src/admin/products/CommissionRuleForm.tsx`:
- Named export `CommissionRuleForm`
- Props: `{ productId: string; initialData?: CommissionRule }`
- Fields: `setupRatePct` (%), `recurringRatePct` (%), `recurringMonths` (int, 0 = setup-only, 999 = lifetime), `basis` (`<Select>` with options 'quoted_net' | 'list_net')
- Uses `useUpsertCommissionRule(productId)` mutation

Create `apps/web/src/admin/products/ProductDetail.tsx`:
- Named export `ProductDetail`
- Props: `{ productId: string }`
- Uses `useAdminProduct(productId)` for data
- Loading: Skeleton rows; Empty: error state
- `<Tabs>` with two tabs: "Faixas de Preço" (`t('admin.products.tabs.priceBands')`) and "Comissão" (`t('admin.products.tabs.commission')`)
- Price bands tab: two `<PriceBandForm>` cards (setup + monthly) side by side
- Commission tab: one `<CommissionRuleForm>`

Create `apps/web/src/admin/products/ProductDialog.tsx`:
- Named export `ProductDialog`
- Props: `{ open: boolean; onOpenChange: (open: boolean) => void; product?: ProductRow }`
- Fields: `appId` (`<Select>` populated from `useAdminApps()`), `slug`, `name`, `description`, `status` (in edit mode only — `<Select>` active/archived)
- Uses `useCreateProduct()` or `useUpdateProduct()`

Create `apps/web/src/admin/products/ProductsPage.tsx`:
- Named export `ProductsPage`
- Uses `useAdminProducts()` + optionally filter by `appId` via URL search param or select dropdown
- Loading/empty/content states per CLAUDE.md
- `<Table>` columns: Name, Slug, App, Status (`<Badge>`), Actions (Edit button, View/manage button → `/admin/products/:id`)
- "Create product" button → opens `ProductDialog`
- Row "Manage" button → navigate to `/admin/products/:id` which renders `ProductDetail`
- Router update: add `{ path: 'products/:id', element: <ProductDetailPage /> }` under admin routes
</action>

<acceptance_criteria>
- [ ] `useAdminProducts`, `useAdminProduct`, `useCreateProduct`, `useUpdateProduct`, `useUpsertPriceBand`, `useUpsertCommissionRule` all exported from `useProducts.ts`
- [ ] All admin products calls go through `apiFetch(path, { method, token, body })` (no bare `fetch('/api...`, no `apiClient.get`); token from `useAuth().getToken()`
- [ ] `PriceBandForm` converts R$ display values ÷/× 100 when loading/submitting cents
- [ ] `PriceBandForm` client-side validates `min <= list <= max` and disables submit when invalid
- [ ] `CommissionRuleForm` has `<Select>` for `basis` field with both options
- [ ] `ProductDetail` uses `<Tabs>` with exactly two tabs: price bands + commission
- [ ] `ProductsPage` shows skeleton/empty/content per CLAUDE.md loading rules
- [ ] Every mutation hook calls `invalidateQueries()` on success
- [ ] Money values stored/transmitted as int cents; displayed as R$ (format: `(cents / 100).toFixed(2)`)
- [ ] All user-facing strings via `t()`; PT-BR labels for fields and tabs
- [ ] `pnpm --filter @fxl-finders/web type-check` exits 0
</acceptance_criteria>

---

### T08 · Admin frontend — Key rotation UX (reveal-once modal)

**Plan:** `02-P07` — Wave 3 (parallel with T06 + T07)
**Files:**
- `apps/web/src/admin/apps/KeyRevealModal.tsx` (new)
- `apps/web/src/admin/apps/AppsPage.tsx` (update — wire rotate buttons to modal)
- `apps/web/src/i18n/` (update — add key rotation i18n strings)

<read_first>
- `apps/web/src/components/ui/dialog.tsx` — Dialog component API
- `apps/web/src/components/ui/alert-dialog.tsx` — AlertDialog for destructive confirmations
- `apps/web/src/components/ui/input.tsx` — Input component (for copy-to-clipboard field)
- `apps/web/src/admin/apps/useApps.ts` — `useRotateSecretKey()` + `useRotateWebhookSecret()` hooks
- `apps/web/src/admin/apps/AppsPage.tsx` — rotate buttons location (wired in T06)
- `CLAUDE.md` — loading state rules; named exports; `useTranslation()`
- `docs/superpowers/specs/2026-05-28-fxl-finders-v1-design.md` § 4 apps table — secret key pattern
</read_first>

<action>
Create `apps/web/src/admin/apps/KeyRevealModal.tsx`:
- Named export `KeyRevealModal`
- Props:
  ```
  {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    appId: string;
    keyType: 'secretKey' | 'webhookSecret';
  }
  ```
- Internal state: `{ revealed: boolean; plaintext: string | null; copied: boolean; confirming: boolean }`
- UX flow:
  1. On open: show warning step — "Você está prestes a rotacionar a chave secreta. A chave atual será invalidada imediatamente. Tem certeza?" with "Cancelar" + "Rotacionar" buttons
  2. On confirm: call `useRotateSecretKey(appId)` or `useRotateWebhookSecret(appId)` mutation
  3. On mutation success: set `revealed = true`, `plaintext = response.secretKeyPlaintext` (or `webhookSigningSecretPlaintext`)
  4. Reveal step: display plaintext in a `<code>` block with monospace font + copy-to-clipboard button; show warning "Esta chave não será exibida novamente. Copie agora." in amber/warning style
  5. "Copy" button: `navigator.clipboard.writeText(plaintext)` → set `copied = true` → show "Copiado!" for 2s
  6. "Fechar" button: clear `plaintext` from state (security — no in-memory retention after close), call `onOpenChange(false)`
  7. If user closes dialog without copying: show `<AlertDialog>` confirmation "Você copiou a chave?" with "Sim, fechei" + "Voltar"
- Autopilot decision: plaintext is cleared from React state on dialog close — it is NEVER persisted to localStorage, sessionStorage, or any store. After close, the key is only retrievable by rotating again.
- Warning text: `t('admin.apps.keyReveal.warning')` in amber Badge or Alert
- All strings via `t()`

Update `apps/web/src/admin/apps/AppsPage.tsx`:
- "Rotacionar chave secreta" action in each row → `setSelectedApp(app); setKeyType('secretKey'); setRevealOpen(true)`
- "Rotacionar webhook secret" action → same with `keyType: 'webhookSecret'`
- Render `<KeyRevealModal open={revealOpen} onOpenChange={setRevealOpen} appId={selectedApp?.id} keyType={keyType} />`

Update i18n files with all `admin.apps.keyReveal.*` strings:
- `admin.apps.keyReveal.title` → "Rotacionar Chave" / "Rotate Key"
- `admin.apps.keyReveal.warning` → "Esta chave não será exibida novamente." / "This key will never be shown again."
- `admin.apps.keyReveal.confirmRotate` → "Rotacionar" / "Rotate"
- `admin.apps.keyReveal.copied` → "Copiado!" / "Copied!"
- `admin.apps.keyReveal.copy` → "Copiar" / "Copy"
- `admin.apps.keyReveal.close` → "Fechar" / "Close"
- `admin.apps.keyReveal.notCopiedWarning` → "Você copiou a chave?" / "Did you copy the key?"
</action>

<acceptance_criteria>
- [ ] `KeyRevealModal` named export; no default export
- [ ] Modal shows confirmation step BEFORE calling rotate mutation
- [ ] Plaintext displayed ONLY after successful mutation response
- [ ] Plaintext cleared from React state when dialog closes
- [ ] "Copy" button uses `navigator.clipboard.writeText`; shows "Copiado!" for 2s after click
- [ ] Closing without copying triggers `<AlertDialog>` confirmation
- [ ] No plaintext stored in localStorage, sessionStorage, or any global store
- [ ] All strings via `t()`; PT-BR primary
- [ ] `pnpm --filter @fxl-finders/web type-check` exits 0
</acceptance_criteria>

---

### T09 · Type-check + lint gate (Phase 02 final)

**Plan:** `02-P07` — Wave 3 (after T06, T07, T08)
**Files:** all modified files across both `apps/api` and `apps/web`

<read_first>
- All modified files listed in T01–T08 (verify they compile cleanly)
- `CLAUDE.md` — performance audit requirement: `pnpm run perf:audit` via husky pre-commit
</read_first>

<action>
Run verification commands in order:
```bash
pnpm --filter @fxl-finders/api type-check
pnpm --filter @fxl-finders/api lint
pnpm --filter @fxl-finders/api test
pnpm --filter @fxl-finders/web type-check
pnpm --filter @fxl-finders/web lint
```

Run the LOCKED grep gates (all MUST return 0 matches):
```bash
# D-B: admin role NEVER read via Clerk API in a request path
grep -rn 'users.getUser' apps/api/src/domains/admin apps/api/src/middleware/require-admin.ts
# D-B: the deleted adminAuth must not exist
grep -rn 'adminAuthMiddleware\|adminAuth' apps/api/src
# 02 RLS guard: admin tables have no RLS
grep -rn 'setTenantContext' apps/api/src/domains/admin
# D-J: no bare relative fetch / apiClient.get in admin frontend
grep -rn "fetch('/api\|fetch(\`/api\|apiClient\\.get" apps/web/src/admin apps/web/src/lib/api-client.ts
```

Check and fix any issues. Common issues to watch for:
- Missing i18n key declarations (TypeScript will catch if i18n is typed)
- Import path resolution for new admin domain files
- `any` types introduced in API client fetch calls — replace with proper typed responses
- shadcn components may require additional peer dependencies (check console output after shadcn add)

If `pnpm run perf:audit` is in the pre-commit hook, run it manually to detect bundle regressions from the new admin pages (lazy-loaded — should have minimal impact on initial bundle).
</action>

<acceptance_criteria>
- [ ] `pnpm --filter @fxl-finders/api type-check` exits 0
- [ ] `pnpm --filter @fxl-finders/api lint` exits 0 (or pre-existing warnings only)
- [ ] `pnpm --filter @fxl-finders/api test` (unit project) passes — includes `keys.test.ts`
- [ ] `pnpm --filter @fxl-finders/web type-check` exits 0
- [ ] `pnpm --filter @fxl-finders/web lint` exits 0 (or pre-existing warnings only)
- [ ] No `any` types in any new or modified TypeScript file
- [ ] No default exports in any new file
- [ ] `grep -r "setTenantContext" apps/api/src/domains/admin/` returns 0 results (admin tables have no RLS)
- [ ] `grep -rn 'users.getUser' apps/api/src/domains/admin apps/api/src/middleware/require-admin.ts` returns 0 results (D-B — role from verified JWT only)
- [ ] `grep -rn 'adminAuthMiddleware\|adminAuth' apps/api/src` returns 0 results (D-B — deleted; shared `requireAdmin` is the only guard)
- [ ] `grep -rn "fetch('/api\|fetch(\`/api\|apiClient\.get" apps/web/src/admin apps/web/src/lib/api-client.ts` returns 0 results (D-J — all calls via `apiFetch`)
</acceptance_criteria>

---

## must_haves

The phase CANNOT be marked complete unless ALL of the following truths hold:

- [ ] Admin CRUD for `apps`, `products`, `price_bands`, `commission_rules` tables is fully functional (create, read, update via UI + API)
- [ ] Secret key is stored as SHA-256 hash; plaintext is returned ONCE on creation/rotation and cleared from client state on modal close
- [ ] Webhook signing secret is stored in plaintext (required for HMAC at runtime)
- [ ] `KeyRevealModal` shows plaintext ONLY after confirmed rotation; closes clear state
- [ ] No `setTenantContext` call in any admin domain route or service (admin tables have no RLS)
- [ ] All new UI uses `useTranslation()` for every user-facing string
- [ ] Backend admin gate is the shared `requireAdmin` reading `c.get('userRole')` from the verified JWT claim (D-B); NO `adminAuth.ts`/`adminAuthMiddleware`/`isAdmin` var exists; NO `clerkClient.users.getUser()` in any admin request path
- [ ] Frontend `AdminGuard` (UX-only redirect on non-admin) reads Clerk client `publicMetadata.role`; the authoritative gate is the backend `requireAdmin`
- [ ] All admin frontend API calls go through `apiFetch(path, { method, token, body })` with a Clerk `getToken()` token (D-J); no bare relative `fetch`, no `apiClient.get`; `api-client.ts` default port is 3006
- [ ] `allowedRedirectHosts` stored as bare hostnames (hostname Zod rule, not `z.string().url()`); Phase 04 flagged for exact host-equality on redirect
- [ ] Security-sensitive app mutations (create/rotate-secret/rotate-webhook/set-status) write a plain `audit_log` row OR carry the `// TODO(Phase 05)` hash-chain deferral comment (D-R)
- [ ] Price-band boundary tests (`min<=list<=max` incl. equality edges) and slug-immutability test pass
- [ ] All TanStack Query mutations call `invalidateQueries()` on success (never `resetQueries`)
- [ ] `apps/api` and `apps/web` both pass `type-check` + `lint`
- [ ] `keys.test.ts` unit tests pass (TDD — test the key generation functions)

---

## Wave dependency notes

**Wave 1** (T01, T02, T03) — foundational; parallelizable:
- T01: shadcn components + admin shell (frontend only)
- T02 + T03: admin auth middleware + key generation (backend only)

**Wave 2** (T04, T05) — blocked on Wave 1 completion:
- T04: apps CRUD service + routes (depends on T02 + T03 for adminRouter + keys)
- T05: products CRUD service + routes (depends on T02 + T03; parallelizable with T04)

**Wave 3** (T06, T07, T08, T09) — blocked on Wave 2 completion:
- T06, T07, T08: frontend pages + modals (depend on T04 + T05 APIs + T01 components)
- T09: final gate (after all Wave 3 tasks)

---

## Autopilot decisions log (Phase 02)

| # | Decision | Choice | Reason |
|---|---|---|---|
| 1 | Admin DB connection | Same `fxl_finders_app` role, no `setTenantContext` | Admin tables have no RLS policies; access gated by the shared `requireAdmin` role check, not DB row filtering |
| 2 | Clerk admin check | **SUPERSEDED by D-B** → read `c.get('userRole')` from the verified JWT claim via shared `requireAdmin`; NEVER `clerkClient.users.getUser()` | One admin mechanism; role comes from verified JWT `publicMetadata.role` claim; no per-request Clerk API call |
| 3 | Secret key reveal: state clearing | Plaintext cleared from React state on dialog close | Security — no persistent in-memory retention; rotation required to retrieve again |
| 4 | Price band cents/display conversion | `(cents / 100).toFixed(2)` display; `Math.round(floatVal * 100)` on submit | Standard BRL money handling; avoids floating-point accumulation errors |
| 5 | Admin pages code splitting | `React.lazy` + `<Suspense>` for all admin pages | Admin is low-traffic; lazy-load keeps initial bundle small; aligns with performance budget |
| 6 | Publishable key display | Full plaintext rendered in table | Publishable keys are public-safe (equivalent to Stripe pk_ keys); safe to display in admin UI |
| 7 | Product detail routing | `/admin/products/:id` as a separate route with `ProductDetail` | Deep-linking to a specific product's price bands/commission rule; easier than a modal for complex multi-tab content |
| 8 | Admin JWT role check | **LOCKED by D-B** → `clerkAuthMiddleware` sets `c.set('userRole', payload.publicMetadata?.role)` from the verified JWT; shared `requireAdmin` reads `c.get('userRole')`. NO `clerkClient.users.getUser()` in any request path. | Single admin mechanism; verified JWT claim is authoritative; zero per-request Clerk API calls. Requires Phase 01 Clerk session-token custom claim injecting `publicMetadata.role`. |

---

## Failure list

Pre-execution review reconciliations applied (LOCKED, from `.planning/plan-brief.md`):
- **D-B** — admin auth is ONE mechanism: shared `requireAdmin` reading `c.get('userRole')` from the verified JWT claim. Deleted `adminAuth.ts`/`adminAuthMiddleware`/`isAdmin`. Autopilot decisions #2 and #8 are SUPERSEDED. NEVER `clerkClient.users.getUser()` in a request path (grep gate added). Hard dependency on Phase 01 Clerk session-token custom claim injecting `publicMetadata.role`.
- **D-J** — all frontend admin calls via `apiFetch(path, { method, token, body })` against `VITE_API_URL` with Clerk `getToken()`; no bare relative `fetch`, no `apiClient.get`. `api-client.ts` default port 3000→3006.
- **WARN** — `allowedRedirectHosts` validated as bare hostnames (custom hostname regex, not `z.string().url()`); Phase 04 flagged to enforce exact host equality on redirect.
- **WARN/TDD** — added `app-schema.test.ts` (slug immutability + hostname accept/reject) and `products/__tests__/schemas.test.ts` (price-band `min<=list<=max` boundary matrix incl. equality edges + commission-rate range).
- **WARN** — audit_log rows for createApp/rotateSecretKey/rotateWebhookSigningSecret/setAppStatus with explicit Phase 05 hash-chain deferral note (D-R).
- **NIT (D-R)** — `UpdateAppSchema = CreateAppSchema.omit({ slug: true }).partial()`.

---

## Phase dependencies

**This phase depends on:** Phase 01 (schema + auth middleware + `setTenantContext` export)
**This phase unblocks:** Phase 04 (referral links need `apps` + `products` + `price_bands` to exist and be configured)
**Parallelizable with:** Phase 03 (finder onboarding — both depend only on Phase 01)

---

## Verify gate

After execution, run:
```bash
/gsd-verify-work 02
```

Verify checklist (manually confirm before marking phase complete):
- [ ] `GET /api/v1/admin/apps` returns app list with 200 (requires a Clerk JWT whose verified `publicMetadata.role === 'admin'` claim is present — depends on Phase 01 custom session-token claim per D-B)
- [ ] `POST /api/v1/admin/apps` creates app, returns `secretKeyPlaintext` + `webhookSigningSecretPlaintext` in response body
- [ ] `POST /api/v1/admin/apps/:id/rotate-secret-key` returns new `secretKeyPlaintext`; DB `secret_key_hash` updated (verify by checking `apps` table directly)
- [ ] Non-admin JWT (or JWT missing the role claim) receives 403 from any `/api/v1/admin/*` route via `requireAdmin`
- [ ] App with `allowedRedirectHosts` containing a URL (scheme/path) is rejected with 400; bare hostnames accepted
- [ ] `apps/web/src/admin/apps/AppsPage.tsx` renders correctly: skeleton → empty state → table (with seeded data)
- [ ] `KeyRevealModal` shows warning step, then plaintext on confirm, then clears on close
- [ ] `ProductDetail` at `/admin/products/:id` renders both tabs with price band forms + commission form
- [ ] `pnpm --filter @fxl-finders/api type-check` exits 0
- [ ] `pnpm --filter @fxl-finders/web type-check` exits 0
- [ ] `pnpm --filter @fxl-finders/api test` passes (includes `keys.test.ts`, `app-schema.test.ts`, `schemas.test.ts`)
- [ ] `grep -r "setTenantContext" apps/api/src/domains/admin/` returns 0 results
- [ ] `grep -rn 'users.getUser' apps/api/src/domains/admin` returns 0 results (D-B)
- [ ] `grep -rn "fetch('/api\|apiClient\.get" apps/web/src/admin` returns 0 results (D-J)
