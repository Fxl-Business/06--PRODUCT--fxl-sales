/**
 * The Hub configuration doors: the strict loader that REFUSES, and the one
 * deliberately narrow optional door that answers null for a machine that has
 * simply not been given credentials yet.
 *
 * A bad Hub configuration is a BOOT FAILURE and not a 503. There is no blanket
 * try/catch in `auth-provider.ts`, and the tests below are what go red if one
 * comes back.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  hubEnvBag,
  loadHubAuthConfig,
  tryLoadHubAuthConfig,
  type HubEnvSource,
} from '../auth-provider.js';
import { HubConfigError } from '../hub-config.js';

/** Obviously synthetic fixtures. They carry no entropy and name no real client. */
const HUB_CLIENT_ID = 'pk_fxl-sales_development_unit-test-only-0123456789';
const HUB_CLIENT_SECRET = 'sk_fxl-sales_development_unit-test-only-not-a-real-secret-0123456789';
const HUB_AUDIENCE = 'app.fxl-sales';

const STAGING_CLIENT_ID = 'pk_fxl-sales_staging_unit-test-only-0123456789';
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
    expect(loadHubAuthConfig(JSON_BAG)).toMatchObject({
      audience: 'app.fxl-sales',
      environment: 'development',
      coreModule: 'sales.core',
    });
  });

  it('loads the same contract from the five discrete variables', () => {
    expect(loadHubAuthConfig(discreteBag())).toMatchObject({
      audience: 'app.fxl-sales',
      environment: 'development',
      coreModule: 'sales.core',
    });
  });

  it('refuses an incomplete Hub configuration from the strict loader and names the client secret field', () => {
    const bag: Bag = {
      FXL_HUB_API_URL: 'http://localhost:9016',
      FXL_HUB_ENVIRONMENT: 'development',
      FXL_HUB_CLIENT_ID: HUB_CLIENT_ID,
      FXL_HUB_AUDIENCE: HUB_AUDIENCE,
    };

    const error = caught(() => loadHubAuthConfig(bag));
    expect(error).toBeInstanceOf(HubConfigError);
    expect(error.field).toBe('clientSecret');
    expect(error.message).toContain('FXL_HUB_CLIENT_SECRET');
    expect(error.message).not.toContain(HUB_CLIENT_SECRET);
  });

  it('requires FXL_HUB_HEALTH_TOKEN outside development', () => {
    const staging = discreteBag({
      FXL_HUB_API_URL: 'https://hub.example.com',
      FXL_HUB_ENVIRONMENT: 'staging',
      FXL_HUB_CLIENT_ID: STAGING_CLIENT_ID,
      FXL_HUB_CLIENT_SECRET: STAGING_CLIENT_SECRET,
    });

    expect(caught(() => loadHubAuthConfig(staging)).field).toBe('FXL_HUB_HEALTH_TOKEN');

    const withToken = loadHubAuthConfig({
      ...staging,
      FXL_HUB_HEALTH_TOKEN: 'operator-generated-health-token',
    });
    expect(withToken.healthToken).toBe('operator-generated-health-token');
  });

  it('does not require FXL_HUB_HEALTH_TOKEN in development', () => {
    expect(loadHubAuthConfig(discreteBag()).healthToken).toBeUndefined();
  });
});

describe('tryLoadHubAuthConfig', () => {
  it('returns null from the optional loader when no Hub configuration is present at all', () => {
    expect(tryLoadHubAuthConfig({})).toBeNull();
  });

  it('returns null from the optional loader when the discrete form is incomplete', () => {
    expect(tryLoadHubAuthConfig({ FXL_HUB_API_URL: 'http://localhost:9016' })).toBeNull();
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
  it('projects exactly the Hub variables off the validated env object', () => {
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
      FXL_HUB_POST_LOGIN_REDIRECT: undefined,
      FXL_HUB_POST_LOGIN_ERROR_REDIRECT: undefined,
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
        'FXL_HUB_POST_LOGIN_ERROR_REDIRECT',
        'FXL_HUB_POST_LOGIN_REDIRECT',
        'FXL_HUB_REDIRECT_URI',
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
      readFileSync(new URL('../hub-config.ts', import.meta.url), 'utf8'),
      readFileSync(new URL('../auth-provider.ts', import.meta.url), 'utf8'),
      readFileSync(new URL('../../middleware/app-auth.ts', import.meta.url), 'utf8'),
    ];

    for (const source of sources) {
      expect(source).not.toContain('parseAudienceFromPublishableKey');
      expect(source).not.toContain('product.');
    }
  });
});
