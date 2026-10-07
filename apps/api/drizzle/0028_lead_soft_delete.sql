-- 0028_lead_soft_delete - the lead lixeira (lead-lixeira slice 01).
--
-- Deleting a lead is a SOFT delete the gestor can undo from Cadastros > Leads
-- excluídos, never a hard DELETE: the product's archive-never-delete rule, and a
-- deleted lead still names a cliente, a pessoa and an etapa that carry history.
-- Three NULLABLE columns with no default, so every existing lead reads as live
-- and no backfill is needed:
--   deleted_at          when it was deleted; NULL is live, the one predicate
--                       liveLeadCondition() in leads/lead-service.ts spells;
--   deleted_by_user_id  the Hub account id of the actor, never sent to a client;
--   deleted_by_name     the actor display name snapshotted from the token (name,
--                       then e-mail, then NULL): there is no Hub account
--                       directory to resolve an account id later.
--
-- The CHECK makes a half-deleted row unrepresentable (a time without an actor,
-- or an actor without a time). deleted_by_name stays outside it because a token
-- may carry neither a name nor an e-mail.
--
-- The PARTIAL index serves only the deleted list's keyset read (newest first,
-- id as the tiebreaker) and costs nothing for live rows.
--
-- sales_ops_leads already carries FORCE RLS and both org policies from 0022; new
-- columns inherit them, so no policy statement belongs here. Ordinary
-- (non-phased) migration: nullable columns with no default are catalog-only, and
-- the CHECK validates in one scan that every existing row (NULL, NULL) passes.
ALTER TABLE "sales_ops_leads" ADD COLUMN "deleted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "sales_ops_leads" ADD COLUMN "deleted_by_user_id" text;--> statement-breakpoint
ALTER TABLE "sales_ops_leads" ADD COLUMN "deleted_by_name" text;--> statement-breakpoint
CREATE INDEX "sales_ops_leads_org_deleted_idx" ON "sales_ops_leads" USING btree ("org_id","deleted_at","id") WHERE "sales_ops_leads"."deleted_at" is not null;--> statement-breakpoint
ALTER TABLE "sales_ops_leads" ADD CONSTRAINT "sales_ops_leads_deleted_pair_check" CHECK (("sales_ops_leads"."deleted_at" is null) = ("sales_ops_leads"."deleted_by_user_id" is null));