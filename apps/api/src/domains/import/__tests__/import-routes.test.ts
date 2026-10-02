import { Hono } from 'hono';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { hubAuthContext } from '../../../auth/__tests__/hub-auth-context-fixture.js';
import type { ImportOperation } from '../types.js';
import { buildXlsx, exampleTabs } from './xlsx-fixture.js';

/**
 * The import routes on the REAL salesOpsRouter with a fake database: the admin gate and the
 * upload refusals must answer without ever opening a transaction.
 */

vi.hoisted(() => {
  for (const name of [
    'FXL_HUB_CONFIG',
    'FXL_HUB_API_URL',
    'FXL_HUB_ENVIRONMENT',
    'FXL_HUB_CLIENT_ID',
    'FXL_HUB_CLIENT_SECRET',
    'FXL_HUB_AUDIENCE',
    'SALES_ENV_FILE',
    'SALES_AUTH_FAKE',
  ]) {
    process.env[name] = '';
  }
});

const fakeDb = vi.hoisted(() => ({
  transaction: vi.fn(async (): Promise<unknown> => {
    throw new Error('fake db reached');
  }),
}));

vi.mock('../../../db/client.js', () => ({
  getDb: () => fakeDb,
  getAdminDb: () => fakeDb,
  closeDb: async () => undefined,
}));

const { salesOpsRouter } = await import('../../sales-ops/routes.js');
const { ImportExecutionError } = await import('../executor.js');
const { FILE_TOO_LARGE_BODY, INVALID_FILE_BODY, MULTIPART_OVERHEAD_BYTES } = await import('../routes.js');
const { MAX_UPLOAD_BYTES } = await import('../workbook-schema.js');

type Role = 'admin' | 'seller' | 'finder' | undefined;
let currentRole: Role = 'admin';

function createTestApp() {
  const app = new Hono();
  app.use('*', async (c, next) => {
    c.set('userId', 'verified-account');
    c.set('orgId', 'verified-org');
    c.set('userRole', currentRole);
    c.set('userRoles', currentRole === 'admin' ? ['admin', 'seller', 'finder'] : currentRole ? [currentRole] : []);
    c.set('hubAuth', hubAuthContext({ accountId: 'verified-account', workspaceId: 'verified-org' }));
    await next();
  });
  app.route('/', salesOpsRouter);
  return app;
}

function form(file?: Blob | string): FormData {
  const data = new FormData();
  if (typeof file === 'string') data.set('file', file);
  else if (file) data.set('file', new File([file], 'planilha.xlsx'));
  return data;
}

async function post(path: '/import/preview' | '/import/commit', body: BodyInit, headers?: HeadersInit) {
  return createTestApp().request(path, { method: 'POST', body, headers });
}

const PATHS = ['/import/preview', '/import/commit'] as const;

beforeEach(() => {
  fakeDb.transaction.mockClear();
  currentRole = 'admin';
});

describe('import routes admin gate', () => {
  it('answers the requireAdmin body on every import route for a non-admin', async () => {
    const valid = new Blob([new Uint8Array(await buildXlsx(exampleTabs()))]);
    for (const role of ['seller', 'finder', undefined] as const) {
      currentRole = role;
      const responses = [
        await createTestApp().request('/import/template'),
        await post('/import/preview', form(valid)),
        await post('/import/commit', form(valid)),
      ];
      for (const response of responses) {
        expect(response.status).toBe(403);
        expect(await response.json()).toEqual({ error: 'forbidden', reason: 'admin_role_required' });
      }
    }
    expect(fakeDb.transaction).not.toHaveBeenCalled();
  });

  it('answers the admin 403 before the upload limit', async () => {
    currentRole = 'seller';
    const response = await post('/import/preview', form(new Blob([new Uint8Array(MAX_UPLOAD_BYTES + 1)])));
    expect(response.status).toBe(403);
  });
});

describe('import upload refusals', () => {
  it('refuses a missing, non-file or non-xlsx upload with invalid_file', async () => {
    for (const path of PATHS) {
      const bodies: Array<[BodyInit, HeadersInit | undefined]> = [
        [form(), undefined],
        [form('texto'), undefined],
        [JSON.stringify({}), { 'content-type': 'application/json' }],
        [form(new Blob([Buffer.from('hello')])), undefined],
        [form(new Blob([])), undefined],
      ];
      for (const [body, headers] of bodies) {
        const response = await post(path, body, headers);
        expect(response.status).toBe(400);
        expect(await response.json()).toEqual(INVALID_FILE_BODY);
      }
    }
    expect(fakeDb.transaction).not.toHaveBeenCalled();
  });

  it('refuses an oversize file with file_too_large', async () => {
    for (const path of PATHS) {
      const big = await post(path, form(new Blob([new Uint8Array(MAX_UPLOAD_BYTES + 1)])));
      expect(big.status).toBe(413);
      expect(await big.json()).toEqual(FILE_TOO_LARGE_BODY);

      const raw = await post(path, new Uint8Array(MAX_UPLOAD_BYTES + MULTIPART_OVERHEAD_BYTES + 1), {
        'content-type': 'multipart/form-data; boundary=x',
      });
      expect(raw.status).toBe(413);
      expect(await raw.json()).toEqual(FILE_TOO_LARGE_BODY);
    }
    expect(fakeDb.transaction).not.toHaveBeenCalled();
  });

  it('reaches the database only for an admin with a valid workbook', async () => {
    const valid = new Blob([new Uint8Array(await buildXlsx(exampleTabs()))]);
    const response = await post('/import/preview', form(valid));
    expect(response.status).toBe(500);
    expect(fakeDb.transaction).toHaveBeenCalledTimes(1);
  });
});

describe('commit execution failure', () => {
  it('answers 409 with the error message and never serializes the operation', async () => {
    const operation = {
      op: 'settleReceivable',
      saleKey: 'propostas:2',
      receivableLabel: '1/1',
      paidOn: '2026-01-20',
      settlePayables: false,
    } as ImportOperation;
    const error = new ImportExecutionError(operation, 'already_paid');
    fakeDb.transaction.mockRejectedValueOnce(error);
    const valid = new Blob([new Uint8Array(await buildXlsx(exampleTabs()))]);
    const response = await post('/import/commit', form(valid));
    expect(response.status).toBe(409);
    const text = await response.text();
    expect(JSON.parse(text)).toEqual({
      error: 'conflict',
      reason: 'import_execution_failed',
      message: error.message,
    });
    expect(text).not.toContain('propostas:2');
    expect(text).not.toContain('saleKey');
    expect(text).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-/);
  });
});
