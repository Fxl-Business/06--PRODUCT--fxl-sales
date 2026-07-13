/* eslint-disable react-refresh/only-export-components */
import { lazy } from 'react';
import { createBrowserRouter, Navigate, type RouteObject } from 'react-router-dom';
import { AdminShell } from './admin/layout/AdminShell';
import { FinderShell } from './components/layout/FinderShell';
import { SellerShell } from './components/layout/SellerShell';
import { RoleGuard } from './components/auth/RoleGuard';
import { NoRolePage } from './pages/errors/NoRolePage';
import { Protected } from './auth/react';
import { SalesOpsApp } from './sales-ops/SalesOpsApp';

// Lazy-loaded pages - low traffic, keeps the initial bundle small.
const AppsPage = lazy(() => import('./admin/apps/AppsPage').then((m) => ({ default: m.AppsPage })));
const ProductsPage = lazy(() =>
  import('./admin/products/ProductsPage').then((m) => ({ default: m.ProductsPage })),
);
const ProductDetailPage = lazy(() =>
  import('./admin/products/ProductDetailPage').then((m) => ({ default: m.ProductDetailPage })),
);
const AdminFindersPage = lazy(() =>
  import('./admin/finders/AdminFindersPage').then((m) => ({ default: m.AdminFindersPage })),
);
const AdminFinderDetailPage = lazy(() =>
  import('./admin/finders/AdminFinderDetailPage').then((m) => ({
    default: m.AdminFinderDetailPage,
  })),
);
const AdminSellersPage = lazy(() =>
  import('./admin/sellers/AdminSellersPage').then((m) => ({ default: m.AdminSellersPage })),
);
const ConversionsPage = lazy(() =>
  import('./admin/conversions/ConversionsPage').then((m) => ({ default: m.ConversionsPage })),
);
const CommissionsPage = lazy(() =>
  import('./admin/commissions/CommissionsPage').then((m) => ({ default: m.CommissionsPage })),
);
const AuditLogPage = lazy(() =>
  import('./admin/audit/AuditLogPage').then((m) => ({ default: m.AuditLogPage })),
);
const PayoutsPage = lazy(() =>
  import('./admin/payouts/PayoutsPage').then((m) => ({ default: m.PayoutsPage })),
);
const PayoutBatchesPage = lazy(() =>
  import('./admin/payouts/PayoutBatchesPage').then((m) => ({ default: m.PayoutBatchesPage })),
);
const FinderDashboardPage = lazy(() =>
  import('./finder/dashboard/FinderDashboardPage').then((m) => ({ default: m.FinderDashboardPage })),
);
const LinksPage = lazy(() =>
  import('./finder/links/LinksPage').then((m) => ({ default: m.LinksPage })),
);
const ClicksPage = lazy(() =>
  import('./finder/clicks/ClicksPage').then((m) => ({ default: m.ClicksPage })),
);
const CommissionsPlaceholderPage = lazy(() =>
  import('./finder/commissions/CommissionsPlaceholderPage').then((m) => ({
    default: m.CommissionsPlaceholderPage,
  })),
);
const PayoutsPlaceholderPage = lazy(() =>
  import('./finder/payouts/PayoutsPlaceholderPage').then((m) => ({
    default: m.PayoutsPlaceholderPage,
  })),
);
const SellerDealsPlaceholderPage = lazy(() =>
  import('./seller/deals/SellerDealsPlaceholderPage').then((m) => ({
    default: m.SellerDealsPlaceholderPage,
  })),
);

const routes: RouteObject[] = [
  {
    path: '/',
    element: (
      <Protected>
        <SalesOpsApp />
      </Protected>
    ),
  },
  // Admin shell
  {
    path: '/admin',
    element: (
      <Protected>
        <RoleGuard role="admin">
          <AdminShell />
        </RoleGuard>
      </Protected>
    ),
    children: [
      { index: true, element: <Navigate to="/admin/finders" replace /> },
      { path: 'apps', element: <AppsPage /> },
      { path: 'products', element: <ProductsPage /> },
      { path: 'products/:id', element: <ProductDetailPage /> },
      { path: 'finders', element: <AdminFindersPage /> },
      { path: 'finders/:id', element: <AdminFinderDetailPage /> },
      { path: 'sellers', element: <AdminSellersPage /> },
      { path: 'conversions', element: <ConversionsPage /> },
      { path: 'commissions', element: <CommissionsPage /> },
      { path: 'payouts', element: <PayoutsPage /> },
      { path: 'payouts/batches', element: <PayoutBatchesPage /> },
      { path: 'audit', element: <AuditLogPage /> },
    ],
  },
  // Finder shell
  {
    path: '/finder',
    element: (
      <Protected>
        <RoleGuard role="finder">
          <FinderShell />
        </RoleGuard>
      </Protected>
    ),
    children: [
      { index: true, element: <Navigate to="/finder/dashboard" replace /> },
      { path: 'dashboard', element: <FinderDashboardPage /> },
      { path: 'links', element: <LinksPage /> },
      { path: 'clicks', element: <ClicksPage /> },
      { path: 'commissions', element: <CommissionsPlaceholderPage /> },
      { path: 'payouts', element: <PayoutsPlaceholderPage /> },
    ],
  },
  // Seller shell
  {
    path: '/seller',
    element: (
      <Protected>
        <RoleGuard role="seller">
          <SellerShell />
        </RoleGuard>
      </Protected>
    ),
    children: [
      { index: true, element: <Navigate to="/seller/deals" replace /> },
      { path: 'deals', element: <SellerDealsPlaceholderPage /> },
    ],
  },
  {
    path: '/no-role',
    element: (
      <Protected>
        <NoRolePage />
      </Protected>
    ),
  },
  {
    path: '/:workspace/:view',
    element: (
      <Protected>
        <SalesOpsApp />
      </Protected>
    ),
  },
  { path: '*', element: <Navigate to="/" replace /> },
];

export const router: ReturnType<typeof createBrowserRouter> = createBrowserRouter(routes);
