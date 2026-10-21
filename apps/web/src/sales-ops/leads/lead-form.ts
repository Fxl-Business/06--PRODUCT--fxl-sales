import { isIsoDay } from '@fxl-sales/shared-utils/sao-paulo-day';
import { parseCurrencyInputToCents } from '../calculations';
import type { FieldDefinition, FieldKind, FieldReferenceItem, LeadFieldValue } from './crm-types';
import type { LeadFieldWrite, LeadFieldWriteValue, LeadWritePayload } from './api';
import type { SalesOpsLead } from './types';

/**
 * Pure logic of the ONE LeadForm (both editions). No React, no fetch.
 * The write body is `LeadWritePayload` (api.ts), the single LeadWriteSchema shape.
 */

/** The Cliente system field key. It is carried ONLY by the top-level clientId/clientName. */
export const CLIENTE_FIELD_KEY = 'cliente';

/** The birth-date field key. It alone is capped at today (no future birthday). */
export const BIRTH_DATE_FIELD_KEY = 'nascimento';

export const LEAD_FORM_COPY = {
  createTitle: 'Novo lead',
  editTitle: 'Editar lead',
  description: 'Nome e contato são obrigatórios. O restante é opcional.',
  nameLabel: 'Nome do contato',
  phoneLabel: 'Telefone / WhatsApp',
  emailLabel: 'E-mail',
  clientLabel: 'Cliente',
  valueLabel: 'Valor estimado (R$)',
  sellerLabel: 'Vendedor responsável',
  sellerPlaceholder: 'Selecione o vendedor',
  clearLabel: 'Limpar',
  contactHint: 'Informe ao menos um: telefone ou e-mail.',
  contactPrefilled: 'Contato preenchido a partir do cliente.',
  nameRequired: 'Informe o nome.',
  contactRequired: 'Informe o telefone ou o e-mail do contato.',
  emailInvalid: 'Informe um e-mail válido.',
  numberInvalid: 'Informe um número válido.',
  dateInvalid: 'Informe uma data válida.',
  birthDateFuture: 'A data de aniversário não pode ser no futuro.',
  noStageError: 'Nenhuma etapa ativa no funil. O lead não foi salvo.',
  saveFailed: 'Não foi possível salvar o lead. Tente novamente.',
} as const;

export type FieldDraft = string | FieldReferenceItem[];
export type LeadFormDraft = {
  contactName: string;
  contactPhone: string;
  contactEmail: string;
  clientId: string | null;
  clientName: string;
  estimatedValue: string;
  sellerPersonId: string | null;
  fields: Record<string, FieldDraft>;
};
/** `field` is `contactName`, `contact`, `contactEmail` or `field:<fieldId>`. */
export type LeadFormProblem = { field: string; message: string };

export function isClienteDefinition(definition: FieldDefinition): boolean {
  return definition.referenceTarget === 'cliente';
}

/** The dynamic fields the form renders: every definition except the Cliente, in position order. */
export function renderableDefinitions(definitions: readonly FieldDefinition[]): FieldDefinition[] {
  return definitions.filter((d) => !isClienteDefinition(d)).sort((a, b) => a.position - b.position);
}

const SEED_BY_KIND: Record<FieldKind, (value: LeadFieldValue['value'] | undefined) => FieldDraft> = {
  text: (v) => (typeof v === 'string' ? v : ''),
  number: (v) => (typeof v === 'number' ? String(v) : typeof v === 'string' ? v : ''),
  money: (v) => (typeof v === 'number' ? (v / 100).toFixed(2) : ''),
  date: (v) => (typeof v === 'string' ? v : ''),
  options: (v) => (typeof v === 'string' ? v : ''),
  reference: (v) => (Array.isArray(v) ? v.map((item) => ({ id: item.id, name: item.name })) : []),
};

export function leadFormDraftFromLead(lead: SalesOpsLead | null, definitions: readonly FieldDefinition[]): LeadFormDraft {
  const fields: Record<string, FieldDraft> = {};
  for (const definition of renderableDefinitions(definitions)) {
    const stored = lead?.fields?.find((f) => f.fieldId === definition.id)?.value;
    fields[definition.id] = SEED_BY_KIND[definition.kind](stored);
  }
  return {
    contactName: lead?.contactName ?? '',
    contactPhone: lead?.contactPhone ?? '',
    contactEmail: lead?.contactEmail ?? '',
    clientId: lead?.clientId ?? null,
    clientName: lead?.clientNameSnapshot ?? '',
    estimatedValue: lead?.estimatedValueBrl ? (lead.estimatedValueBrl / 100).toFixed(2) : '',
    sellerPersonId: lead?.sellerPersonId ?? null,
    fields,
  };
}

function hasStoredValue(value: LeadFieldValue['value'] | undefined): boolean {
  if (value === null || value === undefined || value === '') return false;
  return !(Array.isArray(value) && value.length === 0);
}

/** Ids of the dynamic fields that hold a value today; the Cliente is excluded (it is not a field entry). */
export function fieldIdsWithValue(lead: SalesOpsLead | null): Set<string> {
  const ids = new Set<string>();
  for (const field of lead?.fields ?? []) {
    if (field.key !== CLIENTE_FIELD_KEY && hasStoredValue(field.value)) ids.add(field.fieldId);
  }
  return ids;
}

export function splitClientContact(contact: string | null | undefined): { phone: string; email: string } {
  const trimmed = (contact ?? '').trim();
  if (trimmed === '') return { phone: '', email: '' };
  if (trimmed.includes('@')) return { phone: '', email: trimmed };
  return { phone: trimmed, email: '' };
}

/**
 * Prefills only the contact. A cliente has no responsible seller (no column), so the
 * vendedor is never touched. Typed text is never overwritten.
 */
export function prefillContactFromClient(
  draft: Pick<LeadFormDraft, 'contactPhone' | 'contactEmail'>,
  client: { contact: string | null } | undefined,
): Partial<Pick<LeadFormDraft, 'contactPhone' | 'contactEmail'>> {
  if (!client) return {};
  const split = splitClientContact(client.contact);
  const patch: Partial<Pick<LeadFormDraft, 'contactPhone' | 'contactEmail'>> = {};
  if (draft.contactPhone.trim() === '' && split.phone !== '') patch.contactPhone = split.phone;
  if (draft.contactEmail.trim() === '' && split.email !== '') patch.contactEmail = split.email;
  return patch;
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const FIELD_CHECK_BY_KIND: Record<FieldKind, (draft: FieldDraft | undefined) => string | null> = {
  number: (draft) => checkNumber(draft),
  money: (draft) => checkNumber(draft),
  date: (draft) => (typeof draft === 'string' && draft.trim() !== '' && !isIsoDay(draft.trim()) ? LEAD_FORM_COPY.dateInvalid : null),
  text: () => null,
  options: () => null,
  reference: () => null,
};

export function isBirthDateDefinition(definition: FieldDefinition): boolean {
  return definition.kind === 'date' && definition.key === BIRTH_DATE_FIELD_KEY;
}

/** A valid ISO day strictly after `today`. Both sides are civil days compared as strings. */
function isFutureIsoDay(draft: FieldDraft | undefined, today: string): boolean {
  if (typeof draft !== 'string') return false;
  const day = draft.trim();
  return isIsoDay(day) && day > today;
}

function checkNumber(draft: FieldDraft | undefined): string | null {
  if (typeof draft !== 'string' || draft.trim() === '') return null;
  return Number.isFinite(Number(draft)) ? null : LEAD_FORM_COPY.numberInvalid;
}

/**
 * `contactOptional` is set by the caller for an EDIT of a lead that never had a contact
 * (most legacy leads). The API accepts a row without contact, so the form does not force one
 * on it; a new lead, or one that already has a contact, still needs one.
 * `today` is the São Paulo civil day the caller passes (`todayInSaoPaulo()`); this module never reads the clock.
 */
export function validateLeadFormDraft(
  draft: LeadFormDraft,
  definitions: readonly FieldDefinition[],
  options: { contactOptional?: boolean; today: string },
): LeadFormProblem | null {
  if (draft.contactName.trim() === '') return { field: 'contactName', message: LEAD_FORM_COPY.nameRequired };
  if (!options.contactOptional && draft.contactPhone.trim() === '' && draft.contactEmail.trim() === '') {
    return { field: 'contact', message: LEAD_FORM_COPY.contactRequired };
  }
  if (draft.contactEmail.trim() !== '' && !EMAIL_PATTERN.test(draft.contactEmail.trim())) {
    return { field: 'contactEmail', message: LEAD_FORM_COPY.emailInvalid };
  }
  for (const definition of renderableDefinitions(definitions)) {
    const message = FIELD_CHECK_BY_KIND[definition.kind](draft.fields[definition.id]);
    if (message !== null) return { field: `field:${definition.id}`, message };
    if (isBirthDateDefinition(definition) && isFutureIsoDay(draft.fields[definition.id], options.today)) {
      return { field: `field:${definition.id}`, message: LEAD_FORM_COPY.birthDateFuture };
    }
  }
  return null;
}

function trimmedOrNull(value: string): string | null {
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

const WRITE_BY_KIND: Record<FieldKind, (draft: FieldDraft | undefined) => LeadFieldWriteValue> = {
  text: (draft) => (typeof draft === 'string' && draft.trim() !== '' ? draft.trim() : null),
  options: (draft) => (typeof draft === 'string' && draft.trim() !== '' ? draft.trim() : null),
  date: (draft) => (typeof draft === 'string' && draft.trim() !== '' ? draft.trim() : null),
  number: (draft) => (typeof draft === 'string' && draft.trim() !== '' ? Number(draft) : null),
  money: (draft) => (typeof draft === 'string' && draft.trim() !== '' ? parseCurrencyInputToCents(draft) : null),
  reference: (draft) => {
    if (!Array.isArray(draft)) return null;
    const items = draft.map((item) => ({ id: item.id, name: item.name.trim() })).filter((item) => item.name !== '');
    return items.length > 0 ? items : null;
  },
};

export function fieldDraftToWrite(definition: FieldDefinition, draft: FieldDraft | undefined): LeadFieldWriteValue {
  return WRITE_BY_KIND[definition.kind](draft);
}

export function buildLeadWritePayload(
  draft: LeadFormDraft,
  definitions: readonly FieldDefinition[],
  options: {
    id?: string;
    includeSeller: boolean;
    pipelineId?: string;
    hadValue?: ReadonlySet<string>;
    /** Edit of a contact-less lead that still has none: the contact keys are omitted, not sent as null. */
    contactOptional?: boolean;
  },
): LeadWritePayload {
  const phone = trimmedOrNull(draft.contactPhone);
  const email = trimmedOrNull(draft.contactEmail);
  const omitContact = options.contactOptional === true && phone === null && email === null;
  const fields: LeadFieldWrite[] = [];
  for (const definition of renderableDefinitions(definitions)) {
    const value = fieldDraftToWrite(definition, draft.fields[definition.id]);
    if (value !== null || options.hadValue?.has(definition.id)) fields.push({ fieldId: definition.id, value });
  }
  return {
    ...(options.id ? { id: options.id } : {}),
    contactName: draft.contactName.trim(),
    ...(omitContact ? {} : { contactPhone: phone, contactEmail: email }),
    clientId: draft.clientId,
    clientName: trimmedOrNull(draft.clientName),
    estimatedValueBrl: parseCurrencyInputToCents(draft.estimatedValue),
    ...(options.includeSeller ? { sellerPersonId: draft.sellerPersonId } : {}),
    ...(!options.id && options.pipelineId ? { pipelineId: options.pipelineId } : {}),
    fields,
  };
}

/**
 * The full previous state as a write body, used by the edit undo. The Cliente is
 * carried ONLY by `clientId`/`clientName`: the API refuses `clientId` together with a
 * Cliente entry of `fields` (400 field_invalid), so that entry is dropped here.
 */
export function leadToWriteSeed(lead: SalesOpsLead, clearFieldIds: readonly string[] = []): LeadWritePayload {
  const kept: LeadFieldWrite[] = (lead.fields ?? [])
    .filter((f) => f.key !== CLIENTE_FIELD_KEY)
    .map((f) => ({ fieldId: f.fieldId, value: f.value }));
  return {
    id: lead.id,
    contactName: lead.contactName,
    contactPhone: lead.contactPhone,
    contactEmail: lead.contactEmail,
    clientId: lead.clientId,
    clientName: lead.clientNameSnapshot || null,
    estimatedValueBrl: lead.estimatedValueBrl,
    sellerPersonId: lead.sellerPersonId,
    fields: [...kept, ...clearFieldIds.map((fieldId) => ({ fieldId, value: null }))],
  };
}

export function leadFormSaveErrorCopy(error: unknown): string {
  if (
    typeof error === 'object' &&
    error !== null &&
    (error as { status?: unknown }).status === 400 &&
    (error as { reason?: unknown }).reason === 'no_open_stage'
  ) {
    return LEAD_FORM_COPY.noStageError;
  }
  return LEAD_FORM_COPY.saveFailed;
}
