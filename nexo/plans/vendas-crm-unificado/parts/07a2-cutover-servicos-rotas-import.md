# Part 07a2-cutover-servicos-rotas-import of slice 07a-api-crm-cutover

Not a slice: no frontmatter. Depends on part 07a1 (the helpers and `deleteCrmForOrgs`).

## What this part does

The atomic cut-over. After it, nothing in `apps/api/src` references the three old lead tables except `db/schema.ts`. Order matters only inside this part: apply every source diff, create the new files, edit the tests, delete the obsolete test, then run the commands once.

## Steps

1. TDD: create the four new test files below (`lead-write-contract.test.ts`, `frozen-lead-tables.test.ts`, `crm-cutover-frozen-tables.test.ts`, `crm-lead-write-fields.test.ts`). Run them: they fail (missing exports).
2. Write each diff below to a file under `$TMPDIR` and apply it with `git apply --whitespace=nowarn <file>`; one diff per file. The sources first (section "Source diffs"), then the test diffs. If any diff fails to apply, STOP and report the file.
3. Delete `apps/api/src/domains/sales-ops/leads/__tests__/contact-lead-contract.test.ts` with `git rm`.
4. `pnpm --filter @fxl-sales/api type-check` (three tsconfigs) must be clean.
5. Run the unit commands, then the integration commands (serial, one local Postgres).
6. Report the counts. Do not edit a test assertion beyond what the diffs do.

## What the diffs mean (so a mismatch is recognisable)

- `lead-schemas.ts`: `LeadWriteBaseSchema`, `LeadWriteSchema`, `LeadPatchSchema`, `LeadFieldWriteSchema`, the three `LEAD_*_MAX` constants; the contact edition schemas and `CreateLeadSchema`/`UpdateLeadSchema` are gone; the list and summary queries gain nothing yet (slice 07b).
- `lead-service.ts`: all queries on `salesOpsCrmLeads`/`salesOpsPipelineStages`; `readLeadView`/`toLeadView` join the etapa and read `fields`; `createLead`/`updateLead` replace the four old write functions; `moveLead`, `renumberStage` (raw SQL now on `sales_ops_crm_leads`), `firstOpenLeadStage(tx, orgId, pipelineId?)`; `LeadInputError` is re-exported from `crm/lead-input-error.ts`.
- `lead-trash-service.ts`: table swap and the pipeline-bound restore fallback.
- `stage-service.ts`, `stage-routes.ts`, `schemas.ts`, `stages-seed.ts`: the etapa cadastro on `sales_ops_pipeline_stages` with the legacy projection, `createLeadStageInPipeline`/`reorderLeadStagesInPipeline` (pipeline-aware) and the thin `createLeadStage`/`reorderLeadStages` wrappers the import and the old tests keep calling, the seed facade.
- `lead-routes.ts`: one create handler and one PATCH handler on the single schema; the helpers stay.
- Import: `catalog.ts` reads the default pipeline, `executor.ts`/`plan/leads.ts`/`types.ts` use `LeadWriteBaseSchema`.

## Commands

- Focused oracles: `pnpm --filter @fxl-sales/api exec env VITEST_INTEGRATION=1 vitest run test/rls/crm-cutover-frozen-tables.test.ts test/rls/crm-lead-write-fields.test.ts` and `pnpm --filter @fxl-sales/api exec vitest run src/domains/crm src/domains/sales-ops/leads`
- Affected unit: `pnpm --filter @fxl-sales/api exec vitest run src/domains/sales-ops src/domains/import src/domains/crm src/middleware`
- Affected integration: `pnpm --filter @fxl-sales/api exec env VITEST_INTEGRATION=1 vitest run test/rls/lead-stages-rls.test.ts test/rls/lead-stages-seed-on-read.test.ts test/rls/leads-edition.test.ts test/rls/leads-lixeira.test.ts test/rls/leads-move-concurrency.test.ts test/rls/leads-no-financial-impact.test.ts test/rls/leads-rls.test.ts test/rls/leads-seller-scope.test.ts test/rls/leads-stage-summary.test.ts test/rls/leads-unassigned-claim.test.ts src/domains/import`
- `pnpm --filter @fxl-sales/api lint`

## Source diffs

#### `apps/api/src/domains/sales-ops/leads/lead-schemas.ts` (edit, 217 changed lines)

```diff
diff --git a/apps/api/src/domains/sales-ops/leads/lead-schemas.ts b/apps/api/src/domains/sales-ops/leads/lead-schemas.ts
index 831d7d5..7045484 100644
--- a/apps/api/src/domains/sales-ops/leads/lead-schemas.ts
+++ b/apps/api/src/domains/sales-ops/leads/lead-schemas.ts
@@ -30,6 +30,11 @@ const money = z.number().int().nonnegative();
  * same reason: one screenful with room to spare, and a ceiling that bounds the
  * worst-case payload.
  */
+/** Text caps of the lead write contract; the import workbook columns are tested against them. */
+export const LEAD_CONTACT_NAME_MAX = 140;
+export const LEAD_CLIENT_NAME_MAX = 200;
+export const LEAD_DESCRIPTION_MAX = 4000;
+
 export const LEADS_DEFAULT_LIMIT = 50;
 export const LEADS_MAX_LIMIT = 200;
 
@@ -49,36 +54,121 @@ export const LeadProductSchema = z
     });
   });
 
-const LeadFieldsSchema = z.object({
-  contactName: z.string().trim().min(1).max(140),
-  clientId: uuid.nullish(),
+/**
+ * Optional text normalization shared by every nullable lead key: trimmed, and an empty string is
+ * stored as NULL ("cleared"), while an ABSENT key stays absent (PATCH semantics).
+ */
+function blankToNull(value: string | null | undefined): string | null | undefined {
+  if (value === undefined || value === null) return value;
+  return value === '' ? null : value;
+}
+
+const ContactPhoneSchema = z.string().trim().max(40).nullish().transform(blankToNull);
+
+const ContactEmailSchema = z
+  .string()
+  .trim()
+  .toLowerCase()
+  .max(254)
+  .refine((value) => value === '' || z.string().email().safeParse(value).success, {
+    message: 'contactEmail must be a valid e-mail address',
+  })
+  .nullish()
+  .transform(blankToNull);
+
+/**
+ * A civil day, never after today in Sao Paulo. Compared as a string, never through Date.
+ * Zod runs every refine even after an earlier one failed, so the future check
+ * re-guards with `isIsoDay` (an impossible day is already reported above) instead
+ * of letting `isAfterTodayInSaoPaulo` throw its RangeError.
+ */
+const ContactBirthDateSchema = z
+  .string()
+  .trim()
+  .refine((value) => value === '' || isIsoDay(value), {
+    message: 'contactBirthDate must be a real calendar day (YYYY-MM-DD)',
+  })
+  .refine((value) => value === '' || !isIsoDay(value) || !isAfterTodayInSaoPaulo(value), {
+    message: 'contactBirthDate cannot be in the future',
+  })
+  .nullish()
+  .transform(blankToNull);
+
+
+/** One entry of `fields`: a dynamic field value, addressed by its definition id or its key. */
+const FieldItemSchema = z
+  .object({
+    id: uuid.nullish(),
+    name: z.string().trim().max(200).optional(),
+  })
+  .strict();
+
+export const LeadFieldWriteSchema = z
+  .object({
+    fieldId: uuid.optional(),
+    key: z.string().trim().min(1).max(60).optional(),
+    /** text, number, money (integer cents), date (civil day), option key, or reference items; null clears. */
+    value: z.union([z.string().max(4000), z.number(), z.null(), z.array(FieldItemSchema).max(50)]),
+  })
+  .strict()
+  .refine((entry) => entry.fieldId !== undefined || entry.key !== undefined, {
+    message: 'fieldId or key is required',
+    path: ['key'],
+  });
+
+/**
+ * THE lead write contract (phase 2 cutover): one schema for both editions. `contactName` is the
+ * only required key; everything else is optional. The old keys `description`, `contactBirthDate`
+ * and `products` are still accepted and stored as the `descricao`, `nascimento` and `produtos`
+ * field values, so the web of today keeps working. `.strict()` stays: an unknown key is a loud 400.
+ *
+ * `LeadWriteBaseSchema` is the shape; `LeadWriteSchema` (create) adds the contact rule - at least
+ * one of `contactPhone` or `contactEmail` - and `LeadPatchSchema` (PATCH) is the same shape with
+ * every key optional and no `pipelineId` / `stageId` (a lead changes stage only through the move
+ * and advance routes, so `stage_changed_at` has exactly one writer).
+ * The spreadsheet import writes through the BASE schema: a workbook row has no contact column.
+ */
+const leadWriteShape = {
+  contactName: z.string().trim().min(1).max(LEAD_CONTACT_NAME_MAX),
+  contactPhone: ContactPhoneSchema,
+  contactEmail: ContactEmailSchema,
+  /** Create only. Absent means the org's default pipeline. */
+  pipelineId: uuid.optional(),
+  /** Create only. Absent means the first active normal stage of the pipeline. */
+  stageId: uuid.optional(),
   /**
-   * The empresa as free text. Maps to the NOT NULL `client_name_snapshot`, and
-   * is the fallback when `clientId` is absent. When `clientId` DOES resolve, the
-   * snapshot is overwritten from the cadastro row and this value loses - the
-   * same server-authoritative rule `resolvePartyContexts` applies to
-   * `personNameSnapshot`.
+   * NULLABLE: a lead may sit unassigned. An unassigned lead is visible to admins and to every
+   * active vendedor, and the first vendedor to write it claims it (see `claimantFor`).
    */
-  clientName: z.string().trim().min(1).max(200),
+  sellerPersonId: z.preprocess((value) => (value === '' ? null : value), uuid.nullish()),
+  /** The empresa. `clientId` resolves the snapshot; otherwise `clientName` is the free text. */
+  clientId: z.preprocess((value) => (value === '' ? null : value), uuid.nullish()),
+  clientName: z.string().trim().max(LEAD_CLIENT_NAME_MAX).nullish().transform(blankToNull),
+  /** Integer CENTS. */
   estimatedValueBrl: money.default(0),
-  description: z.string().max(4000).nullish(),
-  /**
-   * NULLABLE: a lead may sit unassigned. An unassigned lead is visible to admins
-   * and to every active vendedor, and the first vendedor to write it claims it
-   * (leads-sem-vendedor, see `claimantFor` in lead-service.ts).
-   */
-  sellerPersonId: uuid.nullish(),
-  products: z.array(LeadProductSchema).max(50).default([]),
+  fields: z.array(LeadFieldWriteSchema).max(50).optional(),
+  // Legacy keys, mapped onto the descricao / nascimento / produtos field values.
+  description: z.string().trim().max(LEAD_DESCRIPTION_MAX).nullish().transform(blankToNull),
+  contactBirthDate: ContactBirthDateSchema,
+  products: z.array(LeadProductSchema).max(50).optional(),
+};
+
+export const LeadWriteBaseSchema = z.object(leadWriteShape).strict();
+
+export const LeadWriteSchema = LeadWriteBaseSchema.superRefine((lead, ctx) => {
+  if (lead.contactPhone || lead.contactEmail) return;
+  ctx.addIssue({
+    code: z.ZodIssueCode.custom,
+    path: ['contactPhone'],
+    message: 'contactPhone or contactEmail is required',
+  });
 });
 
-/**
- * No `stageId` and no `saleId`, deliberately: a new lead always lands in the
- * first active `kind = 'normal'` stage by position. A card that is converted or
- * lost the instant it is born is therefore not expressible, rather than merely
- * rejected.
- */
-export const CreateLeadSchema = LeadFieldsSchema.strict();
-export const UpdateLeadSchema = LeadFieldsSchema.partial().strict();
+export const LeadPatchSchema = z
+  .object(leadWriteShape)
+  .omit({ pipelineId: true, stageId: true })
+  .partial()
+  .strict();
 
 /**
  * The move wire body, and the field NAMES are the contract: slice 04's client
@@ -125,8 +215,8 @@ export const ListLeadsQuerySchema = z.object({
  */
 export const LeadStageSummaryQuerySchema = ListLeadsQuerySchema.pick({ sellerPersonId: true });
 
-export type CreateLeadInput = z.infer<typeof CreateLeadSchema>;
-export type UpdateLeadInput = z.infer<typeof UpdateLeadSchema>;
+export type LeadWriteInput = z.infer<typeof LeadWriteBaseSchema>;
+export type LeadPatchInput = z.infer<typeof LeadPatchSchema>;
 export type MoveLeadInput = z.infer<typeof MoveLeadSchema>;
 export type ListLeadsQuery = z.infer<typeof ListLeadsQuerySchema>;
 export type LeadStageSummaryQuery = z.infer<typeof LeadStageSummaryQuerySchema>;
@@ -158,76 +248,3 @@ export const ListDeletedLeadsQuerySchema = z.object({
 export type ListDeletedLeadsQuery = z.infer<typeof ListDeletedLeadsQuerySchema>;
 export type LeadProductInput = z.infer<typeof LeadProductSchema>;
 
-/**
- * The LEADS EDITION wire contract (edicao-leads, SEAM-CONTRACT section 2).
- *
- * A separate schema rather than a widened LeadFieldsSchema, on purpose: the full
- * schemas above stay byte-identical and `.strict()`, so an FXL client can never
- * send a contact key, and a leads-edition client can never send produtos. The
- * leads edition DOES carry an empresa (`clientId`/`clientName`) and a valor
- * estimado (`estimatedValueBrl`). The route picks one by `leadFieldSet(salesEdition)`.
- *
- * Every optional text normalizes the same way: trimmed, and an empty string is
- * stored as NULL ("cleared"), while an ABSENT key stays absent (PATCH semantics).
- */
-function blankToNull(value: string | null | undefined): string | null | undefined {
-  if (value === undefined || value === null) return value;
-  return value === '' ? null : value;
-}
-
-const ContactPhoneSchema = z.string().trim().max(40).nullish().transform(blankToNull);
-
-const ContactEmailSchema = z
-  .string()
-  .trim()
-  .toLowerCase()
-  .max(254)
-  .refine((value) => value === '' || z.string().email().safeParse(value).success, {
-    message: 'contactEmail must be a valid e-mail address',
-  })
-  .nullish()
-  .transform(blankToNull);
-
-/**
- * A civil day, never after today in Sao Paulo. Compared as a string, never through Date.
- * Zod runs every refine even after an earlier one failed, so the future check
- * re-guards with `isIsoDay` (an impossible day is already reported above) instead
- * of letting `isAfterTodayInSaoPaulo` throw its RangeError.
- */
-const ContactBirthDateSchema = z
-  .string()
-  .trim()
-  .refine((value) => value === '' || isIsoDay(value), {
-    message: 'contactBirthDate must be a real calendar day (YYYY-MM-DD)',
-  })
-  .refine((value) => value === '' || !isIsoDay(value) || !isAfterTodayInSaoPaulo(value), {
-    message: 'contactBirthDate cannot be in the future',
-  })
-  .nullish()
-  .transform(blankToNull);
-
-export const ContactLeadFieldsSchema = z
-  .object({
-    contactName: z.string().trim().min(1).max(140),
-    contactPhone: ContactPhoneSchema,
-    contactEmail: ContactEmailSchema,
-    contactBirthDate: ContactBirthDateSchema,
-    // A2: null clears, '' is read as null, absent stays absent (PATCH semantics).
-    description: z.string().trim().max(4000).nullish().transform(blankToNull),
-    sellerPersonId: z.preprocess((value) => (value === '' ? null : value), uuid.nullish()),
-    // The leads edition (Construbom) DOES carry an empresa and a valor estimado:
-    // `clientId` optionally links a sales_ops_clients row (the vendedor may create
-    // one by name), `clientName` is the free-text snapshot used when no link
-    // resolves, and `estimatedValueBrl` is integer cents feeding the funil's
-    // financial view. Produtos remain full-edition only.
-    clientId: z.preprocess((value) => (value === '' ? null : value), uuid.nullish()),
-    clientName: z.string().trim().max(200).nullish().transform(blankToNull),
-    estimatedValueBrl: money.default(0),
-  })
-  .strict();
-
-export const CreateContactLeadSchema = ContactLeadFieldsSchema;
-export const UpdateContactLeadSchema = ContactLeadFieldsSchema.partial().strict();
-
-export type CreateContactLeadInput = z.infer<typeof CreateContactLeadSchema>;
-export type UpdateContactLeadInput = z.infer<typeof UpdateContactLeadSchema>;
```

#### `apps/api/src/domains/sales-ops/leads/lead-service.ts` (edit, 584 changed lines)

```diff
diff --git a/apps/api/src/domains/sales-ops/leads/lead-service.ts b/apps/api/src/domains/sales-ops/leads/lead-service.ts
index 6aed8e5..1de638b 100644
--- a/apps/api/src/domains/sales-ops/leads/lead-service.ts
+++ b/apps/api/src/domains/sales-ops/leads/lead-service.ts
@@ -2,29 +2,37 @@ import type { SalesEdition } from '@fxl-sales/shared-utils/sales-edition';
 import { and, asc, eq, isNull, or, sql, type SQL } from 'drizzle-orm';
 import type { getDb } from '../../../db/client.js';
 import {
+  salesOpsCrmLeadEvents,
+  salesOpsCrmLeads,
   salesOpsFuncoes,
-  salesOpsLeadProducts,
-  salesOpsLeadStages,
-  salesOpsLeads,
   salesOpsPeople,
   salesOpsPersonFuncoes,
-  salesOpsProducts,
+  salesOpsPipelineStages,
   salesOpsSales,
 } from '../../../db/schema.js';
+import {
+  applyFieldWrites,
+  projectLegacyFields,
+  readLeadFields,
+  resolveFieldWrites,
+  resolveLegacyFieldWrites,
+  type LeadFieldValue,
+} from '../../crm/lead-fields.js';
+import { LeadInputError } from '../../crm/lead-input-error.js';
+import { defaultPipelineId, pipelineExists } from '../../crm/pipeline-read.js';
 import type {
-  CreateContactLeadInput,
-  CreateLeadInput,
-  LeadProductInput,
+  LeadPatchInput,
   LeadStageSummaryQuery,
+  LeadWriteInput,
   ListLeadsQuery,
   MoveLeadInput,
-  UpdateContactLeadInput,
-  UpdateLeadInput,
 } from './lead-schemas.js';
 import { LEADS_DEFAULT_LIMIT } from './lead-schemas.js';
 import { PersonSchema, createPersonTx } from '../service.js';
 import { withTenant } from './with-tenant.js';
 
+export { LeadInputError };
+
 /**
  * The lead entity's server half.
  *
@@ -67,32 +75,6 @@ export type LeadScope = {
   edition?: SalesEdition;
 };
 
-/**
- * Shape and the `itemIndex: -1` convention are copied verbatim from
- * `SaleInputError`, so `lead-routes.ts` maps it onto the byte-identical 400 body
- * `routes.ts` already returns for a sale input error.
- */
-export class LeadInputError extends Error {
-  constructor(
-    readonly code:
-      | 'seller_not_found'
-      | 'seller_not_a_vendedor'
-      | 'client_not_found'
-      | 'product_not_found'
-      | 'stage_not_found'
-      | 'lost_reason_required'
-      | 'sale_required_for_conversion'
-      | 'sale_not_found'
-      | 'sale_not_allowed'
-      | 'no_open_stage',
-    /** The offending `products[]` index, or -1 when the error names no array row. */
-    readonly itemIndex: number = -1,
-  ) {
-    super(code);
-    this.name = 'LeadInputError';
-  }
-}
-
 export type LeadView = {
   id: string;
   stageId: string;
@@ -117,6 +99,12 @@ export type LeadView = {
   products: Array<{ productId: string | null; productNameSnapshot: string }>;
   createdAt: string;
   updatedAt: string | null;
+  // Phase 2 additive fields (unified CRM). `description`, `contactBirthDate` and `products` above
+  // are PROJECTED from the descricao, nascimento and produtos field values.
+  pipelineId: string;
+  stageType: string;
+  stageExitKind: string | null;
+  fields: LeadFieldValue[];
 };
 
 // ─────────────────────────────────────────────────────────────────────────────
@@ -457,55 +445,6 @@ async function resolveClientName(tx: Db, orgId: string, clientId: string): Promi
   return name;
 }
 
-type ResolvedLeadProduct = { productId: string | null; productNameSnapshot: string };
-
-/**
- * A body-supplied `productName` on a row that RESOLVES is discarded: the
- * snapshot is server-authoritative. A row with no `productId` stores NULL plus
- * the body's text, mirroring a free-form sale item.
- *
- * An archived produto resolves fine here. A lead may legitimately reference one,
- * and hiding an archived row belongs to the picker, never to the writer.
- */
-async function resolveLeadProducts(
-  tx: Db,
-  orgId: string,
-  rows: LeadProductInput[],
-): Promise<ResolvedLeadProduct[]> {
-  const resolved: ResolvedLeadProduct[] = [];
-  for (const [index, row] of rows.entries()) {
-    if (!row.productId) {
-      resolved.push({ productId: null, productNameSnapshot: row.productName! });
-      continue;
-    }
-    const [product] = await tx
-      .select({ id: salesOpsProducts.id, name: salesOpsProducts.name })
-      .from(salesOpsProducts)
-      .where(and(eq(salesOpsProducts.orgId, orgId), eq(salesOpsProducts.id, row.productId)))
-      .limit(1);
-    if (!product) throw new LeadInputError('product_not_found', index);
-    resolved.push({ productId: product.id, productNameSnapshot: product.name });
-  }
-  return resolved;
-}
-
-/** Full-set replacement, exactly the `replacePersonFuncoes` shape. */
-async function replaceLeadProducts(
-  tx: Db,
-  orgId: string,
-  leadId: string,
-  rows: LeadProductInput[],
-): Promise<void> {
-  const resolved = await resolveLeadProducts(tx, orgId, rows);
-  await tx
-    .delete(salesOpsLeadProducts)
-    .where(and(eq(salesOpsLeadProducts.orgId, orgId), eq(salesOpsLeadProducts.leadId, leadId)));
-  if (resolved.length === 0) return;
-  await tx
-    .insert(salesOpsLeadProducts)
-    .values(resolved.map((row) => ({ orgId, leadId, ...row })));
-}
-
 // ─────────────────────────────────────────────────────────────────────────────
 // Reads
 // ─────────────────────────────────────────────────────────────────────────────
@@ -520,10 +459,10 @@ async function replaceLeadProducts(
  * hand-written deleted_at predicate anywhere else is a second rule that drifts.
  */
 export function liveLeadCondition(): SQL {
-  return isNull(salesOpsLeads.deletedAt);
+  return isNull(salesOpsCrmLeads.deletedAt);
 }
 
-type LeadRow = typeof salesOpsLeads.$inferSelect;
+type LeadRow = typeof salesOpsCrmLeads.$inferSelect;
 
 function toIso(value: Date | string | null): string | null {
   if (value === null) return null;
@@ -546,65 +485,38 @@ function toIso(value: Date | string | null): string | null {
  */
 export async function readLeadView(tx: Db, orgId: string, leadId: string): Promise<LeadView> {
   const [row] = await tx
-    .select({ lead: salesOpsLeads, saleStatus: salesOpsSales.status, saleCode: salesOpsSales.code })
-    .from(salesOpsLeads)
+    .select({ lead: salesOpsCrmLeads, stage: salesOpsPipelineStages, saleStatus: salesOpsSales.status, saleCode: salesOpsSales.code })
+    .from(salesOpsCrmLeads)
+    .innerJoin(salesOpsPipelineStages, stageJoin())
     .leftJoin(
       salesOpsSales,
-      and(eq(salesOpsSales.orgId, salesOpsLeads.orgId), eq(salesOpsSales.id, salesOpsLeads.saleId)),
+      and(eq(salesOpsSales.orgId, salesOpsCrmLeads.orgId), eq(salesOpsSales.id, salesOpsCrmLeads.saleId)),
     )
-    .where(and(eq(salesOpsLeads.orgId, orgId), eq(salesOpsLeads.id, leadId), liveLeadCondition()))
+    .where(and(eq(salesOpsCrmLeads.orgId, orgId), eq(salesOpsCrmLeads.id, leadId), liveLeadCondition()))
     .limit(1);
   if (!row) throw new Error(`lead ${leadId} disappeared inside its own transaction`);
-  return toLeadView(
-    row.lead,
-    row.saleStatus,
-    row.saleCode,
-    await readLeadProducts(tx, orgId, [leadId]),
-  );
+  const fields = await readLeadFields(tx, orgId, [row.lead]);
+  return toLeadView(row.lead, row.stage, row.saleStatus, row.saleCode, fields.get(leadId) ?? []);
 }
 
-async function readLeadProducts(
-  tx: Db,
-  orgId: string,
-  leadIds: string[],
-): Promise<Map<string, ResolvedLeadProduct[]>> {
-  const byLead = new Map<string, ResolvedLeadProduct[]>();
-  if (leadIds.length === 0) return byLead;
-  const rows = await tx
-    .select({
-      leadId: salesOpsLeadProducts.leadId,
-      productId: salesOpsLeadProducts.productId,
-      productNameSnapshot: salesOpsLeadProducts.productNameSnapshot,
-    })
-    .from(salesOpsLeadProducts)
-    .where(
-      and(
-        eq(salesOpsLeadProducts.orgId, orgId),
-        sql`${salesOpsLeadProducts.leadId} in ${leadIds}`,
-      ),
-    )
-    // Ordered by the SNAPSHOT and not by created_at: a full-set replacement
-    // writes every row in one INSERT, so all of them share one `now()` and the
-    // tiebreaker would be a random uuid - a list whose order changed between two
-    // reads of an unchanged lead. The child table carries no position column
-    // (slice 01 owns the schema and gave it none, exactly as person_funcoes has
-    // none), so this is a SET with a deterministic display order rather than a
-    // list whose order the operator authored.
-    .orderBy(asc(salesOpsLeadProducts.productNameSnapshot), asc(salesOpsLeadProducts.id));
-  for (const row of rows) {
-    const bucket = byLead.get(row.leadId) ?? [];
-    bucket.push({ productId: row.productId, productNameSnapshot: row.productNameSnapshot });
-    byLead.set(row.leadId, bucket);
-  }
-  return byLead;
+/** The lead's stage row: the composite FK guarantees it exists in the same org and pipeline. */
+function stageJoin(): SQL {
+  return and(
+    eq(salesOpsPipelineStages.orgId, salesOpsCrmLeads.orgId),
+    eq(salesOpsPipelineStages.id, salesOpsCrmLeads.stageId),
+  )!;
 }
 
+type StageRow = typeof salesOpsPipelineStages.$inferSelect;
+
 function toLeadView(
   lead: LeadRow,
+  stage: StageRow,
   saleStatus: string | null,
   saleCode: string | null,
-  products: Map<string, ResolvedLeadProduct[]>,
+  fields: LeadFieldValue[],
 ): LeadView {
+  const legacy = projectLegacyFields(fields);
   return {
     id: lead.id,
     stageId: lead.stageId,
@@ -614,10 +526,10 @@ function toLeadView(
     clientId: lead.clientId,
     clientNameSnapshot: lead.clientNameSnapshot,
     estimatedValueBrl: lead.estimatedValueBrl,
-    description: lead.description,
+    description: legacy.description,
     contactPhone: lead.contactPhone,
     contactEmail: lead.contactEmail,
-    contactBirthDate: lead.contactBirthDate,
+    contactBirthDate: legacy.contactBirthDate,
     sellerPersonId: lead.sellerPersonId,
     sellerNameSnapshot: lead.sellerNameSnapshot,
     saleId: lead.saleId,
@@ -627,9 +539,13 @@ function toLeadView(
     // nothing. The board renders this as the card's only proposta identity.
     saleCode: lead.saleId ? saleCode : null,
     lostReason: lead.lostReason,
-    products: products.get(lead.id) ?? [],
+    products: legacy.products,
     createdAt: toIso(lead.createdAt)!,
     updatedAt: toIso(lead.updatedAt),
+    pipelineId: lead.pipelineId,
+    stageType: stage.type,
+    stageExitKind: stage.exitKind,
+    fields,
   };
 }
 
@@ -660,46 +576,49 @@ export async function listLeads(
     // The count below and the page share this one `conditions` array, so `total`
     // counts exactly the rows a page can return.
     const conditions = leadBoardConditions(orgId, gate, query.sellerPersonId);
-    conditions.push(eq(salesOpsLeads.stageId, query.stageId));
+    conditions.push(eq(salesOpsCrmLeads.stageId, query.stageId));
 
     const [{ total }] = (await tx
       .select({ total: sql<number>`count(*)::int` })
-      .from(salesOpsLeads)
+      .from(salesOpsCrmLeads)
       .where(and(...conditions))) as [{ total: number }];
 
     if (query.cursor) {
       const [position, id] = query.cursor.split(':');
       conditions.push(
-        sql`(${salesOpsLeads.position}, ${salesOpsLeads.id}) > (${Number(position)}, ${id}::uuid)`,
+        sql`(${salesOpsCrmLeads.position}, ${salesOpsCrmLeads.id}) > (${Number(position)}, ${id}::uuid)`,
       );
     }
 
     const limit = query.limit ?? LEADS_DEFAULT_LIMIT;
     const rows = await tx
-      .select({ lead: salesOpsLeads, saleStatus: salesOpsSales.status, saleCode: salesOpsSales.code })
-      .from(salesOpsLeads)
+      .select({ lead: salesOpsCrmLeads, stage: salesOpsPipelineStages, saleStatus: salesOpsSales.status, saleCode: salesOpsSales.code })
+      .from(salesOpsCrmLeads)
+      .innerJoin(salesOpsPipelineStages, stageJoin())
       .leftJoin(
         salesOpsSales,
         and(
-          eq(salesOpsSales.orgId, salesOpsLeads.orgId),
-          eq(salesOpsSales.id, salesOpsLeads.saleId),
+          eq(salesOpsSales.orgId, salesOpsCrmLeads.orgId),
+          eq(salesOpsSales.id, salesOpsCrmLeads.saleId),
         ),
       )
       .where(and(...conditions))
-      .orderBy(asc(salesOpsLeads.position), asc(salesOpsLeads.id))
+      .orderBy(asc(salesOpsCrmLeads.position), asc(salesOpsCrmLeads.id))
       .limit(limit + 1);
 
     const hasMore = rows.length > limit;
     const page = hasMore ? rows.slice(0, limit) : rows;
-    const products = await readLeadProducts(
+    const fields = await readLeadFields(
       tx,
       orgId,
-      page.map((row) => row.lead.id),
+      page.map((row) => row.lead),
     );
     const last = page.at(-1);
     return {
       ok: true,
-      leads: page.map((row) => toLeadView(row.lead, row.saleStatus, row.saleCode, products)),
+      leads: page.map((row) =>
+        toLeadView(row.lead, row.stage, row.saleStatus, row.saleCode, fields.get(row.lead.id) ?? []),
+      ),
       nextCursor: hasMore && last ? `${last.lead.position}:${last.lead.id}` : null,
       total,
     } as const;
@@ -741,14 +660,14 @@ export async function summarizeLeadStages(
 
     const rows = await tx
       .select({
-        stageId: salesOpsLeads.stageId,
+        stageId: salesOpsCrmLeads.stageId,
         count: sql<number>`count(*)::int`,
-        estimatedValueBrl: sql<string>`sum(${salesOpsLeads.estimatedValueBrl})::bigint`.mapWith(Number),
+        estimatedValueBrl: sql<string>`sum(${salesOpsCrmLeads.estimatedValueBrl})::bigint`.mapWith(Number),
       })
-      .from(salesOpsLeads)
+      .from(salesOpsCrmLeads)
       .where(and(...leadBoardConditions(orgId, gate, query.sellerPersonId)))
-      .groupBy(salesOpsLeads.stageId)
-      .orderBy(asc(salesOpsLeads.stageId));
+      .groupBy(salesOpsCrmLeads.stageId)
+      .orderBy(asc(salesOpsCrmLeads.stageId));
 
     return {
       ok: true,
@@ -780,8 +699,8 @@ export async function getLead(
     const gate = await resolveLeadScopePredicate(tx, orgId, scope);
     if (!gate.ok) return { ok: false, reason: gate.reason } as const;
     const [row] = await tx
-      .select({ id: salesOpsLeads.id })
-      .from(salesOpsLeads)
+      .select({ id: salesOpsCrmLeads.id })
+      .from(salesOpsCrmLeads)
       .where(and(...leadIdentityConditions(orgId, id, gate)))
       .limit(1);
     if (!row) return { ok: false, reason: 'not_found' } as const;
@@ -800,13 +719,13 @@ export async function getLead(
  * else keeps exactly their own leads.
  */
 function leadSellerCondition(sellerPersonId: string, canClaimUnassigned: boolean): SQL {
-  const own = eq(salesOpsLeads.sellerPersonId, sellerPersonId);
+  const own = eq(salesOpsCrmLeads.sellerPersonId, sellerPersonId);
   if (!canClaimUnassigned) return own;
-  return or(own, isNull(salesOpsLeads.sellerPersonId))!;
+  return or(own, isNull(salesOpsCrmLeads.sellerPersonId))!;
 }
 
 /**
- * `eq(salesOpsLeads.orgId, orgId)` is ALWAYS the first element, and the seller
+ * `eq(salesOpsCrmLeads.orgId, orgId)` is ALWAYS the first element, and the seller
  * predicate is appended only for a non-admin. The admin case is the same
  * expression minus one conjunct. It always carries `liveLeadCondition()`, so a
  * deleted lead is `not_found` to every identity read (get, PATCH, move, delete)
@@ -814,8 +733,8 @@ function leadSellerCondition(sellerPersonId: string, canClaimUnassigned: boolean
  */
 export function leadIdentityConditions(orgId: string, id: string, gate: LeadScopeAllowed): SQL[] {
   const conditions: SQL[] = [
-    eq(salesOpsLeads.orgId, orgId),
-    eq(salesOpsLeads.id, id),
+    eq(salesOpsCrmLeads.orgId, orgId),
+    eq(salesOpsCrmLeads.id, id),
     liveLeadCondition(),
   ];
   if (gate.sellerPersonId) {
@@ -841,11 +760,11 @@ function leadBoardConditions(
   gate: LeadScopeAllowed,
   requestedSellerPersonId: string | undefined,
 ): SQL[] {
-  const conditions: SQL[] = [eq(salesOpsLeads.orgId, orgId), liveLeadCondition()];
+  const conditions: SQL[] = [eq(salesOpsCrmLeads.orgId, orgId), liveLeadCondition()];
   if (gate.sellerPersonId) {
     conditions.push(leadSellerCondition(gate.sellerPersonId, gate.canClaimUnassigned));
   } else if (requestedSellerPersonId) {
-    conditions.push(eq(salesOpsLeads.sellerPersonId, requestedSellerPersonId));
+    conditions.push(eq(salesOpsCrmLeads.sellerPersonId, requestedSellerPersonId));
   }
   return conditions;
 }
@@ -888,90 +807,28 @@ export type WriteLeadResult =
       reason: 'not_found' | 'seller_scope' | 'seller_person_unmapped' | 'already_converted';
     };
 
-/**
- * The one normalized record both create paths insert. Internal: the full and the
- * leads-edition wire shapes are mapped onto it by the two exported wrappers
- * below, so the scope, seller and stage rules exist exactly once.
- */
-type LeadCreateRecord = {
-  contactName: string;
-  clientId: string | null;
-  clientName: string;
-  estimatedValueBrl: number;
-  description: string | null;
-  sellerPersonId: string | null;
-  products: LeadProductInput[];
-  contactPhone: string | null;
-  contactEmail: string | null;
-  contactBirthDate: string | null;
-};
-
-export function createLead(
-  db: Db,
-  orgId: string,
-  input: CreateLeadInput,
-  scope: LeadScope,
-): Promise<WriteLeadResult> {
-  return insertLead(
-    db,
-    orgId,
-    {
-      contactName: input.contactName,
-      clientId: input.clientId ?? null,
-      clientName: input.clientName,
-      estimatedValueBrl: input.estimatedValueBrl,
-      description: input.description ?? null,
-      sellerPersonId: input.sellerPersonId ?? null,
-      products: input.products,
-      contactPhone: null,
-      contactEmail: null,
-      contactBirthDate: null,
-    },
-    scope,
-  );
+/** The snapshot name of the actor of a write: the verified token name, else the e-mail, else null. */
+export function scopeActorName(scope: LeadScope): string | null {
+  const name = scope.name?.trim();
+  if (name) return name;
+  const email = scope.email?.trim();
+  return email ? email : null;
 }
 
 /**
- * The leads-edition create. It carries an optional empresa (`clientId` resolves
- * the snapshot, otherwise the free-text `clientName`) and a valor estimado, but
- * never produtos: that child table stays full-edition only, so `products` is
- * always empty here.
+ * The single create path (the full and the contact wire shapes collapsed into `LeadWriteSchema`).
+ * In BOTH editions a non-admin seller who names no vendedor files the lead as their own; an
+ * explicit OTHER id is still `403 seller_scope`.
  */
-export function createContactLead(
+export function createLead(
   db: Db,
   orgId: string,
-  input: CreateContactLeadInput,
+  input: LeadWriteInput,
   scope: LeadScope,
 ): Promise<WriteLeadResult> {
-  return insertLead(
-    db,
-    orgId,
-    {
-      contactName: input.contactName,
-      clientId: input.clientId ?? null,
-      clientName: input.clientName ?? '',
-      estimatedValueBrl: input.estimatedValueBrl ?? 0,
-      description: input.description ?? null,
-      sellerPersonId: input.sellerPersonId ?? null,
-      products: [],
-      contactPhone: input.contactPhone ?? null,
-      contactEmail: input.contactEmail ?? null,
-      contactBirthDate: input.contactBirthDate ?? null,
-    },
-    scope,
-    { defaultSellerToCaller: true },
-  );
+  return insertLead(db, orgId, input, scope);
 }
 
-type InsertLeadOptions = {
-  /**
-   * Leads edition only (D-07.1a): a scoped seller who names no vendedor files
-   * the lead as their own instead of being refused. The full edition never
-   * passes it, so its `seller_scope` rule stays byte-for-byte.
-   */
-  defaultSellerToCaller?: boolean;
-};
-
 /**
  * The org's lead board lock: the ONE place the lock order of a board write is
  * decided.
@@ -1003,7 +860,7 @@ type InsertLeadOptions = {
  * these services on its own transaction) it passes to the parent when the
  * savepoint is released, so an import holds the board until it commits. The two
  * int4 keys are a namespace and the org; an org hash collision only makes two
- * boards share one queue.
+ * boards share one queue. The key is the one the pre-cutover board used, unchanged.
  */
 export async function lockLeadBoard(tx: Db, orgId: string): Promise<void> {
   await tx.execute(
@@ -1012,27 +869,35 @@ export async function lockLeadBoard(tx: Db, orgId: string): Promise<void> {
 }
 
 /**
- * The first ACTIVE normal stage by board order: where a new lead lands, and
+ * The first ACTIVE normal stage of a pipeline by board order: where a new lead lands, and
  * where a restored lead lands when its own etapa was archived. One spelling of
  * the rule for both. `name` is the tiebreaker, matching the stage list's own
- * (position, name) read order. Null when the org has no open etapa (the leads
- * edition starts with none).
+ * (position, name) read order. Without `pipelineId` it is the org's default pipeline. Null when
+ * the pipeline has no open etapa.
  */
 export async function firstOpenLeadStage(
   tx: Db,
   orgId: string,
-): Promise<{ id: string; name: string } | null> {
+  pipelineId?: string,
+): Promise<{ id: string; name: string; pipelineId: string } | null> {
+  const resolved = pipelineId ?? (await defaultPipelineId(tx, orgId));
+  if (resolved === null) return null;
   const [stage] = await tx
-    .select({ id: salesOpsLeadStages.id, name: salesOpsLeadStages.name })
-    .from(salesOpsLeadStages)
+    .select({
+      id: salesOpsPipelineStages.id,
+      name: salesOpsPipelineStages.name,
+      pipelineId: salesOpsPipelineStages.pipelineId,
+    })
+    .from(salesOpsPipelineStages)
     .where(
       and(
-        eq(salesOpsLeadStages.orgId, orgId),
-        eq(salesOpsLeadStages.status, 'active'),
-        eq(salesOpsLeadStages.kind, 'normal'),
+        eq(salesOpsPipelineStages.orgId, orgId),
+        eq(salesOpsPipelineStages.pipelineId, resolved),
+        eq(salesOpsPipelineStages.status, 'active'),
+        eq(salesOpsPipelineStages.type, 'normal'),
       ),
     )
-    .orderBy(asc(salesOpsLeadStages.position), asc(salesOpsLeadStages.name))
+    .orderBy(asc(salesOpsPipelineStages.position), asc(salesOpsPipelineStages.name))
     .limit(1);
   return stage ?? null;
 }
@@ -1045,20 +910,59 @@ export async function firstOpenLeadStage(
  */
 export async function nextLeadPosition(tx: Db, orgId: string, stageId: string): Promise<number> {
   const [{ next }] = (await tx
-    .select({ next: sql<number>`COALESCE(MAX(${salesOpsLeads.position}), 0) + 1` })
-    .from(salesOpsLeads)
+    .select({ next: sql<number>`COALESCE(MAX(${salesOpsCrmLeads.position}), 0) + 1` })
+    .from(salesOpsCrmLeads)
     .where(
-      and(eq(salesOpsLeads.orgId, orgId), eq(salesOpsLeads.stageId, stageId), liveLeadCondition()),
+      and(eq(salesOpsCrmLeads.orgId, orgId), eq(salesOpsCrmLeads.stageId, stageId), liveLeadCondition()),
     )) as [{ next: number }];
   return next;
 }
 
+/** Resolves where a new lead lands: an explicit open stage of the pipeline, else the pipeline's first open one. */
+async function resolveCreateStage(
+  tx: Db,
+  orgId: string,
+  input: Pick<LeadWriteInput, 'pipelineId' | 'stageId'>,
+): Promise<{ id: string; pipelineId: string }> {
+  let pipelineId: string | null;
+  if (input.pipelineId !== undefined) {
+    if (!(await pipelineExists(tx, orgId, input.pipelineId))) throw new LeadInputError('pipeline_not_found');
+    pipelineId = input.pipelineId;
+  } else {
+    pipelineId = await defaultPipelineId(tx, orgId);
+  }
+  // The edition-independent "no etapa yet" answer: an org with no pipeline, or a pipeline with no
+  // open etapa, cannot take a new lead.
+  if (pipelineId === null) throw new LeadInputError('no_open_stage');
+
+  if (input.stageId !== undefined) {
+    const [stage] = await tx
+      .select({ id: salesOpsPipelineStages.id, type: salesOpsPipelineStages.type })
+      .from(salesOpsPipelineStages)
+      .where(
+        and(
+          eq(salesOpsPipelineStages.orgId, orgId),
+          eq(salesOpsPipelineStages.pipelineId, pipelineId),
+          eq(salesOpsPipelineStages.id, input.stageId),
+          eq(salesOpsPipelineStages.status, 'active'),
+        ),
+      )
+      .limit(1);
+    if (!stage) throw new LeadInputError('stage_not_found');
+    // A card that is converted, won or lost the instant it is born is not expressible.
+    if (stage.type !== 'normal') throw new LeadInputError('stage_not_open');
+    return { id: stage.id, pipelineId };
+  }
+  const first = await firstOpenLeadStage(tx, orgId, pipelineId);
+  if (!first) throw new LeadInputError('no_open_stage');
+  return { id: first.id, pipelineId };
+}
+
 async function insertLead(
   db: Db,
   orgId: string,
-  record: LeadCreateRecord,
+  input: LeadWriteInput,
   scope: LeadScope,
-  options: InsertLeadOptions = {},
 ): Promise<WriteLeadResult> {
   return withTenant(db, orgId, async (tx) => {
     const gate = await resolveLeadScopePredicate(tx, orgId, scope);
@@ -1070,45 +974,42 @@ async function insertLead(
     // A seller may only file their OWN leads, and may not file an unassigned one
     // either - `null !== gate.sellerPersonId` catches that. A loud 403 rather
     // than a 404, because they named the id themselves, so it leaks nothing.
-    // The leads edition defaults an unnamed vendedor to the caller first, so
-    // only an explicit OTHER id is refused there.
-    const requestedSeller =
-      options.defaultSellerToCaller && gate.sellerPersonId && record.sellerPersonId === null
-        ? gate.sellerPersonId
-        : record.sellerPersonId;
+    // An unnamed vendedor defaults to the caller (both editions), so only an
+    // explicit OTHER id is refused.
+    const named = input.sellerPersonId ?? null;
+    const requestedSeller = gate.sellerPersonId && named === null ? gate.sellerPersonId : named;
     if (gate.sellerPersonId && requestedSeller !== gate.sellerPersonId) {
       return { ok: false, reason: 'seller_scope' } as const;
     }
 
     const seller = requestedSeller ? await resolveSellerPersonId(tx, orgId, requestedSeller) : null;
-    const clientName = record.clientId
-      ? await resolveClientName(tx, orgId, record.clientId)
-      : record.clientName;
 
-    // A new lead always lands in the first ACTIVE normal stage by board order.
-    const stage = await firstOpenLeadStage(tx, orgId);
-    // The edition-independent "no etapa yet" answer; the leads edition starts with zero etapas (edicao-leads AC4).
-    if (!stage) throw new LeadInputError('no_open_stage');
+    const dynamic = await resolveFieldWrites(tx, orgId, input.fields ?? []);
+    const legacy = await resolveLegacyFieldWrites(tx, orgId, input);
+    const clientId = pickClientId(input.clientId, dynamic.cliente);
+    const clientName = clientId
+      ? await resolveClientName(tx, orgId, clientId)
+      : (input.clientName ?? '');
 
+    const stage = await resolveCreateStage(tx, orgId, input);
     const next = await nextLeadPosition(tx, orgId, stage.id);
 
     const [lead] = await tx
-      .insert(salesOpsLeads)
+      .insert(salesOpsCrmLeads)
       .values({
         orgId,
+        pipelineId: stage.pipelineId,
         stageId: stage.id,
         position: next,
-        contactName: record.contactName,
-        clientId: record.clientId,
+        contactName: input.contactName,
+        contactPhone: input.contactPhone ?? null,
+        contactEmail: input.contactEmail ?? null,
+        clientId,
         clientNameSnapshot: clientName,
-        estimatedValueBrl: record.estimatedValueBrl,
-        description: record.description,
-        contactPhone: record.contactPhone,
-        contactEmail: record.contactEmail,
-        contactBirthDate: record.contactBirthDate,
+        estimatedValueBrl: input.estimatedValueBrl ?? 0,
         sellerPersonId: seller?.id ?? null,
         sellerNameSnapshot: seller?.displayName ?? '',
-        // Both literal, and both unreachable from CreateLeadSchema: a lead
+        // Both literal, and both unreachable from LeadWriteSchema: a lead
         // cannot be born converted or born lost.
         saleId: null,
         lostReason: null,
@@ -1117,42 +1018,42 @@ async function insertLead(
       })
       .returning();
 
-    await replaceLeadProducts(tx, orgId, lead!.id, record.products);
+    // The one initial history entry of the lead (exactly one per lead, pinned by the partial unique
+    // index): from NULL to its first stage, written by the server in the same transaction.
+    await tx.insert(salesOpsCrmLeadEvents).values({
+      orgId,
+      leadId: lead!.id,
+      kind: 'stage_changed',
+      fromStageId: null,
+      toStageId: stage.id,
+      reason: null,
+      actorUserId: scope.userId,
+      actorNameSnapshot: scopeActorName(scope),
+    });
+
+    await applyFieldWrites(tx, orgId, lead!.id, [...legacy, ...dynamic.writes]);
     return { ok: true, lead: await readLeadView(tx, orgId, lead!.id) } as const;
   });
 }
 
 /**
- * Everything a lead PATCH may carry, across both editions. The full wire schema
- * never produces the three contact keys and the contact schema never produces
- * products, so each edition can only touch its own columns. Empresa
- * (clientId/clientName) and estimatedValueBrl are shared by both editions.
+ * The empresa of a write: the top-level `clientId` wins when the body carries it, the Cliente
+ * field entry of `fields` applies otherwise. Naming both is ambiguous and refused.
  */
-type LeadUpdatePatch = Omit<UpdateLeadInput, 'clientName'> & {
-  // The contact schema clears the empresa with `null`; the full schema's
-  // clientName is `string | undefined`, so the patch widens it to carry both.
-  clientName?: string | null | undefined;
-  contactPhone?: string | null | undefined;
-  contactEmail?: string | null | undefined;
-  contactBirthDate?: string | null | undefined;
-};
-
-export function updateLead(
-  db: Db,
-  orgId: string,
-  id: string,
-  input: UpdateLeadInput,
-  scope: LeadScope,
-): Promise<WriteLeadResult> {
-  return applyLeadUpdate(db, orgId, id, input, scope);
+function pickClientId(
+  topLevel: string | null | undefined,
+  cliente: { clientId: string | null; index: number } | null,
+): string | null {
+  if (topLevel !== undefined && cliente !== null) throw new LeadInputError('field_invalid', cliente.index);
+  if (topLevel !== undefined) return topLevel;
+  return cliente?.clientId ?? null;
 }
 
-/** The leads-edition PATCH. May set empresa and valor; never touches produtos. */
-export function updateContactLead(
+export function updateLead(
   db: Db,
   orgId: string,
   id: string,
-  input: UpdateContactLeadInput,
+  input: LeadPatchInput,
   scope: LeadScope,
 ): Promise<WriteLeadResult> {
   return applyLeadUpdate(db, orgId, id, input, scope);
@@ -1162,7 +1063,7 @@ async function applyLeadUpdate(
   db: Db,
   orgId: string,
   id: string,
-  input: LeadUpdatePatch,
+  input: LeadPatchInput,
   scope: LeadScope,
 ): Promise<WriteLeadResult> {
   return withTenant(db, orgId, async (tx) => {
@@ -1171,7 +1072,7 @@ async function applyLeadUpdate(
 
     const [current] = await tx
       .select()
-      .from(salesOpsLeads)
+      .from(salesOpsCrmLeads)
       .where(and(...leadIdentityConditions(orgId, id, gate)))
       .limit(1)
       .for('update');
@@ -1204,10 +1105,22 @@ async function applyLeadUpdate(
       seller = requested ? await resolveSellerPersonId(tx, orgId, requested) : null;
     }
 
+    // A write that touches the contact must leave at least one of phone and e-mail.
+    if (input.contactPhone !== undefined || input.contactEmail !== undefined) {
+      const phone = input.contactPhone !== undefined ? input.contactPhone : current.contactPhone;
+      const email = input.contactEmail !== undefined ? input.contactEmail : current.contactEmail;
+      if (!phone && !email) throw new LeadInputError('contact_required');
+    }
+
+    const dynamic = await resolveFieldWrites(tx, orgId, input.fields ?? []);
+    const legacy = await resolveLegacyFieldWrites(tx, orgId, input);
+    const clientTouched = input.clientId !== undefined || dynamic.cliente !== null;
+    const nextClientId = clientTouched ? pickClientId(input.clientId, dynamic.cliente) : current.clientId;
+
     let clientNameSnapshot: string | undefined;
-    if (input.clientId !== undefined) {
-      clientNameSnapshot = input.clientId
-        ? await resolveClientName(tx, orgId, input.clientId)
+    if (clientTouched) {
+      clientNameSnapshot = nextClientId
+        ? await resolveClientName(tx, orgId, nextClientId)
         : // The column is NOT NULL, so clearing the LINK can never blank the
           // label: the body's text wins, and the stored snapshot is the floor.
           (input.clientName ?? current.clientNameSnapshot);
@@ -1218,23 +1131,19 @@ async function applyLeadUpdate(
     }
 
     await tx
-      .update(salesOpsLeads)
-      // Built from `input` alone, and `UpdateLeadSchema` is `.strict()` and
+      .update(salesOpsCrmLeads)
+      // Built from `input` alone, and `LeadPatchSchema` is `.strict()` and
       // declares no stageId, position, stageChangedAt, saleId or lostReason - so
       // none of those keys can appear here, ever.
       .set({
         ...(input.contactName !== undefined ? { contactName: input.contactName } : {}),
-        ...(input.clientId !== undefined ? { clientId: input.clientId ?? null } : {}),
+        ...(clientTouched ? { clientId: nextClientId } : {}),
         ...(clientNameSnapshot !== undefined ? { clientNameSnapshot } : {}),
         ...(input.estimatedValueBrl !== undefined
           ? { estimatedValueBrl: input.estimatedValueBrl }
           : {}),
-        ...(input.description !== undefined ? { description: input.description ?? null } : {}),
         ...(input.contactPhone !== undefined ? { contactPhone: input.contactPhone } : {}),
         ...(input.contactEmail !== undefined ? { contactEmail: input.contactEmail } : {}),
-        ...(input.contactBirthDate !== undefined
-          ? { contactBirthDate: input.contactBirthDate }
-          : {}),
         ...(writesSeller
           ? {
               sellerPersonId: seller?.id ?? null,
@@ -1244,11 +1153,11 @@ async function applyLeadUpdate(
         updatedAt: new Date(),
       })
       // Live again here, not only in the identity read: belt and braces under READ COMMITTED, the row lock above already re-checked it.
-      .where(and(eq(salesOpsLeads.orgId, orgId), eq(salesOpsLeads.id, id), liveLeadCondition()));
+      .where(and(eq(salesOpsCrmLeads.orgId, orgId), eq(salesOpsCrmLeads.id, id), liveLeadCondition()));
 
-    // `undefined` leaves the child rows alone; `[]` clears them. The same
+    // A key absent from the body leaves its value rows alone; an empty value clears them. The same
     // distinction `updateProduct` draws for the produto's função costs.
-    if (input.products !== undefined) await replaceLeadProducts(tx, orgId, id, input.products);
+    await applyFieldWrites(tx, orgId, id, [...legacy, ...dynamic.writes]);
 
     return { ok: true, lead: await readLeadView(tx, orgId, id) } as const;
   });
@@ -1273,7 +1182,7 @@ export async function moveLead(
 
     const [current] = await tx
       .select()
-      .from(salesOpsLeads)
+      .from(salesOpsCrmLeads)
       .where(and(...leadIdentityConditions(orgId, id, gate)))
       .limit(1)
       .for('update');
@@ -1285,31 +1194,40 @@ export async function moveLead(
     // proposta there is no lead operation left that could.
     if (current.saleId !== null) return { ok: false, reason: 'already_converted' } as const;
 
-    // An ARCHIVED stage is not a move target.
+    // An ARCHIVED stage is not a move target, and neither is a stage of another pipeline (the
+    // composite FK (org, pipeline, stage) would refuse it anyway).
     const [destination] = await tx
-      .select({ id: salesOpsLeadStages.id, kind: salesOpsLeadStages.kind })
-      .from(salesOpsLeadStages)
+      .select({
+        id: salesOpsPipelineStages.id,
+        type: salesOpsPipelineStages.type,
+        behavior: salesOpsPipelineStages.behavior,
+        exitKind: salesOpsPipelineStages.exitKind,
+        requiresReason: salesOpsPipelineStages.requiresReason,
+      })
+      .from(salesOpsPipelineStages)
       .where(
         and(
-          eq(salesOpsLeadStages.orgId, orgId),
-          eq(salesOpsLeadStages.id, input.stageId),
-          eq(salesOpsLeadStages.status, 'active'),
+          eq(salesOpsPipelineStages.orgId, orgId),
+          eq(salesOpsPipelineStages.pipelineId, current.pipelineId),
+          eq(salesOpsPipelineStages.id, input.stageId),
+          eq(salesOpsPipelineStages.status, 'active'),
         ),
       )
       .limit(1);
     if (!destination) throw new LeadInputError('stage_not_found');
 
     // This cannot be a zod refine: the requirement depends on the DESTINATION
-    // row's kind, which is a database read. So it is the service sentinel 400,
-    // the same shape routes.ts already returns for entrada_mode_value_mismatch.
-    if (destination.kind === 'lost' && input.reason === undefined) {
+    // row, which is a database read. So it is the service sentinel 400, the same
+    // shape routes.ts already returns for entrada_mode_value_mismatch.
+    if (destination.requiresReason && input.reason === undefined) {
       throw new LeadInputError('lost_reason_required');
     }
 
-    if (destination.kind === 'conversion') {
+    const opensOrcamento = destination.type === 'orcamento' && destination.behavior === 'opens_orcamentos';
+    if (opensOrcamento) {
       if (input.saleId === undefined) throw new LeadInputError('sale_required_for_conversion');
       // The in-org SELECT is what produces the designed 400. The composite FK
-      // sales_ops_leads_org_sale_fk is the backstop underneath it: without this
+      // sales_ops_crm_leads_org_sale_fk is the backstop underneath it: without this
       // read a cross-org id would surface as a raw 23503 and an HTTP 500.
       const [sale] = await tx
         .select({ id: salesOpsSales.id })
@@ -1330,7 +1248,7 @@ export async function moveLead(
     const stageChanged = destination.id !== current.stageId;
 
     await tx
-      .update(salesOpsLeads)
+      .update(salesOpsCrmLeads)
       .set({
         stageId: destination.id,
         // KEY OMISSION, never `stageChanged ? now : current.stageChangedAt`. A
@@ -1338,12 +1256,12 @@ export async function moveLead(
         // stage_changed_at key at all, so the column is physically untouchable
         // by a reorder - the rule is not a branch someone can later "simplify".
         ...(stageChanged ? { stageChangedAt: new Date() } : {}),
-        lostReason: destination.kind === 'lost' ? (input.reason ?? null) : null,
-        ...(destination.kind === 'conversion' ? { saleId: input.saleId! } : {}),
+        lostReason: destination.exitKind === 'perdido' ? (input.reason ?? null) : null,
+        ...(opensOrcamento ? { saleId: input.saleId! } : {}),
         ...(claimed ? { sellerPersonId: claimed.id, sellerNameSnapshot: claimed.displayName } : {}),
         updatedAt: new Date(),
       })
-      .where(and(eq(salesOpsLeads.orgId, orgId), eq(salesOpsLeads.id, id), liveLeadCondition()));
+      .where(and(eq(salesOpsCrmLeads.orgId, orgId), eq(salesOpsCrmLeads.id, id), liveLeadCondition()));
 
     await renumberStage(tx, orgId, destination.id, { moved: id, at: input.position });
     if (stageChanged) await renumberStage(tx, orgId, current.stageId, null);
@@ -1373,16 +1291,16 @@ export async function renumberStage(
   placement: { moved: string; at: number } | null,
 ): Promise<void> {
   const rows = await tx
-    .select({ id: salesOpsLeads.id })
-    .from(salesOpsLeads)
+    .select({ id: salesOpsCrmLeads.id })
+    .from(salesOpsCrmLeads)
     .where(
       and(
-        eq(salesOpsLeads.orgId, orgId),
-        eq(salesOpsLeads.stageId, stageId),
+        eq(salesOpsCrmLeads.orgId, orgId),
+        eq(salesOpsCrmLeads.stageId, stageId),
         liveLeadCondition(),
       ),
     )
-    .orderBy(asc(salesOpsLeads.position), asc(salesOpsLeads.id))
+    .orderBy(asc(salesOpsCrmLeads.position), asc(salesOpsCrmLeads.id))
     .for('update');
 
   let ids = rows.map((row) => row.id);
@@ -1399,7 +1317,7 @@ export async function renumberStage(
   // integer column fails to resolve an operator.
   const values = ids.map((id, index) => sql`(${id}::uuid, ${index + 1}::int)`);
   await tx.execute(sql`
-    UPDATE sales_ops_leads AS l SET "position" = v.pos
+    UPDATE sales_ops_crm_leads AS l SET "position" = v.pos
     FROM (VALUES ${sql.join(values, sql`, `)}) AS v(id, pos)
     WHERE l.org_id = ${orgId} AND l.id = v.id AND l."position" IS DISTINCT FROM v.pos
   `);
```

#### `apps/api/src/domains/sales-ops/leads/lead-trash-service.ts` (edit, 70 changed lines)

```diff
diff --git a/apps/api/src/domains/sales-ops/leads/lead-trash-service.ts b/apps/api/src/domains/sales-ops/leads/lead-trash-service.ts
index 4e498b2..600871c 100644
--- a/apps/api/src/domains/sales-ops/leads/lead-trash-service.ts
+++ b/apps/api/src/domains/sales-ops/leads/lead-trash-service.ts
@@ -1,6 +1,6 @@
 import { and, desc, eq, isNotNull, sql, type SQL } from 'drizzle-orm';
 import type { getDb } from '../../../db/client.js';
-import { salesOpsLeadStages, salesOpsLeads } from '../../../db/schema.js';
+import { salesOpsCrmLeads, salesOpsPipelineStages } from '../../../db/schema.js';
 import { writeAuditEntry } from '../../audit/service.js';
 import { LEADS_DEFAULT_LIMIT, type ListDeletedLeadsQuery } from './lead-schemas.js';
 import {
@@ -61,15 +61,15 @@ export type ListDeletedLeadsResult = { items: DeletedLeadView[]; nextCursor: str
 
 /** The inverse of liveLeadCondition(), for the two reads that want deleted rows on purpose. */
 function deletedLeadCondition(): SQL {
-  return isNotNull(salesOpsLeads.deletedAt);
+  return isNotNull(salesOpsCrmLeads.deletedAt);
 }
 
 /** The etapa's CURRENT name, for the ledger snapshot. The composite FK guarantees the row. */
 async function stageName(tx: Db, orgId: string, stageId: string): Promise<string> {
   const [stage] = await tx
-    .select({ name: salesOpsLeadStages.name })
-    .from(salesOpsLeadStages)
-    .where(and(eq(salesOpsLeadStages.orgId, orgId), eq(salesOpsLeadStages.id, stageId)))
+    .select({ name: salesOpsPipelineStages.name })
+    .from(salesOpsPipelineStages)
+    .where(and(eq(salesOpsPipelineStages.orgId, orgId), eq(salesOpsPipelineStages.id, stageId)))
     .limit(1);
   return stage?.name ?? '';
 }
@@ -93,7 +93,7 @@ export function deleteLead(
 
     const [current] = await tx
       .select()
-      .from(salesOpsLeads)
+      .from(salesOpsCrmLeads)
       .where(and(...leadIdentityConditions(orgId, id, gate)))
       .limit(1)
       .for('update');
@@ -107,14 +107,14 @@ export function deleteLead(
     // No seller column, no stage_id, no position: a delete never claims a pool
     // lead and keeps the etapa a restore returns it to.
     await tx
-      .update(salesOpsLeads)
+      .update(salesOpsCrmLeads)
       .set({
         deletedAt,
         deletedByUserId: actor.userId,
         deletedByName: actor.name,
         updatedAt: deletedAt,
       })
-      .where(and(eq(salesOpsLeads.orgId, orgId), eq(salesOpsLeads.id, id), liveLeadCondition()));
+      .where(and(eq(salesOpsCrmLeads.orgId, orgId), eq(salesOpsCrmLeads.id, id), liveLeadCondition()));
 
     // The column closes the gap at once, so it stays 1..N over live cards.
     await renumberStage(tx, orgId, current.stageId, null);
@@ -154,17 +154,17 @@ export function restoreLead(
 ): Promise<RestoreLeadResult> {
   return withTenant(db, orgId, async (tx) => {
     const restoreConditions = and(
-      eq(salesOpsLeads.orgId, orgId),
-      eq(salesOpsLeads.id, id),
+      eq(salesOpsCrmLeads.orgId, orgId),
+      eq(salesOpsCrmLeads.id, id),
       deletedLeadCondition(),
-      ...(isAdmin ? [] : [eq(salesOpsLeads.deletedByUserId, actor.userId)]),
+      ...(isAdmin ? [] : [eq(salesOpsCrmLeads.deletedByUserId, actor.userId)]),
     );
     // A restore writes stage_id and position: same lock order as every board writer.
     await lockLeadBoard(tx, orgId);
 
     const [current] = await tx
       .select()
-      .from(salesOpsLeads)
+      .from(salesOpsCrmLeads)
       .where(restoreConditions)
       .limit(1)
       .for('update');
@@ -173,12 +173,12 @@ export function restoreLead(
 
     const [own] = await tx
       .select({
-        id: salesOpsLeadStages.id,
-        name: salesOpsLeadStages.name,
-        status: salesOpsLeadStages.status,
+        id: salesOpsPipelineStages.id,
+        name: salesOpsPipelineStages.name,
+        status: salesOpsPipelineStages.status,
       })
-      .from(salesOpsLeadStages)
-      .where(and(eq(salesOpsLeadStages.orgId, orgId), eq(salesOpsLeadStages.id, current.stageId)))
+      .from(salesOpsPipelineStages)
+      .where(and(eq(salesOpsPipelineStages.orgId, orgId), eq(salesOpsPipelineStages.id, current.stageId)))
       .limit(1);
     // Its own etapa when it is still on the board; an archived etapa is not a
     // move target, so the lead goes where a new lead would. Never seeds one: the
@@ -186,13 +186,13 @@ export function restoreLead(
     const target =
       own && own.status === 'active'
         ? { id: own.id, name: own.name }
-        : await firstOpenLeadStage(tx, orgId);
+        : await firstOpenLeadStage(tx, orgId, current.pipelineId);
     if (!target) throw new LeadInputError('no_open_stage');
 
     const stageChanged = target.id !== current.stageId;
     const position = await nextLeadPosition(tx, orgId, target.id);
     await tx
-      .update(salesOpsLeads)
+      .update(salesOpsCrmLeads)
       .set({
         deletedAt: null,
         deletedByUserId: null,
@@ -242,39 +242,39 @@ export function listDeletedLeads(
   query: ListDeletedLeadsQuery,
 ): Promise<ListDeletedLeadsResult> {
   return withTenant(db, orgId, async (tx) => {
-    const conditions: SQL[] = [eq(salesOpsLeads.orgId, orgId), deletedLeadCondition()];
+    const conditions: SQL[] = [eq(salesOpsCrmLeads.orgId, orgId), deletedLeadCondition()];
     if (query.cursor) {
       const [deletedAt, cursorId] = query.cursor.split('_');
       conditions.push(
-        sql`(${salesOpsLeads.deletedAt}, ${salesOpsLeads.id}) < (${deletedAt}::timestamptz, ${cursorId}::uuid)`,
+        sql`(${salesOpsCrmLeads.deletedAt}, ${salesOpsCrmLeads.id}) < (${deletedAt}::timestamptz, ${cursorId}::uuid)`,
       );
     }
     const limit = query.limit ?? LEADS_DEFAULT_LIMIT;
     const rows = await tx
       .select({
-        id: salesOpsLeads.id,
-        contactName: salesOpsLeads.contactName,
-        clientName: salesOpsLeads.clientNameSnapshot,
+        id: salesOpsCrmLeads.id,
+        contactName: salesOpsCrmLeads.contactName,
+        clientName: salesOpsCrmLeads.clientNameSnapshot,
         // The etapa's CURRENT name, joined live, so a renamed etapa reads renamed.
-        stageName: salesOpsLeadStages.name,
-        sellerName: salesOpsLeads.sellerNameSnapshot,
-        estimatedValueBrl: salesOpsLeads.estimatedValueBrl,
-        deletedAt: salesOpsLeads.deletedAt,
-        deletedByName: salesOpsLeads.deletedByName,
+        stageName: salesOpsPipelineStages.name,
+        sellerName: salesOpsCrmLeads.sellerNameSnapshot,
+        estimatedValueBrl: salesOpsCrmLeads.estimatedValueBrl,
+        deletedAt: salesOpsCrmLeads.deletedAt,
+        deletedByName: salesOpsCrmLeads.deletedByName,
         // Rendered by Postgres with all six fractional digits: see the cursor
         // comment in lead-schemas.ts for why a JS Date cannot build it.
-        cursorAt: sql<string>`to_char(${salesOpsLeads.deletedAt} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`,
+        cursorAt: sql<string>`to_char(${salesOpsCrmLeads.deletedAt} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`,
       })
-      .from(salesOpsLeads)
+      .from(salesOpsCrmLeads)
       .innerJoin(
-        salesOpsLeadStages,
+        salesOpsPipelineStages,
         and(
-          eq(salesOpsLeadStages.orgId, salesOpsLeads.orgId),
-          eq(salesOpsLeadStages.id, salesOpsLeads.stageId),
+          eq(salesOpsPipelineStages.orgId, salesOpsCrmLeads.orgId),
+          eq(salesOpsPipelineStages.id, salesOpsCrmLeads.stageId),
         ),
       )
       .where(and(...conditions))
-      .orderBy(desc(salesOpsLeads.deletedAt), desc(salesOpsLeads.id))
+      .orderBy(desc(salesOpsCrmLeads.deletedAt), desc(salesOpsCrmLeads.id))
       .limit(limit + 1);
 
     const hasMore = rows.length > limit;
```

#### `apps/api/src/domains/sales-ops/leads/lead-routes.ts` (edit, 49 changed lines)

```diff
diff --git a/apps/api/src/domains/sales-ops/leads/lead-routes.ts b/apps/api/src/domains/sales-ops/leads/lead-routes.ts
index 9248272..4ed19f8 100644
--- a/apps/api/src/domains/sales-ops/leads/lead-routes.ts
+++ b/apps/api/src/domains/sales-ops/leads/lead-routes.ts
@@ -1,30 +1,25 @@
-import { leadFieldSet } from '@fxl-sales/shared-utils/sales-edition';
 import { type Context, Hono } from 'hono';
 import { z } from 'zod';
 import { getDb } from '../../../db/client.js';
 import { requireAdmin } from '../../../middleware/require-admin.js';
 import { cadastroActor } from '../cadastro-actor.js';
 import {
-  CreateContactLeadSchema,
-  CreateLeadSchema,
+  LeadPatchSchema,
   LeadStageSummaryQuerySchema,
+  LeadWriteSchema,
   ListDeletedLeadsQuerySchema,
   ListLeadsQuerySchema,
   MoveLeadSchema,
-  UpdateContactLeadSchema,
-  UpdateLeadSchema,
 } from './lead-schemas.js';
 import {
   LeadInputError,
   type LeadScope,
   type WriteLeadResult,
-  createContactLead,
   createLead,
   getLead,
   listLeads,
   moveLead,
   summarizeLeadStages,
-  updateContactLead,
   updateLead,
 } from './lead-service.js';
 import { type LeadActor, deleteLead, listDeletedLeads, restoreLead } from './lead-trash-service.js';
@@ -89,15 +84,6 @@ function leadScope(c: Context): LeadScope {
   };
 }
 
-/**
- * Which lead wire contract this request speaks, from the edition the auth
- * middleware resolved from the VERIFIED token. Absent means 'full', the same
- * fail-to-full rule requireCapability applies, so it can never change FXL.
- */
-function usesContactFields(c: Context): boolean {
-  return leadFieldSet(c.get('salesEdition') ?? 'full') === 'contact';
-}
-
 function validationResponse(c: Context, error: z.ZodError) {
   return c.json({ error: 'validation_error', issues: error.flatten() }, 400);
 }
@@ -152,17 +138,11 @@ leadsRouter.get('/', async (c) => {
 
 leadsRouter.post('/', async (c) => {
   const body = await c.req.json().catch(() => ({}));
+  const parsed = LeadWriteSchema.safeParse(body);
+  if (!parsed.success) return validationResponse(c, parsed.error);
   let result: WriteLeadResult;
   try {
-    if (usesContactFields(c)) {
-      const parsed = CreateContactLeadSchema.safeParse(body);
-      if (!parsed.success) return validationResponse(c, parsed.error);
-      result = await createContactLead(getDb(), c.get('orgId'), parsed.data, leadScope(c));
-    } else {
-      const parsed = CreateLeadSchema.safeParse(body);
-      if (!parsed.success) return validationResponse(c, parsed.error);
-      result = await createLead(getDb(), c.get('orgId'), parsed.data, leadScope(c));
-    }
+    result = await createLead(getDb(), c.get('orgId'), parsed.data, leadScope(c));
   } catch (error) {
     if (error instanceof LeadInputError) return leadInputErrorResponse(c, error);
     throw error;
@@ -212,24 +192,11 @@ leadsRouter.get('/:id', async (c) => {
 leadsRouter.patch('/:id', async (c) => {
   const id = leadIdSchema.safeParse(c.req.param('id'));
   if (!id.success) return c.json({ error: 'not_found' }, 404);
-  const body = await c.req.json().catch(() => ({}));
+  const parsed = LeadPatchSchema.safeParse(await c.req.json().catch(() => ({})));
+  if (!parsed.success) return validationResponse(c, parsed.error);
   let result: WriteLeadResult;
   try {
-    if (usesContactFields(c)) {
-      const parsed = UpdateContactLeadSchema.safeParse(body);
-      if (!parsed.success) return validationResponse(c, parsed.error);
-      result = await updateContactLead(
-        getDb(),
-        c.get('orgId'),
-        id.data,
-        parsed.data,
-        leadScope(c),
-      );
-    } else {
-      const parsed = UpdateLeadSchema.safeParse(body);
-      if (!parsed.success) return validationResponse(c, parsed.error);
-      result = await updateLead(getDb(), c.get('orgId'), id.data, parsed.data, leadScope(c));
-    }
+    result = await updateLead(getDb(), c.get('orgId'), id.data, parsed.data, leadScope(c));
   } catch (error) {
     if (error instanceof LeadInputError) return leadInputErrorResponse(c, error);
     throw error;
```

#### `apps/api/src/domains/sales-ops/leads/schemas.ts` (edit, 4 changed lines)

```diff
diff --git a/apps/api/src/domains/sales-ops/leads/schemas.ts b/apps/api/src/domains/sales-ops/leads/schemas.ts
index 688bb73..8486f70 100644
--- a/apps/api/src/domains/sales-ops/leads/schemas.ts
+++ b/apps/api/src/domains/sales-ops/leads/schemas.ts
@@ -19,6 +19,9 @@ export const LeadStageSchema = z.object({
   status: z.enum(['active', 'archived']).default('active'),
 });
 
+/** `POST /lead-stages`: the stage plus the optional pipeline it joins (default pipeline when absent). */
+export const CreateLeadStageSchema = LeadStageSchema.extend({ pipelineId: z.string().uuid().optional() });
+
 /**
  * `.partial()` over a schema carrying a `.default()` keeps `parse({})` equal to
  * `{}`, exactly as UpdateFuncaoSchema does. Same spelling, deliberately.
@@ -33,6 +36,7 @@ export const UpdateLeadStageSchema = LeadStageSchema.partial();
 export const ReorderLeadStagesSchema = z
   .object({
     stageIds: z.array(z.string().uuid()).min(1),
+    pipelineId: z.string().uuid().optional(),
   })
   .superRefine((value, ctx) => {
     if (new Set(value.stageIds).size === value.stageIds.length) return;
```

#### `apps/api/src/domains/sales-ops/leads/stage-service.ts` (edit, 208 changed lines)

```diff
diff --git a/apps/api/src/domains/sales-ops/leads/stage-service.ts b/apps/api/src/domains/sales-ops/leads/stage-service.ts
index 73fcafc..4898503 100644
--- a/apps/api/src/domains/sales-ops/leads/stage-service.ts
+++ b/apps/api/src/domains/sales-ops/leads/stage-service.ts
@@ -1,15 +1,24 @@
+import { planPipelineTransitions, type TransitionPlanStage } from '@fxl-sales/shared-utils/crm-model';
 import { and, asc, eq, max, ne } from 'drizzle-orm';
 import type { getDb } from '../../../db/client.js';
-import { salesOpsLeadStages } from '../../../db/schema.js';
+import { salesOpsPipelineStages, salesOpsPipelineTransitions } from '../../../db/schema.js';
+import { defaultPipelineId, listPipelineStages, pipelineExists } from '../../crm/pipeline-read.js';
+import { ensureBareDefaultPipeline } from '../../crm/pipeline-write.js';
+import { legacyStageIsSystem, toLeadStageView, type LeadStageView } from '../../crm/stage-view.js';
 import { ensureLeadStages } from './stages-seed.js';
 import { withTenant } from './with-tenant.js';
 import type { LeadStageInput } from './schemas.js';
 
 type Db = ReturnType<typeof getDb>;
 
-export type LeadStageRow = typeof salesOpsLeadStages.$inferSelect;
+export type LeadStageRow = LeadStageView;
 
 /**
+ * Phase 2 cutover: these functions read and write the unified `sales_ops_pipeline_stages`. The
+ * response keeps the old row shape (`kind`, `isSystem`, derived) and adds `pipelineId`, `type`,
+ * `behavior`, `exitKind` and `requiresReason`. Without an explicit pipeline every function works
+ * on the org's DEFAULT pipeline.
+ *
  * There is exactly ONE duplicate sentinel on this surface.
  *
  * Unlike createFuncao there is no 'duplicate_slug' and no 'reserved_slug': 01
@@ -28,7 +37,7 @@ export type LeadStageDuplicate = 'duplicate';
  * `kind`, so it can never be the constraint a PATCH violates.
  */
 const LEAD_STAGE_UNIQUE_VIOLATIONS: Record<string, LeadStageDuplicate> = {
-  sales_ops_lead_stages_org_name_idx: 'duplicate',
+  sales_ops_pipeline_stages_org_pipeline_name_idx: 'duplicate',
 };
 
 function mapLeadStageUniqueViolation(error: unknown): LeadStageDuplicate | null {
@@ -48,24 +57,38 @@ function mapLeadStageUniqueViolation(error: unknown): LeadStageDuplicate | null
   return null;
 }
 
-/** Per-org uniqueness for the display name. One rule, so one probe. */
+/** Per-pipeline uniqueness for the display name. One rule, so one probe. */
 async function findLeadStageClash(
   tx: Db,
   orgId: string,
+  pipelineId: string,
   name: string,
   excludeId?: string,
 ): Promise<LeadStageDuplicate | null> {
-  const notSelf = excludeId ? [ne(salesOpsLeadStages.id, excludeId)] : [];
+  const notSelf = excludeId ? [ne(salesOpsPipelineStages.id, excludeId)] : [];
   const [byName] = await tx
-    .select({ id: salesOpsLeadStages.id })
-    .from(salesOpsLeadStages)
-    .where(and(eq(salesOpsLeadStages.orgId, orgId), eq(salesOpsLeadStages.name, name), ...notSelf))
+    .select({ id: salesOpsPipelineStages.id })
+    .from(salesOpsPipelineStages)
+    .where(
+      and(
+        eq(salesOpsPipelineStages.orgId, orgId),
+        eq(salesOpsPipelineStages.pipelineId, pipelineId),
+        eq(salesOpsPipelineStages.name, name),
+        ...notSelf,
+      ),
+    )
     .limit(1);
   return byName ? 'duplicate' : null;
 }
 
+/** The pipeline a request addresses: the explicit one when it exists in the org, else the default. */
+async function resolvePipeline(tx: Db, orgId: string, requested?: string): Promise<string | null> {
+  if (requested !== undefined) return (await pipelineExists(tx, orgId, requested)) ? requested : null;
+  return defaultPipelineId(tx, orgId);
+}
+
 /**
- * The org's stages in board order.
+ * The pipeline's stages in board order.
  *
  * It returns ARCHIVED stages too, a deliberate divergence from the four audited
  * cadastros. A lead can still be sitting on a stage an admin just archived, and
@@ -74,56 +97,112 @@ async function findLeadStageClash(
  * stage can be restored from, and it can only offer that if this read returns
  * the archived row. The board filters to `status === 'active'` itself.
  *
- * `name` is the tiebreaker so the order is total even before the first reorder,
- * when the seed may have written equal positions.
- *
- * Seeds the default pipeline when the org has no stage row at all (ECV bug); see
- * ensureLeadStages.
+ * Seeds the default CRM pipeline when the org has no pipeline row at all (ECV bug); see
+ * ensureLeadStages. An unknown `pipelineId` answers an empty list.
  */
-export function listLeadStages(db: Db, orgId: string): Promise<LeadStageRow[]> {
-  return withTenant(db, orgId, (tx) => ensureLeadStages(tx, orgId));
+export function listLeadStages(db: Db, orgId: string, pipelineId?: string): Promise<LeadStageRow[]> {
+  return withTenant(db, orgId, async (tx) => {
+    const seeded = await ensureLeadStages(tx, orgId);
+    if (pipelineId === undefined) return seeded;
+    if (!(await pipelineExists(tx, orgId, pipelineId))) return [];
+    return (await listPipelineStages(tx, orgId, pipelineId)).map(toLeadStageView);
+  });
 }
 
-export function createLeadStage(
+export type LeadStageCreateInput = LeadStageInput & { pipelineId?: string | undefined };
+
+/** Creates a stage in the org's DEFAULT pipeline (the import executor and every pre-cutover caller). */
+export async function createLeadStage(
   db: Db,
   orgId: string,
   data: LeadStageInput,
 ): Promise<LeadStageRow | LeadStageDuplicate> {
+  // Without a pipelineId the default pipeline is used, so 'pipeline_not_found' is unreachable.
+  return (await createLeadStageInPipeline(db, orgId, data)) as LeadStageRow | LeadStageDuplicate;
+}
+
+export function createLeadStageInPipeline(
+  db: Db,
+  orgId: string,
+  data: LeadStageCreateInput,
+): Promise<LeadStageRow | LeadStageDuplicate | 'pipeline_not_found'> {
   return withTenant(db, orgId, async (tx) => {
+    // An org that never read its etapas has no pipeline yet: its first etapa creates the bare
+    // default pipeline and the org is then never seeded (the pre-cutover "own first etapa" rule).
+    const pipelineId =
+      data.pipelineId === undefined
+        ? await ensureBareDefaultPipeline(tx, orgId)
+        : await resolvePipeline(tx, orgId, data.pipelineId);
+    if (pipelineId === null) return 'pipeline_not_found' as const;
+
     // Fast path, purely for the error message: it names which rule was hit
     // without waiting on a lock. It is NOT the guard - see the conflict clause.
-    const clash = await findLeadStageClash(tx, orgId, data.name);
+    const clash = await findLeadStageClash(tx, orgId, pipelineId, data.name);
     if (clash) return clash;
 
-    // The max is taken over EVERY stage in the org, archived included, so a new
+    // The max is taken over EVERY stage in the pipeline, archived included, so a new
     // stage can never land on an archived stage's position and a later restore
     // cannot collide. A count(*)-based position would.
     const [{ value: highest } = { value: null }] = await tx
-      .select({ value: max(salesOpsLeadStages.position) })
-      .from(salesOpsLeadStages)
-      .where(eq(salesOpsLeadStages.orgId, orgId));
+      .select({ value: max(salesOpsPipelineStages.position) })
+      .from(salesOpsPipelineStages)
+      .where(and(eq(salesOpsPipelineStages.orgId, orgId), eq(salesOpsPipelineStages.pipelineId, pipelineId)));
     const position = (highest ?? -1) + 1;
 
     const [stage] = await tx
-      .insert(salesOpsLeadStages)
-      // `isSystem` and `kind` are written LITERALLY here and never spread from
-      // `data` - the same reason createFuncao writes isSystem: false literally.
-      // Only the migration seed may mint a system stage.
-      .values({ ...data, orgId, position, isSystem: false, kind: 'normal' })
+      .insert(salesOpsPipelineStages)
+      // `type`, `behavior` and `exitKind` are written LITERALLY here and never spread from
+      // `data`: a stage minted through this API is always an ordinary open stage.
+      .values({
+        orgId,
+        pipelineId,
+        name: data.name,
+        status: data.status,
+        position,
+        type: 'normal',
+        behavior: 'none',
+        exitKind: null,
+        requiresReason: false,
+      })
       // The probe above is a time-of-check/time-of-use race: a concurrent writer
       // (an admin double-clicking Save is enough) can land the same name in
       // between, and a plain INSERT would raise 23505 and escape as an HTTP 500
       // instead of the designed 409. Absorbing the conflict here makes
-      // sales_ops_lead_stages_org_name_idx the ACTUAL guard.
+      // sales_ops_pipeline_stages_org_pipeline_name_idx the ACTUAL guard.
       .onConflictDoNothing()
       .returning();
-    if (stage) return stage;
-    // Lost the race. Re-probe under a fresh statement snapshot, which now sees
-    // the committed winner, and fall back to the name reason.
-    return (await findLeadStageClash(tx, orgId, data.name)) ?? ('duplicate' as const);
+    if (!stage) {
+      // Lost the race. Re-probe under a fresh statement snapshot, which now sees
+      // the committed winner, and fall back to the name reason.
+      return (await findLeadStageClash(tx, orgId, pipelineId, data.name)) ?? ('duplicate' as const);
+    }
+    await addTransitionsForNewStage(tx, orgId, pipelineId, stage.id);
+    return toLeadStageView(stage);
   });
 }
 
+/**
+ * A new open stage must be reachable: the explicit transition graph says "a pair that is absent is
+ * not allowed". The pairs the shared rule (`planPipelineTransitions`) gives the new stage - to and
+ * from the previous open stage, to every exit, and from the pausado exit - are inserted; pairs
+ * between OTHER stages are never touched, so a graph the org shaped stays as it is.
+ */
+async function addTransitionsForNewStage(
+  tx: Db,
+  orgId: string,
+  pipelineId: string,
+  stageId: string,
+): Promise<void> {
+  const stages = await listPipelineStages(tx, orgId, pipelineId);
+  const plan = stages.map((stage) => ({ ...stage, type: stage.type as TransitionPlanStage['type'], exitKind: stage.exitKind as TransitionPlanStage['exitKind'], status: stage.status as TransitionPlanStage['status'] }));
+  const pairs = planPipelineTransitions(plan).filter(([from, to]) => from === stageId || to === stageId);
+  if (pairs.length === 0) return;
+  await tx
+    .insert(salesOpsPipelineTransitions)
+    .values(pairs.map(([fromStageId, toStageId]) => ({ orgId, pipelineId, fromStageId, toStageId })))
+    .onConflictDoNothing();
+}
+
 export function updateLeadStage(
   db: Db,
   orgId: string,
@@ -133,21 +212,21 @@ export function updateLeadStage(
   return withTenant(db, orgId, async (tx) => {
     const [current] = await tx
       .select()
-      .from(salesOpsLeadStages)
-      .where(and(eq(salesOpsLeadStages.orgId, orgId), eq(salesOpsLeadStages.id, id)))
+      .from(salesOpsPipelineStages)
+      .where(and(eq(salesOpsPipelineStages.orgId, orgId), eq(salesOpsPipelineStages.id, id)))
       .limit(1)
       .for('update');
     if (!current) return null;
-    // Byte-for-byte the funções rule: a system stage is fully immutable through
-    // this endpoint - no rename, no archive, no restore. Its POSITION is still
+    // Byte-for-byte the funções rule: a system stage (the conversion and the lost etapa) is fully
+    // immutable through this endpoint - no rename, no archive, no restore. Its POSITION is still
     // reorderable, which reorderLeadStages does without going through here.
-    if (current.isSystem && (data.name !== undefined || data.status !== undefined)) {
+    if (legacyStageIsSystem(current) && (data.name !== undefined || data.status !== undefined)) {
       return 'is_system' as const;
     }
 
     if (data.name !== undefined) {
       // Fast path for the error message only; the unique index is the real guard.
-      const clash = await findLeadStageClash(tx, orgId, data.name, id);
+      const clash = await findLeadStageClash(tx, orgId, current.pipelineId, data.name, id);
       if (clash) return clash;
     }
 
@@ -159,15 +238,15 @@ export function updateLeadStage(
     try {
       stage = await tx.transaction(async (nested) => {
         const [row] = await nested
-          .update(salesOpsLeadStages)
+          .update(salesOpsPipelineStages)
           .set({
             ...data,
             ...archivedAtPatch(current.status, data.status ?? current.status),
             updatedAt: new Date(),
           })
-          .where(and(eq(salesOpsLeadStages.orgId, orgId), eq(salesOpsLeadStages.id, id)))
+          .where(and(eq(salesOpsPipelineStages.orgId, orgId), eq(salesOpsPipelineStages.id, id)))
           .returning();
-        return row ?? null;
+        return row ? toLeadStageView(row) : null;
       });
     } catch (error) {
       const violated = mapLeadStageUniqueViolation(error);
@@ -195,9 +274,9 @@ function archivedAtPatch(before: string, after: string): { archivedAt?: Date | n
 }
 
 /**
- * Writes a total order over the org's ACTIVE stages, in ONE transaction.
+ * Writes a total order over the pipeline's ACTIVE stages, in ONE transaction.
  *
- * - The payload is the COMPLETE ordered set of the org's active stage ids, or it
+ * - The payload is the COMPLETE ordered set of the pipeline's active stage ids, or it
  *   is rejected. A partial "move stage X to index 3" payload cannot express the
  *   result without the server re-deriving every other position, and two admins
  *   doing that concurrently interleave into an order neither asked for. A total
@@ -211,20 +290,39 @@ function archivedAtPatch(before: string, after: string): { archivedAt?: Date | n
  *   index would abort the transaction. This endpoint is the only writer of
  *   position after create and it writes a total order, so uniqueness is an
  *   invariant of the writer rather than of the schema.
- * - It writes sales_ops_lead_stages and NOTHING else. No lead row is read or
- *   written, so no lead's stage_changed_at can move.
+ * - It writes the stage rows and NOTHING else. No lead row is read or written, so no lead's
+ *   stage_changed_at can move, and the transition graph is explicit data: reordering never
+ *   regenerates it.
  */
-export function reorderLeadStages(
+/** Reorders the DEFAULT pipeline's active stages. */
+export async function reorderLeadStages(
   db: Db,
   orgId: string,
   stageIds: string[],
 ): Promise<LeadStageRow[] | 'set_mismatch'> {
+  return (await reorderLeadStagesInPipeline(db, orgId, stageIds, undefined)) as LeadStageRow[] | 'set_mismatch';
+}
+
+export function reorderLeadStagesInPipeline(
+  db: Db,
+  orgId: string,
+  stageIds: string[],
+  pipelineId: string | undefined,
+): Promise<LeadStageRow[] | 'set_mismatch' | 'pipeline_not_found'> {
   return withTenant(db, orgId, async (tx) => {
+    const resolved = await resolvePipeline(tx, orgId, pipelineId);
+    if (resolved === null) return (pipelineId === undefined ? 'set_mismatch' : 'pipeline_not_found') as 'set_mismatch';
     const active = await tx
-      .select({ id: salesOpsLeadStages.id })
-      .from(salesOpsLeadStages)
-      .where(and(eq(salesOpsLeadStages.orgId, orgId), eq(salesOpsLeadStages.status, 'active')))
-      .orderBy(asc(salesOpsLeadStages.position))
+      .select({ id: salesOpsPipelineStages.id })
+      .from(salesOpsPipelineStages)
+      .where(
+        and(
+          eq(salesOpsPipelineStages.orgId, orgId),
+          eq(salesOpsPipelineStages.pipelineId, resolved),
+          eq(salesOpsPipelineStages.status, 'active'),
+        ),
+      )
+      .orderBy(asc(salesOpsPipelineStages.position))
       .for('update');
 
     // Full-set equality, both directions. The schema already refused duplicates,
@@ -235,15 +333,11 @@ export function reorderLeadStages(
 
     for (const [index, id] of stageIds.entries()) {
       await tx
-        .update(salesOpsLeadStages)
+        .update(salesOpsPipelineStages)
         .set({ position: index, updatedAt: new Date() })
-        .where(and(eq(salesOpsLeadStages.orgId, orgId), eq(salesOpsLeadStages.id, id)));
+        .where(and(eq(salesOpsPipelineStages.orgId, orgId), eq(salesOpsPipelineStages.id, id)));
     }
 
-    return tx
-      .select()
-      .from(salesOpsLeadStages)
-      .where(eq(salesOpsLeadStages.orgId, orgId))
-      .orderBy(asc(salesOpsLeadStages.position), asc(salesOpsLeadStages.name));
+    return (await listPipelineStages(tx, orgId, resolved)).map(toLeadStageView);
   });
 }
```

#### `apps/api/src/domains/sales-ops/leads/stage-routes.ts` (edit, 21 changed lines)

```diff
diff --git a/apps/api/src/domains/sales-ops/leads/stage-routes.ts b/apps/api/src/domains/sales-ops/leads/stage-routes.ts
index 990f36a..fcfe503 100644
--- a/apps/api/src/domains/sales-ops/leads/stage-routes.ts
+++ b/apps/api/src/domains/sales-ops/leads/stage-routes.ts
@@ -1,11 +1,12 @@
 import { Hono } from 'hono';
+import { z } from 'zod';
 import { getDb } from '../../../db/client.js';
 import { requireAdmin } from '../../../middleware/require-admin.js';
-import { LeadStageSchema, ReorderLeadStagesSchema, UpdateLeadStageSchema } from './schemas.js';
+import { CreateLeadStageSchema, ReorderLeadStagesSchema, UpdateLeadStageSchema } from './schemas.js';
 import {
-  createLeadStage,
+  createLeadStageInPipeline,
   listLeadStages,
-  reorderLeadStages,
+  reorderLeadStagesInPipeline,
   updateLeadStage,
 } from './stage-service.js';
 
@@ -31,7 +32,11 @@ export const leadStagesRouter = new Hono();
 // picker need the list, and a seller has a board - but only an admin may create,
 // rename, archive or reorder one. The same split as GET/POST /funcoes.
 leadStagesRouter.get('/lead-stages', async (c) => {
-  const stages = await listLeadStages(getDb(), c.get('orgId'));
+  const pipelineId = c.req.query('pipelineId');
+  if (pipelineId !== undefined && !z.string().uuid().safeParse(pipelineId).success) {
+    return c.json({ error: 'validation_error', reason: 'invalid_pipeline_id' }, 400);
+  }
+  const stages = await listLeadStages(getDb(), c.get('orgId'), pipelineId);
   return c.json({ stages });
 });
 
@@ -42,7 +47,8 @@ leadStagesRouter.post('/lead-stages/reorder', requireAdmin, async (c) => {
   if (!parsed.success) {
     return c.json({ error: 'validation_error', issues: parsed.error.flatten() }, 400);
   }
-  const stages = await reorderLeadStages(getDb(), c.get('orgId'), parsed.data.stageIds);
+  const stages = await reorderLeadStagesInPipeline(getDb(), c.get('orgId'), parsed.data.stageIds, parsed.data.pipelineId);
+  if (stages === 'pipeline_not_found') return c.json({ error: 'not_found' }, 404);
   if (stages === 'set_mismatch') {
     return c.json({ error: 'validation_error', reason: 'stage_set_mismatch' }, 400);
   }
@@ -50,11 +56,12 @@ leadStagesRouter.post('/lead-stages/reorder', requireAdmin, async (c) => {
 });
 
 leadStagesRouter.post('/lead-stages', requireAdmin, async (c) => {
-  const parsed = LeadStageSchema.safeParse(await c.req.json().catch(() => ({})));
+  const parsed = CreateLeadStageSchema.safeParse(await c.req.json().catch(() => ({})));
   if (!parsed.success) {
     return c.json({ error: 'validation_error', issues: parsed.error.flatten() }, 400);
   }
-  const stage = await createLeadStage(getDb(), c.get('orgId'), parsed.data);
+  const stage = await createLeadStageInPipeline(getDb(), c.get('orgId'), parsed.data);
+  if (stage === 'pipeline_not_found') return c.json({ error: 'not_found' }, 404);
   if (stage === 'duplicate') return c.json({ error: 'conflict', reason: 'stage_name_taken' }, 409);
   return c.json({ stage }, 201);
 });
```

#### `apps/api/src/domains/sales-ops/leads/stages-seed.ts` (edit, 75 changed lines)

```diff
diff --git a/apps/api/src/domains/sales-ops/leads/stages-seed.ts b/apps/api/src/domains/sales-ops/leads/stages-seed.ts
index 77fc428..bcf5830 100644
--- a/apps/api/src/domains/sales-ops/leads/stages-seed.ts
+++ b/apps/api/src/domains/sales-ops/leads/stages-seed.ts
@@ -1,18 +1,20 @@
-import { asc, eq } from 'drizzle-orm';
 import type { getDb } from '../../../db/client.js';
-import { salesOpsLeadStages } from '../../../db/schema.js';
+import { ensureCrmDefaults } from '../../crm/defaults.js';
+import { defaultPipelineId, listPipelineStages } from '../../crm/pipeline-read.js';
+import { toLeadStageView, type LeadStageView } from '../../crm/stage-view.js';
 import { withTenant } from './with-tenant.js';
 
 type Db = ReturnType<typeof getDb>;
 
 export type LeadStageKind = 'normal' | 'conversion' | 'lost';
-export type LeadStageRow = typeof salesOpsLeadStages.$inferSelect;
+export type LeadStageRow = LeadStageView;
 
 /**
- * The default pipeline written for every org. Byte-identical to the VALUES list
- * in migration 0022 - if these two ever disagree, an org provisioned before the
- * deploy and one provisioned after get different boards.
- * `leads-schema-migration.test.ts` asserts they agree.
+ * FROZEN since the phase 2 cutover: the four etapas migration 0022 seeded. Nothing writes them any
+ * more (the default etapas of a new org are the seven of the default CRM pipeline, seeded by
+ * `ensureCrmDefaults`); the constant stays only for the 0022 parity oracle
+ * (`leads-schema-migration.test.ts`) and the import template tests. Byte-identical to the VALUES
+ * list in migration 0022.
  *
  * Four stages, only two of them system: two would leave an org with a conversion
  * column and a Perdido column and nowhere for a lead to start. `Novo` and
@@ -35,57 +37,20 @@ export const LEAD_STAGE_SEEDS = [
 export const SYSTEM_LEAD_STAGE_KINDS = ['conversion', 'lost'] as const;
 
 /**
- * Reads the org's stages in board order.
+ * Seeds the org's default CRM pipeline (7 stages, 22 transitions, the Cliente field) when the org
+ * has NO pipeline row and returns the DEFAULT pipeline's stages in board order, in the legacy
+ * `kind` / `isSystem` shape. MUST be called inside an already tenant-scoped transaction; see
+ * {@link ensureLeadStagesForOrg} for the entry point that opens one.
  *
- * The explicit `eq(salesOpsLeadStages.orgId, orgId)` is defence in depth and NOT
- * redundant with RLS: over the `app.fxl_admin` connection the admin policy makes
- * every org's rows visible, and this filter is then the only thing scoping the
- * read.
- */
-function selectStages(tx: Db, orgId: string): Promise<LeadStageRow[]> {
-  return tx
-    .select()
-    .from(salesOpsLeadStages)
-    .where(eq(salesOpsLeadStages.orgId, orgId))
-    .orderBy(asc(salesOpsLeadStages.position), asc(salesOpsLeadStages.name));
-}
-
-/**
- * Seeds the default pipeline for an org that does not have it yet and returns the
- * org's stages in board order. MUST be called inside an already tenant-scoped
- * transaction; see {@link ensureLeadStagesForOrg} for the entry point that opens
- * one.
- *
- * `isSystem` and `kind` are never taken from a caller - there is no caller
- * parameter at all.
+ * This is the legacy facade over `ensureCrmDefaults`: it keeps the callers that predate the cutover
+ * (the stage read, the bootstrap route, the import routes) and their allow-list test unchanged,
+ * and it writes ONLY the unified tables.
  */
 export async function ensureLeadStages(tx: Db, orgId: string): Promise<LeadStageRow[]> {
-  const existing = await selectStages(tx, orgId);
-  // "Has this org been seeded" is "does it have ANY stage row", not "does it have
-  // each of the four". An org that renamed `Novo` to `Prospecção`, or archived
-  // it, must never have `Novo` re-inserted underneath it.
-  if (existing.length > 0) return existing;
-
-  await tx
-    .insert(salesOpsLeadStages)
-    .values(
-      LEAD_STAGE_SEEDS.map((seed) => ({
-        orgId,
-        name: seed.name,
-        kind: seed.kind,
-        isSystem: seed.isSystem,
-        position: seed.position,
-      })),
-    )
-    // Bare, i.e. every unique index, NOT a named arbiter. The table carries two
-    // unique indexes this seed writes into - (org_id, name) and the partial
-    // (org_id, kind) - and naming one makes Postgres raise 23505 whenever it
-    // reports the other, turning a concurrent first read into an HTTP 500.
-    .onConflictDoNothing();
-
-  // Re-read rather than use `.returning()`: a concurrent first caller can win the
-  // race, the conflict is absorbed, and `.returning()` would then come back short.
-  return selectStages(tx, orgId);
+  await ensureCrmDefaults(tx, orgId);
+  const pipelineId = await defaultPipelineId(tx, orgId);
+  if (pipelineId === null) return [];
+  return (await listPipelineStages(tx, orgId, pipelineId)).map(toLeadStageView);
 }
 
 /** Opens the tenant transaction and seeds. The public entry point. */
```

#### `apps/api/src/domains/import/catalog.ts` (edit, 30 changed lines)

```diff
diff --git a/apps/api/src/domains/import/catalog.ts b/apps/api/src/domains/import/catalog.ts
index 24d8fe2..15f875b 100644
--- a/apps/api/src/domains/import/catalog.ts
+++ b/apps/api/src/domains/import/catalog.ts
@@ -8,13 +8,14 @@ import {
   salesOpsAreas,
   salesOpsClients,
   salesOpsFuncoes,
-  salesOpsLeadStages,
   salesOpsPeople,
   salesOpsPersonFuncoes,
   salesOpsProductFuncaoCosts,
   salesOpsProducts,
   salesOpsSettings,
 } from '../../db/schema.js';
+import { defaultPipelineId, listPipelineStages } from '../crm/pipeline-read.js';
+import { legacyStageKind } from '../crm/stage-view.js';
 import { isProducerFlowLive } from '../integration/producer-gate.js';
 import {
   ProductEntradaModeSchema,
@@ -166,21 +167,18 @@ export async function readImportCatalog(tx: Db, orgId: string, now: Date): Promi
     .where(eq(salesOpsClients.orgId, orgId))
     .orderBy(asc(salesOpsClients.name));
 
-  const stageRows = await tx
-    .select({
-      id: salesOpsLeadStages.id,
-      name: salesOpsLeadStages.name,
-      kind: salesOpsLeadStages.kind,
-      status: salesOpsLeadStages.status,
-      position: salesOpsLeadStages.position,
-    })
-    .from(salesOpsLeadStages)
-    .where(eq(salesOpsLeadStages.orgId, orgId))
-    .orderBy(asc(salesOpsLeadStages.position), asc(salesOpsLeadStages.name));
-  const stages: ImportCatalog['stages'] = stageRows.map((row) => ({
-    ...row,
-    kind: row.kind === 'conversion' || row.kind === 'lost' ? row.kind : 'normal',
-  }));
+  // The stages of the org's DEFAULT pipeline, in the legacy kind vocabulary the planner speaks
+  // (orcamento -> conversion, exit perdido -> lost). Read only: the import routes seed first.
+  const pipelineId = await defaultPipelineId(tx, orgId);
+  const stages: ImportCatalog['stages'] = (pipelineId === null ? [] : await listPipelineStages(tx, orgId, pipelineId)).map(
+    (row) => ({
+      id: row.id,
+      name: row.name,
+      kind: legacyStageKind(row),
+      status: row.status,
+      position: row.position,
+    }),
+  );
 
   const [settingsRow] = await tx
     .select({
```

#### `apps/api/src/domains/import/executor.ts` (edit, 4 changed lines)

```diff
diff --git a/apps/api/src/domains/import/executor.ts b/apps/api/src/domains/import/executor.ts
index 62028c9..2a9476a 100644
--- a/apps/api/src/domains/import/executor.ts
+++ b/apps/api/src/domains/import/executor.ts
@@ -44,7 +44,7 @@ import {
 } from '../sales-ops/service.js';
 import { applyBaixaTx } from '../sales-ops/settlements.js';
 import { LeadInputError, createLead, moveLead, type LeadScope } from '../sales-ops/leads/lead-service.js';
-import { CreateLeadSchema, MoveLeadSchema } from '../sales-ops/leads/lead-schemas.js';
+import { LeadWriteBaseSchema, MoveLeadSchema } from '../sales-ops/leads/lead-schemas.js';
 import { LeadStageSchema } from '../sales-ops/leads/schemas.js';
 import { createLeadStage } from '../sales-ops/leads/stage-service.js';
 import type { EntityRef, ImportCounts, ImportOperation, ImportPlan, SheetKey } from './types.js';
@@ -315,7 +315,7 @@ export async function executeImportPlan(
         return;
       }
       case 'createLead': {
-        const parsed = CreateLeadSchema.safeParse({
+        const parsed = LeadWriteBaseSchema.safeParse({
           ...operation.input,
           clientId: resolveOrNull(operation.clientRef, operation),
           sellerPersonId: resolveOrNull(operation.sellerRef, operation),
```

#### `apps/api/src/domains/import/types.ts` (edit, 4 changed lines)

```diff
diff --git a/apps/api/src/domains/import/types.ts b/apps/api/src/domains/import/types.ts
index 59ae223..ad1f0e3 100644
--- a/apps/api/src/domains/import/types.ts
+++ b/apps/api/src/domains/import/types.ts
@@ -11,7 +11,7 @@ import type {
   ProductKind,
 } from '../sales-ops/service.js';
 import type { LeadStageInput } from '../sales-ops/leads/schemas.js';
-import type { CreateLeadInput } from '../sales-ops/leads/lead-schemas.js';
+import type { LeadWriteInput } from '../sales-ops/leads/lead-schemas.js';
 
 /** The 13 data sheets, in dependency order. `Leia-me` and `Listas` are not SheetKeys. */
 export type SheetKey =
@@ -161,7 +161,7 @@ export type ImportOperation =
   | {
       op: 'createLead';
       planKey: string;
-      input: Omit<CreateLeadInput, 'clientId' | 'sellerPersonId' | 'products'>;
+      input: Omit<LeadWriteInput, 'clientId' | 'sellerPersonId' | 'products'>;
       clientRef: EntityRef | null;
       sellerRef: EntityRef | null;
       products: Array<{ productRef: EntityRef | null; name: string }>;
```

#### `apps/api/src/domains/import/plan/leads.ts` (edit, 6 changed lines)

```diff
diff --git a/apps/api/src/domains/import/plan/leads.ts b/apps/api/src/domains/import/plan/leads.ts
index e0b6705..171ab91 100644
--- a/apps/api/src/domains/import/plan/leads.ts
+++ b/apps/api/src/domains/import/plan/leads.ts
@@ -2,7 +2,7 @@
  * Leads sheet planner. Pure and deterministic: no I/O, no clock, no env, no database.
  * A lead never creates a cliente; the executor runs createLead and then moveLead.
  */
-import { CreateLeadSchema } from '../../sales-ops/leads/lead-schemas.js';
+import { LeadWriteBaseSchema, type LeadWriteInput } from '../../sales-ops/leads/lead-schemas.js';
 import { normalizeLabel } from '../cells.js';
 import { cellReader } from '../parse.js';
 import type { ImportRefIndex } from '../refs.js';
@@ -237,7 +237,7 @@ export function planLeads(parsed: ParsedWorkbook, catalog: ImportCatalog, refs:
     }
 
     // Schema backstop (placeholder ids stand in for refs the executor resolves later)
-    let data: ReturnType<typeof CreateLeadSchema.parse> | null = null;
+    let data: LeadWriteInput | null = null;
     if (contato !== null && empresa !== null && !rowIssues.some((i) => i.severity === 'error')) {
       const candidate = {
         contactName: contato,
@@ -248,7 +248,7 @@ export function planLeads(parsed: ParsedWorkbook, catalog: ImportCatalog, refs:
         sellerPersonId: sellerRef ? PLACEHOLDER_UUID : null,
         products: products.map((p) => (p.productRef ? { productId: PLACEHOLDER_UUID } : { productName: p.name })),
       };
-      const res = CreateLeadSchema.safeParse(candidate);
+      const res = LeadWriteBaseSchema.safeParse(candidate);
       if (res.success) data = res.data;
       else {
         rowIssues.push(
```


## New test files

#### `apps/api/src/domains/sales-ops/leads/__tests__/lead-write-contract.test.ts` (new file)

Create the file with exactly this content.

```ts
/**
 * The ONE lead write contract (phase 2 cutover): `LeadWriteSchema` (create), `LeadPatchSchema`
 * (PATCH) and the import's `LeadWriteBaseSchema`. It replaces the two pre-cutover contracts
 * (`full` and `contact`); every rule the contact contract pinned is kept here.
 */
import { todayInSaoPaulo } from '@fxl-sales/shared-utils/sao-paulo-day';
import { describe, expect, it } from 'vitest';
import { LeadPatchSchema, LeadWriteBaseSchema, LeadWriteSchema } from '../lead-schemas.js';

const SOME_UUID = '11111111-1111-4111-8111-111111111111';
const withContact = { contactName: 'Ana', contactEmail: 'ana@example.com' };

describe('lead write contract', () => {
  it('accepts name plus one contact; estimatedValueBrl defaults to 0', () => {
    const result = LeadWriteSchema.parse({ contactName: '  Ana  ', contactPhone: ' 1199 ' });
    expect(result).toEqual({ contactName: 'Ana', contactPhone: '1199', estimatedValueBrl: 0 });
  });

  it('requires at least one of contactPhone and contactEmail on create', () => {
    for (const body of [
      { contactName: 'Ana' },
      { contactName: 'Ana', contactPhone: '', contactEmail: '   ' },
      { contactName: 'Ana', contactPhone: null, contactEmail: null },
    ]) {
      const parsed = LeadWriteSchema.safeParse(body);
      expect(parsed.success).toBe(false);
      if (!parsed.success) expect(parsed.error.issues[0]!.message).toBe('contactPhone or contactEmail is required');
    }
    expect(LeadWriteSchema.safeParse({ contactName: 'Ana', contactPhone: '1' }).success).toBe(true);
    expect(LeadWriteSchema.safeParse({ contactName: 'Ana', contactEmail: 'a@b.co' }).success).toBe(true);
    // The import writes through the base schema: a workbook row has no contact column.
    expect(LeadWriteBaseSchema.safeParse({ contactName: 'Ana' }).success).toBe(true);
  });

  it('accepts and normalizes every key, including empresa, valor, fields and the legacy keys', () => {
    const result = LeadWriteSchema.parse({
      contactName: 'Ana',
      contactPhone: ' (11) 98888-7777 ',
      contactEmail: ' Ana@Example.COM ',
      contactBirthDate: '1990-05-17',
      description: 'Gosta de WhatsApp',
      sellerPersonId: SOME_UUID,
      clientId: SOME_UUID,
      clientName: '  Empresa Um  ',
      estimatedValueBrl: 150000,
      pipelineId: SOME_UUID,
      stageId: SOME_UUID,
      products: [{ productName: 'Avulso' }],
      fields: [{ fieldId: SOME_UUID, value: [{ id: SOME_UUID, name: 'X' }] }, { key: 'x', value: null }],
    });
    expect(result.contactPhone).toBe('(11) 98888-7777');
    expect(result.contactEmail).toBe('ana@example.com');
    expect(result.clientName).toBe('Empresa Um');
    expect(result.fields).toHaveLength(2);
  });

  it('stores a blank optional as null', () => {
    expect(
      LeadWriteSchema.parse({
        ...withContact,
        contactPhone: '',
        contactBirthDate: '',
        description: '  ',
        sellerPersonId: '',
        clientId: '',
        clientName: ' ',
      }),
    ).toMatchObject({ contactPhone: null, contactBirthDate: null, description: null, sellerPersonId: null, clientId: null, clientName: null });
    expect(LeadPatchSchema.parse({ description: '', sellerPersonId: null })).toEqual({ description: null, sellerPersonId: null });
  });

  it('rejects an unknown key, and the move and terminal keys', () => {
    for (const extra of [{ saleId: SOME_UUID }, { lostReason: 'x' }, { position: 1 }, { orgId: 'o' }, { stageChangedAt: 'x' }]) {
      expect(LeadWriteSchema.safeParse({ ...withContact, ...extra }).success).toBe(false);
      expect(LeadPatchSchema.safeParse(extra).success).toBe(false);
    }
  });

  it('PATCH carries neither pipelineId nor stageId (a lead changes stage only by move or advance)', () => {
    expect(LeadPatchSchema.safeParse({ stageId: SOME_UUID }).success).toBe(false);
    expect(LeadPatchSchema.safeParse({ pipelineId: SOME_UUID }).success).toBe(false);
    expect(LeadPatchSchema.parse({})).toEqual({});
    expect(LeadPatchSchema.parse({ contactPhone: '' })).toEqual({ contactPhone: null });
  });

  it('rejects a bad e-mail, a long phone and an impossible or future birth day', () => {
    for (const contactEmail of ['not-an-email', 'a@', `${'a'.repeat(245)}@exemplo.com`]) {
      expect(LeadWriteSchema.safeParse({ contactName: 'Ana', contactEmail }).success).toBe(false);
    }
    expect(LeadWriteSchema.safeParse({ contactName: 'Ana', contactPhone: '9'.repeat(41) }).success).toBe(false);
    expect(LeadWriteSchema.safeParse({ contactName: 'Ana', contactPhone: '9'.repeat(40) }).success).toBe(true);
    for (const contactBirthDate of ['2026-02-30', '17/05/1990', '2999-01-01']) {
      expect(LeadWriteSchema.safeParse({ ...withContact, contactBirthDate }).success).toBe(false);
    }
    expect(LeadWriteSchema.safeParse({ ...withContact, contactBirthDate: todayInSaoPaulo() }).success).toBe(true);
  });

  it('requires contactName on create but not on update', () => {
    expect(LeadWriteSchema.safeParse({ contactEmail: 'a@b.co' }).success).toBe(false);
    expect(LeadPatchSchema.safeParse({}).success).toBe(true);
  });

  it('a fields entry needs fieldId or key, and a value of a known shape', () => {
    expect(LeadWriteSchema.safeParse({ ...withContact, fields: [{ value: 'x' }] }).success).toBe(false);
    expect(LeadWriteSchema.safeParse({ ...withContact, fields: [{ key: 'k', value: { a: 1 } }] }).success).toBe(false);
    expect(LeadWriteSchema.safeParse({ ...withContact, fields: [{ key: 'k', value: 12 }] }).success).toBe(true);
    expect(LeadWriteSchema.safeParse({ ...withContact, fields: [{ key: 'k', extra: 1, value: 1 }] }).success).toBe(false);
  });
});
```

#### `apps/api/src/domains/crm/__tests__/frozen-lead-tables.test.ts` (new file)

Create the file with exactly this content.

```ts
/**
 * The three pre-cutover lead tables are a FROZEN copy (vendas-crm-unificado slice 07a): no product
 * source file may reference their Drizzle exports or their SQL names. Only `db/schema.ts` defines
 * them (the migrations and tests need the definitions) and the dev seed script is covered by its own
 * test. A new reader or writer of these tables fails here and must go through the unified tables.
 *
 * Non-vacuous: the walker must visit a real tree and must find the definition in schema.ts.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const SRC_ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const FROZEN = /\b(salesOpsLeads|salesOpsLeadStages|salesOpsLeadProducts|sales_ops_leads|sales_ops_lead_stages|sales_ops_lead_products)\b/;
const ALLOWED = ['db/schema.ts'];

function walk(dir: string, visited: { count: number }, hits: string[]): void {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === '__tests__') continue;
      walk(path, visited, hits);
      continue;
    }
    if (!entry.isFile() || !entry.name.endsWith('.ts') || entry.name.endsWith('.test.ts')) continue;
    visited.count += 1;
    // Comments may name the tables (the cutover history); code may not.
    const code = readFileSync(path, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    if (FROZEN.test(code)) hits.push(relative(SRC_ROOT, path).split(sep).join('/'));
  }
}

describe('frozen pre-cutover lead tables', () => {
  it('no product source file references them except db/schema.ts', () => {
    const visited = { count: 0 };
    const hits: string[] = [];
    walk(SRC_ROOT, visited, hits);
    expect(visited.count).toBeGreaterThan(50);
    expect(hits).toContain('db/schema.ts');
    expect(hits.sort()).toEqual(ALLOWED);
  });
});
```

#### `apps/api/test/rls/crm-cutover-frozen-tables.test.ts` (new file)

Create the file with exactly this content.

```ts
/**
 * After the phase 2 cutover nothing writes the three pre-cutover lead tables (slice 07a).
 *
 * A legacy org keeps one etapa, one lead and one lead product in the OLD tables (the frozen copy).
 * A full flow then runs through the real services - seed on read, create etapa, reorder, create,
 * patch, move, delete, restore, the deleted list, the stage summary - and the old tables must be
 * byte-identical (row count and content hash) while the unified tables did all the work.
 *
 * Run: pnpm --filter @fxl-sales/api exec env VITEST_INTEGRATION=1 vitest run test/rls/crm-cutover-frozen-tables.test.ts
 */
import { randomUUID } from 'node:crypto';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { deleteCrmForOrgs } from '../../src/db/__tests__/settlement-test-cleanup.js';
import { testDatabaseUrls } from '../../src/db/__tests__/test-database-urls.js';
import * as schema from '../../src/db/schema.js';
import { LeadWriteBaseSchema, MoveLeadSchema, LeadPatchSchema, ListLeadsQuerySchema } from '../../src/domains/sales-ops/leads/lead-schemas.js';
import {
  createLead,
  getLead,
  listLeads,
  moveLead,
  summarizeLeadStages,
  updateLead,
  type LeadScope,
} from '../../src/domains/sales-ops/leads/lead-service.js';
import { deleteLead, listDeletedLeads, restoreLead } from '../../src/domains/sales-ops/leads/lead-trash-service.js';
import { LeadStageSchema } from '../../src/domains/sales-ops/leads/schemas.js';
import { createLeadStage, reorderLeadStages, updateLeadStage } from '../../src/domains/sales-ops/leads/stage-service.js';
import { ensureLeadStagesForOrg } from '../../src/domains/sales-ops/leads/stages-seed.js';

const { appUrl, adminUrl } = testDatabaseUrls();
const ADMIN = { connection: { 'app.fxl_admin': 'true' } } as const;
const SCOPE: LeadScope = { userId: 'hub_admin', email: null, isAdmin: true };
const ACTOR = { userId: 'hub_admin', name: 'Admin' };
const FROZEN = ['sales_ops_lead_stages', 'sales_ops_leads', 'sales_ops_lead_products'] as const;

describe('the frozen pre-cutover lead tables are never written', () => {
  const orgId = `org_frozen_${Date.now()}_${randomUUID().slice(0, 8)}`;
  let appClient: postgres.Sql;
  let adminClient: postgres.Sql;
  let db: ReturnType<typeof drizzle<typeof schema>>;

  beforeAll(async () => {
    appClient = postgres(appUrl, { max: 3 });
    adminClient = postgres(adminUrl, { max: 2, ...ADMIN });
    db = drizzle(appClient, { schema });
    await adminClient`
      INSERT INTO sales_ops_lead_stages (id, org_id, name, kind, is_system, position)
      VALUES ('11111111-1111-4111-8111-111111111111', ${orgId}, 'Etapa legada', 'normal', false, 1)`;
    await adminClient`
      INSERT INTO sales_ops_leads (id, org_id, contact_name, client_name_snapshot, stage_id)
      VALUES ('22222222-2222-4222-8222-222222222222', ${orgId}, 'Lead legado', 'Empresa', '11111111-1111-4111-8111-111111111111')`;
    await adminClient`
      INSERT INTO sales_ops_lead_products (org_id, lead_id, product_name_snapshot)
      VALUES (${orgId}, '22222222-2222-4222-8222-222222222222', 'Produto legado')`;
  });

  afterAll(async () => {
    await deleteCrmForOrgs([orgId]);
    await adminClient`DELETE FROM sales_ops_lead_products WHERE org_id = ${orgId}`;
    await adminClient`DELETE FROM sales_ops_leads WHERE org_id = ${orgId}`;
    await adminClient`DELETE FROM sales_ops_lead_stages WHERE org_id = ${orgId}`;
    await appClient.end();
    await adminClient.end();
  });

  async function fingerprint(): Promise<Record<string, { n: number; hash: string }>> {
    const out: Record<string, { n: number; hash: string }> = {};
    for (const table of FROZEN) {
      const [row] = await adminClient.unsafe<{ n: number; hash: string }[]>(
        `SELECT count(*)::int AS n, coalesce(md5(string_agg(t::text, '|' ORDER BY t::text)), '') AS hash FROM ${table} t WHERE org_id = '${orgId}'`,
      );
      out[table] = row!;
    }
    return out;
  }

  async function crmCount(table: string): Promise<number> {
    const [row] = await adminClient.unsafe<{ n: number }[]>(`SELECT count(*)::int AS n FROM ${table} WHERE org_id = '${orgId}'`);
    return row!.n;
  }

  it('runs create, patch, move, delete, restore and the etapa cadastro against the unified tables only', async () => {
    const before = await fingerprint();
    expect(before['sales_ops_leads']!.n).toBe(1);
    expect(before['sales_ops_lead_products']!.n).toBe(1);
    expect(before['sales_ops_lead_stages']!.n).toBe(1);

    const stages = await ensureLeadStagesForOrg(db, orgId);
    const novo = stages.find((s) => s.name === 'Novo')!;
    const negociacao = stages.find((s) => s.name === 'Em negociação')!;
    const created = await createLeadStage(db, orgId, LeadStageSchema.parse({ name: 'Diagnóstico' }));
    if (typeof created === 'string') throw new Error('unexpected duplicate');
    await updateLeadStage(db, orgId, created.id, { name: 'Diagnóstico 2' });
    const active = (await ensureLeadStagesForOrg(db, orgId)).filter((s) => s.status === 'active').map((s) => s.id);
    await reorderLeadStages(db, orgId, [...active].reverse());

    const a = await createLead(db, orgId, LeadWriteBaseSchema.parse({ contactName: 'Ana', contactEmail: 'a@x.com', products: [{ productName: 'Livre' }], description: 'd' }), SCOPE);
    if (!a.ok) throw new Error('create refused');
    await updateLead(db, orgId, a.lead.id, LeadPatchSchema.parse({ contactName: 'Ana 2', products: [{ productName: 'Outro' }] }), SCOPE);
    const moved = await moveLead(db, orgId, a.lead.id, MoveLeadSchema.parse({ stageId: negociacao.id, position: 0 }), SCOPE);
    expect(moved.ok).toBe(true);
    expect((await getLead(db, orgId, a.lead.id, SCOPE)).ok).toBe(true);
    await listLeads(db, orgId, ListLeadsQuerySchema.parse({ stageId: negociacao.id }), SCOPE);
    await summarizeLeadStages(db, orgId, {}, SCOPE);
    expect(await deleteLead(db, orgId, a.lead.id, SCOPE, ACTOR)).toEqual({ ok: true });
    expect((await listDeletedLeads(db, orgId, {})).items).toHaveLength(1);
    expect((await restoreLead(db, orgId, a.lead.id, true, ACTOR)).ok).toBe(true);

    expect(await fingerprint()).toEqual(before);
    expect(await crmCount('sales_ops_crm_leads')).toBe(1);
    expect(await crmCount('sales_ops_pipeline_stages')).toBe(8);
    expect(await crmCount('sales_ops_crm_lead_field_values')).toBeGreaterThan(0);
    expect(await crmCount('sales_ops_crm_lead_events')).toBe(1);
    expect(novo.id).toBeDefined();
  });
});
```

#### `apps/api/test/rls/crm-lead-write-fields.test.ts` (new file)

Create the file with exactly this content.

```ts
/**
 * The unified lead write path (vendas-crm-unificado slice 07a): typed dynamic fields, the legacy
 * keys mapped onto them, the Cliente backing column, the initial history event, the create
 * pipeline/stage rules, the patch contact rule and the transitions of a new etapa.
 *
 * Run: pnpm --filter @fxl-sales/api exec env VITEST_INTEGRATION=1 vitest run test/rls/crm-lead-write-fields.test.ts
 */
import { randomUUID } from 'node:crypto';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { deleteCrmForOrgs } from '../../src/db/__tests__/settlement-test-cleanup.js';
import { testDatabaseUrls } from '../../src/db/__tests__/test-database-urls.js';
import * as schema from '../../src/db/schema.js';
import { LeadPatchSchema, LeadWriteBaseSchema } from '../../src/domains/sales-ops/leads/lead-schemas.js';
import { LeadInputError, createLead, updateLead, type LeadScope } from '../../src/domains/sales-ops/leads/lead-service.js';
import { LeadStageSchema } from '../../src/domains/sales-ops/leads/schemas.js';
import { createLeadStage } from '../../src/domains/sales-ops/leads/stage-service.js';
import { ensureLeadStagesForOrg } from '../../src/domains/sales-ops/leads/stages-seed.js';
import { AreaSchema, ProductSchema, createArea, createClient, createProduct, ClientSchema } from '../../src/domains/sales-ops/service.js';

const { appUrl, adminUrl } = testDatabaseUrls();
const ADMIN = { connection: { 'app.fxl_admin': 'true' } } as const;
const SCOPE: LeadScope = { userId: 'hub_admin', email: 'adm@x.com', name: 'Admin Nome', isAdmin: true };

describe('unified lead write: dynamic fields and legacy keys', () => {
  const orgIds: string[] = [];
  let appClient: postgres.Sql;
  let adminClient: postgres.Sql;
  let db: ReturnType<typeof drizzle<typeof schema>>;

  beforeAll(() => {
    appClient = postgres(appUrl, { max: 3 });
    adminClient = postgres(adminUrl, { max: 2, ...ADMIN });
    db = drizzle(appClient, { schema });
  });

  afterAll(async () => {
    for (const orgId of orgIds) {
      await deleteCrmForOrgs([orgId]);
      await adminClient`DELETE FROM sales_ops_products WHERE org_id = ${orgId}`;
      await adminClient`DELETE FROM sales_ops_areas WHERE org_id = ${orgId}`;
      await adminClient`DELETE FROM sales_ops_clients WHERE org_id = ${orgId}`;
    }
    await appClient.end();
    await adminClient.end();
  });

  const newOrg = (label: string) => {
    const orgId = `org_crmw_${label}_${Date.now()}_${randomUUID().slice(0, 6)}`;
    orgIds.push(orgId);
    return orgId;
  };
  const body = (extra: Record<string, unknown> = {}) =>
    LeadWriteBaseSchema.parse({ contactName: 'Ana', contactEmail: 'ana@x.com', ...extra });
  async function ok(orgId: string, extra: Record<string, unknown> = {}) {
    const result = await createLead(db, orgId, body(extra), SCOPE);
    if (!result.ok) throw new Error(`refused: ${result.reason}`);
    return result.lead;
  }
  async function reason(promise: Promise<unknown>): Promise<{ code: string; index: number }> {
    try {
      await promise;
    } catch (error) {
      if (error instanceof LeadInputError) return { code: error.code, index: error.itemIndex };
      throw error;
    }
    throw new Error('expected a LeadInputError');
  }
  async function defineField(orgId: string, key: string, kind: string, extra: Record<string, unknown> = {}) {
    const [row] = await adminClient<{ id: string }[]>`
      INSERT INTO sales_ops_field_definitions (org_id, key, label, kind, reference_target, multiple, options, position)
      VALUES (${orgId}, ${key}, ${key}, ${kind}, ${(extra.referenceTarget as string) ?? null}, ${(extra.multiple as boolean) ?? false},
              ${extra.options ? JSON.stringify(extra.options) : null}::jsonb, 10)
      RETURNING id`;
    return row!.id;
  }

  it('stores each kind in its typed slot and reads it back on the wire', async () => {
    const orgId = newOrg('kinds');
    await ensureLeadStagesForOrg(db, orgId);
    await defineField(orgId, 'obs', 'text');
    await defineField(orgId, 'qtd', 'number');
    await defineField(orgId, 'verba', 'money');
    await defineField(orgId, 'visita', 'date');
    await defineField(orgId, 'origem', 'options', { options: [{ key: 'site', label: 'Site' }] });
    const lead = await ok(orgId, {
      fields: [
        { key: 'obs', value: 'texto' },
        { key: 'qtd', value: 2.5 },
        { key: 'verba', value: 150000 },
        { key: 'visita', value: '2026-10-20' },
        { key: 'origem', value: 'site' },
      ],
    });
    const by = Object.fromEntries(lead.fields.map((f) => [f.key, f.value]));
    expect(by).toMatchObject({ obs: 'texto', qtd: 2.5, verba: 150000, visita: '2026-10-20', origem: 'site', cliente: null });
    const [slots] = await adminClient<{ n: number }[]>`
      SELECT count(*)::int AS n FROM sales_ops_crm_lead_field_values WHERE lead_id = ${lead.id}`;
    expect(slots?.n).toBe(5);
  });

  it('null clears a field and an omitted field stays untouched', async () => {
    const orgId = newOrg('clear');
    await ensureLeadStagesForOrg(db, orgId);
    await defineField(orgId, 'obs', 'text');
    await defineField(orgId, 'qtd', 'number');
    const lead = await ok(orgId, { fields: [{ key: 'obs', value: 'a' }, { key: 'qtd', value: 1 }] });
    const patched = await updateLead(db, orgId, lead.id, LeadPatchSchema.parse({ fields: [{ key: 'obs', value: null }] }), SCOPE);
    if (!patched.ok) throw new Error('refused');
    const by = Object.fromEntries(patched.lead.fields.map((f) => [f.key, f.value]));
    expect(by).toMatchObject({ obs: null, qtd: 1 });
    const untouched = await updateLead(db, orgId, lead.id, LeadPatchSchema.parse({ contactName: 'Novo nome' }), SCOPE);
    if (!untouched.ok) throw new Error('refused');
    expect(untouched.lead.fields.find((f) => f.key === 'qtd')!.value).toBe(1);
  });

  it('refuses a bad field with the entry index: unknown, wrong shape, duplicate, single-valued with two, missing reference', async () => {
    const orgId = newOrg('invalid');
    await ensureLeadStagesForOrg(db, orgId);
    await defineField(orgId, 'qtd', 'number');
    await defineField(orgId, 'origem', 'options', { options: [{ key: 'site', label: 'Site' }] });
    await defineField(orgId, 'item', 'reference', { referenceTarget: 'produto', multiple: false });
    const attempt = (fields: unknown[]) => reason(createLead(db, orgId, body({ fields }), SCOPE));
    expect(await attempt([{ key: 'nope', value: 'x' }])).toEqual({ code: 'field_not_found', index: 0 });
    expect(await attempt([{ key: 'qtd', value: 1 }, { key: 'qtd', value: 2 }])).toEqual({ code: 'field_invalid', index: 1 });
    expect(await attempt([{ key: 'qtd', value: 'abc' }])).toEqual({ code: 'field_invalid', index: 0 });
    expect(await attempt([{ key: 'origem', value: 'telefone' }])).toEqual({ code: 'field_invalid', index: 0 });
    expect(await attempt([{ key: 'item', value: [{ name: 'a' }, { name: 'b' }] }])).toEqual({ code: 'field_invalid', index: 0 });
    expect(await attempt([{ key: 'item', value: [{ id: randomUUID() }] }])).toEqual({ code: 'field_reference_not_found', index: 0 });
    const [count] = await adminClient<{ n: number }[]>`SELECT count(*)::int AS n FROM sales_ops_crm_leads WHERE org_id = ${orgId}`;
    expect(count?.n).toBe(0);
  });

  it('Cliente is the backing column: a cliente entry sets client_id and the snapshot; naming clientId too is refused', async () => {
    const orgId = newOrg('cliente');
    await ensureLeadStagesForOrg(db, orgId);
    const cliente = await createClient(db, orgId, ClientSchema.parse({ name: 'Empresa Real' }));
    const lead = await ok(orgId, { fields: [{ key: 'cliente', value: [{ id: cliente.id }] }] });
    expect(lead.clientId).toBe(cliente.id);
    expect(lead.clientNameSnapshot).toBe('Empresa Real');
    expect(lead.fields.find((f) => f.key === 'cliente')!.value).toEqual([{ id: cliente.id, name: 'Empresa Real' }]);
    const [stored] = await adminClient<{ n: number }[]>`
      SELECT count(*)::int AS n FROM sales_ops_crm_lead_field_values WHERE lead_id = ${lead.id}`;
    expect(stored?.n).toBe(0);
    expect(await reason(createLead(db, orgId, body({ clientId: cliente.id, fields: [{ key: 'cliente', value: [{ id: cliente.id }] }] }), SCOPE))).toEqual({
      code: 'field_invalid',
      index: 0,
    });
    const cleared = await updateLead(db, orgId, lead.id, LeadPatchSchema.parse({ fields: [{ key: 'cliente', value: null }] }), SCOPE);
    if (!cleared.ok) throw new Error('refused');
    expect(cleared.lead.clientId).toBeNull();
    expect(cleared.lead.clientNameSnapshot).toBe('Empresa Real');
  });

  it('maps description, contactBirthDate and products onto descricao, nascimento and produtos (definitions created on first use)', async () => {
    const orgId = newOrg('legacy');
    await ensureLeadStagesForOrg(db, orgId);
    const area = await createArea(db, orgId, AreaSchema.parse({ name: 'Tech' }));
    if (area === 'duplicate') throw new Error('dup');
    const { product } = await createProduct(db, orgId, ProductSchema.parse({ name: 'Sistema', areaId: area.id }));
    const lead = await ok(orgId, {
      description: 'obs',
      contactBirthDate: '1990-01-02',
      products: [{ productId: product.id }, { productName: 'Avulso' }],
    });
    expect(lead).toMatchObject({ description: 'obs', contactBirthDate: '1990-01-02' });
    expect(lead.products).toEqual([
      { productId: null, productNameSnapshot: 'Avulso' },
      { productId: product.id, productNameSnapshot: 'Sistema' },
    ]);
    const defs = await adminClient<{ key: string; kind: string; position: number; multiple: boolean }[]>`
      SELECT key, kind, position, multiple FROM sales_ops_field_definitions WHERE org_id = ${orgId} ORDER BY position`;
    expect(defs).toEqual([
      { key: 'cliente', kind: 'reference', position: 1, multiple: false },
      { key: 'produtos', kind: 'reference', position: 2, multiple: true },
      { key: 'descricao', kind: 'text', position: 3, multiple: false },
      { key: 'nascimento', kind: 'date', position: 4, multiple: false },
    ]);
    const cleared = await updateLead(db, orgId, lead.id, LeadPatchSchema.parse({ description: '', contactBirthDate: null, products: [] }), SCOPE);
    if (!cleared.ok) throw new Error('refused');
    expect(cleared.lead).toMatchObject({ description: null, contactBirthDate: null, products: [] });
  });

  it('a missing produto in the legacy products array is product_not_found with the row index', async () => {
    const orgId = newOrg('prodmissing');
    await ensureLeadStagesForOrg(db, orgId);
    expect(await reason(createLead(db, orgId, body({ products: [{ productName: 'ok' }, { productId: randomUUID() }] }), SCOPE))).toEqual({
      code: 'product_not_found',
      index: 1,
    });
  });

  it('writes exactly one initial history event on create, by the server, with the actor name; a patch writes none', async () => {
    const orgId = newOrg('event');
    const stages = await ensureLeadStagesForOrg(db, orgId);
    const lead = await ok(orgId);
    await updateLead(db, orgId, lead.id, LeadPatchSchema.parse({ contactName: 'Outro' }), SCOPE);
    const events = await adminClient<{ kind: string; from_stage_id: string | null; to_stage_id: string; actor_user_id: string; actor_name_snapshot: string }[]>`
      SELECT kind, from_stage_id, to_stage_id, actor_user_id, actor_name_snapshot FROM sales_ops_crm_lead_events WHERE lead_id = ${lead.id}`;
    expect(events).toEqual([
      { kind: 'stage_changed', from_stage_id: null, to_stage_id: stages.find((s) => s.name === 'Novo')!.id, actor_user_id: 'hub_admin', actor_name_snapshot: 'Admin Nome' },
    ]);
  });

  it('a create names a pipeline and an open stage; an exit stage, another pipeline or an unknown pipeline are refused', async () => {
    const orgId = newOrg('createstage');
    const stages = await ensureLeadStagesForOrg(db, orgId);
    const second = stages.find((s) => s.name === 'Qualificação')!;
    const lead = await ok(orgId, { pipelineId: second.pipelineId, stageId: second.id });
    expect(lead.stageId).toBe(second.id);
    expect(lead.pipelineId).toBe(second.pipelineId);
    expect(lead.stageType).toBe('normal');
    expect(lead.stageExitKind).toBeNull();
    const ganho = stages.find((s) => s.name === 'Ganho')!;
    expect((await reason(createLead(db, orgId, body({ stageId: ganho.id }), SCOPE))).code).toBe('stage_not_open');
    expect((await reason(createLead(db, orgId, body({ pipelineId: randomUUID() }), SCOPE))).code).toBe('pipeline_not_found');
    const [other] = await adminClient<{ id: string }[]>`
      INSERT INTO sales_ops_pipelines (org_id, name, position) VALUES (${orgId}, 'Carteira', 1) RETURNING id`;
    expect((await reason(createLead(db, orgId, body({ pipelineId: other!.id, stageId: second.id }), SCOPE))).code).toBe('stage_not_found');
  });

  it('a PATCH that would leave no phone and no e-mail is contact_required, and writes nothing', async () => {
    const orgId = newOrg('contact');
    await ensureLeadStagesForOrg(db, orgId);
    const lead = await ok(orgId, { contactPhone: '119' });
    expect((await reason(updateLead(db, orgId, lead.id, LeadPatchSchema.parse({ contactPhone: '', contactEmail: '' }), SCOPE))).code).toBe('contact_required');
    const ok2 = await updateLead(db, orgId, lead.id, LeadPatchSchema.parse({ contactPhone: '' }), SCOPE);
    if (!ok2.ok) throw new Error('refused');
    expect(ok2.lead.contactPhone).toBeNull();
    expect(ok2.lead.contactEmail).toBe('ana@x.com');
  });

  it('a new etapa gets the transitions the shared rule gives it, and no other pair changes', async () => {
    const orgId = newOrg('transitions');
    const stages = await ensureLeadStagesForOrg(db, orgId);
    const [{ n: before } = { n: 0 }] = await adminClient<{ n: number }[]>`SELECT count(*)::int AS n FROM sales_ops_pipeline_transitions WHERE org_id = ${orgId}`;
    expect(before).toBe(22);
    const created = await createLeadStage(db, orgId, LeadStageSchema.parse({ name: 'Diagnóstico' }));
    if (typeof created === 'string') throw new Error('dup');
    const pairs = await adminClient<{ from_stage_id: string; to_stage_id: string }[]>`
      SELECT from_stage_id, to_stage_id FROM sales_ops_pipeline_transitions
       WHERE org_id = ${orgId} AND (from_stage_id = ${created.id} OR to_stage_id = ${created.id})`;
    const byName = (id: string) => stages.find((s) => s.id === id)?.name ?? 'Diagnóstico';
    const label = pairs.map((p) => `${byName(p.from_stage_id)}>${byName(p.to_stage_id)}`).sort();
    // The new stage is the last open one by position (after the exits): previous open is Proposta.
    expect(label).toEqual(
      ['Proposta>Diagnóstico', 'Diagnóstico>Proposta', 'Diagnóstico>Ganho', 'Diagnóstico>Perdido', 'Diagnóstico>Pausado', 'Pausado>Diagnóstico'].sort(),
    );
    const [{ n: after } = { n: 0 }] = await adminClient<{ n: number }[]>`SELECT count(*)::int AS n FROM sales_ops_pipeline_transitions WHERE org_id = ${orgId}`;
    expect(after).toBe(22 + 6);
  });
});
```


## Edited existing tests (diffs)

#### `apps/api/src/domains/crm/__tests__/crm-seed-callers.test.ts` (edit, 2 changed lines)

```diff
diff --git a/apps/api/src/domains/crm/__tests__/crm-seed-callers.test.ts b/apps/api/src/domains/crm/__tests__/crm-seed-callers.test.ts
index 298684e..4e8d5b5 100644
--- a/apps/api/src/domains/crm/__tests__/crm-seed-callers.test.ts
+++ b/apps/api/src/domains/crm/__tests__/crm-seed-callers.test.ts
@@ -16,7 +16,7 @@ import { describe, expect, it } from 'vitest';
 
 const SRC_ROOT = fileURLToPath(new URL('../../../', import.meta.url));
 const SEED_CALL = /\bensure(DefaultPipeline|SystemFieldDefinitions|CrmDefaults|CrmDefaultsForOrg)\s*\(/;
-const ALLOWED_CALLERS = ['domains/crm/defaults.ts'];
+const ALLOWED_CALLERS = ['domains/crm/defaults.ts', 'domains/sales-ops/leads/stages-seed.ts'];
 
 function walk(dir: string, visited: { count: number }, hits: string[]): void {
   for (const entry of readdirSync(dir, { withFileTypes: true })) {
```

#### `apps/api/src/domains/sales-ops/__tests__/lead-stages-routes.test.ts` (edit, 32 changed lines)

```diff
diff --git a/apps/api/src/domains/sales-ops/__tests__/lead-stages-routes.test.ts b/apps/api/src/domains/sales-ops/__tests__/lead-stages-routes.test.ts
index 00a95c1..786df13 100644
--- a/apps/api/src/domains/sales-ops/__tests__/lead-stages-routes.test.ts
+++ b/apps/api/src/domains/sales-ops/__tests__/lead-stages-routes.test.ts
@@ -5,9 +5,9 @@ import { hubAuthContext as sharedHubAuthContext } from '../../../auth/__tests__/
 const mockedDb = { name: 'lead-stage-route-test-db' };
 const serviceMocks = vi.hoisted(() => ({
   listLeadStages: vi.fn(),
-  createLeadStage: vi.fn(),
+  createLeadStageInPipeline: vi.fn(),
   updateLeadStage: vi.fn(),
-  reorderLeadStages: vi.fn(),
+  reorderLeadStagesInPipeline: vi.fn(),
 }));
 
 vi.mock('../../../db/client.js', () => ({
@@ -19,9 +19,9 @@ vi.mock('../leads/stage-service.js', async (importOriginal) => {
   return {
     ...actual,
     listLeadStages: serviceMocks.listLeadStages,
-    createLeadStage: serviceMocks.createLeadStage,
+    createLeadStageInPipeline: serviceMocks.createLeadStageInPipeline,
     updateLeadStage: serviceMocks.updateLeadStage,
-    reorderLeadStages: serviceMocks.reorderLeadStages,
+    reorderLeadStagesInPipeline: serviceMocks.reorderLeadStagesInPipeline,
   };
 });
 
@@ -81,9 +81,9 @@ describe('Sales Ops lead stage routes', () => {
     currentRole = 'admin';
     for (const mock of Object.values(serviceMocks)) mock.mockReset();
     serviceMocks.listLeadStages.mockResolvedValue([stageResult]);
-    serviceMocks.createLeadStage.mockResolvedValue(stageResult);
+    serviceMocks.createLeadStageInPipeline.mockResolvedValue(stageResult);
     serviceMocks.updateLeadStage.mockResolvedValue(stageResult);
-    serviceMocks.reorderLeadStages.mockResolvedValue([stageResult]);
+    serviceMocks.reorderLeadStagesInPipeline.mockResolvedValue([stageResult]);
   });
 
   // The Kanban board and every stage picker need the list, and a seller has a
@@ -93,7 +93,7 @@ describe('Sales Ops lead stage routes', () => {
     const response = await app.request('/lead-stages');
     expect(response.status).toBe(200);
     expect(await response.json()).toEqual({ stages: [stageResult] });
-    expect(serviceMocks.listLeadStages).toHaveBeenCalledWith(mockedDb, 'verified-org');
+    expect(serviceMocks.listLeadStages).toHaveBeenCalledWith(mockedDb, 'verified-org', undefined);
   });
 
   it.each(['seller', 'finder', undefined] as const)(
@@ -105,7 +105,7 @@ describe('Sales Ops lead stage routes', () => {
       expect(await response.json()).toEqual({ error: 'forbidden', reason: 'admin_role_required' });
       // The "never called" half is what makes this decisive rather than
       // incidental - a 403 could otherwise come from anywhere.
-      expect(serviceMocks.createLeadStage).not.toHaveBeenCalled();
+      expect(serviceMocks.createLeadStageInPipeline).not.toHaveBeenCalled();
     },
   );
 
@@ -129,7 +129,7 @@ describe('Sales Ops lead stage routes', () => {
       });
       expect(response.status).toBe(403);
       expect(await response.json()).toEqual({ error: 'forbidden', reason: 'admin_role_required' });
-      expect(serviceMocks.reorderLeadStages).not.toHaveBeenCalled();
+      expect(serviceMocks.reorderLeadStagesInPipeline).not.toHaveBeenCalled();
     },
   );
 
@@ -145,7 +145,7 @@ describe('Sales Ops lead stage routes', () => {
     expect(await response.json()).toEqual({ stage: stageResult });
     // A LITERAL third argument, not expect.objectContaining: that is what makes
     // this decisive against `{ ...parsed.data, ...body }`.
-    expect(serviceMocks.createLeadStage).toHaveBeenCalledWith(mockedDb, 'verified-org', {
+    expect(serviceMocks.createLeadStageInPipeline).toHaveBeenCalledWith(mockedDb, 'verified-org', {
       name: 'Qualificação',
       status: 'active',
     });
@@ -159,7 +159,7 @@ describe('Sales Ops lead stage routes', () => {
   });
 
   it('maps a duplicate stage name to 409 stage_name_taken', async () => {
-    serviceMocks.createLeadStage.mockResolvedValue('duplicate');
+    serviceMocks.createLeadStageInPipeline.mockResolvedValue('duplicate');
     const created = await jsonRequest('POST', '/lead-stages', { name: 'Novo' });
     expect(created.status).toBe(409);
     // toEqual on the WHOLE body is what says there is no second conflict reason
@@ -180,7 +180,7 @@ describe('Sales Ops lead stage routes', () => {
   });
 
   it('maps a reorder set mismatch to 400 validation_error stage_set_mismatch', async () => {
-    serviceMocks.reorderLeadStages.mockResolvedValue('set_mismatch');
+    serviceMocks.reorderLeadStagesInPipeline.mockResolvedValue('set_mismatch');
     const response = await jsonRequest('POST', '/lead-stages/reorder', { stageIds: [STAGE_ID] });
     expect(response.status).toBe(400);
     expect(await response.json()).toEqual({
@@ -196,10 +196,10 @@ describe('Sales Ops lead stage routes', () => {
     });
     expect(response.status).toBe(200);
     expect(await response.json()).toEqual({ stages: [stageResult] });
-    expect(serviceMocks.reorderLeadStages).toHaveBeenCalledWith(mockedDb, 'verified-org', [
+    expect(serviceMocks.reorderLeadStagesInPipeline).toHaveBeenCalledWith(mockedDb, 'verified-org', [
       OTHER_STAGE_ID,
       STAGE_ID,
-    ]);
+    ], undefined);
   });
 
   it('archives a lead stage through PATCH rather than a DELETE verb', async () => {
@@ -221,7 +221,7 @@ describe('Sales Ops lead stage routes', () => {
     const response = await jsonRequest('POST', '/lead-stages', { name: '   ' });
     expect(response.status).toBe(400);
     expect((await response.json()).error).toBe('validation_error');
-    expect(serviceMocks.createLeadStage).not.toHaveBeenCalled();
+    expect(serviceMocks.createLeadStageInPipeline).not.toHaveBeenCalled();
   });
 
   it('rejects a missing lead stage body with 400 rather than 500', async () => {
@@ -230,6 +230,6 @@ describe('Sales Ops lead stage routes', () => {
       headers: { 'content-type': 'application/json' },
     });
     expect(response.status).toBe(400);
-    expect(serviceMocks.createLeadStage).not.toHaveBeenCalled();
+    expect(serviceMocks.createLeadStageInPipeline).not.toHaveBeenCalled();
   });
 });
```

#### `apps/api/src/domains/sales-ops/leads/__tests__/lead-contract.test.ts` (edit, 42 changed lines)

```diff
diff --git a/apps/api/src/domains/sales-ops/leads/__tests__/lead-contract.test.ts b/apps/api/src/domains/sales-ops/leads/__tests__/lead-contract.test.ts
index 9a2cc28..6d4b78a 100644
--- a/apps/api/src/domains/sales-ops/leads/__tests__/lead-contract.test.ts
+++ b/apps/api/src/domains/sales-ops/leads/__tests__/lead-contract.test.ts
@@ -15,13 +15,13 @@ import { fileURLToPath } from 'node:url';
 import { describe, expect, it } from 'vitest';
 import { AuditActionSchema, CADASTRO_LIFECYCLE_ACTIONS, CadastroEntityTypeSchema } from '../../../audit/service.js';
 import {
-  CreateLeadSchema,
+  LeadPatchSchema,
+  LeadWriteSchema,
   LEADS_DEFAULT_LIMIT,
   LEADS_MAX_LIMIT,
   ListDeletedLeadsQuerySchema,
   ListLeadsQuerySchema,
   MoveLeadSchema,
-  UpdateLeadSchema,
 } from '../lead-schemas.js';
 
 const leadServiceSource = readFileSync(
@@ -51,7 +51,7 @@ describe('lead wire contract', () => {
       { lostReason: 'sem orçamento' },
       { stageChangedAt: new Date().toISOString() },
     ]) {
-      const parsed = UpdateLeadSchema.safeParse({ contactName: 'Ana', ...forbidden });
+      const parsed = LeadPatchSchema.safeParse({ contactName: 'Ana', ...forbidden });
       expect(parsed.success).toBe(false);
       if (parsed.success) continue;
       // zod reports an unrecognized key as ONE form-level issue naming the key,
@@ -62,20 +62,19 @@ describe('lead wire contract', () => {
     }
 
     // The keys it DOES declare still go through.
-    expect(UpdateLeadSchema.safeParse({ contactName: 'Ana' }).success).toBe(true);
-    expect(UpdateLeadSchema.safeParse({}).success).toBe(true);
+    expect(LeadPatchSchema.safeParse({ contactName: 'Ana' }).success).toBe(true);
+    expect(LeadPatchSchema.safeParse({}).success).toBe(true);
   });
 
-  // A lead that is born converted or born lost is not expressible, rather than
-  // merely rejected downstream: a new lead always lands in the first active
-  // normal stage.
-  it('rejects a create body carrying stageId or saleId', () => {
-    const base = { contactName: 'Ana', clientName: 'Empresa Um' };
-    expect(CreateLeadSchema.safeParse(base).success).toBe(true);
-    expect(CreateLeadSchema.safeParse({ ...base, stageId: STAGE_ID }).success).toBe(false);
-    expect(CreateLeadSchema.safeParse({ ...base, saleId: SALE_ID }).success).toBe(false);
-    expect(CreateLeadSchema.safeParse({ ...base, orgId: 'org_smuggled' }).success).toBe(false);
-    expect(CreateLeadSchema.safeParse({ ...base, position: 0 }).success).toBe(false);
+  // A lead that is born converted or born lost is not expressible. The create body MAY name a
+  // pipeline and an open stage now (phase 2), but never a sale, a position or an org.
+  it('rejects a create body carrying saleId, position or orgId, and accepts pipelineId and stageId', () => {
+    const base = { contactName: 'Ana', contactEmail: 'ana@example.com' };
+    expect(LeadWriteSchema.safeParse(base).success).toBe(true);
+    expect(LeadWriteSchema.safeParse({ ...base, stageId: STAGE_ID, pipelineId: SALE_ID }).success).toBe(true);
+    expect(LeadWriteSchema.safeParse({ ...base, saleId: SALE_ID }).success).toBe(false);
+    expect(LeadWriteSchema.safeParse({ ...base, orgId: 'org_smuggled' }).success).toBe(false);
+    expect(LeadWriteSchema.safeParse({ ...base, position: 0 }).success).toBe(false);
   });
 
   it('rejects a cursor that is not <position>:<uuid>', () => {
@@ -123,12 +122,12 @@ describe('lead wire contract', () => {
   });
 
   it('requires a productName on a lead product row that names no produto', () => {
-    const base = { contactName: 'Ana', clientName: 'Empresa Um' };
-    expect(CreateLeadSchema.safeParse({ ...base, products: [{}] }).success).toBe(false);
+    const base = { contactName: 'Ana', contactPhone: '1199' };
+    expect(LeadWriteSchema.safeParse({ ...base, products: [{}] }).success).toBe(false);
     expect(
-      CreateLeadSchema.safeParse({ ...base, products: [{ productName: 'Algo avulso' }] }).success,
+      LeadWriteSchema.safeParse({ ...base, products: [{ productName: 'Algo avulso' }] }).success,
     ).toBe(true);
-    expect(CreateLeadSchema.safeParse({ ...base, products: [{ productId: SALE_ID }] }).success).toBe(
+    expect(LeadWriteSchema.safeParse({ ...base, products: [{ productId: SALE_ID }] }).success).toBe(
       true,
     );
   });
@@ -154,6 +153,8 @@ describe('lead wire contract', () => {
   // a cliente. The import ban is what makes that visible at a glance.
   it('lead-service.ts imports neither sales_ops_clients nor sales_ops_sales as a writer', () => {
     expect(leadServiceSource).not.toMatch(/salesOpsClients/);
+    // Cutover: the old lead tables are never touched by the lead service.
+    expect(leadServiceSource).not.toMatch(/salesOpsLeads\b|salesOpsLeadStages|salesOpsLeadProducts/);
     expect(leadServiceSource).not.toMatch(/insert\(salesOpsSales\)/);
     expect(leadServiceSource).not.toMatch(/getSalesOpsSnapshot|getSalesOpsSummary|computeSaleFinancials/);
   });
@@ -189,7 +190,7 @@ describe('lead wire contract', () => {
   });
 
   it('spells the live predicate once, in lead-service.ts', () => {
-    expect(leadServiceSource.match(/isNull\(salesOpsLeads\.deletedAt\)/g)).toHaveLength(1);
+    expect(leadServiceSource.match(/isNull\(salesOpsCrmLeads\.deletedAt\)/g)).toHaveLength(1);
     expect(leadServiceSource).toMatch(/export function liveLeadCondition\(\): SQL/);
     expect(leadServiceSource).not.toMatch(/from '\.\/lead-trash-service\.js'/);
   });
@@ -200,6 +201,7 @@ describe('lead wire contract', () => {
     expect(leadTrashServiceSource).not.toMatch(/getAdminDb/);
     expect(leadTrashServiceSource).not.toMatch(/claimantFor/);
     expect(leadTrashServiceSource).not.toMatch(/ensureLeadStages/);
+    expect(leadTrashServiceSource).not.toMatch(/salesOpsLeads\b|salesOpsLeadStages|salesOpsLeadProducts/);
   });
 
   it('adds the two lead actions without touching the cadastro lifecycle', () => {
```

#### `apps/api/src/domains/sales-ops/leads/__tests__/lead-routes-edition.test.ts` (edit, 169 changed lines)

```diff
diff --git a/apps/api/src/domains/sales-ops/leads/__tests__/lead-routes-edition.test.ts b/apps/api/src/domains/sales-ops/leads/__tests__/lead-routes-edition.test.ts
index 518fb08..6295201 100644
--- a/apps/api/src/domains/sales-ops/leads/__tests__/lead-routes-edition.test.ts
+++ b/apps/api/src/domains/sales-ops/leads/__tests__/lead-routes-edition.test.ts
@@ -1,11 +1,10 @@
 /**
- * The lead HTTP boundary per edition (edicao-leads).
+ * The lead HTTP boundary per edition (phase 2 cutover).
  *
- * Same harness as `lead-routes.test.ts`, plus one Context variable: the
- * `salesEdition` the auth middleware resolves from the VERIFIED token. The
- * leads edition must reach the contact-only service functions through the
- * contact schemas; the full edition, and an absent edition, must reach today's
- * functions through today's schemas and refuse the contact keys.
+ * Same harness as `lead-routes.test.ts`, plus one Context variable: the `salesEdition` the auth
+ * middleware resolves from the VERIFIED token. The edition no longer picks a wire schema: BOTH
+ * editions (and an absent edition) reach `createLead` / `updateLead` through the one
+ * `LeadWriteSchema`. The edition only travels inside the scope object.
  */
 import { Hono } from 'hono';
 import { beforeEach, describe, expect, it, vi } from 'vitest';
@@ -15,9 +14,7 @@ import { LeadInputError } from '../lead-service.js';
 const mockedDb = { name: 'lead-route-edition-test-db' };
 const serviceMocks = vi.hoisted(() => ({
   createLead: vi.fn(),
-  createContactLead: vi.fn(),
   updateLead: vi.fn(),
-  updateContactLead: vi.fn(),
 }));
 
 vi.mock('../../../../db/client.js', () => ({
@@ -98,7 +95,6 @@ function jsonRequest(method: 'POST' | 'PATCH', path: string, body: unknown) {
 
 function expectNoCreate() {
   expect(serviceMocks.createLead).not.toHaveBeenCalled();
-  expect(serviceMocks.createContactLead).not.toHaveBeenCalled();
 }
 
 describe('Sales Ops lead routes per sales edition', () => {
@@ -112,14 +108,14 @@ describe('Sales Ops lead routes per sales edition', () => {
     }
   });
 
-  it('leads: creates a contact lead through createContactLead', async () => {
-    const response = await jsonRequest('POST', '/leads', { contactName: 'Ana' });
+  it('leads: creates a lead through createLead with the edition in the scope', async () => {
+    const response = await jsonRequest('POST', '/leads', { contactName: 'Ana', contactPhone: '1199' });
     expect(response.status).toBe(201);
-    expect(serviceMocks.createContactLead).toHaveBeenCalledTimes(1);
-    expect(serviceMocks.createContactLead.mock.calls[0]).toEqual([
+    expect(serviceMocks.createLead).toHaveBeenCalledTimes(1);
+    expect(serviceMocks.createLead.mock.calls[0]).toEqual([
       mockedDb,
       'verified-org',
-      { contactName: 'Ana', estimatedValueBrl: 0 },
+      { contactName: 'Ana', contactPhone: '1199', estimatedValueBrl: 0 },
       {
         userId: 'verified-account',
         email: TOKEN_EMAIL,
@@ -129,38 +125,41 @@ describe('Sales Ops lead routes per sales edition', () => {
         edition: 'leads',
       },
     ]);
-    expect(serviceMocks.createLead).not.toHaveBeenCalled();
   });
 
-  it('leads: accepts an empresa and a valor on create, still refuses produtos', async () => {
-    const ok = await jsonRequest('POST', '/leads', {
-      contactName: 'Ana',
-      clientName: 'Empresa',
-      estimatedValueBrl: 250000,
-    });
-    expect(ok.status).toBe(201);
-    expect(serviceMocks.createContactLead).toHaveBeenCalledTimes(1);
-    expect(serviceMocks.createContactLead.mock.calls[0]![2]).toMatchObject({
-      contactName: 'Ana',
-      clientName: 'Empresa',
-      estimatedValueBrl: 250000,
-    });
+  it('both editions accept an empresa, a valor and produtos on create', async () => {
+    for (const edition of ['leads', 'full'] as const) {
+      currentEdition = edition;
+      serviceMocks.createLead.mockClear();
+      const ok = await jsonRequest('POST', '/leads', {
+        contactName: 'Ana',
+        contactEmail: 'a@b.co',
+        clientName: 'Empresa',
+        estimatedValueBrl: 250000,
+        products: [{ productName: 'Avulso' }],
+      });
+      expect(ok.status).toBe(201);
+      expect(serviceMocks.createLead.mock.calls[0]![2]).toMatchObject({
+        contactName: 'Ana',
+        clientName: 'Empresa',
+        estimatedValueBrl: 250000,
+      });
+    }
+  });
 
-    serviceMocks.createContactLead.mockClear();
-    const withProducts = await jsonRequest('POST', '/leads', {
-      contactName: 'Ana',
-      products: [],
-    });
-    expect(withProducts.status).toBe(400);
-    expect((await withProducts.json()) as { error: string }).toMatchObject({
-      error: 'validation_error',
-    });
-    expect(serviceMocks.createContactLead).not.toHaveBeenCalled();
+  it('a create without any contact is a 400 in both editions and reaches no service', async () => {
+    for (const edition of ['leads', 'full', undefined] as const) {
+      currentEdition = edition;
+      const response = await jsonRequest('POST', '/leads', { contactName: 'Ana', clientName: 'Empresa Um' });
+      expect(response.status).toBe(400);
+    }
+    expectNoCreate();
   });
 
-  it('leads: refuses a future birth day and a bad e-mail', async () => {
+  it('refuses a future birth day and a bad e-mail', async () => {
     const future = await jsonRequest('POST', '/leads', {
       contactName: 'Ana',
+      contactPhone: '1',
       contactBirthDate: '2999-01-01',
     });
     expect(future.status).toBe(400);
@@ -172,9 +171,9 @@ describe('Sales Ops lead routes per sales edition', () => {
     expectNoCreate();
   });
 
-  it('leads: answers the existing no_open_stage refusal when there is no etapa', async () => {
-    serviceMocks.createContactLead.mockRejectedValueOnce(new LeadInputError('no_open_stage'));
-    const response = await jsonRequest('POST', '/leads', { contactName: 'Ana' });
+  it('answers the existing no_open_stage refusal when there is no etapa', async () => {
+    serviceMocks.createLead.mockRejectedValueOnce(new LeadInputError('no_open_stage'));
+    const response = await jsonRequest('POST', '/leads', { contactName: 'Ana', contactPhone: '1' });
     expect(response.status).toBe(400);
     expect(await response.json()).toEqual({
       error: 'validation_error',
@@ -183,68 +182,51 @@ describe('Sales Ops lead routes per sales edition', () => {
     });
   });
 
-  it('leads: a PATCH clears a contact field through updateContactLead', async () => {
-    const response = await jsonRequest('PATCH', `/leads/${LEAD_ID}`, { contactPhone: '' });
-    expect(response.status).toBe(200);
-    expect(serviceMocks.updateContactLead).toHaveBeenCalledTimes(1);
-    expect(serviceMocks.updateContactLead.mock.calls[0]![2]).toBe(LEAD_ID);
-    expect(serviceMocks.updateContactLead.mock.calls[0]![3]).toEqual({ contactPhone: null });
-    expect(serviceMocks.updateLead).not.toHaveBeenCalled();
+  it('maps the new field errors onto the same 400 body with the entry index', async () => {
+    serviceMocks.createLead.mockRejectedValueOnce(new LeadInputError('field_invalid', 2));
+    const response = await jsonRequest('POST', '/leads', { contactName: 'Ana', contactPhone: '1' });
+    expect(await response.json()).toEqual({ error: 'validation_error', reason: 'field_invalid', itemIndex: 2 });
   });
 
-  it('leads: a PATCH updates the value through updateContactLead', async () => {
-    const response = await jsonRequest('PATCH', `/leads/${LEAD_ID}`, { estimatedValueBrl: 100 });
-    expect(response.status).toBe(200);
-    expect(serviceMocks.updateContactLead).toHaveBeenCalledTimes(1);
-    expect(serviceMocks.updateContactLead.mock.calls[0]![3]).toEqual({ estimatedValueBrl: 100 });
-    expect(serviceMocks.updateLead).not.toHaveBeenCalled();
-  });
-
-  it('full: refuses the contact keys and creates through createLead', async () => {
-    currentEdition = 'full';
-    const smuggled = await jsonRequest('POST', '/leads', {
-      contactName: 'Ana',
-      clientName: 'Empresa Um',
-      contactPhone: '11',
-    });
-    expect(smuggled.status).toBe(400);
-    expectNoCreate();
-
-    const response = await jsonRequest('POST', '/leads', {
-      contactName: 'Ana',
-      clientName: 'Empresa Um',
-    });
-    expect(response.status).toBe(201);
-    expect(serviceMocks.createLead).toHaveBeenCalledTimes(1);
-    expect(serviceMocks.createContactLead).not.toHaveBeenCalled();
+  it('a PATCH clears a contact field through updateLead, in both editions', async () => {
+    for (const edition of ['leads', 'full'] as const) {
+      currentEdition = edition;
+      serviceMocks.updateLead.mockClear();
+      const response = await jsonRequest('PATCH', `/leads/${LEAD_ID}`, { contactPhone: '' });
+      expect(response.status).toBe(200);
+      expect(serviceMocks.updateLead).toHaveBeenCalledTimes(1);
+      expect(serviceMocks.updateLead.mock.calls[0]![2]).toBe(LEAD_ID);
+      expect(serviceMocks.updateLead.mock.calls[0]![3]).toEqual({ contactPhone: null });
+    }
   });
 
-  it('full: a PATCH refuses a contact key', async () => {
-    currentEdition = 'full';
-    const response = await jsonRequest('PATCH', `/leads/${LEAD_ID}`, { contactEmail: 'a@b.co' });
-    expect(response.status).toBe(400);
-    expect(serviceMocks.updateLead).not.toHaveBeenCalled();
-    expect(serviceMocks.updateContactLead).not.toHaveBeenCalled();
+  it('a PATCH updates the value through updateLead and refuses stage keys', async () => {
+    const response = await jsonRequest('PATCH', `/leads/${LEAD_ID}`, { estimatedValueBrl: 100 });
+    expect(response.status).toBe(200);
+    expect(serviceMocks.updateLead.mock.calls[0]![3]).toEqual({ estimatedValueBrl: 100 });
+    const stage = await jsonRequest('PATCH', `/leads/${LEAD_ID}`, { stageId: STAGE_ID });
+    expect(stage.status).toBe(400);
+    expect(serviceMocks.updateLead).toHaveBeenCalledTimes(1);
   });
 
-  it('absent edition means full', async () => {
+  it('absent edition means full in the scope', async () => {
     currentEdition = undefined;
     const response = await jsonRequest('POST', '/leads', {
       contactName: 'Ana',
+      contactPhone: '1',
       clientName: 'Empresa Um',
     });
     expect(response.status).toBe(201);
-    expect(serviceMocks.createLead).toHaveBeenCalledTimes(1);
-    expect(serviceMocks.createContactLead).not.toHaveBeenCalled();
+    expect(serviceMocks.createLead.mock.calls[0]![3]).toMatchObject({ edition: 'full' });
   });
 
-  it('leads: passes the seller scope refusal through unchanged', async () => {
+  it('passes the seller scope refusal through unchanged', async () => {
     currentRoles = ['seller'];
-    serviceMocks.createContactLead.mockResolvedValueOnce({ ok: false, reason: 'seller_scope' });
-    const response = await jsonRequest('POST', '/leads', { contactName: 'Ana' });
+    serviceMocks.createLead.mockResolvedValueOnce({ ok: false, reason: 'seller_scope' });
+    const response = await jsonRequest('POST', '/leads', { contactName: 'Ana', contactPhone: '1' });
     expect(response.status).toBe(403);
     expect(await response.json()).toEqual({ error: 'forbidden', reason: 'seller_scope' });
-    expect(serviceMocks.createContactLead.mock.calls[0]![3]).toEqual({
+    expect(serviceMocks.createLead.mock.calls[0]![3]).toEqual({
       userId: 'verified-account',
       email: TOKEN_EMAIL,
       isAdmin: false,
@@ -255,13 +237,13 @@ describe('Sales Ops lead routes per sales edition', () => {
   });
 
   // seller-auto-provision: the provisioning inputs come from the verified
-  // context only; the strict contact schema refuses any body attempt.
+  // context only; the strict schema refuses any body attempt.
   it('builds the auto-provision inputs from the verified token, never from the body', async () => {
     currentRoles = ['seller'];
     currentName = 'Ana Martins';
-    const response = await jsonRequest('POST', '/leads', { contactName: 'Ana' });
+    const response = await jsonRequest('POST', '/leads', { contactName: 'Ana', contactPhone: '1' });
     expect(response.status).toBe(201);
-    expect(serviceMocks.createContactLead.mock.calls[0]![3]).toEqual({
+    expect(serviceMocks.createLead.mock.calls[0]![3]).toEqual({
       userId: 'verified-account',
       email: TOKEN_EMAIL,
       isAdmin: false,
@@ -272,17 +254,18 @@ describe('Sales Ops lead routes per sales edition', () => {
 
     const smuggled = await jsonRequest('POST', '/leads', {
       contactName: 'Ana',
+      contactPhone: '1',
       name: 'Outro',
       edition: 'leads',
       hasSellerRole: true,
     });
     expect(smuggled.status).toBe(400);
-    expect(serviceMocks.createContactLead).toHaveBeenCalledTimes(1);
+    expect(serviceMocks.createLead).toHaveBeenCalledTimes(1);
 
     currentRoles = ['finder'];
     currentEdition = undefined;
-    await jsonRequest('POST', '/leads', { contactName: 'Ana', clientName: 'Empresa Um' });
-    expect(serviceMocks.createLead.mock.calls[0]![3]).toMatchObject({
+    await jsonRequest('POST', '/leads', { contactName: 'Ana', contactPhone: '1', clientName: 'Empresa Um' });
+    expect(serviceMocks.createLead.mock.calls[1]![3]).toMatchObject({
       hasSellerRole: false,
       edition: 'full',
     });
```

#### `apps/api/src/domains/sales-ops/leads/__tests__/lead-routes.test.ts` (edit, 8 changed lines)

```diff
diff --git a/apps/api/src/domains/sales-ops/leads/__tests__/lead-routes.test.ts b/apps/api/src/domains/sales-ops/leads/__tests__/lead-routes.test.ts
index 41bc152..f293bf6 100644
--- a/apps/api/src/domains/sales-ops/leads/__tests__/lead-routes.test.ts
+++ b/apps/api/src/domains/sales-ops/leads/__tests__/lead-routes.test.ts
@@ -48,6 +48,7 @@ const SALE_ID = '77777777-7777-4777-8777-777777777777';
 const deletedView = {
   id: LEAD_ID,
   contactName: 'Ana Martins',
+  contactEmail: 'ana@example.test',
   clientName: 'Empresa Um',
   stageName: 'Novo',
   sellerName: '',
@@ -137,15 +138,17 @@ describe('Sales Ops lead routes', () => {
   it('passes the VERIFIED org and never an orgId from the body or the query', async () => {
     const response = await jsonRequest('POST', '/leads?orgId=query-org-must-not-be-used', {
       contactName: 'Ana Martins',
+      contactEmail: 'ana@example.test',
       clientName: 'Empresa Um',
     });
     expect(response.status).toBe(201);
     expect(serviceMocks.createLead).toHaveBeenCalledTimes(1);
     expect(serviceMocks.createLead.mock.calls[0]![1]).toBe('verified-org');
 
-    // The body cannot even carry one: CreateLeadSchema is .strict().
+    // The body cannot even carry one: LeadWriteSchema is .strict().
     const smuggled = await jsonRequest('POST', '/leads', {
       contactName: 'Ana Martins',
+      contactEmail: 'ana@example.test',
       clientName: 'Empresa Um',
       orgId: 'body-org-must-not-be-used',
     });
@@ -157,6 +160,7 @@ describe('Sales Ops lead routes', () => {
     currentRoles = ['seller'];
     await jsonRequest('POST', '/leads', {
       contactName: 'Ana Martins',
+      contactEmail: 'ana@example.test',
       clientName: 'Empresa Um',
     });
     expect(serviceMocks.createLead.mock.calls[0]![3]).toEqual({
@@ -172,6 +176,7 @@ describe('Sales Ops lead routes', () => {
     currentEmail = undefined;
     await jsonRequest('POST', '/leads', {
       contactName: 'Ana Martins',
+      contactEmail: 'ana@example.test',
       clientName: 'Empresa Um',
     });
     expect(serviceMocks.createLead.mock.calls[1]![3]).toEqual({
@@ -255,6 +260,7 @@ describe('Sales Ops lead routes', () => {
     serviceMocks.createLead.mockResolvedValue({ ok: false, reason: 'seller_scope' });
     const response = await jsonRequest('POST', '/leads', {
       contactName: 'Ana Martins',
+      contactEmail: 'ana@example.test',
       clientName: 'Empresa Um',
       sellerPersonId: SALE_ID,
     });
```

#### `apps/api/src/domains/import/__tests__/catalog.integration.test.ts` (edit, 23 changed lines)

```diff
diff --git a/apps/api/src/domains/import/__tests__/catalog.integration.test.ts b/apps/api/src/domains/import/__tests__/catalog.integration.test.ts
index e7f589c..8035152 100644
--- a/apps/api/src/domains/import/__tests__/catalog.integration.test.ts
+++ b/apps/api/src/domains/import/__tests__/catalog.integration.test.ts
@@ -4,14 +4,15 @@
  *
  * Run: VITEST_INTEGRATION=1 pnpm exec vitest run src/domains/import/__tests__/catalog.integration.test.ts
  */
-import { eq, inArray } from 'drizzle-orm';
+import { eq } from 'drizzle-orm';
+import { deleteCrmForOrgs } from '../../../db/__tests__/settlement-test-cleanup.js';
 import { afterAll, afterEach, describe, expect, it } from 'vitest';
 import { closeDb, getAdminDb, getDb } from '../../../db/client.js';
 import {
   salesOpsAreas,
   salesOpsClients,
   salesOpsFuncoes,
-  salesOpsLeadStages,
+  salesOpsPipelineStages,
   salesOpsPeople,
   salesOpsPersonFuncoes,
   salesOpsProductFuncaoCosts,
@@ -42,7 +43,7 @@ const catalogOf = (orgId: string, now = NOW) =>
 
 async function counts(orgId: string) {
   const admin = getAdminDb();
-  const stages = await admin.select().from(salesOpsLeadStages).where(eq(salesOpsLeadStages.orgId, orgId));
+  const stages = await admin.select().from(salesOpsPipelineStages).where(eq(salesOpsPipelineStages.orgId, orgId));
   const funcoes = await admin.select().from(salesOpsFuncoes).where(eq(salesOpsFuncoes.orgId, orgId));
   return { stages: stages.length, funcoes: funcoes.length };
 }
@@ -61,7 +62,7 @@ afterAll(async () => {
     await admin.delete(salesOpsFuncoes).where(eq(salesOpsFuncoes.orgId, orgId));
     await admin.delete(salesOpsAreas).where(eq(salesOpsAreas.orgId, orgId));
     await admin.delete(salesOpsClients).where(eq(salesOpsClients.orgId, orgId));
-    await admin.delete(salesOpsLeadStages).where(inArray(salesOpsLeadStages.orgId, [orgId]));
+    await deleteCrmForOrgs([orgId]);
     await admin.delete(salesOpsSettings).where(eq(salesOpsSettings.orgId, orgId));
   }
   registerProducerFlowGate(() => false);
@@ -148,7 +149,8 @@ describe('readImportCatalog', () => {
     expect(catalog.clients).toEqual([{ id: expect.any(String), name: 'Padaria', document: '12.345.678/0001-90' }]);
     expect(catalog.settings).toEqual({ defaultSellerCommissionPct: 12, defaultFinderCommissionPct: 4, defaultTaxPct: 5.5 });
     expect(catalog.stages.map((s) => [s.name, s.kind, s.position])).toEqual([
-      ['Novo', 'normal', 1], ['Em negociação', 'normal', 2], ['Proposta', 'conversion', 3], ['Perdido', 'lost', 4],
+      ['Novo', 'normal', 1], ['Qualificação', 'normal', 2], ['Em negociação', 'normal', 3],
+      ['Proposta', 'conversion', 4], ['Ganho', 'normal', 5], ['Perdido', 'lost', 6], ['Pausado', 'normal', 7],
     ]);
     expect(catalog.funcoes.map((f) => f.slug).sort()).toEqual(['desenvolvedor', 'designer', 'vendedor']);
     expect(JSON.stringify(catalog)).not.toContain('Outra');
@@ -180,7 +182,16 @@ describe('readImportCatalog', () => {
       return readImportCatalog(tx, orgId, NOW);
     });
     expect(catalog.funcoes.map((f) => [f.name, f.isSystem]).sort()).toEqual([['Finder', true], ['Vendedor', true]]);
-    expect(catalog.stages.map((s) => s.name)).toEqual(['Novo', 'Em negociação', 'Proposta', 'Perdido']);
+    // The default CRM pipeline; kind is the derived legacy vocabulary (orcamento -> conversion, perdido -> lost).
+    expect(catalog.stages.map((s) => [s.name, s.kind])).toEqual([
+      ['Novo', 'normal'],
+      ['Qualificação', 'normal'],
+      ['Em negociação', 'normal'],
+      ['Proposta', 'conversion'],
+      ['Ganho', 'normal'],
+      ['Perdido', 'lost'],
+      ['Pausado', 'normal'],
+    ]);
   });
 
   it('mirrors the producer gate', async () => {
```

#### `apps/api/src/domains/import/__tests__/executor.integration.test.ts` (edit, 58 changed lines)

```diff
diff --git a/apps/api/src/domains/import/__tests__/executor.integration.test.ts b/apps/api/src/domains/import/__tests__/executor.integration.test.ts
index e85f6e9..1e62dce 100644
--- a/apps/api/src/domains/import/__tests__/executor.integration.test.ts
+++ b/apps/api/src/domains/import/__tests__/executor.integration.test.ts
@@ -10,16 +10,16 @@
 import { randomUUID } from 'node:crypto';
 import { and, eq, sql } from 'drizzle-orm';
 import { afterAll, afterEach, describe, expect, it } from 'vitest';
-import { deleteSettlementsForOrgs } from '../../../db/__tests__/settlement-test-cleanup.js';
+import { deleteCrmForOrgs, deleteSettlementsForOrgs } from '../../../db/__tests__/settlement-test-cleanup.js';
 import { closeDb, getAdminDb, getDb } from '../../../db/client.js';
 import {
   auditLog,
   salesOpsAreas,
   salesOpsClients,
   salesOpsFuncoes,
-  salesOpsLeadProducts,
-  salesOpsLeadStages,
-  salesOpsLeads,
+  salesOpsCrmLeadFieldValues,
+  salesOpsPipelineStages,
+  salesOpsCrmLeads,
   salesOpsPayables,
   salesOpsPeople,
   salesOpsPersonFuncoes,
@@ -51,9 +51,15 @@ const COUNT_TABLES = [
   'sales_ops_people',
   'sales_ops_person_funcoes',
   'sales_ops_clients',
-  'sales_ops_lead_stages',
-  'sales_ops_leads',
-  'sales_ops_lead_products',
+  // The unified CRM tables the import writes, and the three FROZEN pre-cutover tables, which an
+  // import must never touch (their counts stay equal in every all-or-nothing comparison).
+  'sales_ops_pipelines',
+  'sales_ops_pipeline_stages',
+  'sales_ops_pipeline_transitions',
+  'sales_ops_field_definitions',
+  'sales_ops_crm_leads',
+  'sales_ops_crm_lead_field_values',
+  'sales_ops_crm_lead_events',
   'sales_ops_sales',
   'sales_ops_sale_items',
   'sales_ops_sale_professionals',
@@ -62,6 +68,9 @@ const COUNT_TABLES = [
   'sales_ops_settlements',
 ] as const;
 
+/** The FROZEN pre-cutover lead tables: snapshotted in every comparison, and zero after a successful import. */
+const FROZEN_TABLES = ['sales_ops_lead_stages', 'sales_ops_leads', 'sales_ops_lead_products'] as const;
+
 function must<T>(v: T | undefined): T {
   if (v === undefined) throw new Error('expected a row, got undefined');
   return v;
@@ -83,7 +92,7 @@ async function countOf(query: ReturnType<typeof sql>): Promise<number> {
 
 async function snapshot(orgId: string): Promise<Record<string, number>> {
   const out: Record<string, number> = {};
-  for (const table of COUNT_TABLES) {
+  for (const table of [...COUNT_TABLES, ...FROZEN_TABLES]) {
     out[table] = await countOf(
       sql`SELECT count(*)::int AS n FROM ${sql.identifier(table)} WHERE org_id = ${orgId}`,
     );
@@ -112,9 +121,9 @@ async function seededOrg(tag: string): Promise<Seeded> {
     .from(salesOpsFuncoes)
     .where(and(eq(salesOpsFuncoes.orgId, orgId), eq(salesOpsFuncoes.slug, 'vendedor')));
   const [perdido] = await admin
-    .select({ id: salesOpsLeadStages.id })
-    .from(salesOpsLeadStages)
-    .where(and(eq(salesOpsLeadStages.orgId, orgId), eq(salesOpsLeadStages.kind, 'lost')));
+    .select({ id: salesOpsPipelineStages.id })
+    .from(salesOpsPipelineStages)
+    .where(and(eq(salesOpsPipelineStages.orgId, orgId), eq(salesOpsPipelineStages.exitKind, 'perdido')));
   return { orgId, areaId: area.id, vendedorId: must(vendedor).id, perdidoId: must(perdido).id };
 }
 
@@ -311,9 +320,7 @@ afterEach(async () => {
     // Same precedent as the other audit tests: chain-order oracles (conversion-ingest) need
     // the global chain free of leftovers, so each test removes its own org's entries.
     await admin.execute(sql`DELETE FROM audit_log WHERE actor_org_id = ${orgId}`);
-    await admin.delete(salesOpsLeadProducts).where(eq(salesOpsLeadProducts.orgId, orgId));
-    await admin.delete(salesOpsLeads).where(eq(salesOpsLeads.orgId, orgId));
-    await admin.delete(salesOpsLeadStages).where(eq(salesOpsLeadStages.orgId, orgId));
+    await deleteCrmForOrgs([orgId]);
     await admin.delete(salesOpsPayables).where(eq(salesOpsPayables.orgId, orgId));
     await admin.delete(salesOpsReceivables).where(eq(salesOpsReceivables.orgId, orgId));
     await admin.delete(salesOpsSaleItems).where(eq(salesOpsSaleItems.orgId, orgId));
@@ -361,8 +368,9 @@ describe('executeImportPlan', () => {
       .from(salesOpsPersonFuncoes)
       .where(eq(salesOpsPersonFuncoes.orgId, s.orgId));
     expect(personFuncoes).toHaveLength(2);
-    const stages = await admin.select().from(salesOpsLeadStages).where(eq(salesOpsLeadStages.orgId, s.orgId));
-    expect(stages).toHaveLength(5);
+    const stages = await admin.select().from(salesOpsPipelineStages).where(eq(salesOpsPipelineStages.orgId, s.orgId));
+    // The seven default etapas plus the workbook etapa.
+    expect(stages).toHaveLength(8);
 
     const sales = await admin
       .select()
@@ -414,9 +422,9 @@ describe('executeImportPlan', () => {
     const s = await seededOrg('leads');
     await run(s.orgId, fullPlan(s));
     const admin = getAdminDb();
-    const stages = await admin.select().from(salesOpsLeadStages).where(eq(salesOpsLeadStages.orgId, s.orgId));
+    const stages = await admin.select().from(salesOpsPipelineStages).where(eq(salesOpsPipelineStages.orgId, s.orgId));
     const diagnostico = must(stages.find((x) => x.name === 'Diagnóstico'));
-    const leads = await admin.select().from(salesOpsLeads).where(eq(salesOpsLeads.orgId, s.orgId));
+    const leads = await admin.select().from(salesOpsCrmLeads).where(eq(salesOpsCrmLeads.orgId, s.orgId));
     const bruno = must(leads.find((l) => l.contactName === 'Bruno'));
     const carla = must(leads.find((l) => l.contactName === 'Carla'));
     const diego = must(leads.find((l) => l.contactName === 'Diego'));
@@ -426,12 +434,14 @@ describe('executeImportPlan', () => {
     expect(carla.stageId).toBe(s.perdidoId);
     expect(carla.lostReason).toBe('Sem orçamento');
     expect(bruno.sellerNameSnapshot).toBe('Ana Importada');
+    // The produtos of a lead are the `produtos` field values: a catalog item carries value_product_id,
+    // a free item carries value_text and no product id.
     const products = await admin
       .select()
-      .from(salesOpsLeadProducts)
-      .where(eq(salesOpsLeadProducts.orgId, s.orgId));
-    expect(products.filter((p) => p.leadId === bruno.id && p.productId !== null)).toHaveLength(1);
-    expect(products.filter((p) => p.leadId === carla.id && p.productId === null)).toHaveLength(1);
+      .from(salesOpsCrmLeadFieldValues)
+      .where(eq(salesOpsCrmLeadFieldValues.orgId, s.orgId));
+    expect(products.filter((p) => p.leadId === bruno.id && p.valueProductId !== null)).toHaveLength(1);
+    expect(products.filter((p) => p.leadId === carla.id && p.valueProductId === null)).toHaveLength(1);
   });
 
   it('writes exactly one import.completed entry, last, with the counts and the actor label', async () => {
@@ -476,6 +486,10 @@ describe('executeImportPlan', () => {
     for (const table of COUNT_TABLES) {
       expect(after[table], table).toBeGreaterThan(baseline[table]!);
     }
+    // The import wrote leads, etapas and produtos, and none of it into the frozen tables.
+    for (const table of FROZEN_TABLES) {
+      expect(after[table], table).toBe(0);
+    }
     expect(after.audit_log).toBe(1);
   });
```

#### `apps/api/src/domains/import/__tests__/import-routes.integration.test.ts` (edit, 46 changed lines)

```diff
diff --git a/apps/api/src/domains/import/__tests__/import-routes.integration.test.ts b/apps/api/src/domains/import/__tests__/import-routes.integration.test.ts
index 8e105cc..5c49a13 100644
--- a/apps/api/src/domains/import/__tests__/import-routes.integration.test.ts
+++ b/apps/api/src/domains/import/__tests__/import-routes.integration.test.ts
@@ -15,7 +15,7 @@ import ExcelJS from 'exceljs';
 import { Hono } from 'hono';
 import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
 import { hubAuthContext } from '../../../auth/__tests__/hub-auth-context-fixture.js';
-import { deleteSettlementsForOrgs } from '../../../db/__tests__/settlement-test-cleanup.js';
+import { deleteCrmForOrgs, deleteSettlementsForOrgs } from '../../../db/__tests__/settlement-test-cleanup.js';
 import { closeDb, getAdminDb, getDb } from '../../../db/client.js';
 import {
   auditLog,
@@ -23,9 +23,9 @@ import {
   salesOpsAreas,
   salesOpsClients,
   salesOpsFuncoes,
-  salesOpsLeadProducts,
-  salesOpsLeadStages,
-  salesOpsLeads,
+  salesOpsCrmLeadFieldValues,
+  salesOpsPipelineStages,
+  salesOpsCrmLeads,
   salesOpsPayables,
   salesOpsPeople,
   salesOpsPersonFuncoes,
@@ -39,7 +39,7 @@ import {
   salesOpsSettlements,
 } from '../../../db/schema.js';
 import { registerProducerFlowGate } from '../../integration/producer-gate.js';
-import { LEAD_STAGE_SEEDS } from '../../sales-ops/leads/stages-seed.js';
+import { DEFAULT_PIPELINE_STAGES } from '@fxl-sales/shared-utils/default-pipeline';
 import { AreaSchema, ClientSchema, createArea, createClient } from '../../sales-ops/service.js';
 
 // The router transitively resolves the Hub contract at module scope; this file drives an
@@ -150,9 +150,9 @@ const ORG_TABLES: Array<[string, OrgTable]> = [
   ['people', salesOpsPeople],
   ['personFuncoes', salesOpsPersonFuncoes],
   ['clients', salesOpsClients],
-  ['leadStages', salesOpsLeadStages],
-  ['leads', salesOpsLeads],
-  ['leadProducts', salesOpsLeadProducts],
+  ['leadStages', salesOpsPipelineStages],
+  ['leads', salesOpsCrmLeads],
+  ['leadProducts', salesOpsCrmLeadFieldValues],
   ['sales', salesOpsSales],
   ['saleItems', salesOpsSaleItems],
   ['saleProfessionals', salesOpsSaleProfessionals],
@@ -194,18 +194,18 @@ async function createdBySheet(orgId: string): Promise<ImportCounts> {
     custosProduto: await countWhere(salesOpsProductFuncaoCosts, o(salesOpsProductFuncaoCosts)),
     pessoas: await countWhere(salesOpsPeople, o(salesOpsPeople)),
     clientes: await countWhere(salesOpsClients, o(salesOpsClients)),
-    // The D11 seeds Novo and Em negociação are not system rows, so match them by name.
+    // The D11 seeds (the default CRM pipeline) are matched by name.
     etapas: await countWhere(
-      salesOpsLeadStages,
+      salesOpsPipelineStages,
       and(
-        o(salesOpsLeadStages),
+        o(salesOpsPipelineStages),
         notInArray(
-          salesOpsLeadStages.name,
-          LEAD_STAGE_SEEDS.map((s) => s.name),
+          salesOpsPipelineStages.name,
+          DEFAULT_PIPELINE_STAGES.map((s) => s.label),
         ),
       ),
     ),
-    leads: await countWhere(salesOpsLeads, o(salesOpsLeads)),
+    leads: await countWhere(salesOpsCrmLeads, o(salesOpsCrmLeads)),
     propostas: await countWhere(salesOpsSales, o(salesOpsSales)),
     itens: await countWhere(salesOpsSaleItems, o(salesOpsSaleItems)),
     profissionais: await countWhere(salesOpsSaleProfessionals, o(salesOpsSaleProfessionals)),
@@ -275,9 +275,7 @@ afterEach(async () => {
     await admin.delete(salesOpsSaleProfessionals).where(eq(salesOpsSaleProfessionals.orgId, orgId));
     await admin.delete(salesOpsSaleItems).where(eq(salesOpsSaleItems.orgId, orgId));
     await admin.delete(salesOpsSales).where(eq(salesOpsSales.orgId, orgId));
-    await admin.delete(salesOpsLeadProducts).where(eq(salesOpsLeadProducts.orgId, orgId));
-    await admin.delete(salesOpsLeads).where(eq(salesOpsLeads.orgId, orgId));
-    await admin.delete(salesOpsLeadStages).where(eq(salesOpsLeadStages.orgId, orgId));
+    await deleteCrmForOrgs([orgId]);
     await admin.delete(salesOpsProductFuncaoCosts).where(eq(salesOpsProductFuncaoCosts.orgId, orgId));
     await admin.delete(salesOpsProducts).where(eq(salesOpsProducts.orgId, orgId));
     await admin.delete(salesOpsPersonFuncoes).where(eq(salesOpsPersonFuncoes.orgId, orgId));
@@ -444,10 +442,10 @@ describe('import routes (real router, real database)', () => {
     expect(await countWhere(integrationOutbox, eq(integrationOutbox.organizationId, orgId))).toBe(0);
 
     const stages = await admin
-      .select({ name: salesOpsLeadStages.name })
-      .from(salesOpsLeadStages)
-      .where(eq(salesOpsLeadStages.orgId, orgId));
-    expect(stages.map((s) => s.name).sort()).toEqual([...LEAD_STAGE_SEEDS.map((s) => s.name), 'Diagnóstico'].sort());
+      .select({ name: salesOpsPipelineStages.name })
+      .from(salesOpsPipelineStages)
+      .where(eq(salesOpsPipelineStages.orgId, orgId));
+    expect(stages.map((s) => s.name).sort()).toEqual([...DEFAULT_PIPELINE_STAGES.map((s) => s.label), 'Diagnóstico'].sort());
   });
 
   it('refuses to commit a workbook whose fresh plan has errors', async () => {
@@ -563,7 +561,7 @@ describe('import routes (real router, real database)', () => {
     const admin = getAdminDb();
     const clientsOf = () =>
       admin.select().from(salesOpsClients).where(eq(salesOpsClients.orgId, orgId)).orderBy(asc(salesOpsClients.id));
-    const leadsOf = () => admin.select().from(salesOpsLeads).where(eq(salesOpsLeads.orgId, orgId));
+    const leadsOf = () => admin.select().from(salesOpsCrmLeads).where(eq(salesOpsCrmLeads.orgId, orgId));
 
     const first = await upload('/import/commit', bytes, 'leads');
     expect(first.status).toBe(201);
@@ -660,7 +658,7 @@ describe('import routes (real router, real database)', () => {
     expect(await commit.json()).toEqual({ counts: { leads: 1 }, recognized: { clientes: 1 } });
 
     expect(await clientsOf()).toEqual(clientsBefore);
-    const leads = await admin.select().from(salesOpsLeads).where(eq(salesOpsLeads.orgId, orgId));
+    const leads = await admin.select().from(salesOpsCrmLeads).where(eq(salesOpsCrmLeads.orgId, orgId));
     expect(leads.map((l) => [l.clientId, l.clientNameSnapshot])).toEqual([[existing.id, 'Construtora Alfa']]);
   });
 
@@ -689,7 +687,7 @@ describe('import routes (real router, real database)', () => {
     const admin = getAdminDb();
     const clients = await admin.select().from(salesOpsClients).where(eq(salesOpsClients.orgId, orgId));
     expect(clients.map((c) => c.id)).toEqual([existing.id]);
-    const leads = await admin.select().from(salesOpsLeads).where(eq(salesOpsLeads.orgId, orgId));
+    const leads = await admin.select().from(salesOpsCrmLeads).where(eq(salesOpsCrmLeads.orgId, orgId));
     expect(leads.map((l) => l.clientId)).toEqual([existing.id]);
   });
```

#### `apps/api/src/domains/import/__tests__/plan-leads.test.ts` (edit, 8 changed lines)

```diff
diff --git a/apps/api/src/domains/import/__tests__/plan-leads.test.ts b/apps/api/src/domains/import/__tests__/plan-leads.test.ts
index 720532b..5e2815a 100644
--- a/apps/api/src/domains/import/__tests__/plan-leads.test.ts
+++ b/apps/api/src/domains/import/__tests__/plan-leads.test.ts
@@ -1,6 +1,6 @@
 import { readFileSync } from 'node:fs';
 import { describe, expect, it } from 'vitest';
-import { CreateLeadSchema } from '../../sales-ops/leads/lead-schemas.js';
+import { LeadWriteBaseSchema } from '../../sales-ops/leads/lead-schemas.js';
 import { planLeads } from '../plan/leads.js';
 import { buildRefIndex } from '../refs.js';
 import type { CellValue, ImportCatalog, ImportIssue, ImportOperation, SheetKey } from '../types.js';
@@ -274,7 +274,7 @@ describe('planLeads', () => {
     expect(none.counts).toEqual({});
   });
 
-  it('every emitted input passes CreateLeadSchema once refs are replaced by uuids', () => {
+  it('every emitted input passes LeadWriteBaseSchema once refs are replaced by uuids', () => {
     const r = plan({
       pessoas: [{ nome: 'Duda Nova', funcoes: ['Vendedor'] }],
       clientes: [{ nome: 'Mercado Novo' }],
@@ -290,7 +290,7 @@ describe('planLeads', () => {
     for (const op of r.operations) {
       const o = leadOp([op]);
       expect(() =>
-        CreateLeadSchema.parse({
+        LeadWriteBaseSchema.parse({
           ...o.input,
           clientId: o.clientRef ? uuid : null,
           sellerPersonId: o.sellerRef ? uuid : null,
@@ -325,7 +325,7 @@ describe('planLeads', () => {
     }
   });
 
-  it('runs the CreateLeadSchema backstop and maps to headers', () => {
+  it('runs the LeadWriteBaseSchema backstop and maps to headers', () => {
     const r = plan({ leads: [lead({ descricao: 'd'.repeat(4001) })] });
     expect(r.issues.map((i) => [i.code, i.column])).toEqual([['invalid_value', 'Descrição']]);
     expect(r.operations).toEqual([]);
```

#### `apps/api/src/domains/import/__tests__/workbook-schema.test.ts` (edit, 8 changed lines)

```diff
diff --git a/apps/api/src/domains/import/__tests__/workbook-schema.test.ts b/apps/api/src/domains/import/__tests__/workbook-schema.test.ts
index e3e6fe7..b8ec872 100644
--- a/apps/api/src/domains/import/__tests__/workbook-schema.test.ts
+++ b/apps/api/src/domains/import/__tests__/workbook-schema.test.ts
@@ -9,7 +9,7 @@ import {
   SaleInstallmentSchema,
 } from '../../sales-ops/service.js';
 import { LeadStageSchema } from '../../sales-ops/leads/schemas.js';
-import { CreateLeadSchema } from '../../sales-ops/leads/lead-schemas.js';
+import { LEAD_CLIENT_NAME_MAX, LEAD_CONTACT_NAME_MAX, LEAD_DESCRIPTION_MAX } from '../../sales-ops/leads/lead-schemas.js';
 import { LEAD_STAGE_SEEDS } from '../../sales-ops/leads/stages-seed.js';
 import { coerceCell, normalizeLabel, rawCell } from '../cells.js';
 import {
@@ -152,9 +152,9 @@ describe('workbook schema', () => {
     expect(maxOf('produtos', 'nome')).toBe(ProductSchema.innerType().shape.name.maxLength);
     expect(maxOf('pessoas', 'nome')).toBe(PersonSchema.shape.displayName.maxLength);
     expect(maxOf('etapas', 'nome')).toBe(LeadStageSchema.shape.name.maxLength);
-    expect(maxOf('leads', 'contato')).toBe(CreateLeadSchema.shape.contactName.maxLength);
-    expect(maxOf('leads', 'empresa')).toBe(CreateLeadSchema.shape.clientName.maxLength);
-    expect(maxOf('leads', 'descricao')).toBe(CreateLeadSchema.shape.description.unwrap().unwrap().maxLength);
+    expect(maxOf('leads', 'contato')).toBe(LEAD_CONTACT_NAME_MAX);
+    expect(maxOf('leads', 'empresa')).toBe(LEAD_CLIENT_NAME_MAX);
+    expect(maxOf('leads', 'descricao')).toBe(LEAD_DESCRIPTION_MAX);
     const clientFields = {
       nome: ClientSchema.shape.name.maxLength,
       contato: ClientSchema.shape.contact.unwrap().unwrap().maxLength,
```

#### `apps/api/test/rls/lead-stages-rls.test.ts` (edit, 68 changed lines)

```diff
diff --git a/apps/api/test/rls/lead-stages-rls.test.ts b/apps/api/test/rls/lead-stages-rls.test.ts
index 4e29e0c..9ad2f95 100644
--- a/apps/api/test/rls/lead-stages-rls.test.ts
+++ b/apps/api/test/rls/lead-stages-rls.test.ts
@@ -13,6 +13,7 @@ import {
 import { ensureLeadStagesForOrg } from '../../src/domains/sales-ops/leads/stages-seed.js';
 import { firstRow } from './first-row.js';
 import { testDatabaseUrls } from '../../src/db/__tests__/test-database-urls.js';
+import { deleteCrmForOrgs } from '../../src/db/__tests__/settlement-test-cleanup.js';
 
 const { appUrl: APP_DB_URL, adminUrl: ADMIN_DB_URL } = testDatabaseUrls();
 const ADMIN_CONNECTION_OPTIONS = { connection: { 'app.fxl_admin': 'true' } } as const;
@@ -56,9 +57,7 @@ describe('sales operations lead stages persistence and RLS', () => {
 
   afterAll(async () => {
     for (const orgId of orgIds) {
-      await adminClient`DELETE FROM sales_ops_lead_products WHERE org_id = ${orgId}`;
-      await adminClient`DELETE FROM sales_ops_leads WHERE org_id = ${orgId}`;
-      await adminClient`DELETE FROM sales_ops_lead_stages WHERE org_id = ${orgId}`;
+      await deleteCrmForOrgs([orgId]);
     }
     await appClient.end();
     await adminDbClient.end();
@@ -70,7 +69,7 @@ describe('sales operations lead stages persistence and RLS', () => {
     await ensureLeadStagesForOrg(db, orgA);
     await ensureLeadStagesForOrg(db, orgB);
 
-    const stageA = await createLeadStage(db, orgA, LeadStageSchema.parse({ name: 'Qualificação' }));
+    const stageA = await createLeadStage(db, orgA, LeadStageSchema.parse({ name: 'Triagem' }));
     if (typeof stageA === 'string') throw new Error(`unexpected sentinel: ${stageA}`);
     expect(stageA.status).toBe('active');
     expect(stageA.kind).toBe('normal');
@@ -80,11 +79,11 @@ describe('sales operations lead stages persistence and RLS', () => {
     expect((await listLeadStages(db, orgA)).map((row) => row.id)).toContain(stageA.id);
     expect((await listLeadStages(db, orgB)).map((row) => row.id)).not.toContain(stageA.id);
 
-    const renamed = await updateLeadStage(db, orgA, stageA.id, { name: 'Qualificado' });
+    const renamed = await updateLeadStage(db, orgA, stageA.id, { name: 'Triado' });
     if (renamed === null || typeof renamed === 'string') {
       throw new Error(`unexpected sentinel: ${renamed}`);
     }
-    expect(renamed.name).toBe('Qualificado');
+    expect(renamed.name).toBe('Triado');
 
     const archived = await updateLeadStage(db, orgA, stageA.id, { status: 'archived' });
     if (archived === null || typeof archived === 'string') {
@@ -110,14 +109,14 @@ describe('sales operations lead stages persistence and RLS', () => {
 
   it('createLeadStage reports duplicates per org but allows the same name in another org', async () => {
     const [orgA, orgB] = newOrgPair('dup');
-    const first = await createLeadStage(db, orgA, LeadStageSchema.parse({ name: 'Qualificação' }));
+    const first = await createLeadStage(db, orgA, LeadStageSchema.parse({ name: 'Triagem' }));
     if (typeof first === 'string') throw new Error(`unexpected sentinel: ${first}`);
 
-    expect(await createLeadStage(db, orgA, LeadStageSchema.parse({ name: 'Qualificação' }))).toBe(
+    expect(await createLeadStage(db, orgA, LeadStageSchema.parse({ name: 'Triagem' }))).toBe(
       'duplicate',
     );
 
-    const other = await createLeadStage(db, orgB, LeadStageSchema.parse({ name: 'Qualificação' }));
+    const other = await createLeadStage(db, orgB, LeadStageSchema.parse({ name: 'Triagem' }));
     if (typeof other === 'string') throw new Error(`unexpected sentinel: ${other}`);
     expect(other.orgId).toBe(orgB);
   });
@@ -133,6 +132,11 @@ describe('sales operations lead stages persistence and RLS', () => {
     // commits. Planting a committed row instead would be caught by the probe and
     // would prove nothing about the conflict clause.
     const [orgA] = newOrgPair('race');
+    // The pipeline is committed first; only the colliding stage row stays uncommitted.
+    const pipeline = firstRow(await adminClient<{ id: string }[]>`
+      INSERT INTO sales_ops_pipelines (org_id, name, system_key, is_default)
+      VALUES (${orgA}, 'Funil CRM padrão', 'crm-padrao', true) RETURNING id
+    `, 'pipeline');
 
     let release: () => void = () => {};
     let markInserted: () => void = () => {};
@@ -144,8 +148,8 @@ describe('sales operations lead stages persistence and RLS', () => {
     });
     const competitor = adminClient.begin(async (tx) => {
       await tx`
-        INSERT INTO sales_ops_lead_stages (org_id, name, kind, is_system, "position")
-        VALUES (${orgA}, 'Concorrente', 'normal', false, 7)
+        INSERT INTO sales_ops_pipeline_stages (org_id, pipeline_id, name, type, "position")
+        VALUES (${orgA}, ${pipeline.id}, 'Concorrente', 'normal', 7)
       `;
       markInserted();
       await gate;
@@ -164,7 +168,7 @@ describe('sales operations lead stages persistence and RLS', () => {
     expect(await racing).toBe('duplicate');
 
     const { count } = firstRow(await adminClient<{ count: string }[]>`
-      SELECT count(*)::text AS count FROM sales_ops_lead_stages
+      SELECT count(*)::text AS count FROM sales_ops_pipeline_stages
       WHERE org_id = ${orgA} AND name = 'Concorrente'
     `, 'count');
     expect(count).toBe('1');
@@ -218,24 +222,25 @@ describe('sales operations lead stages persistence and RLS', () => {
   it('reorderLeadStages writes a total order in one transaction and refuses a partial set', async () => {
     const [orgA] = newOrgPair('reorder');
     const seeded = await ensureLeadStagesForOrg(db, orgA);
-    expect(seeded).toHaveLength(4);
+    // The default CRM pipeline: Novo, Qualificação, Em negociação, Proposta, Ganho, Perdido, Pausado.
+    expect(seeded).toHaveLength(7);
 
     const reversed = [...seeded].reverse().map((stage) => stage.id);
     const reordered = await reorderLeadStages(db, orgA, reversed);
     if (reordered === 'set_mismatch') throw new Error('unexpected set_mismatch');
     expect(reordered.map((stage) => stage.id)).toEqual(reversed);
-    expect(reordered.map((stage) => stage.position)).toEqual([0, 1, 2, 3]);
+    expect(reordered.map((stage) => stage.position)).toEqual([0, 1, 2, 3, 4, 5, 6]);
 
     // A partial set is refused and, because the whole thing is one transaction,
     // not one position moves.
-    expect(await reorderLeadStages(db, orgA, reversed.slice(0, 3))).toBe('set_mismatch');
+    expect(await reorderLeadStages(db, orgA, reversed.slice(0, 6))).toBe('set_mismatch');
     const afterRejection = await listLeadStages(db, orgA);
     expect(afterRejection.map((stage) => stage.id)).toEqual(reversed);
-    expect(afterRejection.map((stage) => stage.position)).toEqual([0, 1, 2, 3]);
+    expect(afterRejection.map((stage) => stage.position)).toEqual([0, 1, 2, 3, 4, 5, 6]);
 
     // An unknown id of the right cardinality is refused too.
     expect(
-      await reorderLeadStages(db, orgA, [...reversed.slice(0, 3), randomUUID()]),
+      await reorderLeadStages(db, orgA, [...reversed.slice(0, 6), randomUUID()]),
     ).toBe('set_mismatch');
   });
 
@@ -245,8 +250,8 @@ describe('sales operations lead stages persistence and RLS', () => {
     const home = firstRow(seeded, 'a seeded stage');
 
     const lead = firstRow(await adminClient<{ id: string; stage_changed_at: Date }[]>`
-      INSERT INTO sales_ops_leads (org_id, contact_name, client_name_snapshot, stage_id)
-      VALUES (${orgA}, 'Contato Um', 'Empresa Um', ${home.id})
+      INSERT INTO sales_ops_crm_leads (org_id, contact_name, client_name_snapshot, pipeline_id, stage_id)
+      VALUES (${orgA}, 'Contato Um', 'Empresa Um', ${home.pipelineId}, ${home.id})
       RETURNING id, stage_changed_at
     `, 'lead');
 
@@ -258,7 +263,7 @@ describe('sales operations lead stages persistence and RLS', () => {
     if (reordered === 'set_mismatch') throw new Error('unexpected set_mismatch');
 
     const after = firstRow(await adminClient<{ stage_changed_at: Date; updated_at: Date | null }[]>`
-      SELECT stage_changed_at, updated_at FROM sales_ops_leads WHERE id = ${lead.id}
+      SELECT stage_changed_at, updated_at FROM sales_ops_crm_leads WHERE id = ${lead.id}
     `, 'after');
     // Byte-identical, not merely "the lead still exists": this is the sole oracle
     // for "a reorder never touches a lead".
@@ -331,32 +336,39 @@ describe('sales operations lead stages persistence and RLS', () => {
     );
     await adminClient.unsafe(`GRANT USAGE ON SCHEMA public TO ${roleName}`);
     await adminClient.unsafe(
-      `GRANT SELECT, INSERT, UPDATE, DELETE ON sales_ops_lead_stages TO ${roleName}`,
+      `GRANT SELECT, INSERT, UPDATE, DELETE ON sales_ops_pipeline_stages TO ${roleName}`,
     );
 
     const roleClient = postgres(withRole(APP_DB_URL, roleName, rolePassword), { max: 1 });
 
     try {
       const [ORG_A, ORG_B] = newOrgPair('rawrls');
+      const pipelineOf = async (orgId: string) =>
+        firstRow(await adminClient<{ id: string }[]>`
+          INSERT INTO sales_ops_pipelines (org_id, name, system_key, is_default)
+          VALUES (${orgId}, 'Funil CRM padrão', 'crm-padrao', true) RETURNING id
+        `, 'pipeline').id;
+      const pipelineA = await pipelineOf(ORG_A);
+      const pipelineB = await pipelineOf(ORG_B);
 
       const stageId = await roleClient.begin(async (tx) => {
         await tx`SELECT set_config('app.current_org_id', ${ORG_A}, true)`;
         const [stage] = await tx`
-          INSERT INTO sales_ops_lead_stages (org_id, name, kind, is_system, "position")
-          VALUES (${ORG_A}, 'RLS Probe Etapa', 'normal', false, 0) RETURNING id
+          INSERT INTO sales_ops_pipeline_stages (org_id, pipeline_id, name, type, "position")
+          VALUES (${ORG_A}, ${pipelineA}, 'RLS Probe Etapa', 'normal', 0) RETURNING id
         `;
         return (stage as { id: string }).id;
       });
 
       const own = await roleClient.begin(async (tx) => {
         await tx`SELECT set_config('app.current_org_id', ${ORG_A}, true)`;
-        return tx`SELECT id FROM sales_ops_lead_stages WHERE id = ${stageId}`;
+        return tx`SELECT id FROM sales_ops_pipeline_stages WHERE id = ${stageId}`;
       });
       expect(own).toHaveLength(1);
 
       const other = await roleClient.begin(async (tx) => {
         await tx`SELECT set_config('app.current_org_id', ${ORG_B}, true)`;
-        return tx`SELECT id FROM sales_ops_lead_stages WHERE id = ${stageId}`;
+        return tx`SELECT id FROM sales_ops_pipeline_stages WHERE id = ${stageId}`;
       });
       expect(other).toHaveLength(0);
 
@@ -364,15 +376,15 @@ describe('sales operations lead stages persistence and RLS', () => {
         roleClient.begin(async (tx) => {
           await tx`SELECT set_config('app.current_org_id', ${ORG_A}, true)`;
           return tx`
-            INSERT INTO sales_ops_lead_stages (org_id, name, kind, is_system, "position")
-            VALUES (${ORG_B}, 'Etapa Contrabandeada', 'normal', false, 0) RETURNING id
+            INSERT INTO sales_ops_pipeline_stages (org_id, pipeline_id, name, type, "position")
+            VALUES (${ORG_B}, ${pipelineB}, 'Etapa Contrabandeada', 'normal', 0) RETURNING id
           `;
         }),
       ).rejects.toThrow();
 
       const noContext = await roleClient.begin(async (tx) => {
         await tx`SELECT set_config('app.current_org_id', '', true)`;
-        return tx`SELECT id FROM sales_ops_lead_stages WHERE id = ${stageId}`;
+        return tx`SELECT id FROM sales_ops_pipeline_stages WHERE id = ${stageId}`;
       });
       expect(noContext).toHaveLength(0);
     } finally {
```

#### `apps/api/test/rls/lead-stages-seed-on-read.test.ts` (edit, 44 changed lines)

```diff
diff --git a/apps/api/test/rls/lead-stages-seed-on-read.test.ts b/apps/api/test/rls/lead-stages-seed-on-read.test.ts
index 93dedff..40ebe96 100644
--- a/apps/api/test/rls/lead-stages-seed-on-read.test.ts
+++ b/apps/api/test/rls/lead-stages-seed-on-read.test.ts
@@ -9,6 +9,7 @@
  * Run once: `VITEST_INTEGRATION=1 pnpm exec vitest run test/rls/lead-stages-seed-on-read.test.ts`
  */
 import { randomUUID } from 'node:crypto';
+import { DEFAULT_PIPELINE_STAGES } from '@fxl-sales/shared-utils/default-pipeline';
 import { Hono } from 'hono';
 import postgres from 'postgres';
 import { afterAll, describe, expect, it, vi } from 'vitest';
@@ -34,13 +35,14 @@ vi.hoisted(() => {
 import { hubAuthContext } from '../../src/auth/__tests__/hub-auth-context-fixture.js';
 import { closeDb, getDb } from '../../src/db/client.js';
 import { testDatabaseUrls } from '../../src/db/__tests__/test-database-urls.js';
+import { deleteCrmForOrgs } from '../../src/db/__tests__/settlement-test-cleanup.js';
 import { LeadStageSchema } from '../../src/domains/sales-ops/leads/schemas.js';
 import {
   createLeadStage,
   listLeadStages,
   updateLeadStage,
 } from '../../src/domains/sales-ops/leads/stage-service.js';
-import { LEAD_STAGE_SEEDS, ensureLeadStagesForOrg } from '../../src/domains/sales-ops/leads/stages-seed.js';
+import { ensureLeadStagesForOrg } from '../../src/domains/sales-ops/leads/stages-seed.js';
 
 const { leadStagesRouter } = await import('../../src/domains/sales-ops/leads/stage-routes.js');
 const { salesOpsRouter } = await import('../../src/domains/sales-ops/routes.js');
@@ -84,13 +86,17 @@ function appFor(
 
 async function countStages(orgId: string): Promise<number> {
   const [row] = await adminClient<{ n: number }[]>`
-    SELECT count(*)::int AS n FROM sales_ops_lead_stages WHERE org_id = ${orgId}
+    SELECT count(*)::int AS n FROM sales_ops_pipeline_stages WHERE org_id = ${orgId}
   `;
   return row?.n ?? -1;
 }
 
+/** The seven stages of the default CRM pipeline, in the derived legacy vocabulary. */
 function expectedDefaults(): [string, string, boolean, number][] {
-  return LEAD_STAGE_SEEDS.map((seed) => [seed.name, seed.kind, seed.isSystem, seed.position]);
+  return DEFAULT_PIPELINE_STAGES.map((stage) => {
+    const kind = stage.type === 'orcamento' ? 'conversion' : stage.exitKind === 'perdido' ? 'lost' : 'normal';
+    return [stage.label, kind, kind !== 'normal', stage.order];
+  });
 }
 
 type StageJson = {
@@ -109,21 +115,20 @@ async function getStages(app: Hono): Promise<{ status: number; stages: StageJson
 
 afterAll(async () => {
   for (const orgId of orgIds) {
-    await adminClient`DELETE FROM sales_ops_leads WHERE org_id = ${orgId}`;
-    await adminClient`DELETE FROM sales_ops_lead_stages WHERE org_id = ${orgId}`;
+    await deleteCrmForOrgs([orgId]);
   }
   await adminClient.end();
   await closeDb();
 });
 
 describe('lead stages are seeded on read', () => {
-  it('GET /lead-stages seeds the four default etapas for an org with none', async () => {
+  it('GET /lead-stages seeds the seven default etapas for an org with none', async () => {
     const orgId = newOrg('fresh');
     const { status, stages } = await getStages(appFor(orgId, { roles: ['admin'], edition: 'full', router: 'stages' }));
 
     expect(status).toBe(200);
     expect(stages.map((s) => [s.name, s.kind, s.isSystem, s.position])).toEqual(expectedDefaults());
-    expect(await countStages(orgId)).toBe(4);
+    expect(await countStages(orgId)).toBe(7);
   });
 
   it('a second GET /lead-stages does not duplicate', async () => {
@@ -134,7 +139,7 @@ describe('lead stages are seeded on read', () => {
     const second = await getStages(app);
 
     expect(first.stages.map((s) => s.id)).toEqual(second.stages.map((s) => s.id));
-    expect(await countStages(orgId)).toBe(4);
+    expect(await countStages(orgId)).toBe(7);
   });
 
   it.each([
@@ -146,10 +151,10 @@ describe('lead stages are seeded on read', () => {
     const { status } = await getStages(appFor(orgId, { roles: [role], edition, router: 'stages' }));
 
     expect(status).toBe(200);
-    expect(await countStages(orgId)).toBe(4);
+    expect(await countStages(orgId)).toBe(7);
   });
 
-  it('GET /bootstrap seeds the four etapas and a second bootstrap adds none', async () => {
+  it('GET /bootstrap seeds the seven etapas and a second bootstrap adds none', async () => {
     const orgId = newOrg('bootstrap');
     const app = appFor(orgId, { roles: ['admin'], edition: 'leads', router: 'bootstrap' });
 
@@ -157,11 +162,11 @@ describe('lead stages are seeded on read', () => {
     expect(first.status).toBe(200);
     const body = (await first.json()) as Record<string, unknown>;
     expect(body).not.toHaveProperty('stages');
-    expect(await countStages(orgId)).toBe(4);
+    expect(await countStages(orgId)).toBe(7);
 
     const second = await app.request('/bootstrap');
     expect(second.status).toBe(200);
-    expect(await countStages(orgId)).toBe(4);
+    expect(await countStages(orgId)).toBe(7);
   });
 
   it('an org that renamed one etapa and archived another gets no reinsertion', async () => {
@@ -182,9 +187,10 @@ describe('lead stages are seeded on read', () => {
     const first = await getStages(app);
     const second = await getStages(app);
 
-    expect(first.stages.map((s) => s.name)).toEqual(['Prospecção', 'Em negociação', 'Proposta', 'Perdido']);
-    expect(second.stages.map((s) => s.name)).toEqual(['Prospecção', 'Em negociação', 'Proposta', 'Perdido']);
-    expect(await countStages(orgId)).toBe(4);
+    const expectedNames = DEFAULT_PIPELINE_STAGES.map((stage) => (stage.label === 'Novo' ? 'Prospecção' : stage.label));
+    expect(first.stages.map((s) => s.name)).toEqual(expectedNames);
+    expect(second.stages.map((s) => s.name)).toEqual(expectedNames);
+    expect(await countStages(orgId)).toBe(7);
     expect(first.stages.some((s) => s.name === 'Novo')).toBe(false);
   });
 
@@ -206,11 +212,11 @@ describe('lead stages are seeded on read', () => {
 
     await getStages(appFor(orgA, { roles: ['admin'], edition: 'full', router: 'stages' }));
 
-    expect(await countStages(orgA)).toBe(4);
+    expect(await countStages(orgA)).toBe(7);
     expect(await countStages(orgB)).toBe(0);
   });
 
-  it('eight concurrent first GETs all answer 200 and leave exactly four rows', async () => {
+  it('eight concurrent first GETs all answer 200 and leave exactly seven rows', async () => {
     for (let round = 0; round < 3; round += 1) {
       const orgId = newOrg(`race_${round}`);
       const app = appFor(orgId, { roles: ['admin'], edition: 'full', router: 'stages' });
@@ -221,8 +227,8 @@ describe('lead stages are seeded on read', () => {
       expect(responses.map((r) => r.status)).toEqual(Array(8).fill(200));
       const idSets = bodies.map((b) => b.stages.map((s) => s.id).sort().join(','));
       expect(new Set(idSets).size).toBe(1);
-      expect(bodies[0]?.stages).toHaveLength(4);
-      expect(await countStages(orgId)).toBe(4);
+      expect(bodies[0]?.stages).toHaveLength(7);
+      expect(await countStages(orgId)).toBe(7);
     }
   });
 });
```

#### `apps/api/test/rls/leads-edition.test.ts` (edit, 109 changed lines)

```diff
diff --git a/apps/api/test/rls/leads-edition.test.ts b/apps/api/test/rls/leads-edition.test.ts
index d04d4a3..92150d4 100644
--- a/apps/api/test/rls/leads-edition.test.ts
+++ b/apps/api/test/rls/leads-edition.test.ts
@@ -14,23 +14,21 @@ import { afterAll, beforeAll, describe, expect, it } from 'vitest';
 import * as schema from '../../src/db/schema.js';
 import { testDatabaseUrls } from '../../src/db/__tests__/test-database-urls.js';
 import {
-  CreateContactLeadSchema,
-  CreateLeadSchema,
+  LeadPatchSchema,
+  LeadWriteBaseSchema,
   ListLeadsQuerySchema,
   MoveLeadSchema,
-  UpdateContactLeadSchema,
 } from '../../src/domains/sales-ops/leads/lead-schemas.js';
 import {
-  type LeadScope,
-  type LeadView,
-  type WriteLeadResult,
-  createContactLead,
   createLead,
   getLead,
   listLeads,
   moveLead,
   provisionLeadsSellerPerson,
-  updateContactLead,
+  type LeadScope,
+  type LeadView,
+  type WriteLeadResult,
+  updateLead,
 } from '../../src/domains/sales-ops/leads/lead-service.js';
 import { LeadStageSchema } from '../../src/domains/sales-ops/leads/schemas.js';
 import {
@@ -45,6 +43,7 @@ import {
   updatePerson,
   withTenant,
 } from '../../src/domains/sales-ops/service.js';
+import { deleteCrmForOrgs } from '../../src/db/__tests__/settlement-test-cleanup.js';
 
 const { appUrl: APP_DB_URL, adminUrl: ADMIN_DB_URL } = testDatabaseUrls();
 const ADMIN_CONNECTION_OPTIONS = { connection: { 'app.fxl_admin': 'true' } } as const;
@@ -116,9 +115,7 @@ describe('sales operations leads edition: contact leads, vendedor-only pessoas,
     // depending on which file vitest happens to schedule in between.
     for (const orgId of orgIds) {
       await adminClient`DELETE FROM audit_log WHERE actor_org_id = ${orgId}`;
-      await adminClient`DELETE FROM sales_ops_lead_products WHERE org_id = ${orgId}`;
-      await adminClient`DELETE FROM sales_ops_leads WHERE org_id = ${orgId}`;
-      await adminClient`DELETE FROM sales_ops_lead_stages WHERE org_id = ${orgId}`;
+      await deleteCrmForOrgs([orgId]);
       await adminClient`DELETE FROM sales_ops_payables WHERE org_id = ${orgId}`;
       await adminClient`DELETE FROM sales_ops_receivables WHERE org_id = ${orgId}`;
       await adminClient`DELETE FROM sales_ops_sale_items WHERE org_id = ${orgId}`;
@@ -155,19 +152,19 @@ describe('sales operations leads edition: contact leads, vendedor-only pessoas,
   }
 
   function contactLead(overrides: Record<string, unknown> = {}) {
-    return CreateContactLeadSchema.parse({ contactName: 'Contato Um', ...overrides });
+    return LeadWriteBaseSchema.parse({ contactName: 'Contato Um', ...overrides });
   }
 
   async function systemStageCount(orgId: string): Promise<number> {
     const [row] = await adminClient<Array<{ n: number }>>`
-      SELECT count(*)::int AS n FROM sales_ops_lead_stages
-      WHERE org_id = ${orgId} AND kind <> 'normal'`;
+      SELECT count(*)::int AS n FROM sales_ops_pipeline_stages
+      WHERE org_id = ${orgId} AND type <> 'normal'`;
     return row!.n;
   }
 
   async function stageIds(orgId: string): Promise<string[]> {
     const rows = await adminClient<Array<{ id: string }>>`
-      SELECT id FROM sales_ops_lead_stages WHERE org_id = ${orgId}`;
+      SELECT id FROM sales_ops_pipeline_stages WHERE org_id = ${orgId}`;
     return rows.map((row) => row.id).sort();
   }
 
@@ -188,7 +185,7 @@ describe('sales operations leads edition: contact leads, vendedor-only pessoas,
     const orgId = newOrg('create');
     const stage = await normalStage(orgId, 'Contato');
 
-    const lead = okLead(await createContactLead(db, orgId, contactLead(), ADMIN_SCOPE));
+    const lead = okLead(await createLead(db, orgId, contactLead(), ADMIN_SCOPE));
     expect(lead).toMatchObject({
       contactName: 'Contato Um',
       clientId: null,
@@ -204,12 +201,13 @@ describe('sales operations leads edition: contact leads, vendedor-only pessoas,
     const [row] = await adminClient<
       Array<{ client_id: string | null; client_name_snapshot: string; estimated_value_brl: number }>
     >`
-      SELECT client_id, client_name_snapshot, estimated_value_brl FROM sales_ops_leads
+      SELECT client_id, client_name_snapshot, estimated_value_brl FROM sales_ops_crm_leads
       WHERE org_id = ${orgId} AND id = ${lead.id}`;
     expect(row).toEqual({ client_id: null, client_name_snapshot: '', estimated_value_brl: 0 });
     const [products] = await adminClient<Array<{ n: number }>>`
-      SELECT count(*)::int AS n FROM sales_ops_lead_products
-      WHERE org_id = ${orgId} AND lead_id = ${lead.id}`;
+      SELECT count(*)::int AS n FROM sales_ops_crm_lead_field_values v
+      JOIN sales_ops_field_definitions f ON f.id = v.field_id AND f.key = 'produtos'
+      WHERE v.org_id = ${orgId} AND v.lead_id = ${lead.id}`;
     expect(products!.n).toBe(0);
   });
 
@@ -218,7 +216,7 @@ describe('sales operations leads edition: contact leads, vendedor-only pessoas,
     await normalStage(orgId, 'Contato');
 
     const lead = okLead(
-      await createContactLead(
+      await createLead(
         db,
         orgId,
         contactLead({
@@ -240,8 +238,11 @@ describe('sales operations leads edition: contact leads, vendedor-only pessoas,
     const [row] = await adminClient<
       Array<{ contact_phone: string; contact_email: string; birth: string }>
     >`
-      SELECT contact_phone, contact_email, contact_birth_date::text AS birth
-      FROM sales_ops_leads WHERE org_id = ${orgId} AND id = ${lead.id}`;
+      SELECT l.contact_phone, l.contact_email,
+        (SELECT v.value_date::text FROM sales_ops_crm_lead_field_values v
+           JOIN sales_ops_field_definitions f ON f.id = v.field_id AND f.key = 'nascimento'
+          WHERE v.lead_id = l.id) AS birth
+      FROM sales_ops_crm_leads l WHERE l.org_id = ${orgId} AND l.id = ${lead.id}`;
     expect(row).toEqual({
       contact_phone: '(11) 98888-7777',
       contact_email: 'ana@example.com',
@@ -253,7 +254,7 @@ describe('sales operations leads edition: contact leads, vendedor-only pessoas,
     const orgId = newOrg('update');
     await normalStage(orgId, 'Contato');
     const created = okLead(
-      await createContactLead(
+      await createLead(
         db,
         orgId,
         contactLead({
@@ -266,11 +267,11 @@ describe('sales operations leads edition: contact leads, vendedor-only pessoas,
     );
 
     const first = okLead(
-      await updateContactLead(
+      await updateLead(
         db,
         orgId,
         created.id,
-        UpdateContactLeadSchema.parse({ contactPhone: '' }),
+        LeadPatchSchema.parse({ contactPhone: '' }),
         ADMIN_SCOPE,
       ),
     );
@@ -282,11 +283,11 @@ describe('sales operations leads edition: contact leads, vendedor-only pessoas,
     });
 
     const second = okLead(
-      await updateContactLead(
+      await updateLead(
         db,
         orgId,
         created.id,
-        UpdateContactLeadSchema.parse({ contactBirthDate: '1991-01-02', contactName: 'Novo Nome' }),
+        LeadPatchSchema.parse({ contactBirthDate: '1991-01-02', contactName: 'Novo Nome' }),
         ADMIN_SCOPE,
       ),
     );
@@ -307,7 +308,7 @@ describe('sales operations leads edition: contact leads, vendedor-only pessoas,
     const a = await normalStage(orgId, 'A');
     const b = await normalStage(orgId, 'B');
     const lead = okLead(
-      await createContactLead(db, orgId, contactLead({ contactEmail: 'x@y.co' }), ADMIN_SCOPE),
+      await createLead(db, orgId, contactLead({ contactEmail: 'x@y.co' }), ADMIN_SCOPE),
     );
     expect(lead.stageId).toBe(a.id);
 
@@ -340,7 +341,7 @@ describe('sales operations leads edition: contact leads, vendedor-only pessoas,
 
   it('refuses a lead when the org has no etapa at all (no_open_stage)', async () => {
     const orgId = newOrg('nostage');
-    await expect(createContactLead(db, orgId, contactLead(), ADMIN_SCOPE)).rejects.toMatchObject({
+    await expect(createLead(db, orgId, contactLead(), ADMIN_SCOPE)).rejects.toMatchObject({
       name: 'LeadInputError',
       code: 'no_open_stage',
     });
@@ -353,7 +354,7 @@ describe('sales operations leads edition: contact leads, vendedor-only pessoas,
     const stage = await normalStage(orgId, 'Unica');
     const archived = await updateLeadStage(db, orgId, stage.id, { status: 'archived' });
     expect(archived).toMatchObject({ status: 'archived' });
-    await expect(createContactLead(db, orgId, contactLead(), ADMIN_SCOPE)).rejects.toMatchObject({
+    await expect(createLead(db, orgId, contactLead(), ADMIN_SCOPE)).rejects.toMatchObject({
       name: 'LeadInputError',
       code: 'no_open_stage',
     });
@@ -365,14 +366,14 @@ describe('sales operations leads edition: contact leads, vendedor-only pessoas,
     const b = await normalStage(orgId, 'B');
     const vendedor = await leadsVendedor(orgId, 'Ana');
     const lead = okLead(
-      await createContactLead(db, orgId, contactLead({ sellerPersonId: vendedor.id }), ADMIN_SCOPE),
+      await createLead(db, orgId, contactLead({ sellerPersonId: vendedor.id }), ADMIN_SCOPE),
     );
     okLead(
-      await updateContactLead(
+      await updateLead(
         db,
         orgId,
         lead.id,
-        UpdateContactLeadSchema.parse({ contactPhone: '11 9999' }),
+        LeadPatchSchema.parse({ contactPhone: '11 9999' }),
         ADMIN_SCOPE,
       ),
     );
@@ -411,10 +412,10 @@ describe('sales operations leads edition: contact leads, vendedor-only pessoas,
       WHERE org_id = ${orgId} AND id = ${ana.id}`;
 
     okLead(
-      await createContactLead(db, orgId, contactLead({ sellerPersonId: ana.id }), ADMIN_SCOPE),
+      await createLead(db, orgId, contactLead({ sellerPersonId: ana.id }), ADMIN_SCOPE),
     );
     okLead(
-      await createContactLead(db, orgId, contactLead({ sellerPersonId: bruno.id }), ADMIN_SCOPE),
+      await createLead(db, orgId, contactLead({ sellerPersonId: bruno.id }), ADMIN_SCOPE),
     );
 
     const anaBoard = await listLeads(
@@ -427,7 +428,7 @@ describe('sales operations leads edition: contact leads, vendedor-only pessoas,
     expect(anaBoard.leads.map((lead) => lead.sellerPersonId)).toEqual([ana.id]);
 
     expect(
-      await createContactLead(
+      await createLead(
         db,
         orgId,
         contactLead({ sellerPersonId: bruno.id }),
@@ -435,7 +436,7 @@ describe('sales operations leads edition: contact leads, vendedor-only pessoas,
       ),
     ).toEqual({ ok: false, reason: 'seller_scope' });
     okLead(
-      await createContactLead(
+      await createLead(
         db,
         orgId,
         contactLead({ sellerPersonId: ana.id }),
@@ -471,7 +472,7 @@ describe('sales operations leads edition: contact leads, vendedor-only pessoas,
       WHERE org_id = ${orgId} AND id = ${ana.id}`;
 
     const absent = okLead(
-      await createContactLead(
+      await createLead(
         db,
         orgId,
         contactLead({ contactName: 'Sem vendedor' }),
@@ -481,7 +482,7 @@ describe('sales operations leads edition: contact leads, vendedor-only pessoas,
     expect(absent).toMatchObject({ sellerPersonId: ana.id, sellerNameSnapshot: 'Ana' });
 
     const explicitNull = okLead(
-      await createContactLead(
+      await createLead(
         db,
         orgId,
         contactLead({ contactName: 'Vendedor nulo', sellerPersonId: null }),
@@ -491,7 +492,7 @@ describe('sales operations leads edition: contact leads, vendedor-only pessoas,
     expect(explicitNull.sellerPersonId).toBe(ana.id);
 
     expect(
-      await createContactLead(
+      await createLead(
         db,
         orgId,
         contactLead({ sellerPersonId: bruno.id }),
@@ -512,33 +513,37 @@ describe('sales operations leads edition: contact leads, vendedor-only pessoas,
     ]);
 
     // An admin naming no vendedor still files an UNASSIGNED lead.
-    const unassigned = okLead(await createContactLead(db, orgId, contactLead(), ADMIN_SCOPE));
+    const unassigned = okLead(await createLead(db, orgId, contactLead(), ADMIN_SCOPE));
     expect(unassigned).toMatchObject({ sellerPersonId: null, sellerNameSnapshot: '' });
   });
 
-  it('FXL oracle: a full-edition seller naming no vendedor still answers seller_scope', async () => {
+  it('W2: a full-edition seller naming no vendedor files the lead as their own; naming another is seller_scope', async () => {
     const orgId = newOrg('fxlscope');
     await ensureLeadStagesForOrg(db, orgId);
     const ana = await leadsVendedor(orgId, 'Ana');
+    const bruno = await leadsVendedor(orgId, 'Bruno');
     await adminClient`
       UPDATE sales_ops_people SET hub_account_id = 'hub_ana'
       WHERE org_id = ${orgId} AND id = ${ana.id}`;
 
+    const body = {
+      contactName: 'Contato Um',
+      clientName: 'Empresa Um',
+      estimatedValueBrl: 1000,
+    };
+    const own = await createLead(db, orgId, LeadWriteBaseSchema.parse(body), sellerScope('hub_ana'));
+    expect(okLead(own)).toMatchObject({ sellerPersonId: ana.id, sellerNameSnapshot: 'Ana' });
     expect(
       await createLead(
         db,
         orgId,
-        CreateLeadSchema.parse({
-          contactName: 'Contato Um',
-          clientName: 'Empresa Um',
-          estimatedValueBrl: 1000,
-        }),
+        LeadWriteBaseSchema.parse({ ...body, sellerPersonId: bruno.id }),
         sellerScope('hub_ana'),
       ),
     ).toEqual({ ok: false, reason: 'seller_scope' });
     const [row] = await adminClient<Array<{ n: number }>>`
-      SELECT count(*)::int AS n FROM sales_ops_leads WHERE org_id = ${orgId}`;
-    expect(row!.n).toBe(0);
+      SELECT count(*)::int AS n FROM sales_ops_crm_leads WHERE org_id = ${orgId}`;
+    expect(row!.n).toBe(1);
   });
 
   it('seeds both system funções and makes a leads-edition pessoa exactly a vendedor', async () => {
@@ -718,7 +723,7 @@ describe('sales operations leads edition: contact leads, vendedor-only pessoas,
       });
       expect(await funcaoSlugsOfPerson(orgId, people[0]!.id)).toEqual(['vendedor']);
 
-      const own = okLead(await createContactLead(db, orgId, contactLead(), scope));
+      const own = okLead(await createLead(db, orgId, contactLead(), scope));
       expect(own).toMatchObject({
         sellerPersonId: people[0]!.id,
         sellerNameSnapshot: 'João Vendedor',
@@ -886,7 +891,7 @@ describe('sales operations leads edition: contact leads, vendedor-only pessoas,
           boardOf(orgId, stage.id, scope),
           boardOf(orgId, stage.id, scope),
           boardOf(orgId, stage.id, scope),
-          createContactLead(db, orgId, contactLead(), scope),
+          createLead(db, orgId, contactLead(), scope),
         ]);
         expect({ round, oks: results.map((result) => result.ok) }).toEqual({
           round,
@@ -986,7 +991,7 @@ describe('sales operations leads edition: contact leads, vendedor-only pessoas,
       await createLead(
         db,
         orgId,
-        CreateLeadSchema.parse({
+        LeadWriteBaseSchema.parse({
           contactName: 'Contato Um',
           clientName: 'Empresa Um',
           estimatedValueBrl: 250000,
```

#### `apps/api/test/rls/leads-lixeira.test.ts` (edit, 41 changed lines)

```diff
diff --git a/apps/api/test/rls/leads-lixeira.test.ts b/apps/api/test/rls/leads-lixeira.test.ts
index a41039a..7c6dd7a 100644
--- a/apps/api/test/rls/leads-lixeira.test.ts
+++ b/apps/api/test/rls/leads-lixeira.test.ts
@@ -38,22 +38,20 @@ import * as schema from '../../src/db/schema.js';
 import { testDatabaseUrls } from '../../src/db/__tests__/test-database-urls.js';
 import { computeEntryHash } from '../../src/domains/audit/service.js';
 import {
-  CreateContactLeadSchema,
-  CreateLeadSchema,
+  LeadPatchSchema,
+  LeadWriteBaseSchema,
   ListLeadsQuerySchema,
   MoveLeadSchema,
-  UpdateLeadSchema,
 } from '../../src/domains/sales-ops/leads/lead-schemas.js';
 import {
   LeadInputError,
-  type LeadScope,
-  type LeadView,
-  type WriteLeadResult,
-  createContactLead,
   createLead,
   getLead,
   listLeads,
   moveLead,
+  type LeadScope,
+  type LeadView,
+  type WriteLeadResult,
   updateLead,
 } from '../../src/domains/sales-ops/leads/lead-service.js';
 import {
@@ -66,6 +64,7 @@ import { LeadStageSchema } from '../../src/domains/sales-ops/leads/schemas.js';
 import { createLeadStage, updateLeadStage } from '../../src/domains/sales-ops/leads/stage-service.js';
 import { ensureLeadStagesForOrg } from '../../src/domains/sales-ops/leads/stages-seed.js';
 import { PersonSchema, createPerson } from '../../src/domains/sales-ops/service.js';
+import { deleteCrmForOrgs } from '../../src/db/__tests__/settlement-test-cleanup.js';
 
 const { leadsRouter } = await import('../../src/domains/sales-ops/leads/lead-routes.js');
 
@@ -155,9 +154,7 @@ describe('sales operations leads: the lixeira', () => {
     for (const orgId of orgIds) {
       // Our entries are the ledger tail because the integration project runs files serially.
       await adminClient`DELETE FROM audit_log WHERE actor_org_id = ${orgId}`;
-      await adminClient`DELETE FROM sales_ops_lead_products WHERE org_id = ${orgId}`;
-      await adminClient`DELETE FROM sales_ops_leads WHERE org_id = ${orgId}`;
-      await adminClient`DELETE FROM sales_ops_lead_stages WHERE org_id = ${orgId}`;
+      await deleteCrmForOrgs([orgId]);
       await adminClient`DELETE FROM sales_ops_payables WHERE org_id = ${orgId}`;
       await adminClient`DELETE FROM sales_ops_receivables WHERE org_id = ${orgId}`;
       await adminClient`DELETE FROM sales_ops_sale_items WHERE org_id = ${orgId}`;
@@ -171,7 +168,7 @@ describe('sales operations leads: the lixeira', () => {
       await adminClient`DELETE FROM sales_ops_funcoes WHERE org_id = ${orgId}`;
       await adminClient`DELETE FROM sales_ops_clients WHERE org_id = ${orgId}`;
     }
-    await adminClient.unsafe(`DROP TRIGGER IF EXISTS fxl_lixeira_commit_probe_trg ON sales_ops_leads`);
+    await adminClient.unsafe(`DROP TRIGGER IF EXISTS fxl_lixeira_commit_probe_trg ON sales_ops_crm_leads`);
     await adminClient.unsafe(`DROP FUNCTION IF EXISTS fxl_lixeira_commit_probe()`);
     await closeDb();
     await appClient.end();
@@ -217,7 +214,7 @@ describe('sales operations leads: the lixeira', () => {
       await createLead(
         db,
         orgId,
-        CreateLeadSchema.parse({
+        LeadWriteBaseSchema.parse({
           contactName,
           clientName: 'Empresa Pool',
           estimatedValueBrl: 100000,
@@ -245,7 +242,7 @@ describe('sales operations leads: the lixeira', () => {
       }>
     >`SELECT seller_person_id, seller_name_snapshot, stage_id, "position", contact_name, lost_reason,
              stage_changed_at, deleted_at, deleted_by_user_id, deleted_by_name, updated_at
-      FROM sales_ops_leads WHERE id = ${leadId}`;
+      FROM sales_ops_crm_leads WHERE id = ${leadId}`;
     return row!;
   }
 
@@ -258,7 +255,7 @@ describe('sales operations leads: the lixeira', () => {
 
   async function livePositions(orgId: string, stageId: string) {
     const rows = await adminClient<Array<{ contact_name: string; position: number }>>`
-      SELECT contact_name, "position" FROM sales_ops_leads
+      SELECT contact_name, "position" FROM sales_ops_crm_leads
       WHERE org_id = ${orgId} AND stage_id = ${stageId} AND deleted_at IS NULL
       ORDER BY "position"`;
     return rows.map((row) => [row.contact_name, row.position]);
@@ -275,14 +272,14 @@ describe('sales operations leads: the lixeira', () => {
       CREATE OR REPLACE FUNCTION fxl_lixeira_commit_probe() RETURNS trigger AS $$
       BEGIN RAISE EXCEPTION 'fxl_lixeira_commit_probe'; END $$ LANGUAGE plpgsql`);
     await adminClient.unsafe(`
-      CREATE CONSTRAINT TRIGGER fxl_lixeira_commit_probe_trg AFTER UPDATE ON sales_ops_leads
+      CREATE CONSTRAINT TRIGGER fxl_lixeira_commit_probe_trg AFTER UPDATE ON sales_ops_crm_leads
         DEFERRABLE INITIALLY DEFERRED
         FOR EACH ROW WHEN (NEW.id = '${leadId}')
         EXECUTE FUNCTION fxl_lixeira_commit_probe()`);
     try {
       return await run();
     } finally {
-      await adminClient.unsafe(`DROP TRIGGER IF EXISTS fxl_lixeira_commit_probe_trg ON sales_ops_leads`);
+      await adminClient.unsafe(`DROP TRIGGER IF EXISTS fxl_lixeira_commit_probe_trg ON sales_ops_crm_leads`);
       await adminClient.unsafe(`DROP FUNCTION IF EXISTS fxl_lixeira_commit_probe()`);
     }
   }
@@ -310,7 +307,7 @@ describe('sales operations leads: the lixeira', () => {
     expect(open.leads.map((lead) => lead.position)).toEqual([1, 2]);
 
     expect(await getLead(db, w.orgId, a.id, ADMIN_SCOPE)).toEqual(NOT_FOUND);
-    expect(await updateLead(db, w.orgId, a.id, UpdateLeadSchema.parse({ contactName: 'X' }), ADMIN_SCOPE)).toEqual(
+    expect(await updateLead(db, w.orgId, a.id, LeadPatchSchema.parse({ contactName: 'X' }), ADMIN_SCOPE)).toEqual(
       NOT_FOUND,
     );
     expect(
@@ -569,7 +566,7 @@ describe('sales operations leads: the lixeira', () => {
     expect(result.lead.lostReason).toBeNull();
     expect(new Date(result.lead.stageChangedAt).getTime()).toBeGreaterThan(s1.getTime());
     const restored = (await auditFor(lead.id))[1]!;
-    expect((restored.before_jsonb as { stageName: string }).stageName).toBe('Em negociação');
+    expect((restored.before_jsonb as { stageName: string }).stageName).toBe(w.second.name);
     expect((restored.after_jsonb as { metadata: { stageName: string } }).metadata.stageName).toBe('Novo');
 
     // Leads edition with no open etapa left: the existing 400 sentinel, and nothing is seeded.
@@ -578,10 +575,10 @@ describe('sales operations leads: the lixeira', () => {
     if (unico === 'duplicate') throw new Error('duplicate stage');
     const carla = await vendedor(org2, 'Carla', 'hub_carla', true);
     const contact = okLead(
-      await createContactLead(
+      await createLead(
         db,
         org2,
-        CreateContactLeadSchema.parse({ contactName: 'Contato' }),
+        LeadWriteBaseSchema.parse({ contactName: 'Contato' }),
         leadsSellerScope('hub_carla'),
       ),
     );
@@ -596,7 +593,7 @@ describe('sales operations leads: the lixeira', () => {
     expect((await rowOf(contact.id)).deleted_at).not.toBeNull();
     expect(await auditFor(contact.id)).toHaveLength(1);
     const stageCount = await adminClient<{ n: number }[]>`
-      SELECT count(*)::int AS n FROM sales_ops_lead_stages WHERE org_id = ${org2}`;
+      SELECT count(*)::int AS n FROM sales_ops_pipeline_stages WHERE org_id = ${org2}`;
     expect(stageCount[0]!.n).toBe(1);
   });
 
@@ -618,7 +615,7 @@ describe('sales operations leads: the lixeira', () => {
     // Through ::text first: postgres.js serializes a timestamptz-typed parameter
     // via a JS Date and would round the instant to milliseconds.
     const setAt = (id: string, at: string) =>
-      adminClient`UPDATE sales_ops_leads SET deleted_at = ${at}::text::timestamptz WHERE id = ${id}`;
+      adminClient`UPDATE sales_ops_crm_leads SET deleted_at = ${at}::text::timestamptz WHERE id = ${id}`;
     await setAt(l1.id, '2026-10-01T12:00:00.123456Z');
     await setAt(l2.id, '2026-10-01T12:00:00.123400Z');
     await setAt(l3.id, '2026-10-01T12:00:00.123400Z');
```

#### `apps/api/test/rls/leads-move-concurrency.test.ts` (edit, 34 changed lines)

```diff
diff --git a/apps/api/test/rls/leads-move-concurrency.test.ts b/apps/api/test/rls/leads-move-concurrency.test.ts
index e2dc209..b8335f3 100644
--- a/apps/api/test/rls/leads-move-concurrency.test.ts
+++ b/apps/api/test/rls/leads-move-concurrency.test.ts
@@ -24,16 +24,20 @@ import postgres from 'postgres';
 import { afterAll, beforeAll, describe, expect, it } from 'vitest';
 import * as schema from '../../src/db/schema.js';
 import { testDatabaseUrls } from '../../src/db/__tests__/test-database-urls.js';
-import { CreateLeadSchema, MoveLeadSchema } from '../../src/domains/sales-ops/leads/lead-schemas.js';
 import {
+  LeadWriteBaseSchema,
+  MoveLeadSchema,
+} from '../../src/domains/sales-ops/leads/lead-schemas.js';
+import {
+  createLead,
+  moveLead,
   type LeadScope,
   type LeadView,
   type WriteLeadResult,
-  createLead,
-  moveLead,
 } from '../../src/domains/sales-ops/leads/lead-service.js';
 import { ensureLeadStagesForOrg } from '../../src/domains/sales-ops/leads/stages-seed.js';
 import { PersonSchema, createPerson, withTenant } from '../../src/domains/sales-ops/service.js';
+import { deleteCrmForOrgs } from '../../src/db/__tests__/settlement-test-cleanup.js';
 
 const { appUrl: APP_DB_URL, adminUrl: ADMIN_DB_URL } = testDatabaseUrls();
 const ADMIN_CONNECTION_OPTIONS = { connection: { 'app.fxl_admin': 'true' } } as const;
@@ -88,9 +92,7 @@ describe('sales operations leads: concurrent board writes never deadlock and kee
 
   afterAll(async () => {
     for (const orgId of orgIds) {
-      await adminClient`DELETE FROM sales_ops_lead_products WHERE org_id = ${orgId}`;
-      await adminClient`DELETE FROM sales_ops_leads WHERE org_id = ${orgId}`;
-      await adminClient`DELETE FROM sales_ops_lead_stages WHERE org_id = ${orgId}`;
+      await deleteCrmForOrgs([orgId]);
       await adminClient`DELETE FROM sales_ops_person_funcoes WHERE org_id = ${orgId}`;
       await adminClient`DELETE FROM sales_ops_people WHERE org_id = ${orgId}`;
       await adminClient`DELETE FROM sales_ops_funcoes WHERE org_id = ${orgId}`;
@@ -126,7 +128,7 @@ describe('sales operations leads: concurrent board writes never deadlock and kee
       await createLead(
         db,
         orgId,
-        CreateLeadSchema.parse({
+        LeadWriteBaseSchema.parse({
           contactName,
           clientName: 'Empresa',
           estimatedValueBrl: 100000,
@@ -144,7 +146,7 @@ describe('sales operations leads: concurrent board writes never deadlock and kee
   /** One column as [contactName, position] pairs, in board order, read where RLS hides nothing. */
   async function column(orgId: string, stageId: string) {
     const rows = await adminClient<Array<{ contact_name: string; position: number }>>`
-      SELECT contact_name, "position" FROM sales_ops_leads
+      SELECT contact_name, "position" FROM sales_ops_crm_leads
       WHERE org_id = ${orgId} AND stage_id = ${stageId}
       ORDER BY "position", id`;
     return rows.map((row) => [row.contact_name, row.position]);
@@ -155,7 +157,7 @@ describe('sales operations leads: concurrent board writes never deadlock and kee
       Array<{ seller_person_id: string | null; stage_id: string; position: number; stage_changed_us: string }>
     >`SELECT seller_person_id, stage_id, "position",
              (EXTRACT(EPOCH FROM stage_changed_at)::numeric * 1000000)::bigint::text AS stage_changed_us
-      FROM sales_ops_leads WHERE id = ${leadId}`;
+      FROM sales_ops_crm_leads WHERE id = ${leadId}`;
     return row!;
   }
 
@@ -165,7 +167,7 @@ describe('sales operations leads: concurrent board writes never deadlock and kee
    * writer at a known point (a card its renumber must lock next, or the vendedor
    * row a lead INSERT's foreign-key check must share-lock).
    */
-  async function holdRow(table: 'sales_ops_leads' | 'sales_ops_people', orgId: string, id: string) {
+  async function holdRow(table: 'sales_ops_crm_leads' | 'sales_ops_people', orgId: string, id: string) {
     let release!: () => void;
     const released = new Promise<void>((resolve) => {
       release = resolve;
@@ -213,7 +215,7 @@ describe('sales operations leads: concurrent board writes never deadlock and kee
 
     // Ana's move is parked on `Trava`, the first card its source-column renumber
     // locks after the destination column; Bruno's card sits after it, still free.
-    const hold = await holdRow('sales_ops_leads', w.orgId, parked.id);
+    const hold = await holdRow('sales_ops_crm_leads', w.orgId, parked.id);
     let outcomes: Outcome[];
     try {
       const first = outcomeOf(move(w.orgId, poolAna.id, w.negociacao.id, 0, sellerScope('hub_ana')));
@@ -254,7 +256,7 @@ describe('sales operations leads: concurrent board writes never deadlock and kee
 
     // Ana's reorder is parked on `Trava`, right after her own card in the
     // column's (position, id) lock order; Bruno's card is last and still free.
-    const hold = await holdRow('sales_ops_leads', w.orgId, parked.id);
+    const hold = await holdRow('sales_ops_crm_leads', w.orgId, parked.id);
     let outcomes: Outcome[];
     try {
       const first = outcomeOf(move(w.orgId, anas.id, w.novo.id, 3, sellerScope('hub_ana')));
@@ -290,7 +292,7 @@ describe('sales operations leads: concurrent board writes never deadlock and kee
 
     // Ana's move has claimed the card (uncommitted) and is parked renumbering the
     // source column, on `Trava`.
-    const hold = await holdRow('sales_ops_leads', w.orgId, parked.id);
+    const hold = await holdRow('sales_ops_crm_leads', w.orgId, parked.id);
     let outcomes: Outcome[];
     try {
       const first = outcomeOf(move(w.orgId, pool.id, w.negociacao.id, 0, sellerScope('hub_ana')));
@@ -329,14 +331,14 @@ describe('sales operations leads: concurrent board writes never deadlock and kee
         createLead(
           db,
           w.orgId,
-          CreateLeadSchema.parse({ contactName: 'Primeiro', clientName: 'Empresa', sellerPersonId: w.ana.id }),
+          LeadWriteBaseSchema.parse({ contactName: 'Primeiro', clientName: 'Empresa', sellerPersonId: w.ana.id }),
           ADMIN_SCOPE,
         ),
       );
       const firstPid = (await blockedBehind(hold.pid))!;
       let secondSettled = false;
       const second = outcomeOf(
-        createLead(db, w.orgId, CreateLeadSchema.parse({ contactName: 'Segundo', clientName: 'Empresa' }), ADMIN_SCOPE),
+        createLead(db, w.orgId, LeadWriteBaseSchema.parse({ contactName: 'Segundo', clientName: 'Empresa' }), ADMIN_SCOPE),
       ).finally(() => {
         secondSettled = true;
       });
@@ -378,7 +380,7 @@ describe('sales operations leads: concurrent board writes never deadlock and kee
     });
     const importing = withTenant(db, w.orgId, async (tx) => {
       okLead(
-        await createLead(tx, w.orgId, CreateLeadSchema.parse({ contactName: 'Importado', clientName: 'Empresa' }), ADMIN_SCOPE),
+        await createLead(tx, w.orgId, LeadWriteBaseSchema.parse({ contactName: 'Importado', clientName: 'Empresa' }), ADMIN_SCOPE),
       );
       const [self] = (await tx.execute(sql`SELECT pg_backend_pid() AS pid`)) as unknown as Array<{ pid: number }>;
       started(self!.pid);
```

#### `apps/api/test/rls/leads-no-financial-impact.test.ts` (edit, 16 changed lines)

```diff
diff --git a/apps/api/test/rls/leads-no-financial-impact.test.ts b/apps/api/test/rls/leads-no-financial-impact.test.ts
index f18e06a..986d434 100644
--- a/apps/api/test/rls/leads-no-financial-impact.test.ts
+++ b/apps/api/test/rls/leads-no-financial-impact.test.ts
@@ -12,11 +12,14 @@ import { drizzle } from 'drizzle-orm/postgres-js';
 import postgres from 'postgres';
 import { afterAll, beforeAll, describe, expect, it } from 'vitest';
 import * as schema from '../../src/db/schema.js';
-import { CreateLeadSchema, MoveLeadSchema } from '../../src/domains/sales-ops/leads/lead-schemas.js';
 import {
-  type LeadScope,
+  LeadWriteBaseSchema,
+  MoveLeadSchema,
+} from '../../src/domains/sales-ops/leads/lead-schemas.js';
+import {
   createLead,
   moveLead,
+  type LeadScope,
 } from '../../src/domains/sales-ops/leads/lead-service.js';
 import { ensureLeadStagesForOrg } from '../../src/domains/sales-ops/leads/stages-seed.js';
 import {
@@ -34,6 +37,7 @@ import {
 } from '../../src/domains/sales-ops/service.js';
 import { firstRow } from './first-row.js';
 import { testDatabaseUrls } from '../../src/db/__tests__/test-database-urls.js';
+import { deleteCrmForOrgs } from '../../src/db/__tests__/settlement-test-cleanup.js';
 
 const { appUrl: APP_DB_URL, adminUrl: ADMIN_DB_URL } = testDatabaseUrls();
 const ADMIN_CONNECTION_OPTIONS = { connection: { 'app.fxl_admin': 'true' } } as const;
@@ -54,9 +58,7 @@ describe('leads move no existing financial number', () => {
 
   afterAll(async () => {
     for (const orgId of orgIds) {
-      await adminClient`DELETE FROM sales_ops_lead_products WHERE org_id = ${orgId}`;
-      await adminClient`DELETE FROM sales_ops_leads WHERE org_id = ${orgId}`;
-      await adminClient`DELETE FROM sales_ops_lead_stages WHERE org_id = ${orgId}`;
+      await deleteCrmForOrgs([orgId]);
       await adminClient`DELETE FROM sales_ops_payables WHERE org_id = ${orgId}`;
       await adminClient`DELETE FROM sales_ops_receivables WHERE org_id = ${orgId}`;
       await adminClient`DELETE FROM sales_ops_sale_items WHERE org_id = ${orgId}`;
@@ -133,7 +135,7 @@ describe('leads move no existing financial number', () => {
       const lead = await createLead(
         db,
         orgId,
-        CreateLeadSchema.parse({
+        LeadWriteBaseSchema.parse({
           contactName,
           clientName: 'Empresa em negociação',
           estimatedValueBrl: 9_900_000,
@@ -158,7 +160,7 @@ describe('leads move no existing financial number', () => {
 
     // The leads really exist, so the three assertions below are not vacuous.
     const { count } = firstRow(await adminClient<{ count: string }[]>`
-      SELECT count(*)::text AS count FROM sales_ops_leads WHERE org_id = ${orgId}`, 'count');
+      SELECT count(*)::text AS count FROM sales_ops_crm_leads WHERE org_id = ${orgId}`, 'count');
     expect(count).toBe('3');
 
     expect(await getSalesOpsSummary(db, orgId)).toEqual(before.summary);
```

#### `apps/api/test/rls/leads-rls.test.ts` (edit, 144 changed lines)

```diff
diff --git a/apps/api/test/rls/leads-rls.test.ts b/apps/api/test/rls/leads-rls.test.ts
index 01e1779..6691372 100644
--- a/apps/api/test/rls/leads-rls.test.ts
+++ b/apps/api/test/rls/leads-rls.test.ts
@@ -6,6 +6,7 @@ import * as schema from '../../src/db/schema.js';
 import { ensureLeadStagesForOrg } from '../../src/domains/sales-ops/leads/stages-seed.js';
 import { firstRow } from './first-row.js';
 import { testDatabaseUrls } from '../../src/db/__tests__/test-database-urls.js';
+import { deleteCrmForOrgs } from '../../src/db/__tests__/settlement-test-cleanup.js';
 
 /**
  * Slice 01 ships exactly ONE service function for the leads domain,
@@ -61,7 +62,7 @@ describe('sales operations leads persistence and RLS', () => {
 
   function stageCount(orgId: string) {
     return adminClient<{ count: string }[]>`
-      SELECT count(*)::text AS count FROM sales_ops_lead_stages WHERE org_id = ${orgId}
+      SELECT count(*)::text AS count FROM sales_ops_pipeline_stages WHERE org_id = ${orgId}
     `;
   }
 
@@ -104,12 +105,17 @@ describe('sales operations leads persistence and RLS', () => {
     return row.id;
   }
 
-  async function insertStage(orgId: string, name: string): Promise<string> {
+  /** A bare default pipeline and one normal stage of it; returns both ids. */
+  async function insertStage(orgId: string, name: string): Promise<{ id: string; pipelineId: string }> {
+    const pipeline = firstRow(await adminClient<{ id: string }[]>`
+      INSERT INTO sales_ops_pipelines (org_id, name, system_key, is_default)
+      VALUES (${orgId}, 'Funil CRM padrão', 'crm-padrao', true) RETURNING id
+    `, 'pipeline');
     const row = firstRow(await adminClient<{ id: string }[]>`
-      INSERT INTO sales_ops_lead_stages (org_id, name, kind, is_system, "position")
-      VALUES (${orgId}, ${name}, 'normal', false, 1) RETURNING id
+      INSERT INTO sales_ops_pipeline_stages (org_id, pipeline_id, name, type, "position")
+      VALUES (${orgId}, ${pipeline.id}, ${name}, 'normal', 1) RETURNING id
     `, 'row');
-    return row.id;
+    return { id: row.id, pipelineId: pipeline.id };
   }
 
   beforeAll(() => {
@@ -123,9 +129,7 @@ describe('sales operations leads persistence and RLS', () => {
   afterAll(async () => {
     for (const orgId of orgIds) {
       // Children first, or the restrict FKs reject the delete.
-      await adminClient`DELETE FROM sales_ops_lead_products WHERE org_id = ${orgId}`;
-      await adminClient`DELETE FROM sales_ops_leads WHERE org_id = ${orgId}`;
-      await adminClient`DELETE FROM sales_ops_lead_stages WHERE org_id = ${orgId}`;
+      await deleteCrmForOrgs([orgId]);
       await adminClient`DELETE FROM sales_ops_sales WHERE org_id = ${orgId}`;
       await adminClient`DELETE FROM sales_ops_products WHERE org_id = ${orgId}`;
       await adminClient`DELETE FROM sales_ops_clients WHERE org_id = ${orgId}`;
@@ -140,18 +144,30 @@ describe('sales operations leads persistence and RLS', () => {
     const [orgA] = newOrgPair('seed');
 
     const first = await ensureLeadStagesForOrg(db, orgA);
+    // The default CRM pipeline (7 stages); `kind` and `isSystem` are the derived legacy projection.
     expect(first.map((stage) => stage.name)).toEqual([
       'Novo',
+      'Qualificação',
       'Em negociação',
       'Proposta',
+      'Ganho',
       'Perdido',
+      'Pausado',
+    ]);
+    expect(first.map((stage) => stage.kind)).toEqual([
+      'normal',
+      'normal',
+      'normal',
+      'conversion',
+      'normal',
+      'lost',
+      'normal',
     ]);
-    expect(first.map((stage) => stage.kind)).toEqual(['normal', 'normal', 'conversion', 'lost']);
-    expect(first.map((stage) => stage.isSystem)).toEqual([false, false, true, true]);
+    expect(first.map((stage) => stage.isSystem)).toEqual([false, false, false, true, false, true, false]);
 
     const second = await ensureLeadStagesForOrg(db, orgA);
     expect(second.map((stage) => stage.id)).toEqual(first.map((stage) => stage.id));
-    expect(firstRow(await stageCount(orgA), 'the count').count).toBe('4');
+    expect(firstRow(await stageCount(orgA), 'the count').count).toBe('7');
   });
 
   it('ensureLeadStagesForOrg never re-inserts a stage the org has renamed or archived', async () => {
@@ -162,19 +178,19 @@ describe('sales operations leads persistence and RLS', () => {
     expect(novo).toBeDefined();
 
     await adminClient`
-      UPDATE sales_ops_lead_stages
+      UPDATE sales_ops_pipeline_stages
       SET name = 'Prospecção', status = 'archived', archived_at = now()
       WHERE id = ${novo!.id}
     `;
 
     const again = await ensureLeadStagesForOrg(db, orgA);
-    expect(again).toHaveLength(4);
+    expect(again).toHaveLength(7);
     expect(again.some((stage) => stage.name === 'Novo')).toBe(false);
     expect(again.some((stage) => stage.name === 'Prospecção')).toBe(true);
-    expect(firstRow(await stageCount(orgA), 'the count').count).toBe('4');
+    expect(firstRow(await stageCount(orgA), 'the count').count).toBe('7');
   });
 
-  it('two concurrent first calls for the same org still leave exactly four stages', async () => {
+  it('two concurrent first calls for the same org still leave exactly seven stages', async () => {
     const [orgA] = newOrgPair('race');
 
     const [left, right] = await Promise.all([
@@ -182,12 +198,12 @@ describe('sales operations leads persistence and RLS', () => {
       ensureLeadStagesForOrg(db, orgA),
     ]);
 
-    expect(left).toHaveLength(4);
-    expect(right).toHaveLength(4);
+    expect(left).toHaveLength(7);
+    expect(right).toHaveLength(7);
     expect(new Set(left.map((stage) => stage.id))).toEqual(
       new Set(right.map((stage) => stage.id)),
     );
-    expect(firstRow(await stageCount(orgA), 'the count').count).toBe('4');
+    expect(firstRow(await stageCount(orgA), 'the count').count).toBe('7');
   });
 
   it('scopes the stage read by orgId even when RLS is not doing the scoping', async () => {
@@ -196,13 +212,13 @@ describe('sales operations leads persistence and RLS', () => {
     const stagesA = await ensureLeadStagesForOrg(adminDb, orgA);
     const stagesB = await ensureLeadStagesForOrg(adminDb, orgB);
 
-    expect(stagesA).toHaveLength(4);
-    expect(stagesB).toHaveLength(4);
+    expect(stagesA).toHaveLength(7);
+    expect(stagesB).toHaveLength(7);
     expect(stagesA.every((stage) => stage.orgId === orgA)).toBe(true);
     expect(stagesB.every((stage) => stage.orgId === orgB)).toBe(true);
   });
 
-  it('raw RLS blocks cross-org reads of lead stages, leads and lead products and WITH CHECK blocks smuggled inserts', async () => {
+  it('raw RLS blocks cross-org reads of pipeline stages, leads and lead field values and WITH CHECK blocks smuggled inserts', async () => {
     // The migrate/admin connection is a cluster superuser and therefore always
     // bypasses row security, FORCE ROW LEVEL SECURITY included. To prove the
     // policies themselves are correct (not just the service layer's explicit
@@ -215,7 +231,7 @@ describe('sales operations leads persistence and RLS', () => {
     );
     await adminClient.unsafe(`GRANT USAGE ON SCHEMA public TO ${roleName}`);
     await adminClient.unsafe(
-      `GRANT SELECT, INSERT, UPDATE, DELETE ON sales_ops_lead_stages, sales_ops_leads, sales_ops_lead_products TO ${roleName}`,
+      `GRANT SELECT, INSERT, UPDATE, DELETE ON sales_ops_pipelines, sales_ops_pipeline_stages, sales_ops_crm_leads, sales_ops_field_definitions, sales_ops_crm_lead_field_values TO ${roleName}`,
     );
 
     const roleClient = postgres(withRole(APP_DB_URL, roleName, rolePassword), { max: 1 });
@@ -225,19 +241,29 @@ describe('sales operations leads persistence and RLS', () => {
 
       const { stageId, leadId, leadProductId } = await roleClient.begin(async (tx) => {
         await tx`SELECT set_config('app.current_org_id', ${ORG_A}, true)`;
+        const [pipeline] = await tx`
+          INSERT INTO sales_ops_pipelines (org_id, name, system_key, is_default)
+          VALUES (${ORG_A}, 'Funil CRM padrão', 'crm-padrao', true) RETURNING id
+        `;
+        const pipelineId = (pipeline as { id: string }).id;
         const [stage] = await tx`
-          INSERT INTO sales_ops_lead_stages (org_id, name, kind, is_system, "position")
-          VALUES (${ORG_A}, 'RLS Probe Etapa', 'normal', false, 1) RETURNING id
+          INSERT INTO sales_ops_pipeline_stages (org_id, pipeline_id, name, type, "position")
+          VALUES (${ORG_A}, ${pipelineId}, 'RLS Probe Etapa', 'normal', 1) RETURNING id
         `;
         const [lead] = await tx`
-          INSERT INTO sales_ops_leads (
-            org_id, contact_name, client_name_snapshot, stage_id
-          ) VALUES (${ORG_A}, 'RLS Probe Lead', 'Empresa', ${(stage as { id: string }).id})
+          INSERT INTO sales_ops_crm_leads (
+            org_id, contact_name, client_name_snapshot, pipeline_id, stage_id
+          ) VALUES (${ORG_A}, 'RLS Probe Lead', 'Empresa', ${pipelineId}, ${(stage as { id: string }).id})
           RETURNING id
         `;
+        const [field] = await tx`
+          INSERT INTO sales_ops_field_definitions (org_id, key, label, kind, reference_target, multiple)
+          VALUES (${ORG_A}, 'produtos', 'Produtos', 'reference', 'produto', true) RETURNING id
+        `;
         const [leadProduct] = await tx`
-          INSERT INTO sales_ops_lead_products (org_id, lead_id, product_name_snapshot)
-          VALUES (${ORG_A}, ${(lead as { id: string }).id}, 'Produto livre') RETURNING id
+          INSERT INTO sales_ops_crm_lead_field_values (org_id, lead_id, field_id, position, value_text, ref_name_snapshot)
+          VALUES (${ORG_A}, ${(lead as { id: string }).id}, ${(field as { id: string }).id}, 0, 'Produto livre', 'Produto livre')
+          RETURNING id
         `;
         return {
           stageId: (stage as { id: string }).id,
@@ -250,9 +276,9 @@ describe('sales operations leads persistence and RLS', () => {
       const own = await roleClient.begin(async (tx) => {
         await tx`SELECT set_config('app.current_org_id', ${ORG_A}, true)`;
         return [
-          await tx`SELECT id FROM sales_ops_lead_stages WHERE id = ${stageId}`,
-          await tx`SELECT id FROM sales_ops_leads WHERE id = ${leadId}`,
-          await tx`SELECT id FROM sales_ops_lead_products WHERE id = ${leadProductId}`,
+          await tx`SELECT id FROM sales_ops_pipeline_stages WHERE id = ${stageId}`,
+          await tx`SELECT id FROM sales_ops_crm_leads WHERE id = ${leadId}`,
+          await tx`SELECT id FROM sales_ops_crm_lead_field_values WHERE id = ${leadProductId}`,
         ];
       });
       expect(own[0]).toHaveLength(1);
@@ -263,9 +289,9 @@ describe('sales operations leads persistence and RLS', () => {
       const other = await roleClient.begin(async (tx) => {
         await tx`SELECT set_config('app.current_org_id', ${ORG_B}, true)`;
         return [
-          await tx`SELECT id FROM sales_ops_lead_stages WHERE id = ${stageId}`,
-          await tx`SELECT id FROM sales_ops_leads WHERE id = ${leadId}`,
-          await tx`SELECT id FROM sales_ops_lead_products WHERE id = ${leadProductId}`,
+          await tx`SELECT id FROM sales_ops_pipeline_stages WHERE id = ${stageId}`,
+          await tx`SELECT id FROM sales_ops_crm_leads WHERE id = ${leadId}`,
+          await tx`SELECT id FROM sales_ops_crm_lead_field_values WHERE id = ${leadProductId}`,
         ];
       });
       expect(other[0]).toHaveLength(0);
@@ -277,8 +303,8 @@ describe('sales operations leads persistence and RLS', () => {
         roleClient.begin(async (tx) => {
           await tx`SELECT set_config('app.current_org_id', ${ORG_A}, true)`;
           return tx`
-            INSERT INTO sales_ops_lead_stages (org_id, name, kind, is_system, "position")
-            VALUES (${ORG_B}, 'Etapa contrabandeada', 'normal', false, 1) RETURNING id
+            INSERT INTO sales_ops_pipeline_stages (org_id, pipeline_id, name, type, "position")
+            VALUES (${ORG_B}, (SELECT pipeline_id FROM sales_ops_pipeline_stages WHERE id = ${stageId}), 'Etapa contrabandeada', 'normal', 1) RETURNING id
           `;
         }),
       ).rejects.toThrow();
@@ -287,8 +313,9 @@ describe('sales operations leads persistence and RLS', () => {
         roleClient.begin(async (tx) => {
           await tx`SELECT set_config('app.current_org_id', ${ORG_A}, true)`;
           return tx`
-            INSERT INTO sales_ops_leads (org_id, contact_name, client_name_snapshot, stage_id)
-            VALUES (${ORG_B}, 'Lead contrabandeado', 'Empresa', ${stageId}) RETURNING id
+            INSERT INTO sales_ops_crm_leads (org_id, contact_name, client_name_snapshot, pipeline_id, stage_id)
+            VALUES (${ORG_B}, 'Lead contrabandeado', 'Empresa',
+              (SELECT pipeline_id FROM sales_ops_pipeline_stages WHERE id = ${stageId}), ${stageId}) RETURNING id
           `;
         }),
       ).rejects.toThrow();
@@ -296,7 +323,7 @@ describe('sales operations leads persistence and RLS', () => {
       // With no org context set at all, nothing is readable.
       const noContext = await roleClient.begin(async (tx) => {
         await tx`SELECT set_config('app.current_org_id', '', true)`;
-        return tx`SELECT id FROM sales_ops_leads WHERE id = ${leadId}`;
+        return tx`SELECT id FROM sales_ops_crm_leads WHERE id = ${leadId}`;
       });
       expect(noContext).toHaveLength(0);
     } finally {
@@ -318,49 +345,54 @@ describe('sales operations leads persistence and RLS', () => {
 
     const insertLeadIn = (
       orgId: string,
-      stageId: string,
+      stage: { id: string; pipelineId: string },
       extra: { clientId?: string; sellerPersonId?: string; saleId?: string } = {},
     ) => adminClient<{ id: string }[]>`
-      INSERT INTO sales_ops_leads (
+      INSERT INTO sales_ops_crm_leads (
         org_id, contact_name, client_id, client_name_snapshot,
-        seller_person_id, stage_id, sale_id
+        seller_person_id, pipeline_id, stage_id, sale_id
       ) VALUES (
         ${orgId}, 'Contato', ${extra.clientId ?? null}, 'Empresa',
-        ${extra.sellerPersonId ?? null}, ${stageId}, ${extra.saleId ?? null}
+        ${extra.sellerPersonId ?? null}, ${stage.pipelineId}, ${stage.id}, ${extra.saleId ?? null}
       ) RETURNING id
     `;
 
-    await expect(insertLeadIn(orgA, stageB)).rejects.toThrow(/sales_ops_leads_org_stage_fk/);
+    await expect(insertLeadIn(orgA, stageB)).rejects.toThrow(/sales_ops_crm_leads_org_pipeline_fk|sales_ops_crm_leads_org_stage_fk/);
     await expect(insertLeadIn(orgA, stageA, { clientId: clientB })).rejects.toThrow(
-      /sales_ops_leads_org_client_fk/,
+      /sales_ops_crm_leads_org_client_fk/,
     );
     await expect(insertLeadIn(orgA, stageA, { sellerPersonId: personB })).rejects.toThrow(
-      /sales_ops_leads_org_seller_fk/,
+      /sales_ops_crm_leads_org_seller_fk/,
     );
     await expect(insertLeadIn(orgA, stageA, { saleId: saleB })).rejects.toThrow(
-      /sales_ops_leads_org_sale_fk/,
+      /sales_ops_crm_leads_org_sale_fk/,
     );
 
     // Positive control: the same shape, all in org A, lands.
     const leadA = firstRow(await insertLeadIn(orgA, stageA), 'leadA');
     expect(leadA.id).toEqual(expect.any(String));
 
+    // Field values: the product reference and the lead reference are composite and org-scoped too.
+    const produtos = firstRow(await adminClient<{ id: string }[]>`
+      INSERT INTO sales_ops_field_definitions (org_id, key, label, kind, reference_target, multiple)
+      VALUES (${orgA}, 'produtos', 'Produtos', 'reference', 'produto', true) RETURNING id
+    `, 'produtos');
     await expect(adminClient`
-      INSERT INTO sales_ops_lead_products (org_id, lead_id, product_id, product_name_snapshot)
-      VALUES (${orgA}, ${leadA.id}, ${productB}, 'Produto B')
-    `).rejects.toThrow(/sales_ops_lead_products_org_product_fk/);
+      INSERT INTO sales_ops_crm_lead_field_values (org_id, lead_id, field_id, position, value_product_id, ref_name_snapshot)
+      VALUES (${orgA}, ${leadA.id}, ${produtos.id}, 0, ${productB}, 'Produto B')
+    `).rejects.toThrow(/sales_ops_crm_lead_field_values_org_product_fk/);
 
     const leadB = firstRow(await insertLeadIn(orgB, stageB), 'leadB');
     await expect(adminClient`
-      INSERT INTO sales_ops_lead_products (org_id, lead_id, product_name_snapshot)
-      VALUES (${orgA}, ${leadB.id}, 'Produto livre')
-    `).rejects.toThrow(/sales_ops_lead_products_org_lead_fk/);
+      INSERT INTO sales_ops_crm_lead_field_values (org_id, lead_id, field_id, position, value_text)
+      VALUES (${orgA}, ${leadB.id}, ${produtos.id}, 0, 'Produto livre')
+    `).rejects.toThrow(/sales_ops_crm_lead_field_values_org_lead_fk/);
 
     // Positive control: a same-org produto row lands.
     const productA = await insertProduct(orgA, 'Produto A');
     await expect(adminClient`
-      INSERT INTO sales_ops_lead_products (org_id, lead_id, product_id, product_name_snapshot)
-      VALUES (${orgA}, ${leadA.id}, ${productA}, 'Produto A')
+      INSERT INTO sales_ops_crm_lead_field_values (org_id, lead_id, field_id, position, value_product_id, ref_name_snapshot)
+      VALUES (${orgA}, ${leadA.id}, ${produtos.id}, 0, ${productA}, 'Produto A')
     `).resolves.toBeDefined();
   });
 });
```

#### `apps/api/test/rls/leads-seller-scope.test.ts` (edit, 55 changed lines)

```diff
diff --git a/apps/api/test/rls/leads-seller-scope.test.ts b/apps/api/test/rls/leads-seller-scope.test.ts
index e0f191c..fc7a7d0 100644
--- a/apps/api/test/rls/leads-seller-scope.test.ts
+++ b/apps/api/test/rls/leads-seller-scope.test.ts
@@ -19,18 +19,18 @@ import postgres from 'postgres';
 import { afterAll, beforeAll, describe, expect, it } from 'vitest';
 import * as schema from '../../src/db/schema.js';
 import {
-  CreateLeadSchema,
+  LeadPatchSchema,
+  LeadWriteBaseSchema,
   ListLeadsQuerySchema,
   MoveLeadSchema,
-  UpdateLeadSchema,
 } from '../../src/domains/sales-ops/leads/lead-schemas.js';
 import {
   LeadInputError,
-  type LeadScope,
   createLead,
   getLead,
   listLeads,
   moveLead,
+  type LeadScope,
   updateLead,
 } from '../../src/domains/sales-ops/leads/lead-service.js';
 import { ensureLeadStagesForOrg } from '../../src/domains/sales-ops/leads/stages-seed.js';
@@ -47,6 +47,7 @@ import {
   updatePerson,
 } from '../../src/domains/sales-ops/service.js';
 import { testDatabaseUrls } from '../../src/db/__tests__/test-database-urls.js';
+import { deleteCrmForOrgs } from '../../src/db/__tests__/settlement-test-cleanup.js';
 
 const { appUrl: APP_DB_URL, adminUrl: ADMIN_DB_URL } = testDatabaseUrls();
 const ADMIN_CONNECTION_OPTIONS = { connection: { 'app.fxl_admin': 'true' } } as const;
@@ -85,9 +86,7 @@ describe('sales operations leads: seller scope, movement and isolation', () => {
     for (const orgId of orgIds) {
       // FK order: lead products, then leads (which reference stages, clientes,
       // pessoas and vendas), then everything they pointed at.
-      await adminClient`DELETE FROM sales_ops_lead_products WHERE org_id = ${orgId}`;
-      await adminClient`DELETE FROM sales_ops_leads WHERE org_id = ${orgId}`;
-      await adminClient`DELETE FROM sales_ops_lead_stages WHERE org_id = ${orgId}`;
+      await deleteCrmForOrgs([orgId]);
       await adminClient`DELETE FROM sales_ops_payables WHERE org_id = ${orgId}`;
       await adminClient`DELETE FROM sales_ops_receivables WHERE org_id = ${orgId}`;
       await adminClient`DELETE FROM sales_ops_sale_items WHERE org_id = ${orgId}`;
@@ -142,7 +141,7 @@ describe('sales operations leads: seller scope, movement and isolation', () => {
   }
 
   function leadPayload(overrides: Record<string, unknown> = {}) {
-    return CreateLeadSchema.parse({
+    return LeadWriteBaseSchema.parse({
       contactName: 'Contato Um',
       clientName: 'Empresa Um',
       estimatedValueBrl: 250000,
@@ -409,7 +408,7 @@ describe('sales operations leads: seller scope, movement and isolation', () => {
         adminDb,
         orgA,
         idB,
-        UpdateLeadSchema.parse({ contactName: 'hijack' }),
+        LeadPatchSchema.parse({ contactName: 'hijack' }),
         ADMIN_SCOPE,
       ),
     ).toEqual({ ok: false, reason: 'not_found' });
@@ -441,7 +440,7 @@ describe('sales operations leads: seller scope, movement and isolation', () => {
 
     const readStamp = async (id: string) => {
       const [row] = await adminClient<{ stage_changed_at: Date }[]>`
-        SELECT stage_changed_at FROM sales_ops_leads WHERE id = ${id}`;
+        SELECT stage_changed_at FROM sales_ops_crm_leads WHERE id = ${id}`;
       return row!.stage_changed_at;
     };
     const before = await readStamp(secondId);
@@ -458,12 +457,12 @@ describe('sales operations leads: seller scope, movement and isolation', () => {
 
     expect(await readStamp(secondId)).toEqual(before);
     const [reordered] = await adminClient<{ id: string; position: number }[]>`
-      SELECT id, "position" FROM sales_ops_leads
+      SELECT id, "position" FROM sales_ops_crm_leads
       WHERE org_id = ${orgId} ORDER BY "position" ASC`;
     expect(reordered!.id).toBe(secondId);
     // And the card that was pushed down really moved, so the reorder happened.
     const [, pushed] = await adminClient<{ id: string; position: number }[]>`
-      SELECT id, "position" FROM sales_ops_leads
+      SELECT id, "position" FROM sales_ops_crm_leads
       WHERE org_id = ${orgId} ORDER BY "position" ASC`;
     expect(pushed!.id).toBe(firstId);
   });
@@ -486,7 +485,7 @@ describe('sales operations leads: seller scope, movement and isolation', () => {
     const readStampMicros = async () => {
       const [row] = await adminClient<{ micros: string }[]>`
         SELECT (EXTRACT(EPOCH FROM stage_changed_at)::numeric * 1000000)::bigint AS micros
-        FROM sales_ops_leads WHERE id = ${id}`;
+        FROM sales_ops_crm_leads WHERE id = ${id}`;
       return BigInt(row!.micros);
     };
 
@@ -528,7 +527,7 @@ describe('sales operations leads: seller scope, movement and isolation', () => {
         db,
         orgId,
         id,
-        UpdateLeadSchema.parse({ contactName: 'Outro Contato', estimatedValueBrl: 999 }),
+        LeadPatchSchema.parse({ contactName: 'Outro Contato', estimatedValueBrl: 999 }),
         ADMIN_SCOPE,
       ),
     );
@@ -554,7 +553,7 @@ describe('sales operations leads: seller scope, movement and isolation', () => {
 
     const [row] = await adminClient<
       { stage_id: string; position: number; lost_reason: string | null }[]
-    >`SELECT stage_id, "position", lost_reason FROM sales_ops_leads WHERE id = ${id}`;
+    >`SELECT stage_id, "position", lost_reason FROM sales_ops_crm_leads WHERE id = ${id}`;
     expect(row!.stage_id).toBe(open.id);
     expect(row!.position).toBe(1);
     expect(row!.lost_reason).toBeNull();
@@ -570,7 +569,7 @@ describe('sales operations leads: seller scope, movement and isolation', () => {
       ),
     );
     const [moved] = await adminClient<{ stage_id: string; lost_reason: string | null }[]>`
-      SELECT stage_id, lost_reason FROM sales_ops_leads WHERE id = ${id}`;
+      SELECT stage_id, lost_reason FROM sales_ops_crm_leads WHERE id = ${id}`;
     expect(moved!.stage_id).toBe(lost.id);
     expect(moved!.lost_reason).toBe('preço fora do orçamento');
   });
@@ -671,7 +670,7 @@ describe('sales operations leads: seller scope, movement and isolation', () => {
         adminDb,
         orgA,
         id,
-        UpdateLeadSchema.parse({ contactName: 'Depois' }),
+        LeadPatchSchema.parse({ contactName: 'Depois' }),
         ADMIN_SCOPE,
       ),
     ).toEqual({ ok: false, reason: 'already_converted' });
@@ -735,7 +734,7 @@ describe('sales operations leads: seller scope, movement and isolation', () => {
       ),
     );
     await expectOk(
-      updateLead(db, orgId, id, UpdateLeadSchema.parse({ contactName: 'Editado' }), ADMIN_SCOPE),
+      updateLead(db, orgId, id, LeadPatchSchema.parse({ contactName: 'Editado' }), ADMIN_SCOPE),
     );
     await expectOk(
       moveLead(
@@ -789,7 +788,7 @@ describe('sales operations leads: seller scope, movement and isolation', () => {
         db,
         orgId,
         lead.id,
-        UpdateLeadSchema.parse({ products: [{ productName: 'Somente este' }] }),
+        LeadPatchSchema.parse({ products: [{ productName: 'Somente este' }] }),
         ADMIN_SCOPE,
       ),
     );
@@ -799,13 +798,13 @@ describe('sales operations leads: seller scope, movement and isolation', () => {
 
     // An absent key leaves the child rows alone; [] clears them.
     const untouched = await expectOk(
-      updateLead(db, orgId, lead.id, UpdateLeadSchema.parse({ contactName: 'X' }), ADMIN_SCOPE),
+      updateLead(db, orgId, lead.id, LeadPatchSchema.parse({ contactName: 'X' }), ADMIN_SCOPE),
     );
     expect((untouched as unknown as { lead: { products: unknown[] } }).lead.products).toHaveLength(
       1,
     );
     const cleared = await expectOk(
-      updateLead(db, orgId, lead.id, UpdateLeadSchema.parse({ products: [] }), ADMIN_SCOPE),
+      updateLead(db, orgId, lead.id, LeadPatchSchema.parse({ products: [] }), ADMIN_SCOPE),
     );
     expect((cleared as unknown as { lead: { products: unknown[] } }).lead.products).toEqual([]);
   });
@@ -830,7 +829,7 @@ describe('sales operations leads: seller scope, movement and isolation', () => {
     );
     const [row] = await adminClient<
       { client_name_snapshot: string; seller_name_snapshot: string }[]
-    >`SELECT client_name_snapshot, seller_name_snapshot FROM sales_ops_leads
+    >`SELECT client_name_snapshot, seller_name_snapshot FROM sales_ops_crm_leads
       WHERE id = ${(created as unknown as { lead: { id: string } }).lead.id}`;
     expect(row!.client_name_snapshot).toBe('Empresa Cadastrada');
     expect(row!.seller_name_snapshot).toBe('Ana Martins');
@@ -888,12 +887,14 @@ describe('sales operations leads: seller scope, movement and isolation', () => {
     if (!adminBoard.ok) throw new Error(`unexpected refusal: ${adminBoard.reason}`);
     expect(adminBoard.leads).toHaveLength(1);
 
-    // Seeing the pool is not filing into it: the create rules did not change, and
-    // a full-edition seller may still not file an UNASSIGNED lead.
-    expect(await createLead(db, orgId, leadPayload(), sellerScope('hub_ana'))).toEqual({
-      ok: false,
-      reason: 'seller_scope',
-    });
+    // Seeing the pool is not filing into it. Since the phase 2 cutover a seller who names no vendedor
+    // files the lead as their OWN in both editions (W2); naming a colleague is still seller_scope.
+    const own = await createLead(db, orgId, leadPayload({ contactName: 'Minha' }), sellerScope('hub_ana'));
+    if (!own.ok) throw new Error(`unexpected refusal: ${own.reason}`);
+    expect(own.lead.sellerPersonId).toBe(ana.id);
+    expect(
+      await createLead(db, orgId, leadPayload({ sellerPersonId: bruno.id }), sellerScope('hub_ana')),
+    ).toEqual({ ok: false, reason: 'seller_scope' });
   });
 
   it('paginates one column by the (position, id) keyset', async () => {
```

#### `apps/api/test/rls/leads-stage-summary.test.ts` (edit, 17 changed lines)

```diff
diff --git a/apps/api/test/rls/leads-stage-summary.test.ts b/apps/api/test/rls/leads-stage-summary.test.ts
index 4d05de2..8aaed22 100644
--- a/apps/api/test/rls/leads-stage-summary.test.ts
+++ b/apps/api/test/rls/leads-stage-summary.test.ts
@@ -5,23 +5,24 @@ import { afterAll, beforeAll, describe, expect, it } from 'vitest';
 import * as schema from '../../src/db/schema.js';
 import { testDatabaseUrls } from '../../src/db/__tests__/test-database-urls.js';
 import {
-  CreateLeadSchema,
   LeadStageSummaryQuerySchema,
+  LeadWriteBaseSchema,
   ListLeadsQuerySchema,
   MoveLeadSchema,
 } from '../../src/domains/sales-ops/leads/lead-schemas.js';
 import {
-  type LeadScope,
-  type LeadView,
-  type WriteLeadResult,
   createLead,
   listLeads,
   moveLead,
   summarizeLeadStages,
+  type LeadScope,
+  type LeadView,
+  type WriteLeadResult,
 } from '../../src/domains/sales-ops/leads/lead-service.js';
 import { deleteLead } from '../../src/domains/sales-ops/leads/lead-trash-service.js';
 import { ensureLeadStagesForOrg } from '../../src/domains/sales-ops/leads/stages-seed.js';
 import { PersonSchema, createPerson } from '../../src/domains/sales-ops/service.js';
+import { deleteCrmForOrgs } from '../../src/db/__tests__/settlement-test-cleanup.js';
 
 // Org assertions are made over `adminDb` (where only the service's own org
 // predicate scopes the read); seller assertions are load-bearing over either
@@ -69,9 +70,7 @@ describe('sales operations leads: per-stage summary', () => {
       // is safe only because the integration project runs with
       // `fileParallelism: false`, so no other file appends meanwhile.
       await adminClient`DELETE FROM audit_log WHERE actor_org_id = ${orgId}`;
-      await adminClient`DELETE FROM sales_ops_lead_products WHERE org_id = ${orgId}`;
-      await adminClient`DELETE FROM sales_ops_leads WHERE org_id = ${orgId}`;
-      await adminClient`DELETE FROM sales_ops_lead_stages WHERE org_id = ${orgId}`;
+      await deleteCrmForOrgs([orgId]);
       await adminClient`DELETE FROM sales_ops_payables WHERE org_id = ${orgId}`;
       await adminClient`DELETE FROM sales_ops_receivables WHERE org_id = ${orgId}`;
       await adminClient`DELETE FROM sales_ops_sale_items WHERE org_id = ${orgId}`;
@@ -122,7 +121,7 @@ describe('sales operations leads: per-stage summary', () => {
       await createLead(
         db,
         orgId,
-        CreateLeadSchema.parse({
+        LeadWriteBaseSchema.parse({
           contactName,
           clientName: 'Empresa Soma',
           estimatedValueBrl: valueCents,
@@ -385,7 +384,7 @@ describe('sales operations leads: per-stage summary', () => {
     await deleteLead(db, w.orgId, moved.id, ADMIN_SCOPE, actor);
     for (const id of [pool.id, moved.id]) {
       const [row] = await adminClient<{ deleted_at: Date | null }[]>`
-        SELECT deleted_at FROM sales_ops_leads WHERE id = ${id}`;
+        SELECT deleted_at FROM sales_ops_crm_leads WHERE id = ${id}`;
       expect(row!.deleted_at).not.toBeNull();
     }
```

#### `apps/api/test/rls/leads-unassigned-claim.test.ts` (edit, 65 changed lines)

```diff
diff --git a/apps/api/test/rls/leads-unassigned-claim.test.ts b/apps/api/test/rls/leads-unassigned-claim.test.ts
index 7123d9b..a4a9a3f 100644
--- a/apps/api/test/rls/leads-unassigned-claim.test.ts
+++ b/apps/api/test/rls/leads-unassigned-claim.test.ts
@@ -5,29 +5,26 @@ import { afterAll, beforeAll, describe, expect, it } from 'vitest';
 import * as schema from '../../src/db/schema.js';
 import { testDatabaseUrls } from '../../src/db/__tests__/test-database-urls.js';
 import {
-  CreateContactLeadSchema,
-  CreateLeadSchema,
+  LeadPatchSchema,
+  LeadWriteBaseSchema,
   ListLeadsQuerySchema,
   MoveLeadSchema,
-  UpdateContactLeadSchema,
-  UpdateLeadSchema,
 } from '../../src/domains/sales-ops/leads/lead-schemas.js';
 import {
-  type LeadScope,
-  type LeadView,
-  type WriteLeadResult,
-  createContactLead,
   createLead,
   getLead,
   listLeads,
   moveLead,
-  updateContactLead,
+  type LeadScope,
+  type LeadView,
+  type WriteLeadResult,
   updateLead,
 } from '../../src/domains/sales-ops/leads/lead-service.js';
 import { LeadStageSchema } from '../../src/domains/sales-ops/leads/schemas.js';
 import { createLeadStage } from '../../src/domains/sales-ops/leads/stage-service.js';
 import { ensureLeadStagesForOrg } from '../../src/domains/sales-ops/leads/stages-seed.js';
 import { PersonSchema, createPerson } from '../../src/domains/sales-ops/service.js';
+import { deleteCrmForOrgs } from '../../src/db/__tests__/settlement-test-cleanup.js';
 
 const { appUrl: APP_DB_URL, adminUrl: ADMIN_DB_URL } = testDatabaseUrls();
 const ADMIN_CONNECTION_OPTIONS = { connection: { 'app.fxl_admin': 'true' } } as const;
@@ -73,9 +70,7 @@ describe('sales operations leads: the unassigned pool and claim-on-write', () =>
     for (const orgId of orgIds) {
       // Defensive: nothing here should write a ledger row.
       await adminClient`DELETE FROM audit_log WHERE actor_org_id = ${orgId}`;
-      await adminClient`DELETE FROM sales_ops_lead_products WHERE org_id = ${orgId}`;
-      await adminClient`DELETE FROM sales_ops_leads WHERE org_id = ${orgId}`;
-      await adminClient`DELETE FROM sales_ops_lead_stages WHERE org_id = ${orgId}`;
+      await deleteCrmForOrgs([orgId]);
       await adminClient`DELETE FROM sales_ops_payables WHERE org_id = ${orgId}`;
       await adminClient`DELETE FROM sales_ops_receivables WHERE org_id = ${orgId}`;
       await adminClient`DELETE FROM sales_ops_sale_items WHERE org_id = ${orgId}`;
@@ -148,7 +143,7 @@ describe('sales operations leads: the unassigned pool and claim-on-write', () =>
       await createLead(
         db,
         orgId,
-        CreateLeadSchema.parse({
+        LeadWriteBaseSchema.parse({
           contactName,
           clientName: 'Empresa Pool',
           estimatedValueBrl: 100000,
@@ -162,7 +157,7 @@ describe('sales operations leads: the unassigned pool and claim-on-write', () =>
   /** A leads-edition lead an admin filed naming no vendedor: unassigned. */
   async function poolContact(orgId: string, contactName: string) {
     return okLead(
-      await createContactLead(db, orgId, CreateContactLeadSchema.parse({ contactName }), ADMIN_SCOPE),
+      await createLead(db, orgId, LeadWriteBaseSchema.parse({ contactName }), ADMIN_SCOPE),
     );
   }
 
@@ -180,7 +175,7 @@ describe('sales operations leads: the unassigned pool and claim-on-write', () =>
       }>
     >`SELECT seller_person_id, seller_name_snapshot, stage_id, "position", contact_name,
              contact_phone, sale_id, updated_at
-      FROM sales_ops_leads WHERE id = ${leadId}`;
+      FROM sales_ops_crm_leads WHERE id = ${leadId}`;
     return row!;
   }
 
@@ -211,9 +206,9 @@ describe('sales operations leads: the unassigned pool and claim-on-write', () =>
     });
     const done = adminClient.begin(async (sql) => {
       const [self] = await sql<Array<{ pid: number }>>`SELECT pg_backend_pid() AS pid`;
-      await sql`SELECT id FROM sales_ops_leads WHERE org_id = ${orgId} AND id = ${leadId} FOR UPDATE`;
+      await sql`SELECT id FROM sales_ops_crm_leads WHERE org_id = ${orgId} AND id = ${leadId} FOR UPDATE`;
       await sql`
-        UPDATE sales_ops_leads
+        UPDATE sales_ops_crm_leads
         SET seller_person_id = ${winner.id}, seller_name_snapshot = ${winner.displayName}, updated_at = now()
         WHERE org_id = ${orgId} AND id = ${leadId}`;
       locked(self!.pid);
@@ -314,7 +309,7 @@ describe('sales operations leads: the unassigned pool and claim-on-write', () =>
       await moveLead(adminDb, w.orgId, poolB.id, MoveLeadSchema.parse({ stageId: w.second.id, position: 0 }), ana),
     ).toEqual(NOT_FOUND);
     expect(
-      await updateLead(adminDb, w.orgId, poolB.id, UpdateLeadSchema.parse({ contactName: 'hijack' }), ana),
+      await updateLead(adminDb, w.orgId, poolB.id, LeadPatchSchema.parse({ contactName: 'hijack' }), ana),
     ).toEqual(NOT_FOUND);
     const row = await rowOf(poolB.id);
     expect(row.seller_person_id).toBeNull();
@@ -353,7 +348,7 @@ describe('sales operations leads: the unassigned pool and claim-on-write', () =>
     const micros = async () => {
       const [r] = await adminClient<{ micros: string }[]>`
         SELECT (EXTRACT(EPOCH FROM stage_changed_at)::numeric * 1000000)::bigint AS micros
-        FROM sales_ops_leads WHERE id = ${reorder.id}`;
+        FROM sales_ops_crm_leads WHERE id = ${reorder.id}`;
       return BigInt(r!.micros);
     };
     const before = await micros();
@@ -388,7 +383,7 @@ describe('sales operations leads: the unassigned pool and claim-on-write', () =>
     const ana = sellerScope('hub_ana');
 
     expect(
-      okLead(await updateLead(db, w.orgId, p1.id, UpdateLeadSchema.parse({ contactName: 'Editado' }), ana)),
+      okLead(await updateLead(db, w.orgId, p1.id, LeadPatchSchema.parse({ contactName: 'Editado' }), ana)),
     ).toMatchObject({ contactName: 'Editado', sellerPersonId: w.ana.id, sellerNameSnapshot: 'Ana Martins' });
     expect(
       okLead(
@@ -396,13 +391,13 @@ describe('sales operations leads: the unassigned pool and claim-on-write', () =>
           db,
           w.orgId,
           p2.id,
-          UpdateLeadSchema.parse({ sellerPersonId: null, description: 'nota' }),
+          LeadPatchSchema.parse({ sellerPersonId: null, description: 'nota' }),
           ana,
         ),
       ).sellerPersonId,
     ).toBe(w.ana.id);
     expect(
-      okLead(await updateLead(db, w.orgId, p3.id, UpdateLeadSchema.parse({ sellerPersonId: w.ana.id }), ana))
+      okLead(await updateLead(db, w.orgId, p3.id, LeadPatchSchema.parse({ sellerPersonId: w.ana.id }), ana))
         .sellerPersonId,
     ).toBe(w.ana.id);
 
@@ -411,7 +406,7 @@ describe('sales operations leads: the unassigned pool and claim-on-write', () =>
         db,
         w.orgId,
         p4.id,
-        UpdateLeadSchema.parse({ sellerPersonId: w.bruno.id, contactName: 'X' }),
+        LeadPatchSchema.parse({ sellerPersonId: w.bruno.id, contactName: 'X' }),
         ana,
       ),
     ).toEqual({ ok: false, reason: 'seller_scope' });
@@ -423,7 +418,7 @@ describe('sales operations leads: the unassigned pool and claim-on-write', () =>
 
     // Today's rule on an OWNED lead is unchanged.
     for (const sellerPersonId of [null, w.bruno.id]) {
-      expect(await updateLead(db, w.orgId, p1.id, UpdateLeadSchema.parse({ sellerPersonId }), ana)).toEqual({
+      expect(await updateLead(db, w.orgId, p1.id, LeadPatchSchema.parse({ sellerPersonId }), ana)).toEqual({
         ok: false,
         reason: 'seller_scope',
       });
@@ -443,12 +438,12 @@ describe('sales operations leads: the unassigned pool and claim-on-write', () =>
         db,
         w.orgId,
         pool.id,
-        UpdateLeadSchema.parse({ contactName: 'Nunca', products: [{ productId: randomUUID() }] }),
+        LeadPatchSchema.parse({ contactName: 'Nunca', products: [{ productId: randomUUID() }] }),
         ana,
       ),
     ).rejects.toMatchObject({ code: 'product_not_found' });
     await expect(
-      updateLead(db, w.orgId, pool.id, UpdateLeadSchema.parse({ clientId: randomUUID() }), ana),
+      updateLead(db, w.orgId, pool.id, LeadPatchSchema.parse({ clientId: randomUUID() }), ana),
     ).rejects.toMatchObject({ code: 'client_not_found' });
     await expect(
       moveLead(db, w.orgId, pool.id, MoveLeadSchema.parse({ stageId: randomUUID(), position: 0 }), ana),
@@ -464,7 +459,7 @@ describe('sales operations leads: the unassigned pool and claim-on-write', () =>
     expect(row.stage_id).toBe(w.open.id);
     expect(row.updated_at).toBeNull();
     const [products] = await adminClient<{ n: number }[]>`
-      SELECT count(*)::int AS n FROM sales_ops_lead_products WHERE lead_id = ${pool.id}`;
+      SELECT count(*)::int AS n FROM sales_ops_crm_lead_field_values WHERE lead_id = ${pool.id}`;
     expect(products!.n).toBe(0);
   });
 
@@ -475,7 +470,7 @@ describe('sales operations leads: the unassigned pool and claim-on-write', () =>
     const [c1, c2, c3, c4, c5, c6] = cs as [LeadView, LeadView, LeadView, LeadView, LeadView, LeadView];
     const ana = leadsSellerScope('hub_ana');
     const patch = (id: string, body: Record<string, unknown>) =>
-      updateContactLead(db, w.orgId, id, UpdateContactLeadSchema.parse(body), ana);
+      updateLead(db, w.orgId, id, LeadPatchSchema.parse(body), ana);
 
     expect(okLead(await patch(c1.id, { contactPhone: '(27) 99999-0000' }))).toMatchObject({
       contactPhone: '(27) 99999-0000',
@@ -576,7 +571,7 @@ describe('sales operations leads: the unassigned pool and claim-on-write', () =>
         db,
         w.orgId,
         pool.id,
-        UpdateLeadSchema.parse({ contactName: 'Bruno editou' }),
+        LeadPatchSchema.parse({ contactName: 'Bruno editou' }),
         sellerScope('hub_bruno'),
       ).finally(() => {
         settled = true;
@@ -624,7 +619,7 @@ describe('sales operations leads: the unassigned pool and claim-on-write', () =>
     expect((await rowOf(pool.id)).seller_person_id).toBeNull();
 
     const edited = okLead(
-      await updateLead(db, w.orgId, pool.id, UpdateLeadSchema.parse({ contactName: 'Admin editou' }), ADMIN_SCOPE),
+      await updateLead(db, w.orgId, pool.id, LeadPatchSchema.parse({ contactName: 'Admin editou' }), ADMIN_SCOPE),
     );
     expect(edited.sellerPersonId).toBeNull();
     const row = await rowOf(pool.id);
@@ -636,7 +631,7 @@ describe('sales operations leads: the unassigned pool and claim-on-write', () =>
     expect((await getLead(db, w.orgId, pool.id, sellerScope('hub_bruno'))).ok).toBe(true);
 
     const assigned = okLead(
-      await updateLead(db, w.orgId, pool.id, UpdateLeadSchema.parse({ sellerPersonId: w.ana.id }), ADMIN_SCOPE),
+      await updateLead(db, w.orgId, pool.id, LeadPatchSchema.parse({ sellerPersonId: w.ana.id }), ADMIN_SCOPE),
     );
     expect(assigned.sellerPersonId).toBe(w.ana.id);
     expect(assigned.sellerNameSnapshot).toBe('Ana Martins');
@@ -654,7 +649,7 @@ describe('sales operations leads: the unassigned pool and claim-on-write', () =>
       await moveLead(db, w.orgId, brunos.id, MoveLeadSchema.parse({ stageId: w.second.id, position: 0 }), ana),
     ).toEqual(NOT_FOUND);
     expect(
-      await updateLead(db, w.orgId, brunos.id, UpdateLeadSchema.parse({ contactName: 'hijack' }), ana),
+      await updateLead(db, w.orgId, brunos.id, LeadPatchSchema.parse({ contactName: 'hijack' }), ana),
     ).toEqual(NOT_FOUND);
     const brunoRow = await rowOf(brunos.id);
     expect(brunoRow.seller_person_id).toBe(w.bruno.id);
@@ -687,10 +682,10 @@ describe('sales operations leads: the unassigned pool and claim-on-write', () =>
       await moveLead(db, w.orgId, pool.id, MoveLeadSchema.parse({ stageId: w.open.id, position: 0 }), ana),
     ).toEqual(refused);
     expect(
-      await updateLead(db, w.orgId, pool.id, UpdateLeadSchema.parse({ contactName: 'Depois' }), ana),
+      await updateLead(db, w.orgId, pool.id, LeadPatchSchema.parse({ contactName: 'Depois' }), ana),
     ).toEqual(refused);
     expect(
-      await updateLead(db, w.orgId, pool.id, UpdateLeadSchema.parse({ sellerPersonId: w.ana.id }), ana),
+      await updateLead(db, w.orgId, pool.id, LeadPatchSchema.parse({ sellerPersonId: w.ana.id }), ana),
     ).toEqual(refused);
     const row = await rowOf(pool.id);
     expect(row.seller_person_id).toBeNull();
@@ -715,7 +710,7 @@ describe('sales operations leads: the unassigned pool and claim-on-write', () =>
     expect(
       await moveLead(db, w.orgId, pool.id, MoveLeadSchema.parse({ stageId: w.second.id, position: 0 }), fabio),
     ).toEqual(NOT_FOUND);
-    expect(await updateLead(db, w.orgId, pool.id, UpdateLeadSchema.parse({ contactName: 'X' }), fabio)).toEqual(
+    expect(await updateLead(db, w.orgId, pool.id, LeadPatchSchema.parse({ contactName: 'X' }), fabio)).toEqual(
       NOT_FOUND,
     );
```
