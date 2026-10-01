---
id: 06-sellers-invitation-schema
milestone: v4.1.0
status: todo
depends_on: [01-sdk-bump-2.5.0]
files_modified:
  - apps/api/src/db/schema.ts
  - apps/api/drizzle/0026_seller_invitation_state.sql
  - apps/api/drizzle/meta/_journal.json
  - apps/api/drizzle/meta/0026_snapshot.json
  - apps/web/src/admin/types.ts
  - apps/api/src/domains/sellers/__tests__/seller-invitation-schema.test.ts
acceptance: "given the sellers table, when migration 0026 is applied to the LOCAL test DB, then sellers has nullable invitation_id, invitation_status, and invited_org_id columns, SellerRow ($inferSelect) and the web SellerRow type carry them, and no existing seller behavior regresses."
goal: "Add invitation state columns to the sellers table (id, status, target org) via migration 0026, wired into schema.ts and the web type."
verifier_focus: "Migration applies cleanly on the local test DB; the drizzle meta journal/snapshot stay consistent (0026 is idx 26 and follows 0025_integration_transport); columns are NULLABLE so existing rows are unaffected; sellers stays cross-org, no RLS, no org_id (invited_org_id records the invite target, it does not make the row tenant-scoped)."
must_not_break:
  - "sellers stays without tenant RLS (cross-org, admin-managed via getAdminDb)."
  - "local-database-guard: migration is applied only against local Postgres."
  - "Existing seller create/list/status behavior (columns are additive + nullable)."
rules:
  - "Columns are nullable text; invitation_status holds one of pending|accepted|expired|revoked (or NULL when never invited)."
  - "Do NOT add org_id/RLS to sellers; invited_org_id is a plain informational column."
  - "Migrations use the repo's phased runner convention already in place; keep drizzle meta consistent."
---

# Slice 06 - seller invitation schema (migration 0026)

## Context (from investigation)

`apps/api/src/db/schema.ts:82-94` defines `sellers` (cross-org, no org_id, no RLS): `id`, `accountId` (nullable unique), `displayName`, `contactEmail`, `status`, `createdAt`, `updatedAt`.

Migration high-water mark is `0025_integration_transport.sql`, landed by run `20260928T220106Z-sales-finance-control-plane` AFTER this plan was first written (RECONCILED 2026-10-01). This migration is therefore `0026`: journal entry `idx: 26` immediately after `0025_integration_transport`, and `meta/0026_snapshot.json` derived from `meta/0025_snapshot.json` (which already carries the four integration transport tables), so the generated SQL is ONLY the three `sellers` columns. `schema.ts` now also declares the integration tables; touch only the `sellers` table. If drizzle-kit generate emits anything beyond the three `ALTER TABLE "sellers" ADD COLUMN` lines, the snapshot chain is wrong: stop and fix it, never hand-trim SQL over a mismatched snapshot.

Web mirror type: `apps/web/src/admin/types.ts:133-148` `SellerRow { id, accountId, displayName, contactEmail, status, createdAt, updatedAt }`.

Decision 1 (human): the invite targets the admin's own active org, and the row should record which org it targeted -> `invited_org_id`.

## Steps (TDD)

1. **seller-invitation-schema.test.ts (red):** a test that (0) the journal lists `0026_seller_invitation_state` at `idx: 26` immediately after `0025_integration_transport` (mirror `apps/api/src/db/__tests__/settlements-schema-contract.test.ts`), (a) the drizzle schema `sellers` object exposes `invitationId`, `invitationStatus`, `invitedOrgId`, and (b) the column definitions are nullable text. The migration APPLY on the local test DB is proven by the wave-2 wave-verify running `pnpm --filter @fxl-sales/api test:integration` (which migrates the local test DB from scratch), not by a new integration file in this slice.
2. **schema.ts (green):** add to `sellers`:
   - `invitationId: text('invitation_id')` (nullable)
   - `invitationStatus: text('invitation_status')` (nullable; values pending|accepted|expired|revoked)
   - `invitedOrgId: text('invited_org_id')` (nullable)
3. **Migration:** generate `0026_seller_invitation_state.sql` with `ALTER TABLE "sellers" ADD COLUMN ...` for the three nullable columns; update `meta/_journal.json` and add `meta/0026_snapshot.json`. Use the repo's generation path with an explicit name (`pnpm --filter @fxl-sales/api db:generate --name seller_invitation_state`; the default name is random) so the snapshot is exact, then hand-verify the SQL is three additive nullable columns only.
4. **web type:** add `invitationId: string | null`, `invitationStatus: SellerInvitationStatus | null`, `invitedOrgId: string | null` to `SellerRow` in `apps/web/src/admin/types.ts`, and define `SellerInvitationStatus = 'pending' | 'accepted' | 'expired' | 'revoked'`.

## Acceptance / oracle

- Named oracle: `apps/api/src/domains/sellers/__tests__/seller-invitation-schema.test.ts` + `type-check`. If a migration integration test exists in the repo pattern, include an apply check against the local test DB.

## Notes

- Do not remove or narrow the existing `sellers` columns. Additive only.
- `invited_org_id` is informational; it does not turn sellers into a tenant-scoped table.
