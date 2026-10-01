import type {
  HubInvitationLocale,
  HubInvitationResult,
  HubInvitationStatus,
} from '@fxl-business/hub-sdk/server';
import { desc, eq } from 'drizzle-orm';
import { getAdminDb } from '../../db/client.js';
import { sellers } from '../../db/schema.js';
import {
  INVITATION_COPY,
  INVITATIONS_UNAVAILABLE,
  isHubInvitationError,
  mapInvitationError,
} from './invitation-error.js';
import { getInvitationsClient } from './invitations-client.js';

/**
 * Admin sellers service (Phase 03 T04, invitations in v4.1.0).
 *
 * `sellers` is admin-managed cross-tenant (no RLS). Uses getAdminDb() (D-H/D-C)
 * for consistency with the other admin routes; setTenantContext is NEVER called.
 *
 * Hub ACCOUNT provisioning is still operator-owned, so account_id remains
 * nullable. Invitation DELIVERY is now owned by Sales: creating a seller sends a
 * real Hub invitation through `createHubInvitations` (the slice 07 seam), which
 * reverses the earlier "invitation delivery lives in Hub operator workflows"
 * stance. See the Capture ADR of the hub-sdk-25-switch-account-invites run in
 * nexo/knowledge/decisions/.
 *
 * Rules held here:
 * - The actor token is the admin's raw `Authorization` bearer, threaded from the
 *   route handler. It is never read from a body or from `hubAuth`.
 * - The invite grants exactly `['seller']` and never names an Organization: the
 *   Hub takes it from the actor token. `invited_org_id` records the verified
 *   context org the route passes in.
 * - An invite failure never rolls back the seller row; the outcome travels back
 *   so the admin can resend.
 * - `acceptUrl` is returned to the caller and never logged.
 */

export type SellerRow = typeof sellers.$inferSelect;
export type SellerStatus = 'active' | 'inactive';

/** The admin's verified request context, threaded from the route handler. */
export type InviteActor = {
  /** The raw bearer from `Authorization`, never from a body or `hubAuth`. */
  accessToken: string;
  /** `c.get('orgId')`: the admin's active Organization, the invite's target. */
  orgId: string;
};

/** What a create/resend answers about the email, minus the invitation itself. */
export type InvitationDelivery = Pick<
  HubInvitationResult,
  'invitation' | 'acceptUrl' | 'emailDelivery' | 'warnings'
>;

/**
 * A failed invite, as an HTTP status plus the mapped body. The body fields are
 * those of `mapInvitationError` or `INVITATIONS_UNAVAILABLE`; nothing here is
 * SDK prose.
 */
export type InviteFailure = {
  httpStatus: number;
  body: { error: string; code: string; message?: string };
  retryAfterSeconds?: number;
};

export type InviteOutcome = { ok: true; delivery: InvitationDelivery } | { ok: false; failure: InviteFailure };

const UNAVAILABLE: InviteFailure = {
  httpStatus: INVITATIONS_UNAVAILABLE.httpStatus,
  body: { ...INVITATIONS_UNAVAILABLE.body },
};

const NOT_INVITED: InviteFailure = {
  httpStatus: 409,
  body: { error: 'conflict', code: 'seller_not_invited' },
};

const INVITATION_STATUSES: readonly HubInvitationStatus[] = ['pending', 'accepted', 'expired', 'revoked'];

/**
 * The one translation of a thrown invite error. A `HubInvitationError` goes
 * through `mapInvitationError` (keyed on its code). Anything else is a defect on
 * this side: only its NAME is logged, because a message could quote a URL.
 */
function toInviteFailure(error: unknown, operation: string): InviteFailure {
  if (isHubInvitationError(error)) {
    const mapped = mapInvitationError(error);
    return {
      httpStatus: mapped.httpStatus,
      body: { ...mapped.body },
      ...(mapped.retryAfterSeconds !== undefined ? { retryAfterSeconds: mapped.retryAfterSeconds } : {}),
    };
  }
  console.error(
    `[sellers] Invitation ${operation} failed:`,
    error instanceof Error ? error.name : typeof error,
  );
  return {
    httpStatus: 500,
    body: { error: 'internal_error', code: 'unknown', message: INVITATION_COPY.configurationDefect },
  };
}

function deliveryOf(result: HubInvitationResult): InvitationDelivery {
  return {
    invitation: result.invitation,
    acceptUrl: result.acceptUrl,
    emailDelivery: result.emailDelivery,
    warnings: result.warnings,
  };
}

async function updateSeller(sellerId: string, patch: Partial<SellerRow>): Promise<SellerRow | null> {
  const db = getAdminDb();
  const [seller] = await db
    .update(sellers)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(sellers.id, sellerId))
    .returning();
  return seller ?? null;
}

async function findSeller(sellerId: string): Promise<SellerRow | null> {
  const db = getAdminDb();
  const [seller] = await db.select().from(sellers).where(eq(sellers.id, sellerId)).limit(1);
  return seller ?? null;
}

/**
 * Every Hub invitation of the actor's Organization, keyed by id, or null when
 * nothing could be read. The Hub's `list` answers ONE status per call (its
 * default is `pending`), so `accepted` and `expired` are only visible when asked
 * for: one call per status. A status whose call fails is simply not reconciled.
 */
async function readHubInvitationStatuses(accessToken: string): Promise<Map<string, HubInvitationStatus> | null> {
  const client = getInvitationsClient();
  if (!client) return null;

  const settled = await Promise.allSettled(
    INVITATION_STATUSES.map((status) => client.list({ accessToken, status })),
  );
  const statuses = new Map<string, HubInvitationStatus>();
  let anyRead = false;
  for (const outcome of settled) {
    if (outcome.status === 'fulfilled') {
      anyRead = true;
      for (const invitation of outcome.value.invitations) statuses.set(invitation.id, invitation.status);
    } else {
      const reason = outcome.reason;
      console.warn(
        '[sellers] Could not read Hub invitations; keeping the persisted state:',
        isHubInvitationError(reason) ? reason.code : reason instanceof Error ? reason.name : typeof reason,
      );
    }
  }
  return anyRead ? statuses : null;
}

/**
 * Lists sellers, reconciling each stored invitation's status with the Hub's
 * current state first. This is the ONLY place `accepted` and `expired` are
 * written. Without a client, or when the Hub cannot be read, the persisted
 * status is the answer.
 */
export async function listSellers(actor: Pick<InviteActor, 'accessToken'>): Promise<SellerRow[]> {
  const db = getAdminDb();
  const rows = await db.select().from(sellers).orderBy(desc(sellers.createdAt));

  if (!rows.some((row) => row.invitationId)) return rows;
  const hubStatuses = await readHubInvitationStatuses(actor.accessToken);
  if (!hubStatuses) return rows;

  const reconciled: SellerRow[] = [];
  for (const row of rows) {
    const hubStatus = row.invitationId ? hubStatuses.get(row.invitationId) : undefined;
    if (hubStatus && hubStatus !== row.invitationStatus) {
      reconciled.push((await updateSeller(row.id, { invitationStatus: hubStatus })) ?? row);
    } else {
      reconciled.push(row);
    }
  }
  return reconciled;
}

export async function createSellerAndInvite(
  input: { displayName: string; contactEmail: string; locale: HubInvitationLocale },
  actor: InviteActor,
): Promise<{ seller: SellerRow; invite: InviteOutcome }> {
  const db = getAdminDb();

  const [inserted] = await db
    .insert(sellers)
    .values({
      accountId: null,
      displayName: input.displayName,
      contactEmail: input.contactEmail,
      status: 'active',
    })
    .returning();

  if (!inserted) throw new Error('seller_insert_failed');

  const client = getInvitationsClient();
  if (!client) return { seller: inserted, invite: { ok: false, failure: UNAVAILABLE } };

  let result: HubInvitationResult;
  try {
    result = await client.create({
      accessToken: actor.accessToken,
      email: input.contactEmail,
      appRoles: ['seller'],
      locale: input.locale,
    });
  } catch (error) {
    // The seller stays: the admin resends from the list.
    return { seller: inserted, invite: { ok: false, failure: toInviteFailure(error, 'create') } };
  }

  const seller =
    (await updateSeller(inserted.id, {
      invitationId: result.invitation.id,
      invitationStatus: 'pending',
      invitedOrgId: actor.orgId,
    })) ?? inserted;

  return { seller, invite: { ok: true, delivery: deliveryOf(result) } };
}

export type InvitationActionResult<T> =
  | { kind: 'ok'; seller: SellerRow; value: T }
  | { kind: 'not_found' }
  | { kind: 'failed'; failure: InviteFailure };

/**
 * Shared preamble of resend and revoke: client, seller, stored invitation id.
 *
 * A seller whose invitation was sent from ANOTHER Organization answers exactly
 * like an unknown seller (`not_found`) and never reaches the Hub: the admin's
 * verified org (`actor.orgId`, from `c.get('orgId')`) is the only one whose
 * invitations this route may touch, and a distinct answer would leak that the
 * seller exists elsewhere. A `null` `invitedOrgId` (rows invited before the
 * column existed) is not refused here; the Hub still scopes by the actor token.
 */
async function withStoredInvitation<T>(
  sellerId: string,
  actor: Pick<InviteActor, 'orgId'>,
  run: (
    client: NonNullable<ReturnType<typeof getInvitationsClient>>,
    seller: SellerRow & { invitationId: string },
  ) => Promise<InvitationActionResult<T>>,
): Promise<InvitationActionResult<T>> {
  const client = getInvitationsClient();
  if (!client) return { kind: 'failed', failure: UNAVAILABLE };
  const seller = await findSeller(sellerId);
  if (!seller) return { kind: 'not_found' };
  if (seller.invitedOrgId !== null && seller.invitedOrgId !== actor.orgId) {
    return { kind: 'not_found' };
  }
  const invitationId = seller.invitationId;
  if (!invitationId) return { kind: 'failed', failure: NOT_INVITED };
  return run(client, { ...seller, invitationId });
}

export async function resendInvitation(
  sellerId: string,
  actor: InviteActor,
  locale: HubInvitationLocale,
): Promise<InvitationActionResult<InvitationDelivery>> {
  return withStoredInvitation(sellerId, actor, async (client, seller) => {
    let result: HubInvitationResult;
    try {
      result = await client.resend({ accessToken: actor.accessToken, invitationId: seller.invitationId, locale });
    } catch (error) {
      return { kind: 'failed', failure: toInviteFailure(error, 'resend') };
    }
    const updated =
      (await updateSeller(seller.id, {
        invitationId: result.invitation.id,
        invitationStatus: result.invitation.status,
      })) ?? seller;
    return { kind: 'ok', seller: updated, value: deliveryOf(result) };
  });
}

export async function revokeInvitation(
  sellerId: string,
  actor: InviteActor,
): Promise<InvitationActionResult<null>> {
  return withStoredInvitation(sellerId, actor, async (client, seller) => {
    try {
      await client.revoke({ accessToken: actor.accessToken, invitationId: seller.invitationId });
    } catch (error) {
      return { kind: 'failed', failure: toInviteFailure(error, 'revoke') };
    }
    const updated = (await updateSeller(seller.id, { invitationStatus: 'revoked' })) ?? seller;
    return { kind: 'ok', seller: updated, value: null };
  });
}

export async function setSellerStatus(
  sellerId: string,
  status: SellerStatus,
): Promise<SellerRow | null> {
  return updateSeller(sellerId, { status });
}
