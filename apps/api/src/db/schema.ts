/**
 * Drizzle schema — FXL Sales v1.0 foundation (Phase 01).
 *
 * 9 foundation tables: finders, sellers, apps, products, price_bands,
 * commission_rules, audit_log, webhook_events, leads.
 *
 * Tables deferred to their owning phase:
 *   referral_links (04), clicks (04), conversions (05), commissions (05), payouts (05)
 *
 * FXL conventions:
 *   - id uuid PK DEFAULT gen_random_uuid() (audit_log uses bigserial for chain ordering)
 *   - created_at timestamptz NOT NULL DEFAULT now()
 *   - updated_at timestamptz (nullable; service layer sets new Date() on update — no DB trigger in Phase 01)
 *   - Money: integer (cents) — never numeric/float
 *   - Rates: numeric(5,2) (rates are not money)
 *   - Tenant tables carry org_id text NOT NULL (RLS policy applied in the journaled migration)
 *
 * After editing:
 *   pnpm db:generate     # creates migration in ./drizzle/
 *   pnpm db:migrate      # applies it to DATABASE_URL
 */

import { sql } from 'drizzle-orm';
import {
  bigserial,
  boolean,
  check,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

// ─────────────────────────────────────────────────────────────────────────────
// finders — tenant-scoped by org_id (RLS). One finder = one Clerk org.
// ─────────────────────────────────────────────────────────────────────────────
export const finders = pgTable(
  'finders',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: text('org_id').notNull(), // finder's Clerk org_id ('' placeholder pre-approval — NOT NULL satisfied by empty string)
    // Phase 03: clerk_user_id / clerk_org_id are NULLABLE pre-approval. A finder
    // has no Clerk account/org at public signup; they are backfilled at approval.
    // They stay UNIQUE — Postgres allows multiple NULLs in a unique index, so many
    // pending finders coexist. Inserting '' (the original plan) would violate the
    // unique constraint on the 2nd pending signup — hence NULL, not ''.
    clerkUserId: text('clerk_user_id').unique(),
    clerkOrgId: text('clerk_org_id').unique(),
    status: text('status').notNull(), // 'pending' | 'approved' | 'suspended'
    displayName: text('display_name').notNull(),
    contactEmail: text('contact_email').notNull(),
    cpf: text('cpf'),
    phone: text('phone'),
    pixKey: text('pix_key'),
    pixKeyType: text('pix_key_type'), // 'cpf' | 'email' | 'phone' | 'random'
    payoutAddress: jsonb('payout_address'),
    // LGPD consent (Phase 03 T01, autopilot A2). version-stamped, granular.
    lgpdConsentEssential: boolean('lgpd_consent_essential').notNull().default(false),
    lgpdConsentMarketing: boolean('lgpd_consent_marketing').notNull().default(false),
    lgpdConsentVersion: text('lgpd_consent_version').notNull().default(''),
    lgpdConsentedAt: timestamp('lgpd_consented_at', { withTimezone: true }),
    approvedAt: timestamp('approved_at', { withTimezone: true }),
    approvedByUserId: text('approved_by_user_id'), // admin Clerk user_id
    suspendedAt: timestamp('suspended_at', { withTimezone: true }),
    suspendedReason: text('suspended_reason'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }),
  },
  (t) => [
    // NIT (plan-brief D-R): composite index LEADING on org_id for RLS-filtered tenant reads.
    index('finders_org_id_idx').on(t.orgId, t.status),
  ],
);

// ─────────────────────────────────────────────────────────────────────────────
// sellers — cross-org (FXL employees). No org_id, no RLS.
// ─────────────────────────────────────────────────────────────────────────────
export const sellers = pgTable('sellers', {
  id: uuid('id').primaryKey().defaultRandom(),
  // Phase 03: NULLABLE until the Clerk user.created webhook backfills it
  // (Phase 05). Stays UNIQUE — many invited-but-not-accepted sellers coexist as
  // NULL (Postgres allows multiple NULLs in a unique index). '' would collide on
  // the 2nd unaccepted seller.
  clerkUserId: text('clerk_user_id').unique(),
  displayName: text('display_name').notNull(),
  contactEmail: text('contact_email').notNull(),
  status: text('status').notNull(), // 'active' | 'inactive'
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }),
});

// ─────────────────────────────────────────────────────────────────────────────
// apps — global registry (admin-managed). No org_id, no RLS.
// ─────────────────────────────────────────────────────────────────────────────
export const apps = pgTable('apps', {
  id: uuid('id').primaryKey().defaultRandom(),
  slug: text('slug').notNull().unique(),
  name: text('name').notNull(),
  publishableKey: text('publishable_key').notNull().unique(),
  secretKeyHash: text('secret_key_hash').notNull(),
  secretKeyPrefix: text('secret_key_prefix').notNull(),
  webhookSigningSecret: text('webhook_signing_secret').notNull(),
  allowedRedirectHosts: text('allowed_redirect_hosts').array().notNull(),
  attributionWindowDays: integer('attribution_window_days').notNull().default(30),
  commissionHoldDays: integer('commission_hold_days').notNull().default(30),
  status: text('status').notNull(), // 'active' | 'disabled'
  createdByUserId: text('created_by_user_id').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }),
});

// ─────────────────────────────────────────────────────────────────────────────
// products — global (admin-managed). No org_id, no RLS.
// ─────────────────────────────────────────────────────────────────────────────
export const products = pgTable(
  'products',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    appId: uuid('app_id')
      .notNull()
      .references(() => apps.id),
    slug: text('slug').notNull(),
    name: text('name').notNull(),
    description: text('description'),
    status: text('status').notNull(), // 'active' | 'archived'
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }),
  },
  (t) => [uniqueIndex('products_app_id_slug_idx').on(t.appId, t.slug)],
);

// ─────────────────────────────────────────────────────────────────────────────
// price_bands — per-product (min, list, max) for setup/monthly components. Cents.
// ─────────────────────────────────────────────────────────────────────────────
export const priceBands = pgTable(
  'price_bands',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    productId: uuid('product_id')
      .notNull()
      .references(() => products.id),
    component: text('component').notNull(), // 'setup' | 'monthly'
    minBrl: integer('min_brl').notNull(), // cents
    listBrl: integer('list_brl').notNull(),
    maxBrl: integer('max_brl').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }),
  },
  (t) => [
    uniqueIndex('price_bands_product_component_idx').on(t.productId, t.component),
    check('price_bands_order_check', sql`min_brl <= list_brl AND list_brl <= max_brl`),
  ],
);

// ─────────────────────────────────────────────────────────────────────────────
// commission_rules — per-product flat rates. Rates are numeric(5,2), not money.
// ─────────────────────────────────────────────────────────────────────────────
export const commissionRules = pgTable('commission_rules', {
  id: uuid('id').primaryKey().defaultRandom(),
  productId: uuid('product_id')
    .notNull()
    .references(() => products.id)
    .unique(),
  setupRatePct: numeric('setup_rate_pct', { precision: 5, scale: 2 }).notNull(),
  recurringRatePct: numeric('recurring_rate_pct', { precision: 5, scale: 2 }).notNull(),
  recurringMonths: integer('recurring_months').notNull(),
  basis: text('basis').notNull().default('quoted_net'), // 'quoted_net' | 'list_net'
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }),
});

// ─────────────────────────────────────────────────────────────────────────────
// audit_log — append-only, hash-chained. bigserial PK (chain ordering). No org_id.
// ─────────────────────────────────────────────────────────────────────────────
export const auditLog = pgTable('audit_log', {
  id: bigserial('id', { mode: 'bigint' }).primaryKey(),
  ts: timestamp('ts', { withTimezone: true }).defaultNow().notNull(),
  actorUserId: text('actor_user_id').notNull(), // Clerk user_id or 'system'
  actorOrgId: text('actor_org_id'),
  action: text('action').notNull(),
  entityType: text('entity_type').notNull(),
  entityId: text('entity_id').notNull(),
  beforeJsonb: jsonb('before_jsonb'),
  afterJsonb: jsonb('after_jsonb'),
  requestId: text('request_id'),
  prevHash: text('prev_hash').notNull(), // sha256 of prior row, '0'*64 for row 1
  entryHash: text('entry_hash').notNull(), // sha256(prevHash || canonical_json(row))
});

// ─────────────────────────────────────────────────────────────────────────────
// webhook_events — idempotency + replay defense. Global, no org_id.
// ─────────────────────────────────────────────────────────────────────────────
export const webhookEvents = pgTable(
  'webhook_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    source: text('source').notNull(),
    eventId: text('event_id').notNull(),
    bodyHash: text('body_hash').notNull(),
    signatureValid: boolean('signature_valid').notNull(),
    processedAt: timestamp('processed_at', { withTimezone: true }),
    processingError: text('processing_error'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [uniqueIndex('webhook_events_source_event_id_idx').on(t.source, t.eventId)],
);

// ─────────────────────────────────────────────────────────────────────────────
// leads — tenant-scoped via org_id (RLS). LGPD PII. Soft FKs to Phase 04 tables.
// ─────────────────────────────────────────────────────────────────────────────
export const leads = pgTable(
  'leads',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: text('org_id').notNull(), // finder's org_id for RLS
    clickId: text('click_id'), // soft FK to clicks(click_id) — clicks table Phase 04
    linkId: uuid('link_id'), // soft FK to referral_links(id) — Phase 04
    customerName: text('customer_name'),
    customerEmail: text('customer_email'),
    customerPhone: text('customer_phone'),
    customerCpf: text('customer_cpf'),
    status: text('status').notNull(), // 'clicked' | 'lead' | 'converted' | 'churned'
    anonymizedAt: timestamp('anonymized_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }),
  },
  (t) => [
    // NIT (plan-brief D-R): composite index LEADING on org_id for RLS-filtered tenant reads.
    index('leads_org_id_idx').on(t.orgId, t.status),
  ],
);

// ─────────────────────────────────────────────────────────────────────────────
// referral_links — tenant-scoped by org_id (RLS, D11). One per (finder, product,
// quoted price tuple). Phase 04 OWNS this table. The 10-char `code` is the bearer
// secret for the public /r/[code] redirect (D-E public-lookup policy).
// ─────────────────────────────────────────────────────────────────────────────
export const referralLinks = pgTable(
  'referral_links',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: text('org_id').notNull(), // denormalized from finders.org_id for RLS (D11)
    code: text('code').notNull().unique(), // 10-char ULID suffix (D7) — URL-safe bearer
    finderId: uuid('finder_id')
      .notNull()
      .references(() => finders.id),
    appId: uuid('app_id')
      .notNull()
      .references(() => apps.id),
    productId: uuid('product_id')
      .notNull()
      .references(() => products.id),
    quotedSetupBrl: integer('quoted_setup_brl').notNull(), // cents
    quotedMonthlyBrl: integer('quoted_monthly_brl').notNull(), // cents
    // hmac([finderId,productId,quotedSetup,quotedMonthly].join(":"), app.webhook_signing_secret) (D-P)
    signature: text('signature').notNull(),
    destinationUrl: text('destination_url').notNull(), // resolved host+path at creation
    status: text('status').notNull().default('active'), // 'active' | 'revoked'
    expiresAt: timestamp('expires_at', { withTimezone: true }), // null = never expires
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    revokedReason: text('revoked_reason'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }),
  },
  (t) => [
    uniqueIndex('referral_links_code_idx').on(t.code),
    index('referral_links_finder_id_idx').on(t.finderId, t.createdAt),
  ],
);

// ─────────────────────────────────────────────────────────────────────────────
// clicks — tenant-scoped by org_id (RLS, D10). Append-only (INSERT+SELECT only;
// no updated_at). INSERT happens on the public /r/[code] path with NO tenant
// context (split RLS: clicks_insert_public WITH CHECK(true)). Phase 04 OWNS this.
// ─────────────────────────────────────────────────────────────────────────────
export const clicks = pgTable(
  'clicks',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    clickId: text('click_id').notNull().unique(), // ULID minted at redirect — opaque attribution ID
    orgId: text('org_id').notNull(), // denormalized from referral_links.org_id for RLS (D10)
    linkId: uuid('link_id')
      .notNull()
      .references(() => referralLinks.id),
    finderId: uuid('finder_id').notNull(), // denormalized for fast finder dashboards
    appId: uuid('app_id').notNull(), // denormalized
    productId: uuid('product_id').notNull(), // denormalized
    ipHash: text('ip_hash'), // sha256(ip + daily_salt) first 16 chars (D5)
    uaFamily: text('ua_family'), // 'chrome'|'safari'|'firefox'|'edge'|'opera'|'bot'|'unknown'
    referer: text('referer'),
    utmSource: text('utm_source'),
    utmMedium: text('utm_medium'),
    utmCampaign: text('utm_campaign'),
    country: text('country'), // 2-letter ISO from CF-IPCountry or null
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    // No updated_at — append-only.
  },
  (t) => [
    uniqueIndex('clicks_click_id_idx').on(t.clickId),
    // DESC direction applied in the journaled migration (drizzle-kit index() builder
    // does not emit DESC reliably across pg versions — plan-brief failure-list #3 / D2 note).
    index('clicks_link_id_created_at_idx').on(t.linkId, t.createdAt),
    index('clicks_finder_id_created_at_idx').on(t.finderId, t.createdAt),
  ],
);

// ─────────────────────────────────────────────────────────────────────────────
// conversions — tenant-scoped by org_id (split-RLS, D10). Phase 05 OWNS this.
// INSERT happens on the HMAC webhook path with NO tenant context (split RLS:
// conversions_insert_webhook WITH CHECK(true)); SELECT is org-scoped for finders;
// admin reads bypass RLS via getAdminDb() (D-C). Money = integer cents.
// ─────────────────────────────────────────────────────────────────────────────
export const conversions = pgTable(
  'conversions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    source: text('source').notNull(), // app.slug; e.g. 'fxl-financiero' (D-A)
    externalOrderId: text('external_order_id').notNull(),
    eventType: text('event_type').notNull().default('sale'), // 'sale' | 'refund'
    // sha256(source + external_order_id + event_type) (D11/D-N). UNIQUE = race guard.
    idempotencyKey: text('idempotency_key').notNull().unique(),
    orgId: text('org_id').notNull(), // denormalized from finders.org_id for RLS (D10)
    linkId: uuid('link_id').references(() => referralLinks.id),
    clickId: text('click_id'), // last-touch ULID (nullable — finder_code fallback path)
    finderId: uuid('finder_id')
      .notNull()
      .references(() => finders.id),
    sellerId: uuid('seller_id').references(() => sellers.id),
    appId: uuid('app_id')
      .notNull()
      .references(() => apps.id),
    productId: uuid('product_id')
      .notNull()
      .references(() => products.id),
    quotedSetupBrl: integer('quoted_setup_brl').notNull(), // cents — snapshot from referral_links
    quotedMonthlyBrl: integer('quoted_monthly_brl').notNull(), // cents
    realizedSetupBrl: integer('realized_setup_brl').notNull(), // cents — actual amount charged
    realizedMonthlyBrl: integer('realized_monthly_brl').notNull(), // cents
    customerEmailHash: text('customer_email_hash'), // sha256(email + finder.org_id)
    customerOrgId: text('customer_org_id'), // Clerk org_id in the sibling app
    holdUntil: timestamp('hold_until', { withTimezone: true }).notNull(),
    closedAt: timestamp('closed_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }),
  },
  (t) => [
    uniqueIndex('conversions_source_order_event_idx').on(
      t.source,
      t.externalOrderId,
      t.eventType,
    ),
    // DESC direction applied in the journaled migration (drizzle-kit emits ASC).
    index('conversions_finder_id_created_at_idx').on(t.finderId, t.createdAt),
    index('conversions_org_id_idx').on(t.orgId),
  ],
);

// ─────────────────────────────────────────────────────────────────────────────
// commissions — tenant-scoped by org_id (split-RLS, D10). Phase 05 OWNS this.
// INSERT on webhook path (commissions_insert_webhook WITH CHECK(true)); SELECT
// org-scoped for finders; admin state transitions (lock/reverse/promote) run on
// getAdminDb() BYPASSRLS (D-C) — the app role has NO UPDATE policy/grant.
// amount_brl = integer cents; rate_pct = numeric(5,2) (rates are not money).
// ─────────────────────────────────────────────────────────────────────────────
export const commissions = pgTable(
  'commissions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    conversionId: uuid('conversion_id')
      .notNull()
      .references(() => conversions.id),
    orgId: text('org_id').notNull(), // denormalized from conversions.org_id for RLS (D10)
    finderId: uuid('finder_id')
      .notNull()
      .references(() => finders.id),
    appId: uuid('app_id')
      .notNull()
      .references(() => apps.id),
    productId: uuid('product_id')
      .notNull()
      .references(() => products.id),
    kind: text('kind').notNull(), // 'setup' | 'recurring'
    basisBrl: integer('basis_brl').notNull(), // realized_*_brl the commission was calculated against
    ratePct: numeric('rate_pct', { precision: 5, scale: 2 }).notNull(), // snapshot from commission_rules
    amountBrl: integer('amount_brl').notNull(), // floor(basis_brl * rate_pct / 100) — int cents
    status: text('status').notNull().default('pending'), // 'pending'|'approved'|'locked'|'paid'|'reversed'
    holdUntil: timestamp('hold_until', { withTimezone: true }).notNull(),
    approvedAt: timestamp('approved_at', { withTimezone: true }),
    approvedByUserId: text('approved_by_user_id'),
    lockedAt: timestamp('locked_at', { withTimezone: true }),
    paidAt: timestamp('paid_at', { withTimezone: true }),
    paidPayoutId: uuid('paid_payout_id'), // FK -> payouts(id), hard FK added in migration (circular)
    reversedAt: timestamp('reversed_at', { withTimezone: true }),
    reversedReason: text('reversed_reason'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }),
  },
  (t) => [
    index('commissions_finder_id_status_idx').on(t.finderId, t.status),
    index('commissions_status_hold_until_idx').on(t.status, t.holdUntil), // nightly promotion query
  ],
);

// ─────────────────────────────────────────────────────────────────────────────
// payouts — admin-managed cross-tenant (NO RLS, like apps/products). Phase 05
// OWNS this single table (D-Q). commissions.paid_payout_id references it. Admin
// reads/writes via getAdminDb() (BYPASSRLS, D-C); finder reads own via join.
// ─────────────────────────────────────────────────────────────────────────────
export const payouts = pgTable('payouts', {
  id: uuid('id').primaryKey().defaultRandom(),
  finderId: uuid('finder_id')
    .notNull()
    .references(() => finders.id),
  totalBrl: integer('total_brl').notNull(), // cents
  status: text('status').notNull().default('draft'), // 'draft'|'exported'|'paid'|'voided'
  csvExportId: uuid('csv_export_id'),
  exportedAt: timestamp('exported_at', { withTimezone: true }),
  paidAt: timestamp('paid_at', { withTimezone: true }),
  paidByUserId: text('paid_by_user_id'),
  note: text('note'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }),
});
