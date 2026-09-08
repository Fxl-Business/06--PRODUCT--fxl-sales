/**
 * The v3.1.0 behaviour change, pinned at the level it actually changed: a
 * PARTIALLY configured Hub is a BOOT FAILURE and no longer a 503.
 *
 * Before this slice, `hubConfigPresence` answered `incomplete` for a machine
 * with some of the five discrete variables set, `tryLoadHubAuthConfig` returned
 * null on that verdict, and the API booted cleanly and answered
 * `503 hub_auth_not_configured` to every request - naming no variable and
 * offering no fix. Three of five is a misconfiguration, not an unconfigured
 * machine.
 *
 * Now only ABSENT - nothing that could identify a Client set at all - takes the
 * null door. Everything else reaches `loadHubConfig`, which throws with the
 * offending field named, and `server.ts` calls `createAppAuthBff()` at module
 * top level, so that throw stops the process.
 *
 * This is the exact COMPLEMENT of `app-auth-unconfigured.test.ts`, which pins
 * the other half: all six blank still answers 503, which is what a fresh clone
 * must keep doing. Its own file for the same reason that one is: the verdict is
 * decided at module load and vitest isolates per file.
 */
import { HubConfigError } from '@fxl-business/hub-sdk';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const HUB_CLIENT_ID = 'pk_fxl-sales_development_unit-test-only-0123456789';

let importError: unknown;
let importedModule: unknown;

beforeAll(async () => {
  vi.resetModules();

  vi.stubEnv('NODE_ENV', 'test');
  vi.stubEnv('CORS_ORIGIN', 'http://localhost:8006');
  vi.stubEnv('DATABASE_URL', 'postgresql://postgres:postgres@localhost:5006/fxl_sales_partial_test');
  vi.stubEnv('ADMIN_DATABASE_URL', '');
  // THREE of the five, and blank reads as unset. `FXL_HUB_CLIENT_SECRET` and
  // `FXL_HUB_AUDIENCE` are the two missing ones, so this is the operator who
  // pasted most of a credential and stopped.
  vi.stubEnv('FXL_HUB_CONFIG', '');
  vi.stubEnv('FXL_HUB_API_URL', 'http://localhost:9016');
  vi.stubEnv('FXL_HUB_ENVIRONMENT', 'development');
  vi.stubEnv('FXL_HUB_CLIENT_ID', HUB_CLIENT_ID);
  vi.stubEnv('FXL_HUB_CLIENT_SECRET', '');
  vi.stubEnv('FXL_HUB_AUDIENCE', '');
  vi.stubEnv('FXL_HUB_HEALTH_TOKEN', '');
  vi.stubEnv('FXL_HUB_REDIRECT_URI', '');
  vi.stubEnv('FXL_HUB_TRUSTED_ORIGINS', '');
  vi.stubEnv('SALES_POST_LOGIN_REDIRECT', '');
  vi.stubEnv('SALES_POST_LOGIN_ERROR_REDIRECT', '');
  vi.stubEnv('SALES_SESSION_ENCRYPTION_IKM', '');

  try {
    // `app-auth.ts` calls `tryLoadHubAuthConfig(hubEnvBag(env))` at MODULE scope,
    // which is the same moment `server.ts` reaches, so importing it here IS the
    // boot. A module that resolves is a process that would have started.
    importedModule = await import('../app-auth.js');
  } catch (error) {
    importError = error;
  }
});

afterAll(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe('a partially configured Hub', () => {
  it('is a boot failure, not a 503', () => {
    // The module never resolved, so there is no middleware to answer 503 WITH.
    // That is the whole assertion: the failure happens before any request.
    expect(importedModule).toBeUndefined();
    expect(importError).toBeInstanceOf(HubConfigError);
  });

  it('names the variable to fix rather than saying only that something is wrong', () => {
    /*
      The reason the change is an improvement and not merely a change. A 503
      names nothing; this error carries the SDK's own field and message.

      `clientSecret` and not `audience`: `parseHubConfig` validates in a
      deliberate order and stops on the FIRST failure, so it reports the earlier
      of the two missing variables. Asserting the field pins that an ordinary
      missing-value error is what surfaced, rather than some unrelated refusal
      that would make this test pass for the wrong reason.
    */
    const error = importError as HubConfigError;
    expect(error.field).toBe('clientSecret');
    expect(error.message).toContain('clientSecret');
    // No value is ever printed, only names. Nothing was set here to leak, and
    // that must stay true if the fixture ever grows a real-looking secret.
    expect(error.message).not.toContain(HUB_CLIENT_ID);
  });
});
