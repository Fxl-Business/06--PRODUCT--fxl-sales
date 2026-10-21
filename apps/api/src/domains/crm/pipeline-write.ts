import { DEFAULT_PIPELINE_KEY, DEFAULT_PIPELINE_NAME } from '@fxl-sales/shared-utils/default-pipeline';
import type { getDb } from '../../db/client.js';
import { salesOpsPipelines } from '../../db/schema.js';
import { defaultPipelineId } from './pipeline-read.js';

type Db = ReturnType<typeof getDb>;

/**
 * The default pipeline's id, creating the pipeline row WITHOUT any stage when the org has none.
 *
 * It exists for the etapa cadastro: an org whose first act is to create its own etapa must not be
 * seeded with the default seven afterwards ("seeded" means "has ANY pipeline row", see
 * `ensureDefaultPipeline`). The bare INSERT absorbs every unique index, so two concurrent first
 * writers leave one pipeline; the loser re-reads the winner's row. It is deliberately not one of
 * the four seed functions of `defaults.ts`: it seeds no stage, no transition and no field.
 */
export async function ensureBareDefaultPipeline(tx: Db, orgId: string): Promise<string> {
  const existing = await defaultPipelineId(tx, orgId);
  if (existing !== null) return existing;
  await tx
    .insert(salesOpsPipelines)
    .values({ orgId, name: DEFAULT_PIPELINE_NAME, systemKey: DEFAULT_PIPELINE_KEY, position: 0, isDefault: true })
    .onConflictDoNothing();
  const created = await defaultPipelineId(tx, orgId);
  if (created === null) throw new Error('default pipeline disappeared inside its own transaction');
  return created;
}
