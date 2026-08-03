/**
 * Everything that has to survive the `/auth/login` -> `/auth/callback` round trip.
 *
 * Pure module: no React, no SDK, no DOM required. A full-page navigation destroys
 * every byte of React state, so the two facts that must outlive it - "where was the
 * operator" and "how many times have we already tried this" - live here, in
 * `sessionStorage`, behind functions that are unit-testable against a `Map`.
 *
 * Why `sessionStorage` and not `localStorage`, a cookie or the URL fragment:
 * it survives the navigation, it is scoped to the tab (a route captured in tab A
 * cannot hijack a login in tab B), it dies with the tab (no week-old route), and it
 * is never sent to the server (it cannot influence the server-side redirect and
 * cannot leak the operator's route into API logs). The login and callback redirects
 * are both server-controlled, so nothing written into the URL survives the trip.
 *
 * Nothing stored here is a token, a claim or an id - only a relative path and a
 * counter - so CLAUDE.md's "browser Hub access tokens are memory-only" is untouched.
 */

export const RETURN_TO_KEY = 'fxl-sales.auth.returnTo';
export const LOGIN_ATTEMPTS_KEY = 'fxl-sales.auth.loginAttempts';
export const LOGIN_ATTEMPT_WINDOW_MS = 60_000;
export const MAX_LOGIN_ATTEMPTS = 3;

const MAX_RETURN_TO_LENGTH = 2048;

/**
 * Control characters and any whitespace. Both are smuggling vectors, neither belongs in
 * a route. Written as a code-point scan rather than a character class because a literal
 * control character inside a pattern trips ESLint's `no-control-regex`, and working
 * around that rule reads worse than the loop.
 */
function hasUnsafeReturnToChars(value: string): boolean {
  if (/\s/.test(value)) return true;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code < 0x20 || code === 0x7f) return true;
  }
  return false;
}

export type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

/**
 * Safari private mode and hardened enterprise profiles can make even *touching*
 * `sessionStorage` throw. A storage failure must be indistinguishable from an empty
 * storage: it degrades to "no route restore", never to a broken login.
 */
function defaultStorage(): StorageLike | null {
  try {
    const storage = (globalThis as { sessionStorage?: StorageLike }).sessionStorage;
    return storage ?? null;
  } catch {
    return null;
  }
}

function readItem(storage: StorageLike | null, key: string): string | null {
  if (!storage) return null;
  try {
    return storage.getItem(key);
  } catch {
    return null;
  }
}

function writeItem(storage: StorageLike | null, key: string, value: string): void {
  if (!storage) return;
  try {
    storage.setItem(key, value);
  } catch {
    // A browser that refuses to store must not break authentication.
  }
}

function dropItem(storage: StorageLike | null, key: string): void {
  if (!storage) return;
  try {
    storage.removeItem(key);
  } catch {
    // Same as above: an unwritable storage is an empty storage.
  }
}

/**
 * The open-redirect guard. A value is honoured only as a same-origin RELATIVE path.
 *
 * 1. non-empty string, at most `MAX_RETURN_TO_LENGTH` characters;
 * 2. no ASCII control characters and no whitespace;
 * 3. first character is `/`;
 * 4. second character is neither `/` nor `\`, which kills `//evil.example/x` and
 *    `/\evil.example` (browsers normalize the backslash to a slash);
 * 5. `new URL(value, origin)` parses and resolves back to `origin` - the backstop
 *    behind the character checks, because `URL` normalizes backslashes and
 *    percent-encodings that could otherwise slip past them;
 * 6. the path is not `/auth` nor under `/auth/`; those are proxied to the API BFF and
 *    restoring one would bounce the operator straight back into the login flow;
 * 7. the NORMALIZED result passes check 4 again, because normalization can manufacture
 *    a prefix the raw input never had: `/..//evil.example` has `.` as its second
 *    character, so it walks past check 4, and resolves same-origin, so it walks past
 *    check 5 - yet `url.pathname` is `//evil.example`, since `/..` pops nothing at the
 *    root. Checks 3-4 validate the RAW string and check 5 validates the PARSED url,
 *    but what leaves this function is the normalized path, so the normalized path is
 *    what has to be validated;
 * 8. the normalized result is not `/`, the default landing route - nothing to restore.
 *
 * An absolute URL is rejected even when it is same-origin: "only ever a same-origin
 * relative path" is far easier to keep true than "an absolute URL that happens to match".
 * The hash is dropped rather than rejected - no app route uses it.
 */
export function sanitizeReturnTo(
  value: string | null | undefined,
  origin: string,
): string | null {
  if (typeof value !== 'string') return null;
  if (value.length === 0 || value.length > MAX_RETURN_TO_LENGTH) return null;
  if (hasUnsafeReturnToChars(value)) return null;
  if (value[0] !== '/') return null;
  if (value[1] === '/' || value[1] === '\\') return null;

  let url: URL;
  try {
    url = new URL(value, origin);
  } catch {
    return null;
  }
  if (url.origin !== origin) return null;
  if (url.pathname === '/auth' || url.pathname.startsWith('/auth/')) return null;

  const normalized = `${url.pathname}${url.search}`;
  // The invariant is on the RETURNED string, so re-assert it on the value being
  // returned rather than trusting the raw check above to still describe it.
  if (normalized[0] !== '/') return null;
  if (normalized[1] === '/' || normalized[1] === '\\') return null;
  return normalized === '/' ? null : normalized;
}

/** Sanitizes on WRITE too - defence in depth; the read side is the security-critical one. */
export function captureReturnTo(
  path: string,
  origin: string,
  storage: StorageLike | null = defaultStorage(),
): void {
  const safe = sanitizeReturnTo(path, origin);
  if (safe === null) return;
  writeItem(storage, RETURN_TO_KEY, safe);
}

/**
 * Consumes exactly once. The `removeItem` happens BEFORE the value is validated, so a
 * hostile or malformed value is destroyed on the same read that rejects it and a throw
 * anywhere downstream cannot replay the restore.
 */
export function consumeReturnTo(
  origin: string,
  storage: StorageLike | null = defaultStorage(),
): string | null {
  const raw = readItem(storage, RETURN_TO_KEY);
  dropItem(storage, RETURN_TO_KEY);
  return sanitizeReturnTo(raw, origin);
}

type LoginAttempts = { count: number; firstAt: number };

function readLoginAttempts(storage: StorageLike | null): LoginAttempts | null {
  const raw = readItem(storage, LOGIN_ATTEMPTS_KEY);
  if (raw === null) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return null;
    const { count, firstAt } = parsed as { count?: unknown; firstAt?: unknown };
    if (typeof count !== 'number' || !Number.isFinite(count)) return null;
    if (typeof firstAt !== 'number' || !Number.isFinite(firstAt)) return null;
    return { count, firstAt };
  } catch {
    return null;
  }
}

/**
 * The read-only half of the loop guard: would `registerLoginAttempt` refuse right now?
 *
 * It exists so the terminal recovery panel is DERIVED from the stored counter rather
 * than mirrored into a React boolean that can drift from it. `registerLoginAttempt` is
 * the only writer; this is the only reader; they share `readLoginAttempts` and the same
 * two conditions, so the two cannot disagree.
 */
export function isLoginBlocked(
  now: number = Date.now(),
  storage: StorageLike | null = defaultStorage(),
): boolean {
  const current = readLoginAttempts(storage);
  if (current === null) return false;
  if (now - current.firstAt > LOGIN_ATTEMPT_WINDOW_MS) return false;
  return current.count >= MAX_LOGIN_ATTEMPTS;
}

/**
 * The anti-redirect-loop guard. A replica that does not hold the session can produce a
 * genuine infinite loop - sign out, login, callback, refresh fails, sign out - so the
 * number of automatic re-logins per tab is capped.
 *
 * Returns `false` once `MAX_LOGIN_ATTEMPTS` have been recorded inside
 * `LOGIN_ATTEMPT_WINDOW_MS`, and does NOT increment while blocked so the counter cannot
 * run away. A storage that cannot be read or written fails OPEN (returns `true`):
 * refusing to log a user in because their browser blocks storage would be a worse bug
 * than the loop this prevents.
 */
export function registerLoginAttempt(
  now: number = Date.now(),
  storage: StorageLike | null = defaultStorage(),
): boolean {
  const current = readLoginAttempts(storage);
  if (current === null || now - current.firstAt > LOGIN_ATTEMPT_WINDOW_MS) {
    writeItem(storage, LOGIN_ATTEMPTS_KEY, JSON.stringify({ count: 1, firstAt: now }));
    return true;
  }
  if (current.count >= MAX_LOGIN_ATTEMPTS) return false;
  writeItem(
    storage,
    LOGIN_ATTEMPTS_KEY,
    JSON.stringify({ count: current.count + 1, firstAt: current.firstAt }),
  );
  return true;
}

export function clearLoginAttempts(storage: StorageLike | null = defaultStorage()): void {
  dropItem(storage, LOGIN_ATTEMPTS_KEY);
}
