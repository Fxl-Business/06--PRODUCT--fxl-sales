import type { HubSdkConfig } from '@fxl-business/hub-sdk';
import { createHubBff, requireHubAuth } from '@fxl-business/hub-sdk/server';
import { Hono, type MiddlewareHandler } from 'hono';
import { hubBffErrorHandler } from '../auth/hub-bff-errors.js';
import { createHubBffOriginShim } from '../auth/hub-bff-origin.js';
import { createHubLoginSupersedeMiddleware } from '../auth/hub-login-scope.js';
import { createHubRotatedCookieFetch } from '../auth/hub-rotated-cookie.js';
import {
  SESSION_ABSOLUTE_TTL_MS,
  SESSION_TTL_MS,
  createHubSessionStore,
} from '../auth/hub-session-store.js';
import { hubEnvBag, tryLoadHubAuthConfig } from '../config/auth-provider.js';
import { env } from '../env.js';

type EnvLike = Record<string, string | undefined>;

export type MinimalHubAuthContext = {
  accountId: string;
  /**
   * The active Organization id. The CLAIM is named `workspaceId` and the Hub
   * will not rename it, so neither does this product; `getHubLegacyAuthContext`
   * maps it to `orgId` and every tenant query filters by that.
   */
  workspaceId: string;
  claims: {
    entitlements: {
      /**
       * access-model-v1 baseline access. REQUIRED, and declared HERE rather
       * than imported from the SDK on purpose: through at least 1.3.1 the
       * SDK re-exports `HubEntitlements` from an unshipped `@fxl-hub/hub-auth`,
       * so under `skipLibCheck: true` it degrades to `any` and `access !== true`
       * becomes a branch the compiler no longer checks. The SDK's own
       * MIGRATION.md section 10 says so.
       */
      access: boolean;
      /**
       * ADD-ON modules only. The old per-product core module was DELETED from the
       * Hub's access model, so this array is NEVER read for baseline access - only
       * by `requireHubModule` for a genuine paid add-on. CLAUDE.md's Auth Model
       * section records which module string that was and why it is gone.
       */
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

const hubAuthConfig = tryLoadHubAuthConfig(hubEnvBag(env));
const hubSdkConfig: HubSdkConfig | null = hubAuthConfig
  ? {
      apiUrl: hubAuthConfig.apiUrl,
      // 1.3.1 still calls these publishableKey / secretKey and sends them as
      // client_id / client_secret. The SDK bump renames them at that boundary.
      publishableKey: hubAuthConfig.clientId,
      secretKey: hubAuthConfig.clientSecret,
      // ALWAYS passed. The audience is configured, never derived: with an
      // explicit audience the SDK's own derivation is never consulted.
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

/** The exact 2.1.0 bodies, so slice 04 changes no contract when it deletes this. */
const MISSING_HUB_CONTEXT = { error: 'unauthorized', code: 'missing_hub_context' } as const;
const NO_ORG_ACCESS = { error: 'payment_required', code: 'no_org_access' } as const;

export type HubAccessVerdict =
  | { allowed: true; auth: MinimalHubAuthContext }
  | { allowed: false; status: 401 | 402; body: { error: string; code: string } };

/**
 * Baseline access, and the ONLY question that decides it.
 *
 * Fails CLOSED by construction: the comparison is `=== true`, so `false`,
 * `undefined`, `'true'`, `1` and a missing `entitlements` object all deny. The
 * optional chaining is not decoration - the type says `access: boolean`, but the
 * value arrives from a token, and a gate that trusts a claim shape it did not
 * build is a gate that can be opened by a malformed one.
 *
 * `entitlements.modules` is deliberately NOT read here. It carries add-on
 * modules only; reading it for baseline access is the defect this slice removes.
 */
export function hasHubOrgAccess(auth: MinimalHubAuthContext | undefined): boolean {
  return auth?.claims?.entitlements?.access === true;
}

/**
 * The single authority for the 401 and 402 halves of the deny taxonomy.
 *
 * Returns a DISCRIMINATED verdict rather than a nullable denial so the allow
 * path carries the narrowed context and the caller needs no cast: a cast here
 * would be the one place a future edit could hand an unchecked context to
 * `getHubLegacyAuthContext`.
 */
export function classifyHubAccess(auth: MinimalHubAuthContext | undefined): HubAccessVerdict {
  if (!auth) {
    return { allowed: false, status: 401, body: { ...MISSING_HUB_CONTEXT } };
  }
  if (!hasHubOrgAccess(auth)) {
    return { allowed: false, status: 402, body: { ...NO_ORG_ACCESS } };
  }
  return { allowed: true, auth };
}

/**
 * The ONE seam that may read `entitlements.modules`, for a paid ADD-ON module.
 * No route mounts it today, because this product sells no add-on yet; it exists
 * so the 403 half of the taxonomy has a real implementation and a real oracle,
 * and its body is byte-identical to the 2.1.0 `requiredModule` denial, so slice
 * 04 replaces it with `requireHubAuth`'s own option and deletes this.
 */
export function hasHubModule(auth: MinimalHubAuthContext | undefined, module: string): boolean {
  const modules = auth?.claims?.entitlements?.modules;
  return Array.isArray(modules) && modules.includes(module);
}

export function requireHubModule(module: string): MiddlewareHandler {
  return async (c, next) => {
    if (!hasHubModule(c.get('hubAuth'), module)) {
      return c.json({ error: 'forbidden', code: 'missing_module', module }, 403);
    }
    return next();
  };
}

/**
 * THIS app's own origin plus `/auth/callback`, never the Hub's. 2.x's
 * `createHubBff` defaults `redirectUri` to `${config.apiUrl}/auth/callback`,
 * which is the HUB's origin and is therefore always wrong here. Locally vite
 * proxies `/auth` from 8006 to the api on 3006, so the registered callback is
 * the WEB origin. The NODE_ENV read below is about whether an EXPLICIT redirect
 * is mandatory; it has nothing to do with the Hub environment.
 */
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
    const verdict = classifyHubAccess(c.get('hubAuth'));
    if (!verdict.allowed) {
      blockedResponse = c.json(verdict.body, verdict.status);
      return;
    }

    const legacy = getHubLegacyAuthContext(verdict.auth);
    c.set('userId', legacy.userId);
    c.set('orgId', legacy.orgId);
    c.set('userRole', legacy.userRole);
    c.set('userRoles', legacy.userRoles);
    await next();
  });
  return blockedResponse ?? authResponse;
};

/**
 * Bounds the Hub round-trip the BFF makes from INSIDE the transaction that holds
 * a session's row lock. 1.2.0 had no timeout at all, so a hung Hub pinned a
 * pooled connection with an open transaction indefinitely. 5s rather than the
 * SDK's 10s default: the Hub is same-region, a healthy refresh is tens of
 * milliseconds, and getAdminDb()'s pool is `max: 5` and is shared with the audit,
 * history and nightly-job paths - so the worst-case connection hold is the number
 * that matters, not the average latency. See nexo/ROADMAP.md for the pool sizing.
 */
const HUB_BFF_TIMEOUT_MS = 5_000;

export function createAppAuthBff() {
  if (!hubSdkConfig || !hubAuthConfig) {
    return null;
  }

  // ONE boolean drives both the SDK's cookie name and our cookie read.
  const secureCookies = env.NODE_ENV === 'production';

  // Computed ONCE and reused by every resolver below.
  const hubEnv = hubEnvBag(env);

  const session = createHubSessionStore({
    databaseUrlPresent: Boolean(env.DATABASE_URL),
    nodeEnv: env.NODE_ENV,
    // Read the VALIDATED env, never process.env: .env.dev.example ships
    // `HUB_SESSION_ENCRYPTION_KEY=` (blank) and CLAUDE.md documents that file as
    // the one an operator copies to .env. `process.env.X ?? secret` keeps the
    // empty string, createSessionSealer('') throws its 32-char floor, and
    // server.ts calls this at module top level - so a blank value would stop the
    // API booting. env.ts's emptyToUndefined turns '' into undefined, which is
    // what makes the documented HKDF-from-FXL_HUB_CLIENT_SECRET default apply.
    encryptionIkm: env.HUB_SESSION_ENCRYPTION_KEY ?? hubAuthConfig.clientSecret,
  });

  const bff = createHubBff(hubSdkConfig, {
    sessionStore: session.store,
    // The BACKCHANNEL fetch, not the browser cookie below. In production the Hub
    // rotates the session cookie as `__Host-fxl_hub_session`, which the SDK's
    // `parseRotatedRefresh` regex cannot match, so the rotated refresh token was
    // dropped on every /auth/refresh and every /auth/switch while the BFF still
    // answered 200 - and the Hub revoked the family on the second replay. See
    // hub-rotated-cookie.ts. This has nothing to do with `secureCookies`.
    fetchImpl: createHubRotatedCookieFetch(),
    secureCookies,
    timeoutMs: HUB_BFF_TIMEOUT_MS,
    // Derived from the store's own constants, so the SDK's view of a session's
    // lifetime and the store's cannot disagree. The store ignores the values the
    // SDK computes from these (it owns both columns), so passing them is
    // DECLARATIVE - it exists to keep the SDK's 90-day sliding / 365-day absolute
    // DEFAULTS out of play and to make a future divergence a test failure rather
    // than a surprise.
    sessionTtlSeconds: SESSION_TTL_MS / 1000,
    sessionAbsoluteTtlSeconds: SESSION_ABSOLUTE_TTL_MS / 1000,
    redirectUri: resolveHubRedirectUri(hubEnv),
    postLoginRedirect: resolveHubPostLoginRedirect(hubEnv),
    postLoginErrorRedirect: resolveHubPostLoginErrorRedirect(hubEnv),
  });

  // Both are mounted INSIDE the returned router, so server.ts stays
  // `app.route('', authBff)` and neither can be forgotten.
  const router = new Hono();
  // Narrowed to the durable store EXPLICITLY. Since the hydrate/flush bridge was
  // deleted, the memory fallback (local dev without DATABASE_URL) flows through
  // this same router, and the SDK's InMemoryHubSessionStore has no
  // withLoginContext - so an unconditional mount would make every /auth/callback
  // throw a TypeError there. Only the durable store can supersede.
  if (session.kind === 'durable') {
    router.use(
      '/auth/callback',
      createHubLoginSupersedeMiddleware(session.store, { secureCookies }),
    );
  }
  // The error handler must be an onError rather than a middleware - see
  // hub-bff-errors.ts. Mounting it on the memory path too is inert (that store
  // never throws HubSessionStoreUnavailableError) and removes a branch.
  // The handler must sit on BOTH apps, and that is not belt-and-braces.
  // `bff` is now invoked through its own `fetch` rather than mounted with
  // `route()`, so it is a separate Hono app with a separate error handler: a
  // store outage thrown inside it is caught THERE and would answer the SDK's
  // default 500, never reaching the outer router. That is the same
  // catch-at-the-level-that-threw behaviour that made an error-mapping
  // middleware dead code in the first place. The outer one still covers a throw
  // in the shim itself.
  bff.onError(hubBffErrorHandler);
  router.onError(hubBffErrorHandler);
  // NOT `router.route('', bff)`. The SDK's 1.3.x CSRF guard compares the browser
  // `Origin` against the API's own origin, which are different hosts in
  // production (sales.fxlbusiness.com vs sales-api.fxlbusiness.com), so every
  // POST answered 403 and logged entitled operators out. The shim vouches for
  // CORS_ORIGIN explicitly and hands everything else through untouched. See
  // hub-bff-origin.ts.
  router.all('/auth/*', createHubBffOriginShim(bff, { trustedOrigins: [env.CORS_ORIGIN] }));
  return router;
}
