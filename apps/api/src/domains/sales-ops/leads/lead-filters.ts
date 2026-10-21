import { isIsoDay, saoPauloDayRangeToInstants } from '@fxl-sales/shared-utils/sao-paulo-day';
import { eq, gte, lt, sql, type SQL } from 'drizzle-orm';
import type { getDb } from '../../../db/client.js';
import { salesOpsCrmLeadFieldValues, salesOpsCrmLeads } from '../../../db/schema.js';
import { loadFieldDefinitions, type FieldDefinitionRow } from '../../crm/lead-fields.js';
import { defaultPipelineId } from '../../crm/pipeline-read.js';
import type { DynamicFilterInput } from './lead-schemas.js';

/**
 * The board read narrowing added by phase 2: pipeline, period (America/Sao_Paulo civil days over
 * `created_at`) and dynamic filters on FILTERABLE field definitions. One builder serves
 * `listLeads` and `summarizeLeadStages`, so a column's total and the summary's count always cover
 * the same set.
 */
type Db = ReturnType<typeof getDb>;

/** A filter key that is unknown, not filterable, or whose value does not fit its kind. The route answers 400. */
export class LeadFilterError extends Error {
  constructor(readonly filter: string) {
    super(`invalid_filter:${filter}`);
    this.name = 'LeadFilterError';
  }
}

const FILTER_KEY = /^f\.([a-z0-9_-]{1,60})(?:\.(min|max))?$/i;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Reads every `f.<key>` / `f.<key>.min` / `f.<key>.max` entry of a query string. Any other `f.` shape is a 400. */
export function parseDynamicFilters(query: Record<string, string>): DynamicFilterInput[] {
  const filters: DynamicFilterInput[] = [];
  for (const [name, raw] of Object.entries(query)) {
    if (!name.startsWith('f.')) continue;
    const match = FILTER_KEY.exec(name);
    if (!match) throw new LeadFilterError(name);
    filters.push({ key: match[1]!, op: (match[2]?.toLowerCase() as 'min' | 'max' | undefined) ?? 'eq', raw });
  }
  return filters;
}

function valueExists(def: FieldDefinitionRow, predicate: SQL): SQL {
  return sql`EXISTS (
    SELECT 1 FROM ${salesOpsCrmLeadFieldValues} v
    WHERE v.org_id = ${salesOpsCrmLeads.orgId} AND v.lead_id = ${salesOpsCrmLeads.id}
      AND v.field_id = ${def.id} AND ${predicate})`;
}

function escapeLike(raw: string): string {
  return raw.replace(/[\\%_]/g, (char) => `\\${char}`);
}

function condition(def: FieldDefinitionRow, filter: DynamicFilterInput): SQL {
  const bad = () => new LeadFilterError(`f.${filter.key}`);
  const range = filter.op !== 'eq';
  const raw = filter.raw.trim();
  if (raw === '') throw bad();
  if (def.backingColumn === 'client_id') {
    if (range || !UUID.test(raw)) throw bad();
    return eq(salesOpsCrmLeads.clientId, raw);
  }
  switch (def.kind) {
    case 'text':
      if (range) throw bad();
      return valueExists(def, sql`v.value_text ILIKE ${`%${escapeLike(raw)}%`} ESCAPE '\\'`);
    case 'options':
      if (range) throw bad();
      return valueExists(def, sql`v.value_option = ${raw}`);
    case 'number':
    case 'money': {
      const n = Number(raw);
      if (!Number.isFinite(n) || (def.kind === 'money' && !Number.isSafeInteger(n))) throw bad();
      const column = def.kind === 'number' ? sql`v.value_number` : sql`v.value_cents`;
      if (filter.op === 'min') return valueExists(def, sql`${column} >= ${n}`);
      if (filter.op === 'max') return valueExists(def, sql`${column} <= ${n}`);
      return valueExists(def, sql`${column} = ${n}`);
    }
    case 'date': {
      if (!isIsoDay(raw)) throw bad();
      if (filter.op === 'min') return valueExists(def, sql`v.value_date >= ${raw}::date`);
      if (filter.op === 'max') return valueExists(def, sql`v.value_date <= ${raw}::date`);
      return valueExists(def, sql`v.value_date = ${raw}::date`);
    }
    case 'reference': {
      if (range || !UUID.test(raw)) throw bad();
      switch (def.referenceTarget) {
        case 'cliente':
          return valueExists(def, sql`v.value_client_id = ${raw}::uuid`);
        case 'produto':
        case 'servico':
          return valueExists(def, sql`v.value_product_id = ${raw}::uuid`);
        case 'venda':
          return valueExists(def, sql`v.value_sale_id = ${raw}::uuid`);
        default:
          throw bad();
      }
    }
    default:
      throw bad();
  }
}

export type BoardNarrowing = {
  pipelineId?: string | undefined;
  from?: string | undefined;
  to?: string | undefined;
  filters?: DynamicFilterInput[] | undefined;
};

/**
 * The extra WHERE conjuncts of a board read. `defaultToDefaultPipeline` is true for the summary,
 * which has no stageId: it then covers the org's default pipeline unless one is named.
 */
export async function boardNarrowingConditions(
  tx: Db,
  orgId: string,
  narrowing: BoardNarrowing,
  options: { defaultToDefaultPipeline: boolean },
): Promise<SQL[]> {
  const conditions: SQL[] = [];
  const pipelineId =
    narrowing.pipelineId ?? (options.defaultToDefaultPipeline ? await defaultPipelineId(tx, orgId) : null);
  if (pipelineId) conditions.push(eq(salesOpsCrmLeads.pipelineId, pipelineId));

  const { start, endExclusive } = saoPauloDayRangeToInstants(narrowing.from, narrowing.to);
  if (start) conditions.push(gte(salesOpsCrmLeads.createdAt, start));
  if (endExclusive) conditions.push(lt(salesOpsCrmLeads.createdAt, endExclusive));

  if (narrowing.filters && narrowing.filters.length > 0) {
    const definitions = (await loadFieldDefinitions(tx, orgId)).filter((def) => def.status === 'active');
    for (const filter of narrowing.filters) {
      const def = definitions.find((candidate) => candidate.key === filter.key);
      if (!def || !def.filterable) throw new LeadFilterError(`f.${filter.key}`);
      conditions.push(condition(def, filter));
    }
  }
  return conditions;
}
