import { loadHubConfigFromEnv } from '@fxl-business/hub-sdk';
import type { HubSdkConfig } from '@fxl-business/hub-sdk';
import { createHubBff, requireHubAuth } from '@fxl-business/hub-sdk/server';
import type { MiddlewareHandler } from 'hono';
import { loadAuthProviderConfig } from '../config/auth-provider.js';
import { clerkAuthMiddleware } from './auth.js';

type EnvLike = Record<string, string | undefined>;

export type MinimalHubAuthContext = {
  accountId: string;
  workspaceId: string;
  claims: {
    entitlements: {
      modules: string[];
    };
    roles: {
      workspace: string;
    };
    isSuperAdmin?: boolean;
  };
};

declare module 'hono' {
  interface ContextVariableMap {
    hubAuth?: MinimalHubAuthContext;
  }
}

const authProviderConfig = loadAuthProviderConfig(process.env);
const hubSdkConfig: HubSdkConfig | null =
  authProviderConfig.provider === 'hub' ? loadHubConfigFromEnv(process.env) : null;

export function getHubLegacyAuthContext(auth: MinimalHubAuthContext): {
  userId: string;
  orgId: string;
  userRole: string | undefined;
} {
  const workspaceRole = auth.claims.roles.workspace;
  const userRole =
    auth.claims.isSuperAdmin || workspaceRole === 'owner' || workspaceRole === 'admin'
      ? 'admin'
      : 'finder';

  return {
    userId: auth.accountId,
    orgId: auth.workspaceId,
    userRole,
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
    return `http://localhost:${envBag.PORT ?? '3006'}/auth/callback`;
  }

  throw new Error('FXL_HUB_REDIRECT_URI is required when AUTH_PROVIDER=hub in production');
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

export function getAuthProviderName() {
  return authProviderConfig.provider;
}

export function getHubSdkConfig() {
  return hubSdkConfig;
}

const hubAuthMiddleware =
  hubSdkConfig && authProviderConfig.provider === 'hub'
    ? requireHubAuth(hubSdkConfig, { audience: authProviderConfig.audience })
    : null;

export const appAuthMiddleware: MiddlewareHandler = async (c, next) => {
  if (authProviderConfig.provider === 'clerk') {
    return clerkAuthMiddleware(c, next);
  }

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

    if (!hasHubCoreEntitlement(hubAuth, authProviderConfig.coreModule)) {
      blockedResponse = c.json({ error: 'payment_required', code: 'missing_entitlement' }, 402);
      return;
    }

    const legacy = getHubLegacyAuthContext(hubAuth);
    c.set('userId', legacy.userId);
    c.set('orgId', legacy.orgId);
    c.set('userRole', legacy.userRole);
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
