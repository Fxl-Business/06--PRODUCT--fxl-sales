/**
 * The cliente picker's copy in the one LeadForm: the trigger placeholder AND the
 * search field (the `Combobox` `searchPlaceholder`, which is also the search
 * input's accessible name).
 *
 * The copy promises creation only where the picker really offers the create row:
 * the LeadForm's empresa picker while `onCreateClient` is wired (both editions).
 * Without it the picker only searches, so it reads `searchOnly`. Pure and React-free.
 */

export const CLIENT_PICKER_COPY = {
  searchOrCreate: 'Buscar ou criar novo cliente',
  searchOnly: 'Buscar cliente cadastrado',
} as const;

/** The one rule: `searchOrCreate` only when the create row is offered. */
export function clientPickerCopy(canCreate: boolean): string {
  return canCreate ? CLIENT_PICKER_COPY.searchOrCreate : CLIENT_PICKER_COPY.searchOnly;
}
