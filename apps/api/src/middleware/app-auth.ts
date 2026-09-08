import type { HubAuthContext, HubConfig } from '@fxl-business/hub-sdk';
import { createHubBff, requireHubAuth } from '@fxl-business/hub-sdk/server';
import { Hono, type MiddlewareHandler } from 'hono';
import { hubBffErrorHandler } from '../auth/hub-bff-errors.js';
import { createHubLoginSupersedeMiddleware } from '../auth/hub-login-scope.js';
import {
  SESSION_ABSOLUTE_TTL_MS,
  SESSION_TTL_MS,
  createHubSessionStore,
} from '../auth/hub-session-store.js';
import { hubEnvBag, tryLoadHubAuthConfig } from '../config/auth-provider.js';
import { env } from '../env.js';

type EnvLike = Record<string, string | undefined>;

/**
 * The verified Hub auth context, straight from the SDK.
 *
 * This repo hand-declared a `MinimalHubAuthContext` while it was on 1.3.1,
 * because that release re-exported `HubEntitlements` from an unshipped
 * `@fxl-hub/hub-auth`, so under `skipLibCheck: true` it degraded to `any` and
 * `access !== true` became a branch the compiler no longer checked. 2.2.0 ships
 * the types in its own `dist`, so the local declaration is deleted and the gate
 * is finally type-checked against the real shape.
 *
 * `claims.entitlements.access` and `claims.roles.workspace` are unchanged
 * members of `HubTokenClaims`, so every reader in this file still compiles.
 */
export type MinimalHubAuthContext = HubAuthContext;

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

/**
 * The WHOLE Hub contract, resolved once by the SDK's own `loadHubConfig`.
 *
 * It used to be projected down to the five identity fields, because
 * `healthToken` was a BFF option this repo resolved separately and had to keep
 * out of the config the SDK parsed. 2.3.0 inverts that: `healthToken`,
 * `redirectUri` and `trustedOrigins` are CONFIG, resolved from their own
 * canonical variables by the same loader, and `assertBootConfiguration` reads
 * them off the config. Projecting them away here would silently drop three boot
 * rules; re-passing them as options would be a second resolution to keep in
 * step. So the config travels whole and unmodified.
 *
 * `environment` is EXPLICIT, validated, and never inferred from NODE_ENV; it
 * must agree with the environment segment inside the client id, which the
 * parser checks offline. `audience` is configured, never derived, and 2.x's
 * `requireHubAuth` reads it from here.
 */
const hubSdkConfig: HubConfig | null = tryLoadHubAuthConfig(hubEnvBag(env));

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
/**
 * The 401 body for the one case `requireHubAuth` cannot answer: it allowed the
 * request but this middleware found no context on the Context. That is
 * unreachable today and is kept as a fail-CLOSED backstop rather than a
 * non-null assertion, which would turn the same impossible state into a crash.
 */
const MISSING_HUB_CONTEXT = { error: 'unauthorized', code: 'missing_hub_context' } as const;

/*
  `resolveHubRedirectUri` lived here and is DELETED, replaced by
  `FXL_HUB_REDIRECT_URI` on the config plus the SDK's own check, which is
  strictly stronger in both directions.

  Ours keyed on NODE_ENV, so a staging deploy running NODE_ENV=production was
  judged by the wrong variable, and nothing anywhere refused a callback pointed
  at the Hub's own origin - a guaranteed outage that booted cleanly.
  `assertBootConfiguration`, which `createHubBff` calls itself, refuses exactly
  that on the ORIGIN of the EFFECTIVE value.

  There is deliberately NO local presence assertion in its place. That would be a
  second, weaker encoding of a rule the SDK owns, and it would wave through the
  operator who pastes the Hub's own callback. The local development convenience
  is preserved by SETTING `FXL_HUB_REDIRECT_URI` in the `.env` examples.
*/

/**
 * SALES_ and not FXL_HUB_: this pair is resolved start to finish here, falls
 * back to CORS_ORIGIN - the consumer's own configuration - and is not one of
 * the nine names the SDK resolves and validates itself. `createHubBff` still
 * takes `postLoginRedirect` / `postLoginErrorRedirect` as CODE options; what
 * carries this repo's own prefix is only where the VALUES are read from.
 */
export function resolveHubPostLoginRedirect(envBag: EnvLike): string {
  return envBag.SALES_POST_LOGIN_REDIRECT ?? envBag.CORS_ORIGIN ?? '/';
}

export function resolveHubPostLoginErrorRedirect(envBag: EnvLike): string {
  const explicit = envBag.SALES_POST_LOGIN_ERROR_REDIRECT;
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

/**
 * The ONE access gate. 2.2.0's `requireHubAuth` answers the whole taxonomy
 * itself - 401 for a missing, invalid or wrong-contract-version token, 402
 * `no_org_access` when `entitlements.access` is not true, 403 for a missing
 * module or role - with bodies byte-identical to the ones this repo used to
 * build by hand, so the web half is unchanged.
 *
 * `allowWithoutAccess` is left at its default of false, which is the gate.
 * There is deliberately no second gate: two would mean one live and one
 * unreachable, with a green suite over the dead one.
 *
 * The audience is NOT passed. 2.x takes it from `config.audience`, which is
 * required and validated, and offers no override - an override would be a
 * second source of truth for the one value that must match what the Hub minted.
 */
const hubAuthMiddleware = hubSdkConfig ? requireHubAuth(hubSdkConfig) : null;

export const appAuthMiddleware: MiddlewareHandler = async (c, next) => {
  if (!hubAuthMiddleware || !hubSdkConfig) {
    return c.json({ error: 'unavailable', code: 'hub_auth_not_configured' }, 503);
  }

  let blockedResponse: Response | undefined;
  const authResponse = await hubAuthMiddleware(c, async () => {
    const auth = c.get('hubAuth');
    if (!auth) {
      blockedResponse = c.json({ ...MISSING_HUB_CONTEXT }, 401);
      return;
    }

    const legacy = getHubLegacyAuthContext(auth);
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
  if (!hubSdkConfig) {
    return null;
  }

  // ONE boolean still drives both the SDK's cookie name and our own cookie read,
  // but it is now derived from the HUB environment rather than from NODE_ENV,
  // because 2.x's `assertBootConfiguration` refuses `insecureCookies: true`
  // outside `environment === 'development'` and would refuse to boot a staging
  // deploy that happens to run with NODE_ENV unset.
  //
  // `secureCookies` stays the local's polarity because
  // `createHubLoginSupersedeMiddleware` consumes it and
  // `hubSessionCookieName(secureCookies)` must keep agreeing with the SDK's own
  // `secure ? SESSION_COOKIE_SECURE : SESSION_COOKIE`. The 2.x option is the
  // INVERSE, so the inversion happens exactly once, here, at the single producer.
  const isHubDevelopment = hubSdkConfig.environment === 'development';
  const secureCookies = !isHubDevelopment;

  // Computed ONCE and reused by the two post-login resolvers below, which are
  // the only env-reading resolvers left in this file.
  const hubEnv = hubEnvBag(env);

  const session = createHubSessionStore({
    databaseUrlPresent: Boolean(env.DATABASE_URL),
    nodeEnv: env.NODE_ENV,
    // Read the VALIDATED env, never process.env: .env.dev.example ships
    // `SALES_SESSION_ENCRYPTION_IKM=` (blank) and CLAUDE.md documents that file as
    // the one an operator copies to .env. `process.env.X ?? secret` keeps the
    // empty string, createSessionSealer('') throws its 32-char floor, and
    // server.ts calls this at module top level - so a blank value would stop the
    // API booting. env.ts's emptyToUndefined turns '' into undefined, which is
    // what makes the documented HKDF-from-FXL_HUB_CLIENT_SECRET default apply.
    //
    // This is NOT the SDK session store's key. The canonical
    // `FXL_HUB_SESSION_ENCRYPTION_KEY` is a required strict-hex 64-character
    // value decoded to 32 bytes, validated by the SDK, keying its own
    // `SqlHubSessionStore` - a store this repo deliberately does not use.
    // `SALES_SESSION_ENCRYPTION_IKM` is optional HKDF input keying material for
    // OUR store, and this `??` is the ONLY read of it in the tree.
    encryptionIkm: env.SALES_SESSION_ENCRYPTION_IKM ?? hubSdkConfig.clientSecret,
  });

  const bff = createHubBff(hubSdkConfig, {
    sessionStore: session.store,
    // The ONLY route to an in-memory store, and legal only when the Hub
    // environment is development. Passed as a PAIR with the memory branch so a
    // production deploy that loses DATABASE_URL fails at boot rather than
    // silently going per-process.
    ...(isHubDevelopment && session.kind === 'memory'
      ? { allowEphemeralSessionStore: true }
      : {}),
    // REPLACES `secureCookies` and is INVERTED. Passed only when true: the boot
    // assertion refuses it outside development, and passing `false` explicitly
    // there is legal but says nothing, so the key is simply absent.
    ...(isHubDevelopment ? { insecureCookies: true } : {}),
    // NO `healthToken`, NO `redirectUri` and NO `trustedOrigins` here, and their
    // absence is the point of this slice.
    //
    // `createHubBff` calls `assertBootConfiguration` ITSELF, spreading any such
    // option OVER the config before validating. Resolving them a second time
    // here would mean validating one configuration and constructing another, and
    // the value the two would silently disagree about is `redirectUri` - the
    // exact class of divergence the boot check exists to catch. So all three ride
    // on `hubSdkConfig`, resolved once by `loadHubConfig` from
    // `FXL_HUB_HEALTH_TOKEN`, `FXL_HUB_REDIRECT_URI` and
    // `FXL_HUB_TRUSTED_ORIGINS`.
    //
    // `trustedOrigins` is REQUIRED for this deployment: the web app is on
    // sales.fxlbusiness.com and the API on sales-api.fxlbusiness.com, so the
    // SDK's own-origin computation alone does not admit the browser's POST, and
    // an empty list reproduces the 2026-08-10 outage.
    //
    // NO `fetchImpl` either. 2.2.0's `parseRotatedRefresh` matches
    // `__Host-fxl_hub_session` natively, so the wrapper this repo carried for one
    // wave is deleted and the SDK's default global `fetch` is correct.
    timeoutMs: HUB_BFF_TIMEOUT_MS,
    // Derived from the store's own constants, so the SDK's view of a session's
    // lifetime and the store's cannot disagree. The store ignores the values the
    // SDK computes from these (it owns both columns), so passing them is
    // DECLARATIVE - it exists to keep the SDK's 90-day sliding / 365-day absolute
    // DEFAULTS out of play and to make a future divergence a test failure rather
    // than a surprise.
    sessionTtlSeconds: SESSION_TTL_MS / 1000,
    sessionAbsoluteTtlSeconds: SESSION_ABSOLUTE_TTL_MS / 1000,
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
  // The handler must sit on BOTH apps, and that is not belt-and-braces. `bff` is
  // its own Hono app with its own error handler, so a store outage thrown inside
  // it is caught THERE and would answer the SDK's default 500 rather than
  // reaching the outer router. That is the same catch-at-the-level-that-threw
  // behaviour that made an error-mapping middleware dead code in the first
  // place. The outer one covers a throw raised in this router's own middleware,
  // which today is the login-supersede mount.
  bff.onError(hubBffErrorHandler);
  router.onError(hubBffErrorHandler);
  // An ORDINARY mount. The CSRF origin guard is configured through the config's
  // own `trustedOrigins` rather than wrapped around, so there is no shim left to
  // pass the request through.
  router.route('', bff);
  return router;
}
