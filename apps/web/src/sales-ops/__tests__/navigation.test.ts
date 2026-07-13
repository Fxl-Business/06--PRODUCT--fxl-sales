import { describe, expect, it } from 'vitest';
import {
  buildSalesOpsPath,
  getDefaultSalesOpsRoute,
  getSalesOpsNavigation,
  getSalesOpsRoleViews,
  resolveSalesOpsRoute,
  salesOpsWorkspaces,
  workspaceForView,
  type SalesOpsRoleView,
  type SalesOpsRoute,
  type SalesOpsView,
  type SalesOpsWorkspace,
} from '../navigation';

const canonicalRoutes = [
  { workspace: 'tatico', view: 'dashboard' },
  { workspace: 'tatico', view: 'vendedores' },
  { workspace: 'tatico', view: 'finders' },
  { workspace: 'operacional', view: 'vendas' },
  { workspace: 'operacional', view: 'comissoes' },
  { workspace: 'cadastros', view: 'produtos' },
  { workspace: 'cadastros', view: 'clientes' },
  { workspace: 'cadastros', view: 'geral' },
] as const satisfies readonly SalesOpsRoute[];

const allowedRoutes: Record<SalesOpsRoleView, readonly SalesOpsRoute[]> = {
  equipe: canonicalRoutes,
  vendedor: canonicalRoutes.filter(
    (route) =>
      route.workspace === 'operacional' ||
      (route.workspace === 'tatico' && route.view === 'vendedores'),
  ),
  finder: canonicalRoutes.filter(
    (route) =>
      route.workspace === 'operacional' ||
      (route.workspace === 'tatico' && route.view === 'finders'),
  ),
};

const roleDefaults: Record<SalesOpsRoleView, SalesOpsRoute> = {
  equipe: { workspace: 'tatico', view: 'dashboard' },
  vendedor: { workspace: 'tatico', view: 'vendedores' },
  finder: { workspace: 'tatico', view: 'finders' },
};

describe('sales operations navigation', () => {
  it('uses the exact workspace vocabulary and role-visible navigation', () => {
    expect(salesOpsWorkspaces).toEqual([
      { id: 'tatico', label: 'Tático', description: 'Indicadores e painéis' },
      { id: 'operacional', label: 'Operacional', description: 'Vendas e conferência' },
      { id: 'cadastros', label: 'Cadastros', description: 'Catálogo e regras' },
    ]);
    expect(getSalesOpsNavigation('tatico', 'equipe').map((item) => item.id)).toEqual([
      'dashboard',
      'vendedores',
      'finders',
    ]);
    expect(getSalesOpsNavigation('tatico', 'vendedor').map((item) => item.id)).toEqual([
      'vendedores',
    ]);
    expect(getSalesOpsNavigation('tatico', 'finder').map((item) => item.id)).toEqual(['finders']);
    expect(getSalesOpsNavigation('cadastros', 'equipe').map((item) => item.id)).toEqual([
      'produtos',
      'clientes',
      'geral',
    ]);
    expect(getSalesOpsNavigation('cadastros', 'vendedor')).toEqual([]);
    expect(getSalesOpsNavigation('cadastros', 'finder')).toEqual([]);
  });

  it.each<SalesOpsRoleView>(['equipe', 'vendedor', 'finder'])(
    'keeps operational sales and commissions available for %s',
    (role) => {
      expect(getSalesOpsNavigation('operacional', role).map((item) => item.id)).toEqual([
        'vendas',
        'comissoes',
      ]);
    },
  );

  it.each(
    (Object.entries(allowedRoutes) as Array<[SalesOpsRoleView, readonly SalesOpsRoute[]]>).flatMap(
      ([role, routes]) => routes.map((route) => ({ role, route })),
    ),
  )('preserves $role route $route.workspace/$route.view', ({ role, route }) => {
    expect(resolveSalesOpsRoute(route, role)).toEqual({
      route,
      path: `/${route.workspace}/${route.view}`,
      redirect: false,
    });
  });

  it.each(
    (['equipe', 'vendedor', 'finder'] as const).flatMap((role) => [
      { role, params: {} },
      { role, params: { workspace: 'unknown', view: 'vendas' } },
    ]),
  )('redirects missing or unknown params for $role', ({ role, params }) => {
    const route = roleDefaults[role];
    expect(resolveSalesOpsRoute(params, role)).toEqual({
      route,
      path: buildSalesOpsPath(route),
      redirect: true,
    });
  });

  it.each(
    (['equipe', 'vendedor', 'finder'] as const).flatMap((role) =>
      canonicalRoutes.flatMap((ownedRoute) =>
        (['tatico', 'operacional', 'cadastros'] as const)
          .filter((workspace) => workspace !== ownedRoute.workspace)
          .map((workspace) => ({ role, workspace, view: ownedRoute.view })),
      ),
    ),
  )('redirects mismatched $workspace/$view for $role', ({ role, workspace, view }) => {
    const route = roleDefaults[role];
    expect(resolveSalesOpsRoute({ workspace, view }, role)).toEqual({
      route,
      path: buildSalesOpsPath(route),
      redirect: true,
    });
  });

  it.each([
    { role: 'vendedor', workspace: 'tatico', view: 'dashboard' },
    { role: 'vendedor', workspace: 'tatico', view: 'finders' },
    { role: 'finder', workspace: 'tatico', view: 'dashboard' },
    { role: 'finder', workspace: 'tatico', view: 'vendedores' },
    ...(['vendedor', 'finder'] as const).flatMap((role) =>
      (['produtos', 'clientes', 'geral'] as const).map((view) => ({
        role,
        workspace: 'cadastros' as const,
        view,
      })),
    ),
  ] satisfies Array<{
    role: SalesOpsRoleView;
    workspace: SalesOpsWorkspace;
    view: SalesOpsView;
  }>)('redirects forbidden $workspace/$view for $role', ({ role, workspace, view }) => {
    const route = roleDefaults[role];
    expect(resolveSalesOpsRoute({ workspace, view }, role)).toEqual({
      route,
      path: buildSalesOpsPath(route),
      redirect: true,
    });
  });

  it('selects workspace defaults and falls back from inaccessible workspaces', () => {
    expect(getDefaultSalesOpsRoute('equipe', 'tatico')).toEqual(roleDefaults.equipe);
    expect(getDefaultSalesOpsRoute('equipe', 'operacional')).toEqual({
      workspace: 'operacional',
      view: 'vendas',
    });
    expect(getDefaultSalesOpsRoute('equipe', 'cadastros')).toEqual({
      workspace: 'cadastros',
      view: 'produtos',
    });
    expect(getDefaultSalesOpsRoute('vendedor', 'tatico')).toEqual(roleDefaults.vendedor);
    expect(getDefaultSalesOpsRoute('vendedor', 'operacional')).toEqual({
      workspace: 'operacional',
      view: 'vendas',
    });
    expect(getDefaultSalesOpsRoute('vendedor', 'cadastros')).toEqual(roleDefaults.vendedor);
    expect(getDefaultSalesOpsRoute('finder', 'tatico')).toEqual(roleDefaults.finder);
    expect(getDefaultSalesOpsRoute('finder', 'operacional')).toEqual({
      workspace: 'operacional',
      view: 'vendas',
    });
    expect(getDefaultSalesOpsRoute('finder', 'cadastros')).toEqual(roleDefaults.finder);
  });

  it('builds exact canonical paths and maps catalogue pages to cadastros', () => {
    expect(buildSalesOpsPath({ workspace: 'tatico', view: 'dashboard' })).toBe(
      '/tatico/dashboard',
    );
    expect(buildSalesOpsPath({ workspace: 'operacional', view: 'comissoes' })).toBe(
      '/operacional/comissoes',
    );
    expect(buildSalesOpsPath({ workspace: 'cadastros', view: 'clientes' })).toBe(
      '/cadastros/clientes',
    );
    expect(workspaceForView('produtos', 'equipe')).toBe('cadastros');
    expect(workspaceForView('clientes', 'equipe')).toBe('cadastros');
    expect(workspaceForView('geral', 'equipe')).toBe('cadastros');
  });

  it('limits the visual role switcher to Hub-granted app roles', () => {
    expect(getSalesOpsRoleViews(['admin', 'seller', 'finder'])).toEqual([
      'equipe',
      'vendedor',
      'finder',
    ]);
    expect(getSalesOpsRoleViews(['seller', 'finder'])).toEqual(['vendedor', 'finder']);
    expect(getSalesOpsRoleViews(['seller'])).toEqual(['vendedor']);
    expect(getSalesOpsRoleViews([])).toEqual([]);
  });
});
