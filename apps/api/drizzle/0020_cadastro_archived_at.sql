ALTER TABLE "sales_ops_areas" ADD COLUMN "archived_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "sales_ops_funcoes" ADD COLUMN "archived_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "sales_ops_people" ADD COLUMN "archived_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "sales_ops_products" ADD COLUMN "archived_at" timestamp with time zone;--> statement-breakpoint
-- Backfill: every row that is ALREADY archived gets `now()`, i.e. a FRESH 30-day
-- window that starts at deploy.
--
-- The two alternatives were both rejected. Leaving the column NULL on existing
-- rows makes them unpurgeable forever, which quietly turns the feature off for
-- exactly the backlog it was asked for. Backdating from `updated_at` would purge
-- a years-old archived cadastro on the first nightly run after deploy, before any
-- operator had a chance to notice the feature exists.
--
-- All four tables are under FORCE ROW LEVEL SECURITY, so in a deployment whose
-- migration role is the table owner (not a superuser) these UPDATEs would match
-- ZERO rows without an admin session context. Same reason and same shape as the
-- system-função seed in 0012.
SELECT set_config('app.fxl_admin', 'true', true);--> statement-breakpoint
UPDATE "sales_ops_areas" SET "archived_at" = now() WHERE "status" = 'archived' AND "archived_at" IS NULL;--> statement-breakpoint
-- No is_system clause: a system função cannot be archived through the API at all,
-- so this matches nothing on it. The purge filters is_system a second time anyway,
-- which is the guard that actually protects the two predefined roles.
UPDATE "sales_ops_funcoes" SET "archived_at" = now() WHERE "status" = 'archived' AND "archived_at" IS NULL;--> statement-breakpoint
-- Pessoas spell archived as 'inactive'.
UPDATE "sales_ops_people" SET "archived_at" = now() WHERE "status" = 'inactive' AND "archived_at" IS NULL;--> statement-breakpoint
UPDATE "sales_ops_products" SET "archived_at" = now() WHERE "status" = 'archived' AND "archived_at" IS NULL;
