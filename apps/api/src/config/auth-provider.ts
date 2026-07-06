export type AuthProvider = 'clerk' | 'hub';

export type AuthProviderConfig =
  | {
      provider: 'clerk';
    }
  | {
      provider: 'hub';
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
    throw new Error(`${key} is required when AUTH_PROVIDER=hub`);
  }
  return value;
}

export function loadAuthProviderConfig(env: EnvLike): AuthProviderConfig {
  const provider = (env.AUTH_PROVIDER ?? 'clerk').toLowerCase();

  if (provider === 'clerk') {
    return { provider: 'clerk' };
  }

  if (provider !== 'hub') {
    throw new Error('AUTH_PROVIDER must be either clerk or hub');
  }

  const apiUrl = required(env, 'FXL_HUB_API_URL');
  const publishableKey = required(env, 'FXL_HUB_PUBLISHABLE_KEY');
  const secretKey = required(env, 'FXL_HUB_SECRET_KEY');
  const audience = env.FXL_HUB_AUDIENCE ?? parseAudienceFromPublishableKey(publishableKey);

  return {
    provider: 'hub',
    apiUrl,
    publishableKey,
    secretKey,
    audience,
    coreModule: coreModuleFromAudience(audience),
  };
}
