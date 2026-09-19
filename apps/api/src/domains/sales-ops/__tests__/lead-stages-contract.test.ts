import { describe, expect, it } from 'vitest';
import {
  LeadStageSchema,
  ReorderLeadStagesSchema,
  UpdateLeadStageSchema,
} from '../leads/schemas.js';

const UUID_A = '11111111-1111-4111-8111-111111111111';
const UUID_B = '22222222-2222-4222-8222-222222222222';

describe('sales operations lead stage contract', () => {
  it('accepts a minimal lead stage payload and defaults status to active', () => {
    expect(LeadStageSchema.parse({ name: '  Qualificação  ' })).toEqual({
      name: 'Qualificação',
      status: 'active',
    });
  });

  it('rejects an empty or blank lead stage name', () => {
    expect(LeadStageSchema.safeParse({ name: '' }).success).toBe(false);
    expect(LeadStageSchema.safeParse({ name: '   ' }).success).toBe(false);
    expect(LeadStageSchema.safeParse({}).success).toBe(false);
    expect(LeadStageSchema.safeParse({ name: 'Qualificação' }).success).toBe(true);
  });

  it('rejects unsupported lead stage statuses', () => {
    expect(LeadStageSchema.safeParse({ name: 'Novo', status: 'deleted' }).success).toBe(false);
    expect(LeadStageSchema.safeParse({ name: 'Novo', status: 'archived' }).success).toBe(true);
  });

  it('never accepts kind, position or isSystem from the request body', () => {
    // The single most damaging mutation in this slice is spreading the request
    // body into the insert: a smuggled `kind: 'conversion'` would mint a second
    // conversion column and a smuggled `isSystem: true` a permanently
    // un-archivable stage. zod stripping them is the guard, and 01's partial
    // unique index on (org_id, kind) is the database-level backstop.
    const parsed = LeadStageSchema.parse({
      name: 'Proposta',
      kind: 'conversion',
      position: 0,
      isSystem: true,
      orgId: 'body-org-must-not-be-used',
      archivedAt: new Date(0),
    });
    expect(parsed).toEqual({ name: 'Proposta', status: 'active' });
    expect(Object.keys(parsed).sort()).toEqual(['name', 'status']);

    const patched = UpdateLeadStageSchema.parse({
      kind: 'lost',
      position: 3,
      isSystem: true,
      orgId: 'body-org-must-not-be-used',
    });
    expect(patched).toEqual({});

    // There is no `slug` column on sales_ops_lead_stages and there must never be
    // a slug key here either - a "symmetry with funções" edit is exactly how one
    // would come back.
    expect(parsed).not.toHaveProperty('slug');
    expect(LeadStageSchema.parse({ name: 'Novo', slug: 'novo' })).not.toHaveProperty('slug');
  });

  it('allows a partial patch payload but still rejects a blank rename', () => {
    expect(UpdateLeadStageSchema.safeParse({}).success).toBe(true);
    expect(UpdateLeadStageSchema.parse({})).toEqual({});
    expect(UpdateLeadStageSchema.safeParse({ status: 'archived' }).success).toBe(true);
    expect(UpdateLeadStageSchema.safeParse({ name: '   ' }).success).toBe(false);
  });

  it('rejects a reorder payload with duplicate stage ids', () => {
    expect(ReorderLeadStagesSchema.safeParse({ stageIds: [UUID_A, UUID_B] }).success).toBe(true);
    const duplicated = ReorderLeadStagesSchema.safeParse({ stageIds: [UUID_A, UUID_B, UUID_A] });
    expect(duplicated.success).toBe(false);
    if (duplicated.success) throw new Error('expected a duplicate stage id to be rejected');
    expect(duplicated.error.flatten().fieldErrors.stageIds).toContain('duplicate_stage_id');
  });

  it('rejects an empty reorder payload and a non-uuid stage id', () => {
    expect(ReorderLeadStagesSchema.safeParse({ stageIds: [] }).success).toBe(false);
    expect(ReorderLeadStagesSchema.safeParse({}).success).toBe(false);
    expect(ReorderLeadStagesSchema.safeParse({ stageIds: ['not-a-uuid'] }).success).toBe(false);
  });
});
