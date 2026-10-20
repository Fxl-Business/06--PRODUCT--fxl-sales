import { describe, expect, it } from 'vitest';
import { buildLabelLookups } from '../board-labels';
import { matchesBoardSearch } from '../board-search';
import type { SalesOpsLead } from '../types';

const lookups = buildLabelLookups({ clients: [{ id: 'c1', name: 'São José' } as never], people: [], products: [] });
const row = {
  contactName: 'Érica Lima',
  clientId: 'c1',
  clientNameSnapshot: 'Empresa Antiga',
  contactPhone: '+55 (11) 99999-2222',
  contactEmail: 'ERICA@EXAMPLE.COM',
} as SalesOpsLead;

describe('loaded card search', () => {
  it.each(['', '  ', 'erica', ' SAO JOSE ', '99999-2222', 'example.com'])(
    'matches %j against card identity and contact fields',
    (query) => expect(matchesBoardSearch(row, lookups, query)).toBe(true),
  );

  it('does not match stale company snapshots when a resolved company is shown', () => {
    expect(matchesBoardSearch(row, lookups, 'antiga')).toBe(false);
    expect(matchesBoardSearch(row, lookups, 'Marcos')).toBe(false);
  });

  it('searches the snapshot when the company is not resolved', () => {
    expect(matchesBoardSearch({ ...row, clientId: null }, lookups, 'antiga')).toBe(true);
  });
});
