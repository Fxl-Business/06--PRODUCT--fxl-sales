import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { logger } from 'hono/logger';
import { env } from './env.js';
import { corsMiddleware } from './middleware/cors.js';
import { errorMiddleware } from './middleware/error.js';
import { appAuthMiddleware, createAppAuthBff } from './middleware/app-auth.js';
import { requireAdmin } from './middleware/require-admin.js';
import { adminRouter } from './domains/admin/index.js';
import { findersPublicRouter } from './domains/finders/public-routes.js';
import { linksRouter } from './domains/links/routes.js';
import { referralsRouter } from './domains/referrals/routes.js';
import { finderRouter } from './domains/finder/routes.js';
import { hmacVerifyMiddleware } from './domains/conversions/hmac-middleware.js';
import { conversionsAdminRouter, conversionsRouter } from './domains/conversions/routes.js';
import { commissionsAdminRouter, commissionsRouter } from './domains/commissions/routes.js';
import { payoutsAdminRouter, payoutsRouter } from './domains/payouts/routes.js';
import { salesOpsRouter } from './domains/sales-ops/routes.js';
import { auditRouter } from './domains/audit/routes.js';
import { setupNightlyJob } from './jobs/nightly-job.js';
import { healthRouter } from './routes/health.js';

const app = new Hono();

app.use('*', logger());
app.use('*', corsMiddleware);
app.use('*', errorMiddleware);

app.route('/health', healthRouter);

const authBff = createAppAuthBff();
if (authBff) {
  app.route('', authBff);
}

// Public finder signup (Phase 03, D-R). NO auth middleware - a finder has no
// product account at signup. The handler writes via getAdminDb() (finders is FORCE
// RLS; org_id='' placeholder is invisible to the tenant policy).
app.route('/api/v1/finders', findersPublicRouter);

// ── Inbound conversion webhook (Phase 05 T06) ────────────────────────────────
// hmacVerifyMiddleware runs BEFORE body parse on the webhook POST paths (D-O/D-L).
// NOTE: it is NOT applied to /api/v1/conversions/admin (admin reconciliation read,
// gated by requireAdmin) - that router is mounted separately below.
app.use('/api/v1/conversions', hmacVerifyMiddleware);
app.use('/api/v1/conversions/refund', hmacVerifyMiddleware);
app.route('/api/v1/conversions', conversionsRouter);

// Admin conversions reconciliation read (D-C: getAdminDb(); requireAdmin; no HMAC).
app.use('/api/v1/admin/conversions/*', appAuthMiddleware, requireAdmin);
app.route('/api/v1/admin/conversions', conversionsAdminRouter);

// Admin domain (Phase 02 + Phase 03). appAuthMiddleware + requireAdmin applied
// INSIDE the admin router (D-B). Phase 03 adds /finders and /sellers under it.
app.route('/api/v1/admin', adminRouter);

// ── Commissions (Phase 05 T08) ───────────────────────────────────────────────
// Finder reads: getDb() + setTenantContext (D-D). Admin transitions: getAdminDb()
// with the admin session context (D-C). requireAdmin gates the admin sub-tree (D-B). NOTE: the admin
// group is mounted BEFORE the finder group so /admin/* never falls through to it.
app.use('/api/v1/admin/commissions/*', appAuthMiddleware, requireAdmin);
app.route('/api/v1/admin/commissions', commissionsAdminRouter);
app.use('/api/v1/commissions/*', appAuthMiddleware);
app.route('/api/v1/commissions', commissionsRouter);

// ── Payouts (Phase 05 T08, D-Q) ──────────────────────────────────────────────
app.use('/api/v1/admin/payouts/*', appAuthMiddleware, requireAdmin);
app.route('/api/v1/admin/payouts', payoutsAdminRouter);
app.use('/api/v1/payouts/*', appAuthMiddleware);
app.route('/api/v1/payouts', payoutsRouter);

// ── Sales operations app (prototype migration) ───────────────────────────────
// Authenticated workspace CRUD for the unified FXL Vendas shell.
app.use('/api/v1/sales-ops/*', appAuthMiddleware);
app.route('/api/v1/sales-ops', salesOpsRouter);

// ── Audit log viewer (Phase 05 T12) ──────────────────────────────────────────
app.use('/api/v1/admin/audit/*', appAuthMiddleware, requireAdmin);
app.route('/api/v1/admin/audit', auditRouter);

// Manual hold-promotion trigger (Phase 05 T09, D-K) lives ON the commissionsAdminRouter
// as POST /promote-locked -> resolves to POST /api/v1/admin/commissions/promote-locked
// (requireAdmin already applied to /api/v1/admin/commissions/* above).

// Finder-authed link generation (Phase 04, T05).
app.use('/api/v1/links/*', appAuthMiddleware);
app.route('/api/v1/links', linksRouter);

// Public referral redirect.
app.route('/r', referralsRouter);

// Finder-authed catalog + clicks reads (Phase 04, T05).
app.use('/api/v1/finder/*', appAuthMiddleware);
app.route('/api/v1/finder', finderRouter);

app.get('/', (c) =>
  c.json({
    name: 'Fxl Sales API',
    docs: '/health for liveness, add domain routes under apps/api/src/domains/',
  }),
);

app.notFound((c) => c.json({ error: 'not_found', path: c.req.path }, 404));

// Nightly hold-promotion cron (Phase 05 T09, D-K/D1). Single scheduler instance.
setupNightlyJob();

const port = env.PORT;
console.log(`[fxl-sales-api] listening on http://localhost:${port} (${env.NODE_ENV})`);

serve({ fetch: app.fetch, port });
