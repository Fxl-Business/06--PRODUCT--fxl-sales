import { Hono } from 'hono';
import { z } from 'zod';
import { getDb } from '../../db/client.js';
import { requireAdmin } from '../../middleware/require-admin.js';
import {
  AreaSchema,
  CancelContractSchema,
  ClientSchema,
  CreateSaleSchema,
  FuncaoSchema,
  INVALID_PRODUCT_ENTRADA_VALUE,
  INVALID_PRODUCT_KIND_VALUE,
  PersonSchema,
  ProductSchema,
  SaleInputError,
  SaleTransitionSchema,
  SettingsSchema,
  UpdateAreaSchema,
  UpdateFuncaoSchema,
  UpdatePersonSchema,
  UpdateProductSchema,
  UpdateSaleSchema,
  cancelContract,
  createArea,
  createClient,
  createFuncao,
  createPerson,
  createProduct,
  createSale,
  getSalesOpsSnapshot,
  getSalesOpsSummary,
  getSettings,
  listAreas,
  listClients,
  listFuncoes,
  listPeople,
  listProductFuncaoCosts,
  listProducts,
  listSales,
  resolveProductRefs,
  transitionSale,
  updateArea,
  updateClient,
  updateFuncao,
  updatePerson,
  updateProduct,
  updateSale,
  upsertSettings,
} from './service.js';

const saleIdSchema = z.string().uuid();

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

/** Sentinels the person write path returns for an unresolvable função set. */
const PERSON_FUNCAO_ERRORS = ['unknown_funcao', 'funcao_required'] as const;

function isPersonFuncaoError(value: unknown): value is (typeof PERSON_FUNCAO_ERRORS)[number] {
  return (
    typeof value === 'string' &&
    (PERSON_FUNCAO_ERRORS as readonly string[]).includes(value)
  );
}

salesOpsRouter.post('/people', requireAdmin, async (c) => {
  const parsed = PersonSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) {
    return c.json({ error: 'validation_error', issues: parsed.error.flatten() }, 400);
  }
  const person = await createPerson(getDb(), c.get('orgId'), parsed.data);
  if (isPersonFuncaoError(person)) {
    return c.json({ error: 'validation_error', reason: person }, 400);
  }
  return c.json({ person }, 201);
});

salesOpsRouter.patch('/people/:id', requireAdmin, async (c) => {
  const parsed = UpdatePersonSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) {
    return c.json({ error: 'validation_error', issues: parsed.error.flatten() }, 400);
  }
  const person = await updatePerson(getDb(), c.get('orgId'), c.req.param('id'), parsed.data);
  if (isPersonFuncaoError(person)) {
    return c.json({ error: 'validation_error', reason: person }, 400);
  }
  if (!person) return c.json({ error: 'not_found' }, 404);
  return c.json({ person });
});

salesOpsRouter.get('/products', async (c) => {
  const orgId = c.get('orgId');
  const products = await listProducts(getDb(), orgId);
  const productFuncaoCosts = await listProductFuncaoCosts(getDb(), orgId);
  return c.json({ products, productFuncaoCosts });
});

salesOpsRouter.post('/products', async (c) => {
  const parsed = ProductSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) {
    return c.json({ error: 'validation_error', issues: parsed.error.flatten() }, 400);
  }
  const refs = await resolveProductRefs(getDb(), c.get('orgId'), parsed.data);
  if (!refs.ok) {
    return c.json(
      refs.reason === 'unknown_funcao'
        ? { error: 'validation_error', reason: refs.reason, funcaoId: refs.funcaoId }
        : { error: 'validation_error', reason: refs.reason },
      400,
    );
  }
  const created = await createProduct(getDb(), c.get('orgId'), parsed.data);
  return c.json(created, 201);
});

salesOpsRouter.patch('/products/:id', async (c) => {
  // UpdateProductSchema, not ProductSchema.partial(): a .superRefine-wrapped
  // schema is a ZodEffects and has no .partial().
  const parsed = UpdateProductSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) {
    return c.json({ error: 'validation_error', issues: parsed.error.flatten() }, 400);
  }
  const refs = await resolveProductRefs(getDb(), c.get('orgId'), parsed.data);
  if (!refs.ok) {
    return c.json(
      refs.reason === 'unknown_funcao'
        ? { error: 'validation_error', reason: refs.reason, funcaoId: refs.funcaoId }
        : { error: 'validation_error', reason: refs.reason },
      400,
    );
  }
  const updated = await updateProduct(getDb(), c.get('orgId'), c.req.param('id'), parsed.data);
  if (updated === INVALID_PRODUCT_KIND_VALUE) {
    return c.json({ error: 'validation_error', reason: 'service_cannot_have_fixed_value' }, 400);
  }
  if (updated === INVALID_PRODUCT_ENTRADA_VALUE) {
    return c.json({ error: 'validation_error', reason: 'entrada_mode_value_mismatch' }, 400);
  }
  if (!updated) return c.json({ error: 'not_found' }, 404);
  return c.json(updated);
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

// Funções are readable by any authenticated org member (every picker needs them)
// but only an admin may create or edit one, mirroring the pessoas gate.
// There is deliberately no DELETE verb: removal is PATCH { status: 'archived' },
// exactly as for áreas and produtos, so an archived função keeps backing the
// assignments that historical propostas were labelled from.
salesOpsRouter.get('/funcoes', async (c) => {
  const funcoes = await listFuncoes(getDb(), c.get('orgId'));
  return c.json({ funcoes });
});

salesOpsRouter.post('/funcoes', requireAdmin, async (c) => {
  const parsed = FuncaoSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) {
    return c.json({ error: 'validation_error', issues: parsed.error.flatten() }, 400);
  }
  const funcao = await createFuncao(getDb(), c.get('orgId'), parsed.data);
  if (funcao === 'reserved_slug') {
    return c.json({ error: 'validation_error', reason: 'reserved_funcao_slug' }, 400);
  }
  if (funcao === 'duplicate') return c.json({ error: 'conflict', reason: 'funcao_name_taken' }, 409);
  if (funcao === 'duplicate_slug') {
    return c.json({ error: 'conflict', reason: 'funcao_slug_taken' }, 409);
  }
  return c.json({ funcao }, 201);
});

salesOpsRouter.patch('/funcoes/:id', requireAdmin, async (c) => {
  const parsed = UpdateFuncaoSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) {
    return c.json({ error: 'validation_error', issues: parsed.error.flatten() }, 400);
  }
  const funcao = await updateFuncao(getDb(), c.get('orgId'), c.req.param('id'), parsed.data);
  if (funcao === 'reserved_slug') {
    return c.json({ error: 'validation_error', reason: 'reserved_funcao_slug' }, 400);
  }
  if (funcao === 'is_system') return c.json({ error: 'conflict', reason: 'funcao_is_system' }, 409);
  if (funcao === 'duplicate') return c.json({ error: 'conflict', reason: 'funcao_name_taken' }, 409);
  if (funcao === 'duplicate_slug') {
    return c.json({ error: 'conflict', reason: 'funcao_slug_taken' }, 409);
  }
  if (!funcao) return c.json({ error: 'not_found' }, 404);
  return c.json({ funcao });
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
  try {
    const result = await createSale(getDb(), c.get('orgId'), parsed.data);
    return c.json(result, 201);
  } catch (error) {
    if (error instanceof SaleInputError) {
      return c.json(
        { error: 'validation_error', reason: error.code, itemIndex: error.itemIndex },
        400,
      );
    }
    throw error;
  }
});

salesOpsRouter.post('/sales/:id/transition', async (c) => {
  const id = saleIdSchema.safeParse(c.req.param('id'));
  if (!id.success) return c.json({ error: 'not_found' }, 404);
  const parsed = SaleTransitionSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) {
    return c.json({ error: 'validation_error', issues: parsed.error.flatten() }, 400);
  }
  const result = await transitionSale(getDb(), c.get('orgId'), id.data, parsed.data.status);
  if (!result.ok && result.reason === 'not_found') return c.json({ error: 'not_found' }, 404);
  if (!result.ok) {
    return c.json({ error: 'invalid_transition', from: result.from, to: result.to }, 409);
  }
  return c.json({ sale: result.sale });
});

salesOpsRouter.post('/sales/:id/cancel-contract', async (c) => {
  const id = saleIdSchema.safeParse(c.req.param('id'));
  if (!id.success) return c.json({ error: 'not_found' }, 404);
  const parsed = CancelContractSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) {
    return c.json({ error: 'validation_error', issues: parsed.error.flatten() }, 400);
  }
  const result = await cancelContract(getDb(), c.get('orgId'), id.data, parsed.data.effectiveDate);
  if (!result.ok && result.reason === 'not_found') return c.json({ error: 'not_found' }, 404);
  if (!result.ok) return c.json({ error: 'contract_not_cancellable' }, 409);
  return c.json({
    sale: result.sale,
    voidedReceivables: result.voidedReceivables,
    voidedPayables: result.voidedPayables,
  });
});

salesOpsRouter.put('/sales/:id', async (c) => {
  const saleId = c.req.param('id');
  if (!saleIdSchema.safeParse(saleId).success) return c.json({ error: 'not_found' }, 404);
  const parsed = UpdateSaleSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) {
    return c.json({ error: 'validation_error', issues: parsed.error.flatten() }, 400);
  }
  try {
    const result = await updateSale(getDb(), c.get('orgId'), saleId, parsed.data);
    if (!result.ok && result.reason === 'not_found') return c.json({ error: 'not_found' }, 404);
    if (!result.ok) return c.json({ error: 'sale_not_editable', status: result.status }, 409);
    return c.json({ sale: result.sale, ledger: result.ledger });
  } catch (error) {
    if (error instanceof SaleInputError) {
      return c.json(
        { error: 'validation_error', reason: error.code, itemIndex: error.itemIndex },
        400,
      );
    }
    throw error;
  }
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
