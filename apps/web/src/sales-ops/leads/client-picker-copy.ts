/**
 * The cliente picker's copy in both lead dialogs: the trigger placeholder AND the
 * search field (the `Combobox` `searchPlaceholder`, which is also the search
 * input's accessible name). Pure and React-free.
 *
 * The copy promises creation only where the picker really offers the create row:
 * the leads edition's `ContactLeadDialog` while `onCreateClient` is wired. The
 * full edition's `LeadDialog` never creates a cliente (that happens at
 * conversion, inside the proposta flow), so it always reads `searchOnly`.
 */

export const CLIENT_PICKER_COPY = {
  searchOrCreate: 'Buscar ou criar novo cliente',
  searchOnly: 'Buscar cliente cadastrado',
} as const;

/** The one rule: `searchOrCreate` only when the create row is offered. */
export function clientPickerCopy(canCreate: boolean): string {
  return canCreate ? CLIENT_PICKER_COPY.searchOrCreate : CLIENT_PICKER_COPY.searchOnly;
}
