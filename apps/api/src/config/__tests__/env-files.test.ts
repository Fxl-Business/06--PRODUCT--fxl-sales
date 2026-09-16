/**
 * The resolution oracle for SALES_ENV_FILE.
 *
 * Every case here passes the bag IN. Nothing in this file writes
 * SALES_ENV_FILE into `process.env`, not even via `vi.stubEnv`: the name is an
 * operator opt-in typed once in front of a command, and a test that exported it
 * would be the first place it leaked.
 *
 * `baseDir` is this very directory in the cases that touch the disk, so the
 * `.env` / `.env.local` reads inside `loadEnvFiles` are guaranteed no-ops and
 * the test can never inherit `apps/api/.env`.
 */
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { API_ROOT_DIR, loadEnvFiles, resolveNamedEnvFilePath } from '../env-files.js';

const HERE = import.meta.dirname;

/**
 * The installed dotenv (v17) prints an "injected env ... // tip:" line of its
 * own through `console.log` on every `config()` call, and it has done so on
 * every boot since long before this module existed. So the oracle below is
 * "how many lines did THIS module print", not "how many lines reached the
 * stream" - counting raw calls would grade dotenv's banner rather than the one
 * line that names the operator's file.
 */
const envLines = (log: { mock: { calls: unknown[][] } }): unknown[] =>
  log.mock.calls
    .map((call) => call[0])
    .filter((first) => typeof first === 'string' && first.startsWith('[env]'));

afterEach(() => {
  delete process.env.SALES_ENV_FILE_FIXTURE_MARKER;
  vi.restoreAllMocks();
});

describe('resolveNamedEnvFilePath', () => {
  it('returns null when the named env file variable is absent from the bag', () => {
    expect(resolveNamedEnvFilePath({}, HERE)).toBeNull();
  });

  it('returns null when the named env file variable is present but empty', () => {
    expect(resolveNamedEnvFilePath({ SALES_ENV_FILE: '' }, HERE)).toBeNull();
    expect(resolveNamedEnvFilePath({ SALES_ENV_FILE: '   ' }, HERE)).toBeNull();
  });

  it('resolves a RELATIVE value against baseDir', () => {
    expect(resolveNamedEnvFilePath({ SALES_ENV_FILE: '.env.staging' }, '/srv/apps/api')).toBe(
      '/srv/apps/api/.env.staging',
    );
  });

  it('passes an ABSOLUTE value through unchanged', () => {
    expect(resolveNamedEnvFilePath({ SALES_ENV_FILE: '/etc/fxl/sales.env' }, '/srv/apps/api')).toBe(
      '/etc/fxl/sales.env',
    );
  });

  it('points at apps/api when handed API_ROOT_DIR, in this tree and in dist', () => {
    // The depth check. `src/config/env-files.ts` and `dist/config/env-files.js`
    // are both two directories below apps/api, so `../..` is the only correct
    // expression - and copying env.ts's `..` across would silently resolve to
    // apps/api/src.
    expect(API_ROOT_DIR).toBe(resolve(HERE, '../../..'));
  });
});

describe('loadEnvFiles', () => {
  it('THROWS, naming the resolved path, when the named file cannot be read', () => {
    const missing = resolve(HERE, 'fixtures/there-is-no-such-file.fixture');

    expect(() =>
      loadEnvFiles({
        baseDir: HERE,
        bag: { SALES_ENV_FILE: 'fixtures/there-is-no-such-file.fixture' },
      }),
    ).toThrow(missing);
  });

  it('never falls back to the default environment when the named file is unreadable', () => {
    // The property the throw exists for, stated as behaviour. A fallback here is
    // an operator who asked for staging and got the LOCAL database with nothing
    // on screen saying so.
    expect(() =>
      loadEnvFiles({ baseDir: HERE, bag: { SALES_ENV_FILE: 'fixtures/nope.fixture' } }),
    ).toThrow(/deliberately/i);
  });

  it('returns a null namedEnvFile and prints nothing when no file was named', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);

    expect(loadEnvFiles({ baseDir: HERE, bag: {} })).toEqual({ namedEnvFile: null });
    expect(envLines(log)).toEqual([]);
  });

  it('loads the named file LAST and prints ONE line naming it', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const named = resolve(HERE, 'fixtures/named-env-file.fixture');

    const result = loadEnvFiles({
      baseDir: HERE,
      bag: { SALES_ENV_FILE: 'fixtures/named-env-file.fixture' },
    });

    expect(result.namedEnvFile).toBe(named);
    expect(process.env.SALES_ENV_FILE_FIXTURE_MARKER).toBe('loaded');
    expect(envLines(log)).toEqual([`[env] named env file loaded: ${named}`]);
  });
});
