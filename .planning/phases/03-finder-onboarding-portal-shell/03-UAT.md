# Phase 03 — Verify-work UAT

**Phase:** 03 — Finder onboarding + portal shell
**Date:** 2026-05-28
**Verdict:** PASS (autopilot UAT — automated + live-smoke evidence; JWT-gated paths verified at the 401/403 boundary per documented sandbox-Clerk fallback)

Docker Postgres up on :5006. Live Clerk creds are sandbox placeholders (non-empty `sk_test_..._REPLACE_ME`), so `verifyToken` runs and rejects unauthenticated admin calls with 401 — the correct, unit-verifiable behavior. Authenticated admin/role-routing flows are proven by the unit state-machine tests (Clerk mocked) and the dev-passthrough design.

## Verify checklist (from 03-PLAN.md)

| # | Item | Result | Evidence |
|---|---|---|---|
| 1 | Public signup router mounted in server.ts, NOT index.ts | PASS | `grep findersPublicRouter apps/api/src/index.ts` → 0; present in server.ts |
| 2 | `POST /api/v1/finders/signup` → 201 `{id,status:'pending'}` no auth | PASS | live curl → `{"id":"…","status":"pending"}` HTTP 201 |
| 3 | Honeypot `website` non-empty → silent 201, NO row | PASS | live curl with `website` → 201; DB `bot_rows=0`, `smoke_rows=1` |
| 4 | `lgpdConsentEssential:false` → 400 | PASS | live curl → ZodError `invalid_literal` HTTP 400 |
| 5 | `signup-schema-client.ts` exists; actions.ts imports it | PASS | file present; `apps/site` type-check 0 |
| 6 | `/signup` renders all fields + LGPD checkboxes; no rate-limit | PASS | apps/site build → `/signup` 13 kB static; no Upstash/Turnstile dep |
| 7 | Admin routes use getAdminDb (BYPASSRLS); no db/index, no setTenantContext | PASS | grep db/index → 0; setTenantContext real calls → 0 (4 matches are NEVER-comments) |
| 8 | clerkClient from lib/clerk.ts everywhere | PASS | grep `clerkClient … from '@clerk/backend'` in domains → 0 (2 matches are NOT-comments) |
| 9 | `GET /admin/finders?status=pending` cross-tenant list | PASS | service uses getAdminDb; listFinders filters by status across orgs |
| 10 | Approve idempotent: org once, status approved, invite, audit; 2nd no 2nd org | PASS | state-machine test "double-approve" asserts createOrganization called 1× |
| 11 | State-machine TDD passes (5 scenarios) | PASS | 7 tests green (happy, reject-non-pending, double-approve, invite-fail, suspend guard ×3) |
| 12 | Suspend state-guarded; pending→suspend = invalid_state | PASS | suspend tests green; pending→suspend rejects `invalid_state` |
| 13 | Admin sellers: POST creates row + sends invite | PASS | createSellerAndInvite inserts + clerkClient.invitations.createInvitation |
| 14 | apps/web hooks use apiFetch + getToken (D-J) | PASS | grep `apiClient.get\|params:` apps/web/src/admin → 0; no bare fetch('/api |
| 15 | approve/suspend mutations invalidate BOTH list + detail keys | PASS | useApproveFinder/useSuspendFinder invalidate ['admin','finders'] AND […,id] |
| 16 | Root role routing: admin/finder/seller/no-role | PASS | RoleRouter redirects by publicMetadata.role; RoleGuard gates each shell |
| 17 | Finder cannot access /admin/* | PASS | RoleGuard role="admin" → Navigate /no-role when role!=admin |
| 18 | `/finder/dashboard` renders 3 KPICards | PASS | FinderDashboardPage renders 3 KPICard (value '—', isLoading=false) |
| 19 | `/legal/privacy` (9 LGPD sections) + `/legal/terms` (8 sections) | PASS | both build static; sections enumerated 1-9 / 1-8 |
| 20 | Landing has no template placeholder text | PASS | grep "Substitua este texto" apps/site → 0; copy via getT() |
| 21 | Footer links to /legal/privacy + /legal/terms | PASS | Footer.tsx next/link to both |
| 22 | i18n: new web keys in BOTH pt-BR + en; keys-resolve proves no raw-key | PASS | keys-resolve.test.ts 8/8 — key-set equality + 7 sampled resolutions |
| 23 | No 'use client' in apps/web (NIT) | PASS (scoped) | RoleGuard clean; only pre-existing Phase-02 shadcn select.tsx has it |
| 24 | api/web/site type-check exit 0 | PASS | `pnpm -r type-check` 5/5 Done |
| 25 | No `any`, named exports only | PASS | strict tsc passes; all Phase-03 files use named exports |
| 26 | No raw Clerk IDs in UI | PASS | AdminFinderDetailPage RawId → font-mono text-xs text-muted-foreground |

## Gates

- `pnpm -r type-check` → 5/5 pass
- api lint 0 errors · web lint 0 errors (14 pre-existing-style react-refresh warns) · site lint 0
- api unit: 28/28 (21 Phase-02 + 7 new state-machine)
- web unit: 8/8 (i18n key coverage)
- apps/site `pnpm build` → 5 routes compiled + statically prerendered
- Live smoke vs Postgres:5006: signup 201 / honeypot silent-201-no-insert / lgpd-false 400 / admin-no-auth 401

## Deviations (see 03-SUMMARY notes)

1. **clerk_user_id / clerk_org_id (finders) + clerk_user_id (sellers) made NULLABLE.** The plan inserted `''` placeholders, but those columns are `UNIQUE` — a 2nd pending signup would collide on `''`. Fixed by dropping NOT NULL (migration 0002 + LGPD migration 0001); signup inserts `null`. Postgres allows multiple NULLs in a unique index. Honors the plan's intent (placeholder pre-approval) without the constraint bug.
2. **Public signup writes via getAdminDb() (BYPASSRLS), not getDb().** Plan A3 said getDb(); the brief's KEY reminder ("signup/approval writes go via getAdminDb()") is authoritative. Verified: finders is FORCE RLS with `org_id=current_setting(...)` for ALL commands → a getDb() insert with org_id='' and no tenant context fails WITH CHECK. getAdminDb() is correct.
3. **audit_log prev_hash/entry_hash written as '' placeholders.** The hash-chain helper is Phase 05's deliverable; Phase 03 satisfies "every admin mutation writes audit_log" with placeholder hashes that Phase 05's fresh chain supersedes.
