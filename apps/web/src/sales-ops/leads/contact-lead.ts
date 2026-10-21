import { displayDate } from '../civil-day';
import type { SalesOpsLead } from './types';

/**
 * The board-facing copy and the card/list labels of a lead. Pure and React-free.
 * The form, its draft, validation and write payload live in lead-form.ts (the one LeadForm).
 */

export const CONTACT_LEAD_COPY = {
  birthdayPrefix: 'Aniversário',
  noContact: 'Sem contato',
  emptyStagesAdmin: 'Nenhuma etapa configurada. Crie as etapas do funil em Cadastros.',
  emptyStagesAdminAction: 'Ir para Etapas do funil',
  emptyStagesSeller: 'Nenhuma etapa configurada. Fale com o gestor.',
} as const;

export const CONTACT_LIST_HEADERS = {
  lead: 'Lead',
  phase: 'Fase',
  birthday: 'Aniversário',
  seller: 'Vendedor',
  inStage: 'Na fase',
  actions: 'Ações',
} as const;

/** `phone · email`, whichever exist, or `Sem contato`. */
export function leadContactLine(lead: SalesOpsLead): string {
  const parts = [lead.contactPhone, lead.contactEmail]
    .map((value) => (value ?? '').trim())
    .filter((value) => value !== '');
  return parts.length > 0 ? parts.join(' · ') : CONTACT_LEAD_COPY.noContact;
}

/** `dd/mm/aaaa` through the civil-day helper, or null without a birthday. */
export function leadBirthdayLabel(lead: SalesOpsLead): string | null {
  const birth = (lead.contactBirthDate ?? '').trim();
  return birth === '' ? null : displayDate(birth);
}
