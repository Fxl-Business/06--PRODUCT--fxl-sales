import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as schema from '../../src/db/schema.js';
import { ClientSchema, createClient, listClients, updateClient } from '../../src/domains/sales-ops/service.js';

const APP_DB_URL =
  process.env.TEST_DATABASE_URL ??
  process.env.DATABASE_URL ??
  'postgresql://postgres:postgres@localhost:5006/fxl_sales';
const ADMIN_DB_URL = process.env.ADMIN_DATABASE_URL ?? APP_DB_URL;
const ADMIN_CONNECTION_OPTIONS = { connection: { 'app.fxl_admin': 'true' } } as const;

describe('sales operations client legal fields persistence', () => {
  let appClient: postgres.Sql;
  let adminClient: postgres.Sql;
  let db: ReturnType<typeof drizzle<typeof schema>>;
  const orgIds: string[] = [];

  beforeAll(() => {
    appClient = postgres(APP_DB_URL, { max: 2 });
    adminClient = postgres(ADMIN_DB_URL, { max: 1, ...ADMIN_CONNECTION_OPTIONS });
    db = drizzle(appClient, { schema });
  });

  afterAll(async () => {
    for (const orgId of orgIds) {
      await adminClient`DELETE FROM sales_ops_clients WHERE org_id = ${orgId}`;
    }
    await appClient.end();
    await adminClient.end();
  });

  it('persists legal fields through create, partial update, and preserves omitted fields', async () => {
    const orgId = `org_client_legal_${Date.now()}`;
    orgIds.push(orgId);

    const created = await createClient(
      db,
      orgId,
      ClientSchema.parse({
        name: 'Acme Ltda',
        contact: 'contato@acme.com',
        legalName: 'Acme Comércio e Serviços Ltda',
        document: '12.345.678/0001-90',
        address: 'Rua das Flores, 100, São Paulo - SP',
        legalRepName: 'João da Silva',
        legalRepDocument: '123.456.789-00',
      }),
    );

    expect(created.legalName).toBe('Acme Comércio e Serviços Ltda');
    expect(created.document).toBe('12.345.678/0001-90');
    expect(created.address).toBe('Rua das Flores, 100, São Paulo - SP');
    expect(created.legalRepName).toBe('João da Silva');
    expect(created.legalRepDocument).toBe('123.456.789-00');

    const partiallyUpdated = await updateClient(
      db,
      orgId,
      created.id,
      ClientSchema.partial().parse({ document: '111.222.333-44' }),
    );

    expect(partiallyUpdated?.document).toBe('111.222.333-44');
    expect(partiallyUpdated?.legalName).toBe('Acme Comércio e Serviços Ltda');
    expect(partiallyUpdated?.address).toBe('Rua das Flores, 100, São Paulo - SP');
    expect(partiallyUpdated?.legalRepName).toBe('João da Silva');
    expect(partiallyUpdated?.legalRepDocument).toBe('123.456.789-00');
    expect(partiallyUpdated?.contact).toBe('contato@acme.com');

    const clearedLegalName = await updateClient(
      db,
      orgId,
      created.id,
      ClientSchema.partial().parse({ legalName: null }),
    );

    expect(clearedLegalName?.legalName).toBeNull();

    const listed = await listClients(db, orgId);
    expect(listed).toEqual([
      expect.objectContaining({
        id: created.id,
        legalName: null,
        document: '111.222.333-44',
        address: 'Rua das Flores, 100, São Paulo - SP',
        legalRepName: 'João da Silva',
        legalRepDocument: '123.456.789-00',
        contact: 'contato@acme.com',
      }),
    ]);
  });
});
