import { z } from 'zod';

/**
 * The wire contract for the lead stage cadastro. Imports ONLY zod - no database,
 * no service - which is what keeps `lead-stages-contract.test.ts` a pure unit
 * test.
 *
 * `kind`, `position`, `isSystem`, `orgId` and `archivedAt` have NO key here at
 * all, so zod strips them. That is the whole guard: a body carrying
 * `kind: 'conversion'` must not be able to mint a second conversion column, and
 * 01's partial unique index on (org_id, kind) is the database-level backstop if
 * one ever did. It mirrors FuncaoSchema never accepting slug/isSystem.
 *
 * There is no `slug` key, because sales_ops_lead_stages has no slug column:
 * `kind` is the machine key and it is unreachable from the API.
 */
export const LeadStageSchema = z.object({
  name: z.string().trim().min(1).max(120),
  status: z.enum(['active', 'archived']).default('active'),
});

/**
 * `.partial()` over a schema carrying a `.default()` keeps `parse({})` equal to
 * `{}`, exactly as UpdateFuncaoSchema does. Same spelling, deliberately.
 */
export const UpdateLeadStageSchema = LeadStageSchema.partial();

/**
 * The reorder payload is the COMPLETE ordered set of the org's ACTIVE stage ids.
 * A duplicate id would write two columns to one position and silently drop a
 * third from the board, so it is refused here rather than resolved.
 */
export const ReorderLeadStagesSchema = z
  .object({
    stageIds: z.array(z.string().uuid()).min(1),
  })
  .superRefine((value, ctx) => {
    if (new Set(value.stageIds).size === value.stageIds.length) return;
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'duplicate_stage_id',
      path: ['stageIds'],
    });
  });

export type LeadStageInput = z.infer<typeof LeadStageSchema>;
export type ReorderLeadStagesInput = z.infer<typeof ReorderLeadStagesSchema>;
