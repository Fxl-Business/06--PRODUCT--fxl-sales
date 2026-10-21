import type { MiddlewareHandler } from 'hono';
import { env } from '../env.js';

/**
 * The 403 an organization's module write answers to an admin who is not a platform
 * operator. Distinct from `ADMIN_ROLE_REQUIRED_BODY` so a log line can tell "you lack
 * the tenant admin role" from "your account may not change modules".
 */
export const MODULE_OPERATOR_REQUIRED_BODY = { error: 'forbidden', code: 'module_operator_required' } as const;

/**
 * The platform-operator allow-list, parsed from the validated env on every call. Empty
 * or absent means nobody: default deny.
 */
export function moduleOperatorAccountIds(
  raw: string | undefined = env.SALES_MODULE_OPERATOR_ACCOUNT_IDS,
): ReadonlySet<string> {
  return new Set(
    (raw ?? '')
      .split(',')
      .map((id) => id.trim())
      .filter((id) => id !== ''),
  );
}

/**
 * A tenant admin cannot enable a module for their own organization: a module write is a
 * platform-operator action. It runs AFTER `requireAdmin`, and it reads only the verified
 * account id (`c.get('userId')`), never the body and never the org.
 */
export const requireModuleOperator: MiddlewareHandler = async (c, next) => {
  if (!moduleOperatorAccountIds().has(c.get('userId'))) {
    return c.json(MODULE_OPERATOR_REQUIRED_BODY, 403);
  }
  return next();
};
