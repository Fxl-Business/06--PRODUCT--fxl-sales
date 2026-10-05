-- 0027_lead_contact_fields - contact details on a kanban lead.
--
-- The leads edition (sales.edition.leads) records a lead as a person to call:
-- phone, email and birth date, with no empresa, produtos or valor. These three
-- columns hold that. All are NULLABLE with no default, so every existing lead
-- reads NULL, no backfill is needed, and the full edition (FXL) never writes them.
--
-- contact_phone is free text (WhatsApp numbers, extensions, country codes);
-- contact_email is free text validated by the API, not by a CHECK; and
-- contact_birth_date is a civil day (date), never a timestamp, so no timezone
-- can move it.
--
-- sales_ops_leads already carries FORCE RLS and both org policies from 0022; a
-- new column inherits them, so no policy statement belongs here. Ordinary
-- (non-phased) migration: adding a nullable column without a default is a
-- catalog-only change.

ALTER TABLE "sales_ops_leads" ADD COLUMN "contact_phone" text;--> statement-breakpoint
ALTER TABLE "sales_ops_leads" ADD COLUMN "contact_email" text;--> statement-breakpoint
ALTER TABLE "sales_ops_leads" ADD COLUMN "contact_birth_date" date;