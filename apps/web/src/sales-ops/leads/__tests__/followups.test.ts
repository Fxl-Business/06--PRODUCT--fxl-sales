import { describe, expect, it } from 'vitest';
import { PERIOD_ALL } from '../../period';
import { followupsParams, sortFollowups } from '../followups';
import type { FollowupListRow } from '../crm-types';

const row = (id: string, dueOn: string, leadContactName: string): FollowupListRow => ({
  id, leadId: `lead-${id}`, leadContactName, nextStep: 'Ligar', dueOn, ownerName: null, doneAt: null,
});

describe('followups', () => {
  it('sorts by due day, then by the lead name in pt-BR', () => {
    const sorted = sortFollowups([
      row('a', '2026-10-25', 'Zélia'),
      row('b', '2026-10-20', 'Bruno'),
      row('c', '2026-10-25', 'Ana'),
    ]);
    expect(sorted.map((item) => item.id)).toEqual(['b', 'c', 'a']);
  });

  it('builds the list query with the period days, and sends no from or to for an open period', () => {
    expect(followupsParams('team', 'open', { from: '2026-10-20', to: '2026-10-26' })).toEqual({
      scope: 'team', status: 'open', from: '2026-10-20', to: '2026-10-26',
    });
    expect(followupsParams('mine', 'all', PERIOD_ALL)).toStrictEqual({ scope: 'mine', status: 'all' });
  });
});
