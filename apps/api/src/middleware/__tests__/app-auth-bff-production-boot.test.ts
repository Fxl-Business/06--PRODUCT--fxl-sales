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
import { type HubConfig, HubConfigError } from '@fxl-business/hub-sdk';
import { assertBootConfiguration } from '@fxl-business/hub-sdk/server';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const HUB_CLIENT_ID = 'pk_fxl-sales_staging_unit-test-only-0123456789';
const HUB_CLIENT_SECRET = 'sk_fxl-sales_staging_unit-test-only-not-a-real-secret-0123456789';
/** Operator-generated, never Hub-issued. Obviously synthetic. */
const HEALTH_TOKEN = 'unit-test-operator-generated-health-token';

/**
 * A boot input that is legal in every respect EXCEPT the one member each test
 * below varies, so a `toThrow()` can only be blamed on that member.
 *
 * A factory rather than a shared constant: the redirect test spreads a modified
 * `config` over it, and a shared object would let one test's mutation leak into
 * the next. The `redirectUri` is on the BROWSER-facing origin, which is a
 * different host from `apiUrl` in this topology - see the redirect test.
 */
function bootBase() {
  return {
    config: {
      apiUrl: 'https://hub.fxlbusiness.test',
      environment: 'staging' as const,
      clientId: HUB_CLIENT_ID,
      clientSecret: HUB_CLIENT_SECRET,
      audience: 'app.fxl-sales',
      redirectUri: 'https://sales-api.fxlbusiness.test/auth/callback',
    },
    sessionStore: {
      kind: 'persistent' as const,
      create: async () => 'id',
      withSession: async () => undefined as never,
      createLoginTransaction: async () => 'tx',
      consumeLoginTransaction: async () => null,
    },
  };
}

/**
 * The `field` off the `HubConfigError` a boot input produced. Asserting the
 * field and not only that something threw is what stops a test passing because
 * some UNRELATED rule refused the fixture.
 */
function caughtField(run: () => unknown): string {
  try {
    run();
  } catch (error) {
    return (error as HubConfigError).field;
  }
  throw new Error('expected the boot assertion to throw');
}

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
/** See the same capture in `app-auth-bff-wiring.test.ts` for why this is read. */
let bffConfig: HubConfig | undefined;

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
  vi.stubEnv('FXL_HUB_TRUSTED_ORIGINS', 'https://sales.fxlbusiness.test');
  vi.stubEnv('SALES_POST_LOGIN_REDIRECT', 'https://sales.fxlbusiness.test');
  vi.stubEnv('SALES_POST_LOGIN_ERROR_REDIRECT', 'https://sales.fxlbusiness.test/?error=auth');
  vi.stubEnv('SALES_SESSION_ENCRYPTION_IKM', '');

  vi.doMock('@fxl-business/hub-sdk/server', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@fxl-business/hub-sdk/server')>();
    return {
      ...actual,
      createHubBff: (config: Parameters<typeof actual.createHubBff>[0], options: never) => {
        bffOptions = options as CapturedBffOptions;
        bffConfig = config;
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
    // It rides on the CONFIG now, resolved from FXL_HUB_HEALTH_TOKEN by the same
    // loader as everything else, and `createHubBff` reads it there through
    // `assertBootConfiguration`. It is deliberately NOT also passed as an option:
    // that would be a second resolution of one value.
    //
    // Note for anyone mutating this: losing the value entirely does not redden
    // this assertion, it makes the whole file fail to load, because the SDK
    // refuses to construct without it outside development. That is a stronger
    // guarantee than a red assertion and a worse diagnostic, so the refusal
    // itself is pinned separately below. What this assertion catches is the
    // wrong VALUE reaching the SDK, which nothing else would.
    expect(bffConfig?.healthToken).toBe(HEALTH_TOKEN);
    expect('healthToken' in (bffOptions ?? {})).toBe(false);
  });

  it('refuses a missing health token outside development', () => {
    /*
      The guarantee behind the assertion above, stated directly against the SDK
      rather than inferred from this file failing to load.

      A misconfiguration here must be LOUD and IMMEDIATE. The alternative shape,
      a process that starts and answers 503 to every request, is what this
      repo's auth-provider header forbids.

      This is the replacement for the health-token check `auth-provider.ts` used
      to carry. It was written and watched PASS against the SDK before that
      local check was deleted, so the deletion removed a duplicate rather than a
      boot failure.

      The two inputs differ in the health token and in NOTHING else, so the throw
      cannot be blamed on some other missing member. Without that pairing a bare
      `toThrow()` would pass for the wrong reason and prove nothing.

      `redirectUri` is a MEMBER of that pairing and not decoration.
      `@fxl-business/hub-sdk@2.3.0` grew two redirect checks that 2.2.0 did not
      have, and `parseHubConfig` defaults an absent `redirectUri` to
      `${apiUrl}/auth/callback` - which is the Hub's own origin, and which check
      7 refuses outside development. Omitting it therefore makes BOTH inputs
      throw, so the `not.toThrow()` half stops testing the health token and
      starts testing the redirect. Naming it explicitly, on the BROWSER-facing
      origin, restores the health token as the single variable.
    */
    expect(() => assertBootConfiguration({ ...bootBase() })).toThrow(HubConfigError);
    expect(caughtField(() => assertBootConfiguration({ ...bootBase() }))).toBe('healthToken');
    expect(() =>
      assertBootConfiguration({ ...bootBase(), healthToken: HEALTH_TOKEN }),
    ).not.toThrow();
  });

  it("refuses a redirect uri on the Hub's own origin outside development", () => {
    /*
      Check 7, and the protection this repo did NOT have before 2.3.0.

      `resolveHubRedirectUri` is deleted, and this is what replaces it. The old
      resolver refused only an ABSENT value, only when `NODE_ENV === 'production'`
      - so a staging deploy running with NODE_ENV=production was judged by the
      wrong key - and nothing anywhere refused a callback pointed at the Hub
      itself. A callback on the Hub's origin never returns to this Application
      and the Hub rejects it as an unregistered redirect_uri, so it is a
      guaranteed outage that used to boot cleanly.

      Both inputs carry the health token, so the ONE variable is the redirect,
      and the accepted half proves the refusal is about the ORIGIN rather than
      about the redirect being present at all.
    */
    const onTheHub = {
      ...bootBase(),
      healthToken: HEALTH_TOKEN,
      config: { ...bootBase().config, redirectUri: 'https://hub.fxlbusiness.test/auth/callback' },
    };

    expect(caughtField(() => assertBootConfiguration(onTheHub))).toBe('redirectUri');
    expect(() =>
      assertBootConfiguration({ ...bootBase(), healthToken: HEALTH_TOKEN }),
    ).not.toThrow();
  });

  it('vouches for the web origin, which is a different host from the API in this topology', () => {
    // Dropping this reproduces the 2026-08-10 outage: the browser POSTs from
    // sales.* to sales-api.*, and the SDK's own-origin computation alone does
    // not admit it.
    //
    // The exact array assertion is unchanged; what changed is its PROVENANCE.
    // It used to be `trustedOrigins: [env.CORS_ORIGIN]`, a second resolver
    // beside the config; it is now FXL_HUB_TRUSTED_ORIGINS on the config, read
    // by the same loader. So it is asserted off the config, and the option must
    // be absent.
    expect(bffConfig?.trustedOrigins).toEqual(['https://sales.fxlbusiness.test']);
    expect('trustedOrigins' in (bffOptions ?? {})).toBe(false);
  });

  it('carries the browser-facing redirect on the config, never the Hub default', () => {
    // `parseHubConfig` defaults an absent redirectUri to the Hub's own origin,
    // and check 7 refuses exactly that outside development - so getting this
    // wrong is a boot failure here rather than a silent outage. The second
    // assertion is what goes red if the default ever creeps back in.
    expect(bffConfig?.redirectUri).toBe('https://sales-api.fxlbusiness.test/auth/callback');
    expect(String(bffConfig?.redirectUri)).not.toContain('hub.fxlbusiness.test');
    expect('redirectUri' in (bffOptions ?? {})).toBe(false);
  });

  it('passes no fetchImpl, so the SDK rotation parser is the one that runs', () => {
    // 2.2.0 matches `__Host-fxl_hub_session` natively. This is the environment
    // where the Hub actually sends that name, so it is the one that matters.
    expect(bffOptions?.fetchImpl).toBeUndefined();
  });
});
