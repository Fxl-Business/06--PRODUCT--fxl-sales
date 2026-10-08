/**
 * Spreadsheet import executor (importacao-planilha slice 06).
 *
 * Runs an already validated ImportPlan as ONE all-or-nothing sequence of existing
 * domain-service calls on the tenant transaction the route opened, then
 * writes one `import.completed` audit entry as the LAST statement.
 *
 * This module writes nothing itself: every write goes through a domain service
 * (createArea, createFuncao, createProduct, createPerson, createClient,
 * createLeadStage, createLead, moveLead, createSale, transitionSale, applyBaixaTx,
 * writeAuditEntry). Its only direct queries are two SELECTs that find the receivable
 * of a settlement and the payables linked to it. It never seeds: the routes seed
 * the org's default funnel and predefined funções in the same transaction before
 * the catalog is read (Amendment D11/D11b).
 *
 * Every service receives the caller's `tx` as its `db`, so each service's own
 * tenant scope becomes a SAVEPOINT; a refusal here throws, and the route's
 * transaction rolls everything back. `now` is the only clock.
 */
import { randomUUID } from 'node:crypto';
import { and, asc, eq, ne } from 'drizzle-orm';
import { isIsoDay, todayInSaoPaulo } from '@fxl-sales/shared-utils/sao-paulo-day';
import { salesOpsPayables, salesOpsReceivables } from '../../db/schema.js';
import { writeAuditEntry } from '../audit/service.js';
import { isProducerFlowLive } from '../integration/producer-gate.js';
import {
  AreaSchema,
  ClientSchema,
  CreateSaleSchema,
  FuncaoSchema,
  PersonSchema,
  ProductSchema,
  SaleInputError,
  createArea,
  createClient,
  createFuncao,
  createPerson,
  createProduct,
  createSale,
  resolveProductRefs,
  transitionSale,
  type CadastroActor,
  type Db,
} from '../sales-ops/service.js';
import { applyBaixaTx } from '../sales-ops/settlements.js';
import { LeadInputError, createLead, moveLead, type LeadScope } from '../sales-ops/leads/lead-service.js';
import { CreateLeadSchema, MoveLeadSchema } from '../sales-ops/leads/lead-schemas.js';
import { LeadStageSchema } from '../sales-ops/leads/schemas.js';
import { createLeadStage } from '../sales-ops/leads/stage-service.js';
import type { EntityRef, ImportCounts, ImportOperation, ImportPlan, SheetKey } from './types.js';
import { SHEET_KEYS, getSheetDef } from './workbook-schema.js';

export type ImportActor = CadastroActor;
export type ImportExecutionResult = { counts: ImportCounts; recognized: ImportCounts };

/** Position far past any column length: moveLead clamps it, so the lead is appended. */
export const LEAD_MOVE_TO_END = 100_000;
/** Noon in Sao Paulo (UTC-3): the instant stored as `won_at` for a historical won day. */
export const WON_AT_UTC_TIME = 'T15:00:00.000Z';

const FALLBACK_MESSAGE = 'o registro foi recusado pelo sistema';
const INVALID_DATA = 'os dados da linha foram recusados pela validação do sistema';

const REASON_MESSAGES: Record<string, string> = {
  duplicate: 'já existe um cadastro com este nome',
  duplicate_slug: 'já existe uma função com nome equivalente',
  reserved_slug: 'este nome é reservado para uma função do sistema',
  unknown_area: 'a área informada não existe nesta organização',
  unknown_funcao: 'uma das funções informadas não existe nesta organização',
  funcao_required: 'a pessoa precisa de pelo menos uma função',
  invalid_area: INVALID_DATA,
  invalid_funcao: INVALID_DATA,
  invalid_product: INVALID_DATA,
  invalid_person: INVALID_DATA,
  invalid_client: INVALID_DATA,
  invalid_lead_stage: INVALID_DATA,
  invalid_lead: INVALID_DATA,
  invalid_sale: INVALID_DATA,
  product_not_found: 'o produto informado não existe nesta organização',
  product_area_missing: 'o produto informado não tem área',
  area_not_found: 'a área informada não existe nesta organização',
  seller_not_found: 'o vendedor informado não existe nesta organização',
  seller_not_a_vendedor: 'a pessoa informada como vendedor não tem a função Vendedor',
  finder_not_found: 'o finder informado não existe nesta organização',
  person_not_found: 'a pessoa informada não existe nesta organização',
  funcao_not_found: 'a função informada não existe nesta organização',
  client_not_found: 'o cliente informado não existe nesta organização',
  stage_not_found: 'a etapa informada não existe ou está arquivada',
  no_open_stage: 'não há etapa ativa para receber o lead',
  lost_reason_required: 'a etapa de perda exige o motivo da perda',
  sale_required_for_conversion: 'um lead não pode ser importado na etapa de conversão',
  invalid_transition: 'a proposta não pode mudar para este status a partir do status atual',
  sale_has_active_settlements: 'a proposta tem pagamentos registrados',
  sale_not_won: 'a proposta precisa estar Ganha para registrar pagamento',
  row_void: 'a parcela foi cancelada',
  already_paid: 'a parcela já está paga',
  invalid_paid_on: 'a data de pagamento é inválida',
  paid_on_in_future: 'a data de pagamento está no futuro',
  receivable_not_found: 'a parcela não existe nesta proposta',
  receivable_ambiguous: 'há mais de uma parcela com este rótulo nesta proposta',
  won_on_mismatch: 'a data de ganho só vale para uma proposta Ganha, e uma proposta Ganha exige a data',
  invalid_won_on: 'a data de ganho é inválida',
  won_on_in_future: 'a data de ganho está no futuro',
  producer_flow_live:
    'esta organização está conectada ao FXL Finance, então propostas ganhas e pagamentos não podem ser importados',
  unresolved_ref: 'a linha referencia um registro que não foi criado antes dela',
  duplicate_plan_key: 'a linha aparece duas vezes no plano de importação',
  db_unique_violation: 'o registro repete um valor que precisa ser único (por exemplo, o código do produto)',
  db_foreign_key_violation: 'o registro referencia um cadastro que não existe',
  db_check_violation: 'o registro tem um valor fora do permitido',
};

function operationKey(operation: ImportOperation): string {
  return operation.op === 'transitionSale' || operation.op === 'settleReceivable'
    ? operation.saleKey
    : operation.planKey;
}

function parsePlanKey(key: string): { sheet: SheetKey; row: number } | null {
  const match = /^([A-Za-z]+):(\d+)$/.exec(key);
  if (!match) return null;
  const sheet = (SHEET_KEYS as readonly string[]).find((candidate) => candidate === match[1]);
  if (!sheet) return null;
  return { sheet: sheet as SheetKey, row: Number(match[2]) };
}

/** pt-BR sentence naming the tab and Excel row. Never contains an id, a planKey or a column key. */
export function importExecutionMessage(operation: ImportOperation, reason: string): string {
  const parsed = parsePlanKey(operationKey(operation));
  let location = parsed ? `Aba ${getSheetDef(parsed.sheet).tab}, linha ${parsed.row}` : 'Importação';
  if (operation.op === 'settleReceivable') location += ` (parcela ${operation.receivableLabel})`;
  return `${location}: ${REASON_MESSAGES[reason] ?? FALLBACK_MESSAGE}.`;
}

/**
 * The route must never serialize `operation` (it can carry ids); `message` is the
 * user-facing pt-BR sentence.
 */
export class ImportExecutionError extends Error {
  constructor(
    readonly operation: ImportOperation,
    readonly reason: string,
  ) {
    super(importExecutionMessage(operation, reason));
    this.name = 'ImportExecutionError';
  }
}

/** Every EntityRef an operation reads, in a stable order, nulls skipped. */
export function collectOperationRefs(operation: ImportOperation): EntityRef[] {
  const refs: Array<EntityRef | null> = [];
  switch (operation.op) {
    case 'createProduct':
      refs.push(operation.areaRef, ...operation.funcaoCosts.map((cost) => cost.funcaoRef));
      break;
    case 'createPerson':
      refs.push(...operation.funcaoRefs);
      break;
    case 'createLead':
      refs.push(
        operation.clientRef,
        operation.sellerRef,
        ...operation.products.map((product) => product.productRef),
        operation.stageRef,
      );
      break;
    case 'createSale':
      refs.push(operation.input.clientRef, operation.input.sellerRef, operation.input.finderRef);
      for (const item of operation.input.items) refs.push(item.productRef, item.areaRef);
      for (const professional of operation.input.professionals) {
        refs.push(professional.personRef, professional.funcaoRef);
      }
      break;
    case 'transitionSale':
    case 'settleReceivable':
      refs.push({ planKey: operation.saleKey });
      break;
    default:
      break;
  }
  return refs.filter((ref): ref is EntityRef => ref !== null);
}

function needsProducerGate(operation: ImportOperation): boolean {
  return (
    operation.op === 'settleReceivable' ||
    (operation.op === 'createSale' && (operation.input.status === 'won' || operation.wonOn !== null))
  );
}

function postgresCode(error: unknown): string | null {
  const candidates = [error, (error as { cause?: unknown } | null)?.cause];
  for (const candidate of candidates) {
    const code = (candidate as { code?: unknown } | null | undefined)?.code;
    if (typeof code === 'string') return code;
  }
  return null;
}

const POSTGRES_REASONS: Record<string, string> = {
  '23505': 'db_unique_violation',
  '23503': 'db_foreign_key_violation',
  '23514': 'db_check_violation',
};

export async function executeImportPlan(
  tx: Db,
  orgId: string,
  plan: ImportPlan,
  actor: ImportActor,
  now: Date,
): Promise<ImportExecutionResult> {
  // Programmer error, not a user error: the route checks `ok` before executing.
  if (plan.issues.some((issue) => issue.severity === 'error')) {
    throw new Error('import_plan_has_errors');
  }

  // Producer pre-scan: nothing is written for a live org.
  for (const operation of plan.operations) {
    if (needsProducerGate(operation) && isProducerFlowLive(orgId)) {
      throw new ImportExecutionError(operation, 'producer_flow_live');
    }
  }

  const ids = new Map<string, string>();
  const today = todayInSaoPaulo(now);
  const scope: LeadScope = { userId: actor.userId, email: null, isAdmin: true };

  const resolve = (ref: EntityRef, operation: ImportOperation): string => {
    if ('existingId' in ref) return ref.existingId;
    const id = ids.get(ref.planKey);
    if (id === undefined) throw new ImportExecutionError(operation, 'unresolved_ref');
    return id;
  };
  const resolveOrNull = (ref: EntityRef | null, operation: ImportOperation): string | null =>
    ref ? resolve(ref, operation) : null;
  const register = (operation: ImportOperation, planKey: string, id: string): void => {
    if (ids.has(planKey)) throw new ImportExecutionError(operation, 'duplicate_plan_key');
    ids.set(planKey, id);
  };

  async function settleOne(
    operation: ImportOperation,
    kind: 'receivable' | 'payable',
    id: string,
    paidOn: string,
  ): Promise<void> {
    const baixa = await applyBaixaTx(
      tx,
      orgId,
      { target: { kind, id }, paidOn, today, origin: 'manual', actor },
      { mode: 'manual' },
    );
    if (!baixa.ok) throw new ImportExecutionError(operation, baixa.reason);
  }

  async function dispatch(operation: ImportOperation): Promise<void> {
    switch (operation.op) {
      case 'createArea': {
        const parsed = AreaSchema.safeParse(operation.input);
        if (!parsed.success) throw new ImportExecutionError(operation, 'invalid_area');
        const created = await createArea(tx, orgId, parsed.data);
        if (created === 'duplicate') throw new ImportExecutionError(operation, 'duplicate');
        register(operation, operation.planKey, created.id);
        return;
      }
      case 'createFuncao': {
        const parsed = FuncaoSchema.safeParse(operation.input);
        if (!parsed.success) throw new ImportExecutionError(operation, 'invalid_funcao');
        const created = await createFuncao(tx, orgId, parsed.data);
        if (typeof created === 'string') throw new ImportExecutionError(operation, created);
        register(operation, operation.planKey, created.id);
        return;
      }
      case 'createProduct': {
        const parsed = ProductSchema.safeParse({
          ...operation.input,
          areaId: resolve(operation.areaRef, operation),
          productFuncaoCosts: operation.funcaoCosts.map((entry) => ({
            ...entry.cost,
            funcaoId: resolve(entry.funcaoRef, operation),
          })),
        });
        if (!parsed.success) throw new ImportExecutionError(operation, 'invalid_product');
        const refs = await resolveProductRefs(tx, orgId, parsed.data);
        if (!refs.ok) throw new ImportExecutionError(operation, refs.reason);
        const created = await createProduct(tx, orgId, parsed.data);
        register(operation, operation.planKey, created.product.id);
        return;
      }
      case 'createPerson': {
        const parsed = PersonSchema.safeParse({
          ...operation.input,
          funcaoIds: [...new Set(operation.funcaoRefs.map((ref) => resolve(ref, operation)))],
        });
        if (!parsed.success) throw new ImportExecutionError(operation, 'invalid_person');
        const created = await createPerson(tx, orgId, parsed.data);
        if (typeof created === 'string') throw new ImportExecutionError(operation, created);
        register(operation, operation.planKey, created.id);
        return;
      }
      case 'createClient': {
        const parsed = ClientSchema.safeParse(operation.input);
        if (!parsed.success) throw new ImportExecutionError(operation, 'invalid_client');
        const created = await createClient(tx, orgId, parsed.data);
        register(operation, operation.planKey, created.id);
        return;
      }
      case 'createLeadStage': {
        const parsed = LeadStageSchema.safeParse(operation.input);
        if (!parsed.success) throw new ImportExecutionError(operation, 'invalid_lead_stage');
        const created = await createLeadStage(tx, orgId, parsed.data);
        if (created === 'duplicate') throw new ImportExecutionError(operation, 'duplicate');
        register(operation, operation.planKey, created.id);
        return;
      }
      case 'createLead': {
        const parsed = CreateLeadSchema.safeParse({
          ...operation.input,
          clientId: resolveOrNull(operation.clientRef, operation),
          sellerPersonId: resolveOrNull(operation.sellerRef, operation),
          products: operation.products.map((product) =>
            product.productRef
              ? { productId: resolve(product.productRef, operation) }
              : { productName: product.name },
          ),
        });
        if (!parsed.success) throw new ImportExecutionError(operation, 'invalid_lead');
        const created = await createLead(tx, orgId, parsed.data, scope);
        if (!created.ok) throw new ImportExecutionError(operation, created.reason);
        register(operation, operation.planKey, created.lead.id);
        if (operation.stageRef === null) return;
        // Also for the default etapa: a harmless append in the same column that keeps row order.
        const move = MoveLeadSchema.safeParse({
          stageId: resolve(operation.stageRef, operation),
          position: LEAD_MOVE_TO_END,
          ...(operation.lostReason !== null ? { reason: operation.lostReason } : {}),
        });
        if (!move.success) throw new ImportExecutionError(operation, 'invalid_lead');
        const moved = await moveLead(tx, orgId, created.lead.id, move.data, scope);
        if (!moved.ok) throw new ImportExecutionError(operation, moved.reason);
        return;
      }
      case 'createSale': {
        const won = operation.input.status === 'won';
        if (won !== (operation.wonOn !== null)) {
          throw new ImportExecutionError(operation, 'won_on_mismatch');
        }
        if (won && operation.wonOn !== null) {
          if (!isIsoDay(operation.wonOn)) throw new ImportExecutionError(operation, 'invalid_won_on');
          if (operation.wonOn > today) throw new ImportExecutionError(operation, 'won_on_in_future');
          if (isProducerFlowLive(orgId)) throw new ImportExecutionError(operation, 'producer_flow_live');
        }
        const { clientRef, sellerRef, finderRef, items, professionals, ...rest } = operation.input;
        const clientId = resolveOrNull(clientRef, operation);
        const finderId = resolveOrNull(finderRef, operation);
        const parsed = CreateSaleSchema.safeParse({
          ...rest,
          ...(clientId !== null ? { clientId } : {}),
          sellerPersonId: resolve(sellerRef, operation),
          ...(finderId !== null ? { finderPersonId: finderId } : {}),
          items: items.map(({ productRef, areaRef, ...item }) => {
            const productId = resolveOrNull(productRef, operation);
            const areaId = resolveOrNull(areaRef, operation);
            return {
              ...item,
              ...(productId !== null ? { productId } : {}),
              ...(areaId !== null ? { areaId } : {}),
            };
          }),
          professionals: professionals.map(({ personRef, funcaoRef, ...professional }) => {
            const personId = resolveOrNull(personRef, operation);
            const funcaoId = resolveOrNull(funcaoRef, operation);
            return {
              ...professional,
              ...(personId !== null ? { personId } : {}),
              ...(funcaoId !== null ? { funcaoId } : {}),
            };
          }),
        });
        if (!parsed.success) throw new ImportExecutionError(operation, 'invalid_sale');
        const at = won ? new Date(`${operation.wonOn}${WON_AT_UTC_TIME}`) : now;
        const created = await createSale(tx, orgId, parsed.data, at);
        register(operation, operation.planKey, created.sale.id);
        return;
      }
      case 'transitionSale': {
        const saleId = resolve({ planKey: operation.saleKey }, operation);
        const result = await transitionSale(tx, orgId, saleId, operation.to, now);
        if (!result.ok) throw new ImportExecutionError(operation, result.reason);
        return;
      }
      case 'settleReceivable': {
        if (isProducerFlowLive(orgId)) throw new ImportExecutionError(operation, 'producer_flow_live');
        const saleId = resolve({ planKey: operation.saleKey }, operation);
        const rows = await tx
          .select({ id: salesOpsReceivables.id })
          .from(salesOpsReceivables)
          .where(
            and(
              eq(salesOpsReceivables.orgId, orgId),
              eq(salesOpsReceivables.saleId, saleId),
              eq(salesOpsReceivables.label, operation.receivableLabel),
              ne(salesOpsReceivables.status, 'void'),
            ),
          );
        if (rows.length === 0) throw new ImportExecutionError(operation, 'receivable_not_found');
        if (rows.length > 1) throw new ImportExecutionError(operation, 'receivable_ambiguous');
        const receivableId = rows[0]!.id;
        await settleOne(operation, 'receivable', receivableId, operation.paidOn);
        if (!operation.settlePayables) return;
        const payables = await tx
          .select({ id: salesOpsPayables.id })
          .from(salesOpsPayables)
          .where(
            and(
              eq(salesOpsPayables.orgId, orgId),
              eq(salesOpsPayables.saleId, saleId),
              eq(salesOpsPayables.receivableId, receivableId),
              ne(salesOpsPayables.status, 'void'),
            ),
          )
          .orderBy(asc(salesOpsPayables.dueDate), asc(salesOpsPayables.id));
        for (const payable of payables) {
          await settleOne(operation, 'payable', payable.id, operation.paidOn);
        }
        return;
      }
    }
  }

  for (const operation of plan.operations) {
    try {
      await dispatch(operation);
    } catch (error) {
      if (error instanceof ImportExecutionError) throw error;
      if (error instanceof SaleInputError || error instanceof LeadInputError) {
        throw new ImportExecutionError(operation, error.code);
      }
      const reason = POSTGRES_REASONS[postgresCode(error) ?? ''];
      if (reason) throw new ImportExecutionError(operation, reason);
      throw error;
    }
  }

  const counts: ImportCounts = { ...plan.counts };
  // Reported, never acted on: a recognized cliente is not an operation (D12).
  const recognized: ImportCounts = { ...plan.recognized };
  // LAST statement: the audit tail lock is held until commit.
  await writeAuditEntry(tx, {
    actorUserId: actor.userId,
    actorOrgId: orgId,
    action: 'import.completed',
    entityType: 'importacao',
    entityId: randomUUID(),
    beforeJsonb: {},
    afterJsonb: { counts, recognized, actorLabel: actor.displayName },
  });
  return { counts, recognized };
}
