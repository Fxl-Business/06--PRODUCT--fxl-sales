import { isIsoDay } from '@fxl-sales/shared-utils/sao-paulo-day';
import { parseCurrencyInputToCents } from '../calculations';
import { displayDate } from '../civil-day';
import type { SaveContactLeadPayload } from './api';
import type { SalesOpsLead } from './types';

/**
 * The leads edition's contact lead: copy, form draft, validation, the six-key
 * write payload and the card/list labels. Pure and React-free.
 *
 * This file must not import the HTTP client module (board-write-surface
 * OWNED_FILES rule), so the save-error classification below is structural.
 */

export const CONTACT_LEAD_COPY = {
  dialogDescription: 'Dados de contato do lead.',
  nameLabel: 'Nome do contato (comprador)',
  birthDateLabel: 'Data de aniversário',
  phoneLabel: 'Número (telefone/WhatsApp)',
  emailLabel: 'Email',
  descriptionLabel: 'Descrição',
  sellerLabel: 'Vendedor responsável',
  sellerPlaceholder: 'Selecione o vendedor',
  clientLabel: 'Cliente',
  clientPlaceholder: 'Selecione ou crie um cliente',
  valueLabel: 'Valor estimado (R$)',
  clearLabel: 'Limpar',
  nameRequired: 'Informe o nome.',
  birthDateInvalid: 'Informe uma data de aniversário válida.',
  birthDateFuture: 'A data de aniversário não pode ser no futuro.',
  emailInvalid: 'Informe um email válido.',
  noContact: 'Sem contato',
  birthdayPrefix: 'Aniversário',
  noStageError: 'Nenhuma etapa ativa no funil. O lead não foi salvo.',
  saveFailed: 'Não foi possível salvar o lead. Tente novamente.',
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

/** Form state: every field a string except the pickers. */
export type ContactLeadDraft = {
  contactName: string;
  contactPhone: string;
  contactEmail: string;
  contactBirthDate: string;
  description: string;
  sellerPersonId: string | null;
  /** Links a sales_ops_clients row, or null. The dialog creates one by name inline. */
  clientId: string | null;
  /** The chosen/created client's name, used as the trigger label and the snapshot fallback. */
  clientName: string;
  /** Valor estimado as typed reais (string); parsed to cents on build. */
  estimatedValue: string;
};

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Null-safe: every null becomes '' (the pickers stay null). */
export function contactDraftFromSeed(initial: SaveContactLeadPayload | null): ContactLeadDraft {
  return {
    contactName: initial?.contactName ?? '',
    contactPhone: initial?.contactPhone ?? '',
    contactEmail: initial?.contactEmail ?? '',
    contactBirthDate: initial?.contactBirthDate ?? '',
    description: initial?.description ?? '',
    sellerPersonId: initial?.sellerPersonId ?? null,
    clientId: initial?.clientId ?? null,
    clientName: initial?.clientName ?? '',
    estimatedValue: initial?.estimatedValueBrl ? (initial.estimatedValueBrl / 100).toFixed(2) : '',
  };
}

/**
 * The first blocking problem, or null. `today` is an ISO civil day and the
 * birthday is compared with it as a string, never through `new Date`.
 */
export function validateContactLeadDraft(draft: ContactLeadDraft, today: string): string | null {
  const birth = draft.contactBirthDate.trim();
  const email = draft.contactEmail.trim();
  if (draft.contactName.trim() === '') return CONTACT_LEAD_COPY.nameRequired;
  if (birth !== '' && !isIsoDay(birth)) return CONTACT_LEAD_COPY.birthDateInvalid;
  if (birth !== '' && birth > today) return CONTACT_LEAD_COPY.birthDateFuture;
  if (email !== '' && !EMAIL_PATTERN.test(email)) return CONTACT_LEAD_COPY.emailInvalid;
  return null;
}

function trimmedOrNull(value: string): string | null {
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

/**
 * The six-key write body (plus `id` when editing). Every optional key is always
 * sent, null when blank, so a PATCH clears it. No lowercasing: the API owns it.
 *
 * `includeSeller: false` (a viewer who is not offered the vendedor picker) drops
 * the `sellerPersonId` KEY, never sends null: the API defaults a create to the
 * caller's own pessoa, and an edit leaves the stored vendedor untouched.
 */
export function buildContactLeadPayload(
  draft: ContactLeadDraft,
  id?: string,
  options: { includeSeller?: boolean } = {},
): SaveContactLeadPayload {
  const includeSeller = options.includeSeller ?? true;
  return {
    ...(id ? { id } : {}),
    contactName: draft.contactName.trim(),
    contactPhone: trimmedOrNull(draft.contactPhone),
    contactEmail: trimmedOrNull(draft.contactEmail),
    contactBirthDate: trimmedOrNull(draft.contactBirthDate),
    description: trimmedOrNull(draft.description),
    // Empresa: the link wins when present; the snapshot rides along for the
    // free-text fallback the API applies when no link resolves.
    clientId: draft.clientId,
    clientName: trimmedOrNull(draft.clientName),
    estimatedValueBrl: parseCurrencyInputToCents(draft.estimatedValue),
    ...(includeSeller ? { sellerPersonId: draft.sellerPersonId } : {}),
  };
}

export function leadToContactSeed(lead: SalesOpsLead): SaveContactLeadPayload {
  return {
    id: lead.id,
    contactName: lead.contactName,
    contactPhone: lead.contactPhone,
    contactEmail: lead.contactEmail,
    contactBirthDate: lead.contactBirthDate,
    description: lead.description,
    sellerPersonId: lead.sellerPersonId,
    clientId: lead.clientId,
    // The snapshot is NOT NULL ('' when no empresa); seed it as null so the draft
    // and the rebuilt payload round-trip exactly.
    clientName: lead.clientNameSnapshot || null,
    estimatedValueBrl: lead.estimatedValueBrl,
  };
}

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

/**
 * SEAM A1: a create with no active normal etapa answers 400 with
 * `reason: 'no_open_stage'`. Anything else is the generic save failure.
 * Rendered INSIDE the still-open contact dialog (D-07.1c).
 */
export function contactLeadSaveErrorCopy(error: unknown): string {
  if (
    typeof error === 'object' &&
    error !== null &&
    (error as { status?: unknown }).status === 400 &&
    (error as { reason?: unknown }).reason === 'no_open_stage'
  ) {
    return CONTACT_LEAD_COPY.noStageError;
  }
  return CONTACT_LEAD_COPY.saveFailed;
}
