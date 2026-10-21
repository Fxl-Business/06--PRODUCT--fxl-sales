-- 0031_crm_cutover_resync - the phase 2 cutover RESYNC (vendas-crm-unificado slice 07a1).
--
-- Part 1, statements 1 to 17: a BYTE-FOR-BYTE repeat of 0030_crm_legacy_copy.sql, from the first
-- set_config to the last INSERT (crm-cutover-resync.test.ts compares the two files). It copies what
-- the old tables received after 0030 and is a no-op for what is already there (same uuids,
-- ON CONFLICT DO NOTHING).
--
-- Part 2, after the repeat: what a repeat cannot do. A row that was changed in the OLD tables after
-- 0030 (a lead moved, edited, deleted or restored, an etapa renamed or archived) keeps a stale copy,
-- so the rows the old table changed LAST are written over the copy. "Changed last" is the rule
-- COALESCE(old.updated_at, '-infinity') > COALESCE(new.updated_at, '-infinity'): every old writer
-- (create, patch, move, delete, restore, etapa edit) stamps updated_at, and the new code always
-- stamps it too, so a row the NEW code wrote is never overwritten and the whole part 2 is idempotent
-- (a second run changes nothing).
--   * etapas: name, position, status, archived_at, updated_at (a rename that would collide with
--     another etapa of the pipeline is skipped, never aborts the migration);
--   * one history event (from the copy's etapa to the old etapa, actor 'system'/'Migração') for every
--     lead whose etapa differs; written BEFORE the lead update so the comparison still sees both;
--   * leads: contact, etapa, position, stage_changed_at, vendedor, empresa, valor, lost_reason, sale_id,
--     deleted_* and updated_at;
--   * field values: descricao, nascimento and produtos are upserted (ON CONFLICT DO UPDATE) from
--     the changed leads. A value row that was REMOVED in the old table (a produto dropped, a
--     description cleared, a birth date cleared) is NOT removed here: a migration may not DELETE.
--     The stale value stays visible until an operator edits the lead. Accepted, documented, tested.
--   * transitions: a stage created in the old table after 0030 gets its edges (the 0030 rule, restricted to the
--     pairs that touch a stage with NO edge yet, so a graph the org shaped is left alone);
--
-- After this migration the API reads and writes ONLY the unified tables (slice 07a2): the old
-- tables sales_ops_leads, sales_ops_lead_products and sales_ops_lead_stages stay byte-intact as the
-- frozen pre-cutover copy and are never written again by product code. 0030 and 0031 ship in the
-- same deploy, so the window this resync covers is empty in practice.
-- 100% additive to the schema: INSERT and UPDATE of rows of the unified tables only, no DELETE, no
-- privilege statement, ordinary non-phased migration.
SELECT set_config('app.fxl_admin', 'true', true);--> statement-breakpoint
INSERT INTO "sales_ops_pipelines" ("org_id", "name", "system_key", "position", "is_default")
SELECT o."org_id", 'Funil CRM padrão', 'crm-padrao', 0, true
FROM (
  SELECT "org_id" FROM "sales_ops_people"
  UNION SELECT "org_id" FROM "sales_ops_settings"
  UNION SELECT "org_id" FROM "sales_ops_sales"
  UNION SELECT "org_id" FROM "sales_ops_lead_stages"
  UNION SELECT "org_id" FROM "sales_ops_leads"
  UNION SELECT "org_id" FROM "sales_ops_clients"
) AS o
ON CONFLICT DO NOTHING;--> statement-breakpoint
INSERT INTO "sales_ops_pipeline_stages" ("id", "org_id", "pipeline_id", "name", "position", "type", "behavior", "exit_kind", "requires_reason", "status", "archived_at", "created_at", "updated_at")
SELECT s."id", s."org_id", p."id", s."name", s."position",
  CASE s."kind" WHEN 'conversion' THEN 'orcamento' WHEN 'lost' THEN 'saida' ELSE 'normal' END,
  CASE s."kind" WHEN 'conversion' THEN 'opens_orcamentos' ELSE 'none' END,
  CASE s."kind" WHEN 'lost' THEN 'perdido' ELSE NULL END,
  s."kind" = 'lost',
  s."status", s."archived_at", s."created_at", s."updated_at"
FROM "sales_ops_lead_stages" s
JOIN "sales_ops_pipelines" p ON p."org_id" = s."org_id" AND p."system_key" = 'crm-padrao'
ON CONFLICT DO NOTHING;--> statement-breakpoint
INSERT INTO "sales_ops_pipeline_stages" ("org_id", "pipeline_id", "name", "position", "type", "behavior", "exit_kind", "requires_reason")
SELECT p."org_id", p."id", d."label", d."ord", d."type", d."behavior", d."exit_kind", d."requires_reason"
FROM "sales_ops_pipelines" p
CROSS JOIN (VALUES
  ('Novo',          1, 'normal',    'none',             NULL,       false),
  ('Qualificação',  2, 'normal',    'none',             NULL,       false),
  ('Em negociação', 3, 'normal',    'none',             NULL,       false),
  ('Proposta',      4, 'orcamento', 'opens_orcamentos', NULL,       false),
  ('Ganho',         5, 'saida',     'none',             'ganho',    false),
  ('Perdido',       6, 'saida',     'none',             'perdido',  true),
  ('Pausado',       7, 'saida',     'none',             'pausado',  false)
) AS d("label", "ord", "type", "behavior", "exit_kind", "requires_reason")
WHERE p."system_key" = 'crm-padrao'
  AND NOT EXISTS (SELECT 1 FROM "sales_ops_pipeline_stages" x WHERE x."pipeline_id" = p."id")
ON CONFLICT DO NOTHING;--> statement-breakpoint
INSERT INTO "sales_ops_pipeline_stages" ("org_id", "pipeline_id", "name", "position", "type", "behavior", "exit_kind", "requires_reason")
SELECT p."org_id", p."id",
  (SELECT c."nm" FROM (
     SELECT g.k, CASE WHEN g.k = 0 THEN e."label" WHEN g.k = 1 THEN e."label" || ' (saída)' ELSE e."label" || ' (saída ' || g.k || ')' END AS "nm"
     FROM generate_series(0, (SELECT count(*)::int FROM "sales_ops_pipeline_stages" w WHERE w."pipeline_id" = p."id") + 1) AS g(k)
   ) c
   WHERE NOT EXISTS (SELECT 1 FROM "sales_ops_pipeline_stages" y WHERE y."pipeline_id" = p."id" AND y."name" = c."nm")
   ORDER BY c.k LIMIT 1),
  (SELECT COALESCE(MAX(z."position"), 0) FROM "sales_ops_pipeline_stages" z WHERE z."pipeline_id" = p."id") + e."ord",
  'saida', 'none', e."exit_kind", false
FROM "sales_ops_pipelines" p
CROSS JOIN (VALUES ('Ganho', 'ganho', 1), ('Pausado', 'pausado', 2)) AS e("label", "exit_kind", "ord")
WHERE p."system_key" = 'crm-padrao'
  AND NOT EXISTS (SELECT 1 FROM "sales_ops_pipeline_stages" x WHERE x."pipeline_id" = p."id" AND x."exit_kind" = e."exit_kind")
ON CONFLICT DO NOTHING;--> statement-breakpoint
INSERT INTO "sales_ops_pipeline_transitions" ("org_id", "pipeline_id", "from_stage_id", "to_stage_id")
WITH act AS (
  SELECT s."org_id", s."pipeline_id", s."id", s."type", s."exit_kind", s."position", s."name"
  FROM "sales_ops_pipeline_stages" s
  JOIN "sales_ops_pipelines" p ON p."id" = s."pipeline_id" AND p."system_key" = 'crm-padrao'
  WHERE s."status" = 'active'
    AND NOT EXISTS (SELECT 1 FROM "sales_ops_pipeline_transitions" t WHERE t."pipeline_id" = s."pipeline_id")
), opn AS (
  SELECT a.*, row_number() OVER (PARTITION BY a."pipeline_id" ORDER BY a."position", a."name") AS rn
  FROM act a WHERE a."type" <> 'saida'
)
SELECT "org_id", "pipeline_id", "from_id", "to_id" FROM (
  SELECT a."org_id", a."pipeline_id", a."id" AS "from_id", b."id" AS "to_id" FROM opn a JOIN opn b ON b."pipeline_id" = a."pipeline_id" AND b."rn" = a."rn" + 1
  UNION
  SELECT a."org_id", a."pipeline_id", b."id", a."id" FROM opn a JOIN opn b ON b."pipeline_id" = a."pipeline_id" AND b."rn" = a."rn" + 1
  UNION
  SELECT o."org_id", o."pipeline_id", o."id", e."id" FROM opn o JOIN act e ON e."pipeline_id" = o."pipeline_id" AND e."type" = 'saida'
  UNION
  SELECT e."org_id", e."pipeline_id", e."id", o."id" FROM act e JOIN opn o ON o."pipeline_id" = e."pipeline_id" WHERE e."type" = 'saida' AND e."exit_kind" = 'pausado'
) AS g
ON CONFLICT DO NOTHING;--> statement-breakpoint
INSERT INTO "sales_ops_field_definitions" ("org_id", "key", "label", "kind", "reference_target", "multiple", "filterable", "is_system", "removable", "backing_column", "position")
SELECT o."org_id", 'cliente', 'Cliente', 'reference', 'cliente', false, true, true, false, 'client_id', 1
FROM (SELECT "org_id" FROM "sales_ops_pipelines" WHERE "system_key" = 'crm-padrao') AS o
ON CONFLICT DO NOTHING;--> statement-breakpoint
INSERT INTO "sales_ops_field_definitions" ("org_id", "key", "label", "kind", "reference_target", "multiple", "filterable", "position")
SELECT DISTINCT lp."org_id", 'produtos', 'Produtos', 'reference', 'produto', true, true, 2
FROM "sales_ops_lead_products" lp
ON CONFLICT DO NOTHING;--> statement-breakpoint
INSERT INTO "sales_ops_field_definitions" ("org_id", "key", "label", "kind", "filterable", "position")
SELECT DISTINCT l."org_id", 'descricao', 'Descrição', 'text', false, 3
FROM "sales_ops_leads" l WHERE l."description" IS NOT NULL
ON CONFLICT DO NOTHING;--> statement-breakpoint
INSERT INTO "sales_ops_field_definitions" ("org_id", "key", "label", "kind", "filterable", "position")
SELECT DISTINCT l."org_id", 'nascimento', 'Nascimento', 'date', false, 4
FROM "sales_ops_leads" l WHERE l."contact_birth_date" IS NOT NULL
ON CONFLICT DO NOTHING;--> statement-breakpoint
INSERT INTO "sales_ops_crm_leads" ("id", "org_id", "contact_name", "contact_phone", "contact_email", "pipeline_id", "stage_id", "position", "stage_changed_at", "seller_person_id", "seller_name_snapshot", "client_id", "client_name_snapshot", "estimated_value_brl", "lost_reason", "sale_id", "created_at", "updated_at", "deleted_at", "deleted_by_user_id", "deleted_by_name")
SELECT l."id", l."org_id", l."contact_name", l."contact_phone", l."contact_email", p."id", l."stage_id", l."position", l."stage_changed_at", l."seller_person_id", l."seller_name_snapshot", l."client_id", l."client_name_snapshot", l."estimated_value_brl", l."lost_reason", l."sale_id", l."created_at", l."updated_at", l."deleted_at", l."deleted_by_user_id", l."deleted_by_name"
FROM "sales_ops_leads" l
JOIN "sales_ops_pipelines" p ON p."org_id" = l."org_id" AND p."system_key" = 'crm-padrao'
ON CONFLICT ("id") DO NOTHING;--> statement-breakpoint
INSERT INTO "sales_ops_crm_lead_field_values" ("org_id", "lead_id", "field_id", "position", "value_text")
SELECT l."org_id", l."id", f."id", 0, l."description"
FROM "sales_ops_leads" l
JOIN "sales_ops_field_definitions" f ON f."org_id" = l."org_id" AND f."key" = 'descricao'
WHERE l."description" IS NOT NULL
ON CONFLICT ("org_id", "lead_id", "field_id", "position") DO NOTHING;--> statement-breakpoint
INSERT INTO "sales_ops_crm_lead_field_values" ("org_id", "lead_id", "field_id", "position", "value_date")
SELECT l."org_id", l."id", f."id", 0, l."contact_birth_date"
FROM "sales_ops_leads" l
JOIN "sales_ops_field_definitions" f ON f."org_id" = l."org_id" AND f."key" = 'nascimento'
WHERE l."contact_birth_date" IS NOT NULL
ON CONFLICT ("org_id", "lead_id", "field_id", "position") DO NOTHING;--> statement-breakpoint
INSERT INTO "sales_ops_crm_lead_field_values" ("org_id", "lead_id", "field_id", "position", "value_text", "value_product_id", "ref_name_snapshot")
SELECT lp."org_id", lp."lead_id", f."id",
  (row_number() OVER (PARTITION BY lp."lead_id" ORDER BY lp."created_at", lp."id") - 1)::integer,
  CASE WHEN lp."product_id" IS NULL THEN lp."product_name_snapshot" ELSE NULL END,
  lp."product_id",
  lp."product_name_snapshot"
FROM "sales_ops_lead_products" lp
JOIN "sales_ops_field_definitions" f ON f."org_id" = lp."org_id" AND f."key" = 'produtos'
ON CONFLICT ("org_id", "lead_id", "field_id", "position") DO NOTHING;--> statement-breakpoint
INSERT INTO "sales_ops_crm_lead_events" ("org_id", "lead_id", "kind", "from_stage_id", "to_stage_id", "reason", "actor_user_id", "actor_name_snapshot", "occurred_at")
SELECT l."org_id", l."id", 'stage_changed', NULL, l."stage_id", l."lost_reason", 'system', 'Migração', l."stage_changed_at"
FROM "sales_ops_leads" l
ON CONFLICT DO NOTHING;
--> statement-breakpoint
UPDATE "sales_ops_pipeline_stages" AS c
SET "name" = s."name", "position" = s."position", "status" = s."status", "archived_at" = s."archived_at", "updated_at" = s."updated_at"
FROM "sales_ops_lead_stages" AS s
WHERE c."id" = s."id" AND c."org_id" = s."org_id"
  AND COALESCE(s."updated_at", '-infinity'::timestamptz) > COALESCE(c."updated_at", '-infinity'::timestamptz)
  AND NOT EXISTS (SELECT 1 FROM "sales_ops_pipeline_stages" o WHERE o."pipeline_id" = c."pipeline_id" AND o."name" = s."name" AND o."id" <> c."id");--> statement-breakpoint
INSERT INTO "sales_ops_pipeline_transitions" ("org_id", "pipeline_id", "from_stage_id", "to_stage_id")
WITH act AS (
  SELECT s."org_id", s."pipeline_id", s."id", s."type", s."exit_kind", s."position", s."name"
  FROM "sales_ops_pipeline_stages" s
  JOIN "sales_ops_pipelines" p ON p."id" = s."pipeline_id" AND p."system_key" = 'crm-padrao'
  WHERE s."status" = 'active'
), opn AS (
  SELECT a.*, row_number() OVER (PARTITION BY a."pipeline_id" ORDER BY a."position", a."name") AS rn
  FROM act a WHERE a."type" <> 'saida'
)
SELECT "org_id", "pipeline_id", "from_id", "to_id" FROM (
  SELECT a."org_id", a."pipeline_id", a."id" AS "from_id", b."id" AS "to_id" FROM opn a JOIN opn b ON b."pipeline_id" = a."pipeline_id" AND b."rn" = a."rn" + 1
  UNION
  SELECT a."org_id", a."pipeline_id", b."id", a."id" FROM opn a JOIN opn b ON b."pipeline_id" = a."pipeline_id" AND b."rn" = a."rn" + 1
  UNION
  SELECT o."org_id", o."pipeline_id", o."id", e."id" FROM opn o JOIN act e ON e."pipeline_id" = o."pipeline_id" AND e."type" = 'saida'
  UNION
  SELECT e."org_id", e."pipeline_id", e."id", o."id" FROM act e JOIN opn o ON o."pipeline_id" = e."pipeline_id" WHERE e."type" = 'saida' AND e."exit_kind" = 'pausado'
) AS g
WHERE NOT EXISTS (SELECT 1 FROM "sales_ops_pipeline_transitions" t WHERE t."pipeline_id" = g."pipeline_id" AND (t."from_stage_id" = g."from_id" OR t."to_stage_id" = g."from_id"))
   OR NOT EXISTS (SELECT 1 FROM "sales_ops_pipeline_transitions" t WHERE t."pipeline_id" = g."pipeline_id" AND (t."from_stage_id" = g."to_id" OR t."to_stage_id" = g."to_id"))
ON CONFLICT DO NOTHING;--> statement-breakpoint
INSERT INTO "sales_ops_crm_lead_events" ("org_id", "lead_id", "kind", "from_stage_id", "to_stage_id", "reason", "actor_user_id", "actor_name_snapshot", "occurred_at")
SELECT l."org_id", l."id", 'stage_changed', c."stage_id", l."stage_id", l."lost_reason", 'system', 'Migração', l."stage_changed_at"
FROM "sales_ops_leads" l
JOIN "sales_ops_crm_leads" c ON c."id" = l."id" AND c."org_id" = l."org_id"
WHERE l."stage_id" <> c."stage_id"
  AND COALESCE(l."updated_at", '-infinity'::timestamptz) > COALESCE(c."updated_at", '-infinity'::timestamptz);--> statement-breakpoint
INSERT INTO "sales_ops_crm_lead_field_values" ("org_id", "lead_id", "field_id", "position", "value_text")
SELECT l."org_id", l."id", f."id", 0, l."description"
FROM "sales_ops_leads" l
JOIN "sales_ops_crm_leads" c ON c."id" = l."id" AND c."org_id" = l."org_id"
JOIN "sales_ops_field_definitions" f ON f."org_id" = l."org_id" AND f."key" = 'descricao'
WHERE l."description" IS NOT NULL
  AND COALESCE(l."updated_at", '-infinity'::timestamptz) > COALESCE(c."updated_at", '-infinity'::timestamptz)
ON CONFLICT ("org_id", "lead_id", "field_id", "position") DO UPDATE SET "value_text" = EXCLUDED."value_text", "updated_at" = now();--> statement-breakpoint
INSERT INTO "sales_ops_crm_lead_field_values" ("org_id", "lead_id", "field_id", "position", "value_date")
SELECT l."org_id", l."id", f."id", 0, l."contact_birth_date"
FROM "sales_ops_leads" l
JOIN "sales_ops_crm_leads" c ON c."id" = l."id" AND c."org_id" = l."org_id"
JOIN "sales_ops_field_definitions" f ON f."org_id" = l."org_id" AND f."key" = 'nascimento'
WHERE l."contact_birth_date" IS NOT NULL
  AND COALESCE(l."updated_at", '-infinity'::timestamptz) > COALESCE(c."updated_at", '-infinity'::timestamptz)
ON CONFLICT ("org_id", "lead_id", "field_id", "position") DO UPDATE SET "value_date" = EXCLUDED."value_date", "updated_at" = now();--> statement-breakpoint
INSERT INTO "sales_ops_crm_lead_field_values" ("org_id", "lead_id", "field_id", "position", "value_text", "value_product_id", "ref_name_snapshot")
SELECT lp."org_id", lp."lead_id", f."id",
  (row_number() OVER (PARTITION BY lp."lead_id" ORDER BY lp."created_at", lp."id") - 1)::integer,
  CASE WHEN lp."product_id" IS NULL THEN lp."product_name_snapshot" ELSE NULL END,
  lp."product_id",
  lp."product_name_snapshot"
FROM "sales_ops_lead_products" lp
JOIN "sales_ops_leads" l ON l."id" = lp."lead_id" AND l."org_id" = lp."org_id"
JOIN "sales_ops_crm_leads" c ON c."id" = l."id" AND c."org_id" = l."org_id"
JOIN "sales_ops_field_definitions" f ON f."org_id" = lp."org_id" AND f."key" = 'produtos'
WHERE COALESCE(l."updated_at", '-infinity'::timestamptz) > COALESCE(c."updated_at", '-infinity'::timestamptz)
ON CONFLICT ("org_id", "lead_id", "field_id", "position") DO UPDATE SET "value_text" = EXCLUDED."value_text", "value_product_id" = EXCLUDED."value_product_id", "ref_name_snapshot" = EXCLUDED."ref_name_snapshot", "updated_at" = now();--> statement-breakpoint
UPDATE "sales_ops_crm_leads" AS c
SET "contact_name" = l."contact_name", "contact_phone" = l."contact_phone", "contact_email" = l."contact_email",
  "stage_id" = l."stage_id", "position" = l."position", "stage_changed_at" = l."stage_changed_at",
  "seller_person_id" = l."seller_person_id", "seller_name_snapshot" = l."seller_name_snapshot",
  "client_id" = l."client_id", "client_name_snapshot" = l."client_name_snapshot",
  "estimated_value_brl" = l."estimated_value_brl", "lost_reason" = l."lost_reason", "sale_id" = l."sale_id",
  "deleted_at" = l."deleted_at", "deleted_by_user_id" = l."deleted_by_user_id", "deleted_by_name" = l."deleted_by_name",
  "updated_at" = l."updated_at"
FROM "sales_ops_leads" AS l
WHERE c."id" = l."id" AND c."org_id" = l."org_id"
  AND COALESCE(l."updated_at", '-infinity'::timestamptz) > COALESCE(c."updated_at", '-infinity'::timestamptz);
