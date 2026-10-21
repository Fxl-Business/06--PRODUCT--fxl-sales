import { describe, expect, it } from 'vitest';
import type { FieldDefinition, LeadTimelineItem } from '../crm-types';
import {
  FOLLOWUP_STATE_LABEL,
  TIMELINE_LABEL,
  followupDueState,
  formatFieldValue,
  formatInstantSaoPaulo,
  sortTimeline,
  visibleFieldRows,
} from '../summary-format';
import type { SalesOpsLead } from '../types';

const def = (overrides: Partial<FieldDefinition>): FieldDefinition => ({
  id: 'f-x', key: 'x', label: 'Campo', kind: 'text', referenceTarget: null, multiple: false, options: null,
  filterable: false, isSystem: false, removable: true, position: 1, ...overrides,
});

describe('summary-format', () => {
  it('formats an instant in America/Sao_Paulo', () => {
    expect(formatInstantSaoPaulo('2026-10-21T01:30:00.000Z')).toBe('20/10/2026 22:30');
    expect(formatInstantSaoPaulo('not a date')).toBe('');
  });

  it('labels each timeline kind', () => {
    expect(TIMELINE_LABEL.stage_changed({ kind: 'stage_changed', at: '', actorName: null, fromStageName: 'Contato', toStageName: 'Proposta', reason: 'Preço' }))
      .toEqual({ title: 'Etapa: Contato para Proposta', detail: 'Motivo: Preço' });
    expect(TIMELINE_LABEL.stage_changed({ kind: 'stage_changed', at: '', actorName: null, fromStageName: null, toStageName: 'Novo' }))
      .toEqual({ title: 'Entrou em Novo', detail: null });
    expect(TIMELINE_LABEL.note({ kind: 'note', at: '', actorName: null, body: 'Ligar amanhã' }))
      .toEqual({ title: 'Nota', detail: 'Ligar amanhã' });
    expect(TIMELINE_LABEL.followup({ kind: 'followup', at: '', actorName: null, nextStep: 'Enviar proposta', dueOn: '2026-10-25', doneAt: '2026-10-21T01:30:00.000Z' }))
      .toEqual({ title: 'Próximo passo: Enviar proposta', detail: 'Para 25/10/2026 - concluído em 20/10/2026 22:30' });
  });

  it('sorts the timeline newest first and keeps equal instants in order', () => {
    const items: LeadTimelineItem[] = [
      { kind: 'note', at: '2026-10-01T10:00:00.000Z', actorName: 'A', body: 'antiga' },
      { kind: 'note', at: '2026-10-03T10:00:00.000Z', actorName: 'A', body: 'nova' },
      { kind: 'note', at: '2026-10-03T10:00:00.000Z', actorName: 'B', body: 'nova 2' },
    ];
    expect(sortTimeline(items).map((item) => item.body)).toEqual(['nova', 'nova 2', 'antiga']);
  });

  it('classifies a follow-up by its civil due day', () => {
    expect(followupDueState('2026-10-19', '2026-10-20')).toBe('overdue');
    expect(followupDueState('2026-10-20', '2026-10-20')).toBe('today');
    expect(followupDueState('2026-10-21', '2026-10-20')).toBe('later');
    expect(FOLLOWUP_STATE_LABEL).toEqual({ overdue: 'Atrasado', today: 'Hoje', later: 'Agendado' });
  });

  it('formats a value per kind', () => {
    expect(formatFieldValue(def({ kind: 'money' }), 150000)).toBe('R$ 1.500,00');
    expect(formatFieldValue(def({ kind: 'options', options: [{ key: 'a', label: 'Alta' }] }), 'a')).toBe('Alta');
    expect(formatFieldValue(def({ kind: 'options', options: [] }), 'zz')).toBe('zz');
    expect(formatFieldValue(def({ kind: 'reference' }), [{ id: 'p1', name: 'Ana' }, { id: null, name: 'Bruno' }])).toBe('Ana, Bruno');
    expect(formatFieldValue(def({ kind: 'date' }), '2026-10-25T00:00:00Z')).toBe('25/10/2026');
    expect(formatFieldValue(def({}), '')).toBe('');
    expect(formatFieldValue(def({}), null)).toBe('');
  });

  it('lists visible field rows in definition order, skipping the cliente and empty values', () => {
    const definitions = [
      def({ id: 'f-b', label: 'Segundo', position: 2 }),
      def({ id: 'f-cli', key: 'cliente', label: 'Cliente', kind: 'reference', referenceTarget: 'cliente', position: 0 }),
      def({ id: 'f-a', label: 'Primeiro', position: 1 }),
      def({ id: 'f-empty', label: 'Vazio', position: 3 }),
    ];
    const lead = {
      id: 'lead-1',
      fields: [
        { fieldId: 'f-b', key: 'x', value: 'valor b' },
        { fieldId: 'f-cli', key: 'cliente', value: [{ id: 'c1', name: 'Acme' }] },
        { fieldId: 'f-a', key: 'x', value: 'valor a' },
        { fieldId: 'f-empty', key: 'x', value: '' },
      ],
    } as unknown as SalesOpsLead;
    expect(visibleFieldRows(lead, definitions).map((row) => row.label)).toEqual(['Primeiro', 'Segundo']);
  });
});
