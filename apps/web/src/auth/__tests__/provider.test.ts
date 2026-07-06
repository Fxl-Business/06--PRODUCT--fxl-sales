import { describe, expect, it } from 'vitest';
import { getHubBffBasePath, loadHubBrowserConfig, loadWebAuthProvider } from '../provider';

describe('loadWebAuthProvider', () => {
  it('defaults to Clerk for build-time rollback', () => {
    expect(loadWebAuthProvider({})).toBe('clerk');
  });

  it('accepts Hub as the build-time provider', () => {
    expect(loadWebAuthProvider({ VITE_AUTH_PROVIDER: 'hub' })).toBe('hub');
  });

  it('rejects unknown provider names', () => {
    expect(() => loadWebAuthProvider({ VITE_AUTH_PROVIDER: 'magic' })).toThrow(
      /VITE_AUTH_PROVIDER/,
    );
  });
});

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

  it('requires the Hub browser vars in Hub mode', () => {
    expect(() => loadHubBrowserConfig({})).toThrow(/VITE_FXL_HUB_API_URL/);
  });
});

describe('getHubBffBasePath', () => {
  it('uses the API origin for the Hub BFF when the frontend is on another origin', () => {
    expect(getHubBffBasePath({ VITE_API_URL: 'http://localhost:3006/' })).toBe(
      'http://localhost:3006',
    );
  });

  it('falls back to same-origin auth routes when no API origin is configured', () => {
    expect(getHubBffBasePath({})).toBe('');
  });
});
