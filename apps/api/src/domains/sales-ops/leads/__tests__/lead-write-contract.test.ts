/**
 * The ONE lead write contract (phase 2 cutover): `LeadWriteSchema` (create), `LeadPatchSchema`
 * (PATCH) and the import's `LeadWriteBaseSchema`. It replaces the two pre-cutover contracts
 * (`full` and `contact`); every rule the contact contract pinned is kept here.
 */
import { todayInSaoPaulo } from '@fxl-sales/shared-utils/sao-paulo-day';
import { describe, expect, it } from 'vitest';
import { LeadPatchSchema, LeadWriteBaseSchema, LeadWriteSchema } from '../lead-schemas.js';

const SOME_UUID = '11111111-1111-4111-8111-111111111111';
const withContact = { contactName: 'Ana', contactEmail: 'ana@example.com' };

describe('lead write contract', () => {
  it('accepts name plus one contact; estimatedValueBrl defaults to 0', () => {
    const result = LeadWriteSchema.parse({ contactName: '  Ana  ', contactPhone: ' 1199 ' });
    expect(result).toEqual({ contactName: 'Ana', contactPhone: '1199', estimatedValueBrl: 0 });
  });

  it('requires at least one of contactPhone and contactEmail on create', () => {
    for (const body of [
      { contactName: 'Ana' },
      { contactName: 'Ana', contactPhone: '', contactEmail: '   ' },
      { contactName: 'Ana', contactPhone: null, contactEmail: null },
    ]) {
      const parsed = LeadWriteSchema.safeParse(body);
      expect(parsed.success).toBe(false);
      if (!parsed.success) expect(parsed.error.issues[0]!.message).toBe('contactPhone or contactEmail is required');
    }
    expect(LeadWriteSchema.safeParse({ contactName: 'Ana', contactPhone: '1' }).success).toBe(true);
    expect(LeadWriteSchema.safeParse({ contactName: 'Ana', contactEmail: 'a@b.co' }).success).toBe(true);
    // The import writes through the base schema: a workbook row has no contact column.
    expect(LeadWriteBaseSchema.safeParse({ contactName: 'Ana' }).success).toBe(true);
  });

  it('accepts and normalizes every key, including empresa, valor, fields and the legacy keys', () => {
    const result = LeadWriteSchema.parse({
      contactName: 'Ana',
      contactPhone: ' (11) 98888-7777 ',
      contactEmail: ' Ana@Example.COM ',
      contactBirthDate: '1990-05-17',
      description: 'Gosta de WhatsApp',
      sellerPersonId: SOME_UUID,
      clientId: SOME_UUID,
      clientName: '  Empresa Um  ',
      estimatedValueBrl: 150000,
      pipelineId: SOME_UUID,
      stageId: SOME_UUID,
      products: [{ productName: 'Avulso' }],
      fields: [{ fieldId: SOME_UUID, value: [{ id: SOME_UUID, name: 'X' }] }, { key: 'x', value: null }],
    });
    expect(result.contactPhone).toBe('(11) 98888-7777');
    expect(result.contactEmail).toBe('ana@example.com');
    expect(result.clientName).toBe('Empresa Um');
    expect(result.fields).toHaveLength(2);
  });

  it('stores a blank optional as null', () => {
    expect(
      LeadWriteSchema.parse({
        ...withContact,
        contactPhone: '',
        contactBirthDate: '',
        description: '  ',
        sellerPersonId: '',
        clientId: '',
        clientName: ' ',
      }),
    ).toMatchObject({ contactPhone: null, contactBirthDate: null, description: null, sellerPersonId: null, clientId: null, clientName: null });
    expect(LeadPatchSchema.parse({ description: '', sellerPersonId: null })).toEqual({ description: null, sellerPersonId: null });
  });

  it('rejects an unknown key, and the move and terminal keys', () => {
    for (const extra of [{ saleId: SOME_UUID }, { lostReason: 'x' }, { position: 1 }, { orgId: 'o' }, { stageChangedAt: 'x' }]) {
      expect(LeadWriteSchema.safeParse({ ...withContact, ...extra }).success).toBe(false);
      expect(LeadPatchSchema.safeParse(extra).success).toBe(false);
    }
  });

  it('PATCH carries neither pipelineId nor stageId (a lead changes stage only by move or advance)', () => {
    expect(LeadPatchSchema.safeParse({ stageId: SOME_UUID }).success).toBe(false);
    expect(LeadPatchSchema.safeParse({ pipelineId: SOME_UUID }).success).toBe(false);
    expect(LeadPatchSchema.parse({})).toEqual({});
    expect(LeadPatchSchema.parse({ contactPhone: '' })).toEqual({ contactPhone: null });
  });

  it('rejects a bad e-mail, a long phone and an impossible or future birth day', () => {
    for (const contactEmail of ['not-an-email', 'a@', `${'a'.repeat(245)}@exemplo.com`]) {
      expect(LeadWriteSchema.safeParse({ contactName: 'Ana', contactEmail }).success).toBe(false);
    }
    expect(LeadWriteSchema.safeParse({ contactName: 'Ana', contactPhone: '9'.repeat(41) }).success).toBe(false);
    expect(LeadWriteSchema.safeParse({ contactName: 'Ana', contactPhone: '9'.repeat(40) }).success).toBe(true);
    for (const contactBirthDate of ['2026-02-30', '17/05/1990', '2999-01-01']) {
      expect(LeadWriteSchema.safeParse({ ...withContact, contactBirthDate }).success).toBe(false);
    }
    expect(LeadWriteSchema.safeParse({ ...withContact, contactBirthDate: todayInSaoPaulo() }).success).toBe(true);
  });

  it('requires contactName on create but not on update', () => {
    expect(LeadWriteSchema.safeParse({ contactEmail: 'a@b.co' }).success).toBe(false);
    expect(LeadPatchSchema.safeParse({}).success).toBe(true);
  });

  it('a fields entry needs fieldId or key, and a value of a known shape', () => {
    expect(LeadWriteSchema.safeParse({ ...withContact, fields: [{ value: 'x' }] }).success).toBe(false);
    expect(LeadWriteSchema.safeParse({ ...withContact, fields: [{ key: 'k', value: { a: 1 } }] }).success).toBe(false);
    expect(LeadWriteSchema.safeParse({ ...withContact, fields: [{ key: 'k', value: 12 }] }).success).toBe(true);
    expect(LeadWriteSchema.safeParse({ ...withContact, fields: [{ key: 'k', extra: 1, value: 1 }] }).success).toBe(false);
  });
});
