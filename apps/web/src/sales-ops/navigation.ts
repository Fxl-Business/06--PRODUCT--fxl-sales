import {
  BadgeDollarSign,
  BarChart3,
  BriefcaseBusiness,
  Cog,
  ContactRound,
  Database,
  FileSpreadsheet,
  Layers,
  LayoutGrid,
  ListChecks,
  Search,
  Tags,
  UsersRound,
  type LucideIcon,
} from 'lucide-react';
import type { AppRole } from '@/auth/claims';
import type { SalesEdition } from '@fxl-sales/shared-utils/sales-edition';

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
  | 'geral'
  | 'leads'
  | 'etapas'
  | 'importacao';

export type SalesOpsNavigationItem = {
  id: SalesOpsView;
  label: string;
  icon: LucideIcon;
};

/**
 * The ONE Sales Ops route. The optional `saleId` segment keeps the list and the
 * proposta detail on the same route object, so moving between them never remounts
 * `SalesOpsApp` (filters, an open wizard and `convertedSales` survive).
 */
export const SALES_OPS_ROUTE_PATTERN = '/:workspace/:view/:saleId?';

export type SalesOpsRoute = Readonly<{
  workspace: SalesOpsWorkspace;
  view: SalesOpsView;
  /** The open proposta. Only ever present on the `vendas` view. */
  saleId?: string;
}>;

export type SalesOpsRouteParams = Readonly<{
  workspace?: string;
  view?: string;
  saleId?: string;
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
  /*
    APPENDED, never prepended. `getDefaultSalesOpsRoute` lands on `[0]` of this
    list, so the first entry is the `operacional` landing ROUTE: moving it
    rewrites where every `Trocar painel` click arrives.
  */
  { id: 'leads', label: 'Prospecção', icon: LayoutGrid },
];

const cadastros: SalesOpsNavigationItem[] = [
  { id: 'produtos', label: 'Produtos & Serviços', icon: Database },
  { id: 'areas', label: 'Áreas', icon: Layers },
  { id: 'clientes', label: 'Clientes', icon: ContactRound },
  { id: 'pessoas', label: 'Pessoas', icon: UsersRound },
  { id: 'funcoes', label: 'Funções', icon: Tags },
  /*
    Before `geral`, which is the settings-and-history catch-all and stays last.
    `produtos` remains `[0]`, so the Cadastros landing route does not move.
    `importacao` goes before `geral` too.
  */
  { id: 'etapas', label: 'Etapas do funil', icon: ListChecks },
  { id: 'importacao', label: 'Importação', icon: FileSpreadsheet },
  { id: 'geral', label: 'Geral', icon: Cog },
];

const meusDadosSeller: SalesOpsNavigationItem[] = [
  { id: 'vendedores', label: 'Meu painel', icon: UsersRound },
  { id: 'comissoes', label: 'Comissões', icon: BadgeDollarSign },
  /*
    APPENDED: `[0]` here is where EVERY seller's session starts.
    Seller only - a finder gains no personal lead scope, so `meusDadosFinder`
    is deliberately byte-unchanged.
  */
  { id: 'leads', label: 'Minha prospecção', icon: LayoutGrid },
];

const meusDadosFinder: SalesOpsNavigationItem[] = [
  { id: 'finders', label: 'Meu painel', icon: Search },
  { id: 'vendas', label: 'Indicações', icon: BriefcaseBusiness },
];

/*
  THE LEADS EDITION (Construbom). Three short lists, never a filter over the full ones:
  a filter would make every full-edition label and order depend on the leads rules, and
  the full edition must stay byte-identical (oracle: navigation-edition.test.ts).
  `[0]` is still the landing route of each workspace.
*/
const leadsEditionOperational: SalesOpsNavigationItem[] = [
  { id: 'leads', label: 'Prospecção', icon: LayoutGrid },
];

/** A pessoa is always a vendedor in this edition, so the screen is labelled for it. */
const leadsEditionCadastros: SalesOpsNavigationItem[] = [
  { id: 'pessoas', label: 'Vendedores', icon: UsersRound },
  { id: 'etapas', label: 'Etapas do funil', icon: ListChecks },
];

const leadsEditionMeusDadosSeller: SalesOpsNavigationItem[] = [
  { id: 'leads', label: 'Minha prospecção', icon: LayoutGrid },
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

const leadsEditionWorkspaces: ReadonlyArray<{
  id: SalesOpsWorkspace;
  label: string;
  description: string;
}> = salesOpsWorkspaces.map((item) =>
  item.id === 'operacional' ? { ...item, description: 'Prospecção' } : item,
);

/**
 * The workspace catalogue for an edition. The full edition gets the SAME
 * `salesOpsWorkspaces` array object, so nothing about it can drift.
 */
export function getSalesOpsWorkspaces(
  edition: SalesEdition = 'full',
): ReadonlyArray<{ id: SalesOpsWorkspace; label: string; description: string }> {
  return edition === 'leads' ? leadsEditionWorkspaces : salesOpsWorkspaces;
}

export function getVisibleWorkspaces(
  roles: readonly AppRole[],
  edition: SalesEdition = 'full',
): SalesOpsWorkspace[] {
  const roleSet = new Set(roles);
  if (edition === 'leads') {
    // The gestor always also holds `seller` (getRolesFromHubClaims), and AC2 gives the
    // gestor exactly Prospecção, Vendedores and Etapas, so `admin` wins outright here.
    // `finder` grants nothing: this edition has no finder screen.
    if (roleSet.has('admin')) return ['operacional', 'cadastros'];
    if (roleSet.has('seller')) return ['meus-dados'];
    return [];
  }
  const visible: SalesOpsWorkspace[] = [];
  if (roleSet.has('admin')) {
    visible.push('tatico', 'operacional', 'cadastros');
  }
  if (roleSet.has('seller') || roleSet.has('finder')) {
    visible.push('meus-dados');
  }
  return visible;
}

/**
 * Baixa and estorno are admin actions of the `operacional` workspace only:
 * `meus-dados` reuses the same views and stays read-only for everyone. Both terms
 * are load-bearing; the admin one is belt and braces today because only an admin
 * can stand in `operacional`.
 * The leads edition has no proposta, so it never settles.
 */
export function canSettleInWorkspace(
  workspace: SalesOpsWorkspace,
  roles: readonly AppRole[],
  edition: SalesEdition = 'full',
): boolean {
  return edition !== 'leads' && workspace === 'operacional' && roles.includes('admin');
}

export function getSalesOpsNavigation(
  workspace: SalesOpsWorkspace,
  roles: readonly AppRole[],
  edition: SalesEdition = 'full',
): SalesOpsNavigationItem[] {
  if (edition === 'leads') {
    switch (workspace) {
      case 'tatico':
        return [];
      case 'operacional':
        return leadsEditionOperational;
      case 'cadastros':
        return leadsEditionCadastros;
      case 'meus-dados':
        return roles.includes('seller') ? leadsEditionMeusDadosSeller : [];
    }
  }
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
  const base = `/${route.workspace}/${route.view}`;
  return route.saleId === undefined ? base : `${base}/${encodeURIComponent(route.saleId)}`;
}

/** The Finance `deepLinkPath` (audit 11.4): the team proposta detail. */
export function buildSaleDetailPath(saleId: string): string {
  return buildSalesOpsPath({ workspace: 'operacional', view: 'vendas', saleId });
}

export function getDefaultSalesOpsRoute(
  roles: readonly AppRole[],
  preferredWorkspace?: SalesOpsWorkspace,
  edition: SalesEdition = 'full',
): SalesOpsRoute {
  const visible = getVisibleWorkspaces(roles, edition);

  if (preferredWorkspace && visible.includes(preferredWorkspace)) {
    const preferredView = getSalesOpsNavigation(preferredWorkspace, roles, edition)[0]?.id;
    if (preferredView) return { workspace: preferredWorkspace, view: preferredView };
  }

  const workspace = visible[0];
  if (workspace) {
    const view = getSalesOpsNavigation(workspace, roles, edition)[0]?.id;
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
  edition: SalesEdition = 'full',
): SalesOpsRouteResolution {
  const workspace = getVisibleWorkspaces(roles, edition).find((id) => id === params.workspace);
  const requestedView = workspace ? aliasLegacyView(workspace, params.view) : params.view;
  const view = workspace
    ? getSalesOpsNavigation(workspace, roles, edition).find((item) => item.id === requestedView)?.id
    : undefined;

  if (workspace && view) {
    // The proposta id is honoured on the `vendas` view only. Never write the key
    // as `saleId: undefined`: a present-but-undefined key trips `toStrictEqual`.
    const saleId = view === 'vendas' && params.saleId ? params.saleId : undefined;
    const route: SalesOpsRoute = saleId === undefined ? { workspace, view } : { workspace, view, saleId };
    const droppedSaleId = params.saleId !== undefined && saleId === undefined;
    // An aliased view or a dropped id differs from what the URL asked for, which is
    // exactly when the caller must rewrite the address bar. A canonical route stays `false`.
    return {
      route,
      path: buildSalesOpsPath(route),
      redirect: view !== params.view || droppedSaleId,
    };
  }

  const route = getDefaultSalesOpsRoute(roles, undefined, edition);
  return { route, path: buildSalesOpsPath(route), redirect: true };
}

export function workspaceForView(
  view: SalesOpsView,
  roles: readonly AppRole[],
  edition: SalesEdition = 'full',
): SalesOpsWorkspace {
  for (const workspace of getVisibleWorkspaces(roles, edition)) {
    if (getSalesOpsNavigation(workspace, roles, edition).some((item) => item.id === view)) {
      return workspace;
    }
  }
  return getDefaultSalesOpsRoute(roles, undefined, edition).workspace;
}
