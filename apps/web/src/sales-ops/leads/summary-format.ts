import { SAO_PAULO_TIME_ZONE } from '@fxl-sales/shared-utils/sao-paulo-day';
import { formatMoneyBrl } from '../calculations';
import { displayDate } from '../civil-day';
import type { FieldDefinition, FieldKind, LeadFieldValue, LeadTimelineItem, LeadTimelineKind } from './crm-types';
import { CLIENTE_FIELD_KEY } from './lead-form';
import type { SalesOpsLead } from './types';

/*
 * Pure formatting of the lead summary page. No React, no clock: every "today" is
 * passed in, and every civil day goes through `displayDate` (never `new Date`).
 */

const INSTANT_FORMAT = new Intl.DateTimeFormat('pt-BR', {
  timeZone: SAO_PAULO_TIME_ZONE,
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

/** An instant as `dd/mm/aaaa HH:mm` in America/Sao_Paulo, or '' for an unreadable value. */
export function formatInstantSaoPaulo(iso: string): string {
  const time = Date.parse(iso);
  if (Number.isNaN(time)) return '';
  const parts = Object.fromEntries(INSTANT_FORMAT.formatToParts(new Date(time)).map((part) => [part.type, part.value]));
  return `${parts.day}/${parts.month}/${parts.year} ${parts.hour}:${parts.minute}`;
}

export const TIMELINE_LABEL: Record<
  LeadTimelineKind,
  (item: LeadTimelineItem) => { title: string; detail: string | null }
> = {
  stage_changed: (item) => ({
    title: item.fromStageName
      ? `Etapa: ${item.fromStageName} para ${item.toStageName ?? ''}`
      : `Entrou em ${item.toStageName ?? ''}`,
    detail: item.reason ? `Motivo: ${item.reason}` : null,
  }),
  note: (item) => ({ title: 'Nota', detail: item.body ?? null }),
  followup: (item) => ({
    title: `Próximo passo: ${item.nextStep ?? ''}`,
    detail: item.doneAt
      ? `Para ${displayDate(item.dueOn ?? '')} - concluído em ${formatInstantSaoPaulo(item.doneAt)}`
      : `Para ${displayDate(item.dueOn ?? '')}`,
  }),
};

/** Newest first by instant; a stable sort keeps equal instants in the server's order. */
export function sortTimeline(items: readonly LeadTimelineItem[]): LeadTimelineItem[] {
  return [...items].sort((a, b) => (Date.parse(b.at) || 0) - (Date.parse(a.at) || 0));
}

export type FollowupDueState = 'overdue' | 'today' | 'later';

/** Civil-day comparison of a follow-up's due day against today (both `aaaa-mm-dd`). */
export function followupDueState(dueOn: string, today: string): FollowupDueState {
  if (dueOn < today) return 'overdue';
  if (dueOn === today) return 'today';
  return 'later';
}

export const FOLLOWUP_STATE_LABEL: Record<FollowupDueState, string> = {
  overdue: 'Atrasado',
  today: 'Hoje',
  later: 'Agendado',
};

const FIELD_DISPLAY_BY_KIND: Record<FieldKind, (def: FieldDefinition, value: LeadFieldValue['value']) => string> = {
  text: (_def, value) => (typeof value === 'string' || typeof value === 'number' ? String(value) : ''),
  number: (_def, value) => (typeof value === 'string' || typeof value === 'number' ? String(value) : ''),
  money: (_def, value) => {
    const cents = typeof value === 'string' ? Number(value) : value;
    return typeof cents === 'number' && Number.isFinite(cents) ? formatMoneyBrl(cents) : '';
  },
  date: (_def, value) => (typeof value === 'string' ? displayDate(value) : ''),
  options: (def, value) => {
    if (typeof value !== 'string') return '';
    return def.options?.find((option) => option.key === value)?.label ?? value;
  },
  reference: (_def, value) => (Array.isArray(value) ? value.map((item) => item.name).join(', ') : ''),
};

/** The display text of one dynamic value; '' for an empty value. */
export function formatFieldValue(def: FieldDefinition, value: LeadFieldValue['value']): string {
  if (value === null || value === '' || (Array.isArray(value) && value.length === 0)) return '';
  return FIELD_DISPLAY_BY_KIND[def.kind](def, value);
}

/**
 * The dynamic fields a summary shows: the lead's values in definition order, minus
 * the Cliente (it has its own row) and any value that formats to nothing.
 */
export function visibleFieldRows(
  lead: SalesOpsLead,
  definitions: readonly FieldDefinition[],
): Array<{ id: string; label: string; text: string }> {
  const byId = new Map(definitions.map((def) => [def.id, def]));
  const rows: Array<{ def: FieldDefinition; text: string }> = [];
  for (const entry of lead.fields ?? []) {
    const def = byId.get(entry.fieldId);
    if (!def) continue;
    if (def.key === CLIENTE_FIELD_KEY || def.referenceTarget === 'cliente') continue;
    const text = formatFieldValue(def, entry.value);
    if (text !== '') rows.push({ def, text });
  }
  return rows
    .sort((a, b) => a.def.position - b.def.position)
    .map(({ def, text }) => ({ id: def.id, label: def.label, text }));
}
