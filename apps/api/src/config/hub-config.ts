/**
 * TEMPORARY VENDORED COPY of `@fxl-business/hub-sdk@2.1.0`'s config module.
 *
 * This repository still runs on `@fxl-business/hub-sdk@1.3.1`, which has no
 * config validator at all, so the 2.x contract is reproduced here in order to
 * make the Hub Audience and the Hub environment explicit validated configuration
 * one wave BEFORE the SDK bump.
 *
 * The exported names are deliberately identical to the SDK's. When the bump
 * lands, this file is DELETED outright and one import line in
 * `./auth-provider.ts` changes from `./hub-config.js` to
 * `@fxl-business/hub-sdk`. Nothing else moves.
 *
 * What is NOT here, and never will be: `hubConfigPresence`, the discrete-form
 * mutual exclusion, `hubEnvBag` and `HubAuthConfig`. Those are ours permanently
 * and live in `./auth-provider.ts`, so they survive the swap untouched.
 *
 * TWO HARD CONSTRAINTS, each with its own test:
 *
 * 1. The process environment must not appear in this file, not even in a
 *    comment. The Hub environment is configured, never inferred: a staging
 *    deploy that happens to run as a production process would otherwise ask the
 *    Hub for the wrong Client, which is a 401 at runtime instead of a refusal to
 *    boot.
 * 2. No error message interpolates an INPUT VALUE. Messages name the FIELD and
 *    the RULE. The only two interpolations are the three environment words and
 *    the expected audience computed from the client id slug, both closed sets
 *    and neither a credential. The client id and the client secret are NEVER
 *    interpolated.
 */

export type HubEnvironment = 'production' | 'staging' | 'development';

export const HUB_ENVIRONMENTS: readonly HubEnvironment[] = [
  'production',
  'staging',
  'development',
];

export interface HubConfig {
  apiUrl: string;
  environment: HubEnvironment;
  clientId: string;
  clientSecret: string;
  audience: string;
}

export interface ParsedClientId {
  slug: string;
  environment: HubEnvironment;
}

export class HubConfigError extends Error {
  readonly field: string;

  constructor(field: string, message: string) {
    super(message);
    this.name = 'HubConfigError';
    this.field = field;
  }
}

function isHubEnvironment(value: unknown): value is HubEnvironment {
  return typeof value === 'string' && (HUB_ENVIRONMENTS as readonly string[]).includes(value);
}

/**
 * `<prefix><slug>_<environment>_<random>`. The random segment may itself contain
 * underscores, so only the FIRST two are separators and everything after the
 * second belongs to the random.
 */
function parsePrefixedKey(value: string, prefix: string): ParsedClientId | null {
  if (typeof value !== 'string' || !value.startsWith(prefix)) return null;

  const body = value.slice(prefix.length);
  const firstSeparator = body.indexOf('_');
  if (firstSeparator <= 0) return null;

  const slug = body.slice(0, firstSeparator);
  const rest = body.slice(firstSeparator + 1);
  const secondSeparator = rest.indexOf('_');
  if (secondSeparator <= 0) return null;

  const environment = rest.slice(0, secondSeparator);
  const random = rest.slice(secondSeparator + 1);

  if (!/^[a-z0-9-]+$/.test(slug)) return null;
  if (!isHubEnvironment(environment)) return null;
  if (random === '' || !/^[A-Za-z0-9_-]+$/.test(random)) return null;

  return { slug, environment };
}

export function parseClientId(clientId: string): ParsedClientId | null {
  return parsePrefixedKey(clientId, 'pk_');
}

function parseClientSecret(clientSecret: string): ParsedClientId | null {
  return parsePrefixedKey(clientSecret, 'sk_');
}

export function parseHubConfig(value: unknown): HubConfig {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new HubConfigError('FXL_HUB_CONFIG', 'the Hub configuration must be a JSON object');
  }

  const raw = value as Record<string, unknown>;

  const environment = raw.environment;
  if (!isHubEnvironment(environment)) {
    throw new HubConfigError(
      'environment',
      `FXL_HUB_ENVIRONMENT is required and must be one of ${HUB_ENVIRONMENTS.join(', ')}`,
    );
  }

  const rawApiUrl = raw.apiUrl;
  if (typeof rawApiUrl !== 'string' || rawApiUrl === '') {
    throw new HubConfigError('apiUrl', 'FXL_HUB_API_URL is required');
  }

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(rawApiUrl);
  } catch {
    throw new HubConfigError('apiUrl', 'FXL_HUB_API_URL must be an absolute URL');
  }

  if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
    throw new HubConfigError('apiUrl', 'FXL_HUB_API_URL must use http or https');
  }
  if (parsedUrl.protocol !== 'https:' && environment !== 'development') {
    throw new HubConfigError(
      'apiUrl',
      'FXL_HUB_API_URL must use https outside the development environment',
    );
  }

  const apiUrl = rawApiUrl.replace(/\/+$/, '');

  const clientId = raw.clientId;
  if (typeof clientId !== 'string' || clientId === '') {
    throw new HubConfigError('clientId', 'FXL_HUB_CLIENT_ID is required');
  }

  const parsedClientId = parseClientId(clientId);
  if (!parsedClientId) {
    throw new HubConfigError(
      'clientId',
      'FXL_HUB_CLIENT_ID must have the form pk_<slug>_<environment>_<random>',
    );
  }

  if (parsedClientId.environment !== environment) {
    throw new HubConfigError(
      'environment',
      `FXL_HUB_ENVIRONMENT is ${environment} but the client id names ${parsedClientId.environment}`,
    );
  }

  const clientSecret = raw.clientSecret;
  if (typeof clientSecret !== 'string' || clientSecret === '') {
    throw new HubConfigError('clientSecret', 'FXL_HUB_CLIENT_SECRET is required');
  }

  const parsedClientSecret = parseClientSecret(clientSecret);
  if (!parsedClientSecret) {
    throw new HubConfigError(
      'clientSecret',
      'FXL_HUB_CLIENT_SECRET must have the form sk_<slug>_<environment>_<random>',
    );
  }

  if (
    parsedClientSecret.slug !== parsedClientId.slug ||
    parsedClientSecret.environment !== parsedClientId.environment
  ) {
    throw new HubConfigError(
      'clientSecret',
      'FXL_HUB_CLIENT_SECRET does not belong to FXL_HUB_CLIENT_ID',
    );
  }

  const audience = raw.audience;
  // This is the rule that makes a hardcoded derived-from-a-key audience a BOOT
  // failure rather than a 401 on every request an hour later.
  if (typeof audience !== 'string' || !/^app\.[a-z0-9-]+$/.test(audience)) {
    throw new HubConfigError(
      'audience',
      'FXL_HUB_AUDIENCE must be app.<slug>; an audience is configured, never derived from a key',
    );
  }

  if (audience !== `app.${parsedClientId.slug}`) {
    throw new HubConfigError('audience', `FXL_HUB_AUDIENCE must be app.${parsedClientId.slug}`);
  }

  return { apiUrl, environment, clientId, clientSecret, audience };
}

export function loadHubConfig(env: Record<string, string | undefined>): HubConfig {
  const json = env['FXL_HUB_CONFIG'];
  if (typeof json === 'string' && json !== '') {
    let parsed: unknown;
    try {
      parsed = JSON.parse(json);
    } catch {
      throw new HubConfigError('FXL_HUB_CONFIG', 'FXL_HUB_CONFIG is not valid JSON');
    }
    return parseHubConfig(parsed);
  }

  return parseHubConfig({
    apiUrl: env['FXL_HUB_API_URL'],
    environment: env['FXL_HUB_ENVIRONMENT'],
    clientId: env['FXL_HUB_CLIENT_ID'],
    clientSecret: env['FXL_HUB_CLIENT_SECRET'],
    audience: env['FXL_HUB_AUDIENCE'],
  });
}
