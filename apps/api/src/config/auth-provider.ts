export type HubAuthConfig = {
  apiUrl: string;
  publishableKey: string;
  secretKey: string;
  audience: string;
  coreModule: string;
};

type EnvLike = Record<string, string | undefined>;

function parseAudienceFromPublishableKey(publishableKey: string): string {
  const match = publishableKey.match(/^pk_([^_]+)_/);
  if (!match?.[1]) {
    throw new Error('FXL_HUB_PUBLISHABLE_KEY must be a Hub publishable key');
  }
  return `product.${match[1]}`;
}

function coreModuleFromAudience(audience: string): string {
  const slug = audience.replace(/^product\./, '');
  return `${slug.replace(/^fxl-/, '')}.core`;
}

function required(env: EnvLike, key: string): string {
  const value = env[key];
  if (!value) {
    throw new Error(`${key} is required for FXL Hub auth`);
  }
  return value;
}

export function loadHubAuthConfig(env: EnvLike): HubAuthConfig {
  const apiUrl = required(env, 'FXL_HUB_API_URL');
  const publishableKey = required(env, 'FXL_HUB_PUBLISHABLE_KEY');
  const secretKey = required(env, 'FXL_HUB_SECRET_KEY');
  const audience = env.FXL_HUB_AUDIENCE ?? parseAudienceFromPublishableKey(publishableKey);

  return {
    apiUrl,
    publishableKey,
    secretKey,
    audience,
    coreModule: coreModuleFromAudience(audience),
  };
}

export function tryLoadHubAuthConfig(env: EnvLike): HubAuthConfig | null {
  try {
    return loadHubAuthConfig(env);
  } catch {
    return null;
  }
}
