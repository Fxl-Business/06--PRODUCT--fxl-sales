/**
 * The Hub configuration doors: the strict loader that REFUSES, and the one
 * deliberately narrow optional door that answers null for a machine that has
 * simply not been given credentials yet.
 *
 * A bad Hub configuration is a BOOT FAILURE and not a 503. There is no blanket
 * try/catch in `auth-provider.ts`, and the tests below are what go red if one
 * comes back.
 *
 * The strict door is now `loadHubConfig` and nothing else. The presence verdicts,
 * the discrete-variable renamer and the health-token requirement this file used
 * to pin are DELETED, because 2.3.0 owns all three - the last of them inside
 * `assertBootConfiguration`, which `createHubBff` calls itself and which
 * `app-auth-bff-production-boot.test.ts` pins directly against the SDK.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  hubEnvBag,
  loadHubAuthConfig,
  tryLoadHubAuthConfig,
  type HubEnvSource,
} from '../auth-provider.js';
import { HubConfigError } from '@fxl-business/hub-sdk';

/** Obviously synthetic fixtures. They carry no entropy and name no real client. */
const HUB_CLIENT_ID = 'pk_fxl-sales_development_unit-test-only-0123456789';
const HUB_CLIENT_SECRET = 'sk_fxl-sales_development_unit-test-only-not-a-real-secret-0123456789';
const HUB_AUDIENCE = 'app.fxl-sales';

const STAGING_CLIENT_SECRET = 'sk_fxl-sales_staging_unit-test-only-not-a-real-secret-0123456789';

type Bag = Record<string, string | undefined>;

function discreteBag(overrides: Bag = {}): Bag {
  return {
    FXL_HUB_API_URL: 'http://localhost:9016',
    FXL_HUB_ENVIRONMENT: 'development',
    FXL_HUB_CLIENT_ID: HUB_CLIENT_ID,
    FXL_HUB_CLIENT_SECRET: HUB_CLIENT_SECRET,
    FXL_HUB_AUDIENCE: HUB_AUDIENCE,
    ...overrides,
  };
}

const JSON_BAG: Bag = {
  FXL_HUB_CONFIG: JSON.stringify({
    apiUrl: 'http://localhost:9016',
    environment: 'development',
    clientId: HUB_CLIENT_ID,
    clientSecret: HUB_CLIENT_SECRET,
    audience: HUB_AUDIENCE,
  }),
};

function caught(run: () => unknown): HubConfigError {
  try {
    run();
  } catch (error) {
    return error as HubConfigError;
  }
  throw new Error('expected the loader to throw');
}

describe('loadHubAuthConfig', () => {
  it('loads the Hub contract for app.fxl-sales from FXL_HUB_CONFIG', () => {
    const config = loadHubAuthConfig(JSON_BAG);
    expect(config).toMatchObject({
      audience: 'app.fxl-sales',
      environment: 'development',
    });
    /*
      `toMatchObject` ignores extra keys, so without this line the deletion of the
      derived core module would not actually be pinned. Baseline access is the
      `entitlements.access` boolean now, and no module string feeds it.
    */
    expect(config).not.toHaveProperty('coreModule');
  });

  it('loads the same contract from the five discrete variables', () => {
    const config = loadHubAuthConfig(discreteBag());
    expect(config).toMatchObject({
      audience: 'app.fxl-sales',
      environment: 'development',
    });
    expect(config).not.toHaveProperty('coreModule');
  });

  it('refuses an incomplete Hub configuration from the strict loader and names the offending field', () => {
    const bag: Bag = {
      FXL_HUB_API_URL: 'http://localhost:9016',
      FXL_HUB_ENVIRONMENT: 'development',
      FXL_HUB_CLIENT_ID: HUB_CLIENT_ID,
      FXL_HUB_AUDIENCE: HUB_AUDIENCE,
    };

    const error = caught(() => loadHubAuthConfig(bag));
    expect(error).toBeInstanceOf(HubConfigError);
    expect(error.field).toBe('clientSecret');
    expect(error.message).not.toContain(HUB_CLIENT_SECRET);
  });

  it('carries the four operational values through onto the config, not beside it', () => {
    /*
      The whole shape of this slice, in one assertion. `healthToken`,
      `redirectUri` and `trustedOrigins` are CONFIG resolved by the same loader
      from their own canonical variables, and `createHubBff` reads them off the
      config through `assertBootConfiguration`. They are deliberately NOT passed
      as options any more: a second resolution is a second thing to keep in step,
      and the value the two would silently disagree about is `redirectUri`.

      `trustedOrigins` is normalized to `.origin` by the SDK, which is why the
      trailing path is gone from the entry below.
    */
    const config = loadHubAuthConfig(
      discreteBag({
        FXL_HUB_HEALTH_TOKEN: 'operator-generated-health-token',
        FXL_HUB_REDIRECT_URI: 'http://localhost:8006/auth/callback',
        FXL_HUB_TRUSTED_ORIGINS: 'http://localhost:8006',
      }),
    );

    expect(config.healthToken).toBe('operator-generated-health-token');
    expect(config.redirectUri).toBe('http://localhost:8006/auth/callback');
    expect(config.trustedOrigins).toEqual(['http://localhost:8006']);
  });

  it('leaves the health token undefined in development, where nothing requires it', () => {
    // The REQUIREMENT outside development is the SDK's, inside
    // `assertBootConfiguration`, and is pinned in
    // app-auth-bff-production-boot.test.ts. What is pinned here is only that an
    // unset variable stays unset rather than becoming an empty string.
    expect(loadHubAuthConfig(discreteBag()).healthToken).toBeUndefined();
  });
});

describe('tryLoadHubAuthConfig', () => {
  it('returns null from the optional loader when no Hub configuration is present at all', () => {
    expect(tryLoadHubAuthConfig({})).toBeNull();
  });

  it('throws rather than answering null when the discrete form is only partly set', () => {
    /*
      The v3.1.0 behaviour change, at unit level. This used to answer null and
      therefore 503. Three of five is a MISCONFIGURATION, not an unconfigured
      machine, and 503 on every request never tells the operator which variable
      is missing.

      `hubConfigIsAbsent` is what keeps the two cases apart, and it is keyed on
      the six credential-bearing names alone. The boot-level half of this pin -
      that the process refuses to start rather than starting and answering 503 -
      is `app-auth-partial-config.test.ts`.
    */
    const error = caught(() => tryLoadHubAuthConfig({ FXL_HUB_API_URL: 'http://localhost:9016' }));
    expect(error).toBeInstanceOf(HubConfigError);
    expect(error.field).toBe('environment');
  });

  it('still answers null when only an operational variable is set, with no credential at all', () => {
    /*
      `FXL_HUB_REDIRECT_URI` and its three operational siblings identify no
      Client, so a machine carrying one of them has still been given no
      credentials. Counting one as configuration would turn a stray variable in a
      shell profile into a boot failure on a fresh clone.
    */
    expect(
      tryLoadHubAuthConfig({
        FXL_HUB_REDIRECT_URI: 'http://localhost:8006/auth/callback',
        FXL_HUB_HEALTH_TOKEN: 'operator-generated-health-token',
      }),
    ).toBeNull();
  });

  it('refuses to boot when FXL_HUB_CONFIG is set beside a discrete variable and names every offender', () => {
    const error = caught(() =>
      tryLoadHubAuthConfig({
        ...JSON_BAG,
        FXL_HUB_CLIENT_ID: HUB_CLIENT_ID,
        FXL_HUB_AUDIENCE: HUB_AUDIENCE,
      }),
    );

    expect(error).toBeInstanceOf(HubConfigError);
    expect(error.field).toBe('FXL_HUB_CONFIG');
    expect(error.message).toContain('FXL_HUB_CLIENT_ID');
    expect(error.message).toContain('FXL_HUB_AUDIENCE');
    expect(error.message).not.toContain('FXL_HUB_API_URL');
  });

  it('refuses to boot on a product. audience rather than answering 503', () => {
    const bag = discreteBag({ FXL_HUB_AUDIENCE: 'product.fxl-sales' });
    expect(() => tryLoadHubAuthConfig(bag)).toThrow();
    expect(caught(() => tryLoadHubAuthConfig(bag)).field).toBe('audience');
  });

  it('never leaks the client secret out of the optional loader', () => {
    const bags: Bag[] = [
      { ...JSON_BAG, FXL_HUB_CLIENT_ID: HUB_CLIENT_ID },
      discreteBag({ FXL_HUB_CLIENT_SECRET: STAGING_CLIENT_SECRET }),
    ];

    for (const bag of bags) {
      const error = caught(() => tryLoadHubAuthConfig(bag));
      expect(String(error)).not.toContain(HUB_CLIENT_SECRET);
      expect(error.message).not.toContain(HUB_CLIENT_SECRET);
      expect(String(error.stack)).not.toContain(HUB_CLIENT_SECRET);
      expect(String(error)).not.toContain(STAGING_CLIENT_SECRET);
      expect(error.message).not.toContain(STAGING_CLIENT_SECRET);
    }
  });
});

describe('hubEnvBag', () => {
  it('projects exactly the auth variables off the validated env object', () => {
    const source = {
      NODE_ENV: 'development',
      CORS_ORIGIN: 'http://localhost:8006',
      FXL_HUB_CONFIG: undefined,
      FXL_HUB_API_URL: 'http://localhost:9016',
      FXL_HUB_ENVIRONMENT: 'development',
      FXL_HUB_CLIENT_ID: HUB_CLIENT_ID,
      FXL_HUB_CLIENT_SECRET: HUB_CLIENT_SECRET,
      FXL_HUB_AUDIENCE: HUB_AUDIENCE,
      FXL_HUB_HEALTH_TOKEN: undefined,
      FXL_HUB_REDIRECT_URI: undefined,
      FXL_HUB_TRUSTED_ORIGINS: undefined,
      SALES_POST_LOGIN_REDIRECT: undefined,
      SALES_POST_LOGIN_ERROR_REDIRECT: undefined,
    } as HubEnvSource;

    const bag = hubEnvBag(source);

    expect(Object.keys(bag).sort()).toEqual(
      [
        'CORS_ORIGIN',
        'FXL_HUB_API_URL',
        'FXL_HUB_AUDIENCE',
        'FXL_HUB_CLIENT_ID',
        'FXL_HUB_CLIENT_SECRET',
        'FXL_HUB_CONFIG',
        'FXL_HUB_ENVIRONMENT',
        'FXL_HUB_HEALTH_TOKEN',
        'SALES_POST_LOGIN_ERROR_REDIRECT',
        'SALES_POST_LOGIN_REDIRECT',
        'FXL_HUB_REDIRECT_URI',
        'FXL_HUB_TRUSTED_ORIGINS',
        'NODE_ENV',
      ].sort(),
    );
    expect(bag.FXL_HUB_CONFIG).toBeUndefined();
    expect(bag.FXL_HUB_HEALTH_TOKEN).toBeUndefined();
    expect(bag.FXL_HUB_API_URL).toBe('http://localhost:9016');
  });
});

describe('the derived-audience guard', () => {
  it('no API module derives the Hub audience from a key', () => {
    const sources = [
      readFileSync(new URL('../auth-provider.ts', import.meta.url), 'utf8'),
      readFileSync(new URL('../../middleware/app-auth.ts', import.meta.url), 'utf8'),
    ];

    for (const source of sources) {
      expect(source).not.toContain('parseAudienceFromPublishableKey');
      expect(source).not.toContain('product.');
    }
  });
});
