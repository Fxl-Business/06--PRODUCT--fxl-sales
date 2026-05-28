import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { logger } from 'hono/logger';
import { env } from './env.js';
import { corsMiddleware } from './middleware/cors.js';
import { errorMiddleware } from './middleware/error.js';
import { adminRouter } from './domains/admin/index.js';
import { findersPublicRouter } from './domains/finders/public-routes.js';
import { healthRouter } from './routes/health.js';

const app = new Hono();

app.use('*', logger());
app.use('*', corsMiddleware);
app.use('*', errorMiddleware);

app.route('/health', healthRouter);

// Public finder signup (Phase 03, D-R). NO auth middleware — a finder has no
// Clerk account at signup. The handler writes via getAdminDb() (finders is FORCE
// RLS; org_id='' placeholder is invisible to the tenant policy).
app.route('/api/v1/finders', findersPublicRouter);

// Admin domain (Phase 02 + Phase 03). clerkAuthMiddleware + requireAdmin applied
// INSIDE the admin router (D-B) — not at app level. Phase 03 adds /finders and
// /sellers under this same guarded group.
app.route('/api/v1/admin', adminRouter);

app.get('/', (c) =>
  c.json({
    name: 'Fxl Finders API',
    docs: '/health for liveness, add domain routes under apps/api/src/domains/',
  }),
);

app.notFound((c) => c.json({ error: 'not_found', path: c.req.path }, 404));

const port = env.PORT;
console.log(`[fxl-finders-api] listening on http://localhost:${port} (${env.NODE_ENV})`);

serve({ fetch: app.fetch, port });
