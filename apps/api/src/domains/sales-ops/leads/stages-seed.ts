import type { getDb } from '../../../db/client.js';
import { ensureCrmDefaults } from '../../crm/defaults.js';
import { defaultPipelineId, listPipelineStages } from '../../crm/pipeline-read.js';
import { toLeadStageView, type LeadStageView } from '../../crm/stage-view.js';
import { withTenant } from './with-tenant.js';

type Db = ReturnType<typeof getDb>;

export type LeadStageKind = 'normal' | 'conversion' | 'lost';
export type LeadStageRow = LeadStageView;

/**
 * FROZEN since the phase 2 cutover: the four etapas migration 0022 seeded. Nothing writes them any
 * more (the default etapas of a new org are the seven of the default CRM pipeline, seeded by
 * `ensureCrmDefaults`); the constant stays only for the 0022 parity oracle
 * (`leads-schema-migration.test.ts`) and the import template tests. Byte-identical to the VALUES
 * list in migration 0022.
 *
 * Four stages, only two of them system: two would leave an org with a conversion
 * column and a Perdido column and nowhere for a lead to start. `Novo` and
 * `Em negociação` are ordinary, renameable, archivable rows the org owns - the
 * same shape as 0012's `prestador` bucket next to its reserved rows.
 */
export const LEAD_STAGE_SEEDS = [
  { name: 'Novo', kind: 'normal', isSystem: false, position: 1 },
  { name: 'Em negociação', kind: 'normal', isSystem: false, position: 2 },
  { name: 'Proposta', kind: 'conversion', isSystem: true, position: 3 },
  { name: 'Perdido', kind: 'lost', isSystem: true, position: 4 },
] as const satisfies readonly {
  name: string;
  kind: LeadStageKind;
  isSystem: boolean;
  position: number;
}[];

/** The two stage kinds the API refuses to rename, archive or create. */
export const SYSTEM_LEAD_STAGE_KINDS = ['conversion', 'lost'] as const;

/**
 * Seeds the org's default CRM pipeline (7 stages, 22 transitions, the Cliente field) when the org
 * has NO pipeline row and returns the DEFAULT pipeline's stages in board order, in the legacy
 * `kind` / `isSystem` shape. MUST be called inside an already tenant-scoped transaction; see
 * {@link ensureLeadStagesForOrg} for the entry point that opens one.
 *
 * This is the legacy facade over `ensureCrmDefaults`: it keeps the callers that predate the cutover
 * (the stage read, the bootstrap route, the import routes) and their allow-list test unchanged,
 * and it writes ONLY the unified tables.
 */
export async function ensureLeadStages(tx: Db, orgId: string): Promise<LeadStageRow[]> {
  await ensureCrmDefaults(tx, orgId);
  const pipelineId = await defaultPipelineId(tx, orgId);
  if (pipelineId === null) return [];
  return (await listPipelineStages(tx, orgId, pipelineId)).map(toLeadStageView);
}

/** Opens the tenant transaction and seeds. The public entry point. */
export async function ensureLeadStagesForOrg(db: Db, orgId: string): Promise<LeadStageRow[]> {
  return withTenant(db, orgId, (tx) => ensureLeadStages(tx, orgId));
}
