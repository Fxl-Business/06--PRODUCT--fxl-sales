import { beforeEach, describe, expect, it } from 'vitest';

import {
  LOGIN_ATTEMPTS_KEY,
  LOGIN_ATTEMPT_WINDOW_MS,
  LOGOUT_INTENT_KEY,
  MAX_LOGIN_ATTEMPTS,
  RETURN_TO_KEY,
  captureReturnTo,
  clearLoginAttempts,
  clearLogoutIntent,
  consumeReturnTo,
  hasLogoutIntent,
  isLoginBlocked,
  markLogoutIntent,
  registerLoginAttempt,
  sanitizeReturnTo,
} from '../session-recovery';

type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

const ORIGIN = 'https://app.example';

function fakeStorage(initial: Record<string, string> = {}) {
  const map = new Map<string, string>(Object.entries(initial));
  const storage: StorageLike = {
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => {
      map.set(key, value);
    },
    removeItem: (key) => {
      map.delete(key);
    },
  };
  return { map, storage };
}

const throwingStorage: StorageLike = {
  getItem() {
    throw new Error('storage blocked');
  },
  setItem() {
    throw new Error('storage blocked');
  },
  removeItem() {
    throw new Error('storage blocked');
  },
};

/**
 * Hoisted to module scope so the invariant test below runs over exactly the same
 * corpus the enumerated tables do. An enumerated list only catches the inputs someone
 * thought of; the invariant catches the class.
 */
const ACCEPTED_RETURN_TO: Array<[string, string]> = [
  ['/cadastros/produtos', '/cadastros/produtos'],
  ['/cadastros/produtos?kind=service', '/cadastros/produtos?kind=service'],
  ['/cadastros/produtos?kind=service&x=1', '/cadastros/produtos?kind=service&x=1'],
  ['/meus-dados/comissoes', '/meus-dados/comissoes'],
  // The hash is dropped, not treated as a rejection.
  ['/produtos#frag', '/produtos'],
  // Benign dot-segment normalization still resolves and is still honoured. The guard
  // rejects what normalization PRODUCES, never the fact that it happened.
  ['/a/../cadastros', '/cadastros'],
];

const REJECTED_RETURN_TO: string[] = [
  'https://evil.example/',
  'http://app.example/cadastros',
  '//evil.example/x',
  '/\\evil.example',
  'javascript:alert(1)',
  '\t/ok',
  '',
  '/',
  '/auth/login',
  '/auth',
  `/${'a'.repeat(3000)}`,
  '/x y',
  /**
   * The dot-segment family. Every one of these passes the RAW structural checks - the
   * second character is `.`, and `new URL(value, origin)` resolves same-origin - yet
   * `url.pathname` normalizes to a protocol-relative `//evil.example`, because `/..`
   * pops nothing at the root and the WHATWG parser treats `\` as a path separator.
   * Returning that value is an open redirect the moment the consumer navigates with
   * anything other than the History API, which refuses off-origin on its own.
   */
  '/..//evil.example',
  '/./\\evil.example',
  '/..\\\\evil.example',
  '/../\\evil.example',
  '/..//user@evil.example/',
  '/.//evil.example',
  '/a/../..//evil.example',
];

describe('sanitizeReturnTo', () => {
  it.each(ACCEPTED_RETURN_TO)('accepts %j as %j', (value, expected) => {
    expect(sanitizeReturnTo(value, ORIGIN)).toBe(expected);
  });

  it.each(REJECTED_RETURN_TO)('rejects %j', (value) => {
    expect(sanitizeReturnTo(value, ORIGIN)).toBeNull();
  });

  it('rejects null and undefined', () => {
    expect(sanitizeReturnTo(null, ORIGIN)).toBeNull();
    expect(sanitizeReturnTo(undefined, ORIGIN)).toBeNull();
  });

  /**
   * The contract, asserted as a property rather than as a list: whatever comes back is
   * a same-origin relative path. Run over the rejection table too, because the failure
   * mode this exists to catch is precisely a value that was supposed to be rejected and
   * instead came back pointing somewhere else.
   */
  it('never returns a value that resolves off-origin', () => {
    const corpus = [...REJECTED_RETURN_TO, ...ACCEPTED_RETURN_TO.map(([value]) => value)];

    for (const value of corpus) {
      const result = sanitizeReturnTo(value, ORIGIN);
      if (result === null) continue;
      expect({ value, origin: new URL(result, ORIGIN).origin }).toEqual({
        value,
        origin: ORIGIN,
      });
      // The structural invariant the module docstring claims for the RETURNED string:
      // exactly one leading slash, and never the bare default route.
      expect({ value, result }).toEqual({ value, result: expect.stringMatching(/^\/[^/\\]/) });
    }
  });
});

describe('captureReturnTo / consumeReturnTo', () => {
  it('round-trips a captured path exactly once', () => {
    const { storage } = fakeStorage();
    captureReturnTo('/cadastros/produtos?f=1', ORIGIN, storage);

    expect(consumeReturnTo(ORIGIN, storage)).toBe('/cadastros/produtos?f=1');
    expect(consumeReturnTo(ORIGIN, storage)).toBeNull();
  });

  it('destroys a hostile stored value on the read that rejects it', () => {
    const { map, storage } = fakeStorage({ [RETURN_TO_KEY]: 'https://evil.example/' });

    expect(consumeReturnTo(ORIGIN, storage)).toBeNull();
    expect(map.has(RETURN_TO_KEY)).toBe(false);
  });

  it('writes nothing when the captured path is the default route', () => {
    const { map, storage } = fakeStorage();
    captureReturnTo('/', ORIGIN, storage);

    expect(map.has(RETURN_TO_KEY)).toBe(false);
  });

  it('writes nothing when the captured path is hostile', () => {
    const { map, storage } = fakeStorage();
    captureReturnTo('//evil.example/x', ORIGIN, storage);

    expect(map.has(RETURN_TO_KEY)).toBe(false);
  });

  it('degrades to no route restore when storage throws', () => {
    expect(() => captureReturnTo('/cadastros/produtos', ORIGIN, throwingStorage)).not.toThrow();
    expect(consumeReturnTo(ORIGIN, throwingStorage)).toBeNull();
  });
});

describe('registerLoginAttempt', () => {
  let storage: StorageLike;

  beforeEach(() => {
    ({ storage } = fakeStorage());
  });

  it('allows MAX_LOGIN_ATTEMPTS inside the window and blocks the next one', () => {
    const now = 1_000_000;
    for (let attempt = 1; attempt <= MAX_LOGIN_ATTEMPTS; attempt += 1) {
      expect(registerLoginAttempt(now + attempt, storage)).toBe(true);
    }
    expect(registerLoginAttempt(now + MAX_LOGIN_ATTEMPTS + 1, storage)).toBe(false);
    // The counter must not run away while blocked.
    expect(registerLoginAttempt(now + MAX_LOGIN_ATTEMPTS + 2, storage)).toBe(false);
    expect(JSON.parse(storage.getItem(LOGIN_ATTEMPTS_KEY) ?? 'null')).toMatchObject({
      count: MAX_LOGIN_ATTEMPTS,
    });
  });

  it('resets the counter once the window has elapsed', () => {
    const now = 1_000_000;
    for (let attempt = 1; attempt <= MAX_LOGIN_ATTEMPTS; attempt += 1) {
      registerLoginAttempt(now, storage);
    }
    expect(registerLoginAttempt(now, storage)).toBe(false);

    expect(registerLoginAttempt(now + LOGIN_ATTEMPT_WINDOW_MS + 1, storage)).toBe(true);
    expect(JSON.parse(storage.getItem(LOGIN_ATTEMPTS_KEY) ?? 'null')).toMatchObject({ count: 1 });
  });

  it('re-arms after clearLoginAttempts', () => {
    const now = 1_000_000;
    for (let attempt = 1; attempt <= MAX_LOGIN_ATTEMPTS; attempt += 1) {
      registerLoginAttempt(now, storage);
    }
    expect(registerLoginAttempt(now, storage)).toBe(false);

    clearLoginAttempts(storage);
    expect(registerLoginAttempt(now, storage)).toBe(true);
  });

  it('treats a corrupt stored value as absent', () => {
    const { storage: corrupt } = fakeStorage({ [LOGIN_ATTEMPTS_KEY]: '{' });
    expect(registerLoginAttempt(1_000_000, corrupt)).toBe(true);
  });

  it('fails open when storage throws', () => {
    expect(registerLoginAttempt(1_000_000, throwingStorage)).toBe(true);
    expect(() => clearLoginAttempts(throwingStorage)).not.toThrow();
  });
});

describe('isLoginBlocked', () => {
  /**
   * The panel is derived from this predicate while the counter is written by
   * `registerLoginAttempt`. If the two ever disagreed, a user would either see a dead
   * end while logins were still allowed, or keep bouncing while the guard claimed to
   * have stopped them. Assert they agree at every step instead of assuming it.
   */
  it('answers exactly what registerLoginAttempt is about to answer', () => {
    const { storage } = fakeStorage();
    const now = 1_000_000;

    for (let attempt = 1; attempt <= MAX_LOGIN_ATTEMPTS + 2; attempt += 1) {
      const blocked = isLoginBlocked(now, storage);
      expect(registerLoginAttempt(now, storage)).toBe(!blocked);
    }
    expect(isLoginBlocked(now, storage)).toBe(true);
    expect(isLoginBlocked(now + LOGIN_ATTEMPT_WINDOW_MS + 1, storage)).toBe(false);

    clearLoginAttempts(storage);
    expect(isLoginBlocked(now, storage)).toBe(false);
  });

  it('is false for an empty, corrupt or unreadable storage', () => {
    expect(isLoginBlocked(1_000_000, fakeStorage().storage)).toBe(false);
    expect(isLoginBlocked(1_000_000, fakeStorage({ [LOGIN_ATTEMPTS_KEY]: '{' }).storage)).toBe(
      false,
    );
    expect(isLoginBlocked(1_000_000, throwingStorage)).toBe(false);
  });
});

/**
 * Every assertion in here points the same way: the intent's whole job is to SUPPRESS the
 * automatic login, so every ambiguous case must read as "no intent". An over-broad read
 * or a fail-closed read is a lockout; a narrow, fail-open one is only a return to the
 * behaviour that shipped before it.
 */
describe('logout intent', () => {
  it('records an intent that reads back', () => {
    const { map, storage } = fakeStorage();
    markLogoutIntent(storage);

    expect(hasLogoutIntent(storage)).toBe(true);
    expect(map.get(LOGOUT_INTENT_KEY)).toBe('1');
  });

  it('reports no intent for an empty storage', () => {
    expect(hasLogoutIntent(fakeStorage().storage)).toBe(false);
  });

  it('clears the intent, so a fresh login is never blocked', () => {
    const { map, storage } = fakeStorage();
    markLogoutIntent(storage);
    clearLogoutIntent(storage);

    expect(hasLogoutIntent(storage)).toBe(false);
    expect(map.has(LOGOUT_INTENT_KEY)).toBe(false);
  });

  it('fails open when storage throws, in both directions', () => {
    expect(() => markLogoutIntent(throwingStorage)).not.toThrow();
    expect(hasLogoutIntent(throwingStorage)).toBe(false);
    expect(() => clearLogoutIntent(throwingStorage)).not.toThrow();
  });

  /**
   * The exact-sentinel pin. Anything this module did not itself write reads as "no
   * intent", so a stray, corrupt or hand-set value cannot put a tab into a state where
   * no automatic login ever fires.
   */
  it.each(['', '0', 'true', '"1"', '{}', ' 1', '1 ', '01'])(
    'ignores the value %j, which it did not write',
    (value) => {
      expect(hasLogoutIntent(fakeStorage({ [LOGOUT_INTENT_KEY]: value }).storage)).toBe(false);
    },
  );
});
