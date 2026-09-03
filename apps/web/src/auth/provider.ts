import type { HubEnvironment, HubPublicConfig } from '@fxl-business/hub-sdk';

/**
 * The browser's Hub configuration is the SDK's own `HubPublicConfig` as of
 * 2.2.0, and this repo no longer declares a shape of its own.
 *
 * Two things changed with the bump and both are deliberate. `publishableKey` is
 * GONE: 2.x identifies the Client by `audience` plus `environment`, and
 * `createHubClient` THROWS if it is handed an object carrying a `clientSecret`,
 * so the browser half can no longer be given a credential even by accident.
 * `environment` is now REQUIRED and explicit rather than inferred, for the same
 * reason it is on the server: a staging bundle that guessed from `NODE_ENV`
 * would ask the Hub for the wrong Client and fail as a 401 at runtime instead of
 * refusing to build.
 *
 * `audience` is likewise required now. It was optional while the SDK could
 * derive it from the publishable key; nothing derives it any more.
 */
export type BrowserHubConfig = HubPublicConfig;

type EnvLike = Record<string, string | undefined>;

const HUB_ENVIRONMENTS: readonly HubEnvironment[] = ['production', 'staging', 'development'];

function parseHubEnvironment(value: string | undefined): HubEnvironment {
  const found = HUB_ENVIRONMENTS.find((candidate) => candidate === value);
  if (found === undefined) {
    throw new Error(
      `VITE_FXL_HUB_ENVIRONMENT must be one of ${HUB_ENVIRONMENTS.join(', ')}; it is explicit configuration and is never inferred`,
    );
  }
  return found;
}

export function loadHubBrowserConfig(env: EnvLike): BrowserHubConfig {
  const apiUrl = env.VITE_FXL_HUB_API_URL;
  const audience = env.VITE_FXL_HUB_AUDIENCE;
  if (!apiUrl || !audience) {
    throw new Error('VITE_FXL_HUB_API_URL and VITE_FXL_HUB_AUDIENCE are required');
  }
  return {
    apiUrl,
    environment: parseHubEnvironment(env.VITE_FXL_HUB_ENVIRONMENT),
    audience,
  };
}

export function getHubBffBasePath(env: EnvLike): string {
  return (env.VITE_AUTH_BFF_BASE_PATH ?? env.VITE_API_URL ?? '').replace(/\/+$/, '');
}
