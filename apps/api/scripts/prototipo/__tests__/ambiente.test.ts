// Protects the Harness prototype's scratch database: the name carries the pid, the orphan sweep
// drops only a dead prototype's database (never the developer's, never a live one), a remote host
// is refused, and no outside-service key reaches a child.
import { describe, expect, it } from 'vitest';
import {
  apiEnv,
  isScratchDatabaseName,
  localOverrides,
  maintenanceDatabaseUrl,
  orphanDatabases,
  pickDevDatabaseUrl,
  portFromArgs,
  scratchDatabaseName,
  scratchDatabaseUrl,
  webEnv,
  withoutOutsideServices,
} from '../ambiente.js';

const DEV_URL = 'postgresql://postgres:postgres@localhost:5006/fxl_sales';

describe('prototype: environment', () => {
  it('names the scratch database with the pid and accepts only that shape', () => {
    const name = scratchDatabaseName(new Date('2026-11-09T21:05:09Z'), 4242);
    expect(name).toBe('fxl_sales_proto_20261109210509_4242');
    expect(isScratchDatabaseName(name)).toBe(true);
    expect(isScratchDatabaseName('fxl_sales')).toBe(false);
    expect(isScratchDatabaseName('fxl_sales_proto_20261109210509_4242; DROP DATABASE x')).toBe(false);
    expect(scratchDatabaseUrl(DEV_URL, name)).toBe(`postgresql://postgres:postgres@localhost:5006/${name}`);
  });

  it('refuses a non-local host for the scratch and maintenance URLs', () => {
    const remote = 'postgresql://u:p@db.example.com:5432/fxl_sales';
    const name = scratchDatabaseName(new Date('2026-11-09T21:05:09Z'), 1);
    expect(() => scratchDatabaseUrl(remote, name)).toThrow(/local Postgres/);
    expect(() => maintenanceDatabaseUrl(remote)).toThrow(/local Postgres/);
    expect(maintenanceDatabaseUrl(DEV_URL)).toBe('postgresql://postgres:postgres@localhost:5006/postgres');
    expect(maintenanceDatabaseUrl('postgresql://postgres:postgres@[::1]:5006/fxl_sales')).toContain('/postgres');
  });

  it('refuses to build a URL for a name the script would not create', () => {
    expect(() => scratchDatabaseUrl(DEV_URL, 'fxl_sales')).toThrow(/not a prototype scratch database/);
  });

  it('sweeps only the scratch databases whose pid is dead', () => {
    const alive = new Set([10]);
    const names = [
      'fxl_sales_proto_20261109210509_10',
      'fxl_sales_proto_20261109210509_11',
      'fxl_sales_e2e_20261109210509_11',
      'fxl_sales',
      'fxl_sales_test',
    ];
    expect(orphanDatabases(names, (pid) => alive.has(pid))).toEqual(['fxl_sales_proto_20261109210509_11']);
  });

  it('takes the first DATABASE_URL in file order and skips missing files', () => {
    expect(
      pickDevDatabaseUrl([
        { path: '.env.local', content: null },
        { path: '.env', content: 'PORT=3006\n' },
        { path: '.env.dev.example', content: `DATABASE_URL=${DEV_URL}\n` },
      ]),
    ).toBe(DEV_URL);
    expect(
      pickDevDatabaseUrl([
        { path: '.env', content: 'DATABASE_URL=postgresql://a@localhost/x\n' },
        { path: '.env.dev.example', content: `DATABASE_URL=${DEV_URL}` },
      ]),
    ).toBe('postgresql://a@localhost/x');
    expect(pickDevDatabaseUrl([{ path: '.env', content: null }])).toBeNull();
  });

  it('flags the .env.local keys the API would load with override', () => {
    expect(localOverrides(null)).toEqual([]);
    expect(localOverrides('PORT=1\nDATABASE_URL=x\nFXL_HUB_CLIENT_ID=pk\nSOMETHING_ELSE=1\n').sort()).toEqual([
      'DATABASE_URL',
      'FXL_HUB_CLIENT_ID',
      'PORT',
    ]);
    expect(localOverrides('SOMETHING_ELSE=1\n')).toEqual([]);
  });

  it('empties every outside-service key, whatever the shell exported', () => {
    const env = withoutOutsideServices({ FXL_HUB_CLIENT_SECRET: 'secret', SENTRY_DSN: 'https://x@y/1', PATH: '/bin' });
    expect(env['FXL_HUB_CLIENT_SECRET']).toBe('');
    expect(env['SENTRY_DSN']).toBe('');
    expect(env['SALES_SESSION_ENCRYPTION_IKM']).toBe('');
    expect(env['SALES_MODULE_OPERATOR_ACCOUNT_IDS']).toBe('');
    expect(env['PATH']).toBe('/bin');
  });

  it('pins the API to the scratch database, the dev identity and no named env file', () => {
    const env = apiEnv(
      { DATABASE_URL: 'postgresql://u:p@remote.example.com/x', SALES_ENV_FILE: '.env.staging', NODE_ENV: 'production', FXL_HUB_CLIENT_ID: 'pk' },
      { apiPort: 4100, databaseUrl: 'postgresql://postgres:postgres@localhost:5006/fxl_sales_proto_20261109210509_1', webUrl: 'http://127.0.0.1:5200' },
    );
    expect(env['DATABASE_URL']).toContain('fxl_sales_proto_20261109210509_1');
    expect(env['ADMIN_DATABASE_URL']).toBe(env['DATABASE_URL']);
    expect(env['SALES_AUTH_FAKE']).toBe('1');
    expect(env['SALES_ENV_FILE']).toBe('');
    expect(env['NODE_ENV']).toBe('development');
    expect(env['PORT']).toBe('4100');
    expect(env['SALES_LISTEN_HOST']).toBe('127.0.0.1');
    expect(env['CORS_ORIGIN']).toBe('http://127.0.0.1:5200');
    expect(env['FXL_HUB_CLIENT_ID']).toBe('');
  });

  it('points the web at the prototype API with the dev identity on', () => {
    const env = webEnv({ PATH: '/bin' }, { apiUrl: 'http://127.0.0.1:4100' });
    expect(env['VITE_AUTH_FAKE']).toBe('1');
    expect(env['VITE_API_URL']).toBe('http://127.0.0.1:4100');
    expect(env['VITE_AUTH_PROXY_TARGET']).toBe('http://127.0.0.1:4100');
    expect(env['PATH']).toBe('/bin');
  });

  it('requires a valid --port', () => {
    expect(portFromArgs(['--port', '5174'])).toBe(5174);
    expect(() => portFromArgs([])).toThrow(/--port/);
    expect(() => portFromArgs(['--port', '{port}'])).toThrow(/--port/);
    expect(() => portFromArgs(['--port', '70000'])).toThrow(/--port/);
  });
});
