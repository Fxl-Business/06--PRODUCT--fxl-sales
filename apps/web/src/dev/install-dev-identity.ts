/**
 * The ONE file in `apps/web` that may name `@fxl-sales/auth-fake`, and it
 * names it only inside `await import(...)`. Everything else that needs a
 * dev identity session reads `../auth/react.tsx`'s two `useMemo` bodies via
 * `./dev-identity-registry.ts`, which knows nothing about this file or the
 * package.
 *
 * `@fxl-sales/auth-fake` is a devDependency of `apps/web`, never a
 * dependency, and is reached only from here, only dynamically. A production
 * build must be able to drop this entire module as dead code; see the
 * `DEV_IDENTITY_ENABLED` constant below and this slice's isolation oracle,
 * `apps/web/src/dev/__tests__/dev-identity-isolation.test.ts`.
 */
import type { HubClient } from '@fxl-business/hub-sdk/client';
import type { HubTokenResult } from '../auth/refresh';
import { setDevIdentitySession, type DevIdentitySession } from './dev-identity-registry';

const STORAGE_KEY = 'fxl-sales.dev-identity';

const TRUTHY = new Set(['1', 'true', 'yes', 'on']);

/**
 * The FIRST `import.meta.env.DEV` occurrence in this file, strictly above the
 * dynamic import of `@fxl-sales/auth-fake` below. A production build replaces
 * `import.meta.env.DEV` with the literal `false`, so `DEV_IDENTITY_ENABLED`
 * folds to `false` at build time and Rollup can prove every branch guarded by
 * it is dead - including the dynamic import - without needing to reason about
 * `VITE_AUTH_FAKE` at all.
 *
 * This exact shape - a module scope constant read before any other check -
 * is what `dev-identity-isolation.test.ts` and slice 05's isolation guard pin
 * by name, so it must not be inlined back into `isDevIdentityEnabled`.
 */
const DEV_IDENTITY_ENABLED = import.meta.env.DEV;

/**
 * True only in dev AND with the runtime flag set. Mirrors the API half's
 * `SALES_AUTH_FAKE` parser exactly: the same four truthy spellings, compared
 * after `trim().toLowerCase()`.
 */
export function isDevIdentityEnabled(): boolean {
  if (!DEV_IDENTITY_ENABLED) return false;
  const flag = import.meta.env.VITE_AUTH_FAKE;
  return typeof flag === 'string' && TRUTHY.has(flag.trim().toLowerCase());
}

/**
 * Reads the adopted identity id out of `localStorage`, absorbing every
 * failure - a throw, private mode, disabled site data, a cleared origin - by
 * answering `null`, which is what tells the caller to fall back to the
 * roster default. A developer preference is not worth failing a session
 * over.
 */
export function readDevIdentityId(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

/**
 * Writes the chosen identity id and reloads. Switching NEVER live-swaps: a
 * live swap would need a second copy of `setActive`'s four-statement critical
 * section (flush the query cache, re-seed the token cache, re-derive
 * `sessionLost`, cross a tenant boundary all at once), and CLAUDE.md is
 * explicit that there must be exactly one copy of that ordering in the app.
 * A reload re-enters through the ordinary cold-boot path instead, which is a
 * path the product already has and already tests.
 *
 * The write is absorbed: a storage failure must not stop the reload, or the
 * tab would be stuck on a half-applied choice instead of landing safely on
 * the roster default.
 */
export function switchDevIdentity(id: string): void {
  try {
    localStorage.setItem(STORAGE_KEY, id);
  } catch {
    // Absorbed. The reload below still happens, landing on the roster default.
  }
  window.location.reload();
}

/**
 * The subset of `@fxl-sales/auth-fake`'s exports this installer consumes.
 * Declared here, against this repo's own understanding of the contract,
 * rather than by importing the package's own types - so a type-only import
 * of the package can never sneak in as a "safe" exception to the
 * dynamic-import rule.
 */
interface FakeIdentity {
  id: string;
  label: string;
  exercises: string;
  activeWorkspaceId: string;
}

interface FakeAuthModule {
  IDENTITIES: readonly FakeIdentity[];
  DEFAULT_IDENTITY_ID: string;
  findIdentity(id: string | null | undefined): FakeIdentity | undefined;
  mintDevToken(identity: FakeIdentity, options?: { organizationId?: string }): string;
  DEV_TOKEN_TTL_SECONDS: number;
}

/**
 * Builds one dev identity session: a full, explicitly typed stand-in
 * `HubClient` (`satisfies HubClient`, never `as never`) plus a refresher that
 * mints a fresh token on every call. Both share the SAME `signedOut` and
 * `activeWorkspaceId` closure state, so `client.logout()` and
 * `client.setActive()` - the only two `HubClient` methods this app's own
 * flows can reach through `useOrganizations()` and `useHubLogout()` - are
 * observed consistently by the refresher `react.tsx` reads through
 * `HubAccessTokenCache`.
 */
function buildDevIdentitySession(fake: FakeAuthModule, identity: FakeIdentity): DevIdentitySession {
  let signedOut = false;
  let activeWorkspaceId = identity.activeWorkspaceId;

  const client: HubClient = {
    login() {
      // There is no Hub to redirect to. A reload re-enters the ordinary
      // cold-boot path, which mints a token again and clears the durable
      // logout intent via `observeToken`'s live-token branch - the
      // anti-lockout backstop CLAUDE.md already names.
      window.location.reload();
    },
    async loginWithPopup() {
      // Nothing in this app calls it. `unavailable` is the outcome that means
      // "no answer about the session", never a fabricated success.
      return { status: 'unavailable' };
    },
    async getToken() {
      return signedOut ? null : fake.mintDevToken(identity, { organizationId: activeWorkspaceId });
    },
    async getTokenResult() {
      if (signedOut) return { status: 'expired' };
      return {
        status: 'ok',
        accessToken: fake.mintDevToken(identity, { organizationId: activeWorkspaceId }),
        expiresIn: fake.DEV_TOKEN_TTL_SECONDS,
      };
    },
    async setActive(organizationId: string) {
      // Mints for the SAME identity with a different active Organization. No
      // navigation, no cache flush, no reload here: `react.tsx`'s own
      // `setActive` owns that critical section and is the only copy of it.
      activeWorkspaceId = organizationId;
      const accessToken = fake.mintDevToken(identity, { organizationId });
      return { accessToken, expiresIn: fake.DEV_TOKEN_TTL_SECONDS, organizationId };
    },
    async logout() {
      // After this, `requestToken()` answers `session_expired` until a
      // reload, so `Sair` really ends the session in dev-fake instead of
      // silently re-minting.
      signedOut = true;
    },
    start() {
      // No-op. The stand-in owns no scheduler.
    },
    stop() {
      // No-op. The stand-in owns no scheduler.
    },
    async checkoutUrl(organizationId: string) {
      // `.invalid` is reserved by RFC 2606: a click can only ever land on a
      // DNS failure, never a real checkout, while the panel's `ready` branch
      // - the one worth reviewing - still renders.
      return `https://dev-fake.invalid/checkout/${organizationId}`;
    },
    async manageUrl(organizationId: string) {
      return `https://dev-fake.invalid/billing/${organizationId}`;
    },
  } satisfies HubClient;

  const requestToken = async (): Promise<HubTokenResult> => {
    if (signedOut) {
      return { token: null, failure: 'session_expired' };
    }
    // Fresh on every call, never memoized: the token carries a real `exp`,
    // and a memoized token would make the proactive renewal at
    // `exp - SESSION_RENEWAL_LEAD_MS` hand back the very token that is about
    // to expire - the exact no-op `HubAccessTokenCache.renew()` exists to
    // avoid. The refresher NEVER answers `transient` - a deliberate
    // limitation the plan records.
    return { token: fake.mintDevToken(identity, { organizationId: activeWorkspaceId }) };
  };

  return {
    identityId: identity.id,
    label: identity.label,
    client,
    requestToken,
  };
}

/**
 * Installs the dev identity session when enabled, in this exact order:
 *
 * 1. Return `null` at once while disabled - checked TWICE, first against the
 *    hoisted `DEV_IDENTITY_ENABLED` constant alone (so a build that folds it
 *    to `false` can prove this whole function body past that point is dead),
 *    then against the runtime flag via `isDevIdentityEnabled()`.
 * 2. Dynamically import the roster package.
 * 3. Resolve the adopted identity: the stored id, or the roster default.
 * 4. Build the stand-in session and install it into the registry.
 * 5. Warn once, naming the adopted identity.
 * 6. Dynamically import and mount the switcher.
 */
export async function installDevIdentityIfEnabled(): Promise<string | null> {
  if (!DEV_IDENTITY_ENABLED) return null;
  if (!isDevIdentityEnabled()) return null;

  const fake = (await import('@fxl-sales/auth-fake')) as unknown as FakeAuthModule;

  const identity =
    fake.findIdentity(readDevIdentityId()) ?? fake.findIdentity(fake.DEFAULT_IDENTITY_ID);
  if (!identity) return null;

  const session = buildDevIdentitySession(fake, identity);
  setDevIdentitySession(session);

  // The one line that stops a developer mistaking dev-fake for real auth in
  // a screenshot.
  console.warn(
    `[dev-identity] VITE_AUTH_FAKE is active. Adopted identity: "${identity.id}" (${identity.label}). ` +
      'The Hub is not being contacted. Use the switcher to change identity.',
  );

  const { mountDevIdentitySwitcher } = await import('./dev-identity-switcher');
  mountDevIdentitySwitcher(fake.IDENTITIES, identity.id, switchDevIdentity);

  return identity.id;
}
