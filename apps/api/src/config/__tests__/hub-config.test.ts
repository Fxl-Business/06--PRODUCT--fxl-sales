/**
 * Pins the explicit Hub configuration contract.
 *
 * The Audience is CONFIGURATION and is never a function of a key, and the Hub
 * environment is explicit and is never inferred from the process environment.
 * Both verdicts are reached OFFLINE, by string comparison against the segments
 * inside the client id.
 */
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { HubConfigError, loadHubConfig, parseClientId } from '../hub-config.js';

/**
 * Obviously synthetic fixtures. They carry no entropy and name no real client.
 * The secret is long enough to clear the session sealer's 32 character floor on
 * its own, which is what the middleware wiring tests need from it.
 */
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

function jsonBag(overrides: Record<string, unknown> = {}): Bag {
  return {
    FXL_HUB_CONFIG: JSON.stringify({
      apiUrl: 'http://localhost:9016',
      environment: 'development',
      clientId: HUB_CLIENT_ID,
      clientSecret: HUB_CLIENT_SECRET,
      audience: HUB_AUDIENCE,
      ...overrides,
    }),
  };
}

function caught(bag: Bag): HubConfigError {
  try {
    loadHubConfig(bag);
  } catch (error) {
    return error as HubConfigError;
  }
  throw new Error('expected loadHubConfig to throw');
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('loadHubConfig', () => {
  it("accepts a single FXL_HUB_CONFIG JSON object as this repo's documented form", () => {
    expect(loadHubConfig(jsonBag())).toEqual({
      apiUrl: 'http://localhost:9016',
      environment: 'development',
      clientId: HUB_CLIENT_ID,
      clientSecret: HUB_CLIENT_SECRET,
      audience: HUB_AUDIENCE,
    });
  });

  it('accepts the five discrete variables when FXL_HUB_CONFIG is absent', () => {
    expect(loadHubConfig(discreteBag())).toEqual({
      apiUrl: 'http://localhost:9016',
      environment: 'development',
      clientId: HUB_CLIENT_ID,
      clientSecret: HUB_CLIENT_SECRET,
      audience: HUB_AUDIENCE,
    });
  });

  it('trims trailing slashes off apiUrl', () => {
    expect(loadHubConfig(discreteBag({ FXL_HUB_API_URL: 'http://localhost:9016///' })).apiUrl).toBe(
      'http://localhost:9016',
    );
  });

  it('refuses a plain http apiUrl outside development', () => {
    const error = caught(
      discreteBag({
        FXL_HUB_API_URL: 'http://hub.example.com',
        FXL_HUB_ENVIRONMENT: 'staging',
        FXL_HUB_CLIENT_ID: STAGING_CLIENT_ID,
        FXL_HUB_CLIENT_SECRET: STAGING_CLIENT_SECRET,
      }),
    );
    expect(error).toBeInstanceOf(HubConfigError);
    expect(error.field).toBe('apiUrl');
  });

  it('refuses a product. audience at boot and names the audience field', () => {
    const error = caught(discreteBag({ FXL_HUB_AUDIENCE: 'product.fxl-sales' }));
    expect(error.field).toBe('audience');
    expect(error.message).toMatch(/app\.<slug>/);
    expect(error.message).toMatch(/never derived/);
  });

  it('refuses an audience that is not app. plus the client id slug', () => {
    const error = caught(discreteBag({ FXL_HUB_AUDIENCE: 'app.fxl-finance' }));
    expect(error.field).toBe('audience');
  });

  it('refuses an environment that disagrees with the client id segment, and reaches no network', () => {
    const fetchSpy = vi.fn(() => {
      throw new Error('the Hub config validator must never reach the network');
    });
    vi.stubGlobal('fetch', fetchSpy);

    const error = caught(
      discreteBag({
        FXL_HUB_API_URL: 'https://hub.example.com',
        FXL_HUB_ENVIRONMENT: 'production',
      }),
    );

    expect(error.field).toBe('environment');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('never consults NODE_ENV to decide the environment', () => {
    const bag = discreteBag({ NODE_ENV: 'production' });
    expect(loadHubConfig(bag).environment).toBe('development');

    const withoutEnvironment = { ...bag, FXL_HUB_ENVIRONMENT: undefined };
    expect(caught(withoutEnvironment).field).toBe('environment');
  });

  it('refuses a client secret whose slug or environment disagrees with the client id', () => {
    expect(caught(discreteBag({ FXL_HUB_CLIENT_SECRET: STAGING_CLIENT_SECRET })).field).toBe(
      'clientSecret',
    );
  });

  it('refuses FXL_HUB_CONFIG that is not valid JSON', () => {
    expect(caught({ FXL_HUB_CONFIG: `{"clientSecret":"${HUB_CLIENT_SECRET}"` }).field).toBe(
      'FXL_HUB_CONFIG',
    );
  });

  it('never puts the client secret in an error message or a log line', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const invalidBags: Bag[] = [
      discreteBag({
        FXL_HUB_API_URL: 'http://hub.example.com',
        FXL_HUB_ENVIRONMENT: 'staging',
        FXL_HUB_CLIENT_ID: STAGING_CLIENT_ID,
        FXL_HUB_CLIENT_SECRET: STAGING_CLIENT_SECRET,
      }),
      discreteBag({ FXL_HUB_AUDIENCE: 'product.fxl-sales' }),
      discreteBag({ FXL_HUB_AUDIENCE: 'app.fxl-finance' }),
      discreteBag({ FXL_HUB_API_URL: 'https://hub.example.com', FXL_HUB_ENVIRONMENT: 'production' }),
      discreteBag({ FXL_HUB_CLIENT_SECRET: STAGING_CLIENT_SECRET }),
      { FXL_HUB_CONFIG: `{"clientSecret":"${HUB_CLIENT_SECRET}"` },
    ];

    for (const bag of invalidBags) {
      const error = caught(bag);
      expect(String(error)).not.toContain(HUB_CLIENT_SECRET);
      expect(error.message).not.toContain(HUB_CLIENT_SECRET);
      expect(String(error.stack)).not.toContain(HUB_CLIENT_SECRET);
      expect(String(error)).not.toContain(STAGING_CLIENT_SECRET);
      expect(error.message).not.toContain(STAGING_CLIENT_SECRET);
    }

    for (const spy of [errorSpy, warnSpy]) {
      for (const call of spy.mock.calls) {
        expect(call.map((arg) => String(arg)).join(' ')).not.toContain(HUB_CLIENT_SECRET);
      }
    }

    // The parser logs nothing at all. It throws.
    expect(errorSpy).not.toHaveBeenCalled();
    expect(warnSpy).not.toHaveBeenCalled();

    errorSpy.mockRestore();
    warnSpy.mockRestore();
  });
});

describe('parseClientId', () => {
  it('parses pk_<slug>_<environment>_<random> and keeps underscores inside the random segment', () => {
    expect(parseClientId('pk_fxl-sales_staging_aa_bb-cc')).toEqual({
      slug: 'fxl-sales',
      environment: 'staging',
    });
  });

  it('returns null for a key with no environment segment', () => {
    // The retired committed literal. This is why it had to leave the example files.
    expect(parseClientId('pk_fxl-sales_VzQ9-LUONCnlKllxCRLffN3nw6Z9PQl2')).toBeNull();
  });
});

describe('the NODE_ENV guard', () => {
  it('does not read NODE_ENV anywhere in the Hub config module', () => {
    const source = readFileSync(new URL('../hub-config.ts', import.meta.url), 'utf8');
    expect(source).not.toMatch(/NODE_ENV/);
  });
});
