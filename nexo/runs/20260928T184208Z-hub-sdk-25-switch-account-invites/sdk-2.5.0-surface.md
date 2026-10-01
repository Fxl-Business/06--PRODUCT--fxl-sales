# @fxl-business/hub-sdk 2.5.0 - confirmed surface

Recorded by slice 01 (`feat/01-sdk-bump-2.5.0`, commit `cb5e2a3`) from the installed dist at
`node_modules/.pnpm/@fxl-business+hub-sdk@2.5.0_hono@4.12.28/node_modules/@fxl-business/hub-sdk/dist/`.
Every block below is quoted verbatim from the `.d.ts` or the built `.js`.
`HUB_SDK_VERSION = "2.5.0"`; `HUB_TOKEN_CONTRACT_VERSION` is still 1.
Runtime dependency is still `jose` only; peer `hono >=4.12.28`; the lockfile resolves one `hono@4.12.28`.

## Import subpaths

The package `exports` map has exactly three entries: `.`, `./server`, `./client`.

| Symbol | Import from |
| --- | --- |
| `createHubClient`, `HubClient` (type), `SetActiveResult` (type), `HubTokenResult` (type) | `@fxl-business/hub-sdk/client` |
| `createHubInvitations`, `HubInvitationError` (class, runtime value) | `@fxl-business/hub-sdk/server` |
| types `HubInvitations`, `HubInvitation`, `HubInvitationResult`, `HubInvitationList`, `HubInvitationStatus`, `HubInvitationLocale`, `HubInvitationWarning`, `HubInvitationWarningCode`, `HubInvitationEmailDelivery`, `HubInvitationErrorCode`, `CreateHubInvitationInput`, `ListHubInvitationsInput`, `RevokeHubInvitationInput`, `ResendHubInvitationInput`, `CreateHubInvitationsOptions` | `@fxl-business/hub-sdk/server` (type-only exports) |
| `HubConfig` (type), `HubConfigError`, `HubDiscovery` (type, now has optional `fxlApiUrl`), `loadHubConfig` | `@fxl-business/hub-sdk` (root) |

Invitations are SERVER-ONLY: they are re-exported from `./server` alone, never from `./client` or the root.

`server.d.ts` export line (verbatim):

```ts
export { type BootAssertionInput, type CreateHubBffOptions, type CreateHubInvitationInput, type CreateHubInvitationsOptions, type HubInvitation, type HubInvitationEmailDelivery, HubInvitationError, type HubInvitationErrorCode, type HubInvitationList, type HubInvitationLocale, type HubInvitationResult, type HubInvitationStatus, type HubInvitationWarning, type HubInvitationWarningCode, type HubInvitations, type ListHubInvitationsInput, type RequireHubAuthOptions, type ResendHubInvitationInput, type ResolvedHubConfig, type RevokeHubInvitationInput, assertBootConfiguration, assertConformantSessionStore, createHubBff, createHubInvitations, organizationScope, requireHubAuth };
```

## Browser: `HubClient.switchAccount`

`client.d.ts` (verbatim):

```ts
    /**
     * Redirect the browser to the BFF `/auth/login` with `prompt=select_account`, so the
     * Hub shows its Account Chooser even when one account is signed in, optionally
     * hinting an Organization exactly as `login` does. A full-document navigation on
     * purpose: the new account's session replaces this one, and nothing held in memory
     * by this document may survive into it.
     */
    switchAccount(options?: {
        organization?: string;
    }): void;
```

Semantics: returns `void` synchronously and NAVIGATES (full-document, like `login`).
It does not resolve in-page and returns no token, so there is no `setActive`-style critical section to mirror (no `queryClient.clear()`, no generation guard, no `tokenCache.seed`): the document is torn down.
There is no popup variant.

Implementation in `client.js` (verbatim):

```js
    switchAccount(switchOptions) {
      const organization = switchOptions?.organization;
      navigate(
        organization ? `${bffBase}/auth/login?prompt=select_account&organization=${encodeURIComponent(organization)}` : `${bffBase}/auth/login?prompt=select_account`
      );
    },
```

So the URL is `${bffBase}/auth/login?prompt=select_account[&organization=<encoded>]`.
An app must never hand-build this URL; call `client.switchAccount(...)`.

IMPORTANT for slice 02: `switchAccount` is a REQUIRED member of the `HubClient` interface, so any object literal that `satisfies HubClient` fails type-check without it.
Slice 01 already had to add, purely to keep the suite compiling:
- `apps/web/src/dev/install-dev-identity.ts`: `switchAccount() { window.location.reload(); }` (mirrors the dev `login()`; no navigation to a Hub, no identity swap). Slice 02 owns its oracle (`dev-identity-switch-account.test.ts`) and may refine the comment, but the member exists.
- `switchAccount: vi.fn<HubClient['switchAccount']>()` in the client mocks of `apps/web/src/__tests__/session-journey.test.tsx`, `apps/web/src/auth/__tests__/react.test.tsx`, `apps/web/src/sales-ops/__tests__/session-loss-keeps-route.test.tsx`, and `switchAccount: vi.fn()` in `apps/web/src/dev/__tests__/dev-identity-roles.test.tsx`.

## BFF: `GET /auth/login` relays `prompt=select_account`

`server.js` (verbatim, inside the `/auth/login` handler):

```js
var SELECT_ACCOUNT_PROMPT = "select_account";
...
    const organization = c.req.query("organization");
    if (organization) {
      params.set("organization", organization);
    }
    const prompts = c.req.queries("prompt");
    if (prompts !== void 0 && prompts.length === 1 && prompts[0] === SELECT_ACCOUNT_PROMPT) {
      params.set("prompt", SELECT_ACCOUNT_PROMPT);
    }
    return c.redirect(`${disco.authorizationEndpoint}?${params.toString()}`, 302);
```

Relay rule: forwarded to `/authorize` only when the query carries EXACTLY ONE `prompt` and its value is exactly `select_account`; any other value, or a repeated `prompt`, is dropped silently (the login still proceeds without it).
This is inside `createHubBff`, which this repo already mounts at `/auth/*`; no app code is needed to get the relay.

## Server: `createHubInvitations`

```ts
declare function createHubInvitations(config: HubConfig, options?: CreateHubInvitationsOptions): HubInvitations;

interface CreateHubInvitationsOptions {
    /** Injectable fetch (tests stay offline). Defaults to the global fetch. */
    fetch?: typeof fetch;
    /** Per-request timeout in milliseconds. Default 10000. */
    timeoutMs?: number;
}

interface HubInvitations {
    create(input: CreateHubInvitationInput): Promise<HubInvitationResult>;
    list(input: ListHubInvitationsInput): Promise<HubInvitationList>;
    revoke(input: RevokeHubInvitationInput): Promise<void>;
    resend(input: ResendHubInvitationInput): Promise<HubInvitationResult>;
}
```

Construction re-validates `config` via `parseHubConfig` and throws `HubConfigError` synchronously for an invalid one, before any network call.
`config` is the SERVER `HubConfig` (needs `clientId` + `clientSecret`; Basic auth is built once from them).

### Inputs

```ts
interface CreateHubInvitationInput {
    /** The inviting person's Hub access token (the Bearer token `requireHubAuth` verified). */
    accessToken: string;
    email: string;
    /** Roles WITHIN this Application, validated by the Hub against its own app-role config. */
    appRoles?: string[];
    /** Absent means pt-BR. */
    locale?: HubInvitationLocale;
}
interface ListHubInvitationsInput {
    accessToken: string;
    /** Absent means the Hub's own default (pending). */
    status?: HubInvitationStatus;
}
interface RevokeHubInvitationInput {
    accessToken: string;
    invitationId: string;
}
interface ResendHubInvitationInput {
    accessToken: string;
    invitationId: string;
    locale?: HubInvitationLocale;
}
```

- The roles argument is named `appRoles` (string array), optional.
- There is NO `organizationId` input: the Organization is the one inside the verified `accessToken`.
- `accessToken` is the raw bearer string from the request's `Authorization: Bearer` header; it is sent as header `X-FXL-Hub-Actor-Token`. An empty string throws `invalid_actor_token` locally (status `null`) before any request.
- `revoke`/`resend` with an empty `invitationId` throw `invalid_request` locally (status `null`).

### Outputs

```ts
/** The invitation's lifecycle state, as the Hub derives it. */
type HubInvitationStatus = 'pending' | 'accepted' | 'revoked' | 'expired';
/** The email's language. Not persisted by the Hub. */
type HubInvitationLocale = 'pt-BR' | 'en';
/** The closed set of explicit warnings the Hub may attach to a create/resend result. */
type HubInvitationWarningCode = 'application_url_missing' | 'email_not_configured' | 'email_failed';
interface HubInvitationWarning {
    code: HubInvitationWarningCode;
}
interface HubInvitationEmailDelivery {
    status: 'sent' | 'not_configured' | 'failed';
}
/** The ONE projection every method resolves an invite through. */
interface HubInvitation {
    id: string;
    organizationId: string;
    applicationId: string;
    email: string;
    status: HubInvitationStatus;
    /** Roles within this Application the invitee receives on accept. */
    appRoles: string[];
    /** The account that asked for the invitation, or null when the Hub did not state it. */
    invitedByAccountId: string | null;
    /** ISO 8601. */
    expiresAt: string;
    /** ISO 8601. */
    createdAt: string;
    /** ISO 8601 when accepted, else null. */
    acceptedAt: string | null;
}
interface HubInvitationResult {
    invitation: HubInvitation;
    /** Carries the single-use token: never log it. */
    acceptUrl: string;
    emailDelivery: HubInvitationEmailDelivery;
    warnings: HubInvitationWarning[];
}
interface HubInvitationList {
    invitations: HubInvitation[];
}
```

Warning strings (exact, the closed set): `application_url_missing`, `email_not_configured`, `email_failed`.
Unknown warning codes from the Hub are FILTERED OUT by the parser (not an error); an absent `warnings` becomes `[]`.
`emailDelivery.status` values: `sent`, `not_configured`, `failed`.
`invitation.appRoles` is derived from the Hub's `seats[]` entry whose `productId === applicationId`; `[]` if absent.
`acceptUrl` carries a single-use token: never log it, never return it to a caller that should not hold it.

## `HubInvitationError`

```ts
type HubInvitationErrorCode = 'invalid_request' | 'invalid_app_roles' | 'invalid_client' | 'invalid_actor_token' | 'application_mismatch' | 'actor_not_member' | 'application_not_granted' | 'not_an_application' | 'invitation_not_found' | 'invitation_not_pending' | 'rate_limited' | 'network_error' | 'unexpected_response' | 'discovery_missing_api_url' | 'discovery_insecure_api_url';

declare class HubInvitationError extends Error {
    readonly code: HubInvitationErrorCode;
    /** The Hub's HTTP status, or null when no Hub response was involved. */
    readonly status: number | null;
    /** Seconds from Retry-After on a 429, else null. */
    readonly retryAfterSeconds: number | null;
    constructor(code: HubInvitationErrorCode, status: number | null, message: string, retryAfterSeconds?: number | null);
}
```

`name` is `"HubInvitationError"`.
No `cause` is ever attached.
Message shape: `hub-sdk: invitation <create|list|revoke|resend> failed: <code>[ (HTTP <status>)]`; it never contains the secret, the Basic header, the access token or the accept URL.

All 15 codes, and how each arises (from `server.js`):

| code | status | origin |
| --- | --- | --- |
| `invalid_request` | `400` or `null` | Hub 400 with no recognised `error`; or local: empty `invitationId` on revoke/resend |
| `invalid_app_roles` | Hub status | Hub body `error` |
| `invalid_client` | Hub status | Hub body `{"error":"unauthorized","code":"invalid_client"}` |
| `invalid_actor_token` | Hub status or `null` | Hub body `error`; or local: empty `accessToken` |
| `application_mismatch` | Hub status | Hub body `error` |
| `actor_not_member` | Hub status | Hub body `error` |
| `application_not_granted` | Hub status | Hub body `error` |
| `not_an_application` | Hub status | Hub body `error` |
| `invitation_not_found` | Hub status | Hub body `error` |
| `invitation_not_pending` | Hub status | Hub body `error` |
| `rate_limited` | `429` | any 429; `retryAfterSeconds` from an all-digits `Retry-After`, else `null` |
| `network_error` | `null` | fetch threw (discovery or the call itself), including the timeout abort |
| `unexpected_response` | Hub status or `null` | non-ok with no recognised code and not 400; an ok body that fails parsing; a discovery failure that is not already a `HubInvitationError` |
| `discovery_missing_api_url` | `null` | the discovery document has no `fxl_api_url` (cached per process: persists until restart) |
| `discovery_insecure_api_url` | `null` | `fxl_api_url` is not `https:` and `environment !== 'development'` |

Hub refusal codes are read from the response body's `error` field (the set `HUB_REFUSAL_CODES`: `invalid_app_roles`, `invalid_actor_token`, `application_mismatch`, `actor_not_member`, `application_not_granted`, `not_an_application`, `invitation_not_found`, `invitation_not_pending`); 429 is checked first.
Map errors by `code`, not by `status`.

## Wire details (for fakes and tests)

- Base URL: `${disco.fxlApiUrl}/applications/${encodeURIComponent(audience)}/invitations` (audience is `app.fxl-sales`).
- `create`: `POST <base>` body `{ email, appRoles?, locale? }`.
- `list`: `GET <base>[?status=<status>]`.
- `revoke`: `DELETE <base>/<invitationId>` resolves `void` on any ok status.
- `resend`: `POST <base>/<invitationId>/resend` body `{ locale? }` (always a JSON body, `{}` when no locale).
- Headers: `Authorization: Basic base64(clientId:clientSecret)`, `X-FXL-Hub-Actor-Token: <accessToken>`, `Accept: application/json`, plus `Content-Type: application/json` when there is a body.
- `redirect: "error"`, `AbortController` timeout (default 10000 ms).
- The injected `options.fetch` is used for BOTH discovery and the invitation call; `discover()` caches per process keyed by `apiUrl` (root export `__clearDiscoveryCache` is `@internal` test-only).
- Discovery: `HubDiscovery.fxlApiUrl?: string`, read from the discovery field `fxl_api_url`. No new `FXL_HUB_*` variable.
