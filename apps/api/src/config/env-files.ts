import { accessSync, constants } from 'node:fs';
import { resolve } from 'node:path';
import { config } from 'dotenv';

/**
 * The ONE env-file loader for apps/api, and the reason there is only one.
 *
 * `src/env.ts` loaded `.env` then `.env.local`; `src/db/migrate.ts` did a bare
 * `import 'dotenv/config'`, which reads `.env` from the CWD, ignores
 * `.env.local` and never sees this module's ordering at all. Two loaders is how
 * the entrypoint that applies DDL ended up with the weaker one. Both entrypoints
 * now come through here, so the two cannot diverge again.
 *
 * NOTHING in this module reads `process.env`. `baseDir` and `bag` are both
 * required parameters, which is what lets the unit test drive every branch by
 * passing values IN rather than by mutating the ambient environment - and
 * SALES_ENV_FILE is a name that must never be set by anything but a human
 * typing it in front of a command.
 */

/**
 * `apps/api`, resolved identically in dev and in prod.
 *
 * `../..` and not `../`: this file is `src/config/env-files.ts` in dev and
 * `dist/config/env-files.js` in prod, and `tsconfig.json`'s rootDir `./src` /
 * outDir `./dist` make `dist/` mirror `src/` directory-for-directory, so BOTH
 * sit exactly two directories below `apps/api`. `env.ts` used to compute this
 * itself with `..` from one level up; it no longer does, so this constant is the
 * single place in the tree that knows the depth.
 */
export const API_ROOT_DIR = resolve(import.meta.dirname, '../..');

/**
 * The operator's opt-in. Mirrors the Hub's `HUB_ENV_FILE`; one name per
 * repository, no alias.
 */
export const NAMED_ENV_FILE_VAR = 'SALES_ENV_FILE';

/** An injectable environment bag. `process.env` satisfies it. */
export type EnvBag = Record<string, string | undefined>;

export interface LoadEnvFilesOptions {
  /** Directory the `.env*` names resolve against. Pass `API_ROOT_DIR`. */
  baseDir: string;
  /** Where `SALES_ENV_FILE` is read FROM. Never `process.env` implicitly. */
  bag: EnvBag;
}

export interface LoadedEnvFiles {
  /**
   * The ABSOLUTE path of the file loaded by name, or null when
   * `SALES_ENV_FILE` was unset or empty.
   *
   * Slice 02's database guard consumes exactly this: a remote DATABASE_URL is
   * admissible only when a named file is what put it there.
   */
  namedEnvFile: string | null;
}

/**
 * Pure path resolution, no I/O. Absent or blank is null; a RELATIVE value
 * resolves against `baseDir`; an ABSOLUTE value passes through unchanged
 * (`resolve` already has both semantics, which is why there is no `isAbsolute`
 * branch here).
 */
export function resolveNamedEnvFilePath(bag: EnvBag, baseDir: string): string | null {
  const raw = bag[NAMED_ENV_FILE_VAR]?.trim();
  if (raw === undefined || raw === '') return null;
  return resolve(baseDir, raw);
}

/**
 * Loads `.env`, then `.env.local` with override, then - only when the operator
 * named one - that file LAST, with override, so it wins over both.
 *
 * READABILITY IS CHECKED BEFORE ANYTHING IS LOADED, deliberately. The refusal
 * has to happen with `process.env` untouched: a half-loaded default environment
 * plus a crash is worse to reason about than a crash, and the whole point of
 * this throw is that an operator who asked for another environment must never be
 * quietly handed the LOCAL one.
 */
export function loadEnvFiles({ baseDir, bag }: LoadEnvFilesOptions): LoadedEnvFiles {
  const namedEnvFile = resolveNamedEnvFilePath(bag, baseDir);

  if (namedEnvFile !== null) assertReadable(namedEnvFile);

  config({ path: resolve(baseDir, '.env') });
  config({ path: resolve(baseDir, '.env.local'), override: true });

  if (namedEnvFile === null) return { namedEnvFile: null };

  const result = config({ path: namedEnvFile, override: true });
  if (result.error) throw namedEnvFileRefusal(namedEnvFile);

  // ONE line, naming the file and nothing else. Never its contents: the file
  // this exists for holds a live credential.
  console.log(`[env] named env file loaded: ${namedEnvFile}`);

  return { namedEnvFile };
}

function assertReadable(path: string): void {
  try {
    accessSync(path, constants.R_OK);
  } catch {
    throw namedEnvFileRefusal(path);
  }
}

function namedEnvFileRefusal(path: string): Error {
  return new Error(
    `${NAMED_ENV_FILE_VAR} names ${path}, which cannot be read. ` +
      'Refusing to continue, deliberately: falling back to the default environment would run ' +
      'against the LOCAL database while you believe you asked for another one. ' +
      `Create the file, fix the path, or unset ${NAMED_ENV_FILE_VAR}.`,
  );
}
