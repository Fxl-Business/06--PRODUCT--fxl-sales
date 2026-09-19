import { describe, expect, it } from 'vitest';
import { buildLeadConversionPrefill, findClientByName } from '../conversion';
import type { SalesOpsLead } from '../types';
import type {
  SalesOpsClient,
  SalesOpsPerson,
  SalesOpsPersonFuncao,
  SalesOpsProduct,
} from '../../types';

/**
 * The PURE half of the conversion. No DOM, no fetch, no React: every rule here
 * is a decision about what a lead means when it becomes a proposta, and each one
 * is a decision somebody could plausibly undo by "simplifying" the module.
 *
 * Money crosses this boundary as integer CENTS in both directions, because
 * `centsToInput` is module-private to `SalesOpsApp.tsx` and reaching in for a
 * formatting detail would widen that file's public surface.
 */

const CLIENT_IPE = 'cccccccc-0000-4000-8000-000000000001';
const CLIENT_OTHER = 'cccccccc-0000-4000-8000-000000000002';
const PERSON_MARINA = 'pppppppp-0000-4000-8000-000000000001';
const PERSON_INACTIVE = 'pppppppp-0000-4000-8000-000000000002';
const PERSON_NO_FUNCAO = 'pppppppp-0000-4000-8000-000000000003';
const PRODUCT_CUSTOM = 'dddddddd-0000-4000-8000-000000000001';
const PRODUCT_SERVICE = 'dddddddd-0000-4000-8000-000000000002';
const STAGE_NOVO = 'aaaaaaaa-0000-4000-8000-000000000001';

const VENDEDOR_FUNCAO: SalesOpsPersonFuncao = {
  id: 'ffffffff-0000-4000-8000-000000000001',
  name: 'Vendedor',
  slug: 'vendedor',
  isSystem: true,
};

const DESIGNER_FUNCAO: SalesOpsPersonFuncao = {
  id: 'ffffffff-0000-4000-8000-000000000002',
  name: 'Designer',
  slug: 'designer',
  isSystem: false,
};

function client(id: string, name: string): SalesOpsClient {
  return {
    id,
    orgId: 'org-test',
    name,
    contact: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: null,
  };
}

function person(
  id: string,
  displayName: string,
  patch: Partial<SalesOpsPerson> = {},
): SalesOpsPerson {
  return {
    id,
    orgId: 'org-test',
    displayName,
    contactEmail: null,
    status: 'active',
    funcaoIds: [VENDEDOR_FUNCAO.id],
    funcoes: [VENDEDOR_FUNCAO],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: null,
    ...patch,
  };
}

function product(
  id: string,
  name: string,
  patch: Partial<SalesOpsProduct> = {},
): SalesOpsProduct {
  return {
    id,
    orgId: 'org-test',
    name,
    kind: 'product',
    codeSuffix: '01',
    areaId: 'eeeeeeee-0000-4000-8000-000000000001',
    openPrice: false,
    setupBrl: 2_000_000,
    hasMonthly: false,
    monthlyBrl: 0,
    recurringCommission: false,
    hasFinderCommission: false,
    sellerCommissionType: 'pct',
    sellerCommissionValue: 5,
    sellerWithFinderCommissionType: 'pct',
    sellerWithFinderCommissionValue: 3,
    finderCommissionType: 'pct',
    finderCommissionValue: 2,
    modules: [],
    providers: [],
    status: 'active',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: null,
    ...patch,
  } as SalesOpsProduct;
}

function lead(patch: Partial<SalesOpsLead> = {}): SalesOpsLead {
  return {
    id: 'bbbbbbbb-0000-4000-8000-00000000000a',
    stageId: STAGE_NOVO,
    position: 1,
    contactName: 'Ana Souza',
    clientId: CLIENT_IPE,
    clientNameSnapshot: 'Construtora Ipê',
    estimatedValueBrl: 0,
    description: null,
    sellerPersonId: PERSON_MARINA,
    sellerNameSnapshot: 'Marina',
    lostReason: null,
    stageChangedAt: '2026-09-15T12:00:00.000Z',
    saleId: null,
    saleStatus: null,
    products: [],
    createdAt: '2026-09-01T12:00:00.000Z',
    updatedAt: null,
    ...patch,
  };
}

const SNAPSHOT = {
  clients: [client(CLIENT_IPE, 'Construtora Ipê'), client(CLIENT_OTHER, 'Outra Empresa')],
  people: [
    person(PERSON_MARINA, 'Marina Lopes'),
    person(PERSON_INACTIVE, 'Inativo Silva', { status: 'inactive' }),
    person(PERSON_NO_FUNCAO, 'Sem Função', {
      funcaoIds: [DESIGNER_FUNCAO.id],
      funcoes: [DESIGNER_FUNCAO],
    }),
  ],
  products: [
    product(PRODUCT_CUSTOM, 'FXL Custom'),
    product(PRODUCT_SERVICE, 'Consultoria', {
      kind: 'service',
      openPrice: true,
      setupBrl: 0,
      monthlyBrl: 0,
    }),
  ],
};

describe('buildLeadConversionPrefill', () => {
  it('seeds empresa, vendedor, descrição and produtos from the lead', () => {
    const prefill = buildLeadConversionPrefill(
      lead({
        description: '  duas frentes, entrega em março  ',
        products: [{ productId: PRODUCT_CUSTOM, productNameSnapshot: 'FXL Custom' }],
      }),
      SNAPSHOT,
    );

    expect(prefill.leadId).toBe('bbbbbbbb-0000-4000-8000-00000000000a');
    expect(prefill.clientId).toBe(CLIENT_IPE);
    expect(prefill.clientName).toBe('Construtora Ipê');
    expect(prefill.sellerPersonId).toBe(PERSON_MARINA);
    // Verbatim, whitespace included: `notes` is free text and trimming it would
    // silently edit the operator's own words.
    expect(prefill.notes).toBe('  duas frentes, entrega em março  ');
    expect(prefill.items).toEqual([
      { kind: 'product', productId: PRODUCT_CUSTOM, unitCents: 2_000_000 },
    ]);
  });

  it('leaves the vendedor blank when the pessoa is inactive or does not carry the vendedor função', () => {
    // The exact misattribution bug: seeding whoever sorts first would attribute a
    // real proposta, and every commission derived from it, to the wrong person.
    expect(
      buildLeadConversionPrefill(lead({ sellerPersonId: PERSON_INACTIVE }), SNAPSHOT)
        .sellerPersonId,
    ).toBe('');
    expect(
      buildLeadConversionPrefill(lead({ sellerPersonId: PERSON_NO_FUNCAO }), SNAPSHOT)
        .sellerPersonId,
    ).toBe('');
    expect(
      buildLeadConversionPrefill(lead({ sellerPersonId: null }), SNAPSHOT).sellerPersonId,
    ).toBe('');
    expect(
      buildLeadConversionPrefill(
        lead({ sellerPersonId: 'pppppppp-0000-4000-8000-0000000000ff' }),
        SNAPSHOT,
      ).sellerPersonId,
    ).toBe('');
  });

  it('downgrades a produto id that resolves to nothing into a free-text row', () => {
    const prefill = buildLeadConversionPrefill(
      lead({
        products: [
          { productId: 'dddddddd-0000-4000-8000-0000000000ff', productNameSnapshot: 'Legado' },
          { productId: null, productNameSnapshot: 'Consultoria avulsa' },
        ],
      }),
      SNAPSHOT,
    );

    expect(prefill.items).toEqual([
      { kind: 'free', customLabel: 'Legado', unitCents: 0 },
      { kind: 'free', customLabel: 'Consultoria avulsa', unitCents: 0 },
    ]);
  });

  it('writes the estimated value only when no produto supplies a price', () => {
    // Free text only: the estimate is the only number anyone has, so it beats 0.
    const freeOnly = buildLeadConversionPrefill(
      lead({
        estimatedValueBrl: 250_000,
        products: [{ productId: null, productNameSnapshot: 'Consultoria avulsa' }],
      }),
      SNAPSHOT,
    );
    expect(freeOnly.items).toEqual([
      { kind: 'free', customLabel: 'Consultoria avulsa', unitCents: 250_000 },
    ]);

    // A Serviço with no base value is the same case, reached through a produto.
    const servicoOnly = buildLeadConversionPrefill(
      lead({
        estimatedValueBrl: 250_000,
        products: [{ productId: PRODUCT_SERVICE, productNameSnapshot: 'Consultoria' }],
      }),
      SNAPSHOT,
    );
    expect(servicoOnly.items).toEqual([
      { kind: 'product', productId: PRODUCT_SERVICE, unitCents: 250_000 },
    ]);

    // The catalog speaks: the estimate is written NOWHERE. Overwriting a per-item
    // price with one lump sum would destroy the catalog numbers to make a total
    // agree, and the operator can always retype.
    const catalogSpeaks = buildLeadConversionPrefill(
      lead({
        estimatedValueBrl: 250_000,
        products: [
          { productId: PRODUCT_CUSTOM, productNameSnapshot: 'FXL Custom' },
          { productId: null, productNameSnapshot: 'Consultoria avulsa' },
        ],
      }),
      SNAPSHOT,
    );
    expect(catalogSpeaks.items).toEqual([
      { kind: 'product', productId: PRODUCT_CUSTOM, unitCents: 2_000_000 },
      { kind: 'free', customLabel: 'Consultoria avulsa', unitCents: 0 },
    ]);

    // And a zero estimate is never written either.
    const noEstimate = buildLeadConversionPrefill(
      lead({
        estimatedValueBrl: 0,
        products: [{ productId: null, productNameSnapshot: 'Consultoria avulsa' }],
      }),
      SNAPSHOT,
    );
    expect(noEstimate.items).toEqual([
      { kind: 'free', customLabel: 'Consultoria avulsa', unitCents: 0 },
    ]);
  });

  it('returns no items for a lead with no produtos, so the wizard keeps its own seed', () => {
    const prefill = buildLeadConversionPrefill(
      lead({ products: [], estimatedValueBrl: 250_000 }),
      SNAPSHOT,
    );

    // Returning one empty row instead would put an unsaveable row on screen AND
    // hide the wizard's own `firstProduct` create-path seed.
    expect(prefill.items).toEqual([]);
  });

  it('keeps the clientId when the lead names a cliente the snapshot does not carry, and falls back to its name snapshot', () => {
    const prefill = buildLeadConversionPrefill(
      lead({
        clientId: 'cccccccc-0000-4000-8000-0000000000ff',
        clientNameSnapshot: 'Empresa Fora do Snapshot',
      }),
      SNAPSHOT,
    );

    // Losing the id silently un-links a real cliente; losing the name renders a
    // blank picker trigger. Both halves are required.
    expect(prefill.clientId).toBe('cccccccc-0000-4000-8000-0000000000ff');
    expect(prefill.clientName).toBe('Empresa Fora do Snapshot');
  });

  it('carries no clientId at all when the lead has none, keeping the name snapshot', () => {
    const prefill = buildLeadConversionPrefill(
      lead({ clientId: null, clientNameSnapshot: 'Nova Empresa' }),
      SNAPSHOT,
    );

    expect(prefill.clientId).toBe('');
    expect(prefill.clientName).toBe('Nova Empresa');
  });
});

describe('findClientByName', () => {
  it('matches an existing cliente across case, accents and surrounding whitespace', () => {
    expect(findClientByName(SNAPSHOT.clients, '  construtora ipe  ')).toBe(CLIENT_IPE);
    expect(findClientByName(SNAPSHOT.clients, 'CONSTRUTORA IPÊ')).toBe(CLIENT_IPE);
    expect(findClientByName(SNAPSHOT.clients, 'Construtora   Ipê')).toBe(CLIENT_IPE);
  });

  it('answers null for a name that matches nothing and for a blank name', () => {
    expect(findClientByName(SNAPSHOT.clients, 'Empresa Inexistente')).toBeNull();
    expect(findClientByName(SNAPSHOT.clients, '   ')).toBeNull();
    expect(findClientByName([], 'Construtora Ipê')).toBeNull();
  });
});
