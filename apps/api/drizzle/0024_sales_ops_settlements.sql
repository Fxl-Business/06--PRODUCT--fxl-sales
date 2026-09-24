-- 0024_sales_ops_settlements - baixa and estorno facts for the ledger, and a per-row revision.
--
-- LINES: sales_ops_sale_items and sales_ops_sale_professionals gain a nullable
-- `removed_at`. Editing a proposta soft-removes a line instead of deleting it, so
-- ids stay stable and the RESTRICT FK from sales_ops_payables keeps holding.
-- Readers filter removed_at IS NULL. Existing RLS policies cover the new column.
--
-- WHAT: sales_ops_receivables and sales_ops_payables gain `revision` (starts at 1,
-- bumped by exactly 1 with every change of amount, due date, counterparty or
-- status, contract C7) and `updated_at`. The new tenant table
-- sales_ops_settlements holds immutable settlement facts: a `baixa` records a real
-- payment day and amount against ONE receivable or payable, an `estorno`
-- reverses exactly one baixa. A row's paid state is a pure function of its facts
-- (active baixa = a baixa no estorno points at; paid = sum of active; displayed
-- day = the greatest active paid_on), the same rules as Finance's
-- reduzirLiquidacao. `status = 'paid'` stays on the ledger rows as a cache.
--
-- IMMUTABILITY: a BEFORE UPDATE OR DELETE trigger refuses every change with
-- SQLSTATE FXS01. A correction is an estorno plus a new baixa, never an edit.
-- Finance refuses UPDATE only, because its restore deletes by org and its FKs
-- cascade. Sales has neither: nothing in the product deletes a sale, and every
-- FK here is RESTRICT, so a settled row, its sale and a reversed baixa can never
-- disappear. Local tests and the dev seed remove settlements only as the local
-- superuser with session_replication_role = replica; product code has no path.
-- A BEFORE INSERT trigger refuses, with SQLSTATE FXS02, an estorno that does not
-- mirror its baixa (same org, sale, kind, row and amount; the target must be a
-- baixa). The CHECKs and FKs keep their own SQLSTATEs (23514, 23503), because
-- the insert trigger returns early for every case they already refuse.
--
-- TENANCY: org_id text NOT NULL, FORCE ROW LEVEL SECURITY with the same two
-- policies 0012 and 0022 spell. Every FK is composite and leads with org_id, and
-- the row FKs also carry sale_id, so a settlement cannot point at another org's
-- row or at a row of a different sale even in the admin context. A single-column
-- FK would not consult the RLS predicate.
--
-- ONE ESTORNO PER BAIXA: a partial unique index on reverses_settlement_id.
-- A second estorno of the same baixa fails with 23505.
--
-- BACKFILL: before this file no production code could write status = 'paid'
-- (only test fixtures and the dev seed did), so the backfill is expected to be
-- empty in staging and production. Every paid row with amount_brl > 0 gets ONE
-- synthetic baixa: amount = the row amount, origin 'manual', actor_user_id
-- 'system', actor_name 'Migração'. No row stores a payment day, so paid_on is the
-- row's civil due day (the UTC day of due_date, the storage convention of
-- dateFromIsoDay), clamped to today in America/Sao_Paulo so it is never in the
-- future. A paid row with amount_brl <= 0 gets no baixa: the amount CHECK forbids
-- it and the reducer reads a zero row as settled with no fact. The final DO block
-- recomputes every paid row from its facts and aborts the whole file with
-- SQLSTATE FXS03 on any divergence, journal row included.
--
-- PRE-FLIGHT against a real target before deploying (comment only):
-- SELECT 'receivable' AS kind, count(*) FROM sales_ops_receivables WHERE status = 'paid'
-- UNION ALL SELECT 'payable', count(*) FROM sales_ops_payables WHERE status = 'paid';
--
-- No privilege statement appears in this file. The test role already holds
-- ALTER DEFAULT PRIVILEGES on new public tables, and a journaled migration must
-- never create, alter or grant to a cluster role; see the single-role database
-- contract test, which reads every migration's bytes.
ALTER TABLE "sales_ops_receivables" ADD COLUMN "revision" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "sales_ops_receivables" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "sales_ops_receivables" ADD CONSTRAINT "sales_ops_receivables_revision_check" CHECK ("sales_ops_receivables"."revision" >= 1);--> statement-breakpoint
ALTER TABLE "sales_ops_payables" ADD COLUMN "revision" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "sales_ops_payables" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "sales_ops_payables" ADD CONSTRAINT "sales_ops_payables_revision_check" CHECK ("sales_ops_payables"."revision" >= 1);--> statement-breakpoint
ALTER TABLE "sales_ops_sale_items" ADD COLUMN "removed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "sales_ops_sale_professionals" ADD COLUMN "removed_at" timestamp with time zone;--> statement-breakpoint
CREATE UNIQUE INDEX "sales_ops_receivables_org_sale_id_id_idx" ON "sales_ops_receivables" USING btree ("org_id","sale_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "sales_ops_payables_org_sale_id_id_idx" ON "sales_ops_payables" USING btree ("org_id","sale_id","id");--> statement-breakpoint
CREATE TABLE "sales_ops_settlements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" text NOT NULL,
	"sale_id" uuid NOT NULL,
	"target_kind" text NOT NULL,
	"receivable_id" uuid,
	"payable_id" uuid,
	"type" text NOT NULL,
	"reverses_settlement_id" uuid,
	"paid_on" date NOT NULL,
	"amount_brl" integer NOT NULL,
	"origin" text DEFAULT 'manual' NOT NULL,
	"actor_user_id" text NOT NULL,
	"actor_name" text,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
	"reason" text,
	CONSTRAINT "sales_ops_settlements_target_kind_check" CHECK ("sales_ops_settlements"."target_kind" in ('receivable', 'payable')),
	CONSTRAINT "sales_ops_settlements_target_check" CHECK (("sales_ops_settlements"."target_kind" = 'receivable' and "sales_ops_settlements"."receivable_id" is not null and "sales_ops_settlements"."payable_id" is null) or ("sales_ops_settlements"."target_kind" = 'payable' and "sales_ops_settlements"."payable_id" is not null and "sales_ops_settlements"."receivable_id" is null)),
	CONSTRAINT "sales_ops_settlements_type_check" CHECK ("sales_ops_settlements"."type" in ('baixa', 'estorno')),
	CONSTRAINT "sales_ops_settlements_reverses_check" CHECK (("sales_ops_settlements"."type" = 'estorno') = ("sales_ops_settlements"."reverses_settlement_id" is not null)),
	CONSTRAINT "sales_ops_settlements_reverses_not_self_check" CHECK ("sales_ops_settlements"."reverses_settlement_id" is null or "sales_ops_settlements"."reverses_settlement_id" <> "sales_ops_settlements"."id"),
	CONSTRAINT "sales_ops_settlements_amount_check" CHECK ("sales_ops_settlements"."amount_brl" > 0),
	CONSTRAINT "sales_ops_settlements_origin_check" CHECK ("sales_ops_settlements"."origin" in ('manual', 'finance')),
	CONSTRAINT "sales_ops_settlements_reason_check" CHECK ("sales_ops_settlements"."type" = 'estorno' or "sales_ops_settlements"."reason" is null),
	CONSTRAINT "sales_ops_settlements_actor_check" CHECK (length(btrim("sales_ops_settlements"."actor_user_id")) > 0)
);--> statement-breakpoint
CREATE UNIQUE INDEX "sales_ops_settlements_org_id_id_idx" ON "sales_ops_settlements" USING btree ("org_id","id");--> statement-breakpoint
CREATE INDEX "sales_ops_settlements_org_sale_idx" ON "sales_ops_settlements" USING btree ("org_id","sale_id");--> statement-breakpoint
CREATE INDEX "sales_ops_settlements_org_receivable_idx" ON "sales_ops_settlements" USING btree ("org_id","receivable_id") WHERE "sales_ops_settlements"."receivable_id" is not null;--> statement-breakpoint
CREATE INDEX "sales_ops_settlements_org_payable_idx" ON "sales_ops_settlements" USING btree ("org_id","payable_id") WHERE "sales_ops_settlements"."payable_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "sales_ops_settlements_one_estorno_per_baixa_idx" ON "sales_ops_settlements" USING btree ("reverses_settlement_id") WHERE "sales_ops_settlements"."reverses_settlement_id" is not null;--> statement-breakpoint
ALTER TABLE "sales_ops_settlements" ADD CONSTRAINT "sales_ops_settlements_org_sale_fk" FOREIGN KEY ("org_id","sale_id") REFERENCES "public"."sales_ops_sales"("org_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_ops_settlements" ADD CONSTRAINT "sales_ops_settlements_org_sale_receivable_fk" FOREIGN KEY ("org_id","sale_id","receivable_id") REFERENCES "public"."sales_ops_receivables"("org_id","sale_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_ops_settlements" ADD CONSTRAINT "sales_ops_settlements_org_sale_payable_fk" FOREIGN KEY ("org_id","sale_id","payable_id") REFERENCES "public"."sales_ops_payables"("org_id","sale_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_ops_settlements" ADD CONSTRAINT "sales_ops_settlements_org_reverses_fk" FOREIGN KEY ("org_id","reverses_settlement_id") REFERENCES "public"."sales_ops_settlements"("org_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE FUNCTION "public"."sales_ops_settlements_refuse_mutation"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'sales_ops_settlements is immutable: % of settlement % refused, record an estorno instead', TG_OP, OLD."id"
    USING ERRCODE = 'FXS01';
END
$$;--> statement-breakpoint
CREATE TRIGGER "sales_ops_settlements_immutable" BEFORE UPDATE OR DELETE ON "sales_ops_settlements"
  FOR EACH ROW EXECUTE FUNCTION "public"."sales_ops_settlements_refuse_mutation"();--> statement-breakpoint
CREATE FUNCTION "public"."sales_ops_settlements_validate_insert"() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  target "public"."sales_ops_settlements"%ROWTYPE;
BEGIN
  IF NEW."type" IS DISTINCT FROM 'estorno' OR NEW."reverses_settlement_id" IS NULL THEN
    RETURN NEW;
  END IF;
  SELECT * INTO target FROM "public"."sales_ops_settlements" WHERE "id" = NEW."reverses_settlement_id";
  IF NOT FOUND THEN
    RETURN NEW;
  END IF;
  IF target."type" <> 'baixa'
     OR target."org_id" IS DISTINCT FROM NEW."org_id"
     OR target."sale_id" IS DISTINCT FROM NEW."sale_id"
     OR target."target_kind" IS DISTINCT FROM NEW."target_kind"
     OR target."receivable_id" IS DISTINCT FROM NEW."receivable_id"
     OR target."payable_id" IS DISTINCT FROM NEW."payable_id"
     OR target."amount_brl" <> NEW."amount_brl" THEN
    RAISE EXCEPTION 'sales_ops_settlements: estorno % does not mirror baixa %', NEW."id", NEW."reverses_settlement_id"
      USING ERRCODE = 'FXS02';
  END IF;
  RETURN NEW;
END
$$;--> statement-breakpoint
CREATE TRIGGER "sales_ops_settlements_validate" BEFORE INSERT ON "sales_ops_settlements"
  FOR EACH ROW EXECUTE FUNCTION "public"."sales_ops_settlements_validate_insert"();--> statement-breakpoint
ALTER TABLE sales_ops_settlements ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE sales_ops_settlements FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY sales_ops_settlements_tenant_isolation ON sales_ops_settlements
  AS PERMISSIVE FOR ALL
  USING (org_id = current_setting('app.current_org_id', true))
  WITH CHECK (org_id = current_setting('app.current_org_id', true));--> statement-breakpoint
CREATE POLICY sales_ops_settlements_admin_context ON sales_ops_settlements
  AS PERMISSIVE FOR ALL
  USING (current_setting('app.fxl_admin', true) = 'true')
  WITH CHECK (current_setting('app.fxl_admin', true) = 'true');--> statement-breakpoint
SELECT set_config('app.fxl_admin', 'true', true);--> statement-breakpoint
INSERT INTO "sales_ops_settlements" (
  "org_id", "sale_id", "target_kind", "receivable_id", "type", "paid_on",
  "amount_brl", "origin", "actor_user_id", "actor_name"
)
SELECT r."org_id", r."sale_id", 'receivable', r."id", 'baixa',
       LEAST((r."due_date" AT TIME ZONE 'UTC')::date, (now() AT TIME ZONE 'America/Sao_Paulo')::date),
       r."amount_brl", 'manual', 'system', 'Migração'
FROM "sales_ops_receivables" r
WHERE r."status" = 'paid'
  AND r."amount_brl" > 0
  AND NOT EXISTS (
    SELECT 1 FROM "sales_ops_settlements" s
    WHERE s."org_id" = r."org_id" AND s."receivable_id" = r."id"
  );--> statement-breakpoint
INSERT INTO "sales_ops_settlements" (
  "org_id", "sale_id", "target_kind", "payable_id", "type", "paid_on",
  "amount_brl", "origin", "actor_user_id", "actor_name"
)
SELECT p."org_id", p."sale_id", 'payable', p."id", 'baixa',
       LEAST((p."due_date" AT TIME ZONE 'UTC')::date, (now() AT TIME ZONE 'America/Sao_Paulo')::date),
       p."amount_brl", 'manual', 'system', 'Migração'
FROM "sales_ops_payables" p
WHERE p."status" = 'paid'
  AND p."amount_brl" > 0
  AND NOT EXISTS (
    SELECT 1 FROM "sales_ops_settlements" s
    WHERE s."org_id" = p."org_id" AND s."payable_id" = p."id"
  );--> statement-breakpoint
DO $$
DECLARE
  divergent bigint;
BEGIN
  WITH paid_rows AS (
    SELECT r."org_id", r."id", r."amount_brl" FROM "public"."sales_ops_receivables" r
    WHERE r."status" = 'paid' AND r."amount_brl" > 0
    UNION ALL
    SELECT p."org_id", p."id", p."amount_brl" FROM "public"."sales_ops_payables" p
    WHERE p."status" = 'paid' AND p."amount_brl" > 0
  ), active AS (
    SELECT b."org_id", coalesce(b."receivable_id", b."payable_id") AS "row_id", sum(b."amount_brl") AS "paid_brl"
    FROM "public"."sales_ops_settlements" b
    WHERE b."type" = 'baixa'
      AND NOT EXISTS (
        SELECT 1 FROM "public"."sales_ops_settlements" e WHERE e."reverses_settlement_id" = b."id"
      )
    GROUP BY 1, 2
  )
  SELECT count(*) INTO divergent
  FROM paid_rows pr
  LEFT JOIN active a ON a."org_id" = pr."org_id" AND a."row_id" = pr."id"
  WHERE coalesce(a."paid_brl", 0) <> pr."amount_brl";
  IF divergent > 0 THEN
    RAISE EXCEPTION 'migration 0024 aborted: % paid ledger row(s) whose active baixas do not sum to the row amount', divergent
      USING ERRCODE = 'FXS03';
  END IF;
END
$$;
