-- 0025_integration_transport - producer outbox + publisher high-water mark and
-- consumer inbox + cursor for the Sales<->Finance control-plane integration.
--
-- DDL transcribed VERBATIM from @fxl-business/fxl-contracts@0.1.0
-- schema/integration-transport.sql (PRODUCER SIDE + CONSUMER SIDE). `position`
-- on integration_outbox is NULLABLE on purpose: it is assigned AFTER commit by a
-- single elected publisher, only to already-visible rows, so a bigserial (which
-- consumes its value at INSERT, not COMMIT) would reintroduce the skip-a-row bug
-- this table exists to close. Read the package's own note before "fixing" it.
--
-- TENANCY: the three org-scoped tables (outbox, inbox, cursor) are tenant data -
-- every row carries organization_id and a forgotten predicate would leak one
-- Organization's integration data to another. They get ENABLE + FORCE RLS with
-- the SAME two policies every sales_ops table carries (0008): a tenant_isolation
-- policy keyed on organization_id = current_setting('app.current_org_id') (the
-- producer enqueues inside the business withTenant transaction, which sets that
-- setting) and an admin_context policy keyed on app.fxl_admin (the position
-- publisher, the feed read and the consumer puller run cross-org through
-- getAdminDb). integration_outbox_position carries NO organization_id - it is a
-- single global counter row, exactly like hub_bff_* - so it gets ENABLE + FORCE
-- RLS with the admin_context policy ONLY (0016 precedent); the publisher touches
-- it through getAdminDb.
--
-- No privilege statement appears in this file (single-role database contract).
CREATE TABLE "integration_outbox" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"event_name" text NOT NULL,
	"event_version" integer NOT NULL,
	"idempotency_key" text NOT NULL,
	"payload" jsonb NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"position" bigint,
	"published_at" timestamp with time zone
);--> statement-breakpoint
CREATE UNIQUE INDEX "integration_outbox_idempotency_key_uq" ON "integration_outbox" USING btree ("organization_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "integration_outbox_pending_idx" ON "integration_outbox" USING btree ("occurred_at","id") WHERE "integration_outbox"."position" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "integration_outbox_position_uq" ON "integration_outbox" USING btree ("position") WHERE "integration_outbox"."position" is not null;--> statement-breakpoint
CREATE INDEX "integration_outbox_feed_idx" ON "integration_outbox" USING btree ("organization_id","position") WHERE "integration_outbox"."position" is not null;--> statement-breakpoint
CREATE TABLE "integration_outbox_position" (
	"id" text PRIMARY KEY NOT NULL,
	"last_position" bigint DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE TABLE "integration_inbox" (
	"producer_application_id" text NOT NULL,
	"organization_id" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"event_name" text NOT NULL,
	"event_version" integer NOT NULL,
	"position" bigint NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"applied_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "integration_inbox_pkey" PRIMARY KEY("producer_application_id","organization_id","idempotency_key")
);--> statement-breakpoint
CREATE TABLE "integration_cursor" (
	"producer_application_id" text NOT NULL,
	"organization_id" text NOT NULL,
	"position" bigint DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "integration_cursor_pkey" PRIMARY KEY("producer_application_id","organization_id")
);--> statement-breakpoint
ALTER TABLE integration_outbox ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE integration_outbox FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY integration_outbox_tenant_isolation ON integration_outbox
  AS PERMISSIVE FOR ALL
  USING (organization_id = current_setting('app.current_org_id', true))
  WITH CHECK (organization_id = current_setting('app.current_org_id', true));--> statement-breakpoint
CREATE POLICY integration_outbox_admin_context ON integration_outbox
  AS PERMISSIVE FOR ALL
  USING (current_setting('app.fxl_admin', true) = 'true')
  WITH CHECK (current_setting('app.fxl_admin', true) = 'true');--> statement-breakpoint
ALTER TABLE integration_inbox ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE integration_inbox FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY integration_inbox_tenant_isolation ON integration_inbox
  AS PERMISSIVE FOR ALL
  USING (organization_id = current_setting('app.current_org_id', true))
  WITH CHECK (organization_id = current_setting('app.current_org_id', true));--> statement-breakpoint
CREATE POLICY integration_inbox_admin_context ON integration_inbox
  AS PERMISSIVE FOR ALL
  USING (current_setting('app.fxl_admin', true) = 'true')
  WITH CHECK (current_setting('app.fxl_admin', true) = 'true');--> statement-breakpoint
ALTER TABLE integration_cursor ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE integration_cursor FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY integration_cursor_tenant_isolation ON integration_cursor
  AS PERMISSIVE FOR ALL
  USING (organization_id = current_setting('app.current_org_id', true))
  WITH CHECK (organization_id = current_setting('app.current_org_id', true));--> statement-breakpoint
CREATE POLICY integration_cursor_admin_context ON integration_cursor
  AS PERMISSIVE FOR ALL
  USING (current_setting('app.fxl_admin', true) = 'true')
  WITH CHECK (current_setting('app.fxl_admin', true) = 'true');--> statement-breakpoint
ALTER TABLE integration_outbox_position ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE integration_outbox_position FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY integration_outbox_position_admin_context ON integration_outbox_position
  AS PERMISSIVE FOR ALL
  USING (current_setting('app.fxl_admin', true) = 'true')
  WITH CHECK (current_setting('app.fxl_admin', true) = 'true');--> statement-breakpoint
SELECT set_config('app.fxl_admin', 'true', true);--> statement-breakpoint
INSERT INTO integration_outbox_position (id) VALUES ('default') ON CONFLICT (id) DO NOTHING;
