import { describe, expect, it } from 'vitest';
import { loadHubAuthConfig, tryLoadHubAuthConfig } from '../auth-provider.js';

const registeredEnv = {
  FXL_HUB_API_URL: 'http://localhost:9016',
  FXL_HUB_PUBLISHABLE_KEY: 'pk_fxl-sales_VzQ9-LUONCnlKllxCRLffN3nw6Z9PQl2',
  FXL_HUB_SECRET_KEY: 'sk_test_not-production',
};

describe('loadHubAuthConfig', () => {
  it('delegates registered FXL Sales config and audience derivation to the SDK', () => {
    const config = loadHubAuthConfig(registeredEnv);

    expect(config.sdk).toEqual({
      apiUrl: 'http://localhost:9016',
      publishableKey: 'pk_fxl-sales_VzQ9-LUONCnlKllxCRLffN3nw6Z9PQl2',
      secretKey: 'sk_test_not-production',
    });
    expect(config.audience).toBe('product.fxl-sales');
    expect(config.coreModule).toBe('sales.core');
  });

  it('handles underscores in the publishable-key random segment through the SDK parser', () => {
    const config = loadHubAuthConfig({
      ...registeredEnv,
      FXL_HUB_PUBLISHABLE_KEY: 'pk_fxl-sales_random_segment_with_underscores',
    });

    expect(config.audience).toBe('product.fxl-sales');
  });

  it('rejects a configured audience outside product.fxl-sales', () => {
    expect(() =>
      loadHubAuthConfig({ ...registeredEnv, FXL_HUB_AUDIENCE: 'product.other' }),
    ).toThrow(/product\.fxl-sales/);
  });

  it('rejects missing secret keys', () => {
    expect(() =>
      loadHubAuthConfig({
        FXL_HUB_API_URL: 'http://localhost:9016',
        FXL_HUB_PUBLISHABLE_KEY: 'pk_fxl-sales_VzQ9-LUONCnlKllxCRLffN3nw6Z9PQl2',
      }),
    ).toThrow(/FXL_HUB_SECRET_KEY/);
  });

  it('returns null from the optional loader when Hub env is incomplete', () => {
    expect(tryLoadHubAuthConfig({})).toBeNull();
  });
});
