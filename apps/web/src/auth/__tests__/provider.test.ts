import { describe, expect, it } from 'vitest';
import { getHubBffBasePath, loadHubBrowserConfig } from '../provider';

describe('loadHubBrowserConfig', () => {
  it('loads Hub browser config from Vite env vars', () => {
    expect(
      loadHubBrowserConfig({
        VITE_FXL_HUB_API_URL: 'http://localhost:9016',
        VITE_FXL_HUB_PUBLISHABLE_KEY: 'pk_fxl-sales_test',
      }),
    ).toEqual({
      apiUrl: 'http://localhost:9016',
      publishableKey: 'pk_fxl-sales_test',
      audience: undefined,
    });
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
