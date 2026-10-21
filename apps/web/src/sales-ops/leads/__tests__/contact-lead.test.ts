import { describe, expect, it } from 'vitest';
import { CONTACT_LEAD_COPY, leadBirthdayLabel, leadContactLine } from '../contact-lead';
import type { SalesOpsLead } from '../types';

/**
 * The board-facing labels of a lead. The form's draft, validation and payload are
 * tested in lead-form.test.ts (the one LeadForm).
 */

const LEAD_ID = 'aaaaaaaa-0000-4000-8000-000000000001';
const SELLER_ID = 'd0000000-0000-4000-8000-000000000001';

function lead(patch: Partial<SalesOpsLead> = {}): SalesOpsLead {
  return {
    id: LEAD_ID,
    stageId: 'bbbbbbbb-0000-4000-8000-000000000001',
    position: 1,
    contactName: 'Ana Construbom',
    clientId: null,
    clientNameSnapshot: '',
    estimatedValueBrl: 0,
    description: 'Indicação da feira',
    contactPhone: '(11) 98888-7777',
    contactEmail: 'ana@x.com',
    contactBirthDate: '1990-02-28',
    sellerPersonId: SELLER_ID,
    sellerNameSnapshot: 'Rafael Lima',
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

describe('leadContactLine', () => {
  it('joins phone and email', () => {
    expect(leadContactLine(lead())).toBe('(11) 98888-7777 · ana@x.com');
  });

  it('shows whichever one exists', () => {
    expect(leadContactLine(lead({ contactEmail: null }))).toBe('(11) 98888-7777');
    expect(leadContactLine(lead({ contactPhone: null }))).toBe('ana@x.com');
  });

  it('says Sem contato when both are blank', () => {
    expect(leadContactLine(lead({ contactPhone: null, contactEmail: null }))).toBe('Sem contato');
    expect(leadContactLine(lead({ contactPhone: '   ', contactEmail: ' ' }))).toBe('Sem contato');
  });
});

describe('leadBirthdayLabel', () => {
  it('formats the civil day as dd/mm/aaaa', () => {
    expect(leadBirthdayLabel(lead({ contactBirthDate: '1990-02-28' }))).toBe('28/02/1990');
  });

  it('reads a timestamp by its civil day, with no timezone shift', () => {
    expect(leadBirthdayLabel(lead({ contactBirthDate: '1990-03-01T00:00:00.000Z' }))).toBe(
      '01/03/1990',
    );
  });

  it('is null without a birthday', () => {
    expect(leadBirthdayLabel(lead({ contactBirthDate: null }))).toBeNull();
    expect(leadBirthdayLabel(lead({ contactBirthDate: '  ' }))).toBeNull();
  });
});

describe('CONTACT_LEAD_COPY', () => {
  it('keeps the empty-state and birthday copy the board renders', () => {
    expect(CONTACT_LEAD_COPY.noContact).toBe('Sem contato');
    expect(CONTACT_LEAD_COPY.birthdayPrefix).toBe('Aniversário');
  });
});
