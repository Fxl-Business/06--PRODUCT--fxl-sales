import { describe, expect, it } from 'vitest';
import { loadHubAuthConfig, tryLoadHubAuthConfig } from '../auth-provider.js';

describe('loadHubAuthConfig', () => {
  it('loads the Hub contract for product.fxl-sales', () => {
    const config = loadHubAuthConfig({
      FXL_HUB_API_URL: 'http://localhost:9016',
      FXL_HUB_PUBLISHABLE_KEY: 'pk_fxl-sales_VzQ9-LUONCnlKllxCRLffN3nw6Z9PQl2',
      FXL_HUB_SECRET_KEY: 'sk_test_MZBm',
    });

    expect(config).toMatchObject({
      audience: 'product.fxl-sales',
      coreModule: 'sales.core',
    });
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
