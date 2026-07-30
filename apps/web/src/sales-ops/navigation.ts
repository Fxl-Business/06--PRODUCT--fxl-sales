import {
  BadgeDollarSign,
  BarChart3,
  BriefcaseBusiness,
  Cog,
  ContactRound,
  Database,
  Layers,
  Search,
  Tags,
  UsersRound,
  type LucideIcon,
} from 'lucide-react';
import type { AppRole } from '@/auth/claims';

export type SalesOpsWorkspace = 'tatico' | 'operacional' | 'cadastros' | 'meus-dados';
/**
 * `vendedores` and `finders` are no longer Cadastros screens; they survive here
 * because they are the two `meus-dados` "Meu painel" view ids.
 */
export type SalesOpsView =
  | 'dashboard'
  | 'vendas'
  | 'vendedores'
  | 'finders'
  | 'comissoes'
  | 'produtos'
  | 'areas'
  | 'clientes'
  | 'pessoas'
  | 'funcoes'
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
];

const operational: SalesOpsNavigationItem[] = [
  { id: 'vendas', label: 'Propostas', icon: BriefcaseBusiness },
  { id: 'comissoes', label: 'Comissões', icon: BadgeDollarSign },
];

const cadastros: SalesOpsNavigationItem[] = [
  { id: 'produtos', label: 'Produtos', icon: Database },
  { id: 'areas', label: 'Áreas', icon: Layers },
  { id: 'clientes', label: 'Clientes', icon: ContactRound },
  { id: 'pessoas', label: 'Pessoas', icon: UsersRound },
  { id: 'funcoes', label: 'Funções', icon: Tags },
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
  { id: 'operacional', label: 'Operacional', description: 'Propostas e conferência' },
  { id: 'cadastros', label: 'Cadastros', description: 'Pessoas, catálogo e regras' },
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

/**
 * Bookmarked Cadastros URLs that lost their screen when Pessoas replaced the two
 * special-cased vendedor and finder cadastros. Both have a real successor, so the
 * URL is rewritten rather than dropped on the role default.
 */
const legacyCadastroViews: Readonly<Record<string, SalesOpsView>> = {
  vendedores: 'pessoas',
  finders: 'pessoas',
};

/**
 * Scoped to `cadastros` on purpose: `vendedores` and `finders` are still the two
 * live `meus-dados` view ids, so aliasing them workspace-wide would hijack the
 * seller and finder "Meu painel" routes.
 */
function aliasLegacyView(
  workspace: SalesOpsWorkspace,
  view: string | undefined,
): string | undefined {
  if (workspace !== 'cadastros' || view === undefined) return view;
  return legacyCadastroViews[view] ?? view;
}

export function resolveSalesOpsRoute(
  params: SalesOpsRouteParams,
  roles: readonly AppRole[],
): SalesOpsRouteResolution {
  const workspace = getVisibleWorkspaces(roles).find((id) => id === params.workspace);
  const requestedView = workspace ? aliasLegacyView(workspace, params.view) : params.view;
  const view = workspace
    ? getSalesOpsNavigation(workspace, roles).find((item) => item.id === requestedView)?.id
    : undefined;

  if (workspace && view) {
    const route = { workspace, view };
    // An aliased view differs from what the URL asked for, which is exactly when
    // the caller must rewrite the address bar. A canonical route stays `false`.
    return { route, path: buildSalesOpsPath(route), redirect: view !== params.view };
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
