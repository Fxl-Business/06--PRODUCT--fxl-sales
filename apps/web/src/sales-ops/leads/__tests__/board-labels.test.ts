import { describe, expect, it } from 'vitest';
import {
  SALE_STATUS_LABEL,
  buildLabelLookups,
  leadCompanyLabel,
  leadProductLabels,
  leadSellerLabel,
} from '../board-labels';
import type { SalesOpsLead } from '../types';
import type { SalesOpsClient, SalesOpsPerson, SalesOpsProduct } from '../../types';

/**
 * Every identifier-to-label resolution the board performs, and the one rule that
 * runs through all of them: a raw id NEVER reaches the screen (CLAUDE.md, "UI
 * Identifiers"). An id the cache cannot resolve degrades to the server's own
 * snapshot and then to pt-BR copy.
 */

const CLIENT_ID = 'c0000000-0000-4000-8000-000000000001';
const PERSON_ID = 'd0000000-0000-4000-8000-000000000001';
const PRODUCT_ID = 'e0000000-0000-4000-8000-000000000001';
const UNKNOWN_ID = 'f0000000-0000-4000-8000-0000000000ff';

const lookups = buildLabelLookups({
  clients: [{ id: CLIENT_ID, name: 'Acme Indústria' } as SalesOpsClient],
  people: [{ id: PERSON_ID, displayName: 'Marina Souza' } as SalesOpsPerson],
  products: [{ id: PRODUCT_ID, name: 'FXL Custom' } as SalesOpsProduct],
});

function lead(patch: Partial<SalesOpsLead> = {}): SalesOpsLead {
  return {
    id: 'aaaaaaaa-0000-4000-8000-000000000001',
    stageId: 'bbbbbbbb-0000-4000-8000-000000000001',
    position: 1,
    contactName: 'Ana',
    clientId: null,
    clientNameSnapshot: '',
    estimatedValueBrl: 0,
    description: null,
    sellerPersonId: null,
    sellerNameSnapshot: '',
    lostReason: null,
    stageChangedAt: '2026-09-15T12:00:00.000Z',
    saleId: null,
    saleStatus: null,
    saleCode: null,
    products: [],
    createdAt: '2026-09-01T12:00:00.000Z',
    updatedAt: null,
    ...patch,
  };
}

describe('leadCompanyLabel', () => {
  it('prefers the cadastro client name over the free-text company', () => {
    const row = lead({ clientId: CLIENT_ID, clientNameSnapshot: 'Acme velho nome' });

    expect(leadCompanyLabel(row, lookups)).toBe('Acme Indústria');
  });

  it('falls back to the free text, then to Sem empresa, and never to the id', () => {
    const unresolved = lead({ clientId: UNKNOWN_ID, clientNameSnapshot: 'Beta Serviços' });
    expect(leadCompanyLabel(unresolved, lookups)).toBe('Beta Serviços');

    const bare = lead({ clientId: UNKNOWN_ID, clientNameSnapshot: '   ' });
    expect(leadCompanyLabel(bare, lookups)).toBe('Sem empresa');
    expect(leadCompanyLabel(bare, lookups)).not.toContain(UNKNOWN_ID);
  });
});

describe('leadSellerLabel', () => {
  it('prefers the live pessoa name over the server snapshot, and never renders a person id', () => {
    const resolved = lead({ sellerPersonId: PERSON_ID, sellerNameSnapshot: 'Marina S.' });
    expect(leadSellerLabel(resolved, lookups)).toBe('Marina Souza');

    const stale = lead({ sellerPersonId: UNKNOWN_ID, sellerNameSnapshot: 'Marina S.' });
    expect(leadSellerLabel(stale, lookups)).toBe('Marina S.');

    const none = lead({ sellerPersonId: UNKNOWN_ID, sellerNameSnapshot: '' });
    expect(leadSellerLabel(none, lookups)).toBe('Sem vendedor');
    expect(leadSellerLabel(none, lookups)).not.toContain(UNKNOWN_ID);
  });
});

describe('leadProductLabels', () => {
  it('labels a free lead product from its snapshot and a catalog one from the catalog', () => {
    const row = lead({
      products: [
        { productId: PRODUCT_ID, productNameSnapshot: 'FXL Custom (antigo)' },
        { productId: null, productNameSnapshot: 'Integração X' },
        { productId: UNKNOWN_ID, productNameSnapshot: 'Produto arquivado' },
      ],
    });

    expect(leadProductLabels(row, lookups)).toEqual([
      'FXL Custom',
      'Integração X',
      'Produto arquivado',
    ]);
  });

  it('never yields an empty string and never yields an id', () => {
    const row = lead({ products: [{ productId: UNKNOWN_ID, productNameSnapshot: '  ' }] });
    const labels = leadProductLabels(row, lookups);

    expect(labels).toHaveLength(1);
    expect(labels[0]).not.toBe('');
    expect(labels[0]).not.toContain(UNKNOWN_ID);
  });
});

describe('SALE_STATUS_LABEL', () => {
  it('names the five sale statuses in pt-BR', () => {
    expect(SALE_STATUS_LABEL).toEqual({
      draft: 'Rascunho',
      open: 'Aberta',
      won: 'Ganha',
      lost: 'Perdida',
      cancelled: 'Cancelada',
    });
  });
});
