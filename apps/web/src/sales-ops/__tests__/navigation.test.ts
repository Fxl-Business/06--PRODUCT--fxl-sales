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
  type SalesOpsView,
  type SalesOpsWorkspace,
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
      { id: 'operacional', label: 'Operacional', description: 'Propostas e conferência' },
      { id: 'cadastros', label: 'Cadastros', description: 'Pessoas, catálogo e regras' },
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
    expect(getSalesOpsNavigation('tatico', team).map((item) => item.id)).toEqual(['dashboard']);
    expect(getSalesOpsNavigation('operacional', team).map((item) => item.id)).toEqual([
      'vendas',
      'comissoes',
      'leads',
    ]);
    expect(getSalesOpsNavigation('operacional', team).map((item) => item.label)).toEqual([
      'Propostas',
      'Comissões',
      'Prospecção',
    ]);
    expect(getSalesOpsNavigation('cadastros', team).map((item) => item.id)).toEqual([
      'produtos',
      'areas',
      'clientes',
      'pessoas',
      'funcoes',
      'etapas',
      'geral',
    ]);
    expect(getSalesOpsNavigation('cadastros', team).map((item) => item.label)).toEqual([
      'Produtos & Serviços',
      'Áreas',
      'Clientes',
      'Pessoas',
      'Funções',
      'Etapas do funil',
      'Geral',
    ]);
  });

  it('renders the union of personal items in meus-dados', () => {
    expect(getSalesOpsNavigation('meus-dados', seller).map((item) => item.id)).toEqual([
      'vendedores',
      'comissoes',
      'leads',
    ]);
    expect(getSalesOpsNavigation('meus-dados', seller).map((item) => item.label)).toEqual([
      'Meu painel',
      'Comissões',
      'Minha prospecção',
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
      'leads',
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
    expect(resolveSalesOpsRoute({ workspace: 'cadastros', view: 'pessoas' }, team)).toEqual({
      route: { workspace: 'cadastros', view: 'pessoas' },
      path: '/cadastros/pessoas',
      redirect: false,
    });
    expect(resolveSalesOpsRoute({ workspace: 'cadastros', view: 'funcoes' }, team)).toEqual({
      route: { workspace: 'cadastros', view: 'funcoes' },
      path: '/cadastros/funcoes',
      redirect: false,
    });
    expect(resolveSalesOpsRoute({ workspace: 'cadastros', view: 'areas' }, team)).toEqual({
      route: { workspace: 'cadastros', view: 'areas' },
      path: '/cadastros/areas',
      redirect: false,
    });
  });

  it('aliases only the cadastros-scoped legacy vendedores and finders views to pessoas', () => {
    expect(resolveSalesOpsRoute({ workspace: 'cadastros', view: 'vendedores' }, team)).toEqual({
      route: { workspace: 'cadastros', view: 'pessoas' },
      path: '/cadastros/pessoas',
      redirect: true,
    });
    expect(resolveSalesOpsRoute({ workspace: 'cadastros', view: 'finders' }, team)).toEqual({
      route: { workspace: 'cadastros', view: 'pessoas' },
      path: '/cadastros/pessoas',
      redirect: true,
    });

    // The scope guard: `meus-dados` keeps both view ids verbatim. If the alias were
    // not restricted to `cadastros`, each of these would degrade to a redirect.
    expect(resolveSalesOpsRoute({ workspace: 'meus-dados', view: 'vendedores' }, seller)).toEqual({
      route: { workspace: 'meus-dados', view: 'vendedores' },
      path: '/meus-dados/vendedores',
      redirect: false,
    });
    expect(resolveSalesOpsRoute({ workspace: 'meus-dados', view: 'finders' }, finder)).toEqual({
      route: { workspace: 'meus-dados', view: 'finders' },
      path: '/meus-dados/finders',
      redirect: false,
    });
    expect(
      resolveSalesOpsRoute({ workspace: 'meus-dados', view: 'vendedores' }, everything),
    ).toEqual({
      route: { workspace: 'meus-dados', view: 'vendedores' },
      path: '/meus-dados/vendedores',
      redirect: false,
    });

    // Role visibility is resolved before the alias, so a seller is still bounced to
    // their own workspace rather than into Cadastros.
    expect(resolveSalesOpsRoute({ workspace: 'cadastros', view: 'vendedores' }, seller)).toEqual({
      route: { workspace: 'meus-dados', view: 'vendedores' },
      path: '/meus-dados/vendedores',
      redirect: true,
    });
    expect(resolveSalesOpsRoute({ workspace: 'cadastros', view: 'pessoas' }, seller)).toEqual({
      route: { workspace: 'meus-dados', view: 'vendedores' },
      path: '/meus-dados/vendedores',
      redirect: true,
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
    expect(resolveSalesOpsRoute({ workspace: 'tatico', view: 'vendedores' }, team)).toEqual({
      route: { workspace: 'tatico', view: 'dashboard' },
      path: '/tatico/dashboard',
      redirect: true,
    });
    expect(resolveSalesOpsRoute({ workspace: 'tatico', view: 'finders' }, team)).toEqual({
      route: { workspace: 'tatico', view: 'dashboard' },
      path: '/tatico/dashboard',
      redirect: true,
    });
    expect(resolveSalesOpsRoute({ workspace: 'cadastros', view: 'areas' }, seller)).toEqual({
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
    expect(workspaceForView('pessoas', team)).toBe('cadastros');
    expect(workspaceForView('funcoes', team)).toBe('cadastros');
    // `vendedores` now lives only in meus-dados, so a team+seller user resolves it there.
    expect(workspaceForView('vendedores', ['admin', 'seller'])).toBe('meus-dados');
    expect(workspaceForView('finders', ['admin', 'finder'])).toBe('meus-dados');
    expect(workspaceForView('vendas', ['admin', 'finder'])).toBe('operacional');
    expect(workspaceForView('areas', team)).toBe('cadastros');
  });

  it('builds canonical paths', () => {
    expect(buildSalesOpsPath({ workspace: 'tatico', view: 'dashboard' })).toBe('/tatico/dashboard');
    expect(buildSalesOpsPath({ workspace: 'meus-dados', view: 'comissoes' })).toBe(
      '/meus-dados/comissoes',
    );
  });

  /*
    THE CANONICAL-ROUTE FENCE.

    The table below is written out BY HAND and must never be derived from
    `getSalesOpsNavigation`: a derived table moves with the bug and is a green
    check over nothing. Every row is a route an operator may already hold as a
    bookmark, and acceptance 21 says none of them may change name or segment.

    The mutation this is really aimed at is the one this slice could plausibly
    cause: PREPENDING a new nav item instead of appending it.
    `getDefaultSalesOpsRoute` reads `[0]` of each list, so prepending `leads` to
    `meusDadosSeller` moves every seller's session start and prepending it to
    `operational` moves the admin's `Trocar painel` landing.
  */
  it('keeps every pre-existing canonical route at its exact segment', () => {
    const canonical: Array<{
      workspace: SalesOpsWorkspace;
      view: SalesOpsView;
      roles: AppRole[];
      path: string;
    }> = [
      { workspace: 'tatico', view: 'dashboard', roles: team, path: '/tatico/dashboard' },
      { workspace: 'operacional', view: 'vendas', roles: team, path: '/operacional/vendas' },
      { workspace: 'operacional', view: 'comissoes', roles: team, path: '/operacional/comissoes' },
      { workspace: 'cadastros', view: 'produtos', roles: team, path: '/cadastros/produtos' },
      { workspace: 'cadastros', view: 'areas', roles: team, path: '/cadastros/areas' },
      { workspace: 'cadastros', view: 'clientes', roles: team, path: '/cadastros/clientes' },
      { workspace: 'cadastros', view: 'pessoas', roles: team, path: '/cadastros/pessoas' },
      { workspace: 'cadastros', view: 'funcoes', roles: team, path: '/cadastros/funcoes' },
      { workspace: 'cadastros', view: 'geral', roles: team, path: '/cadastros/geral' },
      {
        workspace: 'meus-dados',
        view: 'vendedores',
        roles: seller,
        path: '/meus-dados/vendedores',
      },
      { workspace: 'meus-dados', view: 'comissoes', roles: seller, path: '/meus-dados/comissoes' },
      { workspace: 'meus-dados', view: 'finders', roles: finder, path: '/meus-dados/finders' },
      { workspace: 'meus-dados', view: 'vendas', roles: finder, path: '/meus-dados/vendas' },
    ];

    for (const row of canonical) {
      expect(
        resolveSalesOpsRoute({ workspace: row.workspace, view: row.view }, row.roles),
      ).toEqual({
        route: { workspace: row.workspace, view: row.view },
        path: row.path,
        redirect: false,
      });
    }

    // The landing routes, which are what a prepended nav item silently rewrites.
    expect(getDefaultSalesOpsRoute(team)).toEqual({ workspace: 'tatico', view: 'dashboard' });
    expect(getDefaultSalesOpsRoute(seller)).toEqual({
      workspace: 'meus-dados',
      view: 'vendedores',
    });
    expect(getDefaultSalesOpsRoute(finder)).toEqual({ workspace: 'meus-dados', view: 'finders' });
    expect(getDefaultSalesOpsRoute(sellerFinder)).toEqual({
      workspace: 'meus-dados',
      view: 'vendedores',
    });
    expect(getDefaultSalesOpsRoute(everything)).toEqual({ workspace: 'tatico', view: 'dashboard' });
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
  });

  it('routes the three lead screens and scopes each to its workspace', () => {
    expect(resolveSalesOpsRoute({ workspace: 'operacional', view: 'leads' }, team)).toEqual({
      route: { workspace: 'operacional', view: 'leads' },
      path: '/operacional/leads',
      redirect: false,
    });
    expect(resolveSalesOpsRoute({ workspace: 'meus-dados', view: 'leads' }, seller)).toEqual({
      route: { workspace: 'meus-dados', view: 'leads' },
      path: '/meus-dados/leads',
      redirect: false,
    });
    expect(resolveSalesOpsRoute({ workspace: 'cadastros', view: 'etapas' }, team)).toEqual({
      route: { workspace: 'cadastros', view: 'etapas' },
      path: '/cadastros/etapas',
      redirect: false,
    });
    // An operator holding everything reaches both boards.
    expect(resolveSalesOpsRoute({ workspace: 'operacional', view: 'leads' }, everything)).toEqual({
      route: { workspace: 'operacional', view: 'leads' },
      path: '/operacional/leads',
      redirect: false,
    });
    expect(resolveSalesOpsRoute({ workspace: 'meus-dados', view: 'leads' }, everything)).toEqual({
      route: { workspace: 'meus-dados', view: 'leads' },
      path: '/meus-dados/leads',
      redirect: false,
    });

    // The team board is admin-only through workspace visibility alone. No second
    // gate exists on the client, and the real scoping is the server's.
    expect(resolveSalesOpsRoute({ workspace: 'operacional', view: 'leads' }, seller)).toEqual({
      route: { workspace: 'meus-dados', view: 'vendedores' },
      path: '/meus-dados/vendedores',
      redirect: true,
    });
    expect(resolveSalesOpsRoute({ workspace: 'meus-dados', view: 'leads' }, team)).toEqual({
      route: { workspace: 'tatico', view: 'dashboard' },
      path: '/tatico/dashboard',
      redirect: true,
    });
    expect(resolveSalesOpsRoute({ workspace: 'cadastros', view: 'etapas' }, seller)).toEqual({
      route: { workspace: 'meus-dados', view: 'vendedores' },
      path: '/meus-dados/vendedores',
      redirect: true,
    });

    // A finder gains nothing at all from this feature.
    expect(getSalesOpsNavigation('meus-dados', finder).map((item) => item.id)).toEqual([
      'finders',
      'vendas',
    ]);
    expect(
      resolveSalesOpsRoute({ workspace: 'meus-dados', view: 'leads' }, finder).redirect,
    ).toBe(true);

    // One view id, two workspaces, team taking precedence - exactly as `vendas`
    // already behaves for an admin who is also a finder.
    expect(workspaceForView('leads', ['admin', 'seller'])).toBe('operacional');
    expect(workspaceForView('leads', seller)).toBe('meus-dados');
    expect(workspaceForView('etapas', team)).toBe('cadastros');

    expect(buildSalesOpsPath({ workspace: 'operacional', view: 'leads' })).toBe(
      '/operacional/leads',
    );
    expect(buildSalesOpsPath({ workspace: 'cadastros', view: 'etapas' })).toBe('/cadastros/etapas');
  });

  it('does not alias either new view and keeps the alias scoped to cadastros', () => {
    // No `leads` entry under `cadastros`, and no alias may invent one.
    expect(resolveSalesOpsRoute({ workspace: 'cadastros', view: 'leads' }, team)).toEqual({
      route: { workspace: 'tatico', view: 'dashboard' },
      path: '/tatico/dashboard',
      redirect: true,
    });
    // `etapas` is a Cadastros screen and nothing else.
    expect(resolveSalesOpsRoute({ workspace: 'operacional', view: 'etapas' }, team)).toEqual({
      route: { workspace: 'tatico', view: 'dashboard' },
      path: '/tatico/dashboard',
      redirect: true,
    });
    // `legacyCadastroViews` gained no member.
    expect(resolveSalesOpsRoute({ workspace: 'cadastros', view: 'vendedores' }, team)).toEqual({
      route: { workspace: 'cadastros', view: 'pessoas' },
      path: '/cadastros/pessoas',
      redirect: true,
    });
  });
});
