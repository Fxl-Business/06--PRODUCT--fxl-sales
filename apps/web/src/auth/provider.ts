import { deriveAudience, type HubSdkConfig } from '@fxl-business/hub-sdk';

const HUB_PRODUCT_AUDIENCE = 'product.fxl-sales';

export type BrowserHubConfig = Pick<HubSdkConfig, 'apiUrl' | 'publishableKey' | 'audience'>;

type EnvLike = Record<string, string | undefined>;

export function loadHubBrowserConfig(env: EnvLike): BrowserHubConfig {
  const apiUrl = env.VITE_FXL_HUB_API_URL;
  const publishableKey = env.VITE_FXL_HUB_PUBLISHABLE_KEY;
  if (!apiUrl || !publishableKey) {
    throw new Error('VITE_FXL_HUB_API_URL and VITE_FXL_HUB_PUBLISHABLE_KEY are required');
  }

  const config: BrowserHubConfig = {
    apiUrl,
    publishableKey,
    audience: env.VITE_FXL_HUB_AUDIENCE || undefined,
  };
  if (deriveAudience(config) !== HUB_PRODUCT_AUDIENCE) {
    throw new Error(`FXL Hub audience must be ${HUB_PRODUCT_AUDIENCE}`);
  }

  return config;
}

export function getHubBffBasePath(env: EnvLike): string {
  return (env.VITE_AUTH_BFF_BASE_PATH ?? env.VITE_API_URL ?? '').replace(/\/+$/, '');
}
