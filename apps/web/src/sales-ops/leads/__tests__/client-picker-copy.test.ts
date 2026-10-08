import { describe, expect, it } from 'vitest';
import { CLIENT_PICKER_COPY, clientPickerCopy } from '../client-picker-copy';

/**
 * The cliente picker copy in both lead dialogs. The approved literals are pinned
 * here and only here; the dialog tests import the constants.
 */

describe('client picker copy', () => {
  it('pins the approved strings', () => {
    expect(CLIENT_PICKER_COPY.searchOrCreate).toBe('Buscar ou criar novo cliente');
    expect(CLIENT_PICKER_COPY.searchOnly).toBe('Buscar cliente cadastrado');
  });

  it('promises creation only when the create row is offered', () => {
    expect(clientPickerCopy(true)).toBe(CLIENT_PICKER_COPY.searchOrCreate);
    expect(clientPickerCopy(false)).toBe(CLIENT_PICKER_COPY.searchOnly);
    expect(clientPickerCopy(false)).not.toMatch(/criar/i);
  });
});
