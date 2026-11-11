import { salesOpsMutationErrorMessage } from '../mutation-error-copy';

/**
 * Every line of the whole-etapa delete: the column header action, its ONE
 * confirmation (`StageDeleteDialog`) and the notice that follows. Pure and
 * React-free, like `delete-copy.ts`, so it must not import the HTTP client
 * (board-write-surface OWNED_FILES rule).
 */

const leadsWord = (count: number): string => (count === 1 ? '1 lead' : `${count} leads`);

export const STAGE_DELETE_COPY = {
  action: 'Excluir todos os leads desta etapa',
  actionLabel: (stageName: string): string => `Excluir todos os leads desta etapa: ${stageName}`,
  dialogTitle: 'Excluir todos os leads desta etapa',
  stageLine: (stageName: string): string => `Etapa: ${stageName}`,
  countLine: (count: number): string =>
    count === 1 ? '1 lead vai ser excluído.' : `${count} leads vão ser excluídos.`,
  skippedLine: (count: number): string =>
    count === 1
      ? '1 lead já virou proposta e fica de fora.'
      : `${count} leads já viraram proposta e ficam de fora.`,
  nothingToDelete: 'Esta etapa não tem leads para excluir.',
  reassurance:
    'Os clientes do cadastro não são alterados. O gestor pode restaurar o lote inteiro em Cadastros > Leads excluídos.',
  loading: 'Contando os leads da etapa…',
  loadFailed: 'Não foi possível contar os leads desta etapa. Feche e tente de novo.',
  typePrompt: (count: number): string => `Para confirmar, digite ${count}`,
  confirm: (count: number): string => `Excluir ${leadsWord(count)}`,
  cancel: 'Cancelar',
  pending: 'Excluindo…',
  done: (stageName: string, deleted: number): string =>
    `${leadsWord(deleted)} da etapa "${stageName}" ${deleted === 1 ? 'foi excluído' : 'foram excluídos'}. Restaure o lote em Cadastros > Leads excluídos.`,
  dismiss: 'Fechar aviso',
} as const;

/**
 * The typed confirmation: the operator must write the exact count the dialog shows.
 * Thousands separators and spaces are tolerated (`1.700`), nothing else, and a zero
 * count can never be confirmed.
 */
export function stageDeleteTypedMatches(typed: string, deletableCount: number): boolean {
  if (deletableCount <= 0) return false;
  return typed.trim().replace(/[.\s]/g, '') === String(deletableCount);
}

/**
 * The inline line for a refused whole-etapa delete, rendered INSIDE the still-open
 * dialog. Every failure is the existing sales-ops mutation copy (a 403 included,
 * keyed on the status), never the app-level forbidden panel.
 */
export function stageDeleteErrorCopy(error: unknown): string {
  return salesOpsMutationErrorMessage(error);
}
