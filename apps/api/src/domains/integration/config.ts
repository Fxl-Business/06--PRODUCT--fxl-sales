/**
 * Integration config: projects the EXISTING Hub config onto the shape the
 * `@fxl-business/fxl-contracts` authority clients need. No new FXL_HUB_* name.
 * Pure: no I/O, no clock, no process.env, and no value import of `env.ts`.
 */
import type { IntegrationAuthorityConfig, IntegrationEnvironment } from '@fxl-business/fxl-contracts';
import {
  hubEnvBag,
  tryLoadHubAuthConfig,
  type HubAuthConfig,
  type HubEnvSource,
} from '../../config/auth-provider.js';

export interface IntegrationConfig {
  readonly hubApiUrl: string;
  readonly applicationId: string;
  readonly clientId: string;
  readonly clientSecret: string;
  readonly environment: IntegrationEnvironment;
}

/** Optional injectable seams (tests, timeouts). */
export interface IntegrationClientSeams {
  fetchImpl?: typeof fetch;
  now?: () => number;
  timeoutMs?: number;
  cacheMaxEntries?: number;
}

/** PURE mapping of a resolved Hub config. */
export function integrationConfigFromHubConfig(hub: HubAuthConfig): IntegrationConfig {
  return {
    hubApiUrl: hub.apiUrl,
    applicationId: hub.audience,
    clientId: hub.clientId,
    clientSecret: hub.clientSecret,
    environment: hub.environment,
  };
}

/**
 * Null when the machine has no Hub credentials at all. A partial or invalid
 * configuration THROWS (the SDK's own message), never reads as unconfigured.
 */
export function buildIntegrationConfig(env: HubEnvSource): IntegrationConfig | null {
  const hub = tryLoadHubAuthConfig(hubEnvBag(env));
  return hub === null ? null : integrationConfigFromHubConfig(hub);
}

export function toAuthorityConfig(
  config: IntegrationConfig,
  seams: IntegrationClientSeams = {},
): IntegrationAuthorityConfig {
  return {
    hubApiUrl: config.hubApiUrl,
    applicationId: config.applicationId,
    clientId: config.clientId,
    clientSecret: config.clientSecret,
    environment: config.environment,
    ...(seams.fetchImpl ? { fetchImpl: seams.fetchImpl } : {}),
    ...(seams.now ? { now: seams.now } : {}),
    ...(seams.timeoutMs !== undefined ? { timeoutMs: seams.timeoutMs } : {}),
    ...(seams.cacheMaxEntries !== undefined ? { cacheMaxEntries: seams.cacheMaxEntries } : {}),
  };
}
