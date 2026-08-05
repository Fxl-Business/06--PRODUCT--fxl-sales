import type { HubSdkConfig } from '@fxl-business/hub-sdk';
import { createHubBff, requireHubAuth } from '@fxl-business/hub-sdk/server';
import { Hono, type MiddlewareHandler } from 'hono';
import { createHubSessionScopeMiddleware } from '../auth/hub-session-scope.js';
import { createHubSessionStore } from '../auth/hub-session-store.js';
import { tryLoadHubAuthConfig } from '../config/auth-provider.js';
import { env } from '../env.js';

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
    /** Present on the Hub access token; the web reads the same two claims. */
    name?: string;
    email?: string;
  };
};

/**
 * The caller's own display name from the VERIFIED token. Returns null rather
 * than falling back to the account id - a raw account id is never a label.
 *
 * This is the ONLY moment that name is knowable inside this product: there is no
 * Hub account directory and no join from an account id to a pessoa, so anything
 * that wants to name a third-party actor later has to snapshot it here.
 */
export function getHubActorDisplayName(auth: MinimalHubAuthContext | undefined): string | null {
  const name = auth?.claims?.name;
  if (typeof name === 'string' && name.trim() !== '') return name;
  const email = auth?.claims?.email;
  if (typeof email === 'string' && email.trim() !== '') return email;
  return null;
}

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
  if (!hubSdkConfig || !hubAuthConfig) {
    return null;
  }

  // ONE boolean drives both the SDK's cookie name and our cookie read.
  const secureCookies = (process.env.NODE_ENV ?? 'development') === 'production';

  const session = createHubSessionStore({
    databaseUrlPresent: Boolean(env.DATABASE_URL),
    nodeEnv: process.env.NODE_ENV ?? 'development',
    // Read the VALIDATED env, never process.env: .env.dev.example ships
    // `HUB_SESSION_ENCRYPTION_KEY=` (blank) and CLAUDE.md documents that file as
    // the one an operator copies to .env. `process.env.X ?? secret` keeps the
    // empty string, createSessionSealer('') throws its 32-char floor, and
    // server.ts calls this at module top level - so a blank value would stop the
    // API booting. env.ts's emptyToUndefined turns '' into undefined, which is
    // what makes the documented HKDF-from-FXL_HUB_SECRET_KEY default apply.
    encryptionIkm: env.HUB_SESSION_ENCRYPTION_KEY ?? hubAuthConfig.secretKey,
  });

  const bff = createHubBff(hubSdkConfig, {
    sessionStore: session.store,
    secureCookies,
    redirectUri: resolveHubRedirectUri(process.env),
    postLoginRedirect: resolveHubPostLoginRedirect(process.env),
    postLoginErrorRedirect: resolveHubPostLoginErrorRedirect(process.env),
  });

  if (session.kind === 'memory') {
    return bff;
  }

  // The hydrate/flush scope is mounted INSIDE the returned router, so server.ts
  // stays `app.route('', authBff)` and the middleware cannot be forgotten.
  const router = new Hono();
  router.use('/auth/*', createHubSessionScopeMiddleware(session.store, { secureCookies }));
  router.route('', bff);
  return router;
}
