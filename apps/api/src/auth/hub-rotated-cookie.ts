/**
 * The rotated-session-cookie shim in front of the Hub BFF's BACKCHANNEL fetch.
 *
 * Sibling of `hub-bff-origin.ts`, and the same pattern for the same reason: a
 * small, reversible correction wrapped around the SDK, fully inside this
 * application, instead of a patched dependency. Read that file first if this one
 * is new to you.
 *
 * WHAT BREAKS WITHOUT IT
 *
 * On every successful `POST /auth/refresh` and `POST /auth/switch` the Hub
 * rotates the session's refresh token and returns the new one in a `Set-Cookie`
 * RESPONSE header. `@fxl-business/hub-sdk@1.3.1` recovers it with exactly one
 * expression, at `dist/server.js:463` and again at `518`:
 *
 *   const rotated = parseRotatedRefresh(res.headers.get("set-cookie"));
 *   if (rotated) await tx.update({ ...record, hubRefreshToken: rotated });
 *
 * and `parseRotatedRefresh` (`dist/server.js:299`) is
 *
 *   /(?:^|[,\s])fxl_hub_session=([^;]+)/
 *
 * When the Hub runs with `NODE_ENV=production` it names that cookie
 * `__Host-fxl_hub_session`. The character before the name is then `-`, which is
 * neither `^` nor `[,\s]`, so the regex misses, `rotated` is `undefined`,
 * `tx.update` is never called, and Postgres keeps the refresh token that was
 * just spent. The BFF still answers 200, so the loss is completely silent.
 *
 * The Hub forgives one stale generation for 60 seconds. The BFF then replays the
 * same original token on every cycle, so the second replay trips
 * `reuse_detected` and the Hub revokes the whole token family. Against a 120s
 * access token renewed at `exp - 60s`, that is one dead session every one to
 * three minutes, for every user, measured on 2026-08-12. See
 * `nexo/runs/feature-20260812-session-survives-one-refresh/evidence.md`.
 *
 * Locally the Hub sends the unprefixed name and the SDK's regex matches, which
 * is exactly why three rounds of browser-side fixes never touched this.
 *
 * WHAT THIS DOES
 *
 * It wraps the `fetchImpl` the BFF uses to call the Hub, and rewrites only the
 * NAME of a `__Host-fxl_hub_session` response cookie back to `fxl_hub_session`
 * before the SDK reads the header. The value, the attributes, every other
 * cookie, the status, the body and every other header are untouched.
 *
 * BACKCHANNEL, NOT BROWSER. DO NOT MERGE THIS WITH `secureCookies`.
 *
 * Two different cookies share these two names and they travel in opposite
 * directions:
 *
 *   - the BROWSER cookie the BFF sets on its OWN response. Its name is chosen by
 *     `secureCookies` in `app-auth.ts` and is `__Host-` prefixed in production.
 *     It carries a session ID, never a refresh token. This module never sees it
 *     and must never touch it: stripping that prefix on the browser side would
 *     drop a real security attribute.
 *   - the HUB cookie on the response to the BFF's own OUTBOUND call. It carries
 *     the rotated REFRESH TOKEN, it never reaches a browser, and it is the only
 *     thing rewritten here.
 *
 * The request the SDK sends the Hub already uses the unprefixed name in both
 * modes (`BACKCHANNEL_COOKIE_NAME = SESSION_COOKIE`, `dist/server.js:278`), so
 * the asymmetry corrected here is entirely on the response.
 *
 * WHY NOT A pnpm PATCH
 *
 * `patchedDependencies` was deleted from this workspace once already and must
 * not come back: a patch is invisible at the call site, silently re-applies to
 * an unrelated future version, and cannot be tested by anything in `src/`.
 * `fetchImpl` is a documented SDK option (`dist/server.d.ts:32`), so this is a
 * supported seam rather than a workaround.
 *
 * WHY THE RESPONSE IS REBUILT RATHER THAN MUTATED
 *
 * Headers on a `Response` produced by `fetch` are guarded immutable, so
 * `headers.set` throws. The response is therefore rebuilt with a copied, mutable
 * `Headers`, exactly as `hub-bff-origin.ts` rebuilds the REQUEST for the same
 * class of reason. The body is MOVED, not buffered: this wrapper never reads it,
 * the SDK consumes the returned response exactly once with `res.json()`, and
 * buffering would add a full body read inside the row-lock transaction and
 * inside the 5s `timeoutMs` budget for no gain. A null-body status carries
 * `res.body === null` already, but the explicit guard below keeps a future 204
 * from throwing in the `Response` constructor. The rebuild drops `res.url`,
 * `res.redirected` and `res.type`; the SDK reads none of them, and it only
 * happens on the rewrite path.
 *
 * WHY THERE IS NO SILENT FALLBACK
 *
 * An earlier sketch of this module read
 * `typeof res.headers.getSetCookie === 'function' ? res.headers.getSetCookie() : []`.
 * That is the one shape this module may never have: on a runtime without
 * `getSetCookie` it yields an empty list, the wrapper returns the response
 * untouched, and the exact silent write loss this file exists to eliminate comes
 * back with a green test suite. Degrading quietly into the defect is worse than
 * failing. So a missing `getSetCookie` is treated as a programming error:
 * `assertSetCookieSupport()` runs once at module load and stops the process
 * before any traffic, and the per-response check throws. A throw out of the
 * wrapper is caught by the SDK's own `try/catch` around `fetchImpl` and becomes
 * `503 refresh_unavailable` with the stored session untouched, which the web
 * ladder reads as transient. That is loud and recoverable; a stale token
 * answered 200 is neither. The assertion is unreachable in every environment
 * this ships to (Node 20 floor in root `package.json` `engines` and in
 * `apps/api/Dockerfile`), and it is reachable in a test only because it takes
 * its probe as an argument.
 *
 * WHY IT STAYS CORRECT IF THE SDK IS EVER FIXED
 *
 * The upstream fix filed in `nexo/ROADMAP.md` makes `parseRotatedRefresh` accept
 * `(?:__Host-)?fxl_hub_session=`. A name this wrapper has already rewritten
 * still matches that regex, and the VALUE is what the SDK uses, so the outcome
 * is identical with or without the shim. Iterating `getSetCookie()` upstream
 * would also be fine: the same cookies come back in the same order, with one
 * name differing. When the fixed SDK lands, the non-vacuity test named
 * `proves the rotation is genuinely lost without the wrapper` goes RED, and that
 * is the signal that this module can be deleted.
 */

/** The name `parseRotatedRefresh` is hard-coded to. No regex metacharacters, so no escaping. */
const ROTATED_COOKIE = 'fxl_hub_session';

/**
 * Anchored and exact, so only the one production name is rewritten.
 * `__Secure-fxl_hub_session=`, `__Host-fxl_hub_session_v2=`, `x__Host-fxl_hub_session=`
 * and `fxl_hub_login=` all miss, deliberately.
 */
const PREFIXED_ROTATED_COOKIE = new RegExp(`^__Host-${ROTATED_COOKIE}=`);

const UNPREFIXED_ASSIGNMENT = `${ROTATED_COOKIE}=`;

/** `new Response(body, { status })` throws for these unless the body is null. */
const NULL_BODY_STATUS = new Set([101, 103, 204, 205, 304]);

/**
 * Loud at load time rather than silent at request time. See the header: an empty
 * list on a runtime without `getSetCookie` would reinstate the defect invisibly.
 * The probe is a parameter purely so the failure branch is testable.
 */
export function assertSetCookieSupport(probe: { getSetCookie?: unknown } = Headers.prototype): void {
  if (typeof probe.getSetCookie !== 'function') {
    throw new Error(
      'hub-rotated-cookie: this runtime has no Headers.prototype.getSetCookie, so a rotated Hub session cookie cannot be read per cookie. Node 20 or newer is required (root package.json engines, apps/api/Dockerfile node:20-alpine).',
    );
  }
}

assertSetCookieSupport();

function readSetCookies(res: Response): string[] {
  const headers: { getSetCookie?: unknown } = res.headers;
  if (typeof headers.getSetCookie !== 'function') {
    throw new Error(
      'hub-rotated-cookie: the Hub response carried a Headers without getSetCookie. Refusing to guess, because guessing here means silently losing a rotated refresh token.',
    );
  }
  return res.headers.getSetCookie();
}

/**
 * Wraps a fetch so the SDK's rotation parser can see a `__Host-` prefixed Hub
 * session cookie. Pass nothing to wrap the ambient global fetch, which is also
 * what `createHubBff` itself defaults to (`dist/server.js:317`).
 */
export function createHubRotatedCookieFetch(inner?: typeof fetch): typeof fetch {
  return async (input, init) => {
    // Resolved per call, never captured: `const f = inner ?? fetch` at
    // construction time would freeze whatever global fetch existed then, which
    // both hides a runtime `fetch` swap and makes the wiring untestable.
    const res = inner ? await inner(input, init) : await globalThis.fetch(input, init);

    const cookies = readSetCookies(res);
    let changed = false;
    const rewritten = cookies.map((cookie) => {
      const next = cookie.replace(PREFIXED_ROTATED_COOKIE, UNPREFIXED_ASSIGNMENT);
      if (next !== cookie) changed = true;
      return next;
    });
    // The common path, including every dev-mode response and every response with
    // no Set-Cookie at all: the ORIGINAL object goes back, with no Headers copy,
    // no Response allocation and no observable difference of any kind.
    if (!changed) return res;

    const headers = new Headers(res.headers);
    headers.delete('set-cookie');
    for (const cookie of rewritten) headers.append('set-cookie', cookie);

    return new Response(NULL_BODY_STATUS.has(res.status) ? null : res.body, {
      status: res.status,
      statusText: res.statusText,
      headers,
    });
  };
}
