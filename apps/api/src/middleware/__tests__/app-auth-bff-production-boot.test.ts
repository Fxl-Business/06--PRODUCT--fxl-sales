/**
 * The options `createAppAuthBff` assembles when the HUB environment is NOT
 * development.
 *
 * It needs its own file because the answer is decided at module load: the Hub
 * config is read once, and `insecureCookies` / `allowEphemeralSessionStore` are
 * spread in or out on that one boolean. Vitest isolates per file, so this is the
 * only way to observe the non-development branch alongside the development one
 * that `app-auth-bff-wiring.test.ts` covers.
 *
 * This is also the branch that CANNOT be exercised locally by hand: a developer
 * runs against a development Hub Client, and every defect this repo has chased
 * in the BFF was a production-only path that looked fine on a laptop. So it is
 * pinned here rather than discovered in a deploy window.
 *
 * `staging` rather than `production` on purpose. The rule under test is "not
 * development", and staging is the environment where a wrong answer is cheapest
 * to discover; using `production` would also invite someone to relax the test by
 * relaxing what production means.
 */
import { assertBootConfiguration } from '@fxl-business/hub-sdk/server';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const HUB_CLIENT_ID = 'pk_fxl-sales_staging_unit-test-only-0123456789';
const HUB_CLIENT_SECRET = 'sk_fxl-sales_staging_unit-test-only-not-a-real-secret-0123456789';
/** Operator-generated, never Hub-issued. Obviously synthetic. */
const HEALTH_TOKEN = 'unit-test-operator-generated-health-token';

type CapturedBffOptions =
  | {
      insecureCookies?: unknown;
      allowEphemeralSessionStore?: unknown;
      healthToken?: unknown;
      trustedOrigins?: readonly string[];
      fetchImpl?: unknown;
    }
  | undefined;

let bffOptions: CapturedBffOptions;

beforeAll(async () => {
  vi.resetModules();

  // NODE_ENV stays 'test' while the HUB environment is 'staging', which is the
  // independence this repo insists on: the Hub environment is explicit
  // configuration and is never inferred from the process environment.
  vi.stubEnv('NODE_ENV', 'test');
  vi.stubEnv('CORS_ORIGIN', 'https://sales.fxlbusiness.test');
  vi.stubEnv('DATABASE_URL', 'postgresql://postgres:postgres@localhost:5006/fxl_sales_boot_test');
  vi.stubEnv('ADMIN_DATABASE_URL', '');
  vi.stubEnv('FXL_HUB_API_URL', 'https://hub.fxlbusiness.test');
  vi.stubEnv('FXL_HUB_ENVIRONMENT', 'staging');
  vi.stubEnv('FXL_HUB_CLIENT_ID', HUB_CLIENT_ID);
  vi.stubEnv('FXL_HUB_CLIENT_SECRET', HUB_CLIENT_SECRET);
  vi.stubEnv('FXL_HUB_AUDIENCE', 'app.fxl-sales');
  vi.stubEnv('FXL_HUB_CONFIG', '');
  vi.stubEnv('FXL_HUB_HEALTH_TOKEN', HEALTH_TOKEN);
  vi.stubEnv('FXL_HUB_REDIRECT_URI', 'https://sales-api.fxlbusiness.test/auth/callback');
  vi.stubEnv('FXL_HUB_POST_LOGIN_REDIRECT', 'https://sales.fxlbusiness.test');
  vi.stubEnv('FXL_HUB_POST_LOGIN_ERROR_REDIRECT', 'https://sales.fxlbusiness.test/?error=auth');
  vi.stubEnv('SALES_SESSION_ENCRYPTION_IKM', '');

  vi.doMock('@fxl-business/hub-sdk/server', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@fxl-business/hub-sdk/server')>();
    return {
      ...actual,
      createHubBff: (config: Parameters<typeof actual.createHubBff>[0], options: never) => {
        bffOptions = options as CapturedBffOptions;
        return actual.createHubBff(config, options);
      },
    };
  });

  const appAuth = await import('../app-auth.js');
  appAuth.createAppAuthBff();
});

afterAll(() => {
  vi.doUnmock('@fxl-business/hub-sdk/server');
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe('createAppAuthBff outside a development Hub environment', () => {
  it('omits the insecureCookies KEY entirely rather than passing it as false', () => {
    /*
      The assertion is on the KEY, not on the value, and that is deliberate.
      `insecureCookies: false` outside development is legal and says nothing;
      `insecureCookies: true` outside development is a BOOT FAILURE. Writing the
      option as a spread is what keeps the key absent, and simplifying it to
      `insecureCookies: isHubDevelopment` would make it present-and-false, pass a
      value assertion, and quietly change what the boot assertion is judging.
    */
    expect('insecureCookies' in (bffOptions ?? {})).toBe(false);
  });

  it('never opts into the ephemeral session store outside development', () => {
    // The pair to the option above: a deploy that loses DATABASE_URL must fail
    // at boot rather than silently going per-process, which logs every user out
    // on each restart and hides a session from a second replica.
    expect('allowEphemeralSessionStore' in (bffOptions ?? {})).toBe(false);
  });

  it('delivers the operator-generated health token, which the boot assertion requires here', () => {
    // Loaded and validated in auth-provider.ts long before 1.3.1 had an option
    // to receive it. Passing it is what this bump finally does.
    //
    // Note for anyone mutating this: DELETING the option does not redden this
    // assertion, it makes the whole file fail to load, because the SDK refuses
    // to construct without it outside development. That is a stronger guarantee
    // than a red assertion and a worse diagnostic, so the refusal itself is
    // pinned separately below. What this assertion catches is the wrong VALUE
    // reaching the SDK, which nothing else would.
    expect(bffOptions?.healthToken).toBe(HEALTH_TOKEN);
  });

  it('is refused at BOOT, not answered as a 503, when the health token is absent', () => {
    /*
      The guarantee behind the assertion above, stated directly against the SDK
      rather than inferred from this file failing to load.

      A misconfiguration here must be LOUD and IMMEDIATE. The alternative shape,
      a process that starts and answers 503 to every request, is what this
      repo's auth-provider header forbids.

      The two inputs differ in the health token and in NOTHING else, so the throw
      cannot be blamed on some other missing member. Without that pairing a bare
      `toThrow()` would pass for the wrong reason and prove nothing.
    */
    const base = {
      config: {
        apiUrl: 'https://hub.fxlbusiness.test',
        environment: 'staging' as const,
        clientId: HUB_CLIENT_ID,
        clientSecret: HUB_CLIENT_SECRET,
        audience: 'app.fxl-sales',
      },
      sessionStore: {
        kind: 'persistent' as const,
        create: async () => 'id',
        withSession: async () => undefined as never,
        createLoginTransaction: async () => 'tx',
        consumeLoginTransaction: async () => null,
      },
    };

    expect(() => assertBootConfiguration({ ...base })).toThrow();
    expect(() => assertBootConfiguration({ ...base, healthToken: HEALTH_TOKEN })).not.toThrow();
  });

  it('vouches for the web origin, which is a different host from the API in this topology', () => {
    // Dropping this reproduces the 2026-08-10 outage: the browser POSTs from
    // sales.* to sales-api.*, and the SDK's own-origin computation alone does
    // not admit it.
    expect(bffOptions?.trustedOrigins).toEqual(['https://sales.fxlbusiness.test']);
  });

  it('passes no fetchImpl, so the SDK rotation parser is the one that runs', () => {
    // 2.2.0 matches `__Host-fxl_hub_session` natively. This is the environment
    // where the Hub actually sends that name, so it is the one that matters.
    expect(bffOptions?.fetchImpl).toBeUndefined();
  });
});
