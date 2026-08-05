-- Expand-only professional payable identity migration.
-- Ambiguous legacy snapshot matches remain null and are handled by the runtime multiset.
-- Both existing tables retain their current row-level security policies.
ALTER TABLE "sales_ops_payables" ADD COLUMN "sale_professional_id" uuid;--> statement-breakpoint
CREATE UNIQUE INDEX "sales_ops_sale_professionals_org_sale_id_id_idx" ON "sales_ops_sale_professionals" USING btree ("org_id","sale_id","id");--> statement-breakpoint
ALTER TABLE "sales_ops_payables" ADD CONSTRAINT "sales_ops_payables_org_sale_professional_fk" FOREIGN KEY ("org_id","sale_id","sale_professional_id") REFERENCES "public"."sales_ops_sale_professionals"("org_id","sale_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "sales_ops_payables_sale_professional_id_idx" ON "sales_ops_payables" USING btree ("sale_professional_id");--> statement-breakpoint
SELECT set_config('app.fxl_admin', 'true', true);--> statement-breakpoint
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
)
UPDATE "sales_ops_payables" p
SET "sale_professional_id" = match."sale_professional_id"
FROM "unambiguous_professional_matches" match
WHERE p."id" = match."payable_id"
  AND p."sale_professional_id" IS NULL;
