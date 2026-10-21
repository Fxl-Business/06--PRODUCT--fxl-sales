import {
  BadgeDollarSign,
  BarChart3,
  BriefcaseBusiness,
  CalendarClock,
  Cog,
  ContactRound,
  Database,
  FileSpreadsheet,
  Layers,
  LayoutGrid,
  ListChecks,
  Archive,
  Search,
  Tags,
  Trash2,
  UsersRound,
  type LucideIcon,
} from 'lucide-react';
import { isSalesListView } from './sales-views';
import type { AppRole } from '@/auth/claims';
import type { CrmModuleKey, OrgModules } from '@fxl-sales/shared-utils/crm-model';
import {
  ALL_MODULES_ENABLED,
  hasEveryModule,
  hasModule,
  isCompactProfile,
  modulesCacheKey,
} from './org-modules';

export type SalesOpsWorkspace = 'tatico' | 'operacional' | 'cadastros' | 'meus-dados';
/**
 * `vendedores` and `finders` are no longer Cadastros screens; they survive here
 * because they are the two `meus-dados` "Meu painel" view ids.
 */
export type SalesOpsView =
  | 'dashboard'
  | 'vendas'
  | 'vendas-abertas'
  | 'vendas-ganhas'
  | 'vendas-encerradas'
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
  | 'funil'
  | 'etapas'
  | 'importacao'
  | 'leads-excluidos'
  | 'follow-ups';

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
  /** The selected lead stage, from the `?etapa=` query, only on the leads view. */
  stageId?: string;
  /** The open lead summary. Only present on the leads view. */
  leadId?: string;
}>;

export type SalesOpsRouteParams = Readonly<{
  workspace?: string;
  view?: string;
  saleId?: string;
  /** The `?etapa=` query value, read by the caller. Only the leads view honours it. */
  etapa?: string;
}>;

export type SalesOpsRouteResolution = Readonly<{
  route: SalesOpsRoute;
  path: string;
  redirect: boolean;
}>;

type NavEntry = SalesOpsNavigationItem & {
  /** Every module here must be enabled for the entry to show. Empty means always. */
  requires: readonly CrmModuleKey[];
  /** The label in the compact profile (`orcamentos` off). */
  compactLabel?: string;
  /** Moved to the front, stably, in the compact profile (its landing entry). */
  compactFirst?: true;
};

/*
  THE navigation catalogue. One list per workspace, in the FULL order. An entry shows
  iff every module in `requires` is enabled; the only other variance is the compact
  profile (`orcamentos` off): `compactLabel` and `compactFirst`. Entries are APPENDED,
  never prepended: `getDefaultSalesOpsRoute` lands on `[0]` of the visible list.
  Oracles: navigation-edition.test.ts (exact equivalence with both former editions) and
  navigation-modules.test.ts.
*/
const tacticalTeam: NavEntry[] = [
  { id: 'dashboard', label: 'Visão geral', icon: BarChart3, requires: ['orcamentos'] },
];

const operational: NavEntry[] = [
  // One route per Propostas list (see `sales-views.ts`). The team only: the seller and
  // finder lists have no propostas to split. All of them need the `orcamentos` module.
  { id: 'vendas', label: 'Propostas', icon: BriefcaseBusiness, requires: ['orcamentos'] },
  { id: 'vendas-abertas', label: 'Em aberto', icon: BriefcaseBusiness, requires: ['orcamentos'] },
  { id: 'vendas-ganhas', label: 'Vendidas', icon: BadgeDollarSign, requires: ['orcamentos'] },
  { id: 'vendas-encerradas', label: 'Perdidas e canceladas', icon: Archive, requires: ['orcamentos'] },
  { id: 'comissoes', label: 'Comissões', icon: BadgeDollarSign, requires: ['comissoes'] },
  // `leads` is the landing ROUTE of the compact profile (first visible entry there).
  { id: 'leads', label: 'Prospecção', icon: LayoutGrid, requires: [] },
  { id: 'funil', label: 'Funil', icon: LayoutGrid, requires: [] },
  // The team's agenda of next steps (09e): needs no module.
  { id: 'follow-ups', label: 'Follow-ups', icon: CalendarClock, requires: [] },
];

const cadastros: NavEntry[] = [
  { id: 'produtos', label: 'Produtos & Serviços', icon: Database, requires: ['catalogo'] },
  { id: 'areas', label: 'Áreas', icon: Layers, requires: ['catalogo'] },
  { id: 'clientes', label: 'Clientes', icon: ContactRound, requires: ['clientes'] },
  // Pessoas is the compact profile's landing: labelled Vendedores and moved first there.
  {
    id: 'pessoas',
    label: 'Pessoas',
    icon: UsersRound,
    requires: [],
    compactLabel: 'Vendedores',
    compactFirst: true,
  },
  { id: 'funcoes', label: 'Funções', icon: Tags, requires: ['catalogo'] },
  { id: 'etapas', label: 'Etapas do funil', icon: ListChecks, requires: [] },
  { id: 'importacao', label: 'Importação', icon: FileSpreadsheet, requires: ['importacao'] },
  // The lead lixeira (AC9): the gestor restores a deleted lead here.
  { id: 'leads-excluidos', label: 'Leads excluídos', icon: Trash2, requires: [] },
  // The settings-and-history catch-all stays last.
  { id: 'geral', label: 'Geral', icon: Cog, requires: ['financeiro'] },
];

const meusDadosSeller: NavEntry[] = [
  { id: 'vendedores', label: 'Meu painel', icon: UsersRound, requires: ['orcamentos'] },
  { id: 'comissoes', label: 'Comissões', icon: BadgeDollarSign, requires: ['comissoes'] },
  // `[0]` here is where a seller's session starts in the compact profile.
  { id: 'leads', label: 'Minha prospecção', icon: LayoutGrid, requires: [], compactLabel: 'Prospecção' },
  { id: 'funil', label: 'Funil', icon: LayoutGrid, requires: [] },
  { id: 'follow-ups', label: 'Meus follow-ups', icon: CalendarClock, requires: [] },
];

const meusDadosFinder: NavEntry[] = [
  { id: 'finders', label: 'Meu painel', icon: Search, requires: ['finders'] },
  { id: 'vendas', label: 'Indicações', icon: BriefcaseBusiness, requires: ['finders'] },
];

/** The catalogue, exported for the coverage test (every view classified, every requires known). */
export const NAVIGATION_CATALOGUE = {
  tatico: tacticalTeam,
  operacional: operational,
  cadastros,
  meusDadosSeller,
  meusDadosFinder,
} as const;

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

/** The compact profile's workspace catalogue: Operacional is described as Prospecção. Built once. */
const compactWorkspaces: ReadonlyArray<{
  id: SalesOpsWorkspace;
  label: string;
  description: string;
}> = salesOpsWorkspaces.map((item) =>
  item.id === 'operacional' ? { ...item, description: 'Prospecção' } : item,
);

/** The workspace catalogue for a module set. Every module on gives the SAME `salesOpsWorkspaces` object. */
export function getSalesOpsWorkspaces(
  modules: OrgModules = ALL_MODULES_ENABLED,
): ReadonlyArray<{ id: SalesOpsWorkspace; label: string; description: string }> {
  return isCompactProfile(modules) ? compactWorkspaces : salesOpsWorkspaces;
}

function visibleEntries(entries: readonly NavEntry[], modules: OrgModules): SalesOpsNavigationItem[] {
  const compact = isCompactProfile(modules);
  const shown = entries.filter((entry) => hasEveryModule(modules, entry.requires));
  const ordered = compact
    ? [...shown.filter((entry) => entry.compactFirst), ...shown.filter((entry) => !entry.compactFirst)]
    : shown;
  return ordered.map(({ id, label, icon, compactLabel }) => ({
    id,
    icon,
    label: compact && compactLabel ? compactLabel : label,
  }));
}

/** Memo of the navigation lists: the shell calls these on every render and must get the same arrays back. */
const navigationCache = new Map<string, SalesOpsNavigationItem[]>();

export function getSalesOpsNavigation(
  workspace: SalesOpsWorkspace,
  roles: readonly AppRole[],
  modules: OrgModules = ALL_MODULES_ENABLED,
): SalesOpsNavigationItem[] {
  const seller = roles.includes('seller');
  const finder = roles.includes('finder');
  const flags = workspace === 'meus-dados' ? `${seller ? 1 : 0}${finder ? 1 : 0}` : '-';
  const key = `${workspace}|${flags}|${modulesCacheKey(modules)}`;
  const cached = navigationCache.get(key);
  if (cached) return cached;
  let items: SalesOpsNavigationItem[];
  switch (workspace) {
    case 'tatico':
      items = visibleEntries(tacticalTeam, modules);
      break;
    case 'operacional':
      items = visibleEntries(operational, modules);
      break;
    case 'cadastros':
      items = visibleEntries(cadastros, modules);
      break;
    case 'meus-dados':
      items = [
        ...(seller ? visibleEntries(meusDadosSeller, modules) : []),
        ...(finder ? visibleEntries(meusDadosFinder, modules) : []),
      ];
      break;
  }
  navigationCache.set(key, items);
  return items;
}

export function getVisibleWorkspaces(
  roles: readonly AppRole[],
  modules: OrgModules = ALL_MODULES_ENABLED,
): SalesOpsWorkspace[] {
  const roleSet = new Set(roles);
  const admin = roleSet.has('admin');
  const candidates: SalesOpsWorkspace[] = [];
  if (admin) candidates.push('tatico', 'operacional', 'cadastros');
  // In the compact profile the admin wins outright: the gestor is also a seller, and
  // the seller's own panel is not part of the compact product (the leads-edition rule).
  if ((roleSet.has('seller') || roleSet.has('finder')) && !(admin && isCompactProfile(modules))) {
    candidates.push('meus-dados');
  }
  // A workspace whose every entry is hidden by the modules is not offered.
  return candidates.filter((id) => getSalesOpsNavigation(id, roles, modules).length > 0);
}

/**
 * Baixa and estorno are admin actions of the `operacional` workspace only:
 * `meus-dados` reuses the same views and stays read-only for everyone. Both terms
 * are load-bearing; the admin one is belt and braces today because only an admin
 * can stand in `operacional`. Settling needs the `orcamentos` module (a proposta).
 */
export function canSettleInWorkspace(
  workspace: SalesOpsWorkspace,
  roles: readonly AppRole[],
  modules: OrgModules = ALL_MODULES_ENABLED,
): boolean {
  return hasModule(modules, 'orcamentos') && workspace === 'operacional' && roles.includes('admin');
}

export function buildSalesOpsPath(route: SalesOpsRoute): string {
  const base = `/${route.workspace}/${route.view}`;
  if (route.view === 'leads') {
    if (route.leadId !== undefined) return `${base}/${encodeURIComponent(route.leadId)}`;
    return route.stageId === undefined ? base : `${base}?etapa=${encodeURIComponent(route.stageId)}`;
  }
  return route.saleId === undefined ? base : `${base}/${encodeURIComponent(route.saleId)}`;
}

export function buildLeadStagePath(workspace: SalesOpsWorkspace, stageId: string): string {
  return buildSalesOpsPath({ workspace, view: 'leads', stageId });
}

export function buildLeadSummaryPath(workspace: SalesOpsWorkspace, leadId: string): string {
  return buildSalesOpsPath({ workspace, view: 'leads', leadId });
}

export function buildLeadFunnelPath(workspace: SalesOpsWorkspace): string {
  return buildSalesOpsPath({ workspace, view: 'funil' });
}

/** The Finance `deepLinkPath` (audit 11.4): the team proposta detail. */
export function buildSaleDetailPath(saleId: string): string {
  return buildSalesOpsPath({ workspace: 'operacional', view: 'vendas', saleId });
}

export function getDefaultSalesOpsRoute(
  roles: readonly AppRole[],
  preferredWorkspace?: SalesOpsWorkspace,
  modules: OrgModules = ALL_MODULES_ENABLED,
): SalesOpsRoute {
  const visible = getVisibleWorkspaces(roles, modules);

  // Prospecção leads the sidebar, while Funil remains the landing page because
  // a bare leads URL has no stage to show and redirects there.
  const landingView = (target: SalesOpsWorkspace) => {
    const items = getSalesOpsNavigation(target, roles, modules);
    return items[0]?.id === 'leads' && items.some((item) => item.id === 'funil')
      ? 'funil'
      : items[0]?.id;
  };

  if (preferredWorkspace && visible.includes(preferredWorkspace)) {
    const preferredView = landingView(preferredWorkspace);
    if (preferredView) return { workspace: preferredWorkspace, view: preferredView };
  }

  const workspace = visible[0];
  if (workspace) {
    const view = landingView(workspace);
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
  modules: OrgModules = ALL_MODULES_ENABLED,
): SalesOpsRouteResolution {
  const workspace = getVisibleWorkspaces(roles, modules).find((id) => id === params.workspace);
  const requestedView = workspace ? aliasLegacyView(workspace, params.view) : params.view;
  const view = workspace
    ? getSalesOpsNavigation(workspace, roles, modules).find((item) => item.id === requestedView)?.id
    : undefined;

  if (workspace && view) {
    if (view === 'leads' && !params.saleId && !params.etapa) {
      const route: SalesOpsRoute = { workspace, view: 'funil' };
      return { route, path: buildSalesOpsPath(route), redirect: true };
    }
    // The third segment is the proposta id on `vendas` and the lead id on `leads`.
    // The `?etapa=` query is the stage selection, on `leads` only. Never write a key
    // as `undefined`: a present-but-undefined key trips `toStrictEqual`.
    const saleId = isSalesListView(view) && params.saleId ? params.saleId : undefined;
    const leadId = view === 'leads' && params.saleId ? params.saleId : undefined;
    const stageId = view === 'leads' && !leadId && params.etapa ? params.etapa : undefined;
    const route: SalesOpsRoute = {
      workspace,
      view,
      ...(saleId !== undefined ? { saleId } : {}),
      ...(leadId !== undefined ? { leadId } : {}),
      ...(stageId !== undefined ? { stageId } : {}),
    };
    const droppedSaleId = params.saleId !== undefined && saleId === undefined && leadId === undefined;
    const droppedEtapa = params.etapa !== undefined && stageId === undefined;
    // An aliased view or a dropped id differs from what the URL asked for, which is
    // exactly when the caller must rewrite the address bar. A canonical route stays `false`.
    return {
      route,
      path: buildSalesOpsPath(route),
      redirect: view !== params.view || droppedSaleId || droppedEtapa,
    };
  }

  const route = getDefaultSalesOpsRoute(roles, undefined, modules);
  return { route, path: buildSalesOpsPath(route), redirect: true };
}

export function workspaceForView(
  view: SalesOpsView,
  roles: readonly AppRole[],
  modules: OrgModules = ALL_MODULES_ENABLED,
): SalesOpsWorkspace {
  for (const workspace of getVisibleWorkspaces(roles, modules)) {
    if (getSalesOpsNavigation(workspace, roles, modules).some((item) => item.id === view)) {
      return workspace;
    }
  }
  return getDefaultSalesOpsRoute(roles, undefined, modules).workspace;
}
