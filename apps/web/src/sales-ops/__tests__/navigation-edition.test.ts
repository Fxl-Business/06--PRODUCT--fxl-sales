import { describe, expect, it } from 'vitest';
import type { AppRole } from '@/auth/claims';
import {
  buildSalesOpsPath,
  canSettleInWorkspace,
  getDefaultSalesOpsRoute,
  getSalesOpsNavigation,
  getSalesOpsWorkspaces,
  getVisibleWorkspaces,
  resolveSalesOpsRoute,
  salesOpsWorkspaces,
  workspaceForView,
  type SalesOpsView,
  type SalesOpsWorkspace,
} from '../navigation';

/*
  THE EDITION FENCE. Every expected value below is a hand-written literal captured from
  the pre-edition navigation.ts. Never derive one by calling navigation.ts: a derived
  table moves with the bug.
*/
const COMBOS = {
  none: [],
  admin: ['admin'],
  seller: ['seller'],
  finder: ['finder'],
  adminSeller: ['admin', 'seller'],
  adminFinder: ['admin', 'finder'],
  sellerFinder: ['seller', 'finder'],
  everything: ['admin', 'seller', 'finder'],
} as const satisfies Record<string, readonly AppRole[]>;
type ComboName = keyof typeof COMBOS;
const COMBO_NAMES = Object.keys(COMBOS) as ComboName[];
const WORKSPACES: SalesOpsWorkspace[] = ['tatico', 'operacional', 'cadastros', 'meus-dados'];
const TEAM_WORKSPACES = ['tatico', 'operacional', 'cadastros'] as const;
const URLS = [
  '/tatico/dashboard', '/operacional/vendas', '/operacional/comissoes', '/operacional/leads',
  '/cadastros/produtos', '/cadastros/pessoas', '/cadastros/vendedores', '/cadastros/etapas',
  '/cadastros/importacao', '/cadastros/geral', '/meus-dados/vendedores', '/meus-dados/comissoes',
  '/meus-dados/leads', '/meus-dados/finders', '/meus-dados/vendas',
];
const pairs = (items: { id: SalesOpsView; label: string }[]) =>
  items.map((item): [SalesOpsView, string] => [item.id, item.label]);
const params = (url: string) => {
  const [, workspace, view] = url.split('/');
  return { workspace, view };
};

const VISIBLE_FULL: Record<ComboName, SalesOpsWorkspace[]> = {
  none: [],
  admin: ['tatico', 'operacional', 'cadastros'],
  seller: ['meus-dados'],
  finder: ['meus-dados'],
  adminSeller: ['tatico', 'operacional', 'cadastros', 'meus-dados'],
  adminFinder: ['tatico', 'operacional', 'cadastros', 'meus-dados'],
  sellerFinder: ['meus-dados'],
  everything: ['tatico', 'operacional', 'cadastros', 'meus-dados'],
};

const DEFAULT_PATH_FULL: Record<ComboName, string> = {
  none: '/tatico/dashboard',
  admin: '/tatico/dashboard',
  seller: '/meus-dados/vendedores',
  finder: '/meus-dados/finders',
  adminSeller: '/tatico/dashboard',
  adminFinder: '/tatico/dashboard',
  sellerFinder: '/meus-dados/vendedores',
  everything: '/tatico/dashboard',
};

/** Preferred workspace order: tatico, operacional, cadastros, meus-dados. */
const PREFERRED_PATH_FULL: Record<ComboName, [string, string, string, string]> = {
  none: ['/tatico/dashboard', '/tatico/dashboard', '/tatico/dashboard', '/tatico/dashboard'],
  admin: ['/tatico/dashboard', '/operacional/vendas', '/cadastros/produtos', '/tatico/dashboard'],
  seller: ['/meus-dados/vendedores', '/meus-dados/vendedores', '/meus-dados/vendedores', '/meus-dados/vendedores'],
  finder: ['/meus-dados/finders', '/meus-dados/finders', '/meus-dados/finders', '/meus-dados/finders'],
  adminSeller: ['/tatico/dashboard', '/operacional/vendas', '/cadastros/produtos', '/meus-dados/vendedores'],
  adminFinder: ['/tatico/dashboard', '/operacional/vendas', '/cadastros/produtos', '/meus-dados/finders'],
  sellerFinder: ['/meus-dados/vendedores', '/meus-dados/vendedores', '/meus-dados/vendedores', '/meus-dados/vendedores'],
  everything: ['/tatico/dashboard', '/operacional/vendas', '/cadastros/produtos', '/meus-dados/vendedores'],
};

/** Role-independent team workspaces: the role set is ignored for these three. */
const TEAM_NAV_FULL: Record<'tatico' | 'operacional' | 'cadastros', Array<[SalesOpsView, string]>> = {
  'tatico': [['dashboard', 'Visão geral']],
  'operacional': [['vendas', 'Propostas'], ['comissoes', 'Comissões'], ['leads', 'Prospecção']],
  'cadastros': [['produtos', 'Produtos & Serviços'], ['areas', 'Áreas'], ['clientes', 'Clientes'], ['pessoas', 'Pessoas'], ['funcoes', 'Funções'], ['etapas', 'Etapas do funil'], ['importacao', 'Importação'], ['geral', 'Geral']],
};

const MEUS_DADOS_NAV_FULL: Record<ComboName, Array<[SalesOpsView, string]>> = {
  none: [],
  admin: [],
  seller: [['vendedores', 'Meu painel'], ['comissoes', 'Comissões'], ['leads', 'Minha prospecção']],
  finder: [['finders', 'Meu painel'], ['vendas', 'Indicações']],
  adminSeller: [['vendedores', 'Meu painel'], ['comissoes', 'Comissões'], ['leads', 'Minha prospecção']],
  adminFinder: [['finders', 'Meu painel'], ['vendas', 'Indicações']],
  sellerFinder: [['vendedores', 'Meu painel'], ['comissoes', 'Comissões'], ['leads', 'Minha prospecção'], ['finders', 'Meu painel'], ['vendas', 'Indicações']],
  everything: [['vendedores', 'Meu painel'], ['comissoes', 'Comissões'], ['leads', 'Minha prospecção'], ['finders', 'Meu painel'], ['vendas', 'Indicações']],
};

/** url -> [resolved path, redirect]. */
const RESOLVE_FULL: Record<ComboName, Record<string, [string, boolean]>> = {
  none: {
    '/tatico/dashboard': ['/tatico/dashboard', true],
    '/operacional/vendas': ['/tatico/dashboard', true],
    '/operacional/comissoes': ['/tatico/dashboard', true],
    '/operacional/leads': ['/tatico/dashboard', true],
    '/cadastros/produtos': ['/tatico/dashboard', true],
    '/cadastros/pessoas': ['/tatico/dashboard', true],
    '/cadastros/vendedores': ['/tatico/dashboard', true],
    '/cadastros/etapas': ['/tatico/dashboard', true],
    '/cadastros/importacao': ['/tatico/dashboard', true],
    '/cadastros/geral': ['/tatico/dashboard', true],
    '/meus-dados/vendedores': ['/tatico/dashboard', true],
    '/meus-dados/comissoes': ['/tatico/dashboard', true],
    '/meus-dados/leads': ['/tatico/dashboard', true],
    '/meus-dados/finders': ['/tatico/dashboard', true],
    '/meus-dados/vendas': ['/tatico/dashboard', true],
  },
  admin: {
    '/tatico/dashboard': ['/tatico/dashboard', false],
    '/operacional/vendas': ['/operacional/vendas', false],
    '/operacional/comissoes': ['/operacional/comissoes', false],
    '/operacional/leads': ['/operacional/leads', false],
    '/cadastros/produtos': ['/cadastros/produtos', false],
    '/cadastros/pessoas': ['/cadastros/pessoas', false],
    '/cadastros/vendedores': ['/cadastros/pessoas', true],
    '/cadastros/etapas': ['/cadastros/etapas', false],
    '/cadastros/importacao': ['/cadastros/importacao', false],
    '/cadastros/geral': ['/cadastros/geral', false],
    '/meus-dados/vendedores': ['/tatico/dashboard', true],
    '/meus-dados/comissoes': ['/tatico/dashboard', true],
    '/meus-dados/leads': ['/tatico/dashboard', true],
    '/meus-dados/finders': ['/tatico/dashboard', true],
    '/meus-dados/vendas': ['/tatico/dashboard', true],
  },
  seller: {
    '/tatico/dashboard': ['/meus-dados/vendedores', true],
    '/operacional/vendas': ['/meus-dados/vendedores', true],
    '/operacional/comissoes': ['/meus-dados/vendedores', true],
    '/operacional/leads': ['/meus-dados/vendedores', true],
    '/cadastros/produtos': ['/meus-dados/vendedores', true],
    '/cadastros/pessoas': ['/meus-dados/vendedores', true],
    '/cadastros/vendedores': ['/meus-dados/vendedores', true],
    '/cadastros/etapas': ['/meus-dados/vendedores', true],
    '/cadastros/importacao': ['/meus-dados/vendedores', true],
    '/cadastros/geral': ['/meus-dados/vendedores', true],
    '/meus-dados/vendedores': ['/meus-dados/vendedores', false],
    '/meus-dados/comissoes': ['/meus-dados/comissoes', false],
    '/meus-dados/leads': ['/meus-dados/leads', false],
    '/meus-dados/finders': ['/meus-dados/vendedores', true],
    '/meus-dados/vendas': ['/meus-dados/vendedores', true],
  },
  finder: {
    '/tatico/dashboard': ['/meus-dados/finders', true],
    '/operacional/vendas': ['/meus-dados/finders', true],
    '/operacional/comissoes': ['/meus-dados/finders', true],
    '/operacional/leads': ['/meus-dados/finders', true],
    '/cadastros/produtos': ['/meus-dados/finders', true],
    '/cadastros/pessoas': ['/meus-dados/finders', true],
    '/cadastros/vendedores': ['/meus-dados/finders', true],
    '/cadastros/etapas': ['/meus-dados/finders', true],
    '/cadastros/importacao': ['/meus-dados/finders', true],
    '/cadastros/geral': ['/meus-dados/finders', true],
    '/meus-dados/vendedores': ['/meus-dados/finders', true],
    '/meus-dados/comissoes': ['/meus-dados/finders', true],
    '/meus-dados/leads': ['/meus-dados/finders', true],
    '/meus-dados/finders': ['/meus-dados/finders', false],
    '/meus-dados/vendas': ['/meus-dados/vendas', false],
  },
  adminSeller: {
    '/tatico/dashboard': ['/tatico/dashboard', false],
    '/operacional/vendas': ['/operacional/vendas', false],
    '/operacional/comissoes': ['/operacional/comissoes', false],
    '/operacional/leads': ['/operacional/leads', false],
    '/cadastros/produtos': ['/cadastros/produtos', false],
    '/cadastros/pessoas': ['/cadastros/pessoas', false],
    '/cadastros/vendedores': ['/cadastros/pessoas', true],
    '/cadastros/etapas': ['/cadastros/etapas', false],
    '/cadastros/importacao': ['/cadastros/importacao', false],
    '/cadastros/geral': ['/cadastros/geral', false],
    '/meus-dados/vendedores': ['/meus-dados/vendedores', false],
    '/meus-dados/comissoes': ['/meus-dados/comissoes', false],
    '/meus-dados/leads': ['/meus-dados/leads', false],
    '/meus-dados/finders': ['/tatico/dashboard', true],
    '/meus-dados/vendas': ['/tatico/dashboard', true],
  },
  adminFinder: {
    '/tatico/dashboard': ['/tatico/dashboard', false],
    '/operacional/vendas': ['/operacional/vendas', false],
    '/operacional/comissoes': ['/operacional/comissoes', false],
    '/operacional/leads': ['/operacional/leads', false],
    '/cadastros/produtos': ['/cadastros/produtos', false],
    '/cadastros/pessoas': ['/cadastros/pessoas', false],
    '/cadastros/vendedores': ['/cadastros/pessoas', true],
    '/cadastros/etapas': ['/cadastros/etapas', false],
    '/cadastros/importacao': ['/cadastros/importacao', false],
    '/cadastros/geral': ['/cadastros/geral', false],
    '/meus-dados/vendedores': ['/tatico/dashboard', true],
    '/meus-dados/comissoes': ['/tatico/dashboard', true],
    '/meus-dados/leads': ['/tatico/dashboard', true],
    '/meus-dados/finders': ['/meus-dados/finders', false],
    '/meus-dados/vendas': ['/meus-dados/vendas', false],
  },
  sellerFinder: {
    '/tatico/dashboard': ['/meus-dados/vendedores', true],
    '/operacional/vendas': ['/meus-dados/vendedores', true],
    '/operacional/comissoes': ['/meus-dados/vendedores', true],
    '/operacional/leads': ['/meus-dados/vendedores', true],
    '/cadastros/produtos': ['/meus-dados/vendedores', true],
    '/cadastros/pessoas': ['/meus-dados/vendedores', true],
    '/cadastros/vendedores': ['/meus-dados/vendedores', true],
    '/cadastros/etapas': ['/meus-dados/vendedores', true],
    '/cadastros/importacao': ['/meus-dados/vendedores', true],
    '/cadastros/geral': ['/meus-dados/vendedores', true],
    '/meus-dados/vendedores': ['/meus-dados/vendedores', false],
    '/meus-dados/comissoes': ['/meus-dados/comissoes', false],
    '/meus-dados/leads': ['/meus-dados/leads', false],
    '/meus-dados/finders': ['/meus-dados/finders', false],
    '/meus-dados/vendas': ['/meus-dados/vendas', false],
  },
  everything: {
    '/tatico/dashboard': ['/tatico/dashboard', false],
    '/operacional/vendas': ['/operacional/vendas', false],
    '/operacional/comissoes': ['/operacional/comissoes', false],
    '/operacional/leads': ['/operacional/leads', false],
    '/cadastros/produtos': ['/cadastros/produtos', false],
    '/cadastros/pessoas': ['/cadastros/pessoas', false],
    '/cadastros/vendedores': ['/cadastros/pessoas', true],
    '/cadastros/etapas': ['/cadastros/etapas', false],
    '/cadastros/importacao': ['/cadastros/importacao', false],
    '/cadastros/geral': ['/cadastros/geral', false],
    '/meus-dados/vendedores': ['/meus-dados/vendedores', false],
    '/meus-dados/comissoes': ['/meus-dados/comissoes', false],
    '/meus-dados/leads': ['/meus-dados/leads', false],
    '/meus-dados/finders': ['/meus-dados/finders', false],
    '/meus-dados/vendas': ['/meus-dados/vendas', false],
  },
};

const WORKSPACE_FOR_VIEW_FULL: Record<ComboName, Partial<Record<SalesOpsView, SalesOpsWorkspace>>> = {
  none: { dashboard: 'tatico', vendas: 'tatico', comissoes: 'tatico', leads: 'tatico', produtos: 'tatico', pessoas: 'tatico', etapas: 'tatico', vendedores: 'tatico', finders: 'tatico' },
  admin: { dashboard: 'tatico', vendas: 'operacional', comissoes: 'operacional', leads: 'operacional', produtos: 'cadastros', pessoas: 'cadastros', etapas: 'cadastros', vendedores: 'tatico', finders: 'tatico' },
  seller: { dashboard: 'meus-dados', vendas: 'meus-dados', comissoes: 'meus-dados', leads: 'meus-dados', produtos: 'meus-dados', pessoas: 'meus-dados', etapas: 'meus-dados', vendedores: 'meus-dados', finders: 'meus-dados' },
  finder: { dashboard: 'meus-dados', vendas: 'meus-dados', comissoes: 'meus-dados', leads: 'meus-dados', produtos: 'meus-dados', pessoas: 'meus-dados', etapas: 'meus-dados', vendedores: 'meus-dados', finders: 'meus-dados' },
  adminSeller: { dashboard: 'tatico', vendas: 'operacional', comissoes: 'operacional', leads: 'operacional', produtos: 'cadastros', pessoas: 'cadastros', etapas: 'cadastros', vendedores: 'meus-dados', finders: 'tatico' },
  adminFinder: { dashboard: 'tatico', vendas: 'operacional', comissoes: 'operacional', leads: 'operacional', produtos: 'cadastros', pessoas: 'cadastros', etapas: 'cadastros', vendedores: 'tatico', finders: 'meus-dados' },
  sellerFinder: { dashboard: 'meus-dados', vendas: 'meus-dados', comissoes: 'meus-dados', leads: 'meus-dados', produtos: 'meus-dados', pessoas: 'meus-dados', etapas: 'meus-dados', vendedores: 'meus-dados', finders: 'meus-dados' },
  everything: { dashboard: 'tatico', vendas: 'operacional', comissoes: 'operacional', leads: 'operacional', produtos: 'cadastros', pessoas: 'cadastros', etapas: 'cadastros', vendedores: 'meus-dados', finders: 'meus-dados' },
};

const VISIBLE_LEADS: Record<ComboName, SalesOpsWorkspace[]> = {
  none: [],
  admin: ['operacional', 'cadastros'],
  seller: ['meus-dados'],
  finder: [],
  adminSeller: ['operacional', 'cadastros'],
  adminFinder: ['operacional', 'cadastros'],
  sellerFinder: ['meus-dados'],
  everything: ['operacional', 'cadastros'],
};

const DEFAULT_PATH_LEADS: Record<ComboName, string> = {
  none: '/tatico/dashboard',
  admin: '/operacional/leads',
  seller: '/meus-dados/leads',
  finder: '/tatico/dashboard',
  adminSeller: '/operacional/leads',
  adminFinder: '/operacional/leads',
  sellerFinder: '/meus-dados/leads',
  everything: '/operacional/leads',
};

/** Preferred workspace order: tatico, operacional, cadastros, meus-dados. */
const PREFERRED_PATH_LEADS: Record<ComboName, [string, string, string, string]> = {
  none: ['/tatico/dashboard', '/tatico/dashboard', '/tatico/dashboard', '/tatico/dashboard'],
  admin: ['/operacional/leads', '/operacional/leads', '/cadastros/pessoas', '/operacional/leads'],
  seller: ['/meus-dados/leads', '/meus-dados/leads', '/meus-dados/leads', '/meus-dados/leads'],
  finder: ['/tatico/dashboard', '/tatico/dashboard', '/tatico/dashboard', '/tatico/dashboard'],
  adminSeller: ['/operacional/leads', '/operacional/leads', '/cadastros/pessoas', '/operacional/leads'],
  adminFinder: ['/operacional/leads', '/operacional/leads', '/cadastros/pessoas', '/operacional/leads'],
  sellerFinder: ['/meus-dados/leads', '/meus-dados/leads', '/meus-dados/leads', '/meus-dados/leads'],
  everything: ['/operacional/leads', '/operacional/leads', '/cadastros/pessoas', '/operacional/leads'],
};

/** Role-independent team workspaces: the role set is ignored for these three. */
const TEAM_NAV_LEADS: Record<'tatico' | 'operacional' | 'cadastros', Array<[SalesOpsView, string]>> = {
  'tatico': [],
  'operacional': [['leads', 'Prospecção']],
  'cadastros': [['pessoas', 'Vendedores'], ['etapas', 'Etapas do funil']],
};

const MEUS_DADOS_NAV_LEADS: Record<ComboName, Array<[SalesOpsView, string]>> = {
  none: [],
  admin: [],
  seller: [['leads', 'Minha prospecção']],
  finder: [],
  adminSeller: [['leads', 'Minha prospecção']],
  adminFinder: [],
  sellerFinder: [['leads', 'Minha prospecção']],
  everything: [['leads', 'Minha prospecção']],
};

/** url -> [resolved path, redirect]. */
const RESOLVE_LEADS: Record<ComboName, Record<string, [string, boolean]>> = {
  none: {
    '/tatico/dashboard': ['/tatico/dashboard', true],
    '/operacional/vendas': ['/tatico/dashboard', true],
    '/operacional/comissoes': ['/tatico/dashboard', true],
    '/operacional/leads': ['/tatico/dashboard', true],
    '/cadastros/produtos': ['/tatico/dashboard', true],
    '/cadastros/pessoas': ['/tatico/dashboard', true],
    '/cadastros/vendedores': ['/tatico/dashboard', true],
    '/cadastros/etapas': ['/tatico/dashboard', true],
    '/cadastros/importacao': ['/tatico/dashboard', true],
    '/cadastros/geral': ['/tatico/dashboard', true],
    '/meus-dados/vendedores': ['/tatico/dashboard', true],
    '/meus-dados/comissoes': ['/tatico/dashboard', true],
    '/meus-dados/leads': ['/tatico/dashboard', true],
    '/meus-dados/finders': ['/tatico/dashboard', true],
    '/meus-dados/vendas': ['/tatico/dashboard', true],
  },
  admin: {
    '/tatico/dashboard': ['/operacional/leads', true],
    '/operacional/vendas': ['/operacional/leads', true],
    '/operacional/comissoes': ['/operacional/leads', true],
    '/operacional/leads': ['/operacional/leads', false],
    '/cadastros/produtos': ['/operacional/leads', true],
    '/cadastros/pessoas': ['/cadastros/pessoas', false],
    '/cadastros/vendedores': ['/cadastros/pessoas', true],
    '/cadastros/etapas': ['/cadastros/etapas', false],
    '/cadastros/importacao': ['/operacional/leads', true],
    '/cadastros/geral': ['/operacional/leads', true],
    '/meus-dados/vendedores': ['/operacional/leads', true],
    '/meus-dados/comissoes': ['/operacional/leads', true],
    '/meus-dados/leads': ['/operacional/leads', true],
    '/meus-dados/finders': ['/operacional/leads', true],
    '/meus-dados/vendas': ['/operacional/leads', true],
  },
  seller: {
    '/tatico/dashboard': ['/meus-dados/leads', true],
    '/operacional/vendas': ['/meus-dados/leads', true],
    '/operacional/comissoes': ['/meus-dados/leads', true],
    '/operacional/leads': ['/meus-dados/leads', true],
    '/cadastros/produtos': ['/meus-dados/leads', true],
    '/cadastros/pessoas': ['/meus-dados/leads', true],
    '/cadastros/vendedores': ['/meus-dados/leads', true],
    '/cadastros/etapas': ['/meus-dados/leads', true],
    '/cadastros/importacao': ['/meus-dados/leads', true],
    '/cadastros/geral': ['/meus-dados/leads', true],
    '/meus-dados/vendedores': ['/meus-dados/leads', true],
    '/meus-dados/comissoes': ['/meus-dados/leads', true],
    '/meus-dados/leads': ['/meus-dados/leads', false],
    '/meus-dados/finders': ['/meus-dados/leads', true],
    '/meus-dados/vendas': ['/meus-dados/leads', true],
  },
  finder: {
    '/tatico/dashboard': ['/tatico/dashboard', true],
    '/operacional/vendas': ['/tatico/dashboard', true],
    '/operacional/comissoes': ['/tatico/dashboard', true],
    '/operacional/leads': ['/tatico/dashboard', true],
    '/cadastros/produtos': ['/tatico/dashboard', true],
    '/cadastros/pessoas': ['/tatico/dashboard', true],
    '/cadastros/vendedores': ['/tatico/dashboard', true],
    '/cadastros/etapas': ['/tatico/dashboard', true],
    '/cadastros/importacao': ['/tatico/dashboard', true],
    '/cadastros/geral': ['/tatico/dashboard', true],
    '/meus-dados/vendedores': ['/tatico/dashboard', true],
    '/meus-dados/comissoes': ['/tatico/dashboard', true],
    '/meus-dados/leads': ['/tatico/dashboard', true],
    '/meus-dados/finders': ['/tatico/dashboard', true],
    '/meus-dados/vendas': ['/tatico/dashboard', true],
  },
  adminSeller: {
    '/tatico/dashboard': ['/operacional/leads', true],
    '/operacional/vendas': ['/operacional/leads', true],
    '/operacional/comissoes': ['/operacional/leads', true],
    '/operacional/leads': ['/operacional/leads', false],
    '/cadastros/produtos': ['/operacional/leads', true],
    '/cadastros/pessoas': ['/cadastros/pessoas', false],
    '/cadastros/vendedores': ['/cadastros/pessoas', true],
    '/cadastros/etapas': ['/cadastros/etapas', false],
    '/cadastros/importacao': ['/operacional/leads', true],
    '/cadastros/geral': ['/operacional/leads', true],
    '/meus-dados/vendedores': ['/operacional/leads', true],
    '/meus-dados/comissoes': ['/operacional/leads', true],
    '/meus-dados/leads': ['/operacional/leads', true],
    '/meus-dados/finders': ['/operacional/leads', true],
    '/meus-dados/vendas': ['/operacional/leads', true],
  },
  adminFinder: {
    '/tatico/dashboard': ['/operacional/leads', true],
    '/operacional/vendas': ['/operacional/leads', true],
    '/operacional/comissoes': ['/operacional/leads', true],
    '/operacional/leads': ['/operacional/leads', false],
    '/cadastros/produtos': ['/operacional/leads', true],
    '/cadastros/pessoas': ['/cadastros/pessoas', false],
    '/cadastros/vendedores': ['/cadastros/pessoas', true],
    '/cadastros/etapas': ['/cadastros/etapas', false],
    '/cadastros/importacao': ['/operacional/leads', true],
    '/cadastros/geral': ['/operacional/leads', true],
    '/meus-dados/vendedores': ['/operacional/leads', true],
    '/meus-dados/comissoes': ['/operacional/leads', true],
    '/meus-dados/leads': ['/operacional/leads', true],
    '/meus-dados/finders': ['/operacional/leads', true],
    '/meus-dados/vendas': ['/operacional/leads', true],
  },
  sellerFinder: {
    '/tatico/dashboard': ['/meus-dados/leads', true],
    '/operacional/vendas': ['/meus-dados/leads', true],
    '/operacional/comissoes': ['/meus-dados/leads', true],
    '/operacional/leads': ['/meus-dados/leads', true],
    '/cadastros/produtos': ['/meus-dados/leads', true],
    '/cadastros/pessoas': ['/meus-dados/leads', true],
    '/cadastros/vendedores': ['/meus-dados/leads', true],
    '/cadastros/etapas': ['/meus-dados/leads', true],
    '/cadastros/importacao': ['/meus-dados/leads', true],
    '/cadastros/geral': ['/meus-dados/leads', true],
    '/meus-dados/vendedores': ['/meus-dados/leads', true],
    '/meus-dados/comissoes': ['/meus-dados/leads', true],
    '/meus-dados/leads': ['/meus-dados/leads', false],
    '/meus-dados/finders': ['/meus-dados/leads', true],
    '/meus-dados/vendas': ['/meus-dados/leads', true],
  },
  everything: {
    '/tatico/dashboard': ['/operacional/leads', true],
    '/operacional/vendas': ['/operacional/leads', true],
    '/operacional/comissoes': ['/operacional/leads', true],
    '/operacional/leads': ['/operacional/leads', false],
    '/cadastros/produtos': ['/operacional/leads', true],
    '/cadastros/pessoas': ['/cadastros/pessoas', false],
    '/cadastros/vendedores': ['/cadastros/pessoas', true],
    '/cadastros/etapas': ['/cadastros/etapas', false],
    '/cadastros/importacao': ['/operacional/leads', true],
    '/cadastros/geral': ['/operacional/leads', true],
    '/meus-dados/vendedores': ['/operacional/leads', true],
    '/meus-dados/comissoes': ['/operacional/leads', true],
    '/meus-dados/leads': ['/operacional/leads', true],
    '/meus-dados/finders': ['/operacional/leads', true],
    '/meus-dados/vendas': ['/operacional/leads', true],
  },
};

const WORKSPACE_FOR_VIEW_LEADS: Record<ComboName, Partial<Record<SalesOpsView, SalesOpsWorkspace>>> = {
  none: { dashboard: 'tatico', vendas: 'tatico', comissoes: 'tatico', leads: 'tatico', produtos: 'tatico', pessoas: 'tatico', etapas: 'tatico', vendedores: 'tatico', finders: 'tatico' },
  admin: { dashboard: 'operacional', vendas: 'operacional', comissoes: 'operacional', leads: 'operacional', produtos: 'operacional', pessoas: 'cadastros', etapas: 'cadastros', vendedores: 'operacional', finders: 'operacional' },
  seller: { dashboard: 'meus-dados', vendas: 'meus-dados', comissoes: 'meus-dados', leads: 'meus-dados', produtos: 'meus-dados', pessoas: 'meus-dados', etapas: 'meus-dados', vendedores: 'meus-dados', finders: 'meus-dados' },
  finder: { dashboard: 'tatico', vendas: 'tatico', comissoes: 'tatico', leads: 'tatico', produtos: 'tatico', pessoas: 'tatico', etapas: 'tatico', vendedores: 'tatico', finders: 'tatico' },
  adminSeller: { dashboard: 'operacional', vendas: 'operacional', comissoes: 'operacional', leads: 'operacional', produtos: 'operacional', pessoas: 'cadastros', etapas: 'cadastros', vendedores: 'operacional', finders: 'operacional' },
  adminFinder: { dashboard: 'operacional', vendas: 'operacional', comissoes: 'operacional', leads: 'operacional', produtos: 'operacional', pessoas: 'cadastros', etapas: 'cadastros', vendedores: 'operacional', finders: 'operacional' },
  sellerFinder: { dashboard: 'meus-dados', vendas: 'meus-dados', comissoes: 'meus-dados', leads: 'meus-dados', produtos: 'meus-dados', pessoas: 'meus-dados', etapas: 'meus-dados', vendedores: 'meus-dados', finders: 'meus-dados' },
  everything: { dashboard: 'operacional', vendas: 'operacional', comissoes: 'operacional', leads: 'operacional', produtos: 'operacional', pessoas: 'cadastros', etapas: 'cadastros', vendedores: 'operacional', finders: 'operacional' },
};

/** `undefined` is the call with NO edition argument; it must equal 'full' and today. */
const FULL_CALLS = [undefined, 'full'] as const;

describe('full edition is exactly today (FXL)', () => {
  it('keeps the workspace catalogue object and literals', () => {
    expect(getSalesOpsWorkspaces()).toBe(salesOpsWorkspaces);
    expect(getSalesOpsWorkspaces('full')).toBe(salesOpsWorkspaces);
    expect(salesOpsWorkspaces).toEqual([
      { id: 'tatico', label: 'Tático', description: 'Indicadores e painéis' },
      { id: 'operacional', label: 'Operacional', description: 'Propostas e conferência' },
      { id: 'cadastros', label: 'Cadastros', description: 'Pessoas, catálogo e regras' },
      { id: 'meus-dados', label: 'Meus dados', description: 'Painel e comissões pessoais' },
    ]);
  });

  for (const edition of FULL_CALLS) {
    describe(`edition argument ${String(edition)}`, () => {
      it.each(COMBO_NAMES)('visible workspaces for %s', (name) => {
        expect(getVisibleWorkspaces(COMBOS[name], edition)).toEqual(VISIBLE_FULL[name]);
      });
      it.each(COMBO_NAMES)('navigation for %s', (name) => {
        for (const workspace of TEAM_WORKSPACES) {
          expect(pairs(getSalesOpsNavigation(workspace, COMBOS[name], edition))).toEqual(
            TEAM_NAV_FULL[workspace],
          );
        }
        expect(pairs(getSalesOpsNavigation('meus-dados', COMBOS[name], edition))).toEqual(
          MEUS_DADOS_NAV_FULL[name],
        );
      });
      it.each(COMBO_NAMES)('default route for %s, with and without a preferred workspace', (name) => {
        expect(buildSalesOpsPath(getDefaultSalesOpsRoute(COMBOS[name], undefined, edition))).toBe(
          DEFAULT_PATH_FULL[name],
        );
        WORKSPACES.forEach((workspace, index) => {
          expect(
            buildSalesOpsPath(getDefaultSalesOpsRoute(COMBOS[name], workspace, edition)),
          ).toBe(PREFERRED_PATH_FULL[name][index]);
        });
      });
      it.each(COMBO_NAMES)('resolves every URL for %s', (name) => {
        for (const url of URLS) {
          const resolution = resolveSalesOpsRoute(params(url), COMBOS[name], edition);
          expect([resolution.path, resolution.redirect]).toEqual(RESOLVE_FULL[name][url]);
        }
      });
      it.each(COMBO_NAMES)('workspaceForView for %s', (name) => {
        for (const [view, workspace] of Object.entries(WORKSPACE_FOR_VIEW_FULL[name])) {
          expect(workspaceForView(view as SalesOpsView, COMBOS[name], edition)).toBe(workspace);
        }
      });
      it('settles exactly as before', () => {
        expect(canSettleInWorkspace('operacional', ['admin'], edition)).toBe(true);
        expect(canSettleInWorkspace('operacional', ['seller'], edition)).toBe(false);
        expect(canSettleInWorkspace('meus-dados', ['admin'], edition)).toBe(false);
      });
    });
  }
});

describe('leads edition (Construbom)', () => {
  it.each(COMBO_NAMES)('visible workspaces for %s', (name) => {
    expect(getVisibleWorkspaces(COMBOS[name], 'leads')).toEqual(VISIBLE_LEADS[name]);
  });
  it.each(COMBO_NAMES)('navigation for %s', (name) => {
    for (const workspace of TEAM_WORKSPACES) {
      expect(pairs(getSalesOpsNavigation(workspace, COMBOS[name], 'leads'))).toEqual(
        TEAM_NAV_LEADS[workspace],
      );
    }
    expect(pairs(getSalesOpsNavigation('meus-dados', COMBOS[name], 'leads'))).toEqual(
      MEUS_DADOS_NAV_LEADS[name],
    );
  });
  it.each(COMBO_NAMES)('default route for %s', (name) => {
    expect(buildSalesOpsPath(getDefaultSalesOpsRoute(COMBOS[name], undefined, 'leads'))).toBe(
      DEFAULT_PATH_LEADS[name],
    );
    WORKSPACES.forEach((workspace, index) => {
      expect(buildSalesOpsPath(getDefaultSalesOpsRoute(COMBOS[name], workspace, 'leads'))).toBe(
        PREFERRED_PATH_LEADS[name][index],
      );
    });
  });
  it.each(COMBO_NAMES)('resolves every URL for %s, redirecting all others to the role default', (name) => {
    for (const url of URLS) {
      const resolution = resolveSalesOpsRoute(params(url), COMBOS[name], 'leads');
      expect([resolution.path, resolution.redirect]).toEqual(RESOLVE_LEADS[name][url]);
    }
  });
  it.each(COMBO_NAMES)('workspaceForView for %s', (name) => {
    for (const [view, workspace] of Object.entries(WORKSPACE_FOR_VIEW_LEADS[name])) {
      expect(workspaceForView(view as SalesOpsView, COMBOS[name], 'leads')).toBe(workspace);
    }
  });
  it('drops a proposta id: there is no vendas view', () => {
    const resolution = resolveSalesOpsRoute(
      { workspace: 'operacional', view: 'vendas', saleId: '5b0e7c1e-3f4a-4c2d-9e8b-1a2b3c4d5e6f' },
      ['admin', 'seller', 'finder'],
      'leads',
    );
    expect(resolution).toEqual({
      route: { workspace: 'operacional', view: 'leads' },
      path: '/operacional/leads',
      redirect: true,
    });
    expect('saleId' in resolution.route).toBe(false);
  });
  it('never settles', () => {
    expect(canSettleInWorkspace('operacional', ['admin'], 'leads')).toBe(false);
  });
});

describe('leads edition labels', () => {
  it('describes operacional as Prospecção and changes nothing else in the catalogue', () => {
    expect(getSalesOpsWorkspaces('leads')).toEqual([
      { id: 'tatico', label: 'Tático', description: 'Indicadores e painéis' },
      { id: 'operacional', label: 'Operacional', description: 'Prospecção' },
      { id: 'cadastros', label: 'Cadastros', description: 'Pessoas, catálogo e regras' },
      { id: 'meus-dados', label: 'Meus dados', description: 'Painel e comissões pessoais' },
    ]);
    // The full catalogue object was not mutated by building the leads one.
    expect(salesOpsWorkspaces[1]).toEqual({
      id: 'operacional',
      label: 'Operacional',
      description: 'Propostas e conferência',
    });
  });
  it('labels the pessoas screen Vendedores only in the leads edition', () => {
    const leadsLabel = getSalesOpsNavigation('cadastros', ['admin'], 'leads').find(
      (item) => item.id === 'pessoas',
    )?.label;
    const fullLabel = getSalesOpsNavigation('cadastros', ['admin']).find(
      (item) => item.id === 'pessoas',
    )?.label;
    expect(leadsLabel).toBe('Vendedores');
    expect(fullLabel).toBe('Pessoas');
  });
  it('keeps Prospecção and Minha prospecção as the lead screen labels', () => {
    expect(getSalesOpsNavigation('operacional', ['admin'], 'leads')[0]?.label).toBe('Prospecção');
    expect(getSalesOpsNavigation('meus-dados', ['seller'], 'leads')[0]?.label).toBe(
      'Minha prospecção',
    );
  });
});
