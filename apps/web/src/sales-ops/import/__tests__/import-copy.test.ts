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
