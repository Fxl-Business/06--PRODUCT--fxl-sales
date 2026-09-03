import { describe, expect, it } from 'vitest';
import { getHubBffBasePath, loadHubBrowserConfig } from '../provider';

describe('loadHubBrowserConfig', () => {
  it('loads Hub browser config from Vite env vars', () => {
    expect(
      loadHubBrowserConfig({
        VITE_FXL_HUB_API_URL: 'http://localhost:9016',
        VITE_FXL_HUB_ENVIRONMENT: 'development',
        VITE_FXL_HUB_AUDIENCE: 'app.fxl-sales',
      }),
    ).toEqual({
      apiUrl: 'http://localhost:9016',
      environment: 'development',
      audience: 'app.fxl-sales',
    });
  });

  it('requires the Hub browser vars', () => {
    expect(() => loadHubBrowserConfig({})).toThrow(/VITE_FXL_HUB_API_URL/);
  });

  it('carries no key or secret, so the browser half cannot hold a credential', () => {
    /*
      The 2.2.0 contract: the Client is named by audience plus environment, and
      `createHubClient` THROWS on an object carrying `clientSecret`. This pins the
      shape so a future edit cannot reintroduce a key into the bundle.
    */
    const config = loadHubBrowserConfig({
      VITE_FXL_HUB_API_URL: 'http://localhost:9016',
      VITE_FXL_HUB_ENVIRONMENT: 'development',
      VITE_FXL_HUB_AUDIENCE: 'app.fxl-sales',
    });
    expect(Object.keys(config).sort()).toEqual(['apiUrl', 'audience', 'environment']);
  });

  it('refuses an environment it was not explicitly given, rather than inferring one', () => {
    // A staging bundle that guessed would ask the Hub for the wrong Client and
    // fail as a 401 at runtime instead of refusing to build.
    expect(() =>
      loadHubBrowserConfig({
        VITE_FXL_HUB_API_URL: 'http://localhost:9016',
        VITE_FXL_HUB_AUDIENCE: 'app.fxl-sales',
      }),
    ).toThrow(/VITE_FXL_HUB_ENVIRONMENT/);
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
