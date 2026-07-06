import { Hono } from 'hono';
import { appAuthMiddleware } from '../../middleware/app-auth.js';
import { requireAdmin } from '../../middleware/require-admin.js';
import { adminAppsRouter } from './apps/routes.js';
import { adminProductsRouter } from './products/routes.js';
import { findersAdminRouter } from '../finders/admin-routes.js';
import { sellersAdminRouter } from '../sellers/admin-routes.js';

/**
 * Admin router mount point (Phase 02, T02).
 *
 * Admin auth is ONE mechanism (D-B):
 *   1. appAuthMiddleware verifies the token and sets c.get('userRole').
 *   2. requireAdmin (Phase 01-owned, shared) reads c.get('userRole') === 'admin'.
 * There is NO adminAuth.ts / adminAuthMiddleware / isAdmin var.
 *
 * Admin tables (apps/products/price_bands/commission_rules) have NO RLS - the
 * sub-routers use getAdminDb() and NEVER call setTenantContext.
 */
export const adminRouter = new Hono();

adminRouter.use('*', appAuthMiddleware);
adminRouter.use('*', requireAdmin);

adminRouter.route('/apps', adminAppsRouter);
adminRouter.route('/products', adminProductsRouter);
// Phase 03: finders approval queue + sellers admin. finders is FORCE RLS - the
// service layer uses getAdminDb() (BYPASSRLS) for cross-tenant reads/writes (D-C).
adminRouter.route('/finders', findersAdminRouter);
adminRouter.route('/sellers', sellersAdminRouter);
