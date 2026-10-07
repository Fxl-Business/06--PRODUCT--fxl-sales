import { salesOpsMutationErrorMessage } from '../mutation-error-copy';

/**
 * Every line the lead delete flow renders: the card menu, the Lista action, the
 * form button and the ONE confirmation, `LeadDeleteDialog`. Pure and React-free.
 *
 * Like `contact-lead.ts`, this file must not import the HTTP client module
 * (board-write-surface OWNED_FILES rule), so the error classification below is
 * structural.
 */

export const LEAD_DELETE_COPY = {
  menuLabel: 'Excluir',
  menuTrigger: 'Ações do lead',
  formButton: 'Excluir lead',
  dialogTitle: 'Excluir lead',
  dialogBody: (name: string): string =>
    `O lead "${name}" sai do quadro para todos. O gestor pode restaurá-lo em Cadastros > Leads excluídos.`,
  confirm: 'Excluir',
  cancel: 'Cancelar',
  pending: 'Excluindo…',
} as const;

export const LEAD_DELETE_ERROR_COPY = {
  converted: 'Este lead já virou proposta e não pode ser excluído.',
} as const;

/**
 * The inline line for a refused delete, rendered INSIDE the still-open
 * confirmation. `409 {reason:'lead_already_converted'}` names the one refusal an
 * operator can understand; every other failure is the existing sales-ops
 * mutation copy (403 included, keyed on the status). A `404` never reaches here:
 * `useDeleteLead` resolves it, because the lead is already gone.
 */
export function leadDeleteErrorCopy(error: unknown): string {
  if (
    typeof error === 'object' &&
    error !== null &&
    (error as { status?: unknown }).status === 409 &&
    (error as { reason?: unknown }).reason === 'lead_already_converted'
  ) {
    return LEAD_DELETE_ERROR_COPY.converted;
  }
  return salesOpsMutationErrorMessage(error);
}
