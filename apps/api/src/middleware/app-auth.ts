import type { HubSdkConfig } from '@fxl-business/hub-sdk';
import { createHubBff, requireHubAuth } from '@fxl-business/hub-sdk/server';
import type { MiddlewareHandler } from 'hono';
import { tryLoadHubAuthConfig } from '../config/auth-provider.js';

type EnvLike = Record<string, string | undefined>;

export type MinimalHubAuthContext = {
  accountId: string;
  workspaceId: string;
  claims: {
    entitlements: {
      modules: string[];
    };
    roles: {
      productRoles?: unknown;
      workspace: string;
    };
    isSuperAdmin?: boolean;
  };
};

type AppRole = 'admin' | 'seller' | 'finder';

const fullAccessRoles: AppRole[] = ['admin', 'seller', 'finder'];
const productRoleOrder: AppRole[] = ['seller', 'finder'];

function readProductRoles(value: unknown): Set<string> {
  if (!Array.isArray(value)) {
    return new Set();
  }
  return new Set(value.filter((role): role is string => typeof role === 'string'));
}

export function getAppRolesFromHubClaims(auth: MinimalHubAuthContext): AppRole[] {
  const workspaceRole = auth.claims.roles.workspace;
  if (auth.claims.isSuperAdmin || workspaceRole === 'owner' || workspaceRole === 'admin') {
    return fullAccessRoles;
  }

  const productRoles = readProductRoles(auth.claims.roles.productRoles);
  if (productRoles.has('admin')) {
    return fullAccessRoles;
  }

  return productRoleOrder.filter((role) => productRoles.has(role));
}

declare module 'hono' {
  interface ContextVariableMap {
    hubAuth?: MinimalHubAuthContext;
  }
}

const hubAuthConfig = tryLoadHubAuthConfig(process.env);
const hubSdkConfig: HubSdkConfig | null = hubAuthConfig
  ? {
      apiUrl: hubAuthConfig.apiUrl,
      publishableKey: hubAuthConfig.publishableKey,
      secretKey: hubAuthConfig.secretKey,
      audience: hubAuthConfig.audience,
    }
  : null;

export function getHubLegacyAuthContext(auth: MinimalHubAuthContext): {
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

export function hasHubCoreEntitlement(auth: MinimalHubAuthContext, coreModule: string): boolean {
  return auth.claims.entitlements.modules.includes(coreModule);
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
  return hubSdkConfig;
}

const hubAuthMiddleware =
  hubSdkConfig && hubAuthConfig
    ? requireHubAuth(hubSdkConfig, { audience: hubAuthConfig.audience })
    : null;

export const appAuthMiddleware: MiddlewareHandler = async (c, next) => {
  if (!hubAuthMiddleware || !hubSdkConfig) {
    return c.json({ error: 'unavailable', code: 'hub_auth_not_configured' }, 503);
  }

  let blockedResponse: Response | undefined;
  const authResponse = await hubAuthMiddleware(c, async () => {
    const hubAuth = c.get('hubAuth');
    if (!hubAuth) {
      blockedResponse = c.json({ error: 'unauthorized', code: 'missing_hub_context' }, 401);
      return;
    }

    if (!hubAuthConfig || !hasHubCoreEntitlement(hubAuth, hubAuthConfig.coreModule)) {
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

export function createAppAuthBff() {
  if (!hubSdkConfig) {
    return null;
  }

  return createHubBff(hubSdkConfig, {
    redirectUri: resolveHubRedirectUri(process.env),
    postLoginRedirect: resolveHubPostLoginRedirect(process.env),
    postLoginErrorRedirect: resolveHubPostLoginErrorRedirect(process.env),
  });
}
