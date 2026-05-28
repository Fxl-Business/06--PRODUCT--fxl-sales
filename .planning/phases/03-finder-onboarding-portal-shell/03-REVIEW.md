# Phase 03 — Code review

**Phase:** 03 — Finder onboarding + portal shell
**Date:** 2026-05-28
**Verdict:** PASS — 0 Critical · 0 Warning · 3 Info
**Auto-fix:** 1 fix applied during execution (see Critical-class-caught-early below)

## Scope reviewed

apps/api: `domains/finders/{public-routes,admin-routes,admin-service,signup-schema}.ts`, `domains/finders/__tests__/finder-state-machine.test.ts`, `domains/sellers/{admin-routes,admin-service}.ts`, `domains/admin/index.ts`, `server.ts`, `db/schema.ts`, migrations 0001/0002.
apps/site: `i18n/*`, `app/signup/*`, `app/legal/**`, `components/{Hero,Features,HowItWorks,Footer,LegalLayout}.tsx`.
apps/web: `router.tsx`, `components/auth/RoleGuard.tsx`, `components/layout/{FinderShell,SellerShell}.tsx`, `admin/finders/**`, `admin/sellers/**`, `finder/**`, `seller/**`, `pages/errors/NoRolePage.tsx`, `lib/api-client.ts`, `admin/types.ts`, `i18n/*`, `vitest.config.ts`.

## Critical (0)

None outstanding. **Caught + fixed during execution (would have been Critical):**
- **Unique-constraint collision on placeholder Clerk IDs.** The plan inserted `clerk_user_id=''` / `clerk_org_id=''` for pending finders and `clerk_user_id=''` for invited sellers, but those columns are `UNIQUE NOT NULL`. The 2nd pending signup / 2nd un-accepted seller would throw a `23505` unique violation, breaking signup entirely. Fixed by making the columns NULLABLE (migrations 0001 + 0002) and inserting `null` (Postgres permits multiple NULLs under a unique index). Verified by the state-machine test seeding multiple pending finders + the live signup smoke (2 distinct signups, no collision).
- **Public signup RLS rejection.** Plan A3 used `getDb()`; `finders` is FORCE RLS with `org_id=current_setting('app.current_org_id',true)` over ALL commands, so a `getDb()` insert (org_id='', no tenant context) fails WITH CHECK. Switched to `getAdminDb()` per the brief's authoritative KEY reminder. Verified by live 201 signup.

## Warning (0)

None.

## Info (3)

1. **audit_log hash-chain placeholders.** Phase 03 admin mutations write `prev_hash=''`/`entry_hash=''` (via `sql\`''\``) because the hash-chain helper (`writeAuditEntry`) is a Phase 05 deliverable. These placeholder rows predate Phase 05's chain and are superseded when it builds the chain fresh. Acceptable per D-C ("every admin mutation writes audit_log") + Phase 05 ownership of the chain. Tracked for Phase 05.
2. **react-refresh lint warnings (non-blocking).** `router.tsx` (config exports) + pre-existing shadcn `badge.tsx`/`button.tsx` (variant + component co-export) emit `react-refresh/only-export-components` warnings. 0 errors; matches the Phase 02 precedent. `RoleGuard.tsx` co-exports `RoleGuard`+`RoleRouter` — both are guards, acceptable.
3. **Pre-existing `"use client"` in `components/ui/select.tsx`** (committed in Phase 02, 26063ea). Benign in Vite (ignored). Out of Phase 03 scope; the plan's NIT (RoleGuard) is satisfied — RoleGuard has no directive.

## Positive notes

- CPF masked at the service boundary (`toAdminRow` strips raw `cpf`, exposes only `cpfMasked`); web `FinderRow` type carries no raw `cpf` — stronger than the plan required (LGPD).
- No raw Clerk IDs rendered: `AdminFinderDetailPage`'s `RawId` uses the mandated `font-mono text-xs text-muted-foreground` fallback.
- Approve flow correctly idempotent: SELECT…FOR UPDATE, org-create gated on empty `clerk_org_id`, status flip guarded by `status='pending'`, invite sent outside the tx so a send failure leaves a retry-safe approved row.
- All authed web calls route through `apiFetch` + Clerk `getToken()` (D-J); query strings built via `URLSearchParams`.
- All new web i18n keys mirrored in pt-BR + en, proven by `keys-resolve.test.ts` (deep key-set equality + sampled non-raw resolution).
