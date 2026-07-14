import { deriveAudience, loadHubConfigFromEnv, type HubSdkConfig } from '@fxl-business/hub-sdk';

export const HUB_PRODUCT_AUDIENCE = 'product.fxl-sales' as const;
export const HUB_CORE_MODULE = 'sales.core' as const;

export type HubAuthConfig = {
  sdk: HubSdkConfig & { secretKey: string };
  audience: typeof HUB_PRODUCT_AUDIENCE;
  coreModule: typeof HUB_CORE_MODULE;
};

type EnvLike = Record<string, string | undefined>;

export function loadHubAuthConfig(env: EnvLike): HubAuthConfig {
  const sdk = loadHubConfigFromEnv(env);
  if (typeof sdk.secretKey !== 'string' || sdk.secretKey.length === 0) {
    throw new Error('FXL_HUB_SECRET_KEY is required for FXL Hub auth');
  }

  const audience = deriveAudience(sdk);
  if (audience !== HUB_PRODUCT_AUDIENCE) {
    throw new Error(`FXL Hub audience must be ${HUB_PRODUCT_AUDIENCE}`);
  }

  return {
    sdk: sdk as HubSdkConfig & { secretKey: string },
    audience: HUB_PRODUCT_AUDIENCE,
    coreModule: HUB_CORE_MODULE,
  };
}

export function tryLoadHubAuthConfig(env: EnvLike): HubAuthConfig | null {
  try {
    return loadHubAuthConfig(env);
  } catch {
    return null;
  }
}
