/**
 * The lead wire contract, and the structural claims this slice makes about its
 * own source.
 *
 * Pure: zod plus two `readFileSync` source reads. No database, no mocks, no
 * network. The source-read half is the same pattern `history-route.test.ts`
 * already uses, and it is here because these are claims no runtime assertion can
 * make - "this file never reaches for the audit writer" is a property of the
 * FILE, and a behavioural test passes on a file that imports the writer and
 * happens not to call it on the path under test.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  CreateLeadSchema,
  LEADS_DEFAULT_LIMIT,
  LEADS_MAX_LIMIT,
  ListLeadsQuerySchema,
  MoveLeadSchema,
  UpdateLeadSchema,
} from '../lead-schemas.js';

const leadServiceSource = readFileSync(
  fileURLToPath(new URL('../lead-service.ts', import.meta.url)),
  'utf8',
);

const STAGE_ID = '11111111-1111-4111-8111-111111111111';
const SALE_ID = '22222222-2222-4222-8222-222222222222';

describe('lead wire contract', () => {
  // Without .strict() every one of these keys is silently stripped and the PATCH
  // answers 200 with an unchanged row - the exact `PATCH /clients/:id
  // {"status":"archived"}` trap CLAUDE.md records. It is also the STRUCTURAL
  // guarantee that stage_id has exactly one writer: there is no code path from
  // PATCH /leads/:id to the stage column at all.
  it('rejects a PATCH body carrying stageId, position, saleId or lostReason', () => {
    for (const forbidden of [
      { stageId: STAGE_ID },
      { position: 3 },
      { saleId: SALE_ID },
      { lostReason: 'sem orçamento' },
      { stageChangedAt: new Date().toISOString() },
    ]) {
      const parsed = UpdateLeadSchema.safeParse({ contactName: 'Ana', ...forbidden });
      expect(parsed.success).toBe(false);
      if (parsed.success) continue;
      // zod reports an unrecognized key as ONE form-level issue naming the key,
      // not as a fieldError, so the key is asserted where zod actually puts it.
      expect(parsed.error.issues).toHaveLength(1);
      expect(parsed.error.issues[0]!.code).toBe('unrecognized_keys');
      expect(parsed.error.issues[0]!.message).toContain(Object.keys(forbidden)[0]);
    }

    // The keys it DOES declare still go through.
    expect(UpdateLeadSchema.safeParse({ contactName: 'Ana' }).success).toBe(true);
    expect(UpdateLeadSchema.safeParse({}).success).toBe(true);
  });

  // A lead that is born converted or born lost is not expressible, rather than
  // merely rejected downstream: a new lead always lands in the first active
  // normal stage.
  it('rejects a create body carrying stageId or saleId', () => {
    const base = { contactName: 'Ana', clientName: 'Empresa Um' };
    expect(CreateLeadSchema.safeParse(base).success).toBe(true);
    expect(CreateLeadSchema.safeParse({ ...base, stageId: STAGE_ID }).success).toBe(false);
    expect(CreateLeadSchema.safeParse({ ...base, saleId: SALE_ID }).success).toBe(false);
    expect(CreateLeadSchema.safeParse({ ...base, orgId: 'org_smuggled' }).success).toBe(false);
    expect(CreateLeadSchema.safeParse({ ...base, position: 0 }).success).toBe(false);
  });

  it('rejects a cursor that is not <position>:<uuid>', () => {
    const ok = ListLeadsQuerySchema.safeParse({ stageId: STAGE_ID, cursor: `7:${SALE_ID}` });
    expect(ok.success).toBe(true);
    for (const cursor of ['', '7', SALE_ID, `7:${SALE_ID}x`, `-1:${SALE_ID}`, `7:${SALE_ID} `]) {
      expect(ListLeadsQuerySchema.safeParse({ stageId: STAGE_ID, cursor }).success).toBe(false);
    }
  });

  // stageId is REQUIRED: the board loads one request per column, which is how a
  // kanban column actually paginates. A board-wide list would need a three-part
  // cursor for no gain.
  it('requires stageId and caps limit at LEADS_MAX_LIMIT', () => {
    expect(ListLeadsQuerySchema.safeParse({}).success).toBe(false);
    expect(LEADS_DEFAULT_LIMIT).toBe(50);
    expect(LEADS_MAX_LIMIT).toBe(200);
    expect(
      ListLeadsQuerySchema.safeParse({ stageId: STAGE_ID, limit: String(LEADS_MAX_LIMIT) }).success,
    ).toBe(true);
    expect(
      ListLeadsQuerySchema.safeParse({ stageId: STAGE_ID, limit: String(LEADS_MAX_LIMIT + 1) })
        .success,
    ).toBe(false);
    expect(ListLeadsQuerySchema.safeParse({ stageId: STAGE_ID, limit: '0' }).success).toBe(false);
    // Absent means the default, applied by the service and not by the schema, so
    // the schema leaves the key undefined rather than inventing a number.
    const parsed = ListLeadsQuerySchema.parse({ stageId: STAGE_ID });
    expect(parsed.limit).toBeUndefined();
  });

  it('accepts the move body and nothing else', () => {
    expect(MoveLeadSchema.safeParse({ stageId: STAGE_ID, position: 0 }).success).toBe(true);
    expect(
      MoveLeadSchema.safeParse({ stageId: STAGE_ID, position: 2, reason: 'preço', saleId: SALE_ID })
        .success,
    ).toBe(true);
    expect(MoveLeadSchema.safeParse({ stageId: STAGE_ID }).success).toBe(false);
    expect(MoveLeadSchema.safeParse({ position: 0 }).success).toBe(false);
    expect(MoveLeadSchema.safeParse({ stageId: STAGE_ID, position: -1 }).success).toBe(false);
    // The field names ARE the contract: slice 04's client is built against them.
    expect(
      MoveLeadSchema.safeParse({ toStageId: STAGE_ID, toIndex: 0 }).success,
    ).toBe(false);
  });

  it('requires a productName on a lead product row that names no produto', () => {
    const base = { contactName: 'Ana', clientName: 'Empresa Um' };
    expect(CreateLeadSchema.safeParse({ ...base, products: [{}] }).success).toBe(false);
    expect(
      CreateLeadSchema.safeParse({ ...base, products: [{ productName: 'Algo avulso' }] }).success,
    ).toBe(true);
    expect(CreateLeadSchema.safeParse({ ...base, products: [{ productId: SALE_ID }] }).success).toBe(
      true,
    );
  });

  // Acceptance 19: stage movement writes NO ledger entry. The ledger is
  // hash-chained, queues behind a global tail lock and is never purged; a card
  // move is high-frequency noise.
  it('lead-service.ts never reaches for the audit writer or the admin connection', () => {
    expect(leadServiceSource).not.toMatch(/writeAuditEntry|auditCadastroLifecycle|auditLog/);
    expect(leadServiceSource).not.toMatch(/getAdminDb/);
  });

  // Acceptance 4: is_seller is a deprecated derived mirror; person_funcoes
  // against the system função is the one authority.
  it('lead-service.ts resolves the vendedor through person_funcoes and never through is_seller', () => {
    expect(leadServiceSource).not.toMatch(/is_seller|isSeller/);
    expect(leadServiceSource).not.toMatch(/is_finder|isFinder|is_collaborator|isCollaborator/);
    expect(leadServiceSource).toMatch(/salesOpsPersonFuncoes/);
    expect(leadServiceSource).toMatch(/'vendedor'/);
  });

  // Acceptance 1 and 12: creating a lead never inserts a venda and never inserts
  // a cliente. The import ban is what makes that visible at a glance.
  it('lead-service.ts imports neither sales_ops_clients nor sales_ops_sales as a writer', () => {
    expect(leadServiceSource).not.toMatch(/salesOpsClients/);
    expect(leadServiceSource).not.toMatch(/insert\(salesOpsSales\)/);
    expect(leadServiceSource).not.toMatch(/getSalesOpsSnapshot|getSalesOpsSummary|computeSaleFinancials/);
  });

  // The headline mutation this slice exists to make impossible: a same-stage
  // reorder must produce an UPDATE whose `set` object has no stage_changed_at
  // key AT ALL, never a conditional VALUE.
  it('writes stageChangedAt by key omission and never as a conditional value', () => {
    expect(leadServiceSource).toMatch(
      /\.\.\.\(stageChanged \? \{ stageChangedAt: new Date\(\) \} : \{\}\),/,
    );
    expect(leadServiceSource).not.toMatch(/stageChangedAt: stageChanged \?/);
  });
});
