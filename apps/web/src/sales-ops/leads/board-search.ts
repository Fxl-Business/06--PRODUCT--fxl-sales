import { leadCompanyLabel, type LabelLookups } from './board-labels';
import type { SalesOpsLead } from './types';

function normalize(value: string): string {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase().trim();
}

/** Search only the loaded card fields that the operator can identify. */
export function matchesBoardSearch(lead: SalesOpsLead, lookups: LabelLookups, query: string): boolean {
  const needle = normalize(query);
  if (!needle) return true;
  return [lead.contactName, leadCompanyLabel(lead, lookups), lead.contactPhone, lead.contactEmail]
    .some((value) => value != null && normalize(value).includes(needle));
}
