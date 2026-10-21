---
id: 06-migracao-dados-crm
milestone: v4.8.0
status: todo
depends_on: ["05a-crm-schema-migracao", "05b-crm-defaults-servicos"]
files_modified: ["apps/api/drizzle/0030_crm_legacy_copy.sql", "apps/api/drizzle/meta/0030_snapshot.json", "apps/api/drizzle/meta/_journal.json", "apps/api/test/rls/crm-legacy-copy-migration.test.ts", "apps/api/src/domains/sales-ops/leads/__tests__/default-pipeline-parity.test.ts", "apps/api/scripts/seed/plan.ts", "apps/api/scripts/seed-dev.ts", "apps/api/scripts/__tests__/seed-plan.test.ts", "apps/api/src/db/__tests__/settlement-test-cleanup.ts"]
affected_tests: [
  {path: apps/api/src/domains/sales-ops/leads/__tests__/default-pipeline-parity.test.ts, impact: "extended: closes the SLICE-05-HOOK by comparing the 0030 default seed to DEFAULT_PIPELINE_STAGES", update: "append the describe block and two imports (step 5)", command: "pnpm --filter @fxl-sales/api exec vitest run src/domains/sales-ops/leads/__tests__/default-pipeline-parity.test.ts", owner: builder},
  {path: apps/api/scripts/__tests__/seed-plan.test.ts, impact: "SEED_DELETE_ORDER gains the CRM tables", update: "append one case (step 6)", command: "pnpm --filter @fxl-sales/api exec vitest run scripts/__tests__/seed-plan.test.ts", owner: builder},
  {path: apps/api/src/db/__tests__/additive-migrations-guard.test.ts, impact: "now scans 0029 and 0030", update: none (must stay green), command: "pnpm --filter @fxl-sales/api exec vitest run src/db/__tests__/additive-migrations-guard.test.ts", owner: builder},
  {path: apps/api/test/rls/leads-schema-migration.test.ts, impact: "0022 oracle on the shared test DB that now also runs 0030", update: none (must stay green), command: "pnpm --filter @fxl-sales/api exec env VITEST_INTEGRATION=1 vitest run test/rls/leads-schema-migration.test.ts", owner: builder}
]
acceptance: "given a database at 0029 holding a synthetic full-edition org (won and lost propostas, a converted lead, a soft-deleted lead, an unassigned lead, free and catalog lead produtos), a Construbom-style org without produtos, an org with no etapas and a legacy finder lead, when 0030 runs, then every source table is identical (row count and content hash), crm leads and value sums equal the source per org with the same ids, the first history event equals stage_changed_at, Cliente is the non-removable system field, produtos (free items included) become Produto values, legacy leads is not copied, payables, receivables, settlements and the outbox are unchanged, no FK is orphaned, RLS isolates orgs, and a second run of the SQL changes nothing"
goal: "Additive idempotent backfill of today's etapas and leads into the unified CRM tables, same uuids, with the synthetic-dataset migration oracle"
must_not_break: ["no source table is written by 0030 (only INSERT ... SELECT into the ten 0029 tables)", "legacy leads, payables, receivables, settlements, sales_ops_sales and integration_outbox are unchanged", "0030 contains no DROP, DELETE FROM, TRUNCATE, RENAME, GRANT, ROLE and no UPDATE", "the old API keeps working on the old tables"]
rules: ["Never use the em dash; use '-'", "0030 is ordinary (non-phased) and generated with drizzle-kit generate --custom, then its body is replaced by the SQL below byte for byte", "Every statement of 0030 is idempotent: ON CONFLICT DO NOTHING (ON CONFLICT (id) for leads)", "The oracle uses only synthetic data in a scratch database; never read or copy real data"]
verifier_focus: "Run the oracle and the parity test; then mutate a throwaway copy of 0030 (drop the ON CONFLICT of the lead copy, copy legacy leads, write a source table) and confirm the oracle fails each time; confirm the SQL graph equals planPipelineTransitions; confirm a SECOND run is a no-op; read the 0030 header against the ADR rules"
oracle: "apps/api/test/rls/crm-legacy-copy-migration.test.ts"
---

# 06 - CRM data migration 0030 (phase 1c)

## Context

Slices 05a and 05b exist: the ten tables (migration 0029), `crm-model.ts`, `ensureDefaultPipeline`.
Source tables and the facts this migration relies on (verified against this tree):
- `sales_ops_lead_stages` (`schema.ts:927`): `id`, `org_id`, `name`, `kind` (`normal|conversion|lost`), `is_system`, `position`, `status`, `archived_at`, `created_at`, `updated_at`. Unique `(org_id, name)`.
- `sales_ops_leads` (`schema.ts:1000`): contact columns (0027), `description`, `contact_birth_date`, `client_id`, `client_name_snapshot`, `estimated_value_brl`, `seller_person_id`, `seller_name_snapshot`, `stage_id`, `stage_changed_at`, `position`, `lost_reason`, `sale_id`, soft delete (0028).
- `sales_ops_lead_products` (`schema.ts:1138`): `lead_id`, nullable `product_id`, `product_name_snapshot`. A FREE item has `product_id NULL` (`lead-schemas.ts:36-50`, `lead-service.ts:476-479`) and MUST be preserved with its name.
- The 0022 seed used the org universe `sales_ops_people UNION sales_ops_settings UNION sales_ops_sales`; 0030 adds orgs with an etapa, a lead or a cliente.
- A migration runs as the NOSUPERUSER owner under FORCE RLS, so a data migration starts with `SELECT set_config('app.fxl_admin', 'true', true);` exactly like 0022 line 130.
- The runner supports `throughTag`, so the oracle migrates a scratch database to `0029_crm_unificado_modelo`, seeds, then runs the rest (template `apps/api/test/rls/settlements-schema-migration.test.ts`).
- Ledger/outbox row shapes used by the fixture were read from the live schema (`sales_ops_receivables`, `sales_ops_payables`, `sales_ops_settlements`, `integration_outbox` NOT NULL columns).

Prototype result: the SQL below and the oracle were run by the planner on a scratch database: oracle 18 tests pass, a second run of the SQL is a no-op, the SQL transition graph equals `planPipelineTransitions` for all three orgs, parity test 9 tests pass, `seed-plan.test.ts` 53 tests pass.

## Design (recorded in the ADR; the rules the SQL implements)

- Same uuids: a copied lead and a copied etapa keep their old id. Lead copy is `ON CONFLICT ("id") DO NOTHING`.
- One pipeline per org in the universe: name `Funil CRM padrão`, `system_key 'crm-padrao'`, `is_default true`.
- Orgs with etapas: their etapas become stages of that pipeline (`conversion` -> `orcamento`/`opens_orcamentos`; `lost` -> `saida`/`perdido`/`requires_reason`; `normal` -> `normal`; `status` and `archived_at` copied). Then `Ganho` and `Pausado` are added at `max(position)+1` and `+2` when the pipeline has no stage with that `exit_kind`; the name gets ` (saída)` if the org already has a stage with that name. `Qualificação` is NOT added.
- Orgs without etapas: the 7 default stages (VALUES block, compared to `DEFAULT_PIPELINE_STAGES` by the parity test).
- Transitions: generated once per pipeline that has none, by the rule in the ADR (open[i] <-> open[i+1], open -> exit, pausado -> open), over ACTIVE stages.
- Fields: `cliente` (system, non-removable, backed by `client_id`) for every org in the universe; `produtos` only for orgs with lead products; `descricao` only where a description exists (empty string is preserved); `nascimento` only where a birth date exists. The positions are 1, 2, 3, 4.
- Values: description -> `value_text`; birth date -> `value_date`; each lead product -> a `produtos` value at position `row_number - 1` ordered by `(created_at, id)`: catalog item -> `value_product_id` + snapshot, free item -> `value_text` + snapshot.
- Events: ONE initial event per lead (`from_stage_id NULL`, `to_stage_id` the lead stage, `occurred_at = stage_changed_at`, actor `system`/`Migração`, `reason = lost_reason`); idempotent through the partial unique index.
- Not copied: the legacy `leads` table (P1), anything of the ledger or the outbox, module rows.
- The seed deletes the CRM tables first (restrict FKs onto clientes, pessoas, propostas, produtos).

## Steps

1. TDD: create `apps/api/test/rls/crm-legacy-copy-migration.test.ts` (text below). Without 0030 the `beforeAll` fails; that is the red state.
2. Generate the empty migration: `pnpm --filter @fxl-sales/api exec drizzle-kit generate --custom --name crm_legacy_copy` (creates `0030_crm_legacy_copy.sql`, `meta/0030_snapshot.json` identical to 0029's apart from `id` and `prevId`, and one journal entry `idx 30`). Replace the whole body of `apps/api/drizzle/0030_crm_legacy_copy.sql` with the SQL below, byte for byte.
3. Run the oracle until green. Do not weaken an assertion; if one fails, fix the SQL only when the failure is a real defect and report it.
4. Parity: apply the edit of step 5 to `default-pipeline-parity.test.ts` and run it.
5. `apps/api/src/domains/sales-ops/leads/__tests__/default-pipeline-parity.test.ts` edits: (a) add `DEFAULT_PIPELINE_KEY,` and `DEFAULT_PIPELINE_NAME,` to the existing import list from `@fxl-sales/shared-utils/default-pipeline` (alphabetical, before `DEFAULT_PIPELINE_NEW_STAGE_KEYS`); (b) add `import { defaultStageBehavior, defaultStageRequiresReason } from '@fxl-sales/shared-utils/crm-model';` after the `vitest` import; (c) replace the `SLICE-05-HOOK` sentence in the doc comment above `MIGRATION_SEED_COMPARISONS` with: `SLICE-05-HOOK (closed by slice 06): migration 0029 carries NO seed rows by design (tables only). The 0030 default-pipeline seed uses a different row shape, so it is compared in the dedicated describe block at the end of this file.`; (d) append the block below at the end of the file.
6. Dev seed delete order (`apps/api/scripts/seed/plan.ts`, `apps/api/scripts/seed-dev.ts`, `apps/api/scripts/__tests__/seed-plan.test.ts`): apply the patch below. `SEED_WRITE_ORDER` and `EXPECTED_WRITE_ORDER` do NOT change; only the delete side.
7. Run the affected suites, lint, type-check (commands below). Report.

## The migration SQL

`apps/api/drizzle/0030_crm_legacy_copy.sql` (final content):

```sql
-- 0030_crm_legacy_copy - the additive backfill of the unified CRM model (phase 1c).
--
-- COPIES today's etapas and leads into the 0029 tables and READS everything else.
-- Every statement is INSERT ... SELECT ... ON CONFLICT DO NOTHING: running the whole
-- file twice writes nothing the second time, and no source table is ever written.
-- The legacy `leads` table (finder referrals), the ledger, the outbox and
-- sales_ops_sales are not read at all except for the org universe.
--
-- SAME UUIDS: a copied lead keeps its id, a copied etapa keeps its id, so URLs,
-- sale_id links and the ON CONFLICT (id) idempotency are stable.
--
-- Org universe = the orgs 0022 seeded (people, settings, sales) plus every org that
-- already has an etapa, a lead or a cliente.
-- Every org gets its default pipeline 'Funil CRM padrão' (system_key 'crm-padrao'):
--   * with legacy etapas: built from the org's OWN etapas (conversion -> orcamento
--     opens_orcamentos, lost -> saida/perdido requiring a reason, normal -> normal,
--     archived stays archived) plus the missing exits Ganho and Pausado at
--     max(position)+1 and +2, and the transition graph generated by rule below;
--   * without legacy etapas: the pure default pipeline (parity with
--     DEFAULT_PIPELINE_STAGES, asserted by default-pipeline-parity.test.ts).
-- Transition rule over the ACTIVE etapas of a pipeline with no transition yet, open =
-- type normal|orcamento ordered by (position, name), exits = type saida:
--   open[i] -> open[i+1], open[i+1] -> open[i], every open -> every exit,
--   every exit with exit_kind pausado -> every open.
-- Fields are created only when data needs them (Cliente always).
-- Each lead gets ONE first history event (from NULL to its etapa, occurred_at =
-- stage_changed_at, actor 'system'/'Migração').
-- Modules are NOT backfilled here: the token is not in the database.
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
  CASE WHEN EXISTS (SELECT 1 FROM "sales_ops_pipeline_stages" y WHERE y."pipeline_id" = p."id" AND y."name" = e."label")
       THEN e."label" || ' (saída)' ELSE e."label" END,
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
```

## Parity test block (append to `default-pipeline-parity.test.ts`)

```ts
interface PipelineSeedRow {
  label: string;
  ord: number;
  type: string;
  behavior: string;
  exitKind: string | null;
  requiresReason: boolean;
}

/** Parses the pure-default `CROSS JOIN (VALUES ...) AS d(...)` block of migration 0030. */
function extractPipelineSeedRows(sql: string): PipelineSeedRow[] {
  const block = /CROSS JOIN \(VALUES([\s\S]*?)\) AS d\(/.exec(sql);
  if (!block) throw new Error('0030 default pipeline VALUES block not found');
  const rows: PipelineSeedRow[] = [];
  for (const m of block[1]!.matchAll(/\('([^']+)',\s*(\d+),\s*'(\w+)',\s*'(\w+)',\s*(NULL|'\w+'),\s*(true|false)\)/g)) {
    rows.push({
      label: m[1]!,
      ord: Number(m[2]),
      type: m[3]!,
      behavior: m[4]!,
      exitKind: m[5] === 'NULL' ? null : m[5]!.slice(1, -1),
      requiresReason: m[6] === 'true',
    });
  }
  return rows;
}

describe('migration 0030 pure-default pipeline seed parity (SLICE-05-HOOK closed)', () => {
  const sql0030 = readMigration('0030');
  const rows = extractPipelineSeedRows(sql0030);

  it('parses seven seed rows out of migration 0030', () => {
    expect(rows).toHaveLength(7);
  });

  it('equals DEFAULT_PIPELINE_STAGES label, order, type, exit kind, behavior and reason rule', () => {
    expect(rows).toEqual(
      DEFAULT_PIPELINE_STAGES.map((s) => ({
        label: s.label,
        ord: s.order,
        type: s.type,
        behavior: defaultStageBehavior(s),
        exitKind: s.exitKind,
        requiresReason: defaultStageRequiresReason(s),
      })),
    );
  });

  it('names the default pipeline exactly like the constant', () => {
    expect(sql0030).toContain(`'${DEFAULT_PIPELINE_NAME}', '${DEFAULT_PIPELINE_KEY}'`);
  });

  it('adds Ganho and Pausado for legacy orgs with the constant labels', () => {
    expect(sql0030).toContain("('Ganho', 'ganho', 1), ('Pausado', 'pausado', 2)");
    const labelOf = (key: string) => DEFAULT_PIPELINE_STAGES.find((s) => s.key === key)!.label;
    expect([labelOf('ganho'), labelOf('pausado')]).toEqual(['Ganho', 'Pausado']);
  });
});
```

## Seed delete order patch

Apply with `git apply` or by hand (it is three small hunks; `EXPECTED_DELETE_ORDER` in `seed-dev.ts` must equal `SEED_DELETE_ORDER` in `plan.ts`, `assertOrderMatches` throws otherwise):

```diff
diff --git a/apps/api/scripts/__tests__/seed-plan.test.ts b/apps/api/scripts/__tests__/seed-plan.test.ts
index 33c5938..520faba 100644
--- a/apps/api/scripts/__tests__/seed-plan.test.ts
+++ b/apps/api/scripts/__tests__/seed-plan.test.ts
@@ -213,4 +213,20 @@ describe('buildDevSeedPlan - idempotence, structurally', () => {
     expect(index('salesOpsSettlements')).toBeLessThan(index('salesOpsSales'));
   });
+
+  it('deletes the unified CRM tables before every table their restrict FKs point at', () => {
+    const index = (key: string) => SEED_DELETE_ORDER.indexOf(key as (typeof SEED_DELETE_ORDER)[number]);
+    for (const crm of ['salesOpsCrmLeadNotes', 'salesOpsCrmLeadFollowups', 'salesOpsCrmLeadFieldValues', 'salesOpsCrmLeadEvents']) {
+      expect(index(crm), crm).toBeLessThan(index('salesOpsCrmLeads'));
+    }
+    expect(index('salesOpsCrmLeadEvents')).toBeLessThan(index('salesOpsCrmLeads'));
+    expect(index('salesOpsCrmLeads')).toBeLessThan(index('salesOpsPipelineStages'));
+    expect(index('salesOpsPipelineTransitions')).toBeLessThan(index('salesOpsPipelineStages'));
+    expect(index('salesOpsPipelineStages')).toBeLessThan(index('salesOpsPipelines'));
+    expect(index('salesOpsCrmLeadFieldValues')).toBeLessThan(index('salesOpsFieldDefinitions'));
+    for (const target of ['salesOpsSales', 'salesOpsClients', 'salesOpsPeople', 'salesOpsProducts']) {
+      expect(index('salesOpsCrmLeads'), target).toBeLessThan(index(target));
+      expect(index('salesOpsCrmLeadFieldValues'), target).toBeLessThan(index(target));
+    }
+  });
 });
 
diff --git a/apps/api/scripts/seed-dev.ts b/apps/api/scripts/seed-dev.ts
index db6138c..b014fea 100644
--- a/apps/api/scripts/seed-dev.ts
+++ b/apps/api/scripts/seed-dev.ts
@@ -67,4 +67,14 @@ function resolveCutoffIso(): string {
 // silently reordering deletes or inserts around a restrict FK.
 const EXPECTED_DELETE_ORDER = [
+  'salesOpsCrmLeadNotes',
+  'salesOpsCrmLeadFollowups',
+  'salesOpsCrmLeadFieldValues',
+  'salesOpsCrmLeadEvents',
+  'salesOpsCrmLeads',
+  'salesOpsPipelineTransitions',
+  'salesOpsPipelineStages',
+  'salesOpsPipelines',
+  'salesOpsFieldDefinitions',
+  'salesOpsOrgModules',
   'salesOpsSettlements',
   'salesOpsPayables',
@@ -314,4 +324,17 @@ async function main(): Promise<void> {
       // SEED_DELETE_ORDER.
       //
+      // The unified CRM tables (migration 0029) come first: sales_ops_crm_leads
+      // restrict-references clientes, pessoas, propostas and produtos.
+      await tx.delete(schema.salesOpsCrmLeadNotes).where(eq(schema.salesOpsCrmLeadNotes.orgId, orgId));
+      await tx.delete(schema.salesOpsCrmLeadFollowups).where(eq(schema.salesOpsCrmLeadFollowups.orgId, orgId));
+      await tx.delete(schema.salesOpsCrmLeadFieldValues).where(eq(schema.salesOpsCrmLeadFieldValues.orgId, orgId));
+      await tx.delete(schema.salesOpsCrmLeadEvents).where(eq(schema.salesOpsCrmLeadEvents.orgId, orgId));
+      await tx.delete(schema.salesOpsCrmLeads).where(eq(schema.salesOpsCrmLeads.orgId, orgId));
+      await tx.delete(schema.salesOpsPipelineTransitions).where(eq(schema.salesOpsPipelineTransitions.orgId, orgId));
+      await tx.delete(schema.salesOpsPipelineStages).where(eq(schema.salesOpsPipelineStages.orgId, orgId));
+      await tx.delete(schema.salesOpsPipelines).where(eq(schema.salesOpsPipelines.orgId, orgId));
+      await tx.delete(schema.salesOpsFieldDefinitions).where(eq(schema.salesOpsFieldDefinitions.orgId, orgId));
+      await tx.delete(schema.salesOpsOrgModules).where(eq(schema.salesOpsOrgModules.orgId, orgId));
+      //
       // sales_ops_settlements refuses DELETE (FXS01) and its RESTRICT FKs block
       // the ledger deletes below. The dev seed runs only against the local
diff --git a/apps/api/scripts/seed/plan.ts b/apps/api/scripts/seed/plan.ts
index d9b3c72..91812b3 100644
--- a/apps/api/scripts/seed/plan.ts
+++ b/apps/api/scripts/seed/plan.ts
@@ -173,4 +173,14 @@ export const SEED_WRITE_ORDER = [
 
 export const SEED_DELETE_ORDER = [
+  'salesOpsCrmLeadNotes',
+  'salesOpsCrmLeadFollowups',
+  'salesOpsCrmLeadFieldValues',
+  'salesOpsCrmLeadEvents',
+  'salesOpsCrmLeads',
+  'salesOpsPipelineTransitions',
+  'salesOpsPipelineStages',
+  'salesOpsPipelines',
+  'salesOpsFieldDefinitions',
+  'salesOpsOrgModules',
   'salesOpsSettlements',
   'salesOpsPayables',
```

## The oracle

`apps/api/test/rls/crm-legacy-copy-migration.test.ts`. Cases and what each asserts:
1. additive only: `scanSql` of 0030 is `[]`, no `UPDATE`, every statement after the `set_config` is an `INSERT INTO` one of the seven target tables.
2. every source table (13 tables: etapas, leads, lead products, clientes, pessoas, produtos, propostas, recebíveis, a pagar, baixas, settings, outbox, legacy `leads`) has the same row count and `md5(string_agg(row::text))` before and after.
3. ledger and outbox counts unchanged (1/1/1/1).
4. the same ids: `sales_ops_leads EXCEPT sales_ops_crm_leads` is empty; per org count and `sum(estimated_value_brl)` equal; orgA is 5 leads and 169345; the legacy finder lead id is absent.
5. column-for-column equality for the 6 leads, plus converted `sale_id`, soft-delete fields, unassigned seller, free-text empresa.
6. at most one lead per proposta (a second insert fails `23505 sales_ops_crm_leads_org_sale_idx`) and no lead stage outside its pipeline.
7. orgA etapas: own ids/names/positions, types, behaviors, exits, archived stays archived; `Ganho` at 6 and `Pausado` at 7; every old stage id exists as a stage id.
8. orgB already had a normal etapa `Ganho`: the exit is `Ganho (saída)`.
9. orgC (no etapas) equals `DEFAULT_PIPELINE_STAGES` and its transitions equal `DEFAULT_PIPELINE_TRANSITIONS` mapped by label.
10. SQL transitions equal `planPipelineTransitions` for all three orgs; orgA has 16.
11. one default pipeline per org with the constant name and key; zero module rows.
12. fields: `cliente` system and non-removable in every org; orgA also has `produtos`, `descricao`, `nascimento`; orgB and orgC only `cliente`.
13. produtos: the catalog item (position 0, product id, snapshot) and the FREE item (position 1, no product id, text and snapshot equal), count equals the source rows.
14. description (`'desc conv'` and the empty string) and birth date (`1990-05-04`) values.
15. exactly one initial event per lead with `occurred_at = stage_changed_at`, actor `system`/`Migração`, the lost reason.
16. 20 FKs, all validated, zero orphans.
17. RLS on every new table as the owner role: no tenant sees 0 rows, orgA sees no other org's rows, an orgB UPDATE of orgA rows affects 0.
18. running the 0030 statements again changes no destination or source fingerprint.

```ts
/**
 * Migration oracle for 0030 (vendas-crm-unificado slice 06): the additive backfill of the
 * unified CRM model. A scratch database is migrated through 0029, populated with a SYNTHETIC
 * isolated dataset, then migrated to the head. No real data is read.
 *
 * Requires Docker Postgres running. Run with:
 *   pnpm --filter @fxl-sales/api exec env VITEST_INTEGRATION=1 vitest run test/rls/crm-legacy-copy-migration.test.ts
 */
import fs from 'node:fs';
import path from 'node:path';
import {
  DEFAULT_PIPELINE_STAGES,
  DEFAULT_PIPELINE_TRANSITIONS,
} from '@fxl-sales/shared-utils/default-pipeline';
import {
  defaultStageBehavior,
  defaultStageRequiresReason,
  planPipelineTransitions,
  type TransitionPlanStage,
} from '@fxl-sales/shared-utils/crm-model';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { scanSql } from '../../src/db/__tests__/additive-migration-scan.js';
import { runDatabaseMigrations } from '../../src/db/migration-runner.js';
import {
  cleanupScratch,
  createScratchDatabase,
  MIGRATIONS_FOLDER,
  scratchClient,
  type ScratchDatabase,
} from './scratch-database.js';

const BREAKPOINT = '--> statement-breakpoint';
const TAG_0029 = '0029_crm_unificado_modelo';
const FILE_0030 = '0030_crm_legacy_copy.sql';

/** Every table the backfill must only READ. Ledger, outbox and the legacy `leads` included. */
const SOURCE_TABLES = [
  'sales_ops_lead_stages',
  'sales_ops_leads',
  'sales_ops_lead_products',
  'sales_ops_clients',
  'sales_ops_people',
  'sales_ops_products',
  'sales_ops_sales',
  'sales_ops_receivables',
  'sales_ops_payables',
  'sales_ops_settlements',
  'sales_ops_settings',
  'integration_outbox',
  'leads',
] as const;

/** Every table 0029 creates; each carries org_id and FORCE RLS. */
const CRM_TABLES = [
  'sales_ops_pipelines',
  'sales_ops_pipeline_stages',
  'sales_ops_pipeline_transitions',
  'sales_ops_field_definitions',
  'sales_ops_crm_leads',
  'sales_ops_crm_lead_field_values',
  'sales_ops_crm_lead_events',
  'sales_ops_crm_lead_notes',
  'sales_ops_crm_lead_followups',
  'sales_ops_org_modules',
] as const;

const SEED_SQL = `SELECT set_config('app.fxl_admin', 'true', false);
-- orgA: full edition
INSERT INTO sales_ops_people (id, org_id, display_name) VALUES
 ('a0000000-0000-4000-8000-000000000001','orgA','Vendedora Ana');
INSERT INTO sales_ops_clients (id, org_id, name) VALUES
 ('a0000000-0000-4000-8000-000000000010','orgA','Cliente Alfa');
INSERT INTO sales_ops_products (id, org_id, name, seller_commission_value, finder_commission_value, seller_with_finder_commission_value) VALUES
 ('a0000000-0000-4000-8000-000000000020','orgA','Produto X',0,0,0);
INSERT INTO sales_ops_sales (id, org_id, sequence, code, client_name_snapshot, seller_name_snapshot, payment_method, condition, base_date, total_brl, seller_commission_pct, finder_commission_pct, tax_pct, net_margin_pct, status) VALUES
 ('a0000000-0000-4000-8000-000000000030','orgA',1,'P-1','Cliente Alfa','Vendedora Ana','pix','avista',now(),100000,0,0,0,0,'won'),
 ('a0000000-0000-4000-8000-000000000031','orgA',2,'P-2','Cliente Alfa','Vendedora Ana','pix','avista',now(),50000,0,0,0,0,'lost');
INSERT INTO sales_ops_receivables (id, org_id, sale_id, label, due_date, amount_brl) VALUES
 ('a0000000-0000-4000-8000-000000000040','orgA','a0000000-0000-4000-8000-000000000030','1/1',now(),100000);
INSERT INTO sales_ops_payables (id, org_id, sale_id, beneficiary_name, kind, due_date, amount_brl) VALUES
 ('a0000000-0000-4000-8000-000000000041','orgA','a0000000-0000-4000-8000-000000000030','Ana','seller_commission',now(),5000);
INSERT INTO sales_ops_settlements (id, org_id, sale_id, target_kind, receivable_id, type, paid_on, amount_brl, actor_user_id, actor_name) VALUES
 ('a0000000-0000-4000-8000-000000000042','orgA','a0000000-0000-4000-8000-000000000030','receivable','a0000000-0000-4000-8000-000000000040','baixa','2026-10-01',100000,'user_1','Admin');
INSERT INTO integration_outbox (id, organization_id, event_name, event_version, idempotency_key, payload, occurred_at) VALUES
 ('evt_a_1','orgA','fxl-sales.settlement.recorded',1,'k1','{}'::jsonb, now());
INSERT INTO sales_ops_lead_stages (id, org_id, name, kind, is_system, position, status, archived_at) VALUES
 ('a0000000-0000-4000-8000-000000000101','orgA','Prospecção','normal',false,1,'active',NULL),
 ('a0000000-0000-4000-8000-000000000102','orgA','Em negociação','normal',false,2,'active',NULL),
 ('a0000000-0000-4000-8000-000000000103','orgA','Proposta','conversion',true,3,'active',NULL),
 ('a0000000-0000-4000-8000-000000000104','orgA','Perdido','lost',true,4,'active',NULL),
 ('a0000000-0000-4000-8000-000000000105','orgA','Antiga','normal',false,5,'archived', now());
INSERT INTO sales_ops_leads (id, org_id, contact_name, contact_phone, contact_email, contact_birth_date, client_id, client_name_snapshot, estimated_value_brl, description, seller_person_id, seller_name_snapshot, stage_id, stage_changed_at, position, lost_reason, sale_id, deleted_at, deleted_by_user_id, deleted_by_name) VALUES
 ('a0000000-0000-4000-8000-000000000201','orgA','Lead convertido',NULL,NULL,NULL,'a0000000-0000-4000-8000-000000000010','Cliente Alfa',100000,'desc conv','a0000000-0000-4000-8000-000000000001','Vendedora Ana','a0000000-0000-4000-8000-000000000103','2026-09-01T10:00:00Z',0,NULL,'a0000000-0000-4000-8000-000000000030',NULL,NULL,NULL),
 ('a0000000-0000-4000-8000-000000000202','orgA','Lead perdido','1199','p@x.com','1990-05-04',NULL,'Empresa livre',50000,NULL,'a0000000-0000-4000-8000-000000000001','Vendedora Ana','a0000000-0000-4000-8000-000000000104','2026-09-02T10:00:00Z',0,'Sem orçamento',NULL,NULL,NULL,NULL),
 ('a0000000-0000-4000-8000-000000000203','orgA','Lead excluído',NULL,NULL,NULL,NULL,'',0,NULL,NULL,'','a0000000-0000-4000-8000-000000000101','2026-09-03T10:00:00Z',0,NULL,NULL,now(),'user_1','Admin'),
 ('a0000000-0000-4000-8000-000000000204','orgA','Lead sem vendedor',NULL,'u@x.com',NULL,NULL,'',7000,'',NULL,'','a0000000-0000-4000-8000-000000000101','2026-09-04T10:00:00Z',1,NULL,NULL,NULL,NULL,NULL),
 ('a0000000-0000-4000-8000-000000000205','orgA','Lead em negociação','1188',NULL,NULL,'a0000000-0000-4000-8000-000000000010','Cliente Alfa',12345,NULL,'a0000000-0000-4000-8000-000000000001','Vendedora Ana','a0000000-0000-4000-8000-000000000102','2026-09-05T10:00:00Z',0,NULL,NULL,NULL,NULL,NULL);
INSERT INTO sales_ops_lead_products (id, org_id, lead_id, product_id, product_name_snapshot) VALUES
 ('a0000000-0000-4000-8000-000000000301','orgA','a0000000-0000-4000-8000-000000000205','a0000000-0000-4000-8000-000000000020','Produto X'),
 ('a0000000-0000-4000-8000-000000000302','orgA','a0000000-0000-4000-8000-000000000205',NULL,'Item livre sem catálogo');
-- orgB: Construbom style, no produtos
INSERT INTO sales_ops_lead_stages (id, org_id, name, kind, is_system, position) VALUES
 ('b0000000-0000-4000-8000-000000000101','orgB','Novo','normal',false,1),
 ('b0000000-0000-4000-8000-000000000102','orgB','Em negociação','normal',false,2),
 ('b0000000-0000-4000-8000-000000000103','orgB','Proposta','conversion',true,3),
 ('b0000000-0000-4000-8000-000000000104','orgB','Perdido','lost',true,4),
 ('b0000000-0000-4000-8000-000000000105','orgB','Ganho','normal',false,5);
INSERT INTO sales_ops_leads (id, org_id, contact_name, contact_phone, client_name_snapshot, estimated_value_brl, stage_id, position) VALUES
 ('b0000000-0000-4000-8000-000000000201','orgB','Lead B1','1177','Construtora Z',900,'b0000000-0000-4000-8000-000000000101',0);
-- orgC: person only, no stages
INSERT INTO sales_ops_people (id, org_id, display_name) VALUES ('c0000000-0000-4000-8000-000000000001','orgC','Pessoa C');
-- legacy finder lead, must NOT be copied
INSERT INTO leads (id, org_id, status) VALUES ('d0000000-0000-4000-8000-000000000001','orgA','new');
`;

type Fingerprint = Record<string, { n: number; hash: string }>;

const L = (suffix: string, org = 'a') => `${org}0000000-0000-4000-8000-000000000${suffix}`;

describe('migration 0030 on a database populated at 0029', () => {
  let scratch: ScratchDatabase;
  let sourceBefore: Fingerprint;

  /** count + md5 of every row's text form; adminScratch is the superuser, so RLS does not hide rows. */
  async function fingerprint(tables: readonly string[]): Promise<Fingerprint> {
    const result: Fingerprint = {};
    for (const table of tables) {
      const [row] = await scratch.adminScratch.unsafe<{ n: number; hash: string }[]>(
        `SELECT count(*)::int AS n, coalesce(md5(string_agg(t::text, '|' ORDER BY t::text)), '') AS hash FROM ${table} t`,
      );
      result[table] = row!;
    }
    return result;
  }

  function copyChunks(): string[] {
    const sql = fs.readFileSync(path.resolve(MIGRATIONS_FOLDER, FILE_0030), 'utf8');
    return sql.split(BREAKPOINT).map((chunk) => chunk.trim()).filter(Boolean);
  }

  async function rows<T extends object>(query: string): Promise<T[]> {
    return [...(await scratch.adminScratch.unsafe<T[]>(query))];
  }

  beforeAll(async () => {
    scratch = await createScratchDatabase();
    await runDatabaseMigrations({
      databaseUrl: scratch.ownerUrl,
      migrationsFolder: MIGRATIONS_FOLDER,
      throughTag: TAG_0029,
    });
    await scratchClient(scratch).begin(async (tx) => {
      await tx.unsafe(SEED_SQL);
    });
    sourceBefore = await fingerprint(SOURCE_TABLES);
    expect((await fingerprint(CRM_TABLES))['sales_ops_crm_leads']!.n).toBe(0);
    await runDatabaseMigrations({ databaseUrl: scratch.ownerUrl, migrationsFolder: MIGRATIONS_FOLDER });
  }, 120000);

  afterAll(async () => {
    const errors = await cleanupScratch(scratch);
    if (errors.length > 0) throw new AggregateError(errors, 'scratch database cleanup failed');
  });

  it('0030 is additive only (no DROP, DELETE, TRUNCATE, RENAME, GRANT, ROLE) and never writes a source table', () => {
    const sql = fs.readFileSync(path.resolve(MIGRATIONS_FOLDER, FILE_0030), 'utf8');
    expect(scanSql(sql)).toEqual([]);
    expect(sql).not.toMatch(/\bUPDATE\b/i);
    for (const chunk of copyChunks().slice(1)) {
      expect(chunk, chunk.slice(0, 60)).toMatch(/^INSERT INTO "sales_ops_(pipelines|pipeline_stages|pipeline_transitions|field_definitions|crm_leads|crm_lead_field_values|crm_lead_events)"/);
    }
  });

  it('every source table is identical before and after (row count and content hash)', async () => {
    expect(await fingerprint(SOURCE_TABLES)).toEqual(sourceBefore);
    // spot checks that the fixture was not empty
    expect(sourceBefore['sales_ops_leads']!.n).toBe(6);
    expect(sourceBefore['sales_ops_lead_products']!.n).toBe(2);
    expect(sourceBefore['sales_ops_settlements']!.n).toBe(1);
    expect(sourceBefore['integration_outbox']!.n).toBe(1);
    expect(sourceBefore['leads']!.n).toBe(1);
  });

  it('payables, receivables, settlements and the outbox are unchanged and not touched by the new model', async () => {
    const [counts] = await rows<{ r: number; p: number; s: number; o: number }>(
      `SELECT (SELECT count(*) FROM sales_ops_receivables)::int r, (SELECT count(*) FROM sales_ops_payables)::int p,
              (SELECT count(*) FROM sales_ops_settlements)::int s, (SELECT count(*) FROM integration_outbox)::int o`,
    );
    expect(counts).toEqual({ r: 1, p: 1, s: 1, o: 1 });
  });

  it('copies every lead with the SAME id; counts and the estimated value sum match the source per org', async () => {
    const source = await rows<{ org_id: string; n: number; total: number }>(
      `SELECT org_id, count(*)::int n, sum(estimated_value_brl)::int total FROM sales_ops_leads GROUP BY 1 ORDER BY 1`,
    );
    const target = await rows<{ org_id: string; n: number; total: number }>(
      `SELECT org_id, count(*)::int n, sum(estimated_value_brl)::int total FROM sales_ops_crm_leads GROUP BY 1 ORDER BY 1`,
    );
    expect(target).toEqual(source);
    expect(source.find((r) => r.org_id === 'orgA')).toEqual({ org_id: 'orgA', n: 5, total: 169345 });
    const diff = await rows<{ id: string }>(
      `SELECT id FROM sales_ops_leads EXCEPT SELECT id FROM sales_ops_crm_leads`,
    );
    expect(diff).toEqual([]);
    const legacy = await rows<{ id: string }>(`SELECT id FROM sales_ops_crm_leads WHERE id = 'd0000000-0000-4000-8000-000000000001'`);
    expect(legacy).toEqual([]);
  });

  it('copies each lead column for column, including soft delete, unassigned and the proposta link', async () => {
    const lead = async (id: string) =>
      (await rows<Record<string, unknown>>(`SELECT * FROM sales_ops_crm_leads WHERE id = '${id}'`))[0]!;
    const sourceLead = async (id: string) =>
      (await rows<Record<string, unknown>>(`SELECT * FROM sales_ops_leads WHERE id = '${id}'`))[0]!;
    const shared = [
      'org_id', 'contact_name', 'contact_phone', 'contact_email', 'stage_id', 'position', 'stage_changed_at',
      'seller_person_id', 'seller_name_snapshot', 'client_id', 'client_name_snapshot', 'estimated_value_brl',
      'lost_reason', 'sale_id', 'created_at', 'updated_at', 'deleted_at', 'deleted_by_user_id', 'deleted_by_name',
    ];
    for (const id of ['201', '202', '203', '204', '205'].map((s) => L(s)).concat([L('201', 'b')])) {
      const copied = await lead(id);
      const original = await sourceLead(id);
      for (const column of shared) expect(copied[column], `${id}.${column}`).toEqual(original[column]);
    }
    expect((await lead(L('201')))['sale_id']).toBe(L('030'));
    expect((await lead(L('203')))['deleted_by_name']).toBe('Admin');
    expect((await lead(L('204')))['seller_person_id']).toBeNull();
    expect((await lead(L('202')))['client_id']).toBeNull();
    expect((await lead(L('202')))['client_name_snapshot']).toBe('Empresa livre');
    expect((await lead(L('201')))['client_id']).toBe(L('010'));
  });

  it('keeps at most one lead per proposta and every lead stage inside its own pipeline', async () => {
    const [orphans] = await rows<{ n: number }>(
      `SELECT count(*)::int n FROM sales_ops_crm_leads l
       LEFT JOIN sales_ops_pipeline_stages s ON s.org_id = l.org_id AND s.pipeline_id = l.pipeline_id AND s.id = l.stage_id
       WHERE s.id IS NULL`,
    );
    expect(orphans!.n).toBe(0);
    await expect(
      scratch.adminScratch.unsafe(
        `INSERT INTO sales_ops_crm_leads (org_id, contact_name, pipeline_id, stage_id, sale_id)
         SELECT org_id, 'dup', pipeline_id, stage_id, sale_id FROM sales_ops_crm_leads WHERE id = '${L('201')}'`,
      ),
    ).rejects.toMatchObject({ code: '23505', constraint_name: 'sales_ops_crm_leads_org_sale_idx' });
  });

  it('migrates the etapas of an org with its OWN ids, names and positions, and adds Ganho and Pausado', async () => {
    const stages = await rows<{ id: string; name: string; position: number; type: string; behavior: string; exit_kind: string | null; requires_reason: boolean; status: string }>(
      `SELECT id, name, position, type, behavior, exit_kind, requires_reason, status FROM sales_ops_pipeline_stages WHERE org_id = 'orgA' ORDER BY position`,
    );
    expect(stages.map((s) => [s.name, s.position, s.type, s.behavior, s.exit_kind, s.requires_reason, s.status])).toEqual([
      ['Prospecção', 1, 'normal', 'none', null, false, 'active'],
      ['Em negociação', 2, 'normal', 'none', null, false, 'active'],
      ['Proposta', 3, 'orcamento', 'opens_orcamentos', null, false, 'active'],
      ['Perdido', 4, 'saida', 'none', 'perdido', true, 'active'],
      ['Antiga', 5, 'normal', 'none', null, false, 'archived'],
      ['Ganho', 6, 'saida', 'none', 'ganho', false, 'active'],
      ['Pausado', 7, 'saida', 'none', 'pausado', false, 'active'],
    ]);
    expect(stages.slice(0, 5).map((s) => s.id)).toEqual(['101', '102', '103', '104', '105'].map((s) => L(s)));
    const noRename = await rows<{ id: string }>(
      `SELECT id FROM sales_ops_lead_stages EXCEPT SELECT id FROM sales_ops_pipeline_stages`,
    );
    expect(noRename).toEqual([]);
  });

  it('never loses an exit when an org already named a normal etapa Ganho', async () => {
    const names = await rows<{ name: string; type: string; exit_kind: string | null }>(
      `SELECT name, type, exit_kind FROM sales_ops_pipeline_stages WHERE org_id = 'orgB' AND name LIKE 'Ganho%' ORDER BY name`,
    );
    expect(names).toEqual([
      { name: 'Ganho', type: 'normal', exit_kind: null },
      { name: 'Ganho (saída)', type: 'saida', exit_kind: 'ganho' },
    ]);
  });

  it('gives an org with no etapa the pure default pipeline, equal to DEFAULT_PIPELINE_STAGES and its transitions', async () => {
    const stages = await rows<{ id: string; name: string; position: number; type: string; behavior: string; exit_kind: string | null; requires_reason: boolean }>(
      `SELECT id, name, position, type, behavior, exit_kind, requires_reason FROM sales_ops_pipeline_stages WHERE org_id = 'orgC' ORDER BY position`,
    );
    expect(stages.map((s) => [s.name, s.position, s.type, s.behavior, s.exit_kind, s.requires_reason])).toEqual(
      DEFAULT_PIPELINE_STAGES.map((s) => [s.label, s.order, s.type, defaultStageBehavior(s), s.exitKind, defaultStageRequiresReason(s)]),
    );
    const idByKey = new Map(DEFAULT_PIPELINE_STAGES.map((s, i) => [s.key as string, stages[i]!.id]));
    const transitions = await rows<{ from_stage_id: string; to_stage_id: string }>(
      `SELECT from_stage_id, to_stage_id FROM sales_ops_pipeline_transitions WHERE org_id = 'orgC'`,
    );
    expect(new Set(transitions.map((t) => `${t.from_stage_id}>${t.to_stage_id}`))).toEqual(
      new Set(DEFAULT_PIPELINE_TRANSITIONS.map(([a, b]) => `${idByKey.get(a)}>${idByKey.get(b)}`)),
    );
  });

  it('the SQL transition graph equals the TS rule planPipelineTransitions for every org', async () => {
    for (const org of ['orgA', 'orgB', 'orgC']) {
      const stages = await rows<{ id: string; name: string; position: number; type: TransitionPlanStage['type']; exit_kind: TransitionPlanStage['exitKind']; status: TransitionPlanStage['status'] }>(
        `SELECT id, name, position, type, exit_kind, status FROM sales_ops_pipeline_stages WHERE org_id = '${org}'`,
      );
      const planned = planPipelineTransitions(stages.map((s) => ({ id: s.id, name: s.name, position: s.position, type: s.type, exitKind: s.exit_kind, status: s.status })));
      const stored = await rows<{ from_stage_id: string; to_stage_id: string }>(
        `SELECT from_stage_id, to_stage_id FROM sales_ops_pipeline_transitions WHERE org_id = '${org}'`,
      );
      expect(new Set(stored.map((t) => `${t.from_stage_id}>${t.to_stage_id}`)), org).toEqual(new Set(planned.map(([a, b]) => `${a}>${b}`)));
    }
    const [a] = await rows<{ n: number }>(`SELECT count(*)::int n FROM sales_ops_pipeline_transitions WHERE org_id = 'orgA'`);
    expect(a!.n).toBe(16);
  });

  it('creates one default pipeline per org, named and keyed, and no module rows (the token is not in the database)', async () => {
    const pipelines = await rows<{ org_id: string; name: string; system_key: string; is_default: boolean }>(
      `SELECT org_id, name, system_key, is_default FROM sales_ops_pipelines ORDER BY org_id`,
    );
    expect(pipelines).toEqual(
      ['orgA', 'orgB', 'orgC'].map((org_id) => ({ org_id, name: 'Funil CRM padrão', system_key: 'crm-padrao', is_default: true })),
    );
    expect((await fingerprint(['sales_ops_org_modules']))['sales_ops_org_modules']!.n).toBe(0);
  });

  it('Cliente becomes the non-removable system field; other fields exist only where data needs them', async () => {
    const fields = await rows<{ org_id: string; key: string; kind: string; reference_target: string | null; multiple: boolean; is_system: boolean; removable: boolean; backing_column: string | null }>(
      `SELECT org_id, key, kind, reference_target, multiple, is_system, removable, backing_column FROM sales_ops_field_definitions ORDER BY org_id, position`,
    );
    const cliente = { key: 'cliente', kind: 'reference', reference_target: 'cliente', multiple: false, is_system: true, removable: false, backing_column: 'client_id' };
    expect(fields.filter((f) => f.org_id === 'orgA').map((f) => f.key)).toEqual(['cliente', 'produtos', 'descricao', 'nascimento']);
    expect(fields.filter((f) => f.org_id === 'orgB').map((f) => f.key)).toEqual(['cliente']);
    expect(fields.filter((f) => f.org_id === 'orgC').map((f) => f.key)).toEqual(['cliente']);
    for (const org of ['orgA', 'orgB', 'orgC']) {
      expect(fields.find((f) => f.org_id === org && f.key === 'cliente')).toMatchObject({ org_id: org, ...cliente });
    }
    expect(fields.find((f) => f.key === 'produtos')).toMatchObject({ kind: 'reference', reference_target: 'produto', multiple: true, is_system: false, removable: true });
  });

  it('lead produtos become Produto values, FREE items (no catalog row) included with their name snapshot', async () => {
    const values = await rows<{ lead_id: string; position: number; value_product_id: string | null; value_text: string | null; ref_name_snapshot: string }>(
      `SELECT v.lead_id, v.position, v.value_product_id, v.value_text, v.ref_name_snapshot
       FROM sales_ops_crm_lead_field_values v JOIN sales_ops_field_definitions f ON f.id = v.field_id AND f.key = 'produtos'
       ORDER BY v.lead_id, v.position`,
    );
    expect(values).toEqual([
      { lead_id: L('205'), position: 0, value_product_id: L('020'), value_text: null, ref_name_snapshot: 'Produto X' },
      { lead_id: L('205'), position: 1, value_product_id: null, value_text: 'Item livre sem catálogo', ref_name_snapshot: 'Item livre sem catálogo' },
    ]);
    const [counts] = await rows<{ source: number }>(`SELECT count(*)::int source FROM sales_ops_lead_products`);
    expect(values).toHaveLength(counts!.source);
  });

  it('description and birth date become typed values; an empty description is preserved', async () => {
    const desc = await rows<{ lead_id: string; value_text: string }>(
      `SELECT v.lead_id, v.value_text FROM sales_ops_crm_lead_field_values v JOIN sales_ops_field_definitions f ON f.id = v.field_id AND f.key = 'descricao' ORDER BY v.lead_id`,
    );
    expect(desc).toEqual([{ lead_id: L('201'), value_text: 'desc conv' }, { lead_id: L('204'), value_text: '' }]);
    const birth = await rows<{ lead_id: string; value_date: string }>(
      `SELECT v.lead_id, v.value_date::text FROM sales_ops_crm_lead_field_values v JOIN sales_ops_field_definitions f ON f.id = v.field_id AND f.key = 'nascimento'`,
    );
    expect(birth).toEqual([{ lead_id: L('202'), value_date: '1990-05-04' }]);
  });

  it('stage_changed_at becomes the first and only history event of each lead', async () => {
    const events = await rows<{ lead_id: string; kind: string; from_stage_id: string | null; to_stage_id: string; reason: string | null; actor_user_id: string; actor_name_snapshot: string; same_time: boolean }>(
      `SELECT e.lead_id, e.kind, e.from_stage_id, e.to_stage_id, e.reason, e.actor_user_id, e.actor_name_snapshot,
              e.occurred_at = l.stage_changed_at AS same_time
       FROM sales_ops_crm_lead_events e JOIN sales_ops_leads l ON l.id = e.lead_id ORDER BY e.lead_id`,
    );
    expect(events).toHaveLength(6);
    for (const event of events) {
      expect(event).toMatchObject({ kind: 'stage_changed', from_stage_id: null, actor_user_id: 'system', actor_name_snapshot: 'Migração', same_time: true });
    }
    expect(events.find((e) => e.lead_id === L('202'))).toMatchObject({ to_stage_id: L('104'), reason: 'Sem orçamento' });
  });

  it('leaves no orphan foreign key anywhere in the new tables', async () => {
    const fks = await rows<{ conrelid: string; conname: string; validated: boolean }>(
      `SELECT conrelid::regclass::text conrelid, conname, convalidated validated FROM pg_constraint
       WHERE contype = 'f' AND conrelid::regclass::text = ANY(ARRAY[${CRM_TABLES.map((t) => `'${t}'`).join(',')}])`,
    );
    expect(fks.length).toBe(20);
    expect(fks.filter((fk) => !fk.validated)).toEqual([]);
    const [orphans] = await rows<{ n: number }>(
      `SELECT ((SELECT count(*) FROM sales_ops_crm_lead_field_values v LEFT JOIN sales_ops_crm_leads l ON l.org_id = v.org_id AND l.id = v.lead_id WHERE l.id IS NULL)
             + (SELECT count(*) FROM sales_ops_crm_lead_events e LEFT JOIN sales_ops_crm_leads l ON l.org_id = e.org_id AND l.id = e.lead_id WHERE l.id IS NULL)
             + (SELECT count(*) FROM sales_ops_pipeline_transitions t LEFT JOIN sales_ops_pipeline_stages s ON s.org_id = t.org_id AND s.pipeline_id = t.pipeline_id AND s.id = t.from_stage_id WHERE s.id IS NULL))::int n`,
    );
    expect(orphans!.n).toBe(0);
  });

  it('RLS isolates orgs on every new table, for the owner role that FORCE RLS applies to', async () => {
    const client = scratchClient(scratch);
    for (const table of CRM_TABLES) {
      const counts = await client.begin(async (tx) => {
        const none = (await tx.unsafe(`SELECT count(*)::int n FROM ${table}`))[0]!.n as number;
        await tx.unsafe(`SELECT set_config('app.current_org_id', 'orgA', true)`);
        const a = (await tx.unsafe(`SELECT count(*)::int n FROM ${table} WHERE org_id <> 'orgA'`))[0]!.n as number;
        const own = (await tx.unsafe(`SELECT count(*)::int n FROM ${table}`))[0]!.n as number;
        return { none, a, own };
      });
      expect(counts.none, `${table} without a tenant`).toBe(0);
      expect(counts.a, `${table} foreign rows visible to orgA`).toBe(0);
      const total = (await fingerprint([table]))[table]!.n;
      if (total > 0) expect(counts.own, `${table} own rows`).toBeGreaterThan(0);
    }
    await expect(
      client.begin(async (tx) => {
        await tx.unsafe(`SELECT set_config('app.current_org_id', 'orgB', true)`);
        await tx.unsafe(`UPDATE sales_ops_crm_leads SET contact_name = 'x' WHERE org_id = 'orgA'`).then((r) => {
          if (r.count !== 0) throw new Error(`orgB updated ${r.count} orgA rows`);
        });
      }),
    ).resolves.toBeUndefined();
  });

  it('running the backfill SQL a second time is a no-op for every destination and source table', async () => {
    const before = await fingerprint([...CRM_TABLES, ...SOURCE_TABLES]);
    await scratchClient(scratch).begin(async (tx) => {
      for (const chunk of copyChunks()) await tx.unsafe(chunk);
    });
    expect(await fingerprint([...CRM_TABLES, ...SOURCE_TABLES])).toEqual(before);
  });
});
```

## Commands

- Oracle: `pnpm --filter @fxl-sales/api exec env VITEST_INTEGRATION=1 vitest run test/rls/crm-legacy-copy-migration.test.ts`
- Parity and seed: `pnpm --filter @fxl-sales/api exec vitest run src/domains/sales-ops/leads/__tests__/default-pipeline-parity.test.ts scripts/__tests__/seed-plan.test.ts src/db/__tests__`
- Affected integration (shared DB, serial): `pnpm --filter @fxl-sales/api exec env VITEST_INTEGRATION=1 vitest run test/rls/leads-schema-migration.test.ts test/rls/lead-stages-seed-on-read.test.ts test/rls/crm-schema-rls.test.ts test/rls/crm-defaults.test.ts`
- Lint and types: `pnpm --filter @fxl-sales/api lint`; `pnpm --filter @fxl-sales/api type-check`
- Global: `pnpm test` (root guards) before the wave gate.

## Risks

- Real databases (FXL staging/production, Construbom, ECV Control) are NOT touched by this run; volumes, deploy order and rollback are filed as pending in the report.
- Rows written to the old tables between 0030 and the phase 2 cutover are not copied: the cutover migration must repeat these statements (SEAM-CONTRACT rule).
- `ON CONFLICT DO NOTHING` also swallows a genuine unique violation on stage names (`Ganho` collision); the name rule above avoids losing the exit, and test 8 pins it.
- The partial unique index on `sale_id` could reject a copied lead only if the source already violated the same index; it cannot.

## Plan-check addendum (orchestrator revision, round 2)

Binding. The plan-check report `nexo/runs/20261021T011348Z-vendas-crm-unificado/agents/plan-check-fase1bc.md` defects 1, 2 and 6 apply to this slice; the text below is copied from it and wins over the body above where they differ.

### 1. BLOCKER - `purgeOrgLedgerForTests` is not updated; an existing integration test breaks on a seeded dev DB (06, files_modified)

`apps/api/src/db/__tests__/settlement-test-cleanup.ts` `purgeOrgLedgerForTests` (used by `src/domains/integration/__tests__/finance-integration.integration.test.ts`, fixed org `org_fake_integrado`) deletes `sales_ops_leads` then `sales_ops_sales`.
The shared integration DB is the dev DB (`.env` TEST_* all point at database `fxl_sales`), and the dev seed writes leads for `org_fake_integrado`, one with `saleId: saleIdS1` (`apps/api/scripts/seed/plan.ts` ~1467-1700).
When global-setup applies 0030, that lead is copied to `sales_ops_crm_leads` with `sale_id`; the helper then fails with 23503 on `sales_ops_crm_leads_org_sale_fk` (the helper's own comment says a new reference to the sale tree must fail loudly).
Reproduced: running the helper's exact delete sequence on a scratch DB after 0030 fails 23503; the same sequence with the CRM deletes first succeeds.
No plan lists this file; the plans only patch the dev seed. This is the "most likely breakage" and it is real. All other cleanup helpers/tests (about 40 files that delete clientes/pessoas/produtos/propostas/stages) use their own orgs and are unaffected as long as no CRM row exists for those orgs.

Paste into 06:
- `files_modified` add `"apps/api/src/db/__tests__/settlement-test-cleanup.ts"`; `affected_tests` add `{path: apps/api/src/domains/integration/__tests__/finance-integration.integration.test.ts, impact: "its purge helper deletes sales that the CRM copy now references", update: none (helper fixed in step 7), command: "pnpm --filter @fxl-sales/api exec env VITEST_INTEGRATION=1 vitest run src/domains/integration/__tests__/finance-integration.integration.test.ts", owner: builder}`.
- New step 7 (renumber the old 7 to 8): "In `purgeOrgLedgerForTests`, immediately BEFORE the line deleting `sales_ops_lead_products`, add five lines in this order, same pattern as the neighbours: `DELETE FROM sales_ops_crm_lead_notes`, `sales_ops_crm_lead_followups`, `sales_ops_crm_lead_field_values`, `sales_ops_crm_lead_events`, `sales_ops_crm_leads`, each `WHERE org_id = ANY(${ids})`. Extend its doc comment: 'the unified CRM lead copies restrict-reference the sale, the cliente, the pessoa and the produto'."
- Add one oracle case to `crm-legacy-copy-migration.test.ts`: on the migrated scratch DB (superuser, settlements first via `SET LOCAL session_replication_role = replica`), the helper's delete sequence WITHOUT the CRM deletes rejects with `code: '23503'`, and WITH them succeeds (wrap in a transaction that throws to roll back). I wrote and ran exactly this probe; it passes.
- Run `finance-integration.integration.test.ts` against the dev DB after global-setup applies 0030 (that DB holds the seeded leads).

### 2. MAJOR - 06 oracle fixture misses the AC "leads legados de finder com click/link/conversion" and does not fingerprint ALL source tables

The seed has one bare `INSERT INTO leads (id, org_id, status)`; no `finders`, `referral_links`, `clicks`, `conversions`, `apps`, `products`; `SOURCE_TABLES` has 13 entries and none of those. The request (1c AC) requires finder lead + click + link + conversion and "todas as tabelas de origem" identical.
Paste (tested, oracle stays 18/18 green): replace the `INSERT INTO leads ...` line of `SEED_SQL` with
```sql
INSERT INTO apps (id, slug, name, publishable_key, secret_key_hash, secret_key_prefix, webhook_signing_secret, allowed_redirect_hosts, status, created_by_user_id) VALUES
 ('d0000000-0000-4000-8000-0000000000a1','app-x','App X','pk_x','h','sk_','w','{example.com}','active','user_1');
INSERT INTO products (id, app_id, slug, name, status) VALUES ('d0000000-0000-4000-8000-0000000000a2','d0000000-0000-4000-8000-0000000000a1','p','P','active');
INSERT INTO finders (id, org_id, status, display_name, contact_email) VALUES ('d0000000-0000-4000-8000-0000000000a3','orgA','approved','Finder','f@x.com');
INSERT INTO referral_links (id, org_id, code, finder_id, app_id, product_id, quoted_setup_brl, quoted_monthly_brl, signature, destination_url) VALUES
 ('d0000000-0000-4000-8000-0000000000a4','orgA','CODE000001','d0000000-0000-4000-8000-0000000000a3','d0000000-0000-4000-8000-0000000000a1','d0000000-0000-4000-8000-0000000000a2',1000,500,'sig','https://example.com/x');
INSERT INTO clicks (click_id, org_id, link_id, finder_id, app_id, product_id) VALUES
 ('CLICK0000000000000000000001','orgA','d0000000-0000-4000-8000-0000000000a4','d0000000-0000-4000-8000-0000000000a3','d0000000-0000-4000-8000-0000000000a1','d0000000-0000-4000-8000-0000000000a2');
INSERT INTO leads (id, org_id, click_id, link_id, status) VALUES ('d0000000-0000-4000-8000-000000000001','orgA','CLICK0000000000000000000001','d0000000-0000-4000-8000-0000000000a4','converted');
INSERT INTO conversions (source, external_order_id, idempotency_key, org_id, link_id, click_id, finder_id, app_id, product_id, quoted_setup_brl, quoted_monthly_brl, realized_setup_brl, realized_monthly_brl, hold_until, closed_at) VALUES
 ('fxl-financiero','ord1','idem1','orgA','d0000000-0000-4000-8000-0000000000a4','CLICK0000000000000000000001','d0000000-0000-4000-8000-0000000000a3','d0000000-0000-4000-8000-0000000000a1','d0000000-0000-4000-8000-0000000000a2',1000,500,1000,500,now(),now());
```
and add `'apps','products','finders','referral_links','clicks','conversions'` to `SOURCE_TABLES` (and a spot check `sourceBefore['conversions']!.n === 1`). Update oracle case 2 text from "13 tables" to "19 tables". Optional hardening (untested): build the list from `pg_tables` (all public tables except the ten CRM tables and the drizzle bookkeeping table) so "ALL" is literal.


### 6. MINOR - Shared-DB residue risk is unmentioned (06 Risks)
global-setup applies 0030 to whatever legacy leads sit in the shared DB (the dev DB, so seeded leads plus any residue). Add to Risks: "After the first integration run, `sales_ops_crm_leads` holds a copy of every legacy lead in the shared DB. A test that reuses an org with such a lead and deletes its cliente/pessoa/proposta hits 23503. Remedy: re-run the dev seed (SEED_DELETE_ORDER now clears the CRM tables) or delete the CRM rows of that org as the local superuser."


Also add `deleteCrmForOrgs(orgIds)` in `apps/api/src/db/__tests__/settlement-test-cleanup.ts` (exported, order: notes, followups, field_values, events, leads, transitions, stages, pipelines, field_definitions, org_modules, each `WHERE org_id = ANY(ids)`), and make `purgeOrgLedgerForTests` call its lead part (notes to leads) before `sales_ops_lead_products`; phase 2 slice 07a reuses it everywhere else.
