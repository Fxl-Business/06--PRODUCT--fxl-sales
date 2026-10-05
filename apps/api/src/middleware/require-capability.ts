import type { MiddlewareHandler } from 'hono';
import { hasCapability, type SalesCapability } from '@fxl-sales/shared-utils/sales-edition';

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
 * What it narrows is the product surface of the organization's edition, which
 * `applyHubAuthContext` resolved once from the token's add-on modules. A
 * missing `salesEdition` (impossible behind `appAuthMiddleware`, possible in a
 * test that hand-builds the context) is treated as 'full', so this gate can
 * never take a capability away from the full product.
 */
export function requireCapability(capability: SalesCapability): MiddlewareHandler {
  return async (c, next) => {
    const edition = c.get('salesEdition') ?? 'full';
    if (!hasCapability(edition, capability)) {
      return c.json(EDITION_CAPABILITY_BODY, 403);
    }
    return next();
  };
}
