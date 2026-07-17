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

export type SalesOpsWorkspace = 'tatico' | 'operacional' | 'cadastros' | 'meus-dados';
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

const operational: SalesOpsNavigationItem[] = [
  { id: 'vendas', label: 'Vendas', icon: BriefcaseBusiness },
  { id: 'comissoes', label: 'Comissões', icon: BadgeDollarSign },
];

const cadastros: SalesOpsNavigationItem[] = [
  { id: 'produtos', label: 'Produtos', icon: Database },
  { id: 'clientes', label: 'Clientes', icon: ContactRound },
  { id: 'geral', label: 'Geral', icon: Cog },
];

const meusDadosSeller: SalesOpsNavigationItem[] = [
  { id: 'vendedores', label: 'Meu painel', icon: UsersRound },
  { id: 'comissoes', label: 'Comissões', icon: BadgeDollarSign },
];

const meusDadosFinder: SalesOpsNavigationItem[] = [
  { id: 'finders', label: 'Meu painel', icon: Search },
  { id: 'vendas', label: 'Indicações', icon: BriefcaseBusiness },
];

export const salesOpsWorkspaces: Array<{
  id: SalesOpsWorkspace;
  label: string;
  description: string;
}> = [
  { id: 'tatico', label: 'Tático', description: 'Indicadores e painéis' },
  { id: 'operacional', label: 'Operacional', description: 'Vendas e conferência' },
  { id: 'cadastros', label: 'Cadastros', description: 'Catálogo e regras' },
  { id: 'meus-dados', label: 'Meus dados', description: 'Painel e comissões pessoais' },
];

export function getVisibleWorkspaces(roles: readonly AppRole[]): SalesOpsWorkspace[] {
  const roleSet = new Set(roles);
  const visible: SalesOpsWorkspace[] = [];
  if (roleSet.has('admin')) {
    visible.push('tatico', 'operacional', 'cadastros');
  }
  if (roleSet.has('seller') || roleSet.has('finder')) {
    visible.push('meus-dados');
  }
  return visible;
}

export function getSalesOpsNavigation(
  workspace: SalesOpsWorkspace,
  roles: readonly AppRole[],
): SalesOpsNavigationItem[] {
  switch (workspace) {
    case 'tatico':
      return tacticalTeam;
    case 'operacional':
      return operational;
    case 'cadastros':
      return cadastros;
    case 'meus-dados': {
      const roleSet = new Set(roles);
      const items: SalesOpsNavigationItem[] = [];
      if (roleSet.has('seller')) items.push(...meusDadosSeller);
      if (roleSet.has('finder')) items.push(...meusDadosFinder);
      return items;
    }
  }
}

export function buildSalesOpsPath(route: SalesOpsRoute): string {
  return `/${route.workspace}/${route.view}`;
}

export function getDefaultSalesOpsRoute(
  roles: readonly AppRole[],
  preferredWorkspace?: SalesOpsWorkspace,
): SalesOpsRoute {
  const visible = getVisibleWorkspaces(roles);

  if (preferredWorkspace && visible.includes(preferredWorkspace)) {
    const preferredView = getSalesOpsNavigation(preferredWorkspace, roles)[0]?.id;
    if (preferredView) return { workspace: preferredWorkspace, view: preferredView };
  }

  const workspace = visible[0];
  if (workspace) {
    const view = getSalesOpsNavigation(workspace, roles)[0]?.id;
    if (view) return { workspace, view };
  }

  return { workspace: 'tatico', view: 'dashboard' };
}

export function resolveSalesOpsRoute(
  params: SalesOpsRouteParams,
  roles: readonly AppRole[],
): SalesOpsRouteResolution {
  const workspace = getVisibleWorkspaces(roles).find((id) => id === params.workspace);
  const view = workspace
    ? getSalesOpsNavigation(workspace, roles).find((item) => item.id === params.view)?.id
    : undefined;

  if (workspace && view) {
    const route = { workspace, view };
    return { route, path: buildSalesOpsPath(route), redirect: false };
  }

  const route = getDefaultSalesOpsRoute(roles);
  return { route, path: buildSalesOpsPath(route), redirect: true };
}

export function workspaceForView(
  view: SalesOpsView,
  roles: readonly AppRole[],
): SalesOpsWorkspace {
  for (const workspace of getVisibleWorkspaces(roles)) {
    if (getSalesOpsNavigation(workspace, roles).some((item) => item.id === view)) {
      return workspace;
    }
  }
  return getDefaultSalesOpsRoute(roles).workspace;
}
