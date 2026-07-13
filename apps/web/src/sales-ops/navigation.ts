import {
  BadgeDollarSign,
  BarChart3,
  BriefcaseBusiness,
  Cog,
  ContactRound,
  Database,
  Search,
  UsersRound,
  type LucideIcon,
} from 'lucide-react';
import type { AppRole } from '@/auth/claims';

export type SalesOpsWorkspace = 'tatico' | 'operacional' | 'cadastros';
export type SalesOpsRoleView = 'equipe' | 'vendedor' | 'finder';
export type SalesOpsView =
  | 'dashboard'
  | 'vendas'
  | 'vendedores'
  | 'finders'
  | 'comissoes'
  | 'produtos'
  | 'clientes'
  | 'geral';

export type SalesOpsNavigationItem = {
  id: SalesOpsView;
  label: string;
  icon: LucideIcon;
};

export type SalesOpsRoute = Readonly<{
  workspace: SalesOpsWorkspace;
  view: SalesOpsView;
}>;

export type SalesOpsRouteParams = Readonly<{
  workspace?: string;
  view?: string;
}>;

export type SalesOpsRouteResolution = Readonly<{
  route: SalesOpsRoute;
  path: string;
  redirect: boolean;
}>;

const tacticalTeam: SalesOpsNavigationItem[] = [
  { id: 'dashboard', label: 'Visão geral', icon: BarChart3 },
  { id: 'vendedores', label: 'Vendedores', icon: UsersRound },
  { id: 'finders', label: 'Finders', icon: Search },
];

const tacticalSeller: SalesOpsNavigationItem[] = [
  { id: 'vendedores', label: 'Meu painel', icon: UsersRound },
];

const tacticalFinder: SalesOpsNavigationItem[] = [
  { id: 'finders', label: 'Meu painel', icon: Search },
];

const operational: SalesOpsNavigationItem[] = [
  { id: 'vendas', label: 'Vendas', icon: BriefcaseBusiness },
  { id: 'comissoes', label: 'Comissões', icon: BadgeDollarSign },
];

const cadastros: SalesOpsNavigationItem[] = [
  { id: 'produtos', label: 'Produtos', icon: Database },
  { id: 'clientes', label: 'Clientes', icon: ContactRound },
  { id: 'geral', label: 'Geral', icon: Cog },
];

export const salesOpsWorkspaces: Array<{
  id: SalesOpsWorkspace;
  label: string;
  description: string;
}> = [
  { id: 'tatico', label: 'Tático', description: 'Indicadores e painéis' },
  { id: 'operacional', label: 'Operacional', description: 'Vendas e conferência' },
  { id: 'cadastros', label: 'Cadastros', description: 'Catálogo e regras' },
];

export function getSalesOpsNavigation(
  workspace: SalesOpsWorkspace,
  role: SalesOpsRoleView,
): SalesOpsNavigationItem[] {
  if (workspace === 'operacional') return operational;
  if (workspace === 'cadastros') return role === 'equipe' ? cadastros : [];
  if (role === 'vendedor') return tacticalSeller;
  if (role === 'finder') return tacticalFinder;
  return tacticalTeam;
}

export function getSalesOpsRoleViews(roles: readonly AppRole[]): SalesOpsRoleView[] {
  const roleSet = new Set(roles);
  const views: SalesOpsRoleView[] = [];
  if (roleSet.has('admin')) views.push('equipe');
  if (roleSet.has('seller')) views.push('vendedor');
  if (roleSet.has('finder')) views.push('finder');
  return views;
}

export function buildSalesOpsPath(route: SalesOpsRoute): string {
  return `/${route.workspace}/${route.view}`;
}

export function getDefaultSalesOpsRoute(
  role: SalesOpsRoleView,
  preferredWorkspace?: SalesOpsWorkspace,
): SalesOpsRoute {
  if (preferredWorkspace) {
    const preferredView = getSalesOpsNavigation(preferredWorkspace, role)[0]?.id;
    if (preferredView) return { workspace: preferredWorkspace, view: preferredView };
  }

  return {
    workspace: 'tatico',
    view: getSalesOpsNavigation('tatico', role)[0]?.id ?? 'dashboard',
  };
}

export function resolveSalesOpsRoute(
  params: SalesOpsRouteParams,
  role: SalesOpsRoleView,
): SalesOpsRouteResolution {
  const workspace = salesOpsWorkspaces.find((item) => item.id === params.workspace)?.id;
  const view = workspace
    ? getSalesOpsNavigation(workspace, role).find((item) => item.id === params.view)?.id
    : undefined;

  if (workspace && view) {
    const route = { workspace, view };
    return { route, path: buildSalesOpsPath(route), redirect: false };
  }

  const route = getDefaultSalesOpsRoute(role);
  return { route, path: buildSalesOpsPath(route), redirect: true };
}

export function workspaceForView(view: SalesOpsView, role: SalesOpsRoleView): SalesOpsWorkspace {
  for (const workspace of salesOpsWorkspaces) {
    if (getSalesOpsNavigation(workspace.id, role).some((item) => item.id === view)) {
      return workspace.id;
    }
  }
  for (const workspace of salesOpsWorkspaces) {
    if (getSalesOpsNavigation(workspace.id, 'equipe').some((item) => item.id === view)) {
      return workspace.id;
    }
  }
  return 'tatico';
}
