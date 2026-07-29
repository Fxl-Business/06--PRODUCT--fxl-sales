/**
 * Pure filtering, grouping and labelling logic for the `Combobox` primitive.
 *
 * Lives in its own module so `combobox.tsx` exports a component and nothing
 * else, which keeps `react-refresh/only-export-components` quiet.
 */

export type ComboboxOption = {
  /** Stable value handed back through onChange. */
  value: string;
  /** Primary line, and the string the exact-match check for the create row uses. */
  label: string;
  /** Optional secondary line rendered under the label in muted text. */
  description?: string;
  /** Optional group heading. Options sharing a group render under one heading. */
  group?: string;
};

export type ComboboxGroup = {
  /** Stable react key. `'__ungrouped__'` for the headingless bucket. */
  key: string;
  /** null for the headingless bucket, otherwise the heading text. */
  label: string | null;
  options: ComboboxOption[];
};

export type ComboboxFilterResult = {
  /** Groups in render order: the headingless bucket first, then each group in first-appearance order. */
  groups: ComboboxGroup[];
  /** Concatenation of groups[].options in exactly the order they render. Index into this array is the navigable index. */
  filtered: ComboboxOption[];
};

export const UNGROUPED_KEY = '__ungrouped__';

/**
 * Unicode combining diacritical marks, U+0300 to U+036F. Written with escapes so
 * this source stays ASCII where a literal combining mark would be invisible.
 */
const COMBINING_MARKS = /[\u0300-\u036f]/g;

/** Trim, lowercase with pt-BR collation, and strip combining diacritics. */
export function normalizeComboboxText(value: string): string {
  return value.trim().toLocaleLowerCase('pt-BR').normalize('NFD').replace(COMBINING_MARKS, '');
}

/** Case-insensitive but deliberately diacritic-SENSITIVE comparison key. */
function exactMatchKey(value: string): string {
  return value.trim().toLocaleLowerCase('pt-BR');
}

/** Filter by normalized substring over `label` and `description`, then group in render order. */
export function buildComboboxFilter(
  options: ComboboxOption[],
  query: string,
): ComboboxFilterResult {
  const needle = normalizeComboboxText(query);
  const matches =
    needle === ''
      ? options
      : options.filter((option) =>
          normalizeComboboxText(`${option.label} ${option.description ?? ''}`).includes(needle),
        );

  const ungrouped: ComboboxOption[] = [];
  const grouped = new Map<string, ComboboxOption[]>();

  for (const option of matches) {
    const group = option.group ?? '';
    if (group === '') {
      ungrouped.push(option);
      continue;
    }
    const bucket = grouped.get(group);
    if (bucket) bucket.push(option);
    else grouped.set(group, [option]);
  }

  const groups: ComboboxGroup[] = [];
  if (ungrouped.length > 0) {
    groups.push({ key: UNGROUPED_KEY, label: null, options: ungrouped });
  }
  for (const [label, groupOptions] of grouped) {
    groups.push({ key: label, label, options: groupOptions });
  }

  return { groups, filtered: groups.flatMap((group) => group.options) };
}

/**
 * True when a create row must be offered: a create handler exists, the trimmed query is
 * non-empty, and no option in the FULL option list has a label that case-insensitively
 * (but diacritic-sensitively) equals the trimmed query.
 *
 * The asymmetry against `buildComboboxFilter` is deliberate: filtering strips
 * diacritics so `valeria` finds `Valeria` spelled with an accent, but `Valeria`
 * and the accented spelling are different names, so typing one must still offer
 * to create it.
 */
export function shouldShowCreateRow(
  options: ComboboxOption[],
  query: string,
  hasCreateHandler: boolean,
): boolean {
  if (!hasCreateHandler) return false;
  const needle = exactMatchKey(query);
  if (needle === '') return false;
  return !options.some((option) => exactMatchKey(option.label) === needle);
}

/** `+ Criar novo contato "adsad"` / `+ Criar nova area "Juridico"`, accents included. */
export function createRowLabel(
  entityLabel: string,
  entityGender: 'm' | 'f',
  query: string,
): string {
  const agreement = entityGender === 'f' ? 'nova' : 'novo';
  return `+ Criar ${agreement} ${entityLabel} "${query.trim()}"`;
}
