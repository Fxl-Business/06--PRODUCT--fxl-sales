import { randomUUID } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as schema from '../../src/db/schema.js';
import { salesOpsLeads } from '../../src/db/schema.js';
import { testDatabaseUrls } from '../../src/db/__tests__/test-database-urls.js';
import { firstRow } from './first-row.js';

/**
 * Migration 0027 - lead contact fields, applied by global-setup.ts through the
 * real runner before this file runs.
 *
 * The round trip goes through DRIZZLE on purpose: raw postgres.js parses a
 * `date` into a JS Date, so only the `{ mode: 'string' }` column proves that a
 * birth date comes back as the same civil day string, with no timezone shift.
 * '2000-01-01' is the day a UTC-3 shift would turn into '1999-12-31'.
 *
 * Fixtures are written over the admin connection (migration correctness, not
 * RLS behaviour; leads-rls.test.ts covers that).
 */

const ADMIN_DB_URL = testDatabaseUrls().adminUrl;
const ADMIN_CONNECTION_OPTIONS = { connection: { 'app.fxl_admin': 'true' } } as const;

type ColumnRow = {
  column_name: string;
  data_type: string;
  is_nullable: string;
  column_default: string | null;
};

describe('lead contact fields migration 0027', () => {
  let adminClient: postgres.Sql;
  let adminDb: ReturnType<typeof drizzle<typeof schema>>;
  const orgIds: string[] = [];

  function newOrg(label: string): string {
    const orgId = `org_lead_contact_${label}_${Date.now()}_${randomUUID().slice(0, 8)}`;
    orgIds.push(orgId);
    return orgId;
  }

  async function insertStage(orgId: string): Promise<string> {
    const row = firstRow(await adminClient<{ id: string }[]>`
      INSERT INTO sales_ops_lead_stages (org_id, name, kind, is_system, "position")
      VALUES (${orgId}, 'Novo', 'normal', false, 1)
      RETURNING id
    `, 'stage');
    return row.id;
  }

  async function readLead(leadId: string) {
    return firstRow(
      await adminDb
        .select({
          contactPhone: salesOpsLeads.contactPhone,
          contactEmail: salesOpsLeads.contactEmail,
          contactBirthDate: salesOpsLeads.contactBirthDate,
        })
        .from(salesOpsLeads)
        .where(eq(salesOpsLeads.id, leadId)),
      'lead',
    );
  }

  beforeAll(() => {
    adminClient = postgres(ADMIN_DB_URL, { max: 1, ...ADMIN_CONNECTION_OPTIONS });
    adminDb = drizzle(adminClient, { schema });
  });

  afterAll(async () => {
    for (const orgId of orgIds) {
      // Children first, or the restrict FK from leads to stages rejects the delete.
      await adminClient`DELETE FROM sales_ops_leads WHERE org_id = ${orgId}`;
      await adminClient`DELETE FROM sales_ops_lead_stages WHERE org_id = ${orgId}`;
    }
    await adminClient.end();
  });

  it('adds three nullable columns with no default to sales_ops_leads', async () => {
    const columns = await adminClient<ColumnRow[]>`
      SELECT column_name, data_type, is_nullable, column_default
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'sales_ops_leads'
        AND column_name IN ('contact_phone', 'contact_email', 'contact_birth_date')
      ORDER BY column_name
    `;
    expect(columns).toEqual([
      { column_name: 'contact_birth_date', data_type: 'date', is_nullable: 'YES', column_default: null },
      { column_name: 'contact_email', data_type: 'text', is_nullable: 'YES', column_default: null },
      { column_name: 'contact_phone', data_type: 'text', is_nullable: 'YES', column_default: null },
    ]);
  });

  it('round-trips phone, email and a birth date as the same strings through Drizzle', async () => {
    const orgId = newOrg('roundtrip');
    const stageId = await insertStage(orgId);

    const inserted = firstRow(
      await adminDb
        .insert(salesOpsLeads)
        .values({
          orgId,
          contactName: 'Ana Construbom',
          clientNameSnapshot: '',
          stageId,
          contactPhone: '+55 (11) 98888-7777',
          contactEmail: 'ana@construbom.com.br',
          contactBirthDate: '2000-01-01',
        })
        .returning({ id: salesOpsLeads.id }),
      'inserted lead',
    );

    const lead = await readLead(inserted.id);
    expect(lead).toEqual({
      contactPhone: '+55 (11) 98888-7777',
      contactEmail: 'ana@construbom.com.br',
      contactBirthDate: '2000-01-01',
    });
    expect(typeof lead.contactBirthDate).toBe('string');

    // The stored value is the civil day itself, not a shifted instant.
    const stored = firstRow(
      await adminClient<{ day: string }[]>`
        SELECT contact_birth_date::text AS day FROM sales_ops_leads WHERE id = ${inserted.id}
      `,
      'stored day',
    );
    expect(stored.day).toBe('2000-01-01');
  });

  it('stores NULL in all three for a lead written with the pre-0027 column list', async () => {
    const orgId = newOrg('legacy');
    const stageId = await insertStage(orgId);

    // Raw SQL with exactly the column list the existing lead tests and the
    // full-edition service write today.
    const raw = firstRow(await adminClient<{ id: string }[]>`
      INSERT INTO sales_ops_leads (
        org_id, contact_name, client_id, client_name_snapshot,
        estimated_value_brl, seller_person_id, stage_id, sale_id
      ) VALUES (
        ${orgId}, 'Contato antigo', NULL, 'Empresa', 150000, NULL, ${stageId}, NULL
      ) RETURNING id
    `, 'raw lead');

    // Drizzle insert that names none of the new fields.
    const viaDrizzle = firstRow(
      await adminDb
        .insert(salesOpsLeads)
        .values({ orgId, contactName: 'Contato drizzle', clientNameSnapshot: 'Empresa', stageId })
        .returning({ id: salesOpsLeads.id }),
      'drizzle lead',
    );

    for (const id of [raw.id, viaDrizzle.id]) {
      expect(await readLead(id)).toEqual({
        contactPhone: null,
        contactEmail: null,
        contactBirthDate: null,
      });
    }

    // Positive control: the rows really exist in this org, so the NULLs above are
    // read from them and not from an empty result.
    const counted = firstRow(
      await adminDb
        .select({ count: sql<number>`count(*)::int` })
        .from(salesOpsLeads)
        .where(eq(salesOpsLeads.orgId, orgId)),
      'count',
    );
    expect(counted.count).toBe(2);
  });
});
