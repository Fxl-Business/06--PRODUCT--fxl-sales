-- fxl-migration-mode: phased
-- fxl-phase: column
ALTER TABLE "sales_ops_payables" ADD COLUMN IF NOT EXISTS "sale_professional_id" uuid;--> statement-breakpoint
-- fxl-phase: target-index
CREATE UNIQUE INDEX CONCURRENTLY "sales_ops_sale_professionals_org_sale_id_id_idx" ON "sales_ops_sale_professionals" USING btree ("org_id","sale_id","id");--> statement-breakpoint
-- fxl-phase: source-index
CREATE INDEX CONCURRENTLY "sales_ops_payables_sale_professional_id_idx" ON "sales_ops_payables" USING btree ("sale_professional_id");--> statement-breakpoint
-- fxl-phase: constraint
ALTER TABLE "sales_ops_payables" ADD CONSTRAINT "sales_ops_payables_org_sale_professional_fk" FOREIGN KEY ("org_id","sale_id","sale_professional_id") REFERENCES "public"."sales_ops_sale_professionals"("org_id","sale_id","id") ON DELETE restrict ON UPDATE no action NOT VALID;--> statement-breakpoint
-- fxl-phase: backfill-context
SELECT set_config('app.fxl_admin', 'true', true);--> statement-breakpoint
-- fxl-phase: backfill-repeat
WITH "unambiguous_professional_matches" AS (
  SELECT
    p."id" AS "payable_id",
    sp."id" AS "sale_professional_id"
  FROM "sales_ops_payables" p
  INNER JOIN "sales_ops_sale_professionals" sp
    ON sp."org_id" = p."org_id"
   AND sp."sale_id" = p."sale_id"
   AND sp."person_name_snapshot" = p."beneficiary_name"
  WHERE p."kind" = 'professional_cost'
    AND p."sale_professional_id" IS NULL
    AND NOT EXISTS (
      SELECT 1
      FROM "sales_ops_sale_professionals" other
      WHERE other."org_id" = sp."org_id"
        AND other."sale_id" = sp."sale_id"
        AND other."person_name_snapshot" = sp."person_name_snapshot"
        AND other."id" <> sp."id"
    )
  ORDER BY p."id"
  LIMIT 1000
  FOR UPDATE OF p SKIP LOCKED
)
UPDATE "sales_ops_payables" p
SET "sale_professional_id" = match."sale_professional_id"
FROM "unambiguous_professional_matches" match
WHERE p."id" = match."payable_id"
  AND p."sale_professional_id" IS NULL
RETURNING p."id";--> statement-breakpoint
-- fxl-phase: validate
ALTER TABLE "sales_ops_payables" VALIDATE CONSTRAINT "sales_ops_payables_org_sale_professional_fk";
