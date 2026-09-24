/**
 * pt-BR copy for a failed `PUT /sales/:id`, rendered inside the still-open
 * proposta wizard. Pure: it duck-types the thrown `ApiError` (like
 * `require-token.ts`) and never prints a row id (CLAUDE.md UI Identifiers).
 */

export type SettlementBlockingRow = { kind: 'receivable' | 'payable'; id: string; label: string };

const GENERIC_FAILURE = 'Não foi possível salvar a proposta. Tente novamente.';

function readField(error: unknown, key: string): unknown {
  return typeof error === 'object' && error !== null ? (error as Record<string, unknown>)[key] : undefined;
}

function blockingRows(error: unknown): Array<Pick<SettlementBlockingRow, 'kind' | 'label'>> {
  const rows = readField(error, 'rows');
  if (!Array.isArray(rows)) return [];
  return rows.flatMap((row: unknown) => {
    const kind = readField(row, 'kind');
    const label = readField(row, 'label');
    if ((kind !== 'receivable' && kind !== 'payable') || typeof label !== 'string') return [];
    return [{ kind, label: label.trim() }];
  });
}

function blockingRowLine(row: Pick<SettlementBlockingRow, 'kind' | 'label'>): string {
  if (row.kind === 'payable') {
    return row.label ? `A conta a pagar ${row.label} tem baixa ativa.` : 'Uma conta a pagar tem baixa ativa.';
  }
  if (!row.label) return 'Uma parcela tem baixa ativa.';
  if (row.label.startsWith('M')) return `A mensalidade ${row.label.slice(1)} tem baixa ativa.`;
  return `A parcela ${row.label} tem baixa ativa.`;
}

/** pt-BR lines to show inside the wizard after a failed PUT /sales/:id. */
export function describeSaleSaveError(error: unknown): string[] {
  const status = readField(error, 'status');
  const code = readField(error, 'error');
  if (status === 409 && code === 'row_has_active_settlement') {
    const rows = blockingRows(error);
    if (rows.length === 0) {
      return ['Uma linha com baixa ativa impede esta alteração.', 'Estorne a baixa antes de mudar valor ou vencimento.'];
    }
    return [
      ...rows.map(blockingRowLine),
      rows.length === 1
        ? 'Estorne a baixa antes de mudar valor ou vencimento.'
        : 'Estorne as baixas antes de mudar valor ou vencimento.',
    ];
  }
  if (status === 409 && code === 'sale_not_editable') return ['Esta proposta não pode mais ser editada.'];
  if (status === 403) return ['Somente administradores podem editar propostas.'];
  return [GENERIC_FAILURE];
}
