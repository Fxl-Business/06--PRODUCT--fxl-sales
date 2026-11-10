// Harness prototype over the development identity: the real Sales API and web, signed in through
// `packages/auth-fake`, on a scratch Postgres database that belongs to this one process.
//
// The Harness runs this from the `prototipo` block of project.fxl.yaml, in the request's worktree,
// on a port it chooses (`--port`). The script:
//   1. refuses a non-local database host and a `.env.local` that would override the pinned values;
//   2. drops the scratch databases whose owner process is dead;
//   3. creates its own database (keyed by pid), migrates it and seeds it with `seed-dev.ts`;
//   4. starts the API on a free port with the development identity, and Vite on `--port`;
//   5. on SIGTERM, SIGINT or SIGHUP, or when a child dies, drops the database and exits.
//
// The children stay in THIS process group on purpose: the Harness stops the task by signalling the
// group, so the API and Vite receive the signal directly and this process only has to drop the
// database. Nothing here touches the developer's database (`fxl_sales`) or ports (3006, 8006).

import { spawn, type ChildProcess } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { constants } from 'node:os';
import { createServer } from 'node:net';
import { join, resolve } from 'node:path';
import postgres from 'postgres';
import {
  apiEnv,
  isScratchDatabaseName,
  localOverrides,
  maintenanceDatabaseUrl,
  orphanDatabases,
  pickDevDatabaseUrl,
  PROTOTYPE_DATABASE_LIKE,
  portFromArgs,
  scratchDatabaseName,
  scratchDatabaseUrl,
  webEnv,
} from './ambiente.js';

const API_DIR = resolve(import.meta.dirname, '../..');
const REPO_ROOT = resolve(API_DIR, '../..');
const TSX = './node_modules/.bin/tsx';
// The developer's own ports are never used for the prototype.
const FORBIDDEN_PORTS = [3006, 5006, 8006];

const log = (line: string) => console.log(`[prototipo] ${line}`);

let scratch: { maintenance: string; name: string } | null = null;
const children: ChildProcess[] = [];
let leaving = false;

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === 'EPERM';
  }
}

function readIfExists(path: string): string | null {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return null;
  }
}

async function withMaintenance<T>(url: string, work: (sql: postgres.Sql) => Promise<T>): Promise<T> {
  const sql = postgres(url, { max: 1, onnotice: () => undefined, connect_timeout: 10 });
  try {
    return await work(sql);
  } finally {
    await sql.end({ timeout: 5 });
  }
}

async function dropDatabase(maintenance: string, name: string): Promise<void> {
  if (!isScratchDatabaseName(name)) throw new Error(`refusing to drop "${name}": not a prototype scratch database`);
  await withMaintenance(maintenance, (sql) => sql.unsafe(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`));
}

function freePort(taken: ReadonlySet<number>): Promise<number> {
  return new Promise((ok, fail) => {
    const server = createServer();
    server.once('error', fail);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      server.close(() => (taken.has(port) ? freePort(taken).then(ok, fail) : ok(port)));
    });
  });
}

function launch(name: string, command: string, args: readonly string[], cwd: string, env: NodeJS.ProcessEnv): ChildProcess {
  const child = spawn(command, [...args], { cwd, env, stdio: ['ignore', 'inherit', 'inherit'] });
  children.push(child);
  child.once('exit', (code, signal) => {
    // The group signal can reach the child before this process's handler: leave with the signal's code.
    if (!leaving) void leave(`${name} exited with ${code ?? signal}`, signal ? 128 + constants.signals[signal] : 1);
  });
  return child;
}

function untilDone(name: string, command: string, args: readonly string[], cwd: string, env: NodeJS.ProcessEnv): Promise<void> {
  const child = spawn(command, [...args], { cwd, env, stdio: ['ignore', 'inherit', 'inherit'] });
  children.push(child);
  return new Promise((ok, fail) => {
    child.once('error', fail);
    child.once('exit', (code, signal) => (code === 0 ? ok() : fail(new Error(`${name} exited with ${code ?? signal}`))));
  });
}

async function waitForHttp(name: string, url: string): Promise<void> {
  const deadline = Date.now() + 120_000;
  let seen = 'no answer';
  while (Date.now() < deadline) {
    if (leaving) return;
    try {
      const response = await fetch(url);
      if (response.status < 500) return;
      seen = `status ${response.status}`;
    } catch (e) {
      seen = e instanceof Error ? e.message : String(e);
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error(`${name} did not answer at ${url} within 120s (last: ${seen})`);
}

// One cleanup that every exit path waits for: the signal and the failure of the child it kills
// arrive together, and the second must not exit before the database is dropped.
let cleanup: Promise<void> | null = null;

async function leave(reason: string, code: number): Promise<never> {
  cleanup ??= (async () => {
    leaving = true;
    log(`${reason}: shutting down`);
    for (const child of children) if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM');
    if (scratch) {
      try {
        await dropDatabase(scratch.maintenance, scratch.name);
        log(`database ${scratch.name} dropped`);
      } catch (e) {
        log(`ERROR dropping database ${scratch.name}: ${(e as Error).message}`);
      }
    }
  })();
  await cleanup;
  process.exit(code);
}

async function main(): Promise<void> {
  // `on`, never `once`: the group signal arrives directly AND relayed by pnpm and tsx, and a second
  // SIGTERM without a handler would kill this process in the middle of the DROP.
  for (const [signal, code] of [['SIGTERM', 143], ['SIGINT', 130], ['SIGHUP', 129]] as const) {
    process.on(signal, () => void leave(signal, code));
  }

  const webPort = portFromArgs(process.argv.slice(2));

  const envLocal = readIfExists(join(API_DIR, '.env.local'));
  const overriding = localOverrides(envLocal);
  if (overriding.length > 0) {
    throw new Error(
      `apps/api/.env.local defines ${overriding.join(', ')}, which the API loads WITH override and would beat the prototype's own values. Remove them or move them to apps/api/.env.`,
    );
  }
  // A worktree has no `.env` (git ignores it): the committed `.env.dev.example` is the local default.
  const devUrl = pickDevDatabaseUrl(
    ['.env.local', '.env', '.env.dev.example'].map((file) => ({ path: file, content: readIfExists(join(API_DIR, file)) })),
  );
  if (devUrl === null) throw new Error('no DATABASE_URL in apps/api/.env.local, .env or .env.dev.example');
  const maintenance = maintenanceDatabaseUrl(devUrl); // refuses a non-local host

  try {
    await withMaintenance(maintenance, (sql) => sql`SELECT 1`);
  } catch (e) {
    throw new Error(`the local Postgres does not answer (${(e as Error).message}). Start it with \`make db-up\`.`, { cause: e });
  }

  const existing = await withMaintenance(maintenance, (sql) =>
    sql<{ datname: string }[]>`SELECT datname FROM pg_database WHERE datname LIKE ${PROTOTYPE_DATABASE_LIKE}`,
  );
  for (const orphan of orphanDatabases(existing.map((row) => row.datname), alive)) {
    await dropDatabase(maintenance, orphan);
    log(`orphan database ${orphan} dropped`);
  }

  const name = scratchDatabaseName(new Date(), process.pid);
  const databaseUrl = scratchDatabaseUrl(devUrl, name);
  await withMaintenance(maintenance, (sql) => sql.unsafe(`CREATE DATABASE "${name}"`));
  scratch = { maintenance, name };

  const taken = new Set([...FORBIDDEN_PORTS, webPort]);
  const apiPort = await freePort(taken);
  const apiUrl = `http://127.0.0.1:${apiPort}`;
  const webUrl = `http://127.0.0.1:${webPort}`;
  const childApiEnv = apiEnv(process.env, { apiPort, databaseUrl, webUrl });
  log(`database ${name} | api ${apiPort} | web ${webPort}`);

  // The API and the web import the built shared packages (`make build-shared`).
  for (const pkg of ['@fxl-sales/shared-types', '@fxl-sales/shared-utils']) {
    await untilDone(`build ${pkg}`, 'pnpm', ['--filter', pkg, 'build'], REPO_ROOT, process.env);
  }
  await untilDone('migrate', TSX, ['src/db/migrate.ts'], API_DIR, childApiEnv);
  await untilDone('seed', TSX, ['scripts/seed-dev.ts'], API_DIR, childApiEnv);

  launch('api', TSX, ['src/server.ts'], API_DIR, childApiEnv);
  await waitForHttp('api', `${apiUrl}/health`);
  launch(
    'vite',
    './node_modules/.bin/vite',
    ['--host', '127.0.0.1', '--port', String(webPort), '--strictPort'],
    join(REPO_ROOT, 'apps/web'),
    webEnv(process.env, { apiUrl }),
  );
  await waitForHttp('vite', `${webUrl}/`);
  log(`ready at ${webUrl}/ (switch identity on the floating switcher)`);
}

main().catch((e: unknown) => void leave(`ERROR: ${e instanceof Error ? e.message : String(e)}`, 2));
