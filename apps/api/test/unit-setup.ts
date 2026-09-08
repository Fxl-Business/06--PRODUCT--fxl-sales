import { vi } from 'vitest';

/**
 * The unit suite must not inherit the developer's Hub credentials, or the lack
 * of them.
 *
 * `middleware/app-auth.ts` resolves the Hub contract at MODULE scope, because
 * `server.ts` calls `createAppAuthBff()` at module top level and a bad
 * configuration has to be a BOOT failure rather than a 503 answered forever. So
 * every test file that transitively imports a router also imports that
 * resolution, and its verdict is decided by whatever `apps/api/.env` happens to
 * hold on the machine running it.
 *
 * That coupling is not new. What is new in v3.1.0 is that it is no longer
 * MASKED: a PARTIAL Hub configuration - some of the five discrete variables set,
 * not all - used to take the fail-soft null door and answer 503, and is now the
 * boot failure it always should have been. A `.env` carrying `FXL_HUB_API_URL`
 * and little else is the ordinary state of a machine that predates the canonical
 * names, and under it three sales-ops route files failed to IMPORT.
 *
 * Blanking the six credential-bearing names here makes the ambient configuration
 * unambiguously ABSENT, which is the one state `tryLoadHubAuthConfig` answers
 * null for. A file that actually wants a configured Hub stubs its own values in
 * `beforeAll` and re-imports behind `vi.resetModules()`; `vi.stubEnv` overwrites,
 * and setup files run BEFORE the test module, so those files are unaffected.
 *
 * Blank reads as unset everywhere: `env.ts` maps '' to undefined, and the SDK's
 * loader treats an empty string as absent too.
 *
 * The four OPERATIONAL names are deliberately left alone. None of them
 * identifies a Client, so none can turn an absent configuration into a partial
 * one, and a test that wants to observe one should be able to.
 */
for (const name of [
  'FXL_HUB_CONFIG',
  'FXL_HUB_API_URL',
  'FXL_HUB_ENVIRONMENT',
  'FXL_HUB_CLIENT_ID',
  'FXL_HUB_CLIENT_SECRET',
  'FXL_HUB_AUDIENCE',
]) {
  vi.stubEnv(name, '');
}
