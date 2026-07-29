import type { FinderStatus } from '@/admin/types';
import type { CommissionStatus } from '@/lib/api-client';

/**
 * The single repo-wide TanStack query-key factory. Every `useQuery` key and every
 * `useAppMutation` `invalidates` entry resolves through this object so invalidation
 * targets are declarative and impossible to typo, and so a list key can never
 * collide with a detail key (hence the explicit `'list'` / `'detail'` segments).
 *
 * `adminProducts.all` and `adminProducts.list()` are byte-identical to the keys
 * they replaced because src/admin/products/__tests__/useProducts.test.ts asserts
 * those tuples literally.
 */

type CommissionFilters = { status?: CommissionStatus; finderId?: string } | undefined;
type ConversionFilters = { source?: string; finderId?: string } | undefined;

export const queryKeys = {
  salesOps: {
    all: ['sales-ops'] as const,
    bootstrap: () => ['sales-ops', 'bootstrap'] as const,
  },
  adminApps: {
    all: ['admin', 'apps'] as const,
    list: () => ['admin', 'apps'] as const,
    detail: (id: string) => ['admin', 'apps', 'detail', id] as const,
  },
  adminProducts: {
    all: ['admin', 'products'] as const,
    // keep the `appId ?? 'all'` shape: useProducts.test.ts asserts it literally
    list: (appId?: string) => ['admin', 'products', appId ?? 'all'] as const,
    detail: (id: string) => ['admin', 'products', 'detail', id] as const,
  },
  adminSellers: {
    all: ['admin', 'sellers'] as const,
    list: () => ['admin', 'sellers'] as const,
  },
  adminFinders: {
    all: ['admin', 'finders'] as const,
    list: (status?: FinderStatus) => ['admin', 'finders', 'list', status ?? 'all'] as const,
    detail: (id: string) => ['admin', 'finders', 'detail', id] as const,
  },
  adminCommissions: {
    all: ['admin', 'commissions'] as const,
    list: (filters: CommissionFilters) => ['admin', 'commissions', 'list', filters ?? null] as const,
  },
  adminConversions: {
    all: ['admin', 'conversions'] as const,
    list: (filters: ConversionFilters) => ['admin', 'conversions', 'list', filters ?? null] as const,
  },
  adminAudit: {
    all: ['admin', 'audit'] as const,
    list: (page: number, action?: string) => ['admin', 'audit', 'list', page, action ?? 'all'] as const,
  },
  payouts: {
    all: ['payouts'] as const,
    findersReady: () => ['payouts', 'finders-ready'] as const,
    list: () => ['payouts', 'list'] as const,
  },
  finderLinks: {
    all: ['finder', 'links'] as const,
    list: () => ['finder', 'links'] as const,
  },
  finderCatalog: {
    all: ['finder', 'apps'] as const,
    apps: () => ['finder', 'apps'] as const,
    products: (appId?: string) => ['finder', 'apps', appId ?? 'all', 'products'] as const,
  },
  finderClicks: {
    all: ['finder', 'clicks'] as const,
    list: (linkId?: string) => ['finder', 'clicks', 'list', linkId ?? 'all'] as const,
    stats: () => ['finder', 'clicks', 'stats'] as const,
  },
} as const;
