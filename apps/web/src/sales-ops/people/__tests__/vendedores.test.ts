import { describe, expect, it } from 'vitest';
import type { SalesOpsFuncao, SalesOpsPerson } from '../../types';
import { VENDEDORES_COPY, buildVendedorPayload, vendedorFuncaoId } from '../vendedores';

const orgId = '99999999-9999-4999-8999-999999999999';

const funcao = (patch: Partial<SalesOpsFuncao> = {}): SalesOpsFuncao => ({
  id: 'fc000001-0000-4000-8000-000000000001',
  orgId,
  name: 'Vendedor',
  slug: 'vendedor',
  isSystem: true,
  status: 'active',
  createdAt: '2026-07-29T12:00:00.000Z',
  updatedAt: null,
  ...patch,
});

const vendedor = funcao();
const finder = funcao({
  id: 'fc000002-0000-4000-8000-000000000002',
  name: 'Finder',
  slug: 'finder',
});
const designer = funcao({
  id: 'fc000009-0000-4000-8000-000000000009',
  name: 'Designer',
  slug: 'designer',
  isSystem: false,
});

const pessoa = (patch: Partial<SalesOpsPerson> = {}): SalesOpsPerson => ({
  id: '11111111-1111-4111-8111-111111111111',
  orgId,
  displayName: 'Ana Lima',
  contactEmail: 'ana@construbom.example',
  status: 'active',
  funcaoIds: [vendedor.id],
  funcoes: [{ id: vendedor.id, name: vendedor.name, slug: vendedor.slug, isSystem: true }],
  createdAt: '2026-07-01T00:00:00.000Z',
  updatedAt: null,
  ...patch,
});

/** Every string the copy object can produce, nested title and label functions included. */
function copyStrings(): string[] {
  const out: string[] = [];
  const visit = (value: unknown) => {
    if (typeof value === 'string') out.push(value);
    else if (typeof value === 'function') out.push(String((value as (name: string) => string)('X')));
    else if (value && typeof value === 'object') Object.values(value).forEach(visit);
  };
  visit(VENDEDORES_COPY);
  return out;
}

describe('buildVendedorPayload', () => {
  it("builds a new vendedor with the catalogue's vendedor id", () => {
    expect(
      buildVendedorPayload({
        person: null,
        displayName: '  Ana Lima  ',
        contactEmail: ' ana@construbom.example ',
        funcoes: [vendedor, finder, designer],
      }),
    ).toEqual({
      id: undefined,
      displayName: 'Ana Lima',
      contactEmail: 'ana@construbom.example',
      status: 'active',
      funcaoIds: [vendedor.id],
    });
  });

  it('sends no função id when the catalogue has no vendedor yet', () => {
    const base = { person: null, displayName: 'Ana Lima', contactEmail: '' };
    expect(buildVendedorPayload({ ...base, funcoes: [] }).funcaoIds).toEqual([]);
    expect(buildVendedorPayload({ ...base, funcoes: [finder, designer] }).funcaoIds).toEqual([]);
  });

  it('never picks a non-system função slugged vendedor', () => {
    expect(
      buildVendedorPayload({
        person: null,
        displayName: 'Ana Lima',
        contactEmail: '',
        funcoes: [{ ...designer, slug: 'vendedor', isSystem: false }],
      }).funcaoIds,
    ).toEqual([]);
  });

  it("keeps the edited pessoa's id and stored status", () => {
    const person = pessoa({ status: 'inactive' });
    const payload = buildVendedorPayload({
      person,
      displayName: 'Ana Lima',
      contactEmail: 'ana@construbom.example',
      funcoes: [vendedor],
    });
    expect(payload.id).toBe(person.id);
    expect(payload.status).toBe('inactive');
  });

  it('drops a blank e-mail', () => {
    expect(
      buildVendedorPayload({
        person: null,
        displayName: 'Ana Lima',
        contactEmail: '   ',
        funcoes: [vendedor],
      }).contactEmail,
    ).toBeUndefined();
  });
});

describe('VENDEDORES_COPY', () => {
  it('copy is pt-BR leads vocabulary only', () => {
    const strings = copyStrings();
    expect(strings.length).toBeGreaterThan(15);
    for (const text of strings) {
      expect(text).not.toMatch(/\u2014/);
      expect(text).not.toMatch(/fun[cç][aã]o|finder|comiss|proposta|Cadastros > Geral|hist[oó]rico/i);
    }
  });
});

describe('vendedorFuncaoId', () => {
  it('vendedorFuncaoId returns null for an empty catalogue and the id otherwise', () => {
    expect(vendedorFuncaoId([])).toBeNull();
    expect(vendedorFuncaoId([finder, vendedor])).toBe(vendedor.id);
  });
});
