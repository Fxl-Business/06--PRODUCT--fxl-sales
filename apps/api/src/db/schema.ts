/**
 * Drizzle schema — FXL Finders v1.0 foundation (Phase 01).
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
    clerkUserId: text('clerk_user_id').notNull().unique(),
    clerkOrgId: text('clerk_org_id').notNull().unique(),
    status: text('status').notNull(), // 'pending' | 'approved' | 'suspended'
    displayName: text('display_name').notNull(),
    contactEmail: text('contact_email').notNull(),
    cpf: text('cpf'),
    phone: text('phone'),
    pixKey: text('pix_key'),
    pixKeyType: text('pix_key_type'), // 'cpf' | 'email' | 'phone' | 'random'
    payoutAddress: jsonb('payout_address'),
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
  clerkUserId: text('clerk_user_id').notNull().unique(),
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
