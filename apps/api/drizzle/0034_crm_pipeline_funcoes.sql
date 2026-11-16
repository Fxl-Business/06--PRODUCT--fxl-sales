-- 0034_crm_pipeline_funcoes - which funções reach a pipeline (vários funis por organização).
--
-- One NEW table, sales_ops_pipeline_funcoes (org_id, pipeline_id, funcao_id). A non-admin pessoa
-- reaches every active pipeline linked to one of her funções, and only the default pipeline when
-- none is linked (accessiblePipelineIds in packages/shared-utils/src/crm-model.ts). No row is
-- written here: every org starts with no link, so a pessoa holding only the vendedor função keeps
-- exactly the default pipeline she reaches today.
--
-- Both FKs are composite with org_id first and ON DELETE RESTRICT, like every CRM reference: a
-- pipeline is never deleted, and a função still linked to a pipeline is skipped by the nightly
-- purge of archived cadastros (it relies on 23503). The FK targets are the existing unique
-- (org_id, id) indexes of sales_ops_pipelines and sales_ops_funcoes.
--
-- Hand-edited after drizzle-kit generate: the header, the order CREATE TABLE, indexes, FKs, and
-- the FORCE ROW LEVEL SECURITY block with the tenant_isolation and admin_context policies spelled
-- exactly like 0029 (drizzle-kit does not emit RLS). 100% additive, no data statement, no privilege
-- statement. Ordinary (non-phased) migration through the shared runner.
CREATE TABLE "sales_ops_pipeline_funcoes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" text NOT NULL,
	"pipeline_id" uuid NOT NULL,
	"funcao_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "sales_ops_pipeline_funcoes_org_pipeline_funcao_idx" ON "sales_ops_pipeline_funcoes" USING btree ("org_id","pipeline_id","funcao_id");--> statement-breakpoint
CREATE INDEX "sales_ops_pipeline_funcoes_org_funcao_idx" ON "sales_ops_pipeline_funcoes" USING btree ("org_id","funcao_id");--> statement-breakpoint
ALTER TABLE "sales_ops_pipeline_funcoes" ADD CONSTRAINT "sales_ops_pipeline_funcoes_org_pipeline_fk" FOREIGN KEY ("org_id","pipeline_id") REFERENCES "public"."sales_ops_pipelines"("org_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_ops_pipeline_funcoes" ADD CONSTRAINT "sales_ops_pipeline_funcoes_org_funcao_fk" FOREIGN KEY ("org_id","funcao_id") REFERENCES "public"."sales_ops_funcoes"("org_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE sales_ops_pipeline_funcoes ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE sales_ops_pipeline_funcoes FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY sales_ops_pipeline_funcoes_tenant_isolation ON sales_ops_pipeline_funcoes
  AS PERMISSIVE FOR ALL
  USING (org_id = current_setting('app.current_org_id', true))
  WITH CHECK (org_id = current_setting('app.current_org_id', true));
--> statement-breakpoint
CREATE POLICY sales_ops_pipeline_funcoes_admin_context ON sales_ops_pipeline_funcoes
  AS PERMISSIVE FOR ALL
  USING (current_setting('app.fxl_admin', true) = 'true')
  WITH CHECK (current_setting('app.fxl_admin', true) = 'true');
