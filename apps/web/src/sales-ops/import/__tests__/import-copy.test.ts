import { describe, expect, it } from 'vitest';
import { MUTATION_ERROR_COPY } from '../../mutation-error-copy';
import { IMPORT_COPY, importErrorMessage } from '../import-copy';

describe('importErrorMessage', () => {
  it('keys on status', () => {
    expect(importErrorMessage({ status: 403 })).toBe(MUTATION_ERROR_COPY.adminRequired);
    expect(importErrorMessage({ status: 401 })).toContain('sessão do FXL Hub');
    expect(importErrorMessage({ status: 400 })).toContain('não é uma planilha .xlsx válida');
    expect(importErrorMessage({ status: 413 })).toBe(IMPORT_COPY.tooLargeLocal);
    expect(importErrorMessage({ status: 409 })).toContain('um registro foi recusado');
    expect(importErrorMessage({ status: 422 })).toContain('mudaram desde a validação');
    expect(importErrorMessage({ status: 500 })).toBe(MUTATION_ERROR_COPY.generic);
    expect(importErrorMessage(new Error('x'))).toBe(MUTATION_ERROR_COPY.generic);
  });

  it('ignores the body code', () => {
    expect(importErrorMessage({ status: 409, code: 'forbidden', error: 'forbidden' })).toContain(
      'um registro foi recusado',
    );
  });
});

describe('importErrorMessage 409 row detail', () => {
  const GENERIC_409 =
    'Nada foi importado: um registro foi recusado durante a gravação. Valide a planilha novamente e tente outra vez.';

  it('409 with a row message names the row', () => {
    expect(
      importErrorMessage({
        status: 409,
        body: {
          error: 'conflict',
          reason: 'import_execution_failed',
          message: 'Aba Propostas, linha 4: a parcela 1/3 já foi paga.',
        },
      }),
    ).toBe(
      'Nada foi importado: Aba Propostas, linha 4: a parcela 1/3 já foi paga. Valide a planilha novamente e tente outra vez.',
    );
  });

  it('409 message without final punctuation gets a period', () => {
    expect(
      importErrorMessage({ status: 409, body: { message: 'Aba Leads, linha 2: etapa recusada' } }),
    ).toBe(
      'Nada foi importado: Aba Leads, linha 2: etapa recusada. Valide a planilha novamente e tente outra vez.',
    );
  });

  it('409 without a message keeps the generic copy', () => {
    for (const error of [
      { status: 409 },
      { status: 409, body: {} },
      { status: 409, body: { message: '   ' } },
      { status: 409, body: { message: 42 } },
    ]) {
      expect(importErrorMessage(error)).toBe(GENERIC_409);
    }
  });

  it('other statuses ignore body.message', () => {
    expect(importErrorMessage({ status: 422, body: { message: 'x' } })).toBe(
      importErrorMessage({ status: 422 }),
    );
  });
});
