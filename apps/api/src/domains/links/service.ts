import { and, desc, eq, inArray, lt, sql } from 'drizzle-orm';
import { ulid } from 'ulidx';
import { z } from 'zod';
import { signHmac } from '@fxl-sales/shared-utils';
import type { getDb } from '../../db/client.js';
import { setTenantContext } from '../../middleware/auth.js';
import { apps, clicks, finders, priceBands, products, referralLinks } from '../../db/schema.js';

/**
 * Links domain service (Phase 04, T04).
 *
 * referral_links + clicks are tenant-scoped (FORCE RLS). Every tenant-scoped fn
 * wraps its work in `db.transaction(async (tx) => { await setTenantContext(tx,
 * orgId); ... })` (plan-brief D-D - connection-level set_config does not survive
 * pooling). All take the verified auth subject and resolve it to the finders.id
 * UUID via resolveFinderId before touching finder_id.
 */

type Db = ReturnType<typeof getDb>;
type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];
export type ReferralLinkRow = typeof referralLinks.$inferSelect;
export type ClickRow = typeof clicks.$inferSelect;

// ─────────────────────────────────────────────────────────────────────────────
// Zod schemas
// ─────────────────────────────────────────────────────────────────────────────

export const CreateLinkSchema = z.object({
  appId: z.string().uuid(),
  productId: z.string().uuid(),
  quotedSetupBrl: z.number().int().nonnegative(),
  quotedMonthlyBrl: z.number().int().nonnegative(),
});

export const RevokeLinkSchema = z.object({
  reason: z.string().min(1).max(255).optional(),
});

export type CreateLinkInput = z.infer<typeof CreateLinkSchema>;

// ─────────────────────────────────────────────────────────────────────────────
// Pure helpers (unit-tested in __tests__/service.test.ts)
// ─────────────────────────────────────────────────────────────────────────────

/** Inclusive band check: minBrl <= quotedBrl <= maxBrl. */
export function validatePriceBand(band: { minBrl: number; maxBrl: number }, quotedBrl: number): boolean {
  return quotedBrl >= band.minBrl && quotedBrl <= band.maxBrl;
}

/**
 * link.signature (plan-brief D-P): hmac([finderId,productId,setup,monthly].join(":"),
 * webhookSigningSecret). `finderId` MUST be the finders.id UUID so the signature
 * is stable and Phase 05-verifiable.
 */
export function buildLinkSignature(
  finderId: string,
  productId: string,
  quotedSetupBrl: number,
  quotedMonthlyBrl: number,
  webhookSigningSecret: string,
): string {
  return signHmac(
    webhookSigningSecret,
    [finderId, productId, quotedSetupBrl, quotedMonthlyBrl].join(':'),
  );
}

/** 10-char URL-safe code = last 10 chars of a lowercased ULID (D7). */
export function buildLinkCode(): string {
  return ulid().toLowerCase().slice(-10);
}

/**
 * Open-redirect defense (D9 / plan-brief WARN): EXACT host equality against the
 * allowed-hosts list. NEVER substring/.includes()/endsWith() - a near-match like
 * `evil-fxl.com.br` or `fxl.com.br.attacker.com` MUST be rejected. Throws if the
 * URL is unparseable.
 */
export function validateDestinationHost(destinationUrl: string, allowedHosts: string[]): boolean {
  const host = new URL(destinationUrl).host; // throws on bad URL (intentional)
  return allowedHosts.some((entry) => host === entry);
}

// ─────────────────────────────────────────────────────────────────────────────
// resolveFinderId - auth subject/workspace -> finders.id UUID
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Resolves the authenticated subject to the finders.id UUID. Runs INSIDE
 * the caller's tenant transaction so it is org-isolated. Hub mode falls back to
 * the preserved workspace id so org-keyed finder data survives without a re-key.
 * Throws
 * Error('finder_not_found') when no approved finders row matches (route -> 403).
 */
export async function resolveFinderId(tx: Tx, authSubject: string, orgId?: string): Promise<string> {
  const rows = await tx
    .select({ id: finders.id })
    .from(finders)
    .where(eq(finders.clerkUserId, authSubject))
    .limit(1);
  let row = rows[0];
  if (!row && orgId) {
    const orgRows = await tx
      .select({ id: finders.id })
      .from(finders)
      .where(eq(finders.orgId, orgId))
      .limit(1);
    row = orgRows[0];
  }
  if (!row) {
    throw new Error('finder_not_found');
  }
  return row.id;
}

// ─────────────────────────────────────────────────────────────────────────────
// Tenant-scoped service fns (D-D: wrap in transaction + setTenantContext)
// ─────────────────────────────────────────────────────────────────────────────

const CANONICAL_PRICING_PATH = '/precos';

export async function createLink(
  db: Db,
  authSubject: string,
  orgId: string,
  input: CreateLinkInput,
): Promise<ReferralLinkRow> {
  return db.transaction(async (tx) => {
    await setTenantContext(tx, orgId);
    const finderId = await resolveFinderId(tx, authSubject, orgId);

    // App must exist + be active. apps/products/price_bands have NO RLS — readable
    // on the app role; reading them inside the tenant tx is harmless.
    const [app] = await tx.select().from(apps).where(eq(apps.id, input.appId)).limit(1);
    if (!app || app.status !== 'active') {
      throw new Error('app_not_found');
    }

    const [product] = await tx
      .select()
      .from(products)
      .where(and(eq(products.id, input.productId), eq(products.appId, input.appId)))
      .limit(1);
    if (!product) {
      throw new Error('product_not_found');
    }

    const bands = await tx
      .select()
      .from(priceBands)
      .where(eq(priceBands.productId, input.productId));
    const setupBand = bands.find((b) => b.component === 'setup');
    const monthlyBand = bands.find((b) => b.component === 'monthly');
    if (!setupBand || !monthlyBand) {
      throw new Error('product_not_found'); // bands unconfigured → treat as not-bookable
    }

    if (!validatePriceBand(setupBand, input.quotedSetupBrl)) {
      throw new Error('quoted_setup_out_of_band');
    }
    if (!validatePriceBand(monthlyBand, input.quotedMonthlyBrl)) {
      throw new Error('quoted_monthly_out_of_band');
    }

    if (!app.allowedRedirectHosts || app.allowedRedirectHosts.length === 0) {
      throw new Error('app_redirect_hosts_unconfigured');
    }

    // D8 / plan-brief D-P: canonical host = allowed_redirect_hosts[0], canonical
    // path = /precos. The ?ref / ?fxl_sig params are appended at redirect time.
    const destinationUrl = 'https://' + app.allowedRedirectHosts[0] + CANONICAL_PRICING_PATH;

    const signature = buildLinkSignature(
      finderId,
      product.id,
      input.quotedSetupBrl,
      input.quotedMonthlyBrl,
      app.webhookSigningSecret,
    );
    const code = buildLinkCode();

    const [row] = await tx
      .insert(referralLinks)
      .values({
        orgId,
        code,
        finderId,
        appId: input.appId,
        productId: input.productId,
        quotedSetupBrl: input.quotedSetupBrl,
        quotedMonthlyBrl: input.quotedMonthlyBrl,
        signature,
        destinationUrl,
        status: 'active',
      })
      .returning();
    if (!row) {
      throw new Error('link_insert_failed');
    }
    return row;
  });
}

export async function listFinderLinks(
  db: Db,
  orgId: string,
  authSubject: string,
): Promise<ReferralLinkRow[]> {
  return db.transaction(async (tx) => {
    await setTenantContext(tx, orgId);
    const finderId = await resolveFinderId(tx, authSubject, orgId);
    return tx
      .select()
      .from(referralLinks)
      .where(eq(referralLinks.finderId, finderId))
      .orderBy(desc(referralLinks.createdAt));
  });
}

export async function revokeLink(
  db: Db,
  linkId: string,
  orgId: string,
  authSubject: string,
  reason?: string,
): Promise<void> {
  await db.transaction(async (tx) => {
    await setTenantContext(tx, orgId);
    const finderId = await resolveFinderId(tx, authSubject, orgId);
    const updated = await tx
      .update(referralLinks)
      .set({ status: 'revoked', revokedAt: new Date(), revokedReason: reason ?? null })
      .where(
        and(
          eq(referralLinks.id, linkId),
          eq(referralLinks.finderId, finderId),
          eq(referralLinks.orgId, orgId),
        ),
      )
      .returning({ id: referralLinks.id });
    if (updated.length === 0) {
      throw new Error('link_not_found');
    }
  });
}

export async function getFinderClickStats(
  db: Db,
  orgId: string,
  authSubject: string,
): Promise<{ total: number; unique: number }> {
  return db.transaction(async (tx) => {
    await setTenantContext(tx, orgId);
    const finderId = await resolveFinderId(tx, authSubject, orgId);
    const rows = await tx
      .select({
        total: sql<number>`count(*)::int`,
        unique: sql<number>`count(distinct ${clicks.ipHash})::int`,
      })
      .from(clicks)
      .where(eq(clicks.finderId, finderId));
    const row = rows[0];
    return { total: row?.total ?? 0, unique: row?.unique ?? 0 };
  });
}

export async function listFinderClicks(
  db: Db,
  orgId: string,
  authSubject: string,
  opts: { linkId?: string; limit?: number; cursor?: string },
): Promise<{ clicks: ClickRow[]; nextCursor: string | null }> {
  return db.transaction(async (tx) => {
    await setTenantContext(tx, orgId);
    const finderId = await resolveFinderId(tx, authSubject, orgId);
    const limit = Math.min(opts.limit ?? 50, 100);

    const conditions = [eq(clicks.finderId, finderId)];
    if (opts.linkId) {
      conditions.push(eq(clicks.linkId, opts.linkId));
    }
    if (opts.cursor) {
      conditions.push(lt(clicks.createdAt, new Date(opts.cursor)));
    }

    const rows = await tx
      .select()
      .from(clicks)
      .where(and(...conditions))
      .orderBy(desc(clicks.createdAt))
      .limit(limit);

    const nextCursor =
      rows.length === limit && rows[rows.length - 1]
        ? rows[rows.length - 1]!.createdAt.toISOString()
        : null;
    return { clicks: rows, nextCursor };
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Finder catalog reads (apps/products have NO RLS — read on the app role, NO
// setTenantContext). Expose ONLY display fields (never secrets).
// ─────────────────────────────────────────────────────────────────────────────

export type FinderAppRow = { id: string; name: string; slug: string };

export async function listActiveAppsForFinder(db: Db): Promise<FinderAppRow[]> {
  const rows = await db
    .select({ id: apps.id, name: apps.name, slug: apps.slug })
    .from(apps)
    .where(eq(apps.status, 'active'))
    .orderBy(apps.name);
  return rows;
}

export type FinderProductRow = {
  id: string;
  name: string;
  slug: string;
  setupBand: { minBrl: number; listBrl: number; maxBrl: number } | null;
  monthlyBand: { minBrl: number; listBrl: number; maxBrl: number } | null;
};

export async function listActiveProductsForFinder(
  db: Db,
  appId: string,
): Promise<FinderProductRow[]> {
  const prods = await db
    .select({ id: products.id, name: products.name, slug: products.slug })
    .from(products)
    .where(and(eq(products.appId, appId), eq(products.status, 'active')))
    .orderBy(products.name);

  if (prods.length === 0) {
    return [];
  }

  // Batch all bands in ONE query (avoid N+1 per product).
  const allBands = await db
    .select()
    .from(priceBands)
    .where(
      inArray(
        priceBands.productId,
        prods.map((p) => p.id),
      ),
    );

  return prods.map((p) => {
    const bands = allBands.filter((b) => b.productId === p.id);
    const setup = bands.find((b) => b.component === 'setup');
    const monthly = bands.find((b) => b.component === 'monthly');
    return {
      id: p.id,
      name: p.name,
      slug: p.slug,
      setupBand: setup
        ? { minBrl: setup.minBrl, listBrl: setup.listBrl, maxBrl: setup.maxBrl }
        : null,
      monthlyBand: monthly
        ? { minBrl: monthly.minBrl, listBrl: monthly.listBrl, maxBrl: monthly.maxBrl }
        : null,
    };
  });
}
