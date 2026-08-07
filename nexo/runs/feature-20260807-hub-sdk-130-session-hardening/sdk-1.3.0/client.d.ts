import { H as HubSdkConfig } from './config-CvYwarJp.js';

/**
 * `@fxl-business/hub-sdk/client` — the browser-side half a product installs.
 *
 * DOM-light (no React dependency). It drives the SDK's own BFF (`/auth/login`,
 * `/auth/refresh`, `/auth/logout`) and builds the Hub web deep-links for
 * checkout + subscription management. The browser NEVER holds a refresh token —
 * it bounces through the BFF, which holds the refresh server-side.
 */

/** Options for {@link createHubClient}. */
interface CreateHubClientOptions {
    /**
     * The base path of the SDK BFF this client talks to (where `createHubBff`'s
     * router is mounted). Defaults to `''` (the BFF lives at the app origin root,
     * i.e. `/auth/login`).
     */
    bffBasePath?: string;
    /** Injectable fetch (tests). Defaults to the global `fetch` with credentials. */
    fetchImpl?: typeof fetch;
    /** Injectable navigation seam (tests). Defaults to `window.location.assign`. */
    navigate?: (url: string) => void;
}
/** The result of a successful {@link HubClient.setActive} workspace switch. */
interface SetActiveResult {
    /** A fresh access token already minted for the NEW workspace. */
    accessToken: string;
    /** Access-token lifetime in seconds. */
    expiresIn: number;
    /** The now-active workspace id, echoed by the Hub. */
    workspaceId: string;
}
/** The browser client surface. */
interface HubClient {
    /** Redirect the browser to the BFF `/auth/login` (which 302s to the Hub). */
    login(): void;
    /** POST the BFF `/auth/refresh`; returns the fresh access token (or null on failure). */
    getToken(): Promise<string | null>;
    /**
     * POST the BFF `/auth/switch`, persisting the new active workspace on THIS
     * product's Hub session (per-app active org). Returns a fresh access token
     * for the new workspace; every subsequent {@link getToken} mints for it too
     * (the client holds no token cache — the BFF re-mints per call).
     * Throws on failure (403 non-member, dead session, network).
     */
    setActive(workspaceId: string): Promise<SetActiveResult>;
    /** POST the BFF `/auth/logout`, clearing the server-side session + cookie. */
    logout(): Promise<void>;
    /** Build the Hub checkout deep-link for this product (optionally pre-selecting a SKU). */
    checkoutUrl(sku?: string): Promise<string>;
    /** Build the Hub manage deep-link for this product's active subscription. */
    manageUrl(): Promise<string>;
}
/**
 * Create a browser Hub client. All deep-link builders DISCOVER the Hub web
 * origin (`fxl_web_url`) and the product audience once, then cache per process.
 */
declare function createHubClient(config: HubSdkConfig, options?: CreateHubClientOptions): HubClient;

export { type CreateHubClientOptions, type HubClient, type SetActiveResult, createHubClient };
