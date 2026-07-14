import {
  createHubBff,
  requireHubAuth,
  type CreateHubBffOptions,
  type RequireHubAuthOptions,
} from '@fxl-business/hub-sdk/server';
import type { MiddlewareHandler } from 'hono';
import type { Hono } from 'hono';
import { tryLoadHubAuthConfig } from '../config/auth-provider.js';

type EnvLike = Record<string, string | undefined>;

/**
 * Product authorization boundary for fields populated by the SDK verifier.
 * Optional decoded claims remain outside this type and cannot grant product access.
 */
export type AppHubAuthContext = {
  accountId: string;
  workspaceId: string;
  entitlements: {
    modules: string[];
  };
  roles: {
    workspace: string;
  };
};

type AppRole = 'admin' | 'seller' | 'finder';

const fullAccessRoles: AppRole[] = ['admin', 'seller', 'finder'];

export function getAppRolesFromHubClaims(auth: AppHubAuthContext): AppRole[] {
  const workspaceRole = auth.roles.workspace;
  if (workspaceRole === 'owner' || workspaceRole === 'admin') {
    return fullAccessRoles;
  }

  return [];
}

declare module 'hono' {
  interface ContextVariableMap {
    hubAuth?: AppHubAuthContext;
  }
}

export function getHubLegacyAuthContext(auth: AppHubAuthContext): {
  userId: string;
  orgId: string;
  userRole: string | undefined;
  userRoles: AppRole[];
} {
  const userRoles = getAppRolesFromHubClaims(auth);
  const userRole = userRoles[0];

  return {
    userId: auth.accountId,
    orgId: auth.workspaceId,
    userRole,
    userRoles,
  };
}

export function hasHubCoreEntitlement(auth: AppHubAuthContext, coreModule: string): boolean {
  return auth.entitlements.modules.includes(coreModule);
}

export function resolveHubRedirectUri(envBag: EnvLike): string | undefined {
  const explicit = envBag.FXL_HUB_REDIRECT_URI;
  if (explicit) {
    return explicit;
  }

  if ((envBag.NODE_ENV ?? 'development') !== 'production') {
    const webOrigin = (envBag.CORS_ORIGIN ?? 'http://localhost:8006').replace(/\/+$/, '');
    return `${webOrigin}/auth/callback`;
  }

  throw new Error('FXL_HUB_REDIRECT_URI is required for FXL Hub auth in production');
}

export function resolveHubPostLoginRedirect(envBag: EnvLike): string {
  return envBag.FXL_HUB_POST_LOGIN_REDIRECT ?? envBag.CORS_ORIGIN ?? '/';
}

export function resolveHubPostLoginErrorRedirect(envBag: EnvLike): string {
  const explicit = envBag.FXL_HUB_POST_LOGIN_ERROR_REDIRECT;
  if (explicit) {
    return explicit;
  }

  const redirect = resolveHubPostLoginRedirect(envBag);
  if (redirect === '/') {
    return '/?error=auth';
  }

  const url = new URL(redirect);
  url.searchParams.set('error', 'auth');
  return url.toString();
}

export function getHubSdkConfig() {
  return tryLoadHubAuthConfig(process.env)?.sdk ?? null;
}

export function createAppAuthMiddleware(
  envBag: EnvLike = process.env,
  options?: Pick<RequireHubAuthOptions, 'fetchImpl'>,
): MiddlewareHandler {
  const config = tryLoadHubAuthConfig(envBag);
  const hubAuthMiddleware = config ? requireHubAuth(config.sdk, options) : null;

  return async (c, next) => {
    if (!hubAuthMiddleware || !config) {
      return c.json({ error: 'unavailable', code: 'hub_auth_not_configured' }, 503);
    }

    let blockedResponse: Response | undefined;
    const authResponse = await hubAuthMiddleware(c, async () => {
      const hubAuth = c.get('hubAuth');
      if (!hubAuth) {
        blockedResponse = c.json({ error: 'unauthorized', code: 'missing_hub_context' }, 401);
        return;
      }

      if (!hasHubCoreEntitlement(hubAuth, config.coreModule)) {
        blockedResponse = c.json({ error: 'payment_required', code: 'missing_entitlement' }, 402);
        return;
      }

      const legacy = getHubLegacyAuthContext(hubAuth);
      c.set('userId', legacy.userId);
      c.set('orgId', legacy.orgId);
      c.set('userRole', legacy.userRole);
      c.set('userRoles', legacy.userRoles);
      await next();
    });
    return blockedResponse ?? authResponse;
  };
}

export const appAuthMiddleware: MiddlewareHandler = createAppAuthMiddleware();

export type AppAuthBffOptions = Pick<CreateHubBffOptions, 'fetchImpl' | 'sessionStore'>;

export function createAppAuthBff(
  envBag: EnvLike = process.env,
  options?: AppAuthBffOptions,
): Hono | null {
  const config = tryLoadHubAuthConfig(envBag);
  if (!config) {
    return null;
  }

  return createHubBff(config.sdk, {
    ...options,
    redirectUri: resolveHubRedirectUri(envBag),
    postLoginRedirect: resolveHubPostLoginRedirect(envBag),
    postLoginErrorRedirect: resolveHubPostLoginErrorRedirect(envBag),
  });
}
