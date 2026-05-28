import { lazy } from 'react';
import { createBrowserRouter, Navigate, type RouteObject } from 'react-router-dom';
import { SignedIn, SignedOut, RedirectToSignIn } from '@clerk/clerk-react';
import { AdminShell } from './admin/layout/AdminShell';
import { FinderShell } from './components/layout/FinderShell';
import { SellerShell } from './components/layout/SellerShell';
import { RoleGuard, RoleRouter } from './components/auth/RoleGuard';
import { NoRolePage } from './pages/errors/NoRolePage';

// Lazy-loaded pages — low traffic, keeps the initial bundle small.
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
const FinderDashboardPage = lazy(() =>
  import('./finder/dashboard/FinderDashboardPage').then((m) => ({ default: m.FinderDashboardPage })),
);
const LinksPlaceholderPage = lazy(() =>
  import('./finder/links/LinksPlaceholderPage').then((m) => ({ default: m.LinksPlaceholderPage })),
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

const Protected = ({ children }: { children: React.ReactNode }) => (
  <>
    <SignedIn>{children}</SignedIn>
    <SignedOut>
      <RedirectToSignIn />
    </SignedOut>
  </>
);

const routes: RouteObject[] = [
  {
    path: '/',
    element: (
      <Protected>
        <RoleRouter />
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
      { path: 'payouts', element: <div>TBD Phase 06</div> },
      { path: 'audit', element: <div>TBD Phase 05</div> },
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
      { path: 'links', element: <LinksPlaceholderPage /> },
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
  { path: '*', element: <Navigate to="/" replace /> },
];

export const router: ReturnType<typeof createBrowserRouter> = createBrowserRouter(routes);
