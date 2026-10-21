import { describe, expect, it } from 'vitest';
import type { AppRole } from '@/auth/claims';
import {
  ALL_MODULES_ENABLED,
  CRM_MODULE_KEYS,
  isCrmModuleKey,
  modulesForEdition,
  type OrgModules,
} from '@fxl-sales/shared-utils/crm-model';
import {
  buildSalesOpsPath,
  canSettleInWorkspace,
  getSalesOpsNavigation,
  getSalesOpsWorkspaces,
  getVisibleWorkspaces,
  NAVIGATION_CATALOGUE,
  resolveSalesOpsRoute,
  salesOpsWorkspaces,
  type SalesOpsView,
} from '../navigation';

/*
  The module API. Every expected value is a hand-written literal: never derive one by
  calling navigation.ts, a derived table moves with the bug.
*/
const OFF = (key: keyof OrgModules): OrgModules => ({ ...ALL_MODULES_ENABLED, [key]: false });
const NONE_ON: OrgModules = Object.fromEntries(
  CRM_MODULE_KEYS.map((key) => [key, false]),
) as OrgModules;
const LEADS: OrgModules = modulesForEdition('leads');

const ids = (items: { id: SalesOpsView }[]) => items.map((item) => item.id);

describe('every module off hides exactly the entries that require it', () => {
  it('comissoes hides the commissions entries only', () => {
    const off = OFF('comissoes');
    expect(ids(getSalesOpsNavigation('operacional', ['admin'], off))).toEqual([
      'vendas', 'vendas-abertas', 'vendas-ganhas', 'vendas-encerradas', 'leads', 'funil', 'follow-ups',
    ]);
    expect(ids(getSalesOpsNavigation('meus-dados', ['seller'], off))).toEqual([
      'vendedores', 'leads', 'funil', 'follow-ups',
    ]);
  });

  it('catalogo hides Produtos, Áreas and Funções', () => {
    expect(ids(getSalesOpsNavigation('cadastros', ['admin'], OFF('catalogo')))).toEqual([
      'clientes', 'pessoas', 'etapas', 'importacao', 'leads-excluidos', 'geral',
    ]);
  });

  it('clientes hides Clientes', () => {
    expect(ids(getSalesOpsNavigation('cadastros', ['admin'], OFF('clientes')))).toEqual([
      'produtos', 'areas', 'pessoas', 'funcoes', 'etapas', 'importacao', 'leads-excluidos', 'geral',
    ]);
  });

  it('importacao hides Importação', () => {
    expect(ids(getSalesOpsNavigation('cadastros', ['admin'], OFF('importacao')))).toEqual([
      'produtos', 'areas', 'clientes', 'pessoas', 'funcoes', 'etapas', 'leads-excluidos', 'geral',
    ]);
  });

  it('financeiro hides Geral', () => {
    expect(ids(getSalesOpsNavigation('cadastros', ['admin'], OFF('financeiro')))).toEqual([
      'produtos', 'areas', 'clientes', 'pessoas', 'funcoes', 'etapas', 'importacao', 'leads-excluidos',
    ]);
  });

  it('finders hides the finder Meu painel and Indicações', () => {
    expect(ids(getSalesOpsNavigation('meus-dados', ['seller', 'finder'] as AppRole[], OFF('finders')))).toEqual([
      'vendedores', 'comissoes', 'leads', 'funil', 'follow-ups',
    ]);
  });

  it('orcamentos hides the dashboard, the Propostas submenu and the seller Meu painel', () => {
    const off = OFF('orcamentos');
    expect(getSalesOpsNavigation('tatico', ['admin'], off)).toEqual([]);
    expect(ids(getSalesOpsNavigation('operacional', ['admin'], off))).toEqual([
      'comissoes', 'leads', 'funil', 'follow-ups',
    ]);
    expect(ids(getSalesOpsNavigation('meus-dados', ['seller'], off))).toEqual([
      'comissoes', 'leads', 'funil', 'follow-ups',
    ]);
  });
});

describe('the compact profile (orcamentos off)', () => {
  it('keeps the full order and shows the compact labels when every other module is on', () => {
    const off = OFF('orcamentos');
    expect(ids(getSalesOpsNavigation('cadastros', ['admin'], off))).toEqual([
      'pessoas', 'produtos', 'areas', 'clientes', 'funcoes', 'etapas', 'importacao', 'leads-excluidos', 'geral',
    ]);
    expect(getSalesOpsNavigation('cadastros', ['admin'], off)[0]?.label).toBe('Vendedores');
    expect(getSalesOpsNavigation('meus-dados', ['seller'], off).map((item) => item.label)).toEqual([
      'Comissões',
      'Prospecção',
      'Funil',
      'Meus follow-ups',
    ]);
    expect(getVisibleWorkspaces(['admin', 'seller', 'finder'], off)).toEqual(['operacional', 'cadastros']);
  });

  it('the leads module set plus comissoes shows Comissões first in operacional', () => {
    expect(ids(getSalesOpsNavigation('operacional', ['admin'], { ...LEADS, comissoes: true }))).toEqual([
      'comissoes', 'leads', 'funil', 'follow-ups',
    ]);
  });

  it('the leads module set plus catalogo adds Produtos, Áreas and Funções after Pessoas', () => {
    expect(ids(getSalesOpsNavigation('cadastros', ['admin'], { ...LEADS, catalogo: true }))).toEqual([
      'pessoas', 'produtos', 'areas', 'clientes', 'funcoes', 'etapas', 'importacao', 'leads-excluidos',
    ]);
  });

  it('the leads module set with orcamentos on shows the Propostas submenu as the full order', () => {
    expect(ids(getSalesOpsNavigation('operacional', ['admin'], { ...LEADS, orcamentos: true }))).toEqual([
      'vendas', 'vendas-abertas', 'vendas-ganhas', 'vendas-encerradas', 'leads', 'funil', 'follow-ups',
    ]);
  });

  it('the leads module set hides the three Propostas list routes together', () => {
    expect(ids(getSalesOpsNavigation('operacional', ['admin'], LEADS))).not.toContain('vendas-abertas');
    expect(ids(getSalesOpsNavigation('operacional', ['admin'], LEADS))).not.toContain('vendas-ganhas');
    expect(ids(getSalesOpsNavigation('operacional', ['admin'], LEADS))).not.toContain('vendas-encerradas');
  });
});

describe('redirects and settlement follow the modules', () => {
  it('a hidden view redirects to the role default, never renders', () => {
    expect(resolveSalesOpsRoute({ workspace: 'cadastros', view: 'produtos' }, ['admin'], OFF('catalogo'))).toEqual({
      route: { workspace: 'tatico', view: 'dashboard' },
      path: '/tatico/dashboard',
      redirect: true,
    });
    expect(resolveSalesOpsRoute({ workspace: 'cadastros', view: 'produtos' }, ['admin'], LEADS)).toEqual({
      route: { workspace: 'operacional', view: 'funil' },
      path: '/operacional/funil',
      redirect: true,
    });
  });

  it('a Propostas list route with an id drops the id when orcamentos is off', () => {
    expect(
      resolveSalesOpsRoute({ workspace: 'operacional', view: 'vendas-ganhas', saleId: 'x' }, ['admin'], LEADS),
    ).toEqual({
      route: { workspace: 'operacional', view: 'funil' },
      path: '/operacional/funil',
      redirect: true,
    });
  });

  it('a Propostas list route keeps its id with every module on', () => {
    expect(
      resolveSalesOpsRoute({ workspace: 'operacional', view: 'vendas-ganhas', saleId: 'x' }, ['admin']),
    ).toEqual({
      route: { workspace: 'operacional', view: 'vendas-ganhas', saleId: 'x' },
      path: '/operacional/vendas-ganhas/x',
      redirect: false,
    });
  });

  it('the lead summary resolves the same with the leads set and with every module on', () => {
    const leadId = '5b0e7c1e-3f4a-4c2d-9e8b-1a2b3c4d5e6f';
    const expected = {
      route: { workspace: 'operacional', view: 'leads', leadId },
      path: `/operacional/leads/${leadId}`,
      redirect: false,
    };
    expect(resolveSalesOpsRoute({ workspace: 'operacional', view: 'leads', saleId: leadId }, ['admin'], LEADS)).toEqual(
      expected,
    );
    expect(resolveSalesOpsRoute({ workspace: 'operacional', view: 'leads', saleId: leadId }, ['admin'])).toEqual(
      expected,
    );
  });

  it('the ?etapa= query survives the path builder unchanged', () => {
    expect(
      resolveSalesOpsRoute({ workspace: 'operacional', view: 'leads', etapa: 'stage-1' }, ['admin'], LEADS),
    ).toEqual({
      route: { workspace: 'operacional', view: 'leads', stageId: 'stage-1' },
      path: '/operacional/leads?etapa=stage-1',
      redirect: false,
    });
    expect(buildSalesOpsPath({ workspace: 'operacional', view: 'leads', stageId: 'stage-1' })).toBe(
      '/operacional/leads?etapa=stage-1',
    );
  });

  it('follow-ups stays visible even with every module off', () => {
    expect(getSalesOpsNavigation('operacional', ['admin'], NONE_ON).map((item) => item.label)).toEqual([
      'Prospecção',
      'Funil',
      'Follow-ups',
    ]);
    expect(getSalesOpsNavigation('operacional', ['admin'], NONE_ON).map((item) => item.id)).toEqual([
      'leads',
      'funil',
      'follow-ups',
    ]);
  });

  it('canSettleInWorkspace follows orcamentos', () => {
    expect(canSettleInWorkspace('operacional', ['admin'], ALL_MODULES_ENABLED)).toBe(true);
    expect(canSettleInWorkspace('operacional', ['admin'], OFF('orcamentos'))).toBe(false);
  });

  it('a finder-only operator sees meus-dados only while the finders module is on', () => {
    expect(getVisibleWorkspaces(['finder'], ALL_MODULES_ENABLED)).toEqual(['meus-dados']);
    expect(getVisibleWorkspaces(['finder'], OFF('finders'))).toEqual([]);
  });
});

describe('identity and catalogue', () => {
  it('getSalesOpsWorkspaces() with every module is the exported salesOpsWorkspaces object', () => {
    expect(getSalesOpsWorkspaces()).toBe(salesOpsWorkspaces);
    expect(getSalesOpsWorkspaces(ALL_MODULES_ENABLED)).toBe(salesOpsWorkspaces);
  });

  it('a repeated navigation call returns the same array', () => {
    expect(getSalesOpsNavigation('cadastros', ['admin'], LEADS)).toBe(
      getSalesOpsNavigation('cadastros', ['admin'], LEADS),
    );
  });

  it('the leads set describes operacional as Prospecção', () => {
    expect(getSalesOpsWorkspaces(LEADS)[1]).toEqual({
      id: 'operacional',
      label: 'Operacional',
      description: 'Prospecção',
    });
  });

  it('every SalesOpsView is classified in the catalogue and every requires is a known module key', () => {
    const ALL_VIEWS: Record<SalesOpsView, true> = {
      dashboard: true,
      vendas: true,
      'vendas-abertas': true,
      'vendas-ganhas': true,
      'vendas-encerradas': true,
      vendedores: true,
      finders: true,
      comissoes: true,
      produtos: true,
      areas: true,
      clientes: true,
      pessoas: true,
      funcoes: true,
      geral: true,
      leads: true,
      funil: true,
      etapas: true,
      importacao: true,
      'leads-excluidos': true,
      'follow-ups': true,
    };
    const catalogue = Object.values(NAVIGATION_CATALOGUE).flat();
    for (const view of Object.keys(ALL_VIEWS) as SalesOpsView[]) {
      expect(catalogue.some((entry) => entry.id === view)).toBe(true);
    }
    for (const entry of catalogue) {
      for (const key of entry.requires) expect(isCrmModuleKey(key)).toBe(true);
    }
  });
});
