/**
 * CRM unificado: the shared vocabulary of the unified lead model (migration 0029).
 *
 * Pure: imports only sibling pure modules, reads no env, no clock, no locale.
 * Open-ended sets (behavior, field kind, reference target, module key, event kind,
 * source) are validated HERE and by zod, never by a database CHECK, because the
 * additive migration guard forbids DROP CONSTRAINT.
 */
import {
  DEFAULT_PIPELINE_STAGES,
  type DefaultPipelineStage,
  type PipelineExitKind,
  type PipelineStageType,
} from './default-pipeline.js';
import { hasCapability, type SalesCapability, type SalesEdition } from './sales-edition.js';

export const CRM_STATUSES = ['active', 'archived'] as const;
export type CrmStatus = (typeof CRM_STATUSES)[number];

export const PIPELINE_STAGE_TYPES = ['normal', 'orcamento', 'saida'] as const satisfies readonly PipelineStageType[];
export const PIPELINE_EXIT_KINDS = ['ganho', 'perdido', 'pausado'] as const satisfies readonly PipelineExitKind[];

export const STAGE_BEHAVIORS = ['none', 'opens_orcamentos'] as const;
export type StageBehavior = (typeof STAGE_BEHAVIORS)[number];

export const FIELD_KINDS = ['text', 'number', 'money', 'date', 'options', 'reference'] as const;
export type FieldKind = (typeof FIELD_KINDS)[number];

export const FIELD_REFERENCE_TARGETS = ['cliente', 'contato', 'produto', 'servico', 'venda'] as const;
export type FieldReferenceTarget = (typeof FIELD_REFERENCE_TARGETS)[number];

export const LEAD_EVENT_KINDS = ['stage_changed'] as const;
export type LeadEventKind = (typeof LEAD_EVENT_KINDS)[number];

export const CRM_MODULE_KEYS = [
  'orcamentos',
  'comissoes',
  'financeiro',
  'finders',
  'catalogo',
  'importacao',
  'clientes',
] as const;
export type CrmModuleKey = (typeof CRM_MODULE_KEYS)[number];

export const CRM_MODULE_SOURCES = ['default', 'token_backfill', 'admin'] as const;
export type CrmModuleSource = (typeof CRM_MODULE_SOURCES)[number];

/**
 * Today's capability -> the module(s) that must ALL be enabled for it.
 * `financeiro` maps only `history` (Geral settings and the archive history) here;
 * phase 3 decides what else the financeiro module gates.
 */
export const CAPABILITY_MODULES: Readonly<Record<SalesCapability, readonly CrmModuleKey[]>> = {
  proposals: ['orcamentos'],
  commissions: ['comissoes'],
  catalog: ['catalogo'],
  clients: ['clientes'],
  import: ['importacao'],
  finders: ['finders'],
  history: ['financeiro'],
  leadFullFields: ['catalogo'],
};

/**
 * The module flags that reproduce an edition exactly: a module is enabled iff every
 * capability mapped to it is granted by the edition. full => all seven;
 * leads => exactly `clientes` and `importacao`. Used by the phase 3 one-time token backfill.
 */
export function modulesForEdition(edition: SalesEdition): Record<CrmModuleKey, boolean> {
  const result = {} as Record<CrmModuleKey, boolean>;
  for (const key of CRM_MODULE_KEYS) {
    const mapped = (Object.keys(CAPABILITY_MODULES) as SalesCapability[]).filter((capability) =>
      CAPABILITY_MODULES[capability].includes(key),
    );
    result[key] = mapped.length > 0 && mapped.every((capability) => hasCapability(edition, capability));
  }
  return result;
}

export function isCrmModuleKey(value: unknown): value is CrmModuleKey {
  return typeof value === 'string' && (CRM_MODULE_KEYS as readonly string[]).includes(value);
}

/** The behavior a default stage is seeded with. */
export function defaultStageBehavior(stage: Pick<DefaultPipelineStage, 'type'>): StageBehavior {
  return stage.type === 'orcamento' ? 'opens_orcamentos' : 'none';
}

/** Only a perdido exit requires a reason. */
export function defaultStageRequiresReason(stage: Pick<DefaultPipelineStage, 'exitKind'>): boolean {
  return stage.exitKind === 'perdido';
}

export interface TransitionPlanStage {
  readonly id: string;
  readonly name: string;
  readonly position: number;
  readonly type: PipelineStageType;
  readonly exitKind: PipelineExitKind | null;
  readonly status: CrmStatus;
}

/**
 * The transition rule migration 0030 applies in SQL, over the ACTIVE stages of one pipeline.
 * open = type normal|orcamento ordered by (position, name); exits = type saida.
 *   open[i] -> open[i+1]; open[i+1] -> open[i]; every open -> every exit;
 *   every exit with exitKind pausado -> every open.
 * Returns unique [fromId, toId] pairs in a stable order.
 */
export function planPipelineTransitions(stages: readonly TransitionPlanStage[]): [string, string][] {
  const active = stages.filter((stage) => stage.status === 'active');
  const byOrder = (a: TransitionPlanStage, b: TransitionPlanStage) =>
    a.position - b.position || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
  const open = active.filter((stage) => stage.type !== 'saida').sort(byOrder);
  const exits = active.filter((stage) => stage.type === 'saida').sort(byOrder);
  const pairs = new Map<string, [string, string]>();
  const add = (from: string, to: string) => pairs.set(`${from}>${to}`, [from, to]);
  for (let i = 0; i + 1 < open.length; i += 1) {
    add(open[i]!.id, open[i + 1]!.id);
    add(open[i + 1]!.id, open[i]!.id);
  }
  for (const from of open) for (const to of exits) add(from.id, to.id);
  for (const from of exits) if (from.exitKind === 'pausado') for (const to of open) add(from.id, to.id);
  return [...pairs.values()];
}

/** Key -> stage lookup of the default pipeline, for seeding and parity tests. */
export const DEFAULT_PIPELINE_STAGE_BY_KEY: ReadonlyMap<string, DefaultPipelineStage> = new Map(
  DEFAULT_PIPELINE_STAGES.map((stage) => [stage.key, stage]),
);

/** The Cliente system field every org gets. Stored in the lead's client_id column, never as value rows. */
export const SYSTEM_FIELD_CLIENTE = {
  key: 'cliente',
  label: 'Cliente',
  kind: 'reference',
  referenceTarget: 'cliente',
  multiple: false,
  filterable: true,
  isSystem: true,
  removable: false,
  backingColumn: 'client_id',
  position: 1,
} as const;
