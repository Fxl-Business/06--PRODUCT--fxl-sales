-- 0032_lead_delete_batch - "Excluir todos os leads desta etapa" (api-lote).
--
-- One nullable column that groups the leads one bulk soft delete took out of an etapa, so
-- Cadastros > Leads excluídos can restore them together. NULL for a live lead and for a lead
-- deleted on its own (every existing row reads as before, no backfill); set by the bulk delete
-- together with deleted_at; cleared by every restore. It is a plain uuid, never a reference.
--
-- The PARTIAL index serves only the batch restore's read (one batch out of the whole table) and
-- costs nothing for rows outside a batch.
--
-- sales_ops_crm_leads already carries FORCE RLS and both org policies; a new column inherits
-- them. Ordinary (non-phased) migration: a nullable column with no default is catalog-only.
ALTER TABLE "sales_ops_crm_leads" ADD COLUMN "deleted_batch_id" uuid;--> statement-breakpoint
CREATE INDEX "sales_ops_crm_leads_org_deleted_batch_idx" ON "sales_ops_crm_leads" USING btree ("org_id","deleted_batch_id") WHERE "sales_ops_crm_leads"."deleted_batch_id" is not null;
