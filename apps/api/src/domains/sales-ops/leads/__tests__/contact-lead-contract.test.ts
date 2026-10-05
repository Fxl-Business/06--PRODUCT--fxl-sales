/**
 * The leads-edition wire contract (edicao-leads, SEAM-CONTRACT section 2 and
 * amendment A2), plus the FXL oracle that the full schemas never learned the
 * three contact keys.
 */
import { todayInSaoPaulo } from '@fxl-sales/shared-utils/sao-paulo-day';
import { describe, expect, it } from 'vitest';
import {
  ContactLeadFieldsSchema,
  CreateContactLeadSchema,
  CreateLeadSchema,
  UpdateContactLeadSchema,
  UpdateLeadSchema,
} from '../lead-schemas.js';

const SOME_UUID = '11111111-1111-4111-8111-111111111111';

describe('contact lead wire contract (leads edition)', () => {
  it('accepts a contact lead with only contactName', () => {
    const result = CreateContactLeadSchema.parse({ contactName: '  Ana  ' });
    expect(result).toEqual({ contactName: 'Ana' });
    expect(Object.keys(result)).toEqual(['contactName']);
  });

  it('accepts and normalizes every contact field', () => {
    const result = CreateContactLeadSchema.parse({
      contactName: 'Ana',
      contactPhone: ' (11) 98888-7777 ',
      contactEmail: ' Ana@Example.COM ',
      contactBirthDate: '1990-05-17',
      description: 'Gosta de WhatsApp',
      sellerPersonId: SOME_UUID,
    });
    expect(result).toEqual({
      contactName: 'Ana',
      contactPhone: '(11) 98888-7777',
      contactEmail: 'ana@example.com',
      contactBirthDate: '1990-05-17',
      description: 'Gosta de WhatsApp',
      sellerPersonId: SOME_UUID,
    });
  });

  it('stores a blank optional as null', () => {
    const cleared = {
      contactPhone: null,
      contactEmail: null,
      contactBirthDate: null,
      description: null,
      sellerPersonId: null,
    };
    expect(
      CreateContactLeadSchema.parse({
        contactName: 'Ana',
        contactPhone: '',
        contactEmail: '   ',
        contactBirthDate: '',
        description: '  ',
        sellerPersonId: '',
      }),
    ).toEqual({ contactName: 'Ana', ...cleared });
    expect(CreateContactLeadSchema.parse({ contactName: 'Ana', ...cleared })).toEqual({
      contactName: 'Ana',
      ...cleared,
    });
    expect(UpdateContactLeadSchema.parse({ description: '', sellerPersonId: null })).toEqual({
      description: null,
      sellerPersonId: null,
    });
  });

  it('rejects every full-edition key', () => {
    const extras: Array<Record<string, unknown>> = [
      { clientName: 'Empresa' },
      { clientId: SOME_UUID },
      { estimatedValueBrl: 100 },
      { products: [] },
      { stageId: SOME_UUID },
      { saleId: SOME_UUID },
      { lostReason: 'x' },
    ];
    for (const extra of extras) {
      expect(CreateContactLeadSchema.safeParse({ contactName: 'Ana', ...extra }).success).toBe(
        false,
      );
      expect(UpdateContactLeadSchema.safeParse(extra).success).toBe(false);
    }
  });

  it('rejects a bad e-mail', () => {
    for (const contactEmail of ['not-an-email', 'a@', `${'a'.repeat(245)}@exemplo.com`]) {
      expect(CreateContactLeadSchema.safeParse({ contactName: 'Ana', contactEmail }).success).toBe(
        false,
      );
    }
  });

  it('rejects an impossible or future birth day', () => {
    for (const contactBirthDate of ['2026-02-30', '17/05/1990', '2999-01-01']) {
      expect(
        CreateContactLeadSchema.safeParse({ contactName: 'Ana', contactBirthDate }).success,
      ).toBe(false);
    }
    expect(
      CreateContactLeadSchema.safeParse({ contactName: 'Ana', contactBirthDate: todayInSaoPaulo() })
        .success,
    ).toBe(true);
  });

  it('rejects a phone over 40 characters', () => {
    expect(
      CreateContactLeadSchema.safeParse({ contactName: 'Ana', contactPhone: '9'.repeat(41) })
        .success,
    ).toBe(false);
    expect(
      CreateContactLeadSchema.safeParse({ contactName: 'Ana', contactPhone: '9'.repeat(40) })
        .success,
    ).toBe(true);
  });

  it('requires contactName on create but not on update', () => {
    expect(CreateContactLeadSchema.safeParse({}).success).toBe(false);
    expect(UpdateContactLeadSchema.parse({})).toEqual({});
    expect(UpdateContactLeadSchema.parse({ contactPhone: '' })).toEqual({ contactPhone: null });
  });

  it('FXL oracle: the full schemas still refuse the contact keys', () => {
    for (const key of ['contactPhone', 'contactEmail', 'contactBirthDate']) {
      expect(
        CreateLeadSchema.safeParse({ contactName: 'Ana', clientName: 'Empresa Um', [key]: 'x' })
          .success,
      ).toBe(false);
      expect(UpdateLeadSchema.safeParse({ [key]: 'x' }).success).toBe(false);
    }
    expect(Object.keys(CreateLeadSchema.shape).sort()).toEqual([
      'clientId',
      'clientName',
      'contactName',
      'description',
      'estimatedValueBrl',
      'products',
      'sellerPersonId',
    ]);
  });

  it('ContactLeadFieldsSchema keys are exactly the seam list', () => {
    expect(Object.keys(ContactLeadFieldsSchema.shape).sort()).toEqual([
      'contactBirthDate',
      'contactEmail',
      'contactName',
      'contactPhone',
      'description',
      'sellerPersonId',
    ]);
  });
});
