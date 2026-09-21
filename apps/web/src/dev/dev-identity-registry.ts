/**
 * The slot that `apps/web/src/auth/react.tsx` reads to find out whether a
 * development identity session has been installed, and if so, what it is.
 *
 * This file is deliberately tiny. It imports NOTHING at runtime, and it knows
 * nothing about identities, rosters, minted tokens or the switcher UI. It
 * exists solely so `auth/react.tsx` can be handed a dev session without ever
 * naming `@fxl-sales/auth-fake`, `install-dev-identity.ts` or
 * `dev-identity-switcher.ts` - see `CLAUDE.md`'s "Auth Model" and this
 * slice's plan, section 2.1.
 *
 * Both type imports below are `import type`, so they leave no runtime edge:
 * they cannot create a module cycle with `../auth/refresh` and they vanish
 * entirely once TypeScript is stripped.
 */
import type { HubClient } from '@fxl-business/hub-sdk/client';
import type { HubTokenResult } from '../auth/refresh';

export type DevIdentitySession = {
  /** The roster id this session adopted, for display and diagnostics only. */
  identityId: string;
  /** The roster's human label for the adopted identity. */
  label: string;
  /** The stand-in `HubClient` this session installs in place of the real one. */
  client: HubClient;
  /** Mints a fresh token on every call. Installed in place of `requestHubAccessToken`. */
  requestToken: () => Promise<HubTokenResult>;
};

let currentSession: DevIdentitySession | null = null;

/**
 * Installs (or clears, with `null`) the dev identity session that
 * `getDevIdentitySession` will answer with. Called exactly once per boot by
 * `install-dev-identity.ts`, and by tests to reset state between cases.
 */
export function setDevIdentitySession(session: DevIdentitySession | null): void {
  currentSession = session;
}

/**
 * Answers `null` immediately when `import.meta.env.DEV` is false, BEFORE
 * reading the module variable at all. That ordering is what makes a
 * production build's answer independent of whatever happened to be written
 * here at some point in the module's lifetime - there is no code path in a
 * production bundle that ever calls `setDevIdentitySession` in the first
 * place, but this function does not rely on that being true either.
 */
export function getDevIdentitySession(): DevIdentitySession | null {
  if (!import.meta.env.DEV) return null;
  return currentSession;
}
