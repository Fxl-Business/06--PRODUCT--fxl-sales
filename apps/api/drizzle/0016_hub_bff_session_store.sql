-- Durable Hub BFF session store.
--
-- createHubBff() previously fell back to InMemoryHubSessionStore, so every API
-- restart or redeploy invalidated every logged-in session, and a second replica
-- could not see a session created by the first.
--
-- Neither table is tenant-scoped, and neither can be: a session row is written at
-- /auth/callback, BEFORE any workspace is known, so there is no org_id to key a
-- tenant policy on. They are still FORCE RLS with the admin-context policy only,
-- because these rows are bearer credentials: from the ordinary tenant connection
-- (getDb(), which never sets app.fxl_admin) both tables are empty and unwritable.
-- The store reads and writes exclusively through getAdminDb().
--
-- hub_refresh_token_enc and code_verifier_enc are AES-256-GCM sealed with the
-- row id as AEAD additional data, so a dump alone yields no usable credential.
--
-- Down path: DROP TABLE both tables. No data migration exists in either direction;
-- dropping them logs every user out, which is the pre-migration behaviour anyway.

CREATE TABLE "hub_bff_login_txns" (
	"id" text PRIMARY KEY NOT NULL,
	"code_verifier_enc" text NOT NULL,
	"state" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "hub_bff_sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"hub_refresh_token_enc" text NOT NULL,
	"account_id" text,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "hub_bff_login_txns_expires_at_idx" ON "hub_bff_login_txns" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "hub_bff_sessions_expires_at_idx" ON "hub_bff_sessions" USING btree ("expires_at");--> statement-breakpoint
ALTER TABLE hub_bff_sessions ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE hub_bff_sessions FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY hub_bff_sessions_admin_context ON hub_bff_sessions
  AS PERMISSIVE FOR ALL
  USING (current_setting('app.fxl_admin', true) = 'true')
  WITH CHECK (current_setting('app.fxl_admin', true) = 'true');--> statement-breakpoint
ALTER TABLE hub_bff_login_txns ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE hub_bff_login_txns FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY hub_bff_login_txns_admin_context ON hub_bff_login_txns
  AS PERMISSIVE FOR ALL
  USING (current_setting('app.fxl_admin', true) = 'true')
  WITH CHECK (current_setting('app.fxl_admin', true) = 'true');
