import {
  createHubInvitations,
  type CreateHubInvitationInput,
  type HubInvitationList,
  type HubInvitationResult,
  type ListHubInvitationsInput,
  type ResendHubInvitationInput,
  type RevokeHubInvitationInput,
} from '@fxl-business/hub-sdk/server';
import { getHubSdkConfig, isAppAuthAdapterInstalled } from '../../middleware/app-auth.js';

/**
 * The Sales-side invitations seam. Same methods and argument shapes as the SDK's
 * `HubInvitations`, so the real instance satisfies it directly and a test fake
 * is a plain object with four functions.
 *
 * A `HubInvitationResult.acceptUrl` carries a single-use token. It may be handed
 * back to a caller that is allowed to hold it, and it is never logged.
 */
export interface SalesInvitationsClient {
  create(input: CreateHubInvitationInput): Promise<HubInvitationResult>;
  list(input: ListHubInvitationsInput): Promise<HubInvitationList>;
  revoke(input: RevokeHubInvitationInput): Promise<void>;
  resend(input: ResendHubInvitationInput): Promise<HubInvitationResult>;
}

/**
 * Test override. Three explicit states, never one setter where `null` would
 * mean both "absent" and "go back to the real resolution":
 * - `undefined`: no override, the real resolution applies;
 * - `{ kind: 'fake' }`: the injected client is returned as-is;
 * - `{ kind: 'absent' }`: the getter answers null.
 */
type TestOverride = { kind: 'fake'; client: SalesInvitationsClient } | { kind: 'absent' };

let testOverride: TestOverride | undefined;

/** `undefined` until the first call; then the memoized decision, null included. */
let resolved: { client: SalesInvitationsClient | null } | undefined;

/**
 * Null when there is no Hub configuration, and null while the development
 * identity adapter is installed: with a VALID local Hub config that mode still
 * yields a non-null config, and a real client would carry the fake bearer to the
 * real Hub. The adapter slot is the one signal, read from `app-auth.ts`; no
 * environment flag is consulted here.
 *
 * Decided LAZILY on the first call, which happens after boot has installed (or
 * not) the adapter, and memoized: one instance per process, never one per
 * request. Construction does no network I/O.
 */
function resolveRealClient(): SalesInvitationsClient | null {
  const config = getHubSdkConfig();
  if (!config || isAppAuthAdapterInstalled()) return null;
  try {
    return createHubInvitations(config);
  } catch (error) {
    // `createHubInvitations` re-validates the config the boot already validated,
    // so this is unreachable in practice. The getter still never throws; the
    // route answers the unavailable body instead. Only the error NAME is
    // logged, never a message that could quote configuration.
    console.error(
      '[invitations] Could not build the Hub invitations client:',
      error instanceof Error ? error.name : typeof error,
    );
    return null;
  }
}

export function getInvitationsClient(): SalesInvitationsClient | null {
  if (testOverride) {
    return testOverride.kind === 'fake' ? testOverride.client : null;
  }
  if (!resolved) {
    resolved = { client: resolveRealClient() };
  }
  return resolved.client;
}

/** Tests only: every later `getInvitationsClient()` returns `client`. */
export function setInvitationsClientForTests(client: SalesInvitationsClient): void {
  testOverride = { kind: 'fake', client };
}

/** Tests only: every later `getInvitationsClient()` returns null. */
export function forceInvitationsClientAbsentForTests(): void {
  testOverride = { kind: 'absent' };
}

/** Tests only: drops any override AND the memoized decision. */
export function resetInvitationsClientForTests(): void {
  testOverride = undefined;
  resolved = undefined;
}
