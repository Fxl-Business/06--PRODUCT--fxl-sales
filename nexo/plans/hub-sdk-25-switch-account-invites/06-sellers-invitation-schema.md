---
id: 06-sellers-invitation-schema
milestone: v4.1.0
status: todo
depends_on: [01-sdk-bump-2.5.0]
files_modified:
  - apps/api/src/db/schema.ts
  - apps/api/drizzle/0025_seller_invitation_state.sql
  - apps/api/drizzle/meta/_journal.json
  - apps/api/drizzle/meta/0025_snapshot.json
  - apps/web/src/admin/types.ts
  - apps/api/src/domains/sellers/__tests__/seller-invitation-schema.test.ts
acceptance: "given the sellers table, when migration 0025 is applied to the LOCAL test DB, then sellers has nullable invitation_id, invitation_status, and invited_org_id columns, SellerRow ($inferSelect) and the web SellerRow type carry them, and no existing seller behavior regresses."
goal: "Add invitation state columns to the sellers table (id, status, target org) via migration 0025, wired into schema.ts and the web type."
verifier_focus: "Migration applies cleanly on the local test DB; the drizzle meta journal/snapshot stay consistent (0025 follows 0024); columns are NULLABLE so existing rows are unaffected; sellers stays cross-org, no RLS, no org_id (invited_org_id records the invite target, it does not make the row tenant-scoped)."
must_not_break:
  - "sellers stays without tenant RLS (cross-org, admin-managed via getAdminDb)."
  - "local-database-guard: migration is applied only against local Postgres."
  - "Existing seller create/list/status behavior (columns are additive + nullable)."
rules:
  - "Columns are nullable text; invitation_status holds one of pending|accepted|expired|revoked (or NULL when never invited)."
  - "Do NOT add org_id/RLS to sellers; invited_org_id is a plain informational column."
  - "Migrations use the repo's phased runner convention already in place; keep drizzle meta consistent."
---

# Slice 06 - seller invitation schema (migration 0025)

## Context (from investigation)

`apps/api/src/db/schema.ts:82-94` defines `sellers` (cross-org, no org_id, no RLS): `id`, `accountId` (nullable unique), `displayName`, `contactEmail`, `status`, `createdAt`, `updatedAt`.

Migration high-water mark is `0024_sales_ops_settlements.sql`; next is `0025`. `apps/api/drizzle/meta/_journal.json` + a `0025_snapshot.json` must be added consistently (the repo journals drizzle migrations).

Web mirror type: `apps/web/src/admin/types.ts:133-148` `SellerRow { id, accountId, displayName, contactEmail, status, createdAt, updatedAt }`.

Decision 1 (human): the invite targets the admin's own active org, and the row should record which org it targeted -> `invited_org_id`.

## Steps (TDD)

1. **seller-invitation-schema.test.ts (red):** a test that (a) the drizzle schema `sellers` object exposes `invitationId`, `invitationStatus`, `invitedOrgId`, and (b) - if the repo has a migration-apply integration harness - that a fresh migrate leaves those columns present and nullable on the local test DB. If a pure-unit assertion on the schema object is the convention, assert the column definitions.
2. **schema.ts (green):** add to `sellers`:
   - `invitationId: text('invitation_id')` (nullable)
   - `invitationStatus: text('invitation_status')` (nullable; values pending|accepted|expired|revoked)
   - `invitedOrgId: text('invited_org_id')` (nullable)
3. **Migration:** generate `0025_seller_invitation_state.sql` with `ALTER TABLE "sellers" ADD COLUMN ...` for the three nullable columns; update `meta/_journal.json` and add `meta/0025_snapshot.json`. Prefer the repo's generation path (`pnpm --filter @fxl-sales/api drizzle-kit generate` or the documented equivalent) so the snapshot is exact, then hand-verify the SQL is three additive nullable columns only.
4. **web type:** add `invitationId: string | null`, `invitationStatus: SellerInvitationStatus | null`, `invitedOrgId: string | null` to `SellerRow` in `apps/web/src/admin/types.ts`, and define `SellerInvitationStatus = 'pending' | 'accepted' | 'expired' | 'revoked'`.

## Acceptance / oracle

- Named oracle: `apps/api/src/domains/sellers/__tests__/seller-invitation-schema.test.ts` + `type-check`. If a migration integration test exists in the repo pattern, include an apply check against the local test DB.

## Notes

- Do not remove or narrow the existing `sellers` columns. Additive only.
- `invited_org_id` is informational; it does not turn sellers into a tenant-scoped table.
