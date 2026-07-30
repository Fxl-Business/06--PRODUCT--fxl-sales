CREATE TABLE "sales_ops_funcoes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" text NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"is_system" boolean DEFAULT false NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone,
	CONSTRAINT "sales_ops_funcoes_system_slug_check" CHECK (NOT is_system OR slug IN ('vendedor', 'finder'))
);
--> statement-breakpoint
CREATE TABLE "sales_ops_person_funcoes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" text NOT NULL,
	"person_id" uuid NOT NULL,
	"funcao_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "sales_ops_funcoes_org_slug_idx" ON "sales_ops_funcoes" USING btree ("org_id","slug");--> statement-breakpoint
CREATE UNIQUE INDEX "sales_ops_funcoes_org_name_idx" ON "sales_ops_funcoes" USING btree ("org_id","name");--> statement-breakpoint
CREATE UNIQUE INDEX "sales_ops_funcoes_org_id_id_idx" ON "sales_ops_funcoes" USING btree ("org_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "sales_ops_people_org_id_id_idx" ON "sales_ops_people" USING btree ("org_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "sales_ops_person_funcoes_org_person_funcao_idx" ON "sales_ops_person_funcoes" USING btree ("org_id","person_id","funcao_id");--> statement-breakpoint
CREATE INDEX "sales_ops_person_funcoes_org_funcao_idx" ON "sales_ops_person_funcoes" USING btree ("org_id","funcao_id");--> statement-breakpoint
ALTER TABLE "sales_ops_person_funcoes" ADD CONSTRAINT "sales_ops_person_funcoes_org_person_fk" FOREIGN KEY ("org_id","person_id") REFERENCES "public"."sales_ops_people"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_ops_person_funcoes" ADD CONSTRAINT "sales_ops_person_funcoes_org_funcao_fk" FOREIGN KEY ("org_id","funcao_id") REFERENCES "public"."sales_ops_funcoes"("org_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE sales_ops_funcoes ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE sales_ops_funcoes FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY sales_ops_funcoes_tenant_isolation ON sales_ops_funcoes
  AS PERMISSIVE FOR ALL
  USING (org_id = current_setting('app.current_org_id', true))
  WITH CHECK (org_id = current_setting('app.current_org_id', true));--> statement-breakpoint
CREATE POLICY sales_ops_funcoes_admin_context ON sales_ops_funcoes
  AS PERMISSIVE FOR ALL
  USING (current_setting('app.fxl_admin', true) = 'true')
  WITH CHECK (current_setting('app.fxl_admin', true) = 'true');--> statement-breakpoint
ALTER TABLE sales_ops_person_funcoes ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE sales_ops_person_funcoes FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY sales_ops_person_funcoes_tenant_isolation ON sales_ops_person_funcoes
  AS PERMISSIVE FOR ALL
  USING (org_id = current_setting('app.current_org_id', true))
  WITH CHECK (org_id = current_setting('app.current_org_id', true));--> statement-breakpoint
CREATE POLICY sales_ops_person_funcoes_admin_context ON sales_ops_person_funcoes
  AS PERMISSIVE FOR ALL
  USING (current_setting('app.fxl_admin', true) = 'true')
  WITH CHECK (current_setting('app.fxl_admin', true) = 'true');--> statement-breakpoint
SELECT set_config('app.fxl_admin', 'true', true);--> statement-breakpoint
INSERT INTO "sales_ops_funcoes" ("org_id", "name", "slug", "is_system")
SELECT o."org_id", f."name", f."slug", true
FROM (
  SELECT DISTINCT "org_id" FROM "sales_ops_people"
  UNION SELECT DISTINCT "org_id" FROM "sales_ops_settings"
  UNION SELECT DISTINCT "org_id" FROM "sales_ops_sales"
) AS o
CROSS JOIN (VALUES ('Vendedor', 'vendedor'), ('Finder', 'finder')) AS f("name", "slug")
ON CONFLICT ("org_id", "slug") DO NOTHING;--> statement-breakpoint
INSERT INTO "sales_ops_funcoes" ("org_id", "name", "slug", "is_system")
SELECT DISTINCT "org_id", 'Prestador', 'prestador', false
FROM "sales_ops_people"
WHERE "is_collaborator" = true
ON CONFLICT ("org_id", "slug") DO NOTHING;--> statement-breakpoint
INSERT INTO "sales_ops_person_funcoes" ("org_id", "person_id", "funcao_id")
SELECT p."org_id", p."id", f."id"
FROM "sales_ops_people" p
JOIN "sales_ops_funcoes" f ON f."org_id" = p."org_id" AND f."slug" = 'vendedor'
WHERE p."is_seller" = true
ON CONFLICT ("org_id", "person_id", "funcao_id") DO NOTHING;--> statement-breakpoint
INSERT INTO "sales_ops_person_funcoes" ("org_id", "person_id", "funcao_id")
SELECT p."org_id", p."id", f."id"
FROM "sales_ops_people" p
JOIN "sales_ops_funcoes" f ON f."org_id" = p."org_id" AND f."slug" = 'finder'
WHERE p."is_finder" = true
ON CONFLICT ("org_id", "person_id", "funcao_id") DO NOTHING;--> statement-breakpoint
INSERT INTO "sales_ops_person_funcoes" ("org_id", "person_id", "funcao_id")
SELECT p."org_id", p."id", f."id"
FROM "sales_ops_people" p
JOIN "sales_ops_funcoes" f ON f."org_id" = p."org_id" AND f."slug" = 'prestador'
WHERE p."is_collaborator" = true
ON CONFLICT ("org_id", "person_id", "funcao_id") DO NOTHING;
