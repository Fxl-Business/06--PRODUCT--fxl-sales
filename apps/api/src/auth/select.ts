/**
 * The development identity adapter's own module: the enable flag, the
 * production refusal, and the seam that installs a fake identity middleware
 * onto `apps/api/src/middleware/app-auth.ts`'s adapter slot.
 *
 * Modelled on `/Users/cauetpinciara/Documents/fxl/projects/01--PRODUCT--fxl-finance`'s
 * `apps/api/src/auth/select.ts`, adapted to this repo's deny taxonomy and to
 * the fact that the adapter seam itself is being created here rather than
 * extended.
 *
 * The package this file reaches at runtime, `@fxl-sales/auth-fake`, is
 * declared STRUCTURALLY below and is NEVER imported by name at module scope,
 * not even type-only. Any import naming it, type-only included, would make
 * the "no static import" rule a judgement call about which import forms the
 * compiler erases instead of an absolute. A boundary that protects production
 * authentication must not need a reviewer to know that.
 */
import type { Context, MiddlewareHandler } from 'hono';
import { createMiddleware } from 'hono/factory';
import type { MinimalHubAuthContext } from '../middleware/app-auth.js';

/** How curl and the API's own tooling pick an identity directly. */
export const FAKE_IDENTITY_HEADER = 'x-fake-identity';

const TRUTHY = new Set(['1', 'true', 'yes', 'on']);

function isTruthyFlag(value: string | undefined): boolean {
  if (typeof value !== 'string') {
    return false;
  }
  return TRUTHY.has(value.trim().toLowerCase());
}

/**
 * SALES_AUTH_FAKE, a Node-process argument. `FXL_HUB_` means "the SDK
 * resolves and validates this", so it is unavailable here; every variable
 * this repo resolves itself carries `SALES_` (`SALES_ENV_FILE`,
 * `SALES_POST_LOGIN_REDIRECT`, `SALES_POST_LOGIN_ERROR_REDIRECT`,
 * `SALES_SESSION_ENCRYPTION_IKM`). A bare `AUTH_FAKE` would be the one
 * unprefixed repo-owned name in the tree and the spelling an operator is most
 * likely to have left exported in a shell from another project - exactly the
 * leak that would turn fake auth on by accident.
 *
 * A missing flag is not an error: the overwhelmingly common case is the Hub
 * adapter, and it stays the default.
 */
export function isFakeAuthRequested(env: NodeJS.ProcessEnv = process.env): boolean {
  return isTruthyFlag(env.SALES_AUTH_FAKE);
}

export function isProductionEnv(env: NodeJS.ProcessEnv = process.env): boolean {
  return (env.NODE_ENV ?? '').trim().toLowerCase() === 'production';
}

/**
 * The package's shape, declared structurally so nothing here needs a static
 * (even type-only) import naming it. If slice 01 shipped these members under
 * different names, only this interface and the destructuring that reads it
 * change; `packages/auth-fake` itself is never touched from here.
 *
 * `activeWorkspaceId` is required here, beyond the plan's original two-field
 * sketch, because the Organization-resolution fallback below reads it.
 */
interface FakeIdentityRef {
  id: string;
  label: string;
  activeWorkspaceId: string;
}

interface FakeIdentityModule {
  IDENTITIES: readonly FakeIdentityRef[];
  DEFAULT_IDENTITY_ID: string;
  findIdentity(id: string | undefined | null): FakeIdentityRef | undefined;
  findIdentityByAccountId(accountId: string | undefined | null): FakeIdentityRef | undefined;
  readTokenSubject(token: string | null | undefined): string | null;
  readTokenWorkspaceId(token: string | null | undefined): string | null;
  identityHasWorkspace(identity: FakeIdentityRef, workspaceId: string): boolean;
  toHubAuthContext(
    identity: FakeIdentityRef,
    options?: { organizationId?: string },
  ): MinimalHubAuthContext;
}

/** The whole dynamically-imported adapter module, typed for the one call site
 *  below. This names `../middleware/app-auth.js`, a real dependency of this
 *  app, and is unrelated to the fake-package isolation rule above. */
type AppAuthModule = typeof import('../middleware/app-auth.js');

/** Reads `Bearer <token>` out of the Authorization header. Null for anything
 *  else, including a missing header. */
function extractBearerToken(c: Context): string | null {
  const header = c.req.header('Authorization');
  if (!header) {
    return null;
  }
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  return match?.[1] ?? null;
}

/**
 * Resolves the acting identity, most explicit first: the `x-fake-identity`
 * header, trimmed; then the bearer token's `sub`; then the roster default.
 *
 * A NAMED identity that is not on the roster - whether named by the header or
 * by a token's `sub` - is a distinct outcome from "no identity was named at
 * all", and only the former is a 401. A typo in the dev switcher must be
 * visible, never silently resolved to somebody else.
 */
function resolveIdentity(
  c: Context,
  bearerToken: string | null,
  fake: FakeIdentityModule,
): { identity: FakeIdentityRef } | { unknownRequested: string } {
  const headerValue = c.req.header(FAKE_IDENTITY_HEADER)?.trim();
  if (headerValue) {
    const identity = fake.findIdentity(headerValue);
    return identity ? { identity } : { unknownRequested: headerValue };
  }

  if (bearerToken) {
    const sub = fake.readTokenSubject(bearerToken);
    if (sub) {
      const identity = fake.findIdentityByAccountId(sub);
      return identity ? { identity } : { unknownRequested: sub };
    }
  }

  const fallback = fake.findIdentity(fake.DEFAULT_IDENTITY_ID);
  // Unreachable in practice: DEFAULT_IDENTITY_ID always names a roster
  // member. Modelled as an "unknown" outcome rather than a non-null
  // assertion, so a future roster bug fails closed instead of crashing.
  return fallback ? { identity: fallback } : { unknownRequested: fake.DEFAULT_IDENTITY_ID };
}

/**
 * Built by this module-local factory so the two dynamically-imported modules
 * it closes over - the adapter module and the roster module - never leak into
 * the middleware's own type surface, and so the middleware never needs a
 * static import of either.
 *
 * PLAN-CHECK ADDITION: the ACTIVE Organization is resolved SEPARATELY from the
 * identity, because the browser can change it without changing the identity
 * (`setActive` re-mints a token carrying a different `workspaceId` for the
 * same `sub`). Resolving `orgId` from `identity.activeWorkspaceId` alone would
 * serve the operator the ORIGINAL Organization's rows while the browser shows
 * the one they just switched to - a tenancy divergence. So: when a bearer
 * token is present, `fake.readTokenWorkspaceId(token)`; otherwise
 * `identity.activeWorkspaceId`. A workspace the roster refuses is answered
 * `401 unknown_fake_workspace` and NEVER falls back to the identity's own
 * Organization - the same membership rail the package applies when minting,
 * so the browser and the API cannot disagree about which Organizations an
 * identity may adopt.
 */
function buildFakeAuthMiddleware(
  appAuth: AppAuthModule,
  fake: FakeIdentityModule,
): MiddlewareHandler {
  return createMiddleware(async (c, next) => {
    const bearerToken = extractBearerToken(c);
    const resolved = resolveIdentity(c, bearerToken, fake);

    if ('unknownRequested' in resolved) {
      return c.json(
        {
          error: 'unauthorized',
          code: 'unknown_fake_identity',
          requested: resolved.unknownRequested,
          available: fake.IDENTITIES.map((entry) => entry.id),
        },
        401,
      );
    }

    const { identity } = resolved;
    const requestedWorkspaceId = bearerToken ? fake.readTokenWorkspaceId(bearerToken) : null;
    const workspaceId = requestedWorkspaceId ?? identity.activeWorkspaceId;

    if (!fake.identityHasWorkspace(identity, workspaceId)) {
      return c.json({ error: 'unauthorized', code: 'unknown_fake_workspace' }, 401);
    }

    const auth = fake.toHubAuthContext(identity, { organizationId: workspaceId });

    // The faithful mirror of the recorded SDK behaviour change: a token whose
    // entitlements object carries no `access` key at all, or a non-boolean
    // one, is 401 - not 402 - because the SDK validates the token against the
    // contract BEFORE the entitlement gate runs. The roster's type forbids
    // this state; the branch exists so the fake path cannot be laxer than the
    // real one.
    const access = auth.entitlements?.access;
    if (typeof access !== 'boolean') {
      return c.json({ error: 'unauthorized' }, 401);
    }

    // Byte-identical to what requireHubAuth returns for a well-formed token
    // whose Organization carries no access. Deleting this branch is the
    // decisive mutation the plan names: it would let the no-access roster
    // identity through as fully entitled.
    if (access !== true) {
      return c.json({ error: 'payment_required', code: 'no_org_access' }, 402);
    }

    await appAuth.applyHubAuthContext(c, auth, next);
  });
}

/**
 * Installs the development identity adapter when `SALES_AUTH_FAKE` requests
 * it. Returns `false`, evaluating nothing further, when the flag is absent -
 * so a flag-absent boot is byte-equivalent to today's module evaluation
 * order.
 *
 * The order below is load-bearing:
 * 1. the flag check, which short-circuits everything else;
 * 2. the DYNAMIC import of `../middleware/app-auth.js`, so step 1's early
 *    return really does import nothing new - a static import here would pull
 *    that module's Hub-config resolution forward in `server.ts`'s evaluation
 *    order for every boot, flag or no flag;
 * 3. the production check, BEFORE the roster package import, so production's
 *    error names the real cause rather than an `ERR_MODULE_NOT_FOUND` from a
 *    package that is not in the production image;
 * 4. the DYNAMIC import of `@fxl-sales/auth-fake`, so the package never
 *    enters the production build graph - in an image built without
 *    devDependencies this import rejects, which is the intended last line of
 *    defence;
 * 5. installing the adapter;
 * 6. one `console.warn` naming the active roster, the default id and the
 *    header.
 */
export async function installFakeAuthIfRequested(
  env: NodeJS.ProcessEnv = process.env,
): Promise<boolean> {
  if (!isFakeAuthRequested(env)) {
    return false;
  }

  const appAuth = await import('../middleware/app-auth.js');

  if (isProductionEnv(env)) {
    throw new Error(appAuth.DEV_IDENTITY_ADAPTER_IN_PRODUCTION_MESSAGE);
  }

  const fake = (await import('@fxl-sales/auth-fake')) as unknown as FakeIdentityModule;

  appAuth.installAppAuthAdapter(buildFakeAuthMiddleware(appAuth, fake));

  console.warn(
    `[dev-identity] SALES_AUTH_FAKE is active. ` +
      `Roster: ${fake.IDENTITIES.map((entry) => entry.id).join(', ')}. ` +
      `Default identity: ${fake.DEFAULT_IDENTITY_ID}. ` +
      `Switch with the "${FAKE_IDENTITY_HEADER}" header.`,
  );

  return true;
}
