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

export type SalesOpsWorkspace = 'tatico' | 'operacional' | 'config';
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

const config: SalesOpsNavigationItem[] = [
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
  { id: 'config', label: 'Configurações', description: 'Catálogo e regras' },
];

export function getSalesOpsNavigation(
  workspace: SalesOpsWorkspace,
  role: SalesOpsRoleView,
): SalesOpsNavigationItem[] {
  if (workspace === 'operacional') return operational;
  if (workspace === 'config') return role === 'equipe' ? config : operational;
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

export function resolveInitialSalesOpsView(
  workspace: SalesOpsWorkspace,
  role: SalesOpsRoleView,
  current?: SalesOpsView,
): SalesOpsView {
  const items = getSalesOpsNavigation(workspace, role);
  if (current && items.some((item) => item.id === current)) return current;
  return items[0]?.id ?? 'dashboard';
}

export function workspaceForView(view: SalesOpsView, role: SalesOpsRoleView): SalesOpsWorkspace {
  for (const workspace of salesOpsWorkspaces) {
    if (getSalesOpsNavigation(workspace.id, role).some((item) => item.id === view)) {
      return workspace.id;
    }
  }
  return 'tatico';
}
