import { z } from 'zod';

/**
 * The wire contract of the pipeline writes (`POST /pipelines`, `PATCH /pipelines/:id`). Imports
 * ONLY zod, so its oracle stays a pure unit test.
 *
 * `isDefault`, `position`, `systemKey` and `orgId` have no key and `.strict()` refuses them: the
 * default pipeline is the seeded one and stays it, and a new pipeline is appended at the end.
 * Stages are not written here either: a new pipeline is born with the seven default etapas and
 * its etapas are edited through `/lead-stages` with the `pipelineId`.
 */
const pipelineName = z.string().trim().min(1).max(120);

/** The funções that reach the pipeline: a full set, duplicates refused. */
const funcaoIds = z
  .array(z.string().uuid())
  .max(100)
  .superRefine((ids, ctx) => {
    if (new Set(ids).size === ids.length) return;
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'duplicate_funcao_id' });
  });

export const CreatePipelineSchema = z
  .object({
    name: pipelineName,
    funcaoIds: funcaoIds.default([]),
  })
  .strict();

export const UpdatePipelineSchema = z
  .object({
    name: pipelineName.optional(),
    funcaoIds: funcaoIds.optional(),
    status: z.enum(['active', 'archived']).optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, { message: 'at_least_one_field' });

export type CreatePipelineInput = z.infer<typeof CreatePipelineSchema>;
export type UpdatePipelineInput = z.infer<typeof UpdatePipelineSchema>;
