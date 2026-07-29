ALTER TABLE "sales_ops_sales" ALTER COLUMN "status" SET DEFAULT 'open';--> statement-breakpoint
ALTER TABLE "sales_ops_clients" ADD COLUMN "legal_name" text;--> statement-breakpoint
ALTER TABLE "sales_ops_clients" ADD COLUMN "document" text;--> statement-breakpoint
ALTER TABLE "sales_ops_clients" ADD COLUMN "address" text;--> statement-breakpoint
ALTER TABLE "sales_ops_clients" ADD COLUMN "legal_rep_name" text;--> statement-breakpoint
ALTER TABLE "sales_ops_clients" ADD COLUMN "legal_rep_document" text;--> statement-breakpoint
ALTER TABLE "sales_ops_payables" ADD COLUMN "receivable_id" uuid;--> statement-breakpoint
ALTER TABLE "sales_ops_receivables" ADD COLUMN "method" text DEFAULT 'pix' NOT NULL;--> statement-breakpoint
ALTER TABLE "sales_ops_sale_items" ADD COLUMN "area_id" uuid;--> statement-breakpoint
ALTER TABLE "sales_ops_sale_items" ADD COLUMN "area_name_snapshot" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "sales_ops_sales" ADD COLUMN "won_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "sales_ops_sales" ADD COLUMN "lost_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "sales_ops_payables" ADD CONSTRAINT "sales_ops_payables_receivable_id_sales_ops_receivables_id_fk" FOREIGN KEY ("receivable_id") REFERENCES "public"."sales_ops_receivables"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_ops_sale_items" ADD CONSTRAINT "sales_ops_sale_items_area_id_sales_ops_areas_id_fk" FOREIGN KEY ("area_id") REFERENCES "public"."sales_ops_areas"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
SELECT set_config('app.fxl_admin', 'true', true);--> statement-breakpoint
UPDATE "sales_ops_sales"
SET "status" = 'won',
    "won_at" = COALESCE("updated_at", "created_at")
WHERE "status" IN ('closed', 'completed');--> statement-breakpoint
UPDATE "sales_ops_sales"
SET "status" = 'open'
WHERE "status" IN ('forecast', 'in_progress');