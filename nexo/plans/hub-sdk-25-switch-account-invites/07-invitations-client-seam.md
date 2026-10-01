---
id: 07-invitations-client-seam
milestone: v4.1.0
status: todo
depends_on: [01-sdk-bump-2.5.0]
files_modified:
  - apps/api/src/domains/sellers/invitations-client.ts
  - apps/api/src/middleware/app-auth.ts
  - apps/api/src/domains/sellers/invitation-error.ts
  - apps/api/src/domains/sellers/__tests__/invitation-error.test.ts
  - apps/api/src/domains/sellers/__tests__/invitations-client.test.ts
acceptance: "given the validated Hub config, when the app needs to send/list/revoke/resend invitations, then a single Sales-side invitations interface wraps createHubInvitations(config), a fake with the same shape can be injected for tests, and HubInvitationError codes map deterministically to HTTP responses by code (never by message).; and with a VALID Hub config while the development identity adapter is installed, the client is null and nothing contacts the Hub."
goal: "Define the Sales-side invitations seam: one createHubInvitations(config) instance behind a Sales interface, an injectable fake, and a code->response error mapper."
verifier_focus: "The real createHubInvitations instance is created once from the same hubSdkConfig used by createHubBff (getHubSdkConfig()); creating it does no network I/O. The error mapper keys on HubInvitationError.code, covering every code in spec section 5.8, and NEVER on message. The fake matches create/list/revoke/resend exactly. The dev-adapter-installed case returns null even with a valid Hub config, proven non-vacuously (see step 4)."
must_not_break:
  - "No route wiring changes here (that is slice 08); this slice is the seam + mapper + fake only."
rules:
  - "Single instance; construction is lazy/memoized and guarded on getHubSdkConfig() being non-null."
  - "The Sales interface has methods create/list/revoke/resend with the SDK's argument shapes (accessToken, email, appRoles?, locale?, status?, invitationId)."
  - "acceptUrl may be returned to callers; never logged."
  - "RECONCILED 2026-10-01 (no-Hub mode, corrected by plan-check-2): getHubSdkConfig() is null only when there is no Hub config, or under SALES_AUTH_FAKE when the config is INVALID. With a VALID local Hub config, make dev-fake still yields a NON-null config, and a real client would send the fake bearer to the real Hub. So: export `isAppAuthAdapterInstalled(): boolean` from apps/api/src/middleware/app-auth.ts, reading the existing module-level `installedAppAuthAdapter` (no env read, no new flag branch). getInvitationsClient() returns null when getHubSdkConfig() is null OR isAppAuthAdapterInstalled() is true. The decision is made LAZILY on the first call (after boot installed the adapter), memoized, never at module load, and never reads SALES_AUTH_FAKE. It never throws and never builds a client per request. invitation-error.ts also exports INVITATIONS_UNAVAILABLE = { httpStatus: 503, body: { error: 'unavailable', code: 'hub_auth_not_configured' } }, byte-identical to the existing 503 body, used by slice 08 whenever the client is null. Never add a per-request branch on SALES_AUTH_FAKE."
---

# Slice 07 - invitations client seam + error mapper

## Context (from investigation + slice 01 surface note)

- `apps/api/src/config/auth-provider.ts` produces the validated `HubConfig`; `apps/api/src/middleware/app-auth.ts:154` holds `hubSdkConfig` and exposes `getHubSdkConfig()`. Pass that same config to `createHubInvitations(config)` (server import from `@fxl-business/hub-sdk/server`, exact path confirmed in `sdk-2.5.0-surface.md`).
- The admin's access token is read in the route handler (slice 08) from `c.req.header('Authorization')` and passed as `accessToken`; this seam only defines the interface.
- Error codes to map (spec section 5.8): `actor_not_member` + `application_not_granted` -> "voce nao pode convidar para esta Organization" (403); `invalid_app_roles` -> "papel invalido" (400); `invitation_not_found` + `invitation_not_pending` -> "este convite nao existe mais ou ja foi aceito ou revogado" (404/409); `invalid_actor_token` -> pede novo login (401); `rate_limited` -> retry after `retryAfterSeconds` (429); `network_error` + `unexpected_response` -> temporary failure (502/503); `invalid_client` + `application_mismatch` + `not_an_application` + `invalid_request` -> configuration/code defect (500); `discovery_missing_api_url` + `discovery_insecure_api_url` -> operator item (500/503).

## Steps (TDD)

1. **invitation-error.test.ts (red):** for every code above, assert `mapInvitationError(new HubInvitationError({ code, status, retryAfterSeconds }))` returns the expected `{ httpStatus, body: { error/reason/code }, retryAfterSeconds? }`. Assert it keys on `code`, not message (pass a misleading message and confirm the mapping is unchanged).
2. **invitation-error.ts (green):** implement `mapInvitationError(err): { httpStatus, body, retryAfterSeconds? }` switching on `err.code`, with a safe default for unknown codes (treat as 500 config/code defect). Export the copy strings.
3. **invitations-client.ts (green):**
   - Define `SalesInvitationsClient` interface: `create({ accessToken, email, appRoles?, locale? })`, `list({ accessToken, status? })`, `revoke({ accessToken, invitationId })`, `resend({ accessToken, invitationId, locale? })` - matching the SDK shapes from the surface note.
   - Provide `getInvitationsClient(): SalesInvitationsClient | null` that lazily creates ONE `createHubInvitations(getHubSdkConfig())` instance (null when config absent) and adapts it to the interface.
   - Provide a seam for injecting a fake in tests (e.g. `setInvitationsClientForTests(fake)` / a module-level override, following the `vi.doMock`/injection pattern the repo uses).
4. **invitations-client.test.ts:** assert the real path constructs one instance from `getHubSdkConfig()` with no network call, returns null when config absent, returns null with a VALID Hub config stubbed while a dev adapter is installed (stub `fetch` to throw so any Hub contact fails the test), and that an injected fake with the same shape is used by the getter. The test seam distinguishes three states explicitly: injected fake, forced absent (null), and reset to the real resolution - never one overloaded setter where `null` means two things. Reset also clears the memoized decision. Because `getHubSdkConfig()` is resolved at module load and the unit setup blanks Hub credentials, the dev-adapter case MUST `vi.stubEnv` a valid Hub config, `vi.resetModules()`, dynamically import `app-auth` and the client module, install the adapter on THAT `app-auth` instance, and pair it with a positive control (same valid config, no adapter => non-null client) so the null result cannot be vacuous.

## Acceptance / oracle

- Named oracle: `apps/api/src/domains/sellers/__tests__/invitation-error.test.ts` + `apps/api/src/domains/sellers/__tests__/invitations-client.test.ts`.
