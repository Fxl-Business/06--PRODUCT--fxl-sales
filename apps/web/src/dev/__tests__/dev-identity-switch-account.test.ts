// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getDevIdentitySession, setDevIdentitySession } from '../dev-identity-registry';
import { installDevIdentityIfEnabled } from '../install-dev-identity';

/**
 * The dev stand-in `HubClient` must carry `switchAccount` (a required member of the
 * 2.5.0 `HubClient`), and it must behave like the dev `login()`: a reload that re-enters
 * the cold-boot path with the SAME adopted identity. There is no Hub Account Chooser in
 * dev-fake, so it never navigates anywhere and never swaps the identity live.
 *
 * Driven through the REAL `installDevIdentityIfEnabled` and the REAL
 * `@fxl-sales/auth-fake` roster, exactly as `make dev-fake` reaches it.
 */

const STORAGE_KEY = 'fxl-sales.dev-identity';
const SWITCHER_HOST = '#fxl-sales-dev-identity-switcher';

type Claims = { sub?: string; email?: string; workspaceId?: string };

function decode(token: string | null): Claims {
  if (!token) throw new Error('expected a minted token');
  return JSON.parse(Buffer.from(token.split('.')[1] ?? '', 'base64url').toString('utf8')) as Claims;
}

let reloadSpy: ReturnType<typeof vi.fn>;

beforeEach(() => {
  reloadSpy = vi.fn();
  Object.defineProperty(window.location, 'reload', { configurable: true, value: reloadSpy });
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  vi.stubEnv('VITE_AUTH_FAKE', '1');
  localStorage.setItem(STORAGE_KEY, 'multi-org');
});

afterEach(() => {
  setDevIdentitySession(null);
  document.querySelector(SWITCHER_HOST)?.remove();
  localStorage.clear();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

async function installedClient() {
  const adopted = await installDevIdentityIfEnabled();
  expect(adopted).toBe('multi-org');
  const session = getDevIdentitySession();
  if (!session) throw new Error('dev identity session was not installed');
  return session;
}

describe('dev identity client switchAccount', () => {
  it('exists on the stand-in client and reloads exactly like login', async () => {
    const { client } = await installedClient();
    expect(typeof client.switchAccount).toBe('function');

    const hrefBefore = window.location.href;
    expect(() => client.switchAccount()).not.toThrow();
    expect(reloadSpy).toHaveBeenCalledTimes(1);
    // A reload, never a navigation: no Hub, no `/auth/login?prompt=select_account`.
    expect(window.location.href).toBe(hrefBefore);

    client.login();
    expect(reloadSpy).toHaveBeenCalledTimes(2);
  });

  it('never swaps the adopted identity or the active Organization, even when hinted', async () => {
    const session = await installedClient();
    const before = decode(await session.client.getToken());
    /*
      A REAL second Organization of the adopted identity. The minter silently ignores an
      Organization the identity does not belong to, so an unknown id here would let a
      shim that DID switch Organization pass unnoticed.
    */
    const fake = await import('@fxl-sales/auth-fake');
    const other = fake
      .findIdentity('multi-org')
      ?.workspaces.map((entry) => entry.workspaceId)
      .find((id) => id !== before.workspaceId);
    if (!other) throw new Error('multi-org must belong to a second Organization');

    session.client.switchAccount({ organization: other });

    expect(reloadSpy).toHaveBeenCalledTimes(1);
    expect(getDevIdentitySession()).toBe(session);
    expect(session.identityId).toBe('multi-org');
    expect(localStorage.getItem(STORAGE_KEY)).toBe('multi-org');

    const after = decode(await session.client.getToken());
    expect(after.sub).toBe(before.sub);
    expect(after.email).toBe(before.email);
    expect(after.workspaceId).toBe(before.workspaceId);

    const refreshed = await session.requestToken();
    expect(decode(refreshed.token).workspaceId).toBe(before.workspaceId);
  });
});
