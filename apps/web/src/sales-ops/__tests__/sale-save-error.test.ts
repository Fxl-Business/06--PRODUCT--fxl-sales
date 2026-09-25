import { describe, expect, it } from 'vitest';
import { MUTATION_ERROR_COPY } from '../mutation-error-copy';
import { describeSaleSaveError } from '../sale-save-error';

describe('describeSaleSaveError', () => {
  it('names a single blocking parcela by its label', () => {
    expect(
      describeSaleSaveError({
        status: 409,
        error: 'row_has_active_settlement',
        rows: [{ kind: 'receivable', id: 'r2', label: '2/6' }],
      }),
    ).toEqual(['A parcela 2/6 tem baixa ativa.', 'Estorne a baixa antes de mudar valor ou vencimento.']);
  });

  it('names every blocking row, recurring and payable included', () => {
    expect(
      describeSaleSaveError({
        status: 409,
        error: 'row_has_active_settlement',
        rows: [
          { kind: 'receivable', id: 'r2', label: '2/6' },
          { kind: 'receivable', id: 'r9', label: 'M3/12' },
          { kind: 'payable', id: 'p1', label: 'Ana Martins (2/6)' },
        ],
      }),
    ).toEqual([
      'A parcela 2/6 tem baixa ativa.',
      'A mensalidade 3/12 tem baixa ativa.',
      'A conta a pagar Ana Martins (2/6) tem baixa ativa.',
      'Estorne as baixas antes de mudar valor ou vencimento.',
    ]);
  });

  it('falls back to a generic lock message when rows are missing or malformed', () => {
    const generic = ['Uma linha com baixa ativa impede esta alteração.', 'Estorne a baixa antes de mudar valor ou vencimento.'];
    expect(describeSaleSaveError({ status: 409, error: 'row_has_active_settlement' })).toEqual(generic);
    expect(
      describeSaleSaveError({ status: 409, error: 'row_has_active_settlement', rows: [null, { kind: 'other', label: '1/2' }, 'x'] }),
    ).toEqual(generic);
    expect(
      describeSaleSaveError({
        status: 409,
        error: 'row_has_active_settlement',
        rows: [
          { kind: 'receivable', id: 'r1', label: ' ' },
          { kind: 'payable', id: 'p1', label: '' },
        ],
      }),
    ).toEqual([
      'Uma parcela tem baixa ativa.',
      'Uma conta a pagar tem baixa ativa.',
      'Estorne as baixas antes de mudar valor ou vencimento.',
    ]);
  });

  it('maps sale_not_editable, 403 and any other failure', () => {
    expect(describeSaleSaveError({ status: 409, error: 'sale_not_editable' })).toEqual([
      'Esta proposta não pode mais ser editada.',
    ]);
    expect(describeSaleSaveError({ status: 403, error: 'forbidden' })).toEqual([
      MUTATION_ERROR_COPY.adminRequired,
    ]);
    const generic = ['Não foi possível salvar a proposta. Tente novamente.'];
    expect(describeSaleSaveError({ status: 500, error: 'request_failed' })).toEqual(generic);
    expect(describeSaleSaveError(new Error('boom'))).toEqual(generic);
    expect(describeSaleSaveError(null)).toEqual(generic);
  });

  it('never prints a row id', () => {
    const lines = describeSaleSaveError({
      status: 409,
      error: 'row_has_active_settlement',
      rows: [
        { kind: 'receivable', id: 'r2', label: '' },
        { kind: 'payable', id: 'r2', label: '' },
      ],
    });
    for (const line of lines) expect(line).not.toContain('r2');
  });
});
