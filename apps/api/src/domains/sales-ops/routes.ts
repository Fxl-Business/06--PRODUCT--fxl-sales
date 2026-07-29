import { Hono } from 'hono';
import { getDb } from '../../db/client.js';
import { requireAdmin } from '../../middleware/require-admin.js';
import {
  AreaSchema,
  ClientSchema,
  CreateSaleSchema,
  PersonSchema,
  ProductSchema,
  SettingsSchema,
  UpdateAreaSchema,
  UpdatePersonSchema,
  createArea,
  createClient,
  createPerson,
  createProduct,
  createSale,
  getArea,
  getSalesOpsSnapshot,
  getSalesOpsSummary,
  getSettings,
  listAreas,
  listClients,
  listPeople,
  listProducts,
  listSales,
  updateArea,
  updateClient,
  updatePerson,
  updateProduct,
  upsertSettings,
} from './service.js';

export const salesOpsRouter = new Hono();

salesOpsRouter.get('/bootstrap', async (c) => {
  const snapshot = await getSalesOpsSnapshot(getDb(), c.get('orgId'));
  return c.json(snapshot);
});

salesOpsRouter.get('/summary', async (c) => {
  const summary = await getSalesOpsSummary(getDb(), c.get('orgId'));
  return c.json({ summary });
});

salesOpsRouter.get('/people', async (c) => {
  const people = await listPeople(getDb(), c.get('orgId'));
  return c.json({ people });
});

salesOpsRouter.post('/people', requireAdmin, async (c) => {
  const parsed = PersonSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) {
    return c.json({ error: 'validation_error', issues: parsed.error.flatten() }, 400);
  }
  const person = await createPerson(getDb(), c.get('orgId'), parsed.data);
  return c.json({ person }, 201);
});

salesOpsRouter.patch('/people/:id', requireAdmin, async (c) => {
  const parsed = UpdatePersonSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) {
    return c.json({ error: 'validation_error', issues: parsed.error.flatten() }, 400);
  }
  const person = await updatePerson(getDb(), c.get('orgId'), c.req.param('id'), parsed.data);
  if (!person) return c.json({ error: 'not_found' }, 404);
  return c.json({ person });
});

salesOpsRouter.get('/products', async (c) => {
  const products = await listProducts(getDb(), c.get('orgId'));
  return c.json({ products });
});

salesOpsRouter.post('/products', async (c) => {
  const parsed = ProductSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) {
    return c.json({ error: 'validation_error', issues: parsed.error.flatten() }, 400);
  }
  const area = await getArea(getDb(), c.get('orgId'), parsed.data.areaId);
  if (!area) return c.json({ error: 'validation_error', reason: 'unknown_area' }, 400);
  const product = await createProduct(getDb(), c.get('orgId'), parsed.data);
  return c.json({ product }, 201);
});

salesOpsRouter.patch('/products/:id', async (c) => {
  const parsed = ProductSchema.partial().safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) {
    return c.json({ error: 'validation_error', issues: parsed.error.flatten() }, 400);
  }
  if (parsed.data.areaId !== undefined) {
    const area = await getArea(getDb(), c.get('orgId'), parsed.data.areaId);
    if (!area) return c.json({ error: 'validation_error', reason: 'unknown_area' }, 400);
  }
  const product = await updateProduct(getDb(), c.get('orgId'), c.req.param('id'), parsed.data);
  if (!product) return c.json({ error: 'not_found' }, 404);
  return c.json({ product });
});

salesOpsRouter.get('/clients', async (c) => {
  const clients = await listClients(getDb(), c.get('orgId'));
  return c.json({ clients });
});

salesOpsRouter.post('/clients', async (c) => {
  const parsed = ClientSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) {
    return c.json({ error: 'validation_error', issues: parsed.error.flatten() }, 400);
  }
  const client = await createClient(getDb(), c.get('orgId'), parsed.data);
  return c.json({ client }, 201);
});

salesOpsRouter.patch('/clients/:id', async (c) => {
  const parsed = ClientSchema.partial().safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) {
    return c.json({ error: 'validation_error', issues: parsed.error.flatten() }, 400);
  }
  const client = await updateClient(getDb(), c.get('orgId'), c.req.param('id'), parsed.data);
  if (!client) return c.json({ error: 'not_found' }, 404);
  return c.json({ client });
});

salesOpsRouter.get('/areas', async (c) => {
  const areas = await listAreas(getDb(), c.get('orgId'));
  return c.json({ areas });
});

salesOpsRouter.post('/areas', async (c) => {
  const parsed = AreaSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) {
    return c.json({ error: 'validation_error', issues: parsed.error.flatten() }, 400);
  }
  const area = await createArea(getDb(), c.get('orgId'), parsed.data);
  if (area === 'duplicate') return c.json({ error: 'conflict', reason: 'area_name_taken' }, 409);
  return c.json({ area }, 201);
});

salesOpsRouter.patch('/areas/:id', async (c) => {
  const parsed = UpdateAreaSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) {
    return c.json({ error: 'validation_error', issues: parsed.error.flatten() }, 400);
  }
  const area = await updateArea(getDb(), c.get('orgId'), c.req.param('id'), parsed.data);
  if (area === 'duplicate') return c.json({ error: 'conflict', reason: 'area_name_taken' }, 409);
  if (!area) return c.json({ error: 'not_found' }, 404);
  return c.json({ area });
});

salesOpsRouter.get('/sales', async (c) => {
  const sales = await listSales(getDb(), c.get('orgId'));
  return c.json({ sales });
});

salesOpsRouter.post('/sales', async (c) => {
  const parsed = CreateSaleSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) {
    return c.json({ error: 'validation_error', issues: parsed.error.flatten() }, 400);
  }
  const result = await createSale(getDb(), c.get('orgId'), parsed.data);
  return c.json(result, 201);
});

salesOpsRouter.get('/settings', async (c) => {
  const settings = await getSettings(getDb(), c.get('orgId'));
  return c.json({ settings });
});

salesOpsRouter.put('/settings', async (c) => {
  const parsed = SettingsSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) {
    return c.json({ error: 'validation_error', issues: parsed.error.flatten() }, 400);
  }
  const settings = await upsertSettings(getDb(), c.get('orgId'), parsed.data);
  return c.json({ settings });
});
