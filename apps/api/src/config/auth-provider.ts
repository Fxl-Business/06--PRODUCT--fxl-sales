/**
 * The Hub configuration doors.
 *
 * `@fxl-business/hub-sdk` owns the PARSER. This repo carried a vendored copy of
 * it while it was on 1.3.1, which exported no parser at all; 2.2.0 exports
 * `loadHubConfig`, `HubConfig` and `HubConfigError`, so the copy is deleted and
 * this file imports them.
 *
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
import { type HubConfig, HubConfigError, loadHubConfig } from '@fxl-business/hub-sdk';

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
  | 'SALES_POST_LOGIN_REDIRECT'
  | 'SALES_POST_LOGIN_ERROR_REDIRECT'
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
  // Not every key here is a Hub variable: NODE_ENV, CORS_ORIGIN and the two
  // SALES_POST_LOGIN_* names are this repo's own, and the bag is simply the one
  // bridge every auth loader reads through.
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
    SALES_POST_LOGIN_REDIRECT: source.SALES_POST_LOGIN_REDIRECT,
    SALES_POST_LOGIN_ERROR_REDIRECT: source.SALES_POST_LOGIN_ERROR_REDIRECT,
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

/**
 * Maps a `HubConfigError.field` back to the discrete variable an operator of
 * THIS repo actually sets.
 *
 * The SDK names its own JSON form (`FXL_HUB_CONFIG.clientSecret`), which is
 * correct for a consumer using that form and useless for one using the five
 * discrete variables: it points at a variable they never set. The vendored
 * parser this repo carried named the discrete one, and that operator experience
 * is not something the bump should cost.
 */
const HUB_FIELD_TO_DISCRETE_VAR: Record<string, string> = {
  apiUrl: 'FXL_HUB_API_URL',
  environment: 'FXL_HUB_ENVIRONMENT',
  clientId: 'FXL_HUB_CLIENT_ID',
  clientSecret: 'FXL_HUB_CLIENT_SECRET',
  audience: 'FXL_HUB_AUDIENCE',
};

/**
 * Re-throws the SDK's own error with the discrete variable named alongside its
 * field.
 *
 * This is NOT the blanket try/catch this file's header forbids, and the
 * difference is the whole point: it never returns, never answers null and never
 * downgrades a boot failure to a 503. It rethrows a `HubConfigError` carrying
 * the same `field`, with a message that names the variable to change. The
 * original message is preserved, and no VALUE is ever added to it.
 *
 * `incomplete` counts as well as `discrete`, and it is in fact the more common
 * case: it is exactly the operator who set some of the five variables and missed
 * one, which is the person who most needs to be told which name is missing.
 * `json` is left alone, because there the SDK's own dotted path is the accurate
 * thing to say.
 */
function nameDiscreteVar(error: unknown, presence: HubConfigPresence): never {
  if (!(error instanceof HubConfigError) || (presence !== 'discrete' && presence !== 'incomplete')) {
    throw error;
  }
  const variable = HUB_FIELD_TO_DISCRETE_VAR[error.field];
  if (variable === undefined || error.message.includes(variable)) {
    throw error;
  }
  throw new HubConfigError(error.field, `${variable}: ${error.message}`);
}

export function loadHubAuthConfig(bag: Record<string, string | undefined>): HubAuthConfig {
  const presence = hubConfigPresence(bag);
  let config: HubConfig;
  try {
    config = loadHubConfig(bag);
  } catch (error) {
    nameDiscreteVar(error, presence);
  }
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
