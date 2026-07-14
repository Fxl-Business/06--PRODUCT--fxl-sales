export type BrowserHubConfig = {
  apiUrl: string;
  publishableKey: string;
  audience?: string;
};

type EnvLike = Record<string, string | undefined>;

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
  return (env.VITE_AUTH_BFF_BASE_PATH ?? env.VITE_API_URL ?? '').replace(/\/+$/, '');
}
