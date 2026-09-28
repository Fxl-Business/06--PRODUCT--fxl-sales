import { describe, expect, it } from 'vitest';
import type { HubEnvSource } from '../../../config/auth-provider.js';
import {
  buildIntegrationConfig,
  integrationConfigFromHubConfig,
  toAuthorityConfig,
} from '../config.js';

const baseEnv = {
  NODE_ENV: 'test',
  CORS_ORIGIN: 'http://localhost:8006',
} as unknown as HubEnvSource;

describe('integration config', () => {
  it('maps a resolved hub config', () => {
    const cfg = integrationConfigFromHubConfig({
      apiUrl: 'http://hub.test',
      environment: 'development',
      clientId: 'pk_fxl-sales_development_abc',
      clientSecret: 'sk_fxl-sales_development_abc',
      audience: 'app.fxl-sales',
    } as never);
    expect(cfg).toEqual({
      hubApiUrl: 'http://hub.test',
      applicationId: 'app.fxl-sales',
      clientId: 'pk_fxl-sales_development_abc',
      clientSecret: 'sk_fxl-sales_development_abc',
      environment: 'development',
    });
  });

  it('is null when no hub credential is set', () => {
    expect(buildIntegrationConfig(baseEnv)).toBeNull();
  });

  it('throws on a partial configuration', () => {
    expect(() =>
      buildIntegrationConfig({ ...baseEnv, FXL_HUB_API_URL: 'http://hub.test' } as HubEnvSource),
    ).toThrow();
  });

  it('builds from a full discrete configuration', () => {
    const cfg = buildIntegrationConfig({
      ...baseEnv,
      FXL_HUB_API_URL: 'http://localhost:9016',
      FXL_HUB_ENVIRONMENT: 'development',
      FXL_HUB_CLIENT_ID: 'pk_fxl-sales_development_abc123',
      FXL_HUB_CLIENT_SECRET: 'sk_fxl-sales_development_abc123',
      FXL_HUB_AUDIENCE: 'app.fxl-sales',
    } as HubEnvSource);
    expect(cfg?.applicationId).toBe('app.fxl-sales');
    expect(cfg?.hubApiUrl).toBe('http://localhost:9016');
  });

  it('toAuthorityConfig passes only supplied seams', () => {
    const base = {
      hubApiUrl: 'http://h',
      applicationId: 'app.fxl-sales',
      clientId: 'c',
      clientSecret: 's',
      environment: 'staging' as const,
    };
    expect(toAuthorityConfig(base)).toEqual(base);
    expect(toAuthorityConfig(base, { timeoutMs: 5 })).toEqual({ ...base, timeoutMs: 5 });
  });
});
