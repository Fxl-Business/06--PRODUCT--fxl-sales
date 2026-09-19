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
/**
 * Declared LOCALLY, and deliberately NOT imported from sales-ops/leads/types.ts:
 * this file is imported by `admin/`, `finder/` and `lib/` and must not grow an
 * edge into a sales-ops subtree. `sales-ops/leads/types.ts` exports a
 * structurally identical alias for its own consumers, exactly as
 * `CommissionFilters` duplicates its consumers' shape here.
 */
type LeadBoardFilters = { sellerPersonId?: string } | undefined;

export const queryKeys = {
  salesOps: {
    all: ['sales-ops'] as const,
    bootstrap: () => ['sales-ops', 'bootstrap'] as const,
    /*
      Nested under the `sales-ops` prefix on purpose: every sales-ops write already
      declares `invalidates: [queryKeys.salesOps.all]`, TanStack invalidates by
      prefix match, and so an archive performed on a list view refreshes the
      Configurações history without that mutation knowing the panel exists.
    */
    cadastroHistory: (limit: number) => ['sales-ops', 'cadastro-history', limit] as const,
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
  /**
   * Leads are deliberately a TOP-LEVEL root and NOT nested under `['sales-ops']`.
   *
   * Every sales-ops write declares `invalidates: [queryKeys.salesOps.all]`, and
   * TanStack invalidates by prefix match. Nesting the board there would make a
   * produto rename, an área archive and every other cadastro keystroke refetch a
   * paginated board of the highest-volume entity in the product - the exact cost
   * leads were given their own paginated endpoint to avoid.
   *
   * The separation is one-directional and intentional: a lead CONVERSION creates
   * a sale, so slice 08's conversion mutation lists BOTH `queryKeys.leads.all`
   * and `queryKeys.salesOps.all`, explicitly and type-checked, rather than
   * relying on a prefix that would also fire in the useless direction.
   *
   * Stages live under the same `['leads']` root on purpose: archiving a stage
   * removes a column, so one `invalidates: [queryKeys.leads.all]` refreshes the
   * cadastro list and the board together.
   *
   * Account- and org-agnostic, exactly like every key in this file: tenant
   * separation is `queryClient.clear()` on logout and on every completed
   * workspace switch (see apps/web/src/auth/react.tsx), never a key segment.
   */
  leads: {
    all: ['leads'] as const,
    board: (filters: LeadBoardFilters) => ['leads', 'board', filters ?? null] as const,
    stages: () => ['leads', 'stages'] as const,
  },
  finderClicks: {
    all: ['finder', 'clicks'] as const,
    list: (linkId?: string) => ['finder', 'clicks', 'list', linkId ?? 'all'] as const,
    stats: () => ['finder', 'clicks', 'stats'] as const,
  },
} as const;
