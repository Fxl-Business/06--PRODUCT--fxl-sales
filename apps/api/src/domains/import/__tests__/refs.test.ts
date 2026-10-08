import { describe, expect, it } from 'vitest';
import { assignProductCodes, buildRefIndex, sameRef } from '../refs.js';
import { IDS, productEntry, richCatalog, seededCatalog, workbook } from './plan-fixtures.js';

describe('buildRefIndex', () => {
  it('resolves an existing active área by name ignoring case and accents', () => {
    const refs = buildRefIndex(workbook({}), richCatalog());
    expect(refs.resolve('area', '  TECNOLOGIA ')).toEqual({ ok: true, ref: { existingId: IDS.areaTec }, label: 'Tecnologia' });
    const accent = buildRefIndex(workbook({}), seededCatalog({ areas: [{ id: IDS.areaTec, name: 'Gestão', status: 'active' }] }));
    expect(accent.resolve('area', 'gestao')).toMatchObject({ ok: true, ref: { existingId: IDS.areaTec } });
  });

  it('resolves a workbook área to its planKey', () => {
    const refs = buildRefIndex(workbook({ areas: [{ nome: 'Marketing' }] }), seededCatalog());
    expect(refs.resolve('area', 'marketing')).toEqual({ ok: true, ref: { planKey: 'areas:2' }, label: 'Marketing' });
  });

  it('prefers the existing row over a colliding workbook row', () => {
    const refs = buildRefIndex(workbook({ areas: [{ nome: 'tecnologia' }] }), richCatalog());
    expect(refs.resolve('area', 'Tecnologia')).toMatchObject({ ok: true, ref: { existingId: IDS.areaTec } });
  });

  it('first workbook row wins for unique-name kinds', () => {
    const refs = buildRefIndex(workbook({ areas: [{ nome: 'Vendas' }, { nome: 'vendas' }] }), seededCatalog());
    expect(refs.resolve('area', 'Vendas')).toMatchObject({ ok: true, ref: { planKey: 'areas:2' } });
  });

  it('reports archived áreas, funções, produtos and etapas as archived_ref with a restore hint', () => {
    const refs = buildRefIndex(workbook({}), richCatalog());
    for (const [kind, name] of [['area', 'Área antiga'], ['funcao', 'Função antiga'], ['product', 'Produto antigo']] as const) {
      const r = refs.resolve(kind, name);
      expect(r).toMatchObject({ ok: false, code: 'archived_ref' });
      expect(r.ok ? '' : r.message).toContain('Histórico de arquivamentos');
    }
    const stage = refs.resolve('stage', 'Etapa antiga');
    expect(stage).toMatchObject({ ok: false, code: 'archived_ref' });
    expect(stage.ok ? '' : stage.message).toContain('Cadastros > Etapas');
  });

  it('reports an inactive pessoa as archived_ref saying inativa', () => {
    const r = buildRefIndex(workbook({}), richCatalog()).resolve('person', 'Beto Inativo');
    expect(r).toMatchObject({ ok: false, code: 'archived_ref' });
    expect(r.ok ? '' : r.message).toContain('inativa');
  });

  it('reports unknown names with the tab to fix', () => {
    expect(buildRefIndex(workbook({}), richCatalog()).resolve('client', 'Nada')).toEqual({
      ok: false,
      code: 'unknown_ref',
      message: 'Não encontramos o cliente "Nada" no cadastro nem na aba Clientes.',
    });
  });

  it('makes repeated pessoa and cliente names ambiguous', () => {
    const refs = buildRefIndex(
      workbook({
        pessoas: [{ nome: 'ana souza', funcoes: ['Vendedor'] }],
        clientes: [{ nome: 'Loja' }, { nome: 'loja' }],
      }),
      richCatalog(),
    );
    expect(refs.resolve('person', 'Ana Souza')).toMatchObject({ ok: false, code: 'ambiguous_ref' });
    expect(refs.resolve('client', 'Loja')).toMatchObject({ ok: false, code: 'ambiguous_ref' });
  });

  it('resolves a recognized Clientes row to the existing cliente under the sheet name and the stored name', () => {
    const refs = buildRefIndex(workbook({ clientes: [{ nome: 'Padaria PQ', documento: '12345678000190' }] }), richCatalog());
    const padaria = { ok: true, ref: { existingId: IDS.clientPadaria }, label: 'Padaria Pão Quente' };
    expect(refs.resolve('client', 'padaria pq')).toEqual(padaria);
    expect(refs.resolve('client', 'Padaria Pão Quente')).toEqual(padaria);
  });

  it('never makes a recognized row ambiguous with its own existing cliente', () => {
    const refs = buildRefIndex(workbook({ clientes: [{ nome: 'padaria pão quente', documento: null }] }), richCatalog());
    expect(refs.resolve('client', 'Padaria Pão Quente')).toEqual({
      ok: true,
      ref: { existingId: IDS.clientPadaria },
      label: 'Padaria Pão Quente',
    });
  });

  it('keeps an unrecognized same-name row ambiguous', () => {
    const refs = buildRefIndex(
      workbook({ clientes: [{ nome: 'Padaria Pão Quente', documento: '99.999.999/0001-99' }] }),
      richCatalog(),
    );
    expect(refs.resolve('client', 'Padaria Pão Quente')).toMatchObject({ ok: false, code: 'ambiguous_ref' });
  });

  it('exposes the one recognition through recognizedClient', () => {
    const refs = buildRefIndex(
      workbook({ clientes: [{ nome: 'Padaria PQ', documento: '12345678000190' }, { nome: 'Mercado Novo' }] }),
      richCatalog(),
    );
    expect(refs.recognizedClient(2)).toEqual({ existingId: IDS.clientPadaria, name: 'Padaria Pão Quente' });
    expect(refs.recognizedClient(3)).toBeNull();
    expect(refs.recognizedClient(99)).toBeNull();
    expect(refs.resolve('client', 'Mercado Novo')).toMatchObject({ ok: true, ref: { planKey: 'clientes:3' } });
  });

  it('lets a workbook produto win over an archived produto with the same name', () => {
    const refs = buildRefIndex(workbook({ produtos: [{ nome: 'Produto antigo', area: 'Tecnologia' }] }), richCatalog());
    expect(refs.resolve('product', 'Produto antigo')).toMatchObject({ ok: true, ref: { planKey: 'produtos:2' } });
  });

  it('resolves produtos by code', () => {
    const refs = buildRefIndex(
      workbook({
        produtos: [
          { nome: 'Novo A', area: 'Tecnologia', codigo: 12 },
          { nome: 'Novo B', area: 'Tecnologia', codigo: null },
        ],
      }),
      richCatalog(),
    );
    expect(refs.resolve('product', '#3')).toMatchObject({ ok: true, ref: { existingId: IDS.productSistema } });
    expect(refs.resolve('product', '# 3')).toMatchObject({ ok: true, ref: { existingId: IDS.productSistema } });
    expect(refs.resolve('product', '#7')).toMatchObject({ ok: false, code: 'archived_ref' });
    expect(refs.resolve('product', '#42')).toEqual({ ok: false, code: 'unknown_ref', message: 'Não encontramos o produto com código #42.' });
    expect(refs.resolve('product', '#12')).toMatchObject({ ok: true, ref: { planKey: 'produtos:2' } });
    // max suffix is 12 after the explicit row, so the blank row takes 13
    expect(refs.resolve('product', '#13')).toMatchObject({ ok: true, ref: { planKey: 'produtos:3' } });
  });

  it('resolves a blank código to the next free one after the existing max', () => {
    const refs = buildRefIndex(workbook({ produtos: [{ nome: 'Novo', area: 'Tecnologia' }] }), richCatalog());
    expect(refs.resolve('product', '#8')).toMatchObject({ ok: true, ref: { planKey: 'produtos:2' } });
  });

  it('answers vendedor membership for existing and workbook people', () => {
    const refs = buildRefIndex(
      workbook({
        funcoes: [{ nome: 'Desenvolvedor' }],
        pessoas: [{ nome: 'Bia', funcoes: ['Vendedor', 'Desenvolvedor'] }],
      }),
      seededCatalog({ people: richCatalog().people }),
    );
    const ana = { existingId: IDS.personAna };
    expect(refs.personHasFuncaoSlug(ana, 'vendedor')).toBe(true);
    expect(refs.personHasFuncaoSlug(ana, 'finder')).toBe(false);
    const bia = { planKey: 'pessoas:2' };
    expect(refs.personHasFuncaoSlug(bia, 'vendedor')).toBe(true);
    expect(refs.personHasFuncaoSlug(bia, 'desenvolvedor')).toBe(true);
    expect(refs.personHasFuncaoSlug(bia, 'finder')).toBe(false);
    expect(refs.personHasFuncao(bia, { planKey: 'funcoes:2' })).toBe(true);
    expect(refs.personHasFuncao(bia, { existingId: IDS.funcaoVendedor })).toBe(true);
    expect(refs.personHasFuncao(ana, { existingId: IDS.funcaoVendedor })).toBe(true);
    expect(refs.personHasFuncao(ana, { existingId: IDS.funcaoFinder })).toBe(false);
  });

  it('resolvePersonWithFuncao names the missing função and where to fix it', () => {
    const catalog = richCatalog();
    catalog.people.push({ id: IDS.personInactive.replace('d2', 'd3'), displayName: 'Caio', contactEmail: null, status: 'active', funcaoSlugs: [], funcaoIds: [] });
    const refs = buildRefIndex(workbook({ pessoas: [{ nome: 'Duda', funcoes: ['Desenvolvedor'] }] }), catalog);
    const existing = refs.resolvePersonWithFuncao('Caio', 'vendedor');
    expect(existing).toMatchObject({ ok: false, code: 'missing_funcao' });
    expect(existing.ok ? '' : existing.message).toContain('Cadastros > Pessoas');
    const wb = refs.resolvePersonWithFuncao('Duda', 'finder');
    expect(wb.ok ? '' : wb.message).toContain('coluna Funções');
    expect(refs.resolvePersonWithFuncao('Ana Souza', 'vendedor')).toMatchObject({ ok: true });
    expect(refs.resolvePersonWithFuncao('Ninguem', 'vendedor')).toMatchObject({ ok: false, code: 'unknown_ref' });
  });

  it('funcaoIsSystem is true only for existing system funções', () => {
    const refs = buildRefIndex(workbook({ funcoes: [{ nome: 'Extra' }] }), richCatalog());
    expect(refs.funcaoIsSystem({ existingId: IDS.funcaoVendedor })).toBe(true);
    expect(refs.funcaoIsSystem({ existingId: IDS.funcaoDev })).toBe(false);
    expect(refs.funcaoIsSystem({ planKey: 'funcoes:2' })).toBe(false);
  });

  it('sameRef compares kind and value', () => {
    expect(sameRef({ existingId: 'a' }, { existingId: 'a' })).toBe(true);
    expect(sameRef({ existingId: 'a' }, { planKey: 'a' })).toBe(false);
  });
});

describe('assignProductCodes', () => {
  const rows = (...codes: Array<number | null>) =>
    workbook({ produtos: codes.map((codigo, i) => ({ nome: `P${i}`, area: 'A', codigo })) });

  it('mirrors nextProductCodeSuffix', () => {
    const catalog = seededCatalog({
      products: [
        productEntry({ id: '1', name: 'Tres', codeSuffix: '3' }),
        productEntry({ id: '2', name: 'Sete', codeSuffix: '07', status: 'archived' }),
      ],
    });
    const result = assignProductCodes(rows(5, null, null), catalog);
    expect([2, 3, 4].map((r) => result.get(r))).toEqual([
      { ok: true, code: 5, explicit: true },
      { ok: true, code: 8, explicit: false },
      { ok: true, code: 9, explicit: false },
    ]);
  });

  it('reports duplicate explicit codes against existing and workbook rows', () => {
    const catalog = seededCatalog({ products: [productEntry({ id: '1', name: 'Tres', codeSuffix: '3' })] });
    const existing = assignProductCodes(rows(3), catalog).get(2);
    expect(existing).toMatchObject({ ok: false, code: 'duplicate_code' });
    expect(existing && !existing.ok ? existing.message : '').toContain('"Tres"');
    const twice = assignProductCodes(rows(5, 5), catalog);
    expect(twice.get(2)).toMatchObject({ ok: true, code: 5 });
    expect(twice.get(3)).toMatchObject({ ok: false, code: 'duplicate_code' });
  });

  it('wraps to the lowest free code past 99, and reports no_free_code when full', () => {
    const at99 = seededCatalog({ products: [productEntry({ id: '1', name: 'Max', codeSuffix: '99' })] });
    expect(assignProductCodes(rows(null), at99).get(2)).toEqual({ ok: true, code: 0, explicit: false });
    const full = seededCatalog({
      products: Array.from({ length: 100 }, (_, i) => productEntry({ id: `p${i}`, name: `P${i}`, codeSuffix: String(i) })),
    });
    expect(assignProductCodes(rows(null), full).get(2)).toMatchObject({ ok: false, code: 'no_free_code' });
  });

  it('starts a fresh org at 0', () => {
    expect(assignProductCodes(rows(null), seededCatalog()).get(2)).toEqual({ ok: true, code: 0, explicit: false });
  });
});
