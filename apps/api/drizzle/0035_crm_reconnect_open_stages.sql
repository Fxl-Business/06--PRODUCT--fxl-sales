-- 0035_crm_reconnect_open_stages - an open etapa must always reach its open neighbours.
--
-- Archiving an etapa in the middle of a pipeline used to leave the two etapas around it with no
-- edge between them, so a lead there could be moved only to the exits (Perdido, Pausado) and every
-- other drop answered 409 transition_not_allowed. The API now links the neighbours when it archives
-- an etapa; this migration repairs the pipelines that already lost the link.
--
-- For every pipeline, the ACTIVE open etapas (type <> 'saida') are ordered by (position, name), the
-- same order planPipelineTransitions uses, and each consecutive pair gets both edges. Nothing is
-- deleted or updated and a pair that exists is skipped by ON CONFLICT DO NOTHING, so a second run
-- writes nothing. 100% additive, no DDL, ordinary (non-phased) migration.
SELECT set_config('app.fxl_admin', 'true', true);--> statement-breakpoint
WITH ordered AS (
  SELECT "org_id", "pipeline_id", "id",
         row_number() OVER (PARTITION BY "org_id", "pipeline_id" ORDER BY "position", "name") AS rn
  FROM "sales_ops_pipeline_stages"
  WHERE "status" = 'active' AND "type" <> 'saida'
)
INSERT INTO "sales_ops_pipeline_transitions" ("org_id", "pipeline_id", "from_stage_id", "to_stage_id")
SELECT a."org_id", a."pipeline_id", a."id", b."id"
FROM ordered a
JOIN ordered b ON b."org_id" = a."org_id" AND b."pipeline_id" = a."pipeline_id" AND b.rn = a.rn + 1
UNION ALL
SELECT a."org_id", a."pipeline_id", b."id", a."id"
FROM ordered a
JOIN ordered b ON b."org_id" = a."org_id" AND b."pipeline_id" = a."pipeline_id" AND b.rn = a.rn + 1
ON CONFLICT DO NOTHING;
