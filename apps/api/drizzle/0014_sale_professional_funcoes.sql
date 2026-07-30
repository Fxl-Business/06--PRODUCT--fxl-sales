-- Profissionais alocados: bind a proposta's allocation to the funções cadastro.
--
-- Expand only. `funcao_id` + `funcao_name_snapshot` follow the repo's own
-- id + snapshot convention (client_name_snapshot, product_name_snapshot,
-- area_name_snapshot); the old free-text `role` is KEPT NOT NULL and written on
-- every insert with the same string as the snapshot, so nothing here is
-- destructive and a revert is clean. Dropping `role` belongs to a later contract
-- slice, exactly as 0012 deferred the person booleans.
--
-- The FK is composite (org_id, funcao_id), mirroring
-- sales_ops_person_funcoes_org_funcao_fk and
-- sales_ops_product_funcao_costs_org_funcao_fk: a foreign key does NOT consult
-- the RLS predicate, so a single-column FK would happily accept another org's
-- função id. Its target, sales_ops_funcoes_org_id_id_idx, is created by 0012 and
-- is therefore already present. MATCH SIMPLE (the default) skips the lookup
-- whenever any referencing column is NULL, which is what lets a legacy row keep
-- funcao_id IS NULL.
--
-- No RLS statements: sales_ops_sale_professionals already carries
-- sales_ops_sale_professionals_tenant_isolation and _admin_context from
-- 0007_marvelous_valeria_richards.sql, and a new column inherits them. That is
-- also why the backfill below needs the transaction-local admin context: it
-- writes across every org and the tenant policy would otherwise filter it away.
--
--   1. DDL
--   2. Backfill, behind the transaction-local admin context

-- 1. DDL
ALTER TABLE "sales_ops_sale_professionals" ADD COLUMN "funcao_id" uuid;--> statement-breakpoint
ALTER TABLE "sales_ops_sale_professionals" ADD COLUMN "funcao_name_snapshot" text DEFAULT '' NOT NULL;--> statement-breakpoint
CREATE INDEX "sales_ops_sale_professionals_org_funcao_idx" ON "sales_ops_sale_professionals" USING btree ("org_id","funcao_id");--> statement-breakpoint
ALTER TABLE "sales_ops_sale_professionals" ADD CONSTRAINT "sales_ops_sale_professionals_org_funcao_fk" FOREIGN KEY ("org_id","funcao_id") REFERENCES "public"."sales_ops_funcoes"("org_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint

-- 2. Backfill, behind the transaction-local admin context
SELECT set_config('app.fxl_admin', 'true', true);--> statement-breakpoint
UPDATE "sales_ops_sale_professionals"
SET "funcao_name_snapshot" = "role"
WHERE "funcao_name_snapshot" = '';--> statement-breakpoint
-- Case-insensitive and whitespace-trimmed, but deliberately NOT
-- diacritic-insensitive: that would need the unaccent extension, which this
-- database does not install. An unmatched role keeps funcao_id NULL and its
-- snapshot, because minting cadastro rows out of historical typos would be worse
-- than a null; the wizard renders such a row through the picker's valueLabel.
-- Both UPDATEs are guarded, so a replay is a no-op.
UPDATE "sales_ops_sale_professionals" sp
SET "funcao_id" = f."id"
FROM "sales_ops_funcoes" f
WHERE f."org_id" = sp."org_id"
  AND lower(btrim(f."name")) = lower(btrim(sp."role"))
  AND sp."funcao_id" IS NULL;
