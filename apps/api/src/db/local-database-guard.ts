/**
 * The local-database guard.
 *
 * PURE by construction: it imports nothing, performs no I/O, and NEVER reads
 * `process.env`. Every input arrives as an argument. That is what lets the unit
 * test cover it without a database, a file, or an ambient environment, and what
 * keeps it safe to import from `env.ts`-adjacent code without making the test
 * suite environment-dependent.
 *
 * Why it exists: on 2026-09-16 `apps/api/.env` carried an ACTIVE DATABASE_URL
 * pointing at a remote staging host. `make migrate` and `make db-reset` applied
 * DDL there, with nothing on screen naming the host. `db/migrate.ts` reads
 * `process.env.DATABASE_URL` raw and never passes through `env.ts`, so a check
 * living in the zod schema would have missed exactly the path that applies DDL.
 *
 * The ONLY escape hatch is the named env file (SALES_ENV_FILE, resolved by the
 * shared resolver in `config/env-files.ts`). There is deliberately no
 * ALLOW_REMOTE and no CLI flag: two exits for one rule is divergence.
 */

/**
 * The complete set of hosts that need no opt-in.
 *
 * `db` is the docker compose service name and MUST pass - inside the compose
 * network that is what the API resolves the database as.
 *
 * Matching is EXACT. No suffix matching, no wildcard, no regex: `evil-localhost`
 * and `localhost.attacker.example` are not local.
 */
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', 'db']);

/**
 * The parsed host and port of a database URL, or `null` when the URL is absent
 * or does not parse.
 *
 * `new URL('postgresql://u:p@[::1]:5432/x').hostname` yields `'[::1]'` WITH the
 * brackets - that is the WHATWG URL serialization of an IPv6 literal, not a
 * quirk of this code. The brackets are stripped here so `::1` compares equal to
 * the entry in LOCAL_HOSTS. Getting this wrong silently breaks one of the four
 * required local hosts, and it breaks it in the SAFE-looking direction (an IPv6
 * loopback would be treated as remote and refused).
 */
function parseDatabaseTarget(
  databaseUrl: string | undefined,
): { host: string; port: string } | null {
  if (!databaseUrl) return null;
  let parsed: URL;
  try {
    parsed = new URL(databaseUrl);
  } catch {
    return null;
  }
  const hostname = parsed.hostname;
  const host =
    hostname.startsWith('[') && hostname.endsWith(']') ? hostname.slice(1, -1) : hostname;
  if (host === '') return null;
  // An omitted port is Postgres' default of 5432, which is what the driver will
  // actually dial. Reporting '5432' is therefore the truth, not a guess.
  const port = parsed.port === '' ? '5432' : parsed.port;
  return { host, port };
}

/**
 * Host and port ONLY, for the boot visibility line. NEVER the user, the
 * password, the database name or the whole URL - the whole point of the line is
 * that it is safe to print in every log.
 *
 * Returns `null` when the URL is absent or does not parse; the caller decides
 * what to say about that.
 */
export function describeDatabaseTarget(
  databaseUrl: string | undefined,
): { host: string; port: string } | null {
  return parseDatabaseTarget(databaseUrl);
}

/**
 * True when the URL's host is one of the four local hosts.
 *
 * A URL that does not parse, or that is absent, is NOT local - but that is not
 * the same as being a violation. See `assertLocalDatabase`.
 */
export function isLocalDatabaseHost(databaseUrl: string | undefined): boolean {
  const target = parseDatabaseTarget(databaseUrl);
  if (!target) return false;
  return LOCAL_HOSTS.has(target.host);
}

/**
 * The guard. Returns the violation lines, or an empty array when there is
 * nothing to refuse. It decides; it does not print and it does not exit. The two
 * entrypoints print every line and `process.exit(1)`.
 *
 * A violation is returned ONLY when all three hold TOGETHER:
 *   1. `nodeEnv !== 'production'` - in production a remote host is the point.
 *   2. the host of `databaseUrl` PARSES and is NOT local.
 *   3. `namedEnvFile === null` - no named env file was in play, so nobody asked
 *      for a remote target on purpose.
 *
 * A `DATABASE_URL` that DOES NOT PARSE is NOT a violation of this guard. This
 * guard answers ONE question only: is the host local. Refusing an unparseable
 * URL here would produce a second, worse-worded version of the error the caller
 * already raises (`DATABASE_URL is required`) or that the driver raises on
 * connect, and it would attach that failure to the wrong cause.
 */
export function assertLocalDatabase(input: {
  nodeEnv: string;
  databaseUrl: string | undefined;
  namedEnvFile: string | null;
}): string[] {
  if (input.nodeEnv === 'production') return [];
  if (input.namedEnvFile !== null) return [];

  const target = parseDatabaseTarget(input.databaseUrl);
  if (!target) return [];
  if (LOCAL_HOSTS.has(target.host)) return [];

  return [
    `[local-database-guard] DATABASE_URL points at the non-local host "${target.host}".`,
    '[local-database-guard] Only localhost, 127.0.0.1, ::1 and db run without an opt-in. Refusing to connect or migrate.',
    '[local-database-guard] To target a remote environment on purpose, use the staging entrypoint: make stg',
  ];
}
