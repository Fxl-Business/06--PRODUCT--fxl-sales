import { describe, expect, it } from 'vitest';
import { loadAuthProviderConfig } from '../auth-provider.js';

describe('loadAuthProviderConfig', () => {
  it('defaults to Clerk for the dormant rollback path', () => {
    const config = loadAuthProviderConfig({});

    expect(config.provider).toBe('clerk');
  });

  it('loads the Hub provider contract for product.fxl-sales', () => {
    const config = loadAuthProviderConfig({
      AUTH_PROVIDER: 'hub',
      FXL_HUB_API_URL: 'http://localhost:9016',
      FXL_HUB_PUBLISHABLE_KEY: 'pk_fxl-sales_VzQ9-LUONCnlKllxCRLffN3nw6Z9PQl2',
      FXL_HUB_SECRET_KEY: 'sk_test_MZBm',
    });

    expect(config).toMatchObject({
      provider: 'hub',
      audience: 'product.fxl-sales',
      coreModule: 'sales.core',
    });
  });

  it('rejects hub mode when the secret key was not issued', () => {
    expect(() =>
      loadAuthProviderConfig({
        AUTH_PROVIDER: 'hub',
        FXL_HUB_API_URL: 'http://localhost:9016',
        FXL_HUB_PUBLISHABLE_KEY: 'pk_fxl-sales_VzQ9-LUONCnlKllxCRLffN3nw6Z9PQl2',
      }),
    ).toThrow(/FXL_HUB_SECRET_KEY/);
  });
});
