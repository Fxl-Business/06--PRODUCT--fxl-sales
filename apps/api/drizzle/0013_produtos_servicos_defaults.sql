-- Produtos & Serviços: one classification axis plus a default-configuration block.
--
-- `type` is RENAMED to `kind` rather than dropped and re-added, so the lineage of
-- sales_ops_sale_items.product_type_snapshot (whose whole meaning is "the
-- product's type at sale time") survives, and so the open_price flag stays the
-- source of the kind backfill.
--
-- Block order is load-bearing and hand-edited: drizzle-kit emits every
-- ADD CONSTRAINT ... CHECK together with the DDL, which would fail on any
-- existing open-price row carrying a non-zero own value. The CHECKs therefore sit
-- BELOW the backfill. sales_ops_funcoes_org_id_id_idx is created by 0012, not
-- here.
--
--   1. DDL
--   2. Backfill, behind the transaction-local admin context
--   3. CHECK constraints
--   4. RLS for the new child table

-- 1. DDL
ALTER TABLE "sales_ops_products" RENAME COLUMN "type" TO "kind";--> statement-breakpoint
ALTER TABLE "sales_ops_products" ALTER COLUMN "kind" SET DEFAULT 'product';--> statement-breakpoint
ALTER TABLE "sales_ops_products" ADD COLUMN "default_payment_method" text DEFAULT 'pix' NOT NULL;--> statement-breakpoint
ALTER TABLE "sales_ops_products" ADD COLUMN "default_entrada_mode" text DEFAULT 'none' NOT NULL;--> statement-breakpoint
ALTER TABLE "sales_ops_products" ADD COLUMN "default_entrada_pct" numeric(5, 2);--> statement-breakpoint
ALTER TABLE "sales_ops_products" ADD COLUMN "default_entrada_brl" integer;--> statement-breakpoint
ALTER TABLE "sales_ops_products" ADD COLUMN "default_remaining_installments" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "sales_ops_products" ADD COLUMN "default_recurring_cycles" integer DEFAULT 12;--> statement-breakpoint
CREATE TABLE "sales_ops_product_funcao_costs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" text NOT NULL,
	"product_id" uuid NOT NULL,
	"funcao_id" uuid NOT NULL,
	"mode" text NOT NULL,
	"value_pct" numeric(5, 2),
	"value_brl" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone,
	CONSTRAINT "sales_ops_product_funcao_costs_mode_check" CHECK (("sales_ops_product_funcao_costs"."mode" = 'pct' and "sales_ops_product_funcao_costs"."value_pct" is not null and "sales_ops_product_funcao_costs"."value_brl" is null)
        or ("sales_ops_product_funcao_costs"."mode" = 'fix' and "sales_ops_product_funcao_costs"."value_brl" is not null and "sales_ops_product_funcao_costs"."value_pct" is null))
);
--> statement-breakpoint
CREATE UNIQUE INDEX "sales_ops_product_funcao_costs_product_funcao_idx" ON "sales_ops_product_funcao_costs" USING btree ("product_id","funcao_id");--> statement-breakpoint
CREATE INDEX "sales_ops_product_funcao_costs_org_product_idx" ON "sales_ops_product_funcao_costs" USING btree ("org_id","product_id");--> statement-breakpoint
ALTER TABLE "sales_ops_product_funcao_costs" ADD CONSTRAINT "sales_ops_product_funcao_costs_product_id_sales_ops_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."sales_ops_products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_ops_product_funcao_costs" ADD CONSTRAINT "sales_ops_product_funcao_costs_org_funcao_fk" FOREIGN KEY ("org_id","funcao_id") REFERENCES "public"."sales_ops_funcoes"("org_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
-- 2. Backfill, behind the transaction-local admin context (sales_ops_products has FORCE RLS).
-- open_price already means "no own price, the operator types the label and the
-- value per proposta", which is exactly a Serviço, so it is the only honest source
-- for kind: the old `type` column held the constant 'SaaS' and carried zero
-- information. Zeroing the own value of an open-price row is not data loss: the
-- product dialog has always forced both to zero when "Preço aberto" was on, and
-- every read path skips them.
SELECT set_config('app.fxl_admin', 'true', true);--> statement-breakpoint
UPDATE "sales_ops_products"
SET "kind" = CASE WHEN "open_price" THEN 'service' ELSE 'product' END;--> statement-breakpoint
UPDATE "sales_ops_products"
SET "setup_brl" = 0, "monthly_brl" = 0
WHERE "open_price";--> statement-breakpoint
-- 3. CHECK constraints, moved below the backfill by hand.
ALTER TABLE "sales_ops_products" ADD CONSTRAINT "sales_ops_products_kind_check" CHECK ("sales_ops_products"."kind" in ('product', 'service'));--> statement-breakpoint
ALTER TABLE "sales_ops_products" ADD CONSTRAINT "sales_ops_products_kind_open_price_check" CHECK (("sales_ops_products"."kind" = 'service') = "sales_ops_products"."open_price");--> statement-breakpoint
ALTER TABLE "sales_ops_products" ADD CONSTRAINT "sales_ops_products_service_no_fixed_value_check" CHECK ("sales_ops_products"."kind" <> 'service' or ("sales_ops_products"."setup_brl" = 0 and "sales_ops_products"."monthly_brl" = 0));--> statement-breakpoint
ALTER TABLE "sales_ops_products" ADD CONSTRAINT "sales_ops_products_default_entrada_mode_check" CHECK (("sales_ops_products"."default_entrada_mode" = 'none' and "sales_ops_products"."default_entrada_pct" is null and "sales_ops_products"."default_entrada_brl" is null)
        or ("sales_ops_products"."default_entrada_mode" = 'pct' and "sales_ops_products"."default_entrada_pct" is not null and "sales_ops_products"."default_entrada_brl" is null)
        or ("sales_ops_products"."default_entrada_mode" = 'fix' and "sales_ops_products"."default_entrada_brl" is not null and "sales_ops_products"."default_entrada_pct" is null));--> statement-breakpoint
ALTER TABLE "sales_ops_products" ADD CONSTRAINT "sales_ops_products_default_installments_check" CHECK ("sales_ops_products"."default_remaining_installments" between 1 and 120);--> statement-breakpoint
ALTER TABLE "sales_ops_products" ADD CONSTRAINT "sales_ops_products_default_recurring_cycles_check" CHECK ("sales_ops_products"."default_recurring_cycles" is null or "sales_ops_products"."default_recurring_cycles" between 1 and 120);--> statement-breakpoint
-- 4. RLS for the new child table, mirroring 0010_sales_ops_areas.sql.
ALTER TABLE sales_ops_product_funcao_costs ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE sales_ops_product_funcao_costs FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY sales_ops_product_funcao_costs_tenant_isolation ON sales_ops_product_funcao_costs
  AS PERMISSIVE FOR ALL
  USING (org_id = current_setting('app.current_org_id', true))
  WITH CHECK (org_id = current_setting('app.current_org_id', true));--> statement-breakpoint
CREATE POLICY sales_ops_product_funcao_costs_admin_context ON sales_ops_product_funcao_costs
  AS PERMISSIVE FOR ALL
  USING (current_setting('app.fxl_admin', true) = 'true')
  WITH CHECK (current_setting('app.fxl_admin', true) = 'true');
