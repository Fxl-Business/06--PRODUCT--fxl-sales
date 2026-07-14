import { deriveAudience } from '@fxl-business/hub-sdk';
import { describe, expect, it } from 'vitest';
import { getHubBffBasePath, loadHubBrowserConfig } from '../provider';

const registeredBrowserEnv = {
  VITE_FXL_HUB_API_URL: 'http://localhost:9016',
  VITE_FXL_HUB_PUBLISHABLE_KEY: 'pk_fxl-sales_VzQ9-LUONCnlKllxCRLffN3nw6Z9PQl2',
};

describe('loadHubBrowserConfig', () => {
  it('derives product.fxl-sales through the SDK from the registered browser key', () => {
    const config = loadHubBrowserConfig(registeredBrowserEnv);

    expect(config).toEqual({
      apiUrl: 'http://localhost:9016',
      publishableKey: 'pk_fxl-sales_VzQ9-LUONCnlKllxCRLffN3nw6Z9PQl2',
      audience: undefined,
    });
    expect(deriveAudience(config)).toBe('product.fxl-sales');
  });

  it('rejects a browser audience override outside product.fxl-sales', () => {
    expect(() =>
      loadHubBrowserConfig({
        ...registeredBrowserEnv,
        VITE_FXL_HUB_AUDIENCE: 'product.other',
      }),
    ).toThrow(/product\.fxl-sales/);
  });

  it('requires the Hub browser vars', () => {
    expect(() => loadHubBrowserConfig({})).toThrow(/VITE_FXL_HUB_API_URL/);
  });
});

describe('getHubBffBasePath', () => {
  it('uses the API origin for auth routes when configured', () => {
    expect(getHubBffBasePath({ VITE_API_URL: 'http://localhost:3006/' })).toBe(
      'http://localhost:3006',
    );
  });

  it('uses an explicit Hub BFF base path when configured', () => {
    expect(getHubBffBasePath({ VITE_AUTH_BFF_BASE_PATH: 'http://localhost:3006/' })).toBe(
      'http://localhost:3006',
    );
  });

  it('falls back to same-origin auth routes when no override is configured', () => {
    expect(getHubBffBasePath({})).toBe('');
  });
});
