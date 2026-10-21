import type { MiddlewareHandler } from 'hono';
import { modulesAllowCapability } from '@fxl-sales/shared-utils/crm-model';
import type { SalesCapability } from '@fxl-sales/shared-utils/sales-edition';
import { getOrgModules } from '../domains/org-modules/context.js';

/**
 * The one 403 body an edition-gated route answers. Distinct from the SDK's
 * `{"error":"forbidden"}` and from `ADMIN_ROLE_REQUIRED_BODY` so a client and a
 * log line can tell "your edition does not include this" from "you lack a role".
 */
export const EDITION_CAPABILITY_BODY = { error: 'forbidden', code: 'edition_capability' } as const;

/**
 * A CAPABILITY gate, not an ACCESS gate.
 *
 * Access (may this organization use FXL Sales at all) is decided by exactly one
 * gate, `requireHubAuth` inside `appAuthMiddleware`, from
 * `entitlements.access`, and this middleware never replaces, duplicates or
 * relaxes it: it is mounted BEHIND `appAuthMiddleware` and only ever narrows an
 * already-authenticated, already-entitled request.
 *
 * What it narrows is the product surface of the organization's MODULES, read from
 * `sales_ops_org_modules` through `getOrgModules` (one query per request, backfilled
 * once from the token for an org with no rows). A context that never loaded modules
 * and carries no Hub context is all modules, so this gate can never take a
 * capability away from an unmarked org.
 */
export function requireCapability(capability: SalesCapability): MiddlewareHandler {
  return async (c, next) => {
    const modules = await getOrgModules(c);
    if (!modulesAllowCapability(modules, capability)) {
      return c.json(EDITION_CAPABILITY_BODY, 403);
    }
    return next();
  };
}
