/**
 * Admin domain types (Phase 02). Mirror the API response shapes from
 * apps/api/src/domains/admin/{apps,products}/service.ts.
 */

export type AppStatus = 'active' | 'disabled';

export interface AppRow {
  id: string;
  slug: string;
  name: string;
  publishableKey: string;
  secretKeyPrefix: string;
  // secretKeyHash + webhookSigningSecret are NEVER sent to the client.
  allowedRedirectHosts: string[];
  attributionWindowDays: number;
  commissionHoldDays: number;
  status: AppStatus;
  createdByUserId: string;
  createdAt: string;
  updatedAt: string | null;
}

export interface CreateAppBody {
  slug: string;
  name: string;
  allowedRedirectHosts: string[];
  attributionWindowDays: number;
  commissionHoldDays: number;
}

export type UpdateAppBody = Partial<Omit<CreateAppBody, 'slug'>>;

export type ProductStatus = 'active' | 'archived';
export type PriceBandComponent = 'setup' | 'monthly';
export type CommissionBasis = 'quoted_net' | 'list_net';

export interface ProductRow {
  id: string;
  appId: string;
  slug: string;
  name: string;
  description: string | null;
  status: ProductStatus;
  createdAt: string;
  updatedAt: string | null;
}

export interface ProductListRow extends ProductRow {
  appName: string;
  appSlug: string;
}

export interface PriceBand {
  id: string;
  productId: string;
  component: PriceBandComponent;
  minBrl: number;
  listBrl: number;
  maxBrl: number;
  createdAt: string;
  updatedAt: string | null;
}

export interface CommissionRule {
  id: string;
  productId: string;
  setupRatePct: string;
  recurringRatePct: string;
  recurringMonths: number;
  basis: CommissionBasis;
  createdAt: string;
  updatedAt: string | null;
}

export interface CreateProductBody {
  appId: string;
  slug: string;
  name: string;
  description?: string;
  status?: ProductStatus;
}

export type UpdateProductBody = Partial<Omit<CreateProductBody, 'appId'>>;

export interface UpsertPriceBandBody {
  minBrl: number;
  listBrl: number;
  maxBrl: number;
}

export interface UpsertCommissionRuleBody {
  setupRatePct: number;
  recurringRatePct: number;
  recurringMonths: number;
  basis: CommissionBasis;
}

// ─── Phase 03: finders + sellers ────────────────────────────────────────────

export type FinderStatus = 'pending' | 'approved' | 'suspended';

export interface FinderRow {
  id: string;
  orgId: string;
  clerkUserId: string | null;
  clerkOrgId: string | null;
  status: FinderStatus;
  displayName: string;
  contactEmail: string;
  cpfMasked: string | null;
  phone: string | null;
  pixKey: string | null;
  pixKeyType: string | null;
  payoutAddress: unknown;
  lgpdConsentEssential: boolean;
  lgpdConsentMarketing: boolean;
  lgpdConsentVersion: string;
  lgpdConsentedAt: string | null;
  approvedAt: string | null;
  approvedByUserId: string | null;
  suspendedAt: string | null;
  suspendedReason: string | null;
  createdAt: string;
  updatedAt: string | null;
}

export interface FinderListResponse {
  items: FinderRow[];
  nextCursor: string | null;
}

export type SellerStatus = 'active' | 'inactive';

export interface SellerRow {
  id: string;
  clerkUserId: string | null;
  displayName: string;
  contactEmail: string;
  status: SellerStatus;
  createdAt: string;
  updatedAt: string | null;
}

export interface CreateSellerBody {
  displayName: string;
  contactEmail: string;
}
