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
 * The transition rule migrations 0030 and 0033 apply in SQL, over the ACTIVE stages of one pipeline.
 * open = type normal|orcamento ordered by (position, name); exits = type saida.
 *   open[i] -> open[i+1]; open[i+1] -> open[i]; every open -> every exit;
 *   every exit (ganho, perdido and pausado alike) -> every open.
 * An exit never leads to another exit. Returns unique [fromId, toId] pairs in a stable order.
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
  for (const from of exits) for (const to of open) add(from.id, to.id);
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

// ---------------------------------------------------------------------------
// Phase 3 (per-organization modules). Pure; shared by the API and the web.
// ---------------------------------------------------------------------------

/** The module flags of one organization. Every key is present. */
export type OrgModules = Record<CrmModuleKey, boolean>;

/** The fail-to-full value: a context that never resolved modules is the whole product. */
export const ALL_MODULES_ENABLED: Readonly<OrgModules> = Object.freeze(
  Object.fromEntries(CRM_MODULE_KEYS.map((key) => [key, true])) as OrgModules,
);

/** A capability is granted iff EVERY module mapped to it is enabled. */
export function modulesAllowCapability(modules: OrgModules, capability: SalesCapability): boolean {
  return CAPABILITY_MODULES[capability].every((key) => modules[key] === true);
}

/**
 * The legacy two-value projection. 'full' while `orcamentos` is on, 'leads' while it
 * is off. It exists so every service argument and web conditional that still takes an
 * edition keeps working; it never decides a capability (modulesAllowCapability does).
 */
export function editionFromModules(modules: OrgModules): SalesEdition {
  return modules.orcamentos === true ? 'full' : 'leads';
}

/** True only for an object with every module key present as a boolean. */
export function isOrgModules(value: unknown): value is OrgModules {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Record<string, unknown>;
  return CRM_MODULE_KEYS.every((key) => typeof record[key] === 'boolean');
}

/**
 * An `orcamento` stage with the `opens_orcamentos` behaviour opens the proposta
 * wizard / answers sale_required_for_conversion ONLY while the organization has the
 * `orcamentos` module. With it off the stage is an ordinary stage.
 */
export function stageActsAsOrcamento(
  stage: { type: string; behavior: string },
  modules: OrgModules,
): boolean {
  return modules.orcamentos === true && stage.type === 'orcamento' && stage.behavior === 'opens_orcamentos';
}

/** The behaviour a stage really has for this organization (`none` when it cannot act). */
export function effectiveStageBehavior(
  stage: { type: string; behavior: string },
  modules: OrgModules,
): StageBehavior {
  return stageActsAsOrcamento(stage, modules) ? 'opens_orcamentos' : 'none';
}

// ---------------------------------------------------------------------------
// Pipeline access by função (vários funis por organização). Pure; shared by the
// API predicate and the web seller picker, so the two can never disagree.
// ---------------------------------------------------------------------------

/** One pipeline as the access rule reads it: its flags and the funções linked to it. */
export interface PipelineAccessCandidate {
  readonly id: string;
  readonly isDefault: boolean;
  readonly status: CrmStatus;
  readonly funcaoIds: readonly string[];
}

/**
 * The pipelines a NON-ADMIN pessoa reaches, in the input order (callers pass the board order,
 * `position` then `name`). An admin is not asked: an admin reaches every active pipeline.
 *
 *  - Every ACTIVE pipeline linked to at least one of the pessoa's funções.
 *  - When no active pipeline is linked to any of them, only the default pipeline: the `is_default`
 *    one, else the first active one (the same order `defaultPipelineId` reads on the server).
 *
 * So a pessoa holding only the system `vendedor` função keeps exactly the default pipeline, as
 * before pipelines could be linked at all. Archived pipelines are never reachable.
 */
export function accessiblePipelineIds(
  pipelines: readonly PipelineAccessCandidate[],
  personFuncaoIds: readonly string[],
): string[] {
  const active = pipelines.filter((pipeline) => pipeline.status === 'active');
  const held = new Set(personFuncaoIds);
  const linked = active.filter((pipeline) => pipeline.funcaoIds.some((funcaoId) => held.has(funcaoId)));
  if (linked.length > 0) return linked.map((pipeline) => pipeline.id);
  const fallback = active.find((pipeline) => pipeline.isDefault) ?? active[0];
  return fallback ? [fallback.id] : [];
}
