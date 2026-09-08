/**
 * What a FRESH CLONE actually gets, read off the files a human is told to copy.
 *
 * This is the oracle the contract slice was missing. Every other test in this
 * suite CONSTRUCTS its own env bag, so nothing in the repository ever read
 * `.env.example` or `.env.dev.example` - and the plan for that slice justified
 * making a partial Hub configuration a boot failure on the premise that "the
 * examples ship all five blank, which is still absent". They did not. Both
 * shipped `FXL_HUB_API_URL`, `FXL_HUB_ENVIRONMENT` and `FXL_HUB_AUDIENCE`
 * populated, so a developer following the documented copy step got a PARTIAL
 * configuration and the API refused to boot with
 * `FXL_HUB_CONFIG.clientId is missing or empty`.
 *
 * That killed the fail-soft door on the exact path it exists for: someone who
 * has not been given Hub credentials yet and wants to work on sales-ops. The
 * three values are only meaningful ALONGSIDE a client id, so shipping them
 * pre-filled always described a configuration that did not exist. Blank, with
 * the known-good values one uncomment away, says "all five together, or none",
 * which is what the contract enforces.
 *
 * Driven through the REAL predicate and the REAL door rather than a
 * re-implementation of "is this absent", so it cannot drift from the rule it
 * pins.
 *
 * The four OPERATIONAL names are deliberately not examined. None of them
 * identifies a Client, so none can turn absent into partial; `.env.dev.example`
 * may populate them freely.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { hubConfigIsAbsent, tryLoadHubAuthConfig } from '../auth-provider.js';

const EXAMPLES = ['.env.example', '.env.dev.example'] as const;

/**
 * A deliberately small dotenv reader: `KEY=VALUE`, `#` comments and blank lines,
 * which is the whole grammar these two files use.
 *
 * It does NOT strip quotes or expand anything, and that is correct here - a
 * quoted or interpolated value would still be a SET value, which is the only
 * property under test. Erring toward "this counts as set" is the safe direction:
 * it can only make the assertion stricter.
 */
function parseEnvExample(name: string): Record<string, string | undefined> {
  const path = new URL(`../../../${name}`, import.meta.url);
  const bag: Record<string, string | undefined> = {};

  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (trimmed === '' || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    bag[trimmed.slice(0, eq).trim()] = trimmed.slice(eq + 1).trim();
  }

  return bag;
}

/**
 * The three identity values the file SHOWS in comments, read back out of those
 * comments.
 *
 * Reading them from the file rather than hard-coding them is what makes the
 * redirect test below a test of the SHIPPED documentation: if someone changes
 * the commented Hub URL, this follows it, and the assertion still means "the
 * callback is not on the Hub these examples describe".
 */
function documentedIdentity(name: string): Record<string, string> {
  const raw = readFileSync(new URL(`../../../${name}`, import.meta.url), 'utf8');
  const out: Record<string, string> = {};

  for (const key of ['FXL_HUB_API_URL', 'FXL_HUB_ENVIRONMENT', 'FXL_HUB_AUDIENCE']) {
    const value = raw.match(new RegExp(`^# ${key}=(.+)$`, 'm'))?.[1];
    if (value === undefined) throw new Error(`expected ${name} to show a commented ${key}`);
    out[key] = value.trim();
  }

  return out;
}

describe('the shipped .env examples', () => {
  it('parses at all, so a green run below cannot mean an empty bag', () => {
    // The vacuity guard. Every assertion in this file is of the form "nothing
    // Hub-shaped is set", which a parser returning `{}` would satisfy perfectly.
    // Reading a NON-Hub variable back proves the file was found and understood.
    for (const name of EXAMPLES) {
      const bag = parseEnvExample(name);
      expect(bag.CORS_ORIGIN).toBe('http://localhost:8006');
      expect(Object.keys(bag).length).toBeGreaterThan(10);
    }
  });

  it.each(EXAMPLES)('describes an ABSENT Hub configuration in %s', (name) => {
    /*
      The property, against the real predicate. It goes RED the moment anyone
      re-populates one of the six credential-bearing names in either file - which
      is exactly how the defect this test exists for got in.
    */
    expect(hubConfigIsAbsent(parseEnvExample(name))).toBe(true);
  });

  it.each(EXAMPLES)('reaches the 503 door rather than a boot failure from %s', (name) => {
    /*
      The same fact stated as the BEHAVIOUR it protects, through the real door
      `middleware/app-auth.ts` calls at module scope.

      null here is `503 hub_auth_not_configured`. A THROW here is a fresh clone
      that cannot start the API at all, which is the defect. Asserting the door
      and not only the predicate is what keeps this test meaningful if the two
      ever stop agreeing.
    */
    expect(tryLoadHubAuthConfig(parseEnvExample(name))).toBeNull();
  });

  it.each(EXAMPLES)('keeps the callback off the Hub’s own origin in %s', (name) => {
    /*
      The silent one, and the reason it needs a test rather than a boot rule.

      `resolveHubRedirectUri` used to fill an absent value in development with
      `${CORS_ORIGIN}/auth/callback`. It is deleted, and `parseRedirectUri`
      defaults an absent value to `${apiUrl}/auth/callback` - the HUB's origin,
      which the Hub then rejects as an unregistered redirect_uri. Check 7 refuses
      exactly that, but ONLY when the environment is not development, so a local
      clone boots perfectly cleanly and fails at the login screen instead.

      Nothing else in the suite can catch that: it is not a boot failure, not a
      type error, and every other test supplies its own redirect. So this asserts
      the property check 7 would assert if it ran here.

      It drives the REAL loader over the operator's own path: uncomment the three
      documented values, paste a credential, keep the shipped redirect. The
      client id and secret are obviously synthetic and carry no entropy; they
      exist only because `loadHubConfig` will not resolve anything without them.
    */
    const bag = {
      ...parseEnvExample(name),
      ...documentedIdentity(name),
      FXL_HUB_CLIENT_ID: 'pk_fxl-sales_development_unit-test-only-0123456789',
      FXL_HUB_CLIENT_SECRET: 'sk_fxl-sales_development_unit-test-only-not-a-real-secret-0123456789',
    };

    const config = tryLoadHubAuthConfig(bag);
    if (!config) throw new Error('expected the documented values to resolve a config');

    expect(new URL(config.redirectUri ?? '').origin).not.toBe(new URL(config.apiUrl).origin);
    // Named outright, so the failure says what to set rather than only that two
    // origins matched. This is the value CLAUDE.md's "Required API vars" block
    // documents, and the WEB origin: vite proxies /auth from 8006 to the api on
    // 3006, so the registered callback is 8006 and never 3006.
    expect(config.redirectUri).toBe('http://localhost:8006/auth/callback');
  });

  it.each(EXAMPLES)('still SHOWS the known-good local values, commented, in %s', (name) => {
    /*
      Blank is only half the fix. The three values are real and an operator needs
      them, so they must survive as commented lines rather than being deleted -
      otherwise the next person guesses the Hub port.

      Asserting on the RAW text and not the parsed bag is the point: these must be
      present as comments and absent as values, and the two assertions together
      say exactly that.
    */
    const raw = readFileSync(new URL(`../../../${name}`, import.meta.url), 'utf8');

    expect(raw).toContain('# FXL_HUB_API_URL=http://localhost:9016');
    expect(raw).toContain('# FXL_HUB_ENVIRONMENT=development');
    expect(raw).toContain('# FXL_HUB_AUDIENCE=app.fxl-sales');
  });
});
