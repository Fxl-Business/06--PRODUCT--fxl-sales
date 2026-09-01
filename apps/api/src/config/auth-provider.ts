/**
 * The Hub configuration doors.
 *
 * `./hub-config.ts` owns the 2.x PARSER and is a temporary vendored copy.
 * Everything in THIS file is ours permanently and survives the SDK bump: the
 * projection off the validated env, the two-forms presence verdict, and the
 * decision about what may fail soft.
 *
 * THERE IS NO BLANKET try/catch HERE, AND THAT IS THE POINT. A bad Hub
 * configuration is a BOOT FAILURE, not a 503. The previous shape caught every
 * throw and answered null, which turned "this audience names nothing the Hub
 * mints" into a quietly running API that answered 503 to every request and told
 * the operator nothing. `tryLoadHubAuthConfig` returns null ONLY for the
 * `absent` and `incomplete` presences, which is exactly the machine that has not
 * been given credentials yet. That is what keeps `503 hub_auth_not_configured`
 * alive for a fresh clone, and what keeps every unrelated test file able to
 * import `app-auth.ts`. Do not widen it.
 */
import type { Env } from '../env.js';
import { type HubConfig, HubConfigError, loadHubConfig } from './hub-config.js';

export const HUB_DISCRETE_ENV_VARS = [
  'FXL_HUB_API_URL',
  'FXL_HUB_ENVIRONMENT',
  'FXL_HUB_CLIENT_ID',
  'FXL_HUB_CLIENT_SECRET',
  'FXL_HUB_AUDIENCE',
] as const;

export type HubConfigPresence = 'absent' | 'incomplete' | 'json' | 'discrete';

/**
 * Type-only projection of the validated env. `import type` is load-bearing: a
 * value import of `env.ts` would run dotenv and its `process.exit(1)` inside a
 * unit test worker.
 */
export type HubEnvSource = Pick<
  Env,
  | 'NODE_ENV'
  | 'CORS_ORIGIN'
  | 'FXL_HUB_CONFIG'
  | 'FXL_HUB_API_URL'
  | 'FXL_HUB_ENVIRONMENT'
  | 'FXL_HUB_CLIENT_ID'
  | 'FXL_HUB_CLIENT_SECRET'
  | 'FXL_HUB_AUDIENCE'
  | 'FXL_HUB_HEALTH_TOKEN'
  | 'FXL_HUB_REDIRECT_URI'
  | 'FXL_HUB_POST_LOGIN_REDIRECT'
  | 'FXL_HUB_POST_LOGIN_ERROR_REDIRECT'
>;

export type HubAuthConfig = HubConfig & {
  /**
   * Carried but not yet handed to `createHubBff`: the 1.3.1 SDK has no such
   * option. The SDK bump wires it. It is validated here rather than there so a
   * deploy missing it fails at boot.
   */
  healthToken: string | undefined;
};

function isSet(value: string | undefined): value is string {
  return typeof value === 'string' && value !== '';
}

/**
 * The ONE bridge between the validated env object and the Hub loaders. Because
 * it exists, no loader ever reads the raw process environment again, so a value
 * that `env.ts` normalised (notably '' to undefined) cannot be read back raw.
 */
export function hubEnvBag(source: HubEnvSource): Record<string, string | undefined> {
  return {
    NODE_ENV: source.NODE_ENV,
    CORS_ORIGIN: source.CORS_ORIGIN,
    FXL_HUB_CONFIG: source.FXL_HUB_CONFIG,
    FXL_HUB_API_URL: source.FXL_HUB_API_URL,
    FXL_HUB_ENVIRONMENT: source.FXL_HUB_ENVIRONMENT,
    FXL_HUB_CLIENT_ID: source.FXL_HUB_CLIENT_ID,
    FXL_HUB_CLIENT_SECRET: source.FXL_HUB_CLIENT_SECRET,
    FXL_HUB_AUDIENCE: source.FXL_HUB_AUDIENCE,
    FXL_HUB_HEALTH_TOKEN: source.FXL_HUB_HEALTH_TOKEN,
    FXL_HUB_REDIRECT_URI: source.FXL_HUB_REDIRECT_URI,
    FXL_HUB_POST_LOGIN_REDIRECT: source.FXL_HUB_POST_LOGIN_REDIRECT,
    FXL_HUB_POST_LOGIN_ERROR_REDIRECT: source.FXL_HUB_POST_LOGIN_ERROR_REDIRECT,
  };
}

/**
 * Ambiguity is checked FIRST, so mixing the two forms fails even when the
 * discrete side is incomplete. The message names every offending VARIABLE and
 * never prints a value.
 */
export function hubConfigPresence(bag: Record<string, string | undefined>): HubConfigPresence {
  const jsonSet = isSet(bag.FXL_HUB_CONFIG);
  const discreteSet = HUB_DISCRETE_ENV_VARS.filter((key) => isSet(bag[key]));

  if (jsonSet && discreteSet.length > 0) {
    throw new HubConfigError(
      'FXL_HUB_CONFIG',
      `FXL_HUB_CONFIG is set alongside ${discreteSet.join(', ')}; use FXL_HUB_CONFIG alone or the five discrete variables alone`,
    );
  }
  if (jsonSet) return 'json';
  if (discreteSet.length === HUB_DISCRETE_ENV_VARS.length) return 'discrete';
  if (discreteSet.length === 0) return 'absent';
  return 'incomplete';
}

export function loadHubAuthConfig(bag: Record<string, string | undefined>): HubAuthConfig {
  const config = loadHubConfig(bag);
  const healthToken = isSet(bag.FXL_HUB_HEALTH_TOKEN) ? bag.FXL_HUB_HEALTH_TOKEN : undefined;

  if (config.environment !== 'development' && healthToken === undefined) {
    throw new HubConfigError(
      'FXL_HUB_HEALTH_TOKEN',
      'FXL_HUB_HEALTH_TOKEN is required outside development; the operator generates it and the Hub does not issue it',
    );
  }

  return { ...config, healthToken };
}

/**
 * The ONLY fail-soft door, and deliberately narrow. Both calls below may THROW
 * and neither is caught: see this file's header.
 */
export function tryLoadHubAuthConfig(
  bag: Record<string, string | undefined>,
): HubAuthConfig | null {
  const presence = hubConfigPresence(bag);
  if (presence === 'absent' || presence === 'incomplete') return null;
  return loadHubAuthConfig(bag);
}
