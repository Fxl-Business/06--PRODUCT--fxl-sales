import { Hono, MiddlewareHandler } from 'hono';
import { H as HubSdkConfig } from './config-CvYwarJp.js';
import { H as HubSessionStore } from './session-store-COrln4Ro.js';

/**
 * `@fxl-business/hub-sdk/server` — the server-side half a product installs instead of
 * hand-rolling a BFF + verifier.
 *
 *   createHubBff(config, opts)  → a Hono router exposing the OAuth client BFF:
 *     GET  /auth/login    → gen PKCE+state, stash server-side, 302 to Hub /authorize
 *     GET  /auth/callback → state-check → POST Hub /token (+ client_secret if set) → store refresh → set cookie → 302
 *     POST /auth/refresh  → cookie-auth → Hub /auth/refresh → fresh accessToken + rotate stored refresh
 *     POST /auth/switch   → cookie-auth → Hub /auth/switch (body: workspaceId + derived productId) → persist new active workspace + rotate stored refresh
 *     POST /auth/logout   → best-effort Hub logout → delete session → clear cookie → 204
 *
 *   requireHubAuth(config, opts) → a Hono middleware that verifies the incoming
 *     Hub access token via `@fxl-hub/hub-auth` (the ONE verifier — never
 *     reimplemented here), with the audience/issuer/jwksUri DISCOVERED from the
 *     Hub. Wraps `hubAuth(...)` exactly.
 *
 * SECURITY: PKCE S256 mandatory; the CSRF `state` is checked BEFORE any token
 * exchange; the PKCE verifier + Hub refresh token live SERVER-SIDE only (the
 * browser holds only an opaque session id, HttpOnly). The `secretKey`, the
 * authorization code, the verifier, and the refresh token are NEVER logged.
 */

/** Options for {@link createHubBff}. */
interface CreateHubBffOptions {
    /** Server-side session store. Defaults to an {@link InMemoryHubSessionStore}. */
    sessionStore?: HubSessionStore;
    /** Injectable fetch (tests stay offline). Defaults to the global `fetch`. */
    fetchImpl?: typeof fetch;
    /**
     * The exact registered redirect_uri sent to the Hub on /authorize and /token.
     * MUST match the Hub client registry byte-for-byte. Defaults to
     * `${config.apiUrl}/auth/callback` — set it when the BFF is mounted elsewhere.
     */
    redirectUri?: string;
    /** Where /auth/callback redirects the browser on success. Defaults to `/`. */
    postLoginRedirect?: string;
    /** Where /auth/callback redirects the browser on failure. Defaults to `/?error=auth`. */
    postLoginErrorRedirect?: string;
    /** Force the Secure cookie flag (default: `process.env.NODE_ENV === 'production'`). */
    secureCookies?: boolean;
    /** Injectable clock and bounded upstream timeout controls. */
    now?: () => number;
    timeoutMs?: number;
    sessionTtlSeconds?: number;
    sessionAbsoluteTtlSeconds?: number;
}
declare function createHubBff(config: HubSdkConfig, options?: CreateHubBffOptions): Hono;
/** Options for {@link requireHubAuth}. */
interface RequireHubAuthOptions {
    /** Explicit product audience override. Defaults to {@link deriveAudience}(config). */
    audience?: string;
    /** Injectable fetch for discovery (tests stay offline). Defaults to the global `fetch`. */
    fetchImpl?: typeof fetch;
}
/**
 * A Hono middleware that verifies the incoming Hub access token via the ONE
 * shared verifier (`@fxl-hub/hub-auth` `hubAuth`). The audience defaults to the
 * SDK-derived product audience; the issuer + JWKS URI are DISCOVERED from the
 * Hub on first use (cached per process).
 *
 * On any verification failure the wrapped `hubAuth` responds `401` fail-closed
 * and does not call `next()`. A discovery failure also fails closed (`503`).
 */
declare function requireHubAuth(config: HubSdkConfig, options?: RequireHubAuthOptions): MiddlewareHandler;

export { type CreateHubBffOptions, type RequireHubAuthOptions, createHubBff, requireHubAuth };
