import { describe, expect, it } from 'vitest';
import type { AppRole } from '@/auth/claims';
import {
  buildSalesOpsPath,
  getDefaultSalesOpsRoute,
  getSalesOpsNavigation,
  getVisibleWorkspaces,
  resolveSalesOpsRoute,
  salesOpsWorkspaces,
  workspaceForView,
} from '../navigation';

const team: AppRole[] = ['admin'];
const seller: AppRole[] = ['seller'];
const finder: AppRole[] = ['finder'];
const sellerFinder: AppRole[] = ['seller', 'finder'];
const everything: AppRole[] = ['admin', 'seller', 'finder'];

describe('sales operations navigation', () => {
  it('exposes the exact workspace catalogue including meus-dados', () => {
    expect(salesOpsWorkspaces).toEqual([
      { id: 'tatico', label: 'Tático', description: 'Indicadores e painéis' },
      { id: 'operacional', label: 'Operacional', description: 'Vendas e conferência' },
      { id: 'cadastros', label: 'Cadastros', description: 'Catálogo e regras' },
      { id: 'meus-dados', label: 'Meus dados', description: 'Painel e comissões pessoais' },
    ]);
  });

  it('derives visible workspaces from the Hub role set', () => {
    expect(getVisibleWorkspaces(team)).toEqual(['tatico', 'operacional', 'cadastros']);
    expect(getVisibleWorkspaces(seller)).toEqual(['meus-dados']);
    expect(getVisibleWorkspaces(finder)).toEqual(['meus-dados']);
    expect(getVisibleWorkspaces(sellerFinder)).toEqual(['meus-dados']);
    expect(getVisibleWorkspaces(everything)).toEqual([
      'tatico',
      'operacional',
      'cadastros',
      'meus-dados',
    ]);
    expect(getVisibleWorkspaces([])).toEqual([]);
  });

  it('renders fixed team navigation for the team workspaces', () => {
    expect(getSalesOpsNavigation('tatico', team).map((item) => item.id)).toEqual([
      'dashboard',
      'vendedores',
      'finders',
    ]);
    expect(getSalesOpsNavigation('operacional', team).map((item) => item.id)).toEqual([
      'vendas',
      'comissoes',
    ]);
    expect(getSalesOpsNavigation('cadastros', team).map((item) => item.id)).toEqual([
      'produtos',
      'clientes',
      'geral',
    ]);
  });

  it('renders the union of personal items in meus-dados', () => {
    expect(getSalesOpsNavigation('meus-dados', seller).map((item) => item.id)).toEqual([
      'vendedores',
      'comissoes',
    ]);
    expect(getSalesOpsNavigation('meus-dados', seller).map((item) => item.label)).toEqual([
      'Meu painel',
      'Comissões',
    ]);
    expect(getSalesOpsNavigation('meus-dados', finder).map((item) => item.id)).toEqual([
      'finders',
      'vendas',
    ]);
    expect(getSalesOpsNavigation('meus-dados', finder).map((item) => item.label)).toEqual([
      'Meu painel',
      'Indicações',
    ]);
    expect(getSalesOpsNavigation('meus-dados', sellerFinder).map((item) => item.id)).toEqual([
      'vendedores',
      'comissoes',
      'finders',
      'vendas',
    ]);
  });

  it('defaults team users to tatico and personal-only users to meus-dados', () => {
    expect(getDefaultSalesOpsRoute(team)).toEqual({ workspace: 'tatico', view: 'dashboard' });
    expect(getDefaultSalesOpsRoute(seller)).toEqual({ workspace: 'meus-dados', view: 'vendedores' });
    expect(getDefaultSalesOpsRoute(finder)).toEqual({ workspace: 'meus-dados', view: 'finders' });
    expect(getDefaultSalesOpsRoute(sellerFinder)).toEqual({
      workspace: 'meus-dados',
      view: 'vendedores',
    });
    expect(getDefaultSalesOpsRoute(everything)).toEqual({ workspace: 'tatico', view: 'dashboard' });
  });

  it('honours a visible preferred workspace and ignores an invisible one', () => {
    expect(getDefaultSalesOpsRoute(team, 'operacional')).toEqual({
      workspace: 'operacional',
      view: 'vendas',
    });
    expect(getDefaultSalesOpsRoute(team, 'cadastros')).toEqual({
      workspace: 'cadastros',
      view: 'produtos',
    });
    expect(getDefaultSalesOpsRoute(everything, 'meus-dados')).toEqual({
      workspace: 'meus-dados',
      view: 'vendedores',
    });
    expect(getDefaultSalesOpsRoute(seller, 'tatico')).toEqual({
      workspace: 'meus-dados',
      view: 'vendedores',
    });
  });

  it('keeps valid routes and reports no redirect', () => {
    expect(resolveSalesOpsRoute({ workspace: 'tatico', view: 'dashboard' }, team)).toEqual({
      route: { workspace: 'tatico', view: 'dashboard' },
      path: '/tatico/dashboard',
      redirect: false,
    });
    expect(resolveSalesOpsRoute({ workspace: 'meus-dados', view: 'comissoes' }, seller)).toEqual({
      route: { workspace: 'meus-dados', view: 'comissoes' },
      path: '/meus-dados/comissoes',
      redirect: false,
    });
    expect(resolveSalesOpsRoute({ workspace: 'meus-dados', view: 'vendas' }, finder)).toEqual({
      route: { workspace: 'meus-dados', view: 'vendas' },
      path: '/meus-dados/vendas',
      redirect: false,
    });
  });

  it('redirects routes pointing at an invisible or forbidden target to the role default', () => {
    expect(resolveSalesOpsRoute({ workspace: 'tatico', view: 'dashboard' }, seller)).toEqual({
      route: { workspace: 'meus-dados', view: 'vendedores' },
      path: '/meus-dados/vendedores',
      redirect: true,
    });
    expect(resolveSalesOpsRoute({ workspace: 'cadastros', view: 'produtos' }, seller)).toEqual({
      route: { workspace: 'meus-dados', view: 'vendedores' },
      path: '/meus-dados/vendedores',
      redirect: true,
    });
    expect(resolveSalesOpsRoute({ workspace: 'operacional', view: 'vendas' }, finder)).toEqual({
      route: { workspace: 'meus-dados', view: 'finders' },
      path: '/meus-dados/finders',
      redirect: true,
    });
    expect(resolveSalesOpsRoute({ workspace: 'meus-dados', view: 'vendedores' }, team)).toEqual({
      route: { workspace: 'tatico', view: 'dashboard' },
      path: '/tatico/dashboard',
      redirect: true,
    });
    expect(resolveSalesOpsRoute({ workspace: 'meus-dados', view: 'finders' }, seller)).toEqual({
      route: { workspace: 'meus-dados', view: 'vendedores' },
      path: '/meus-dados/vendedores',
      redirect: true,
    });
    expect(resolveSalesOpsRoute({}, team)).toEqual({
      route: { workspace: 'tatico', view: 'dashboard' },
      path: '/tatico/dashboard',
      redirect: true,
    });
    expect(resolveSalesOpsRoute({ workspace: 'unknown', view: 'vendas' }, seller)).toEqual({
      route: { workspace: 'meus-dados', view: 'vendedores' },
      path: '/meus-dados/vendedores',
      redirect: true,
    });
  });

  it('maps a view to its workspace within the visible set, team taking precedence', () => {
    expect(workspaceForView('produtos', team)).toBe('cadastros');
    expect(workspaceForView('vendas', team)).toBe('operacional');
    expect(workspaceForView('dashboard', team)).toBe('tatico');
    expect(workspaceForView('vendedores', seller)).toBe('meus-dados');
    expect(workspaceForView('comissoes', seller)).toBe('meus-dados');
    expect(workspaceForView('finders', finder)).toBe('meus-dados');
    expect(workspaceForView('vendas', finder)).toBe('meus-dados');
    expect(workspaceForView('vendedores', ['admin', 'seller'])).toBe('tatico');
    expect(workspaceForView('vendas', ['admin', 'finder'])).toBe('operacional');
  });

  it('builds canonical paths', () => {
    expect(buildSalesOpsPath({ workspace: 'tatico', view: 'dashboard' })).toBe('/tatico/dashboard');
    expect(buildSalesOpsPath({ workspace: 'meus-dados', view: 'comissoes' })).toBe(
      '/meus-dados/comissoes',
    );
  });
});
