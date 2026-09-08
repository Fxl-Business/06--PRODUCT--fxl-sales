/**
 * The Hub configuration doors.
 *
 * `@fxl-business/hub-sdk` owns the RESOLVER, whole. This repo carried a vendored
 * parser while it was on 1.3.1, then a presence layer, a discrete-variable
 * renamer and a health-token requirement layered over 2.2.0's `loadHubConfig`.
 * 2.3.0 owns every one of those: it resolves the nine canonical names, refuses
 * the two forms mixed (and, stricter than ours ever was, refuses an OPERATIONAL
 * key smuggled inside `FXL_HUB_CONFIG`), and `assertBootConfiguration` - which
 * `createHubBff` calls ITSELF - enforces the health token and the redirect uri.
 * So this file no longer duplicates any of it.
 *
 * What is left here is the one question the SDK has NO api for: has this machine
 * been given credentials at all? `loadHubConfig({})` and
 * `loadHubConfig({three of five set})` both throw `HubConfigError`, and the
 * `field` does not discriminate them, so `hubConfigIsAbsent` answers it directly
 * off the six variable names that carry a credential.
 *
 * THERE IS NO BLANKET try/catch HERE, AND THAT IS THE POINT. A bad Hub
 * configuration is a BOOT FAILURE, not a 503. The previous shape caught every
 * throw and answered null, which turned "this audience names nothing the Hub
 * mints" into a quietly running API that answered 503 to every request and told
 * the operator nothing. `tryLoadHubAuthConfig` returns null ONLY when NOTHING is
 * set, which is exactly the machine that has not been given credentials yet.
 * That is what keeps `503 hub_auth_not_configured` alive for a fresh clone, and
 * what keeps every unrelated test file able to import `app-auth.ts`. Do not
 * widen it.
 *
 * DELIBERATE BEHAVIOUR CHANGE, v3.1.0: a PARTIAL discrete configuration - some
 * of the five set, not all - used to fall into this null door and answer 503.
 * It is now a boot failure carrying the SDK's own message. Three of five is a
 * misconfiguration, not an unconfigured machine, and 503 on every request tells
 * the operator nothing about which variable is missing. A fresh clone is
 * unaffected: `.env.example` ships all five blank, which is still absent.
 */
import type { Env } from '../env.js';
import { type HubConfig, loadHubConfig } from '@fxl-business/hub-sdk';

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
  | 'FXL_HUB_TRUSTED_ORIGINS'
  | 'SALES_POST_LOGIN_REDIRECT'
  | 'SALES_POST_LOGIN_ERROR_REDIRECT'
>;

/**
 * The Hub contract, exactly as the SDK resolves it. No local extension: 2.3.0's
 * `HubConfig` declares `healthToken`, `redirectUri` and `trustedOrigins` itself,
 * and every one of them now rides on the CONFIG rather than being handed to
 * `createHubBff` as a second, separately-resolved option.
 */
export type HubAuthConfig = HubConfig;

/**
 * The SIX names that carry a Hub credential: the JSON form and the five discrete
 * identity variables.
 *
 * The four OPERATIONAL names (`FXL_HUB_REDIRECT_URI`, `FXL_HUB_HEALTH_TOKEN`,
 * `FXL_HUB_TRUSTED_ORIGINS`, `FXL_HUB_SESSION_ENCRYPTION_KEY`) are deliberately
 * NOT members. None of them identifies a Client, so a machine carrying only
 * those has still been given no credentials, and counting one would turn a
 * stray `FXL_HUB_REDIRECT_URI` in a shell profile into a boot failure on a
 * fresh clone.
 */
const HUB_CREDENTIAL_ENV_VARS = [
  'FXL_HUB_CONFIG',
  'FXL_HUB_API_URL',
  'FXL_HUB_ENVIRONMENT',
  'FXL_HUB_CLIENT_ID',
  'FXL_HUB_CLIENT_SECRET',
  'FXL_HUB_AUDIENCE',
] as const;

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
    FXL_HUB_TRUSTED_ORIGINS: source.FXL_HUB_TRUSTED_ORIGINS,
    SALES_POST_LOGIN_REDIRECT: source.SALES_POST_LOGIN_REDIRECT,
    SALES_POST_LOGIN_ERROR_REDIRECT: source.SALES_POST_LOGIN_ERROR_REDIRECT,
  };
}

/**
 * True only when NOTHING that could identify a Client is set. Everything else -
 * one of the six, three of the six, both forms at once - is configuration the
 * SDK must judge, and it throws with the offending name.
 */
export function hubConfigIsAbsent(bag: Record<string, string | undefined>): boolean {
  return !HUB_CREDENTIAL_ENV_VARS.some((key) => isSet(bag[key]));
}

/** The strict door: `loadHubConfig` and nothing else. It only ever throws or returns. */
export function loadHubAuthConfig(bag: Record<string, string | undefined>): HubAuthConfig {
  return loadHubConfig(bag);
}

/**
 * The ONLY fail-soft door, and deliberately narrow. `loadHubAuthConfig` below
 * may THROW and is not caught: see this file's header.
 */
export function tryLoadHubAuthConfig(
  bag: Record<string, string | undefined>,
): HubAuthConfig | null {
  if (hubConfigIsAbsent(bag)) return null;
  return loadHubAuthConfig(bag);
}
