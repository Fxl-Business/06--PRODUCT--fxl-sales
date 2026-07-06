import { Hono } from 'hono';
import { env } from '../env.js';

export const healthRouter = new Hono();

healthRouter.get('/', (c) =>
  c.json({
    ok: true,
    service: 'fxl-sales-api',
    env: env.NODE_ENV,
    version: process.env.npm_package_version ?? 'unknown',
    timestamp: new Date().toISOString(),
  }),
);
