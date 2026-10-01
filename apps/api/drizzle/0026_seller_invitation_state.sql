-- 0026_seller_invitation_state - Hub invitation state on the cross-org sellers table.
--
-- A seller is invited to the admin's active Hub Organization through the Hub
-- invitations API. These columns record that invite: the Hub invitation id, its
-- last known status (pending | accepted | expired | revoked) and the Organization
-- it targeted. All three are NULLABLE with no default, so every existing seller
-- reads as "never invited" and no backfill is needed.
--
-- invited_org_id is informational only. sellers stays cross-org (FXL employees,
-- admin-managed via getAdminDb): no org_id, no RLS. Recording the invite target
-- does NOT make the row tenant-scoped.
ALTER TABLE "sellers" ADD COLUMN "invitation_id" text;--> statement-breakpoint
ALTER TABLE "sellers" ADD COLUMN "invitation_status" text;--> statement-breakpoint
ALTER TABLE "sellers" ADD COLUMN "invited_org_id" text;