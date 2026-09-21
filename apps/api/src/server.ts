// ONLY the two modules the local-database guard itself needs are imported
// statically, and that is load-bearing rather than stylistic. ESM evaluates the
// ENTIRE static import graph before the first statement of this module body
// runs, so anything reached through a static import speaks before the guard
// does. `./middleware/app-auth.js` loads the Hub configuration at ITS module
// top level and throws there on a bad one, which is exactly how the guard's
// verdict got buried under an unrelated failure. Both static imports below are
// pure with respect to the database: `./env.js` resolves env files and
// zod-parses, and the guard module imports nothing at all.
import { env, namedEnvFile } from './env.js';
import { assertLocalDatabase, describeDatabaseTarget } from './db/local-database-guard.js';

// The local-database guard runs FIRST, before anything else in this process.
// `createAppAuthBff()` below reaches getAdminDb() synchronously and constructs
// a postgres-js pool against DATABASE_URL; no socket opens until the first
// query, but the guard belongs in front of it all the same. Deliberately NOT in
// env.ts: that module is imported by the unit suite, and an assertion there
// would make the whole suite environment-dependent.
const databaseViolations = assertLocalDatabase({
  nodeEnv: env.NODE_ENV,
  databaseUrl: env.DATABASE_URL,
  namedEnvFile,
});
if (databaseViolations.length > 0) {
  for (const line of databaseViolations) console.error(line);
  process.exit(1);
}

// One line, every non-production boot, naming the database this process is
// about to use. Its absence is what made the 2026-09-16 staging write invisible.
// Host and port ONLY - never the user, the password or the whole URL.
if (env.NODE_ENV !== 'production') {
  const target = describeDatabaseTarget(env.DATABASE_URL);
  console.log(
    target
      ? `[fxl-sales-api] database host=${target.host} port=${target.port}`
      : '[fxl-sales-api] database target unknown - DATABASE_URL is absent or does not parse',
  );
}

// The development identity adapter, checked here so it runs AFTER the guard's
// exit(1) and BEFORE every pre-existing dynamic import below. With
// SALES_AUTH_FAKE absent this returns at its first statement and evaluates
// nothing further, so the dynamic import list below keeps its exact original
// order and its original binding names. See apps/api/src/auth/select.ts.
const { installFakeAuthIfRequested } = await import('./auth/select.js');
await installFakeAuthIfRequested();

// Everything else loads here, AFTER the guard has had its say. The order is the
// order the static import list used to have, and the bindings keep their names.
const { serve } = await import('@hono/node-server');
const { Hono } = await import('hono');
const { logger } = await import('hono/logger');
const { corsMiddleware } = await import('./middleware/cors.js');
const { errorMiddleware } = await import('./middleware/error.js');
const { appAuthMiddleware, createAppAuthBff } = await import('./middleware/app-auth.js');
const { requireAdmin } = await import('./middleware/require-admin.js');
const { adminRouter } = await import('./domains/admin/index.js');
const { findersPublicRouter } = await import('./domains/finders/public-routes.js');
const { linksRouter } = await import('./domains/links/routes.js');
const { referralsRouter } = await import('./domains/referrals/routes.js');
const { finderRouter } = await import('./domains/finder/routes.js');
const { hmacVerifyMiddleware } = await import('./domains/conversions/hmac-middleware.js');
const { conversionsAdminRouter, conversionsRouter } = await import(
  './domains/conversions/routes.js'
);
const { commissionsAdminRouter, commissionsRouter } = await import(
  './domains/commissions/routes.js'
);
const { payoutsAdminRouter, payoutsRouter } = await import('./domains/payouts/routes.js');
const { salesOpsRouter } = await import('./domains/sales-ops/routes.js');
const { auditRouter } = await import('./domains/audit/routes.js');
const { setupNightlyJob } = await import('./jobs/nightly-job.js');
const { healthRouter } = await import('./routes/health.js');

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
