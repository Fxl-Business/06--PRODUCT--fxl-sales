import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { and, eq, inArray } from 'drizzle-orm';

// Mock the Clerk singleton BEFORE importing the service (D-I — service imports
// clerkClient from ../../lib/clerk.js). The mock lets us assert org/invite calls.
// vi.hoisted lets the factory (hoisted to top-of-file) reference these fns.
const { createOrganization, createInvitation } = vi.hoisted(() => ({
  createOrganization: vi.fn<() => Promise<{ id: string }>>(async () => ({
    id: 'org_test_generated',
  })),
  createInvitation: vi.fn<() => Promise<{ id: string }>>(async () => ({ id: 'inv_test' })),
}));
vi.mock('../../../lib/clerk.js', () => ({
  clerkClient: {
    organizations: { createOrganization },
    invitations: { createInvitation },
  },
}));

import { getAdminDb } from '../../../db/client.js';
import { auditLog, finders } from '../../../db/schema.js';
import { FinderStateError, approveFinder, suspendFinder } from '../admin-service.js';

const ADMIN_USER = 'user_admin_test';
const TEST_PREFIX = 'sm-test-';
const seededIds: string[] = [];

function must<T>(v: T | undefined): T {
  if (v === undefined) throw new Error('expected a row, got undefined');
  return v;
}

async function seedFinder(status: 'pending' | 'approved' | 'suspended'): Promise<string> {
  const db = getAdminDb();
  const unique = `${TEST_PREFIX}${crypto.randomUUID()}`;
  const [row] = await db
    .insert(finders)
    .values({
      orgId: status === 'pending' ? '' : `org_${unique}`,
      clerkUserId: null,
      clerkOrgId: status === 'pending' ? null : `org_clerk_${unique}`,
      status,
      displayName: `Finder ${unique}`,
      contactEmail: `${unique}@example.com`,
      lgpdConsentEssential: true,
      lgpdConsentMarketing: false,
      lgpdConsentVersion: 'v1.0',
      lgpdConsentedAt: new Date(),
    })
    .returning({ id: finders.id });
  const id = must(row).id;
  seededIds.push(id);
  return id;
}

beforeEach(() => {
  createOrganization.mockClear();
  createInvitation.mockClear();
  createInvitation.mockResolvedValue({ id: 'inv_test' });
});

afterEach(async () => {
  const db = getAdminDb();
  if (seededIds.length) {
    await db.delete(auditLog).where(inArray(auditLog.entityId, seededIds));
    await db.delete(finders).where(inArray(finders.id, seededIds));
    seededIds.length = 0;
  }
});

afterAll(async () => {
  const { closeDb } = await import('../../../db/client.js');
  await closeDb();
});

describe('approveFinder', () => {
  it('pending → approved happy path: flips status, backfills org ids, invites once, audits', async () => {
    const id = await seedFinder('pending');
    const res = await approveFinder(id, ADMIN_USER);
    expect(res).toEqual({ id, status: 'approved' });

    const db = getAdminDb();
    const [rawRow] = await db.select().from(finders).where(eq(finders.id, id)).limit(1);
    const row = must(rawRow);
    expect(row.status).toBe('approved');
    expect(row.clerkOrgId).toBe('org_test_generated');
    expect(row.orgId).toBe('org_test_generated');
    expect(row.approvedByUserId).toBe(ADMIN_USER);
    expect(row.approvedAt).toBeInstanceOf(Date);

    expect(createOrganization).toHaveBeenCalledTimes(1);
    expect(createInvitation).toHaveBeenCalledTimes(1);

    const audits = await db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.entityId, id), eq(auditLog.action, 'finder.approved')));
    expect(audits.length).toBe(1);
  });

  it('rejects approve when status !== pending (suspended → invalid_state, no org, no invite)', async () => {
    const id = await seedFinder('suspended');
    await expect(approveFinder(id, ADMIN_USER)).rejects.toMatchObject({
      code: 'invalid_state',
    });
    expect(createOrganization).not.toHaveBeenCalled();
    expect(createInvitation).not.toHaveBeenCalled();
  });

  it('double-approve is idempotent: exactly one Clerk org + one invite total', async () => {
    const id = await seedFinder('pending');
    await approveFinder(id, ADMIN_USER);
    const second = await approveFinder(id, ADMIN_USER);
    expect(second).toEqual({ id, status: 'approved' });
    // org created once on the first call; second call short-circuits (already approved)
    expect(createOrganization).toHaveBeenCalledTimes(1);
    expect(createInvitation).toHaveBeenCalledTimes(1);
  });

  it('invite-send failure: throws invite_send_failed but persists status/org (retry-safe)', async () => {
    const id = await seedFinder('pending');
    createInvitation.mockRejectedValueOnce(new Error('clerk down'));

    await expect(approveFinder(id, ADMIN_USER)).rejects.toBeInstanceOf(FinderStateError);

    const db = getAdminDb();
    const [rawRow] = await db.select().from(finders).where(eq(finders.id, id)).limit(1);
    const row = must(rawRow);
    expect(row.status).toBe('approved');
    expect(row.clerkOrgId).toBe('org_test_generated');

    // Retry: does NOT create a second org; returns approved row.
    const retry = await approveFinder(id, ADMIN_USER);
    expect(retry.status).toBe('approved');
    expect(createOrganization).toHaveBeenCalledTimes(1);
  });
});

describe('suspendFinder', () => {
  it('suspending a pending finder throws invalid_state', async () => {
    const id = await seedFinder('pending');
    await expect(suspendFinder(id, ADMIN_USER, 'fraude')).rejects.toMatchObject({
      code: 'invalid_state',
    });
  });

  it('suspending an approved finder sets status + reason + audits', async () => {
    const id = await seedFinder('approved');
    const res = await suspendFinder(id, ADMIN_USER, 'violação de termos');
    expect(res).toEqual({ id, status: 'suspended' });

    const db = getAdminDb();
    const [rawRow] = await db.select().from(finders).where(eq(finders.id, id)).limit(1);
    const row = must(rawRow);
    expect(row.status).toBe('suspended');
    expect(row.suspendedReason).toBe('violação de termos');
    expect(row.suspendedAt).toBeInstanceOf(Date);

    const audits = await db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.entityId, id), eq(auditLog.action, 'finder.suspended')));
    expect(audits.length).toBe(1);
  });

  it('suspending an already-suspended finder is an idempotent no-op', async () => {
    const id = await seedFinder('suspended');
    const res = await suspendFinder(id, ADMIN_USER, 'again');
    expect(res).toEqual({ id, status: 'suspended' });
  });
});
