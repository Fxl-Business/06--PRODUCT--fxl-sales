CREATE TABLE "sales_ops_areas" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" text NOT NULL,
	"name" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "sales_ops_products" ADD COLUMN "area_id" uuid;--> statement-breakpoint
CREATE UNIQUE INDEX "sales_ops_areas_org_name_idx" ON "sales_ops_areas" USING btree ("org_id","name");--> statement-breakpoint
ALTER TABLE "sales_ops_products" ADD CONSTRAINT "sales_ops_products_area_id_sales_ops_areas_id_fk" FOREIGN KEY ("area_id") REFERENCES "public"."sales_ops_areas"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE sales_ops_areas ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE sales_ops_areas FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY sales_ops_areas_tenant_isolation ON sales_ops_areas
  AS PERMISSIVE FOR ALL
  USING (org_id = current_setting('app.current_org_id', true))
  WITH CHECK (org_id = current_setting('app.current_org_id', true));--> statement-breakpoint
CREATE POLICY sales_ops_areas_admin_context ON sales_ops_areas
  AS PERMISSIVE FOR ALL
  USING (current_setting('app.fxl_admin', true) = 'true')
  WITH CHECK (current_setting('app.fxl_admin', true) = 'true');--> statement-breakpoint
SELECT set_config('app.fxl_admin', 'true', true);--> statement-breakpoint
INSERT INTO "sales_ops_areas" ("org_id", "name")
SELECT s."org_id", a."name"
FROM "sales_ops_settings" s
CROSS JOIN (VALUES ('FXL Tech'), ('FXL Visual'), ('FXL Advisor'), ('FXL BPO Sales'), ('FXL Influência Estratégica'), ('FXL Treinamentos')) AS a("name")
ON CONFLICT ("org_id", "name") DO NOTHING;