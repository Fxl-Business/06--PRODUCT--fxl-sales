/**
 * ORACLE for the Sales-side invitations seam.
 *
 * `getHubSdkConfig()` is resolved at MODULE load and `test/unit-setup.ts` blanks
 * every Hub credential, so a test that wants a VALID Hub config must stub it,
 * `vi.resetModules()`, and reach `app-auth` and the client module through
 * dynamic imports, so both share ONE `app-auth` instance and the adapter
 * installed below lands on the instance the client reads.
 *
 * `fetch` is stubbed to throw for the whole file: constructing the client, and
 * deciding it is absent, must never contact a Hub.
 */
import type { HubConfig } from '@fxl-business/hub-sdk';
import type { MiddlewareHandler } from 'hono';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SalesInvitationsClient } from '../invitations-client.js';

const HUB_CLIENT_ID = 'pk_fxl-sales_development_unit-test-only-0123456789';
const HUB_CLIENT_SECRET = 'sk_fxl-sales_development_unit-test-only-not-a-real-secret-0123456789';

const fetchSpy = vi.fn(() => {
  throw new Error('invitations-client: nothing in this seam may contact a Hub');
});
vi.stubGlobal('fetch', fetchSpy);

type ClientModule = typeof import('../invitations-client.js');
type AppAuthModule = typeof import('../../../middleware/app-auth.js');

let createCalls: Array<{ config: HubConfig }> = [];
/** When set, the spied `createHubInvitations` throws it instead of building. */
let createThrows: Error | undefined;

function stubCommonEnv(): void {
  vi.stubEnv('NODE_ENV', 'test');
  vi.stubEnv('CORS_ORIGIN', 'http://localhost:8006');
  vi.stubEnv('DATABASE_URL', 'postgresql://postgres:postgres@localhost:5006/fxl_sales_wiring_test');
  vi.stubEnv('ADMIN_DATABASE_URL', '');
  vi.stubEnv('SALES_AUTH_FAKE', '');
  vi.stubEnv('FXL_HUB_CONFIG', '');
}

function stubValidHubConfig(): void {
  stubCommonEnv();
  vi.stubEnv('FXL_HUB_API_URL', 'http://localhost:9016');
  vi.stubEnv('FXL_HUB_ENVIRONMENT', 'development');
  vi.stubEnv('FXL_HUB_CLIENT_ID', HUB_CLIENT_ID);
  vi.stubEnv('FXL_HUB_CLIENT_SECRET', HUB_CLIENT_SECRET);
  vi.stubEnv('FXL_HUB_AUDIENCE', 'app.fxl-sales');
  vi.stubEnv('FXL_HUB_REDIRECT_URI', 'http://localhost:8006/auth/callback');
}

/**
 * Loads a fresh module graph, spying `createHubInvitations` so the test can see
 * how many instances were built and from which config.
 */
async function loadGraph(): Promise<{ client: ClientModule; appAuth: AppAuthModule }> {
  vi.resetModules();
  vi.doMock('@fxl-business/hub-sdk/server', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@fxl-business/hub-sdk/server')>();
    return {
      ...actual,
      createHubInvitations: (...args: Parameters<typeof actual.createHubInvitations>) => {
        createCalls.push({ config: args[0] });
        if (createThrows) throw createThrows;
        return actual.createHubInvitations(...args);
      },
    };
  });
  const appAuth = await import('../../../middleware/app-auth.js');
  const client = await import('../invitations-client.js');
  return { client, appAuth };
}

const devAdapter: MiddlewareHandler = async (_c, next) => {
  await next();
};

function fakeClient(): SalesInvitationsClient {
  return {
    create: vi.fn(),
    list: vi.fn(),
    revoke: vi.fn(),
    resend: vi.fn(),
  };
}

beforeEach(() => {
  createCalls = [];
  createThrows = undefined;
  fetchSpy.mockClear();
});

afterEach(() => {
  vi.doUnmock('@fxl-business/hub-sdk/server');
  vi.unstubAllEnvs();
  // unit-setup's blanking is undone by unstubAllEnvs; restore it for the next case.
  for (const name of [
    'FXL_HUB_CONFIG',
    'FXL_HUB_API_URL',
    'FXL_HUB_ENVIRONMENT',
    'FXL_HUB_CLIENT_ID',
    'FXL_HUB_CLIENT_SECRET',
    'FXL_HUB_AUDIENCE',
    'SALES_ENV_FILE',
    'SALES_AUTH_FAKE',
  ]) {
    vi.stubEnv(name, '');
  }
  expect(fetchSpy).not.toHaveBeenCalled();
});

afterAll(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe('getInvitationsClient with a VALID Hub config', () => {
  it('positive control: builds ONE real client from getHubSdkConfig() with no network I/O', async () => {
    stubValidHubConfig();
    const { client, appAuth } = await loadGraph();

    const config = appAuth.getHubSdkConfig();
    expect(config).not.toBeNull();
    expect(appAuth.isAppAuthAdapterInstalled()).toBe(false);
    // Lazy: nothing is built at module load.
    expect(createCalls).toHaveLength(0);

    const first = client.getInvitationsClient();
    const second = client.getInvitationsClient();

    expect(first).not.toBeNull();
    expect(second).toBe(first);
    expect(typeof first?.create).toBe('function');
    expect(typeof first?.list).toBe('function');
    expect(typeof first?.revoke).toBe('function');
    expect(typeof first?.resend).toBe('function');
    expect(createCalls).toHaveLength(1);
    expect(createCalls[0]?.config).toBe(config);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('is null while the development identity adapter is installed, and nothing contacts the Hub', async () => {
    stubValidHubConfig();
    const { client, appAuth } = await loadGraph();

    // Same valid config as the positive control: the ONLY difference is the adapter.
    expect(appAuth.getHubSdkConfig()).not.toBeNull();
    appAuth.installAppAuthAdapter(devAdapter);
    expect(appAuth.isAppAuthAdapterInstalled()).toBe(true);

    expect(client.getInvitationsClient()).toBeNull();
    expect(client.getInvitationsClient()).toBeNull();
    expect(createCalls).toHaveLength(0);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('decides lazily and memoizes; reset clears the memoized decision', async () => {
    stubValidHubConfig();
    const { client, appAuth } = await loadGraph();

    const real = client.getInvitationsClient();
    expect(real).not.toBeNull();

    appAuth.installAppAuthAdapter(devAdapter);
    // Memoized: the decision taken on the first call stands.
    expect(client.getInvitationsClient()).toBe(real);

    client.resetInvitationsClientForTests();
    // Re-resolved against the CURRENT state, which now has the adapter.
    expect(client.getInvitationsClient()).toBeNull();
    expect(createCalls).toHaveLength(1);
  });
});

describe('getInvitationsClient when the SDK refuses to build the client', () => {
  it('returns null, never throws, and logs only the error name', async () => {
    stubValidHubConfig();
    const { client } = await loadGraph();
    class HubConfigRefusedError extends Error {
      override name = 'HubConfigRefusedError';
    }
    createThrows = new HubConfigRefusedError('secret-bearing detail sk_must_not_be_logged');
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    try {
      expect(() => client.getInvitationsClient()).not.toThrow();
      // Memoized null: a second call neither throws nor rebuilds.
      expect(client.getInvitationsClient()).toBeNull();
      expect(createCalls).toHaveLength(1);
      expect(consoleError).toHaveBeenCalledTimes(1);
      expect(consoleError.mock.calls[0]).toEqual([
        '[invitations] Could not build the Hub invitations client:',
        'HubConfigRefusedError',
      ]);
      expect(JSON.stringify(consoleError.mock.calls)).not.toContain('sk_must_not_be_logged');
    } finally {
      consoleError.mockRestore();
    }
  });
});

describe('getInvitationsClient with NO Hub config', () => {
  it('is null and builds nothing', async () => {
    stubCommonEnv();
    const { client, appAuth } = await loadGraph();

    expect(appAuth.getHubSdkConfig()).toBeNull();
    expect(appAuth.isAppAuthAdapterInstalled()).toBe(false);
    expect(client.getInvitationsClient()).toBeNull();
    expect(createCalls).toHaveLength(0);
  });
});

describe('the test seam has three explicit states', () => {
  it('an injected fake is returned as-is, even with no Hub config', async () => {
    stubCommonEnv();
    const { client } = await loadGraph();
    const fake = fakeClient();

    client.setInvitationsClientForTests(fake);
    expect(client.getInvitationsClient()).toBe(fake);
    expect(createCalls).toHaveLength(0);
  });

  it('forced absent returns null even with a valid Hub config and no adapter', async () => {
    stubValidHubConfig();
    const { client } = await loadGraph();

    client.forceInvitationsClientAbsentForTests();
    expect(client.getInvitationsClient()).toBeNull();
    expect(createCalls).toHaveLength(0);
  });

  it('reset returns to the real resolution after a fake or a forced absence', async () => {
    stubValidHubConfig();
    const { client } = await loadGraph();
    const fake = fakeClient();

    client.setInvitationsClientForTests(fake);
    expect(client.getInvitationsClient()).toBe(fake);

    client.forceInvitationsClientAbsentForTests();
    expect(client.getInvitationsClient()).toBeNull();

    client.resetInvitationsClientForTests();
    const real = client.getInvitationsClient();
    expect(real).not.toBeNull();
    expect(real).not.toBe(fake);
    expect(createCalls).toHaveLength(1);
  });

  it('a fake with the SDK shape is driven through the getter with the SDK argument shapes', async () => {
    stubCommonEnv();
    const { client } = await loadGraph();
    const fake = fakeClient();
    client.setInvitationsClientForTests(fake);

    const seam = client.getInvitationsClient();
    expect(seam).not.toBeNull();
    await seam?.create({ accessToken: 't', email: 'a@b.c', appRoles: ['seller'], locale: 'pt-BR' });
    await seam?.list({ accessToken: 't', status: 'pending' });
    await seam?.revoke({ accessToken: 't', invitationId: 'inv-1' });
    await seam?.resend({ accessToken: 't', invitationId: 'inv-1', locale: 'en' });

    expect(fake.create).toHaveBeenCalledWith({
      accessToken: 't',
      email: 'a@b.c',
      appRoles: ['seller'],
      locale: 'pt-BR',
    });
    expect(fake.list).toHaveBeenCalledWith({ accessToken: 't', status: 'pending' });
    expect(fake.revoke).toHaveBeenCalledWith({ accessToken: 't', invitationId: 'inv-1' });
    expect(fake.resend).toHaveBeenCalledWith({
      accessToken: 't',
      invitationId: 'inv-1',
      locale: 'en',
    });
  });
});

describe('source discipline', () => {
  it('never reads SALES_AUTH_FAKE and never logs acceptUrl', async () => {
    const { readFile } = await import('node:fs/promises');
    const source = await readFile(new URL('../invitations-client.ts', import.meta.url), 'utf8');
    expect(source).not.toMatch(/SALES_AUTH_FAKE/);
    expect(source).not.toMatch(/process\.env/);
    expect(source).not.toMatch(/console\.[a-z]+\([^)]*acceptUrl/);
  });
});
