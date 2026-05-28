# Phase 01 — Clerk dashboard configuration (decision record)

**Status:** required before any admin/finder/seller login works in staging/prod.
**Owner:** CTO / ops (out-of-band dashboard config — not code).
**Source:** spec § 9 (security checklist), plan-brief D-B.

These are dashboard-side settings for **this project's Clerk app** (the
"Development" + "Production" instances). Local dev uses the shared "FXL Local
Sandbox" app, where `clerkAuthMiddleware` runs in passthrough mode when
`CLERK_SECRET_KEY` is unset (see `apps/api/src/middleware/auth.ts`).

## Required settings

1. **Restrictions → Allowlist mode: ON.**
   Prevents unauthorized end-user sign-ups / org creation. Finders are admitted
   via the admin-approval flow (Phase 03), not open self-service Clerk accounts.

2. **Organizations → "Allow end users to create organizations": OFF.**
   Each finder = one Clerk org, created by the backend at admin approval
   (`clerkClient.organizations.createOrganization()` in Phase 03). End users must
   never self-create orgs.

3. **Sessions → org_id in the JWT.**
   Clerk includes `org_id` for organization sessions by default. Verify it is
   present — `clerkAuthMiddleware` reads `payload.org_id ?? payload.sub`.

4. **Sessions → Customize session token → CUSTOM CLAIM (D-B, LOAD-BEARING).**
   Add this claim so the backend can read the role from the verified JWT WITHOUT
   a per-request `clerkClient.users.getUser()` call:

   ```json
   { "publicMetadata": "{{user.public_metadata}}" }
   ```

   `clerkAuthMiddleware` (T11) reads `payload.publicMetadata?.role` and sets
   `c.set('userRole', ...)`. The `requireAdmin` guard
   (`apps/api/src/middleware/require-admin.ts`) gates on
   `c.get('userRole') === 'admin'`.

   **WITHOUT this claim, `payload.publicMetadata` is `undefined` → `userRole` is
   `undefined` → `requireAdmin` 403s EVERY admin request.** This is a hard
   prerequisite for the entire admin path.

   Set a user's role by writing `{ "role": "admin" | "seller" | "finder" }` to
   their Clerk `publicMetadata`.

## DB role split (D-C / D-G — related ops prerequisite)

- Runtime `DATABASE_URL` → `fxl_finders_app` (no BYPASSRLS; RLS enforced).
- Migrations run as owner/superuser (`MIGRATE_DATABASE_URL`).
- Admin/cross-tenant ops → `ADMIN_DATABASE_URL` → `fxl_finders_admin` (BYPASSRLS).

The Phase 01 journaled migration CREATEs all three `fxl_finders_*` roles. On a
fresh DB the first migrate must run with a superuser-capable URL.

## Handoff checklist

- [ ] Clerk session-token custom claim `{ "publicMetadata": "{{user.public_metadata}}" }` configured (D-B) — admin gate depends on it.
- [ ] Allowlist mode ON; end-user org creation OFF.
- [ ] `org_id` confirmed present in org-session JWTs.
- [ ] Staging/prod: `DATABASE_URL` → `fxl_finders_app`; migrations as owner; `ADMIN_DATABASE_URL` → `fxl_finders_admin` (BYPASSRLS) (D-C).
