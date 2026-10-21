import { describe, expect, it } from 'vitest';
import type { FieldDefinition } from '../crm-types';
import {
  LEAD_FORM_COPY,
  buildLeadWritePayload,
  fieldIdsWithValue,
  leadFormDraftFromLead,
  leadFormSaveErrorCopy,
  leadToWriteSeed,
  prefillContactFromClient,
  renderableDefinitions,
  splitClientContact,
  validateLeadFormDraft,
  type LeadFormDraft,
} from '../lead-form';
import type { SalesOpsLead } from '../types';

const DEFS: FieldDefinition[] = [
  def('f-cli', 'cliente', 'Cliente', 'reference', 0, { referenceTarget: 'cliente', isSystem: true, removable: false }),
  def('f-desc', 'descricao', 'Descrição', 'text', 1),
  def('f-qtd', 'qtd', 'Quantidade', 'number', 2),
  def('f-orc', 'orcamento', 'Orçamento', 'money', 3),
  def('f-prazo', 'prazo', 'Prazo', 'date', 4),
  def('f-origem', 'origem', 'Origem', 'options', 5, {
    options: [
      { key: 'site', label: 'Site' },
      { key: 'indicacao', label: 'Indicação' },
    ],
  }),
  def('f-prod', 'produtos', 'Produtos', 'reference', 6, { referenceTarget: 'produto', multiple: true }),
];

function def(
  id: string,
  key: string,
  label: string,
  kind: FieldDefinition['kind'],
  position: number,
  extra: Partial<FieldDefinition> = {},
): FieldDefinition {
  return {
    id,
    key,
    label,
    kind,
    referenceTarget: null,
    multiple: false,
    options: null,
    filterable: true,
    isSystem: false,
    removable: true,
    position,
    ...extra,
  };
}

function emptyDraft(overrides: Partial<LeadFormDraft> = {}): LeadFormDraft {
  return {
    contactName: '',
    contactPhone: '',
    contactEmail: '',
    clientId: null,
    clientName: '',
    estimatedValue: '',
    sellerPersonId: null,
    fields: {},
    ...overrides,
  };
}

function leadFixture(overrides: Partial<SalesOpsLead> = {}): SalesOpsLead {
  return {
    id: 'L1',
    stageId: 'S1',
    position: 1,
    contactName: 'Ana',
    clientId: null,
    clientNameSnapshot: '',
    estimatedValueBrl: 150000,
    description: null,
    contactPhone: '123',
    contactEmail: 'ana@example.com',
    contactBirthDate: null,
    sellerPersonId: 'P1',
    sellerNameSnapshot: 'Vendedor',
    lostReason: null,
    stageChangedAt: '2026-10-01T00:00:00.000Z',
    saleId: null,
    saleStatus: null,
    saleCode: null,
    products: [],
    createdAt: '2026-10-01T00:00:00.000Z',
    updatedAt: null,
    ...overrides,
  } as unknown as SalesOpsLead;
}

const CLIENT_CONTACT_LEAD = leadFixture({
  id: 'L2',
  clientId: 'c1',
  clientNameSnapshot: 'Acme',
  fields: [
    { fieldId: 'f-cli', key: 'cliente', value: [{ id: 'c1', name: 'Acme' }] },
    { fieldId: 'f-desc', key: 'descricao', value: 'Antes' },
  ],
});

describe('lead-form validation', () => {
  it('requires a name first, then one contact', () => {
    expect(validateLeadFormDraft(emptyDraft(), DEFS)).toEqual({ field: 'contactName', message: LEAD_FORM_COPY.nameRequired });
    expect(validateLeadFormDraft(emptyDraft({ contactName: 'Ana' }), DEFS)).toEqual({
      field: 'contact',
      message: LEAD_FORM_COPY.contactRequired,
    });
    expect(validateLeadFormDraft(emptyDraft({ contactName: 'Ana', contactPhone: '11999' }), DEFS)).toBeNull();
    expect(validateLeadFormDraft(emptyDraft({ contactName: 'Ana', contactEmail: 'ana@acme.com' }), DEFS)).toBeNull();
  });

  it('an edit of a contact-less lead does not force a contact, and the payload omits the contact keys', () => {
    const blank = emptyDraft({ contactName: 'Ana', estimatedValue: '' });
    expect(validateLeadFormDraft(blank, DEFS)).toEqual({ field: 'contact', message: LEAD_FORM_COPY.contactRequired });
    expect(validateLeadFormDraft(blank, DEFS, { contactOptional: true })).toBeNull();
    const payload = buildLeadWritePayload(blank, DEFS, { id: 'L1', includeSeller: false, contactOptional: true });
    expect('contactPhone' in payload).toBe(false);
    expect('contactEmail' in payload).toBe(false);
    const typed = buildLeadWritePayload({ ...blank, contactPhone: '11' }, DEFS, {
      id: 'L1',
      includeSeller: false,
      contactOptional: true,
    });
    expect(typed.contactPhone).toBe('11');
  });

  it('refuses a malformed e-mail', () => {
    expect(validateLeadFormDraft(emptyDraft({ contactName: 'Ana', contactEmail: 'ana@' }), DEFS)).toEqual({
      field: 'contactEmail',
      message: LEAD_FORM_COPY.emailInvalid,
    });
  });

  it('refuses a bad number, money and date', () => {
    const base = emptyDraft({ contactName: 'Ana', contactPhone: '1' });
    expect(validateLeadFormDraft({ ...base, fields: { 'f-qtd': 'abc' } }, DEFS)).toEqual({
      field: 'field:f-qtd',
      message: LEAD_FORM_COPY.numberInvalid,
    });
    expect(validateLeadFormDraft({ ...base, fields: { 'f-orc': 'x' } }, DEFS)).toEqual({
      field: 'field:f-orc',
      message: LEAD_FORM_COPY.numberInvalid,
    });
    expect(validateLeadFormDraft({ ...base, fields: { 'f-prazo': '2026-02-30' } }, DEFS)).toEqual({
      field: 'field:f-prazo',
      message: LEAD_FORM_COPY.dateInvalid,
    });
    expect(
      validateLeadFormDraft({ ...base, fields: { 'f-qtd': '3', 'f-orc': '12', 'f-prazo': '2026-11-01' } }, DEFS),
    ).toBeNull();
  });

  it('the cliente definition is never validated nor rendered as a dynamic field', () => {
    expect(renderableDefinitions(DEFS).map((d) => d.key)).not.toContain('cliente');
    expect(renderableDefinitions(DEFS).map((d) => d.key)).toEqual(['descricao', 'qtd', 'orcamento', 'prazo', 'origem', 'produtos']);
  });
});

describe('contact prefill from an empresa', () => {
  it('splitClientContact classifies an e-mail by the at sign', () => {
    expect(splitClientContact('ana@acme.com')).toEqual({ phone: '', email: 'ana@acme.com' });
    expect(splitClientContact(' (11) 99999-0000 ')).toEqual({ phone: '(11) 99999-0000', email: '' });
    expect(splitClientContact(null)).toEqual({ phone: '', email: '' });
  });

  it('prefillContactFromClient fills only blank targets and never overwrites typed text', () => {
    expect(prefillContactFromClient({ contactPhone: '111', contactEmail: '' }, { contact: '(11) 2' })).toEqual({});
    expect(prefillContactFromClient({ contactPhone: '', contactEmail: '' }, { contact: '(11) 2' })).toEqual({
      contactPhone: '(11) 2',
    });
    expect(prefillContactFromClient({ contactPhone: '', contactEmail: '' }, { contact: 'ana@acme.com' })).toEqual({
      contactEmail: 'ana@acme.com',
    });
    expect(prefillContactFromClient({ contactPhone: '', contactEmail: '' }, undefined)).toEqual({});
    expect(prefillContactFromClient({ contactPhone: '', contactEmail: '' }, { contact: null })).toEqual({});
  });
});

describe('buildLeadWritePayload', () => {
  it('trims, nulls blanks and sends integer cents', () => {
    const payload = buildLeadWritePayload(
      emptyDraft({ contactName: '  Ana ', contactPhone: '', contactEmail: 'a@b.co', estimatedValue: '1500.50' }),
      DEFS,
      { includeSeller: false },
    );
    expect(payload.contactName).toBe('Ana');
    expect(payload.contactPhone).toBeNull();
    expect(payload.estimatedValueBrl).toBe(150050);
    expect(payload.clientId).toBeNull();
    expect(payload.clientName).toBeNull();
  });

  it('omits sellerPersonId when the picker is not offered and sends the key (null included) when it is', () => {
    const hidden = buildLeadWritePayload(emptyDraft(), DEFS, { includeSeller: false });
    expect('sellerPersonId' in hidden).toBe(false);
    const shown = buildLeadWritePayload(emptyDraft({ sellerPersonId: null }), DEFS, { includeSeller: true });
    expect(shown).toHaveProperty('sellerPersonId', null);
  });

  it('carries the id on edit and pipelineId only on create', () => {
    const create = buildLeadWritePayload(emptyDraft(), DEFS, { includeSeller: false, pipelineId: 'PIPE' });
    expect(create).toHaveProperty('pipelineId', 'PIPE');
    expect('id' in create).toBe(false);
    const edit = buildLeadWritePayload(emptyDraft(), DEFS, { id: 'L1', includeSeller: false, pipelineId: 'PIPE' });
    expect(edit).toHaveProperty('id', 'L1');
    expect('pipelineId' in edit).toBe(false);
  });

  it('sends only fields that have a value, plus the ones that had one before (so a clear is explicit)', () => {
    expect(buildLeadWritePayload(emptyDraft(), DEFS, { includeSeller: false }).fields).toEqual([]);
    const cleared = buildLeadWritePayload(emptyDraft(), DEFS, {
      id: 'L1',
      includeSeller: false,
      hadValue: new Set(['f-desc']),
    });
    expect(cleared.fields).toEqual([{ fieldId: 'f-desc', value: null }]);
  });

  it('encodes each kind', () => {
    const payload = buildLeadWritePayload(
      emptyDraft({
        fields: {
          'f-desc': '  texto  ',
          'f-qtd': '3',
          'f-orc': '12',
          'f-prazo': '2026-11-01',
          'f-origem': 'site',
          'f-prod': [
            { id: 'P1', name: 'Site' },
            { id: null, name: ' Item livre ' },
          ],
        },
      }),
      DEFS,
      { includeSeller: false },
    );
    expect(payload.fields).toEqual([
      { fieldId: 'f-desc', value: 'texto' },
      { fieldId: 'f-qtd', value: 3 },
      { fieldId: 'f-orc', value: 1200 },
      { fieldId: 'f-prazo', value: '2026-11-01' },
      { fieldId: 'f-origem', value: 'site' },
      {
        fieldId: 'f-prod',
        value: [
          { id: 'P1', name: 'Site' },
          { id: null, name: 'Item livre' },
        ],
      },
    ]);
  });

  it('never sends a cliente field entry, the empresa travels as clientId', () => {
    const payload = buildLeadWritePayload(emptyDraft({ clientId: 'c1', clientName: 'Acme' }), DEFS, { includeSeller: false });
    expect(payload.fields.some((f) => f.fieldId === 'f-cli')).toBe(false);
    expect(payload.clientId).toBe('c1');
  });
});

describe('leadToWriteSeed and the round trip', () => {
  it('a lead round-trips through draft and payload unchanged', () => {
    const lead = leadFixture({
      clientId: null,
      fields: [
        { fieldId: 'f-desc', key: 'descricao', value: 'Antes' },
        { fieldId: 'f-qtd', key: 'qtd', value: 3 },
        { fieldId: 'f-orc', key: 'orcamento', value: 150000 },
        { fieldId: 'f-prazo', key: 'prazo', value: '2026-11-01' },
        { fieldId: 'f-origem', key: 'origem', value: 'site' },
        { fieldId: 'f-prod', key: 'produtos', value: [{ id: 'P1', name: 'Site' }] },
      ],
    });
    const built = buildLeadWritePayload(leadFormDraftFromLead(lead, DEFS), DEFS, {
      id: lead.id,
      includeSeller: true,
      hadValue: fieldIdsWithValue(lead),
    });
    expect(sortFields(built)).toEqual(sortFields(leadToWriteSeed(lead)));
  });

  it('the round trip also holds with a cliente entry in fields, and the seed never sends it', () => {
    const built = buildLeadWritePayload(leadFormDraftFromLead(CLIENT_CONTACT_LEAD, DEFS), DEFS, {
      id: CLIENT_CONTACT_LEAD.id,
      includeSeller: true,
      hadValue: fieldIdsWithValue(CLIENT_CONTACT_LEAD),
    });
    const seed = leadToWriteSeed(CLIENT_CONTACT_LEAD);
    expect(seed.clientId).toBe('c1');
    expect(seed.fields.some((f) => f.fieldId === 'f-cli')).toBe(false);
    expect(sortFields(built)).toEqual(sortFields(seed));
  });

  it('leadToWriteSeed never sends a Cliente entry, even when the lead carries a null one', () => {
    const withNull = leadFixture({
      clientId: 'c1',
      clientNameSnapshot: 'Acme',
      fields: [{ fieldId: 'f-cli', key: 'cliente', value: null }],
    });
    const seed = leadToWriteSeed(withNull);
    expect(seed.clientId).toBe('c1');
    expect(seed.fields.some((f) => f.fieldId === 'f-cli')).toBe(false);
  });

  it('leadToWriteSeed appends an explicit null for every field the edit added', () => {
    const prev = leadFixture({ fields: [{ fieldId: 'f-desc', key: 'descricao', value: 'Antes' }] });
    expect(leadToWriteSeed(prev, ['f-qtd']).fields).toEqual([
      { fieldId: 'f-desc', value: 'Antes' },
      { fieldId: 'f-qtd', value: null },
    ]);
  });
});

describe('leadFormSaveErrorCopy', () => {
  it('names the missing etapa for 400 no_open_stage and falls back otherwise', () => {
    expect(leadFormSaveErrorCopy(Object.assign(new Error('x'), { status: 400, reason: 'no_open_stage' }))).toBe(
      LEAD_FORM_COPY.noStageError,
    );
    expect(leadFormSaveErrorCopy(new Error('boom'))).toBe(LEAD_FORM_COPY.saveFailed);
    expect(leadFormSaveErrorCopy(Object.assign(new Error('x'), { status: 500 }))).toBe(LEAD_FORM_COPY.saveFailed);
  });
});

function sortFields<T extends { fields: Array<{ fieldId: string }> }>(payload: T): T {
  return { ...payload, fields: [...payload.fields].sort((a, b) => a.fieldId.localeCompare(b.fieldId)) };
}
