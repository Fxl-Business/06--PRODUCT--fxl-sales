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
 *
 * SALES_ENV_FILE is blanked here for the same reason and it is the same class
 * of leak. `env.ts` calls `loadEnvFiles` at MODULE scope, and much of the unit
 * suite imports `env.ts` transitively, so a developer with SALES_ENV_FILE
 * exported in their shell would have the suite either THROW at module load or
 * silently load another environment's values on top of the blanking above. The
 * suite must be decided by its own fixtures and never by the operator's shell.
 * Setup files are evaluated before the test module, so this really does reach
 * the resolver first, and blank reads as absent because
 * `resolveNamedEnvFilePath` maps an empty string to null. This scopes the
 * opt-in out of the TEST process only; `make back` and `make migrate` are
 * unaffected.
 *
 * SALES_AUTH_FAKE is blanked here for the same class of leak: a developer who
 * exports it in their shell to drive `make dev-fake` must not thereby decide
 * whether the unit suite runs the Hub path or the development identity
 * adapter. A test that wants the fake path stubs its own value in `beforeAll`
 * and re-imports behind `vi.resetModules()`, exactly like the Hub variables
 * above. Blank reads as absent because the truthy set does not contain the
 * empty string.
 */
for (const name of [
  'FXL_HUB_CONFIG',
  'FXL_HUB_API_URL',
  'FXL_HUB_ENVIRONMENT',
  'FXL_HUB_CLIENT_ID',
  'FXL_HUB_CLIENT_SECRET',
  'FXL_HUB_AUDIENCE',
  'SALES_ENV_FILE',
  'SALES_AUTH_FAKE',
]) {
  vi.stubEnv(name, '');
}
