import { describe, expect, it } from 'vitest';
import {
  CONTACT_LEAD_COPY,
  buildContactLeadPayload,
  contactDraftFromSeed,
  contactLeadSaveErrorCopy,
  leadBirthdayLabel,
  leadContactLine,
  leadToContactSeed,
  validateContactLeadDraft,
  type ContactLeadDraft,
} from '../contact-lead';
import type { SalesOpsLead } from '../types';

/**
 * The leads edition's contact lead rules: the draft validation, the six-key
 * payload, and the card/list labels. Pure, so no auth or React here.
 */

const TODAY = '2026-10-05';
const LEAD_ID = 'aaaaaaaa-0000-4000-8000-000000000001';
const SELLER_ID = 'd0000000-0000-4000-8000-000000000001';

const CONTACT_KEYS = [
  'contactName',
  'contactPhone',
  'contactEmail',
  'contactBirthDate',
  'description',
  'clientId',
  'clientName',
  'estimatedValueBrl',
  'sellerPersonId',
];

function draft(patch: Partial<ContactLeadDraft> = {}): ContactLeadDraft {
  return {
    contactName: 'Ana',
    contactPhone: '',
    contactEmail: '',
    contactBirthDate: '',
    description: '',
    sellerPersonId: null,
    clientId: null,
    clientName: '',
    estimatedValue: '',
    ...patch,
  };
}

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

describe('validateContactLeadDraft', () => {
  it('requires a name', () => {
    expect(validateContactLeadDraft(draft({ contactName: '   ' }), TODAY)).toBe(
      CONTACT_LEAD_COPY.nameRequired,
    );
  });

  it('accepts a name-only draft', () => {
    expect(validateContactLeadDraft(draft(), TODAY)).toBeNull();
  });

  it('refuses a day that does not exist', () => {
    expect(validateContactLeadDraft(draft({ contactBirthDate: '2026-02-30' }), TODAY)).toBe(
      CONTACT_LEAD_COPY.birthDateInvalid,
    );
  });

  it('refuses a birthday after today and accepts today itself', () => {
    expect(validateContactLeadDraft(draft({ contactBirthDate: '2026-10-06' }), TODAY)).toBe(
      CONTACT_LEAD_COPY.birthDateFuture,
    );
    expect(validateContactLeadDraft(draft({ contactBirthDate: '2026-10-05' }), TODAY)).toBeNull();
  });

  it('refuses a malformed email and accepts a real one', () => {
    expect(validateContactLeadDraft(draft({ contactEmail: 'ana@' }), TODAY)).toBe(
      CONTACT_LEAD_COPY.emailInvalid,
    );
    expect(
      validateContactLeadDraft(draft({ contactEmail: 'ana@construbom.com.br' }), TODAY),
    ).toBeNull();
  });

  it('reports the name first when several fields are wrong', () => {
    expect(
      validateContactLeadDraft(
        draft({ contactName: '', contactBirthDate: '2026-10-06', contactEmail: 'ana@' }),
        TODAY,
      ),
    ).toBe(CONTACT_LEAD_COPY.nameRequired);
  });
});

describe('buildContactLeadPayload', () => {
  it('sends the contact keys plus empresa and valor, blanks as null', () => {
    const payload = buildContactLeadPayload(draft({ contactName: '  Ana  ', description: '   ' }));
    expect(Object.keys(payload)).toEqual(CONTACT_KEYS);
    expect(payload).toEqual({
      contactName: 'Ana',
      contactPhone: null,
      contactEmail: null,
      contactBirthDate: null,
      description: null,
      clientId: null,
      clientName: null,
      estimatedValueBrl: 0,
      sellerPersonId: null,
    });
  });

  it('carries the chosen empresa and parses the valor to cents', () => {
    const payload = buildContactLeadPayload(
      draft({ clientId: LEAD_ID, clientName: '  Empresa Um  ', estimatedValue: '1.234,56' }),
    );
    expect(payload.clientId).toBe(LEAD_ID);
    expect(payload.clientName).toBe('Empresa Um');
    expect(payload.estimatedValueBrl).toBe(123456);
  });

  it('trims every typed field and never lowercases', () => {
    const payload = buildContactLeadPayload(
      draft({
        contactPhone: ' (11) 98888-7777 ',
        contactEmail: ' Ana@X.com ',
        contactBirthDate: ' 1990-02-28 ',
        description: '  Indicação  ',
        sellerPersonId: SELLER_ID,
      }),
    );
    expect(payload).toEqual({
      contactName: 'Ana',
      contactPhone: '(11) 98888-7777',
      contactEmail: 'Ana@X.com',
      contactBirthDate: '1990-02-28',
      description: 'Indicação',
      clientId: null,
      clientName: null,
      estimatedValueBrl: 0,
      sellerPersonId: SELLER_ID,
    });
  });

  it('carries the id first only when given', () => {
    const payload = buildContactLeadPayload(draft(), LEAD_ID);
    expect(Object.keys(payload)).toEqual(['id', ...CONTACT_KEYS]);
    expect(payload.id).toBe(LEAD_ID);
    expect('id' in buildContactLeadPayload(draft())).toBe(false);
  });

  it('omits sellerPersonId entirely when the vendedor is not offered (D-07.1b)', () => {
    const created = buildContactLeadPayload(draft({ sellerPersonId: SELLER_ID }), undefined, {
      includeSeller: false,
    });
    expect(Object.keys(created)).toEqual(CONTACT_KEYS.filter((key) => key !== 'sellerPersonId'));

    // On an edit the key is absent too, so the PATCH leaves the stored vendedor untouched.
    const edited = buildContactLeadPayload(draft({ sellerPersonId: SELLER_ID }), LEAD_ID, {
      includeSeller: false,
    });
    expect('sellerPersonId' in edited).toBe(false);
    expect(edited.id).toBe(LEAD_ID);
  });
});

describe('contact seed round trip', () => {
  it('a lead survives seed, draft and payload unchanged', () => {
    const row = lead();
    const seed = leadToContactSeed(row);
    expect(seed).toEqual({
      id: LEAD_ID,
      contactName: 'Ana Construbom',
      contactPhone: '(11) 98888-7777',
      contactEmail: 'ana@x.com',
      contactBirthDate: '1990-02-28',
      description: 'Indicação da feira',
      sellerPersonId: SELLER_ID,
      clientId: null,
      clientName: null,
      estimatedValueBrl: 0,
    });
    expect(buildContactLeadPayload(contactDraftFromSeed(seed), seed.id)).toEqual(seed);
  });

  it('a lead with an empresa and valor round-trips', () => {
    const row = lead({ clientId: LEAD_ID, clientNameSnapshot: 'Empresa Um', estimatedValueBrl: 150000 });
    const seed = leadToContactSeed(row);
    expect(seed.clientId).toBe(LEAD_ID);
    expect(seed.clientName).toBe('Empresa Um');
    expect(seed.estimatedValueBrl).toBe(150000);
    expect(buildContactLeadPayload(contactDraftFromSeed(seed), seed.id)).toEqual(seed);
  });

  it('a null seed is an empty draft', () => {
    expect(contactDraftFromSeed(null)).toEqual({
      contactName: '',
      contactPhone: '',
      contactEmail: '',
      contactBirthDate: '',
      description: '',
      sellerPersonId: null,
      clientId: null,
      clientName: '',
      estimatedValue: '',
    });
  });

  it('a lead with no contact data seeds empty strings', () => {
    const seed = leadToContactSeed(
      lead({ contactPhone: null, contactEmail: null, contactBirthDate: null, description: null }),
    );
    expect(contactDraftFromSeed(seed)).toMatchObject({
      contactPhone: '',
      contactEmail: '',
      contactBirthDate: '',
      description: '',
    });
  });
});

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

describe('contactLeadSaveErrorCopy', () => {
  it('names the missing etapa for a 400 no_open_stage', () => {
    expect(
      contactLeadSaveErrorCopy({ status: 400, error: 'validation_error', reason: 'no_open_stage' }),
    ).toBe(CONTACT_LEAD_COPY.noStageError);
  });

  it('falls back to the generic copy for anything else', () => {
    for (const error of [
      { status: 400, error: 'validation_error' },
      { status: 400, reason: 'seller_scope' },
      { status: 409, reason: 'no_open_stage' },
      { status: 500 },
      new Error('x'),
      undefined,
      null,
    ]) {
      expect(contactLeadSaveErrorCopy(error)).toBe(CONTACT_LEAD_COPY.saveFailed);
    }
  });
});
