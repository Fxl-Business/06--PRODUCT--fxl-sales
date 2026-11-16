import type { SalesOpsFuncao } from '../types';
import type { CrmPipeline } from './crm-types';

/**
 * Every user-facing string of `Cadastros > Funis e etapas`, in one place so the tests can pin
 * them. pt-BR, no em dash, no raw id.
 */
export const PIPELINE_SETTINGS_COPY = {
  selectorLabel: 'Funil',
  selectorPlaceholder: 'Selecione um funil',
  defaultBadge: 'Padrão',
  newAction: 'Novo funil',
  editAction: 'Editar funil',
  archiveAction: 'Arquivar funil',
  dialogTitleNew: 'Novo funil',
  dialogTitleEdit: 'Editar funil',
  dialogDescription:
    'Um funil novo nasce com as sete etapas padrão. As funções escolhidas decidem quais vendedores trabalham nele.',
  nameLabel: 'Nome',
  funcoesLabel: 'Funções com acesso',
  funcoesPlaceholder: 'Adicionar função',
  funcoesEmpty: 'Nenhuma função ligada.',
  cancel: 'Cancelar',
  save: 'Salvar',
  nameTaken: 'Já existe um funil com esse nome.',
  saveFailed: 'Não foi possível salvar o funil. Tente novamente.',
  archiveTitle: (name: string) => `Arquivar o funil ${name}?`,
  archiveBody:
    'O funil sai do quadro e da lista de funis. Os leads dele continuam guardados e voltam junto quando o funil for restaurado nesta tela.',
  archiveConfirm: 'Arquivar',
  archiveBack: 'Voltar',
  archiveFailed: 'Não foi possível arquivar o funil. Tente novamente.',
  archivedTitle: 'Funis arquivados',
  restoreLabel: (name: string) => `Restaurar funil ${name}`,
  restoreFailed: 'Não foi possível restaurar o funil. Tente novamente.',
  stagesOf: (name: string) => `Etapas do funil ${name}`,
} as const;

/** The access line under the selector: who works in the selected pipeline. */
export function pipelineAccessSummary(pipeline: CrmPipeline, funcoes: readonly SalesOpsFuncao[]): string {
  const names = pipeline.funcaoIds
    .map((id) => funcoes.find((funcao) => funcao.id === id)?.name)
    .filter((name): name is string => typeof name === 'string')
    .sort((a, b) => a.localeCompare(b, 'pt-BR'));
  if (names.length > 0) return `Acesso: vendedores com a função ${names.join(', ')} e os administradores.`;
  if (pipeline.isDefault) {
    return 'Acesso: vendedores sem função ligada a outro funil e os administradores.';
  }
  return 'Acesso: só os administradores, até uma função ser ligada a este funil.';
}

/** Active pipelines first-to-last by board order; archived ones by name. */
export function splitPipelines(pipelines: readonly CrmPipeline[]): { active: CrmPipeline[]; archived: CrmPipeline[] } {
  const byOrder = (a: CrmPipeline, b: CrmPipeline) => a.position - b.position || a.name.localeCompare(b.name, 'pt-BR');
  return {
    active: pipelines.filter((pipeline) => pipeline.status === 'active').sort(byOrder),
    archived: pipelines
      .filter((pipeline) => pipeline.status === 'archived')
      .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR')),
  };
}

/** The HTTP status of a rejected save, read off `ApiError` without importing it. */
export function pipelineSaveErrorCopy(error: unknown): string {
  const status = typeof error === 'object' && error !== null ? (error as { status?: unknown }).status : undefined;
  return status === 409 ? PIPELINE_SETTINGS_COPY.nameTaken : PIPELINE_SETTINGS_COPY.saveFailed;
}
