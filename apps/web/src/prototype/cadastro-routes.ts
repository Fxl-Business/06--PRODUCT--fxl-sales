import type { CadastroHistoryEntryWire } from '@/sales-ops/cadastro-history';
import type {
  SalesOpsPerson,
  SalesOpsProduct,
  SalesOpsProductFuncaoCost,
  SalesOpsSettlement,
} from '@/sales-ops/types';
import {
  asRecord,
  badRequest,
  forbiddenAdmin,
  json,
  notFound,
  ok,
  str,
  uuid,
  type Reply,
  type RouteContext,
} from './http';

type Row = { id: string; orgId?: string; createdAt?: string; updatedAt?: string | null; status?: string };

const NUMERIC_AS_STRING = [
  'sellerCommissionValue',
  'sellerWithFinderCommissionValue',
  'finderCommissionValue',
  'defaultEntradaPct',
  'defaultSellerCommissionPct',
  'defaultFinderCommissionPct',
  'defaultTaxPct',
];

/** Every `numeric(...)` column is a string on read and a number on write. */
function stringifyNumerics(body: Record<string, unknown>): Record<string, unknown> {
  const out = { ...body };
  for (const key of NUMERIC_AS_STRING) {
    const value = out[key];
    if (typeof value === 'number') out[key] = value.toFixed(2);
  }
  return out;
}

const RESOURCE_ENTITY: Record<string, string> = {
  products: 'produto',
  people: 'pessoa',
  funcoes: 'funcao',
  areas: 'area',
};

function recordArchiveHistory(ctx: RouteContext, resource: string, row: Row & Record<string, unknown>, before: string | undefined): void {
  const entity = RESOURCE_ENTITY[resource];
  const after = row.status;
  if (!entity || before === after) return;
  const archived = after === 'archived' || after === 'inactive';
  const restored = (before === 'archived' || before === 'inactive') && after === 'active';
  if (!archived && !restored) return;
  const label = str(row.name) ?? str(row.displayName) ?? null;
  const entry: CadastroHistoryEntryWire = {
    id: String(ctx.org.history.length + 1),
    ts: ctx.world.tick(),
    action: archived ? 'cadastro.archived' : 'cadastro.restored',
    entityType: entity,
    entityId: row.id,
    entityLabel: label,
    actorUserId: ctx.caller.accountId,
    actorDisplayName: ctx.who.displayName,
  };
  ctx.org.history.unshift(entry);
}

function saveRow<T extends Row>(
  ctx: RouteContext,
  resource: string,
  rows: T[],
  id: string | undefined,
  body: Record<string, unknown>,
  create: (id: string, now: string) => T,
  patch: (row: T, body: Record<string, unknown>) => void = () => undefined,
): Reply {
  if (!ctx.who.admin) return forbiddenAdmin();
  const now = ctx.world.tick();
  if (id) {
    const row = rows.find((candidate) => candidate.id === id);
    if (!row) return notFound();
    const before = row.status;
    Object.assign(row, stringifyNumerics(body));
    patch(row, body);
    row.updatedAt = now;
    recordArchiveHistory(ctx, resource, row as T & Record<string, unknown>, before);
    return ok({ row });
  }
  const fresh = create(uuid(ctx.world, 2), now);
  Object.assign(fresh, stringifyNumerics(body));
  patch(fresh, body);
  rows.push(fresh);
  return json(201, { row: fresh });
}

/** The key the web reads the saved row under. */
const singular = (reply: Reply, key: string): Reply =>
  reply.status < 300 && reply.body ? { ...reply, body: { [key]: (reply.body as { row: unknown }).row } } : reply;

function resolveFuncoes(ctx: RouteContext, person: SalesOpsPerson, body: Record<string, unknown>): void {
  if (!Array.isArray(body.funcaoIds)) return;
  const ids = body.funcaoIds.filter((x): x is string => typeof x === 'string');
  person.funcaoIds = ids;
  person.funcoes = ctx.org.bootstrap.funcoes
    .filter((funcao) => ids.includes(funcao.id))
    .map(({ id, name, slug, isSystem }) => ({ id, name, slug, isSystem }));
}

function saveProductCosts(ctx: RouteContext, product: SalesOpsProduct, body: Record<string, unknown>): void {
  if (!Array.isArray(body.productFuncaoCosts)) return;
  const now = ctx.world.tick();
  const costs = ctx.org.bootstrap.productFuncaoCosts.filter((cost) => cost.productId !== product.id);
  for (const raw of body.productFuncaoCosts) {
    const entry = asRecord(raw);
    const funcaoId = str(entry.funcaoId);
    if (!funcaoId) continue;
    const pct = entry.mode === 'pct';
    const cost: SalesOpsProductFuncaoCost = {
      id: uuid(ctx.world, 19),
      orgId: ctx.org.orgId,
      productId: product.id,
      funcaoId,
      mode: pct ? 'pct' : 'fix',
      valuePct: pct && typeof entry.valuePct === 'number' ? entry.valuePct.toFixed(2) : null,
      valueBrl: !pct && typeof entry.valueBrl === 'number' ? entry.valueBrl : null,
      createdAt: now,
      updatedAt: null,
    };
    costs.push(cost);
  }
  ctx.org.bootstrap.productFuncaoCosts = costs;
}

/** The baixa and estorno rules the real API enforces, reduced to what a screen can trigger. */
function settlementsRoute(ctx: RouteContext, rest: string[], body: Record<string, unknown>): Reply | null {
  if (ctx.req.method !== 'POST') return null;
  if (!ctx.who.admin) return forbiddenAdmin();
  const { bootstrap } = ctx.org;
  const [id, tail] = rest;
  const now = ctx.world.tick();
  const today = now.slice(0, 10);
  if (!id) {
    const kind = body.targetKind === 'payable' ? 'payable' : 'receivable';
    const targetId = str(body.targetId) ?? '';
    const paidOn = str(body.paidOn) ?? today;
    const target = (kind === 'payable' ? bootstrap.payables : bootstrap.receivables).find(
      (row) => row.id === targetId,
    );
    if (!target || target.status === 'void') return notFound();
    if (target.status === 'paid') return json(409, { error: 'already_settled' });
    const entry: SalesOpsSettlement = {
      id: uuid(ctx.world, 12),
      saleId: target.saleId,
      targetKind: kind,
      receivableId: kind === 'receivable' ? targetId : null,
      payableId: kind === 'payable' ? targetId : null,
      type: 'baixa',
      reversesSettlementId: null,
      reversedBySettlementId: null,
      paidOn,
      amountBrl: target.amountBrl,
      origin: 'manual',
      actorName: ctx.who.displayName,
      recordedAt: now,
      reason: null,
    };
    ctx.org.settlements.push(entry);
    target.status = 'paid';
    target.paidOn = paidOn;
    return json(201, { settlement: entry });
  }
  if (tail !== 'reverse') return null;
  const baixa = ctx.org.settlements.find((row) => row.id === id && row.type === 'baixa');
  if (!baixa) return notFound();
  if (baixa.reversedBySettlementId) return json(409, { error: 'already_reversed' });
  const estorno: SalesOpsSettlement = {
    ...baixa,
    id: uuid(ctx.world, 12),
    type: 'estorno',
    reversesSettlementId: baixa.id,
    reversedBySettlementId: null,
    origin: 'manual',
    actorName: ctx.who.displayName,
    recordedAt: now,
    reason: str(body.reason) ?? null,
  };
  baixa.reversedBySettlementId = estorno.id;
  ctx.org.settlements.push(estorno);
  const target = (baixa.targetKind === 'payable' ? bootstrap.payables : bootstrap.receivables).find(
    (row) => row.id === (baixa.payableId ?? baixa.receivableId),
  );
  if (target) {
    target.status = 'open';
    target.paidOn = null;
  }
  return json(201, { settlement: estorno });
}

const WON_REFUSED = 'the prototype does not materialize payables for a won proposta';

/** Cadastros, settings, proposta status, baixas, history and the bootstrap. Null when the route is not one of these. */
export function cadastroRoute(ctx: RouteContext): Reply | null {
  const { segments, req } = ctx;
  const [head, second, third] = segments;
  const body = asRecord(req.body);
  const method = req.method;
  const { bootstrap } = ctx.org;
  const write = method === 'POST' || method === 'PATCH' || method === 'PUT';
  const id = second;

  if (head === 'bootstrap' && method === 'GET' && !second) return ok(bootstrap);

  if (head === 'history' && method === 'GET' && !second) {
    const actions = (req.query.get('action') ?? '').split(',').filter(Boolean);
    const limit = Number(req.query.get('limit') ?? 50);
    const entries = ctx.org.history.filter((entry) => actions.length === 0 || actions.includes(entry.action));
    return ok({ entries: entries.slice(0, limit), nextCursor: null });
  }

  if (head === 'settings' && method === 'PUT' && !second) {
    if (!ctx.who.admin) return forbiddenAdmin();
    if (!bootstrap.settings) return notFound();
    Object.assign(bootstrap.settings, stringifyNumerics(body), { updatedAt: ctx.world.tick() });
    return ok({ settings: bootstrap.settings });
  }

  if (head === 'sales' && id && method === 'GET' && third === 'settlements') {
    return ok({ settlements: ctx.org.settlements.filter((entry) => entry.saleId === id) });
  }
  if (head === 'sales' && id && method === 'POST' && third === 'transition') {
    if (!ctx.who.admin) return forbiddenAdmin();
    const sale = bootstrap.sales.find((row) => row.id === id);
    if (!sale) return notFound();
    const status = body.status;
    if (status !== 'open' && status !== 'won' && status !== 'lost' && status !== 'cancelled') {
      return badRequest('invalid_status');
    }
    if (status === 'won' && sale.status !== 'won') {
      return json(404, {
        error: 'not_in_prototype',
        code: 'not_in_prototype',
        message: `Prototype fixtures have no answer for POST ${req.path} as ${ctx.caller.label}: ${WON_REFUSED}.`,
      });
    }
    sale.status = status;
    sale.lostAt = status === 'lost' ? ctx.world.tick() : null;
    sale.updatedAt = ctx.world.tick();
    return ok({ sale });
  }
  if (head === 'settlements') return settlementsRoute(ctx, segments.slice(1), body);

  if (!write) return null;
  switch (head) {
    case 'people':
      return singular(
        saveRow(ctx, head, bootstrap.people, id, body, (rowId, now): SalesOpsPerson => ({
          id: rowId,
          orgId: ctx.org.orgId,
          displayName: str(body.displayName) ?? '',
          contactEmail: str(body.contactEmail) ?? null,
          status: 'active',
          funcaoIds: [],
          funcoes: [],
          createdAt: now,
          updatedAt: null,
        }), (row, input) => resolveFuncoes(ctx, row, input)),
        'person',
      );
    case 'products':
      return singular(
        saveRow(ctx, head, bootstrap.products, id, body, (rowId, now): SalesOpsProduct => ({
          id: rowId,
          orgId: ctx.org.orgId,
          name: '',
          kind: 'product',
          codeSuffix: String(bootstrap.products.length + 1),
          areaId: null,
          openPrice: false,
          setupBrl: 0,
          hasMonthly: false,
          monthlyBrl: 0,
          recurringCommission: false,
          hasFinderCommission: false,
          sellerCommissionType: 'pct',
          sellerCommissionValue: '0.00',
          sellerWithFinderCommissionType: 'pct',
          sellerWithFinderCommissionValue: '0.00',
          finderCommissionType: 'pct',
          finderCommissionValue: '0.00',
          modules: [],
          providers: [],
          status: 'active',
          createdAt: now,
          updatedAt: null,
        }), (row, input) => saveProductCosts(ctx, row, input)),
        'product',
      );
    case 'clients':
      return singular(
        saveRow(ctx, head, bootstrap.clients, id, body, (rowId, now) => ({
          id: rowId,
          orgId: ctx.org.orgId,
          name: '',
          contact: null,
          createdAt: now,
          updatedAt: null,
        })),
        'client',
      );
    case 'areas':
      return singular(
        saveRow(ctx, head, bootstrap.areas, id, body, (rowId, now) => ({
          id: rowId,
          orgId: ctx.org.orgId,
          name: '',
          status: 'active' as const,
          createdAt: now,
          updatedAt: null,
        })),
        'area',
      );
    case 'funcoes':
      return singular(
        saveRow(ctx, head, bootstrap.funcoes, id, body, (rowId, now) => ({
          id: rowId,
          orgId: ctx.org.orgId,
          name: '',
          slug: '',
          isSystem: false,
          status: 'active' as const,
          createdAt: now,
          updatedAt: null,
        }), (row) => {
          row.slug = row.name.toLowerCase().normalize('NFD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
        }),
        'funcao',
      );
    default:
      return null;
  }
}
