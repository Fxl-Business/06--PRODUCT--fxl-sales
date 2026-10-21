/**
 * Default CRM pipeline contract.
 *
 * One constant describes the default funnel. Later phases seed from it and
 * the web pipeline selector reads it. Nothing seeds from it in this module.
 *
 * Legacy bridge: today's four LEAD_STAGE_SEEDS map onto this pipeline as
 *   legacy `normal`     -> `normal`
 *   legacy `conversion` -> `orcamento` (Proposta)
 *   legacy `lost`       -> `saida` with exitKind `perdido`
 *
 * Pure: imports nothing, reads no env, no clock, no locale.
 */

export type PipelineStageType = 'normal' | 'orcamento' | 'saida';
export type PipelineExitKind = 'ganho' | 'perdido' | 'pausado';

export interface DefaultPipelineStage {
  readonly key: string;
  readonly label: string;
  readonly order: number;
  readonly type: PipelineStageType;
  readonly exitKind: PipelineExitKind | null;
}

export const DEFAULT_PIPELINE_KEY = 'crm-padrao';
export const DEFAULT_PIPELINE_NAME = 'Funil CRM padrão';

export const DEFAULT_PIPELINE_STAGES = [
  { key: 'novo', label: 'Novo', order: 1, type: 'normal', exitKind: null },
  { key: 'qualificacao', label: 'Qualificação', order: 2, type: 'normal', exitKind: null },
  { key: 'em-negociacao', label: 'Em negociação', order: 3, type: 'normal', exitKind: null },
  { key: 'proposta', label: 'Proposta', order: 4, type: 'orcamento', exitKind: null },
  { key: 'ganho', label: 'Ganho', order: 5, type: 'saida', exitKind: 'ganho' },
  { key: 'perdido', label: 'Perdido', order: 6, type: 'saida', exitKind: 'perdido' },
  { key: 'pausado', label: 'Pausado', order: 7, type: 'saida', exitKind: 'pausado' },
] as const satisfies readonly DefaultPipelineStage[];

export type DefaultPipelineStageKey = (typeof DEFAULT_PIPELINE_STAGES)[number]['key'];

/**
 * Allowed moves between stages. Nothing outside this list is allowed.
 * - forward one open step
 * - back one open step (`novo` has no back)
 * - any open stage to any exit
 * - `pausado` back to any open stage
 * `ganho` and `perdido` are terminal.
 */
export const DEFAULT_PIPELINE_TRANSITIONS: readonly (readonly [DefaultPipelineStageKey, DefaultPipelineStageKey])[] = [
  ['novo', 'qualificacao'],
  ['qualificacao', 'em-negociacao'],
  ['em-negociacao', 'proposta'],
  ['qualificacao', 'novo'],
  ['em-negociacao', 'qualificacao'],
  ['proposta', 'em-negociacao'],
  ['novo', 'ganho'],
  ['novo', 'perdido'],
  ['novo', 'pausado'],
  ['qualificacao', 'ganho'],
  ['qualificacao', 'perdido'],
  ['qualificacao', 'pausado'],
  ['em-negociacao', 'ganho'],
  ['em-negociacao', 'perdido'],
  ['em-negociacao', 'pausado'],
  ['proposta', 'ganho'],
  ['proposta', 'perdido'],
  ['proposta', 'pausado'],
  ['pausado', 'novo'],
  ['pausado', 'qualificacao'],
  ['pausado', 'em-negociacao'],
  ['pausado', 'proposta'],
];

/** Today's four LEAD_STAGE_SEEDS names -> their counterpart key in the default pipeline. */
export const LEGACY_LEAD_STAGE_COUNTERPART = {
  'Novo': 'novo',
  'Em negociação': 'em-negociacao',
  'Proposta': 'proposta',
  'Perdido': 'perdido',
} as const satisfies Record<string, DefaultPipelineStageKey>;

/** Default stages that have NO legacy counterpart (the backfill must create them). */
export const DEFAULT_PIPELINE_NEW_STAGE_KEYS = ['qualificacao', 'ganho', 'pausado'] as const satisfies readonly DefaultPipelineStageKey[];
