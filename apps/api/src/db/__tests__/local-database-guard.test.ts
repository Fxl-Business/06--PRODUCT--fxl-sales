import { describe, expect, it } from 'vitest';
import {
  assertLocalDatabase,
  describeDatabaseTarget,
  isLocalDatabaseHost,
} from '../local-database-guard.js';

// This test connects to NOTHING: no postgres(), no docker, no network, no
// filesystem, and it reads no environment variable at all. Every input is a
// literal argument.
//
// The remote fixture is `db.example.invalid` - the RFC 6761 reserved `.invalid`
// TLD, which cannot resolve. A real remote host must never appear in a tracked
// file. Test credentials are the literal `u:p`.
const REMOTE_URL = 'postgresql://u:p@db.example.invalid:5432/fxl_sales';

// The four hosts that must pass, one row each. `hostLabel` is asserted against
// the expected roster below so this table can never go vacuously empty or short.
const localHostCases = [
  { hostLabel: 'localhost', url: 'postgresql://u:p@localhost:5006/fxl_sales' },
  { hostLabel: '127.0.0.1', url: 'postgresql://u:p@127.0.0.1:5006/fxl_sales' },
  { hostLabel: '::1', url: 'postgresql://u:p@[::1]:5006/fxl_sales' },
  { hostLabel: 'db', url: 'postgresql://u:p@db:5432/fxl_sales' },
] as const;

describe('local host roster', () => {
  it('covers exactly the four local hosts, and no more', () => {
    // The anti-vacuity assertion. An `it.each` over an accidentally emptied,
    // shortened or renamed table would pass silently; this pins the table's
    // exact contents and order.
    expect(localHostCases.map((c) => c.hostLabel)).toEqual(['localhost', '127.0.0.1', '::1', 'db']);
  });
});

describe('isLocalDatabaseHost', () => {
  it.each(localHostCases)('accepts the local host $hostLabel', ({ url }) => {
    expect(isLocalDatabaseHost(url)).toBe(true);
  });

  it('rejects a remote host', () => {
    expect(isLocalDatabaseHost(REMOTE_URL)).toBe(false);
  });

  it('rejects a host that only looks local', () => {
    // Pins EXACT matching. A suffix, prefix or `includes` implementation fails
    // both of these.
    expect(isLocalDatabaseHost('postgresql://u:p@localhost.db.example.invalid:5432/x')).toBe(false);
    expect(isLocalDatabaseHost('postgresql://u:p@notlocalhost:5432/x')).toBe(false);
  });

  it('returns false for a url that does not parse', () => {
    expect(isLocalDatabaseHost('not a url')).toBe(false);
  });

  it('returns false for an absent url', () => {
    expect(isLocalDatabaseHost(undefined)).toBe(false);
  });

  it('accepts the bracketed IPv6 loopback form that new URL() produces', () => {
    // `new URL('postgresql://u:p@[::1]:5432/x').hostname` yields '[::1]' WITH
    // the brackets. Without stripping them, `::1` - one of the four required
    // local hosts - would silently read as remote.
    expect(isLocalDatabaseHost('postgresql://u:p@[::1]:5432/x')).toBe(true);
  });
});

describe('describeDatabaseTarget', () => {
  it('reports host and port, defaulting an omitted port to 5432', () => {
    expect(describeDatabaseTarget('postgresql://u:p@localhost/x')).toEqual({
      host: 'localhost',
      port: '5432',
    });
  });

  it('unwraps the bracketed IPv6 host', () => {
    expect(describeDatabaseTarget('postgresql://u:p@[::1]:5006/x')).toEqual({
      host: '::1',
      port: '5006',
    });
  });
});

describe('assertLocalDatabase', () => {
  it.each(localHostCases)('does not violate for the local host $hostLabel', ({ url }) => {
    expect(
      assertLocalDatabase({ nodeEnv: 'development', databaseUrl: url, namedEnvFile: null }),
    ).toEqual([]);
  });

  it('does not violate for a remote host when a named env file is in play', () => {
    // A plain string literal: no file is created and no variable is set.
    expect(
      assertLocalDatabase({
        nodeEnv: 'development',
        databaseUrl: REMOTE_URL,
        namedEnvFile: '/abs/path/to/some.env',
      }),
    ).toEqual([]);
  });

  it('violates for a remote host with no named env file', () => {
    const violations = assertLocalDatabase({
      nodeEnv: 'development',
      databaseUrl: REMOTE_URL,
      namedEnvFile: null,
    });
    expect(violations.length).toBeGreaterThan(0);
  });

  it('names the host it found in the violation message', () => {
    const violations = assertLocalDatabase({
      nodeEnv: 'development',
      databaseUrl: REMOTE_URL,
      namedEnvFile: null,
    });
    expect(violations.join('\n')).toContain('db.example.invalid');
  });

  it('states the way out in the violation message', () => {
    const violations = assertLocalDatabase({
      nodeEnv: 'development',
      databaseUrl: REMOTE_URL,
      namedEnvFile: null,
    });
    expect(violations.join('\n')).toContain('make stg');
  });

  it('does not violate in production', () => {
    expect(
      assertLocalDatabase({ nodeEnv: 'production', databaseUrl: REMOTE_URL, namedEnvFile: null }),
    ).toEqual([]);
  });

  it('does not violate for a url that does not parse', () => {
    // The guard answers one question only - is the host local. An unparseable
    // URL belongs to the caller's own `DATABASE_URL is required` message, or to
    // the driver.
    expect(
      assertLocalDatabase({ nodeEnv: 'development', databaseUrl: 'not a url', namedEnvFile: null }),
    ).toEqual([]);
  });

  it('does not violate for an absent url', () => {
    expect(
      assertLocalDatabase({ nodeEnv: 'development', databaseUrl: undefined, namedEnvFile: null }),
    ).toEqual([]);
  });

  it('violates in the test environment too', () => {
    // Pins that the production exemption is an EQUALITY on 'production' and not
    // an inequality on 'development'.
    const violations = assertLocalDatabase({
      nodeEnv: 'test',
      databaseUrl: REMOTE_URL,
      namedEnvFile: null,
    });
    expect(violations.length).toBeGreaterThan(0);
  });
});
