// Harness prototype - the PURE rules: arguments, the scratch database name, the URLs derived from
// the developer's local URL, which scratch databases a dead prototype left behind, and the
// environment of each child.
//
// Nothing here reads `process.env`, the clock or the disk: every input arrives as an argument, so
// `__tests__/ambiente.test.ts` drives every branch without a database.

import { parse } from 'dotenv';
import { isLocalDatabaseHost } from '../../src/db/local-database-guard.js';

const PREFIX = 'fxl_sales_proto_';
const NAME_RE = /^fxl_sales_proto_(\d{14})_(\d+)$/;

/** `--port N` is required: the web port comes from the Harness (the `{port}` of the `prototipo` block). */
export function portFromArgs(argv: readonly string[]): number {
  const i = argv.indexOf('--port');
  const raw = i >= 0 ? argv[i + 1] : undefined;
  const port = Number(raw);
  if (raw === undefined || !Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`usage: run.ts --port <port> (received: ${JSON.stringify(raw ?? null)})`);
  }
  return port;
}

/** `fxl_sales_proto_<yyyymmddhhmmss>_<pid>`, in UTC. The pid at the end says whether the owner is alive. */
export function scratchDatabaseName(now: Date, pid: number): string {
  const stamp = now.toISOString().replace(/\D/g, '').slice(0, 14);
  return `${PREFIX}${stamp}_${pid}`;
}

/** The LIKE pattern that lists every prototype scratch database (underscores escaped). */
export const PROTOTYPE_DATABASE_LIKE = 'fxl\\_sales\\_proto\\_%';

/** True only for a name this script itself would create. The one door to a `DROP DATABASE`. */
export function isScratchDatabaseName(name: string): boolean {
  return NAME_RE.test(name);
}

/** The scratch databases whose owner process is dead. A name outside the pattern never qualifies. */
export function orphanDatabases(names: readonly string[], alive: (pid: number) => boolean): string[] {
  return names.filter((name) => {
    const m = NAME_RE.exec(name);
    return m !== null && !alive(Number(m[2]));
  });
}

/**
 * The first `DATABASE_URL` found, in the order given (`.env.local`, `.env`, `.env.dev.example`).
 * A file that does not exist is `null` content and is skipped. Returns `null` when none defines it.
 */
export function pickDevDatabaseUrl(files: readonly { path: string; content: string | null }[]): string | null {
  for (const file of files) {
    if (file.content === null) continue;
    const url = parse(file.content)['DATABASE_URL'];
    if (typeof url === 'string' && url !== '') return url;
  }
  return null;
}

function withDatabase(devUrl: string, database: string): string {
  const url = new URL(devUrl);
  url.pathname = `/${database}`;
  return url.toString();
}

/**
 * The URL of the scratch database, from the developer's local URL. Refuses a non-local host and
 * any name this script would not create, so a typo can never aim a DROP at a real database.
 */
export function scratchDatabaseUrl(devUrl: string, name: string): string {
  if (!isLocalDatabaseHost(devUrl)) {
    throw new Error('the prototype only runs against a local Postgres (localhost, 127.0.0.1, ::1 or db)');
  }
  if (!isScratchDatabaseName(name)) throw new Error(`"${name}" is not a prototype scratch database name`);
  return withDatabase(devUrl, name);
}

/** The maintenance connection (database `postgres`) used to CREATE, list and DROP scratch databases. */
export function maintenanceDatabaseUrl(devUrl: string): string {
  if (!isLocalDatabaseHost(devUrl)) {
    throw new Error('the prototype only runs against a local Postgres (localhost, 127.0.0.1, ::1 or db)');
  }
  return withDatabase(devUrl, 'postgres');
}

// Keys that route the API to something outside this machine or to another database. The API loads
// `apps/api/.env.local` WITH override, so a key it defines would beat the value pinned in the child
// environment; the script refuses to start instead of letting that happen silently.
const OUTSIDE = /^(SENTRY_DSN|FXL_HUB_[A-Z0-9_]+|SALES_SESSION_ENCRYPTION_IKM|SALES_POST_LOGIN_[A-Z_]+|SALES_MODULE_OPERATOR_ACCOUNT_IDS)$/;
const PINNED = ['DATABASE_URL', 'ADMIN_DATABASE_URL', 'PORT', 'CORS_ORIGIN', 'NODE_ENV', 'SALES_LISTEN_HOST', 'SALES_AUTH_FAKE', 'SALES_ENV_FILE', 'PUBLIC_LINK_BASE_URL'] as const;

/** The keys `.env.local` defines that the prototype pins or blanks, and that the API would let it override. */
export function localOverrides(envLocalContent: string | null): string[] {
  if (envLocalContent === null) return [];
  return Object.keys(parse(envLocalContent)).filter((k) => OUTSIDE.test(k) || (PINNED as readonly string[]).includes(k));
}

/** Every key that reaches an outside service (Hub, Sentry, sessions, operators) emptied, whatever the shell exported. */
export function withoutOutsideServices(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const clean: NodeJS.ProcessEnv = { ...env };
  for (const key of Object.keys(env)) if (OUTSIDE.test(key)) clean[key] = '';
  for (const key of ['SENTRY_DSN', 'SALES_SESSION_ENCRYPTION_IKM', 'SALES_MODULE_OPERATOR_ACCOUNT_IDS', 'SALES_POST_LOGIN_REDIRECT', 'SALES_POST_LOGIN_ERROR_REDIRECT'] as const) {
    clean[key] = '';
  }
  return clean;
}

/** The environment of migrate, seed and the API: the scratch database, the dev identity, no outside service. */
export function apiEnv(
  base: NodeJS.ProcessEnv,
  input: { apiPort: number; databaseUrl: string; webUrl: string },
): NodeJS.ProcessEnv {
  return {
    ...withoutOutsideServices(base),
    NODE_ENV: 'development',
    PORT: String(input.apiPort),
    SALES_LISTEN_HOST: '127.0.0.1',
    CORS_ORIGIN: input.webUrl,
    DATABASE_URL: input.databaseUrl,
    ADMIN_DATABASE_URL: input.databaseUrl,
    PUBLIC_LINK_BASE_URL: `http://127.0.0.1:${input.apiPort}`,
    SALES_AUTH_FAKE: '1',
    // Never a named env file: it is the one escape hatch of the local-database guard.
    SALES_ENV_FILE: '',
  };
}

/** The environment of Vite: the development identity on, pointed at the prototype's own API. */
export function webEnv(base: NodeJS.ProcessEnv, input: { apiUrl: string }): NodeJS.ProcessEnv {
  return {
    ...base,
    VITE_AUTH_FAKE: '1',
    VITE_API_URL: input.apiUrl,
    VITE_AUTH_PROXY_TARGET: input.apiUrl,
    VITE_AUTH_BFF_BASE_PATH: '',
    // The web still builds a Hub client from these three; nothing contacts it under the dev identity.
    VITE_FXL_HUB_API_URL: 'http://localhost:9016',
    VITE_FXL_HUB_ENVIRONMENT: 'development',
    VITE_FXL_HUB_AUDIENCE: 'app.fxl-sales',
  };
}
