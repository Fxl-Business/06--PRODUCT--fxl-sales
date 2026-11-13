-- 0033_crm_exit_reopen_transitions - a card in Ganho or Perdido may leave its exit again.
--
-- The rule (planPipelineTransitions in packages/shared-utils/src/crm-model.ts) used to give an
-- outgoing edge only to the pausado exit, so a lead in Ganho or Perdido could never move: a drag
-- from Ganho into an org-created normal etapa answered 409 transition_not_allowed. The rule now
-- gives EVERY exit an edge to every open etapa (type normal or orcamento) of its pipeline.
--
-- This migration adds the missing pairs to every existing pipeline of every organization: from
-- each ACTIVE exit with exit_kind ganho or perdido to each ACTIVE open etapa of the SAME pipeline.
-- Exit to exit stays absent. Pausado already has these edges since 0030.
-- An org that shaped its graph keeps every pair it has: nothing is deleted or updated, and a pair
-- that already exists is skipped by the bare ON CONFLICT DO NOTHING (unique on org, from, to), so
-- running the file twice writes nothing the second time.
--
-- 100% additive: one INSERT ... SELECT of rows of sales_ops_pipeline_transitions, no DDL, no DELETE,
-- no UPDATE, no privilege statement. Ordinary (non-phased) migration through the shared runner.
SELECT set_config('app.fxl_admin', 'true', true);--> statement-breakpoint
INSERT INTO "sales_ops_pipeline_transitions" ("org_id", "pipeline_id", "from_stage_id", "to_stage_id")
SELECT e."org_id", e."pipeline_id", e."id", o."id"
FROM "sales_ops_pipeline_stages" e
JOIN "sales_ops_pipeline_stages" o
  ON o."org_id" = e."org_id" AND o."pipeline_id" = e."pipeline_id"
WHERE e."status" = 'active'
  AND e."type" = 'saida'
  AND e."exit_kind" IN ('ganho', 'perdido')
  AND o."status" = 'active'
  AND o."type" <> 'saida'
ON CONFLICT DO NOTHING;
