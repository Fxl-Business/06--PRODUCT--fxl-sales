-- 0029_crm_unificado_modelo - the unified CRM model (vendas-crm-unificado phase 1b).
--
-- 100% additive: ten NEW tables, no column, index, policy or trigger on any existing table.
-- sales_ops_leads, sales_ops_lead_products and sales_ops_lead_stages stay byte-intact until the
-- phase 2 cutover; migration 0030 COPIES their rows (same uuids) into these tables.
-- See nexo/knowledge/decisions/2026-10-21-crm-unificado-modelo.md for every decision below.
--
-- Hand-edited after drizzle-kit generate, in two ways only:
--   1. statements are ordered CREATE TABLE, then indexes, then FKs, because drizzle-kit emits the
--      composite FKs first and their target UNIQUE (org_id, id) indexes would not exist yet;
--   2. the FORCE ROW LEVEL SECURITY block with the tenant_isolation and admin_context policies
--      (drizzle-kit does not emit RLS) is appended, spelled exactly like 0022.
--
-- Enumerations that may grow (stage behavior, field kind, reference target, module key, event
-- kind, module source) carry NO CHECK: the additive guard forbids DROP CONSTRAINT, so a CHECK
-- could never be widened. They are validated by zod and packages/shared-utils/src/crm-model.ts.
-- Closed sets (stage type, exit_kind, status) keep their CHECK.
--
-- No privilege statement appears here (single-role database contract). Ordinary non-phased migration.
CREATE TABLE "sales_ops_crm_lead_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" text NOT NULL,
	"lead_id" uuid NOT NULL,
	"kind" text DEFAULT 'stage_changed' NOT NULL,
	"from_stage_id" uuid,
	"to_stage_id" uuid,
	"reason" text,
	"actor_user_id" text,
	"actor_name_snapshot" text,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sales_ops_crm_lead_field_values" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" text NOT NULL,
	"lead_id" uuid NOT NULL,
	"field_id" uuid NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"value_text" text,
	"value_number" numeric(20, 6),
	"value_cents" bigint,
	"value_date" date,
	"value_option" text,
	"value_client_id" uuid,
	"value_product_id" uuid,
	"value_sale_id" uuid,
	"ref_name_snapshot" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone,
	CONSTRAINT "sales_ops_crm_lead_field_values_one_slot_check" CHECK (num_nonnulls("sales_ops_crm_lead_field_values"."value_text", "sales_ops_crm_lead_field_values"."value_number", "sales_ops_crm_lead_field_values"."value_cents", "sales_ops_crm_lead_field_values"."value_date", "sales_ops_crm_lead_field_values"."value_option", "sales_ops_crm_lead_field_values"."value_client_id", "sales_ops_crm_lead_field_values"."value_product_id", "sales_ops_crm_lead_field_values"."value_sale_id") = 1),
	CONSTRAINT "sales_ops_crm_lead_field_values_position_check" CHECK ("sales_ops_crm_lead_field_values"."position" >= 0)
);
--> statement-breakpoint
CREATE TABLE "sales_ops_crm_lead_followups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" text NOT NULL,
	"lead_id" uuid NOT NULL,
	"next_step" text NOT NULL,
	"due_on" date NOT NULL,
	"owner_person_id" uuid,
	"owner_name_snapshot" text,
	"done_at" timestamp with time zone,
	"created_by_user_id" text,
	"created_by_name" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone,
	CONSTRAINT "sales_ops_crm_lead_followups_step_check" CHECK (length(btrim("sales_ops_crm_lead_followups"."next_step")) > 0)
);
--> statement-breakpoint
CREATE TABLE "sales_ops_crm_lead_notes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" text NOT NULL,
	"lead_id" uuid NOT NULL,
	"event_id" uuid,
	"body" text NOT NULL,
	"author_user_id" text,
	"author_name_snapshot" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sales_ops_crm_lead_notes_body_check" CHECK (length(btrim("sales_ops_crm_lead_notes"."body")) > 0)
);
--> statement-breakpoint
CREATE TABLE "sales_ops_crm_leads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" text NOT NULL,
	"contact_name" text NOT NULL,
	"contact_phone" text,
	"contact_email" text,
	"pipeline_id" uuid NOT NULL,
	"stage_id" uuid NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"stage_changed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"seller_person_id" uuid,
	"seller_name_snapshot" text DEFAULT '' NOT NULL,
	"client_id" uuid,
	"client_name_snapshot" text DEFAULT '' NOT NULL,
	"estimated_value_brl" integer DEFAULT 0 NOT NULL,
	"lost_reason" text,
	"sale_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone,
	"deleted_at" timestamp with time zone,
	"deleted_by_user_id" text,
	"deleted_by_name" text,
	CONSTRAINT "sales_ops_crm_leads_estimated_value_check" CHECK ("sales_ops_crm_leads"."estimated_value_brl" >= 0),
	CONSTRAINT "sales_ops_crm_leads_deleted_pair_check" CHECK (("sales_ops_crm_leads"."deleted_at" is null) = ("sales_ops_crm_leads"."deleted_by_user_id" is null))
);
--> statement-breakpoint
CREATE TABLE "sales_ops_field_definitions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" text NOT NULL,
	"key" text NOT NULL,
	"label" text NOT NULL,
	"kind" text DEFAULT 'text' NOT NULL,
	"reference_target" text,
	"multiple" boolean DEFAULT false NOT NULL,
	"options" jsonb,
	"filterable" boolean DEFAULT false NOT NULL,
	"is_system" boolean DEFAULT false NOT NULL,
	"removable" boolean DEFAULT true NOT NULL,
	"backing_column" text,
	"position" integer DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone,
	CONSTRAINT "sales_ops_field_definitions_status_check" CHECK ("sales_ops_field_definitions"."status" in ('active', 'archived')),
	CONSTRAINT "sales_ops_field_definitions_removable_check" CHECK ("sales_ops_field_definitions"."removable" or "sales_ops_field_definitions"."is_system"),
	CONSTRAINT "sales_ops_field_definitions_reference_check" CHECK (("sales_ops_field_definitions"."kind" = 'reference') = ("sales_ops_field_definitions"."reference_target" is not null))
);
--> statement-breakpoint
CREATE TABLE "sales_ops_org_modules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" text NOT NULL,
	"module_key" text NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"source" text DEFAULT 'default' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "sales_ops_pipeline_stages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" text NOT NULL,
	"pipeline_id" uuid NOT NULL,
	"name" text NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"type" text DEFAULT 'normal' NOT NULL,
	"behavior" text DEFAULT 'none' NOT NULL,
	"exit_kind" text,
	"requires_reason" boolean DEFAULT false NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone,
	CONSTRAINT "sales_ops_pipeline_stages_type_check" CHECK ("sales_ops_pipeline_stages"."type" in ('normal', 'orcamento', 'saida')),
	CONSTRAINT "sales_ops_pipeline_stages_exit_kind_check" CHECK ("sales_ops_pipeline_stages"."exit_kind" in ('ganho', 'perdido', 'pausado')),
	CONSTRAINT "sales_ops_pipeline_stages_exit_pair_check" CHECK (("sales_ops_pipeline_stages"."type" = 'saida') = ("sales_ops_pipeline_stages"."exit_kind" is not null)),
	CONSTRAINT "sales_ops_pipeline_stages_reason_check" CHECK (not "sales_ops_pipeline_stages"."requires_reason" or "sales_ops_pipeline_stages"."exit_kind" = 'perdido'),
	CONSTRAINT "sales_ops_pipeline_stages_status_check" CHECK ("sales_ops_pipeline_stages"."status" in ('active', 'archived'))
);
--> statement-breakpoint
CREATE TABLE "sales_ops_pipeline_transitions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" text NOT NULL,
	"pipeline_id" uuid NOT NULL,
	"from_stage_id" uuid NOT NULL,
	"to_stage_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sales_ops_pipeline_transitions_distinct_check" CHECK ("sales_ops_pipeline_transitions"."from_stage_id" <> "sales_ops_pipeline_transitions"."to_stage_id")
);
--> statement-breakpoint
CREATE TABLE "sales_ops_pipelines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" text NOT NULL,
	"name" text NOT NULL,
	"system_key" text,
	"position" integer DEFAULT 0 NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone,
	CONSTRAINT "sales_ops_pipelines_status_check" CHECK ("sales_ops_pipelines"."status" in ('active', 'archived'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX "sales_ops_crm_lead_events_org_id_id_idx" ON "sales_ops_crm_lead_events" USING btree ("org_id","id");
--> statement-breakpoint
CREATE INDEX "sales_ops_crm_lead_events_org_lead_idx" ON "sales_ops_crm_lead_events" USING btree ("org_id","lead_id","occurred_at","id");
--> statement-breakpoint
CREATE UNIQUE INDEX "sales_ops_crm_lead_events_first_entry_idx" ON "sales_ops_crm_lead_events" USING btree ("org_id","lead_id") WHERE "sales_ops_crm_lead_events"."from_stage_id" is null and "sales_ops_crm_lead_events"."kind" = 'stage_changed';
--> statement-breakpoint
CREATE UNIQUE INDEX "sales_ops_crm_lead_field_values_slot_idx" ON "sales_ops_crm_lead_field_values" USING btree ("org_id","lead_id","field_id","position");
--> statement-breakpoint
CREATE INDEX "sales_ops_crm_lead_field_values_org_lead_idx" ON "sales_ops_crm_lead_field_values" USING btree ("org_id","lead_id");
--> statement-breakpoint
CREATE INDEX "sales_ops_crm_lead_field_values_text_idx" ON "sales_ops_crm_lead_field_values" USING btree ("org_id","field_id","value_text") WHERE "sales_ops_crm_lead_field_values"."value_text" is not null;
--> statement-breakpoint
CREATE INDEX "sales_ops_crm_lead_field_values_number_idx" ON "sales_ops_crm_lead_field_values" USING btree ("org_id","field_id","value_number") WHERE "sales_ops_crm_lead_field_values"."value_number" is not null;
--> statement-breakpoint
CREATE INDEX "sales_ops_crm_lead_field_values_cents_idx" ON "sales_ops_crm_lead_field_values" USING btree ("org_id","field_id","value_cents") WHERE "sales_ops_crm_lead_field_values"."value_cents" is not null;
--> statement-breakpoint
CREATE INDEX "sales_ops_crm_lead_field_values_date_idx" ON "sales_ops_crm_lead_field_values" USING btree ("org_id","field_id","value_date") WHERE "sales_ops_crm_lead_field_values"."value_date" is not null;
--> statement-breakpoint
CREATE INDEX "sales_ops_crm_lead_field_values_option_idx" ON "sales_ops_crm_lead_field_values" USING btree ("org_id","field_id","value_option") WHERE "sales_ops_crm_lead_field_values"."value_option" is not null;
--> statement-breakpoint
CREATE INDEX "sales_ops_crm_lead_field_values_client_idx" ON "sales_ops_crm_lead_field_values" USING btree ("org_id","value_client_id") WHERE "sales_ops_crm_lead_field_values"."value_client_id" is not null;
--> statement-breakpoint
CREATE INDEX "sales_ops_crm_lead_field_values_product_idx" ON "sales_ops_crm_lead_field_values" USING btree ("org_id","value_product_id") WHERE "sales_ops_crm_lead_field_values"."value_product_id" is not null;
--> statement-breakpoint
CREATE INDEX "sales_ops_crm_lead_field_values_sale_idx" ON "sales_ops_crm_lead_field_values" USING btree ("org_id","value_sale_id") WHERE "sales_ops_crm_lead_field_values"."value_sale_id" is not null;
--> statement-breakpoint
CREATE INDEX "sales_ops_crm_lead_followups_org_lead_idx" ON "sales_ops_crm_lead_followups" USING btree ("org_id","lead_id");
--> statement-breakpoint
CREATE INDEX "sales_ops_crm_lead_followups_org_open_due_idx" ON "sales_ops_crm_lead_followups" USING btree ("org_id","due_on") WHERE "sales_ops_crm_lead_followups"."done_at" is null;
--> statement-breakpoint
CREATE INDEX "sales_ops_crm_lead_notes_org_lead_idx" ON "sales_ops_crm_lead_notes" USING btree ("org_id","lead_id","created_at");
--> statement-breakpoint
CREATE UNIQUE INDEX "sales_ops_crm_leads_org_id_id_idx" ON "sales_ops_crm_leads" USING btree ("org_id","id");
--> statement-breakpoint
CREATE INDEX "sales_ops_crm_leads_org_stage_position_idx" ON "sales_ops_crm_leads" USING btree ("org_id","stage_id","position");
--> statement-breakpoint
CREATE INDEX "sales_ops_crm_leads_org_pipeline_idx" ON "sales_ops_crm_leads" USING btree ("org_id","pipeline_id");
--> statement-breakpoint
CREATE INDEX "sales_ops_crm_leads_org_seller_idx" ON "sales_ops_crm_leads" USING btree ("org_id","seller_person_id");
--> statement-breakpoint
CREATE INDEX "sales_ops_crm_leads_org_created_idx" ON "sales_ops_crm_leads" USING btree ("org_id","created_at");
--> statement-breakpoint
CREATE UNIQUE INDEX "sales_ops_crm_leads_org_sale_idx" ON "sales_ops_crm_leads" USING btree ("org_id","sale_id") WHERE "sales_ops_crm_leads"."sale_id" is not null;
--> statement-breakpoint
CREATE INDEX "sales_ops_crm_leads_org_deleted_idx" ON "sales_ops_crm_leads" USING btree ("org_id","deleted_at","id") WHERE "sales_ops_crm_leads"."deleted_at" is not null;
--> statement-breakpoint
CREATE UNIQUE INDEX "sales_ops_field_definitions_org_id_id_idx" ON "sales_ops_field_definitions" USING btree ("org_id","id");
--> statement-breakpoint
CREATE UNIQUE INDEX "sales_ops_field_definitions_org_key_idx" ON "sales_ops_field_definitions" USING btree ("org_id","key");
--> statement-breakpoint
CREATE INDEX "sales_ops_field_definitions_org_position_idx" ON "sales_ops_field_definitions" USING btree ("org_id","position");
--> statement-breakpoint
CREATE UNIQUE INDEX "sales_ops_org_modules_org_key_idx" ON "sales_ops_org_modules" USING btree ("org_id","module_key");
--> statement-breakpoint
CREATE UNIQUE INDEX "sales_ops_pipeline_stages_org_id_id_idx" ON "sales_ops_pipeline_stages" USING btree ("org_id","id");
--> statement-breakpoint
CREATE UNIQUE INDEX "sales_ops_pipeline_stages_org_pipeline_id_idx" ON "sales_ops_pipeline_stages" USING btree ("org_id","pipeline_id","id");
--> statement-breakpoint
CREATE UNIQUE INDEX "sales_ops_pipeline_stages_org_pipeline_name_idx" ON "sales_ops_pipeline_stages" USING btree ("org_id","pipeline_id","name");
--> statement-breakpoint
CREATE INDEX "sales_ops_pipeline_stages_org_pipeline_position_idx" ON "sales_ops_pipeline_stages" USING btree ("org_id","pipeline_id","position");
--> statement-breakpoint
CREATE UNIQUE INDEX "sales_ops_pipeline_transitions_org_from_to_idx" ON "sales_ops_pipeline_transitions" USING btree ("org_id","from_stage_id","to_stage_id");
--> statement-breakpoint
CREATE INDEX "sales_ops_pipeline_transitions_org_pipeline_idx" ON "sales_ops_pipeline_transitions" USING btree ("org_id","pipeline_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "sales_ops_pipelines_org_id_id_idx" ON "sales_ops_pipelines" USING btree ("org_id","id");
--> statement-breakpoint
CREATE UNIQUE INDEX "sales_ops_pipelines_org_name_idx" ON "sales_ops_pipelines" USING btree ("org_id","name");
--> statement-breakpoint
CREATE UNIQUE INDEX "sales_ops_pipelines_org_system_key_idx" ON "sales_ops_pipelines" USING btree ("org_id","system_key") WHERE "sales_ops_pipelines"."system_key" is not null;
--> statement-breakpoint
CREATE UNIQUE INDEX "sales_ops_pipelines_org_default_idx" ON "sales_ops_pipelines" USING btree ("org_id") WHERE "sales_ops_pipelines"."is_default";
--> statement-breakpoint
ALTER TABLE "sales_ops_crm_lead_events" ADD CONSTRAINT "sales_ops_crm_lead_events_org_lead_fk" FOREIGN KEY ("org_id","lead_id") REFERENCES "public"."sales_ops_crm_leads"("org_id","id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "sales_ops_crm_lead_events" ADD CONSTRAINT "sales_ops_crm_lead_events_org_from_fk" FOREIGN KEY ("org_id","from_stage_id") REFERENCES "public"."sales_ops_pipeline_stages"("org_id","id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "sales_ops_crm_lead_events" ADD CONSTRAINT "sales_ops_crm_lead_events_org_to_fk" FOREIGN KEY ("org_id","to_stage_id") REFERENCES "public"."sales_ops_pipeline_stages"("org_id","id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "sales_ops_crm_lead_field_values" ADD CONSTRAINT "sales_ops_crm_lead_field_values_org_lead_fk" FOREIGN KEY ("org_id","lead_id") REFERENCES "public"."sales_ops_crm_leads"("org_id","id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "sales_ops_crm_lead_field_values" ADD CONSTRAINT "sales_ops_crm_lead_field_values_org_field_fk" FOREIGN KEY ("org_id","field_id") REFERENCES "public"."sales_ops_field_definitions"("org_id","id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "sales_ops_crm_lead_field_values" ADD CONSTRAINT "sales_ops_crm_lead_field_values_org_client_fk" FOREIGN KEY ("org_id","value_client_id") REFERENCES "public"."sales_ops_clients"("org_id","id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "sales_ops_crm_lead_field_values" ADD CONSTRAINT "sales_ops_crm_lead_field_values_org_product_fk" FOREIGN KEY ("org_id","value_product_id") REFERENCES "public"."sales_ops_products"("org_id","id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "sales_ops_crm_lead_field_values" ADD CONSTRAINT "sales_ops_crm_lead_field_values_org_sale_fk" FOREIGN KEY ("org_id","value_sale_id") REFERENCES "public"."sales_ops_sales"("org_id","id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "sales_ops_crm_lead_followups" ADD CONSTRAINT "sales_ops_crm_lead_followups_org_lead_fk" FOREIGN KEY ("org_id","lead_id") REFERENCES "public"."sales_ops_crm_leads"("org_id","id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "sales_ops_crm_lead_followups" ADD CONSTRAINT "sales_ops_crm_lead_followups_org_owner_fk" FOREIGN KEY ("org_id","owner_person_id") REFERENCES "public"."sales_ops_people"("org_id","id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "sales_ops_crm_lead_notes" ADD CONSTRAINT "sales_ops_crm_lead_notes_org_lead_fk" FOREIGN KEY ("org_id","lead_id") REFERENCES "public"."sales_ops_crm_leads"("org_id","id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "sales_ops_crm_lead_notes" ADD CONSTRAINT "sales_ops_crm_lead_notes_org_event_fk" FOREIGN KEY ("org_id","event_id") REFERENCES "public"."sales_ops_crm_lead_events"("org_id","id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "sales_ops_crm_leads" ADD CONSTRAINT "sales_ops_crm_leads_org_pipeline_fk" FOREIGN KEY ("org_id","pipeline_id") REFERENCES "public"."sales_ops_pipelines"("org_id","id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "sales_ops_crm_leads" ADD CONSTRAINT "sales_ops_crm_leads_org_stage_fk" FOREIGN KEY ("org_id","pipeline_id","stage_id") REFERENCES "public"."sales_ops_pipeline_stages"("org_id","pipeline_id","id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "sales_ops_crm_leads" ADD CONSTRAINT "sales_ops_crm_leads_org_client_fk" FOREIGN KEY ("org_id","client_id") REFERENCES "public"."sales_ops_clients"("org_id","id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "sales_ops_crm_leads" ADD CONSTRAINT "sales_ops_crm_leads_org_seller_fk" FOREIGN KEY ("org_id","seller_person_id") REFERENCES "public"."sales_ops_people"("org_id","id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "sales_ops_crm_leads" ADD CONSTRAINT "sales_ops_crm_leads_org_sale_fk" FOREIGN KEY ("org_id","sale_id") REFERENCES "public"."sales_ops_sales"("org_id","id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "sales_ops_pipeline_stages" ADD CONSTRAINT "sales_ops_pipeline_stages_org_pipeline_fk" FOREIGN KEY ("org_id","pipeline_id") REFERENCES "public"."sales_ops_pipelines"("org_id","id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "sales_ops_pipeline_transitions" ADD CONSTRAINT "sales_ops_pipeline_transitions_org_from_fk" FOREIGN KEY ("org_id","pipeline_id","from_stage_id") REFERENCES "public"."sales_ops_pipeline_stages"("org_id","pipeline_id","id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "sales_ops_pipeline_transitions" ADD CONSTRAINT "sales_ops_pipeline_transitions_org_to_fk" FOREIGN KEY ("org_id","pipeline_id","to_stage_id") REFERENCES "public"."sales_ops_pipeline_stages"("org_id","pipeline_id","id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE sales_ops_pipelines ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE sales_ops_pipelines FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY sales_ops_pipelines_tenant_isolation ON sales_ops_pipelines
  AS PERMISSIVE FOR ALL
  USING (org_id = current_setting('app.current_org_id', true))
  WITH CHECK (org_id = current_setting('app.current_org_id', true));
--> statement-breakpoint
CREATE POLICY sales_ops_pipelines_admin_context ON sales_ops_pipelines
  AS PERMISSIVE FOR ALL
  USING (current_setting('app.fxl_admin', true) = 'true')
  WITH CHECK (current_setting('app.fxl_admin', true) = 'true');
--> statement-breakpoint
ALTER TABLE sales_ops_pipeline_stages ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE sales_ops_pipeline_stages FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY sales_ops_pipeline_stages_tenant_isolation ON sales_ops_pipeline_stages
  AS PERMISSIVE FOR ALL
  USING (org_id = current_setting('app.current_org_id', true))
  WITH CHECK (org_id = current_setting('app.current_org_id', true));
--> statement-breakpoint
CREATE POLICY sales_ops_pipeline_stages_admin_context ON sales_ops_pipeline_stages
  AS PERMISSIVE FOR ALL
  USING (current_setting('app.fxl_admin', true) = 'true')
  WITH CHECK (current_setting('app.fxl_admin', true) = 'true');
--> statement-breakpoint
ALTER TABLE sales_ops_pipeline_transitions ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE sales_ops_pipeline_transitions FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY sales_ops_pipeline_transitions_tenant_isolation ON sales_ops_pipeline_transitions
  AS PERMISSIVE FOR ALL
  USING (org_id = current_setting('app.current_org_id', true))
  WITH CHECK (org_id = current_setting('app.current_org_id', true));
--> statement-breakpoint
CREATE POLICY sales_ops_pipeline_transitions_admin_context ON sales_ops_pipeline_transitions
  AS PERMISSIVE FOR ALL
  USING (current_setting('app.fxl_admin', true) = 'true')
  WITH CHECK (current_setting('app.fxl_admin', true) = 'true');
--> statement-breakpoint
ALTER TABLE sales_ops_field_definitions ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE sales_ops_field_definitions FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY sales_ops_field_definitions_tenant_isolation ON sales_ops_field_definitions
  AS PERMISSIVE FOR ALL
  USING (org_id = current_setting('app.current_org_id', true))
  WITH CHECK (org_id = current_setting('app.current_org_id', true));
--> statement-breakpoint
CREATE POLICY sales_ops_field_definitions_admin_context ON sales_ops_field_definitions
  AS PERMISSIVE FOR ALL
  USING (current_setting('app.fxl_admin', true) = 'true')
  WITH CHECK (current_setting('app.fxl_admin', true) = 'true');
--> statement-breakpoint
ALTER TABLE sales_ops_crm_leads ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE sales_ops_crm_leads FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY sales_ops_crm_leads_tenant_isolation ON sales_ops_crm_leads
  AS PERMISSIVE FOR ALL
  USING (org_id = current_setting('app.current_org_id', true))
  WITH CHECK (org_id = current_setting('app.current_org_id', true));
--> statement-breakpoint
CREATE POLICY sales_ops_crm_leads_admin_context ON sales_ops_crm_leads
  AS PERMISSIVE FOR ALL
  USING (current_setting('app.fxl_admin', true) = 'true')
  WITH CHECK (current_setting('app.fxl_admin', true) = 'true');
--> statement-breakpoint
ALTER TABLE sales_ops_crm_lead_field_values ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE sales_ops_crm_lead_field_values FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY sales_ops_crm_lead_field_values_tenant_isolation ON sales_ops_crm_lead_field_values
  AS PERMISSIVE FOR ALL
  USING (org_id = current_setting('app.current_org_id', true))
  WITH CHECK (org_id = current_setting('app.current_org_id', true));
--> statement-breakpoint
CREATE POLICY sales_ops_crm_lead_field_values_admin_context ON sales_ops_crm_lead_field_values
  AS PERMISSIVE FOR ALL
  USING (current_setting('app.fxl_admin', true) = 'true')
  WITH CHECK (current_setting('app.fxl_admin', true) = 'true');
--> statement-breakpoint
ALTER TABLE sales_ops_crm_lead_events ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE sales_ops_crm_lead_events FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY sales_ops_crm_lead_events_tenant_isolation ON sales_ops_crm_lead_events
  AS PERMISSIVE FOR ALL
  USING (org_id = current_setting('app.current_org_id', true))
  WITH CHECK (org_id = current_setting('app.current_org_id', true));
--> statement-breakpoint
CREATE POLICY sales_ops_crm_lead_events_admin_context ON sales_ops_crm_lead_events
  AS PERMISSIVE FOR ALL
  USING (current_setting('app.fxl_admin', true) = 'true')
  WITH CHECK (current_setting('app.fxl_admin', true) = 'true');
--> statement-breakpoint
ALTER TABLE sales_ops_crm_lead_notes ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE sales_ops_crm_lead_notes FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY sales_ops_crm_lead_notes_tenant_isolation ON sales_ops_crm_lead_notes
  AS PERMISSIVE FOR ALL
  USING (org_id = current_setting('app.current_org_id', true))
  WITH CHECK (org_id = current_setting('app.current_org_id', true));
--> statement-breakpoint
CREATE POLICY sales_ops_crm_lead_notes_admin_context ON sales_ops_crm_lead_notes
  AS PERMISSIVE FOR ALL
  USING (current_setting('app.fxl_admin', true) = 'true')
  WITH CHECK (current_setting('app.fxl_admin', true) = 'true');
--> statement-breakpoint
ALTER TABLE sales_ops_crm_lead_followups ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE sales_ops_crm_lead_followups FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY sales_ops_crm_lead_followups_tenant_isolation ON sales_ops_crm_lead_followups
  AS PERMISSIVE FOR ALL
  USING (org_id = current_setting('app.current_org_id', true))
  WITH CHECK (org_id = current_setting('app.current_org_id', true));
--> statement-breakpoint
CREATE POLICY sales_ops_crm_lead_followups_admin_context ON sales_ops_crm_lead_followups
  AS PERMISSIVE FOR ALL
  USING (current_setting('app.fxl_admin', true) = 'true')
  WITH CHECK (current_setting('app.fxl_admin', true) = 'true');
--> statement-breakpoint
ALTER TABLE sales_ops_org_modules ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE sales_ops_org_modules FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY sales_ops_org_modules_tenant_isolation ON sales_ops_org_modules
  AS PERMISSIVE FOR ALL
  USING (org_id = current_setting('app.current_org_id', true))
  WITH CHECK (org_id = current_setting('app.current_org_id', true));
--> statement-breakpoint
CREATE POLICY sales_ops_org_modules_admin_context ON sales_ops_org_modules
  AS PERMISSIVE FOR ALL
  USING (current_setting('app.fxl_admin', true) = 'true')
  WITH CHECK (current_setting('app.fxl_admin', true) = 'true');
