export type WebAuthProvider = 'clerk' | 'hub';

export type BrowserHubConfig = {
  apiUrl: string;
  publishableKey: string;
  audience?: string;
};

type EnvLike = Record<string, string | undefined>;

export function loadWebAuthProvider(env: EnvLike): WebAuthProvider {
  const provider = (env.VITE_AUTH_PROVIDER ?? 'clerk').toLowerCase();

  if (provider === 'clerk' || provider === 'hub') {
    return provider;
  }

  throw new Error('VITE_AUTH_PROVIDER must be either clerk or hub');
}

export function loadHubBrowserConfig(env: EnvLike): BrowserHubConfig {
  const apiUrl = env.VITE_FXL_HUB_API_URL;
  const publishableKey = env.VITE_FXL_HUB_PUBLISHABLE_KEY;
  if (!apiUrl || !publishableKey) {
    throw new Error('VITE_FXL_HUB_API_URL and VITE_FXL_HUB_PUBLISHABLE_KEY are required');
  }
  return {
    apiUrl,
    publishableKey,
    audience: env.VITE_FXL_HUB_AUDIENCE || undefined,
  };
}

export function getHubBffBasePath(env: EnvLike): string {
  return (env.VITE_API_URL ?? '').replace(/\/+$/, '');
}
