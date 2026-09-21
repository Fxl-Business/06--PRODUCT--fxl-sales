// @vitest-environment happy-dom
import type { HubClient } from '@fxl-business/hub-sdk/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import * as React from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppAuthProvider, Protected, useAuthProfile } from '@/auth/react';
import { getRolesFromHubClaims } from '@/auth/claims';
import { getVisibleWorkspaces } from '@/sales-ops/navigation';
import { getDevIdentitySession, setDevIdentitySession } from '../dev-identity-registry';
import { installDevIdentityIfEnabled } from '../install-dev-identity';

/**
 * Drives the REAL `AppAuthProvider` and `Protected` from `@/auth/react`, the
 * REAL `@fxl-sales/auth-fake` roster, the REAL `getRolesFromHubClaims` and
 * the REAL `getVisibleWorkspaces`. Nothing in the auth path is mocked.
 *
 * The roster's central promise - that `expectedRoles` and `expectedPaineis`
 * on each fixture are true of the REAL translation, not just declared - is
 * untested anywhere else. Slice 01's own `roster.test.ts` compares those
 * fields against hand-typed literals, which a package under `packages/`
 * must do since it cannot import an app; this file is the cross-check the
 * plan assigns to slice 03.
 *
 * That cross-check MUST compare against the roster's own declared
 * `expectedRoles`/`expectedPaineis`, never against a second, hand-typed
 * table kept in this file: a table keyed by identity id can drift from the
 * roster silently, which is exactly the failure this file exists to catch
 * in the roster itself. `REACHABLE_IDENTITIES` below is therefore derived
 * from the roster, not authored here.
 */

// A dynamic import, never a static one: `@fxl-sales/auth-fake` documents
// itself as reachable only through `await import(...)`, mirroring the
// convention every other test in this file already follows. Top-level await
// is fine in this Vite/Vitest ESM test file, and it is what lets
// `REACHABLE_IDENTITIES` below be built from the real roster instead of a
// parallel literal.
const fakeRoster = await import('@fxl-sales/auth-fake');

const act = (
  React as typeof React & { act: typeof import('react-dom/test-utils').act }
).act;

const STORAGE_KEY = 'fxl-sales.dev-identity';

/** Mirrors `apps/web/src/auth/__tests__/react.test.tsx`'s own `jwt()` helper. */
function jwt(claims: Record<string, unknown>): string {
  const payload = Buffer.from(JSON.stringify(claims)).toString('base64url');
  return `header.${payload}.signature`;
}

type HubClaimsLike = Parameters<typeof getRolesFromHubClaims>[0];

function Probe() {
  const { roles } = useAuthProfile();
  return <output data-testid="workspaces">{getVisibleWorkspaces(roles).join(',')}</output>;
}

function freshQueryClient(): QueryClient {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

function renderProbe(): { host: HTMLElement; root: Root } {
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  const client = freshQueryClient();

  act(() => {
    root.render(
      <QueryClientProvider client={client}>
        <AppAuthProvider>
          <MemoryRouter>
            <Protected>
              <Probe />
            </Protected>
          </MemoryRouter>
        </AppAuthProvider>
      </QueryClientProvider>,
    );
  });

  return { host, root };
}

function workspacesText(host: HTMLElement): string | undefined {
  return host.querySelector('[data-testid="workspaces"]')?.textContent ?? undefined;
}

function teardown(host: HTMLElement, root: Root): void {
  act(() => root.unmount());
  host.remove();
}

/** A fully-typed no-op `HubClient`, for the one test that installs a hand-built
 *  session rather than going through `installDevIdentityIfEnabled`. */
function buildStubClient(token: string): HubClient {
  return {
    login: vi.fn(),
    loginWithPopup: vi.fn(async () => ({ status: 'unavailable' as const })),
    getToken: vi.fn(async () => token),
    getTokenResult: vi.fn(async () => ({
      status: 'ok' as const,
      accessToken: token,
      expiresIn: 900,
    })),
    setActive: vi.fn(async (organizationId: string) => ({
      accessToken: token,
      expiresIn: 900,
      organizationId,
    })),
    logout: vi.fn(async () => {}),
    start: vi.fn(),
    stop: vi.fn(),
    checkoutUrl: vi.fn(async (organizationId: string) => `https://dev-fake.invalid/checkout/${organizationId}`),
    manageUrl: vi.fn(async (organizationId: string) => `https://dev-fake.invalid/billing/${organizationId}`),
  } satisfies HubClient;
}

beforeEach(() => {
  (
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(() => {
  setDevIdentitySession(null);
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore - some tests deliberately break localStorage
  }
  document.body.innerHTML = '';
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('dev identity roles', () => {
  /**
   * Every roster identity whose Organization CARRIES access. This is the
   * roster's own `hasAccess` field, not a hand-picked subset: an identity
   * with `hasAccess: false` (today, only `no-access`) makes `requireHubAuth`
   * answer 402 before `Protected` ever renders `Probe`, so its
   * `workspacesText` would read `undefined` rather than its declared
   * `expectedPaineis` - a different, already-covered behaviour
   * (`MissingEntitlementPanel`), not a gap in this cross-check.
   *
   * `team-owner`, `team-admin` and `product-admin` each reach the
   * full-access role set through a DIFFERENT claim shape (F3 in
   * `packages/auth-fake/src/index.ts`), so all three are exercised even
   * though they share one expected outcome; `multi-org` reaches it a fourth
   * way (two entitled Organizations) and is exercised here too now that
   * this table is the whole roster rather than a hand-picked list.
   *
   * DECISIVE MUTATION: replacing the provider's dev branch with the real
   * refresher makes every case below time out signed-out, because there is
   * no Hub to answer `/auth/refresh`. Replacing `getRolesFromHubClaims` with
   * a constant makes several of the distinct outcomes fail. Mutating a
   * roster identity's declared `expectedRoles` or `expectedPaineis` to a
   * wrong value must ALSO fail here, which is the whole point: this is the
   * only place that checks those two fields are true of the real
   * translation rather than merely internally consistent.
   */
  const REACHABLE_IDENTITIES = fakeRoster.IDENTITIES.filter((identity) => identity.hasAccess);

  it.each(REACHABLE_IDENTITIES)(
    'drives getVisibleWorkspaces and getRolesFromHubClaims from the adopted identity through the real claim translation ($id), against the roster\'s own declared expectations',
    async (identity) => {
      vi.stubEnv('VITE_AUTH_FAKE', '1');
      localStorage.setItem(STORAGE_KEY, identity.id);

      const adopted = await installDevIdentityIfEnabled();
      expect(adopted).toBe(identity.id);

      const { host, root } = renderProbe();
      await flush();

      expect(workspacesText(host)).toBe(identity.expectedPaineis.join(','));

      // Independently decode a freshly minted token for this same identity
      // and run it through the REAL getRolesFromHubClaims, so expectedRoles
      // is checked too - workspacesText above only ever proves
      // expectedPaineis, since getVisibleWorkspaces is the only consumer of
      // roles that Probe surfaces.
      const token = fakeRoster.mintDevToken(identity);
      const claims = JSON.parse(
        Buffer.from(token.split('.')[1] ?? '', 'base64url').toString('utf8'),
      ) as HubClaimsLike;
      expect(getRolesFromHubClaims(claims)).toEqual([...identity.expectedRoles]);

      teardown(host, root);
    },
  );

  it('no roster identity reaches the team painéis without meus-dados', async () => {
    // F3, `packages/auth-fake/src/index.ts`: `getRolesFromHubClaims` returns
    // the full-access array from every branch that can yield `admin` at
    // all, so no claim shape this roster can mint produces
    // ['tatico','operacional','cadastros'] alone through the REAL
    // translation. Recorded here through the real functions, not merely
    // declared on the roster's own `expectedPaineis` fields.
    const fake = await import('@fxl-sales/auth-fake');
    for (const identity of fake.IDENTITIES) {
      const token = fake.mintDevToken(identity);
      const claims = JSON.parse(
        Buffer.from(token.split('.')[1] ?? '', 'base64url').toString('utf8'),
      ) as HubClaimsLike;
      const roles = getRolesFromHubClaims(claims);
      const workspaces = getVisibleWorkspaces(roles);
      expect(workspaces).not.toEqual(['tatico', 'operacional', 'cadastros']);
    }
  });

  it('takes its roles only from the minted token, never from a fixture profile', async () => {
    vi.stubEnv('VITE_AUTH_FAKE', '1');
    const fake = await import('@fxl-sales/auth-fake');
    const identity = fake.findIdentity('seller');
    if (!identity) throw new Error('seller identity missing from the roster');

    const claims = fake.toHubClaims(identity) as Record<string, unknown>;
    delete claims.roles;
    const strippedToken = jwt(claims);

    setDevIdentitySession({
      identityId: identity.id,
      label: identity.label,
      client: buildStubClient(strippedToken),
      requestToken: async () => ({ token: strippedToken }),
    });

    const { host, root } = renderProbe();
    await flush();

    // The `seller` fixture's expectedPaineis is `['meus-dados']`. Stripping
    // `roles` from the claim set must collapse that to nothing if - and
    // only if - the provider really decodes the token via
    // `parseJwtPayload`/`getRolesFromHubClaims` rather than reading some
    // ready-made shape off the identity object.
    expect(workspacesText(host)).toBe('');

    teardown(host, root);
  });

  it('signs the operator in without ever calling login, so cold entry never redirects to a Hub that is not there', async () => {
    vi.stubEnv('VITE_AUTH_FAKE', '1');
    localStorage.setItem(STORAGE_KEY, 'team-owner');

    const adopted = await installDevIdentityIfEnabled();
    expect(adopted).toBe('team-owner');

    const session = getDevIdentitySession();
    if (!session) throw new Error('dev identity session was not installed');
    const loginSpy = vi.spyOn(session.client, 'login');
    const assignSpy = vi.spyOn(window.location, 'assign').mockImplementation(() => {});

    const { host, root } = renderProbe();
    await flush();

    expect(workspacesText(host)).toBe('tatico,operacional,cadastros,meus-dados');
    expect(loginSpy).not.toHaveBeenCalled();
    expect(assignSpy).not.toHaveBeenCalled();

    teardown(host, root);
  });

  it('adopts the identity stored under fxl-sales.dev-identity over the roster default', async () => {
    vi.stubEnv('VITE_AUTH_FAKE', '1');
    localStorage.setItem(STORAGE_KEY, 'seller');

    const adopted = await installDevIdentityIfEnabled();
    expect(adopted).toBe('seller');

    const { host, root } = renderProbe();
    await flush();

    expect(workspacesText(host)).toBe('meus-dados');

    teardown(host, root);
  });

  it('falls back to the roster default when localStorage throws on read', async () => {
    vi.stubEnv('VITE_AUTH_FAKE', '1');
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('storage refused');
    });

    const fake = await import('@fxl-sales/auth-fake');
    const adopted = await installDevIdentityIfEnabled();

    expect(adopted).toBe(fake.DEFAULT_IDENTITY_ID);
  });
});
