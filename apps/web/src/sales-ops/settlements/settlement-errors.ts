import type { ApiErrorRow } from '@/lib/api-client';
import { isForbiddenFailure } from '@/lib/require-token';
import { MUTATION_ERROR_COPY } from '../mutation-error-copy';
import { describeLockedRows } from './settlement-format';

/**
 * pt-BR copy for a refused baixa or estorno, rendered INSIDE its dialog (contract
 * H7: dialog errors stay in their dialog). Keying on the body code is correct
 * here: the "status alone" rule is about the 401/402/403 auth classification,
 * and the 403 below keys on the status through `isForbiddenFailure`.
 */

type ErrorShape = { status?: unknown; error?: unknown; rows?: unknown };

function shapeOf(error: unknown): ErrorShape {
  return typeof error === 'object' && error !== null ? (error as ErrorShape) : {};
}

const CONFLICT_COPY: Record<string, string> = {
  already_paid: 'Esta linha já está paga. Atualize a página para ver o pagamento.',
  row_void: 'Esta linha foi anulada e não aceita pagamento.',
  sale_not_won: 'Só é possível registrar pagamento em proposta ganha.',
  already_reversed: 'Este pagamento já foi estornado.',
};

const INVALID_PAID_ON_COPY: Record<string, string> = {
  paid_on_in_future: 'A data de pagamento não pode ser no futuro.',
  invalid_paid_on: 'Informe uma data de pagamento válida.',
};

export function settlementErrorMessage(error: unknown): string {
  if (isForbiddenFailure(error)) return MUTATION_ERROR_COPY.adminRequired;
  const { status, error: code } = shapeOf(error);
  const key = typeof code === 'string' ? code : '';
  if (status === 422 && INVALID_PAID_ON_COPY[key]) return INVALID_PAID_ON_COPY[key];
  if (status === 409 && CONFLICT_COPY[key]) return CONFLICT_COPY[key];
  if (status === 404) return 'Registro não encontrado. Atualize a página.';
  return 'Não foi possível concluir. Tente novamente.';
}

/**
 * The blocking rows of a `409 sale_has_active_settlements` from a transition or
 * `cancel-contract`, one line each, for `MutationErrorBanner`. Any other failure
 * has no lines: the headline stays `salesOpsMutationErrorMessage`.
 */
export function lockedRowLines(error: unknown, descriptions: Map<string, string>): string[] {
  const { status, error: code, rows } = shapeOf(error);
  if (status !== 409 || code !== 'sale_has_active_settlements') return [];
  return describeLockedRows(Array.isArray(rows) ? (rows as ApiErrorRow[]) : [], descriptions);
}
