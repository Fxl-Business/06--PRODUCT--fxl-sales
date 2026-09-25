import { isForbiddenFailure } from '@/lib/require-token';

/**
 * Every line `MutationErrorBanner` can render, and the one 403 line every
 * sales-ops surface uses (contract H7).
 *
 * Its OWN module for the same `react-refresh/only-export-components` reason
 * `forbidden-copy.ts` gives. It names no role id: "administradores da
 * Organização" is the whole of what the app knows (CLAUDE.md, UI Identifiers).
 */
export const MUTATION_ERROR_COPY = {
  adminRequired:
    'Somente administradores da Organização podem fazer esta alteração. Peça a quem administra a Organização no FXL Hub.',
  saleHasActiveSettlements:
    'Esta proposta tem pagamentos registrados. Estorne os pagamentos antes de mudar o status.',
  generic: 'Não foi possível concluir a ação. Tente novamente.',
  dismiss: 'Fechar aviso',
} as const;

/**
 * The pt-BR line for a failed sales-ops mutation. Keys on the STATUS for the 403
 * (the deny taxonomy rule: never on the body code), and on the body `error` code
 * only to pick a more specific 409 line.
 */
export function salesOpsMutationErrorMessage(error: unknown): string {
  if (isForbiddenFailure(error)) return MUTATION_ERROR_COPY.adminRequired;
  if (
    typeof error === 'object' &&
    error !== null &&
    (error as { error?: unknown }).error === 'sale_has_active_settlements'
  ) {
    return MUTATION_ERROR_COPY.saleHasActiveSettlements;
  }
  return MUTATION_ERROR_COPY.generic;
}
