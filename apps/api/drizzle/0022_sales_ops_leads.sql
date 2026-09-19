-- 0022_sales_ops_leads - the persistence layer for the kanban pipeline.
--
-- Creates sales_ops_lead_stages (the board's columns), sales_ops_leads (one card)
-- and sales_ops_lead_products (what one lead is negotiating), all three under
-- FORCE ROW LEVEL SECURITY with the same two org policies 0012 spells, and seeds
-- the default four-stage pipeline for every org that already exists.
--
-- `kind` is a text discriminator ('normal' | 'conversion' | 'lost') plus a CHECK,
-- and deliberately NOT two booleans: the three categories are mutually exclusive,
-- so a single column makes `is_conversion AND is_lost` unrepresentable rather than
-- merely rejected, "exactly one conversion stage per org" is ONE partial unique
-- index instead of two, and a future category is a literal rather than a
-- migration. It is text + CHECK and not a Postgres enum because nothing in this
-- schema uses one and ALTER TYPE cannot run inside the runner's ordinary commit.
-- `is_system` stays, because it answers a different question ("may the API rename
-- or archive this?"), and the biconditional CHECK is what keeps the two from
-- drifting.
--
-- sales_ops_lead_products.lead_id is THE ONE CASCADE here. It is the
-- product_funcao_costs case, not the sale_items case: a row has no independent
-- identity, no beneficiary, no money, no schedule, no ledger entry, and nothing
-- references it. Every other FK in this migration is restrict, because a stage, a
-- cliente, a pessoa, uma venda and a produto all carry history.
--
-- "Perdido requires a reason" is NOT enforced here and must never be "hardened"
-- into a CHECK or a trigger: the rule needs the lead's stage kind, which is a join
-- to sales_ops_lead_stages, and a CHECK constraint may not contain one. It is a
-- zod rule in the service layer, for the same reason cost_split_bp's sum rule is.
--
-- No privilege statement appears in this file. The test role already holds
-- ALTER DEFAULT PRIVILEGES on new public tables, and a journaled migration must
-- never create, alter or grant to a cluster role - see the single-role database
-- contract test, which reads every migration's bytes and enforces exactly that.
CREATE TABLE "sales_ops_lead_stages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" text NOT NULL,
	"name" text NOT NULL,
	"kind" text DEFAULT 'normal' NOT NULL,
	"is_system" boolean DEFAULT false NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone,
	CONSTRAINT "sales_ops_lead_stages_kind_check" CHECK ("sales_ops_lead_stages"."kind" in ('normal', 'conversion', 'lost')),
	CONSTRAINT "sales_ops_lead_stages_system_kind_check" CHECK (("sales_ops_lead_stages"."kind" <> 'normal') = "sales_ops_lead_stages"."is_system")
);
--> statement-breakpoint
CREATE TABLE "sales_ops_leads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" text NOT NULL,
	"contact_name" text NOT NULL,
	"client_id" uuid,
	"client_name_snapshot" text NOT NULL,
	"estimated_value_brl" integer DEFAULT 0 NOT NULL,
	"description" text,
	"seller_person_id" uuid,
	"seller_name_snapshot" text DEFAULT '' NOT NULL,
	"stage_id" uuid NOT NULL,
	"stage_changed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"lost_reason" text,
	"sale_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone,
	CONSTRAINT "sales_ops_leads_estimated_value_check" CHECK ("sales_ops_leads"."estimated_value_brl" >= 0)
);
--> statement-breakpoint
CREATE TABLE "sales_ops_lead_products" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" text NOT NULL,
	"lead_id" uuid NOT NULL,
	"product_id" uuid,
	"product_name_snapshot" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "sales_ops_clients_org_id_id_idx" ON "sales_ops_clients" USING btree ("org_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "sales_ops_products_org_id_id_idx" ON "sales_ops_products" USING btree ("org_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "sales_ops_sales_org_id_id_idx" ON "sales_ops_sales" USING btree ("org_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "sales_ops_lead_stages_org_name_idx" ON "sales_ops_lead_stages" USING btree ("org_id","name");--> statement-breakpoint
CREATE UNIQUE INDEX "sales_ops_lead_stages_org_id_id_idx" ON "sales_ops_lead_stages" USING btree ("org_id","id");--> statement-breakpoint
CREATE INDEX "sales_ops_lead_stages_org_position_idx" ON "sales_ops_lead_stages" USING btree ("org_id","position");--> statement-breakpoint
CREATE UNIQUE INDEX "sales_ops_lead_stages_org_kind_idx" ON "sales_ops_lead_stages" USING btree ("org_id","kind") WHERE "sales_ops_lead_stages"."kind" <> 'normal';--> statement-breakpoint
CREATE UNIQUE INDEX "sales_ops_leads_org_id_id_idx" ON "sales_ops_leads" USING btree ("org_id","id");--> statement-breakpoint
CREATE INDEX "sales_ops_leads_org_stage_position_idx" ON "sales_ops_leads" USING btree ("org_id","stage_id","position");--> statement-breakpoint
CREATE INDEX "sales_ops_leads_org_seller_idx" ON "sales_ops_leads" USING btree ("org_id","seller_person_id");--> statement-breakpoint
CREATE UNIQUE INDEX "sales_ops_leads_org_sale_idx" ON "sales_ops_leads" USING btree ("org_id","sale_id") WHERE "sales_ops_leads"."sale_id" is not null;--> statement-breakpoint
CREATE INDEX "sales_ops_lead_products_org_lead_idx" ON "sales_ops_lead_products" USING btree ("org_id","lead_id");--> statement-breakpoint
ALTER TABLE "sales_ops_leads" ADD CONSTRAINT "sales_ops_leads_org_stage_fk" FOREIGN KEY ("org_id","stage_id") REFERENCES "public"."sales_ops_lead_stages"("org_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_ops_leads" ADD CONSTRAINT "sales_ops_leads_org_client_fk" FOREIGN KEY ("org_id","client_id") REFERENCES "public"."sales_ops_clients"("org_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_ops_leads" ADD CONSTRAINT "sales_ops_leads_org_seller_fk" FOREIGN KEY ("org_id","seller_person_id") REFERENCES "public"."sales_ops_people"("org_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_ops_leads" ADD CONSTRAINT "sales_ops_leads_org_sale_fk" FOREIGN KEY ("org_id","sale_id") REFERENCES "public"."sales_ops_sales"("org_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_ops_lead_products" ADD CONSTRAINT "sales_ops_lead_products_org_lead_fk" FOREIGN KEY ("org_id","lead_id") REFERENCES "public"."sales_ops_leads"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_ops_lead_products" ADD CONSTRAINT "sales_ops_lead_products_org_product_fk" FOREIGN KEY ("org_id","product_id") REFERENCES "public"."sales_ops_products"("org_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE sales_ops_lead_stages ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE sales_ops_lead_stages FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY sales_ops_lead_stages_tenant_isolation ON sales_ops_lead_stages
  AS PERMISSIVE FOR ALL
  USING (org_id = current_setting('app.current_org_id', true))
  WITH CHECK (org_id = current_setting('app.current_org_id', true));--> statement-breakpoint
CREATE POLICY sales_ops_lead_stages_admin_context ON sales_ops_lead_stages
  AS PERMISSIVE FOR ALL
  USING (current_setting('app.fxl_admin', true) = 'true')
  WITH CHECK (current_setting('app.fxl_admin', true) = 'true');--> statement-breakpoint
ALTER TABLE sales_ops_leads ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE sales_ops_leads FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY sales_ops_leads_tenant_isolation ON sales_ops_leads
  AS PERMISSIVE FOR ALL
  USING (org_id = current_setting('app.current_org_id', true))
  WITH CHECK (org_id = current_setting('app.current_org_id', true));--> statement-breakpoint
CREATE POLICY sales_ops_leads_admin_context ON sales_ops_leads
  AS PERMISSIVE FOR ALL
  USING (current_setting('app.fxl_admin', true) = 'true')
  WITH CHECK (current_setting('app.fxl_admin', true) = 'true');--> statement-breakpoint
ALTER TABLE sales_ops_lead_products ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE sales_ops_lead_products FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY sales_ops_lead_products_tenant_isolation ON sales_ops_lead_products
  AS PERMISSIVE FOR ALL
  USING (org_id = current_setting('app.current_org_id', true))
  WITH CHECK (org_id = current_setting('app.current_org_id', true));--> statement-breakpoint
CREATE POLICY sales_ops_lead_products_admin_context ON sales_ops_lead_products
  AS PERMISSIVE FOR ALL
  USING (current_setting('app.fxl_admin', true) = 'true')
  WITH CHECK (current_setting('app.fxl_admin', true) = 'true');--> statement-breakpoint
SELECT set_config('app.fxl_admin', 'true', true);--> statement-breakpoint
INSERT INTO "sales_ops_lead_stages" ("org_id", "name", "kind", "is_system", "position")
SELECT o."org_id", s."name", s."kind", s."is_system", s."position"
FROM (
  SELECT DISTINCT "org_id" FROM "sales_ops_people"
  UNION SELECT DISTINCT "org_id" FROM "sales_ops_settings"
  UNION SELECT DISTINCT "org_id" FROM "sales_ops_sales"
) AS o
CROSS JOIN (VALUES
  ('Novo',           'normal',     false, 1),
  ('Em negociação',  'normal',     false, 2),
  ('Proposta',       'conversion', true,  3),
  ('Perdido',        'lost',       true,  4)
) AS s("name", "kind", "is_system", "position")
ON CONFLICT DO NOTHING;
