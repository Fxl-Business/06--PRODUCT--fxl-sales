---
id: 03-lead-contact-columns
milestone: v4.3.0
status: done
depends_on: []
files_modified:
  - apps/api/drizzle/0027_lead_contact_fields.sql
  - apps/api/drizzle/meta/0027_snapshot.json
  - apps/api/drizzle/meta/_journal.json
  - apps/api/src/db/schema.ts
  - apps/api/src/db/__tests__/lead-contact-fields-schema.test.ts
  - apps/api/test/rls/lead-contact-fields-migration.test.ts
  - apps/api/test/rls/leads-schema-migration.test.ts
acceptance: "Migration 0027_lead_contact_fields is journaled at idx 27 immediately after 0026_seller_invitation_state, ships exactly three additive ALTER TABLE statements adding nullable contact_phone text, contact_email text and contact_birth_date date to sales_ops_leads, has a 0027 snapshot chained to the 0026 snapshot id, and salesOpsLeads exposes contactPhone, contactEmail and contactBirthDate (date mode string). On the local test DB after migrations, a lead inserted through Drizzle with the three fields reads them back as the same strings (birth date exactly '2000-01-01', a string, no timezone shift), and a lead inserted with the pre-0027 column list (raw SQL and Drizzle) stores NULL in all three."
goal: "Add the three nullable lead contact columns (SEAM-CONTRACT section 3) to the database and the Drizzle schema, generated with the repo's own drizzle-kit tooling and applied by the ordinary (non-phased) migration path, so slice 04 can read and write them."
must_not_break:
  - "pnpm --filter @fxl-sales/api test (whole unit suite)"
  - "pnpm --filter @fxl-sales/api test:integration (whole integration suite)"
  - "pnpm --filter @fxl-sales/api lint"
  - "pnpm --filter @fxl-sales/api type-check (tsconfig.json, tsconfig.scripts.json, tsconfig.test.json)"
  - apps/api/src/db/__tests__/migration-runner.test.ts
  - apps/api/src/domains/sellers/__tests__/seller-invitation-schema.test.ts
  - apps/api/src/db/__tests__/settlements-schema-contract.test.ts
  - apps/api/test/rls/leads-schema-migration.test.ts
  - apps/api/test/rls/leads-rls.test.ts
  - apps/api/test/rls/leads-seller-scope.test.ts
  - apps/api/scripts/__tests__/seed-plan.test.ts
  - scripts/__tests__/local-database-guard.test.mjs
oracle:
  - apps/api/test/rls/lead-contact-fields-migration.test.ts
  - apps/api/src/db/__tests__/lead-contact-fields-schema.test.ts
rules:
  - "Additive only: three nullable columns, no default, no backfill, no index, no CHECK, no policy statement (sales_ops_leads already carries FORCE RLS and both policies from 0022; new columns inherit them)."
  - "Generate with drizzle-kit (`pnpm --filter @fxl-sales/api exec drizzle-kit generate --name lead_contact_fields`); never hand-write the snapshot or the journal entry. Then only PREPEND the comment header to the generated SQL file; the three statements stay byte-identical to what drizzle-kit emitted."
  - "Ordinary migration: no `-- fxl-migration-mode: phased` header and no `fxl-phase:` text anywhere in the file (migration-runner.ts rejects phase markers outside 0018)."
  - "Do NOT touch API schemas, services, lead-service.ts, toLeadView, seed scripts or any web file (slice 04 and later own them)."
  - "Never run migrations against anything but the local test DB (via test:integration) or the local dev DB (`make migrate`); never set SALES_ENV_FILE."
  - "No em dash in any file; relative imports use the `.js` extension."
verifier_focus: "That the SQL statements are exactly the three drizzle-kit ALTERs (not a paraphrase), that 0027_snapshot.json.prevId equals 0026_snapshot.json.id and the journal diff is one appended entry, that a second drizzle-kit generate reports no schema changes, and that the integration oracle proves a date string round trip through Drizzle (not through raw postgres.js, which would parse a date into a JS Date)."
---

# Slice 03 - Lead contact columns

## Objective

Add `contact_phone text`, `contact_email text` and `contact_birth_date date` (all nullable) to `sales_ops_leads` through migration `0027_lead_contact_fields`, and mirror them on `salesOpsLeads` as `contactPhone`, `contactEmail` and `contactBirthDate`.
Nothing reads or writes the columns yet; slice 04 does.
FXL behaviour is unchanged: every existing row reads NULL and no projection exposes the columns in this slice.

## Code facts (verified while planning)

- Migrations live in `apps/api/drizzle/` with a drizzle-kit journal `meta/_journal.json` and one snapshot per migration (`meta/0026_snapshot.json` is the latest; ids chain through `prevId`).
- The last entry is `{ "idx": 26, "version": "7", "when": 1790881742363, "tag": "0026_seller_invitation_state", "breakpoints": true }`.
- `apps/api/drizzle.config.ts` points at `./src/db/schema.ts` and `./drizzle`; `drizzle-kit generate` does not connect to any database.
- The repo is in sync today: a dry `drizzle-kit generate` against a scratch copy of `drizzle/` answered `No schema changes, nothing to migrate`.
- The same dry run, with exactly the schema edit below, produced this SQL, a `0027_snapshot.json` whose `prevId` is `8c6bacfa-6389-45b1-b0e7-8cf286e759e6` (the 0026 id), and a journal diff of one appended entry:

```sql
ALTER TABLE "sales_ops_leads" ADD COLUMN "contact_phone" text;--> statement-breakpoint
ALTER TABLE "sales_ops_leads" ADD COLUMN "contact_email" text;--> statement-breakpoint
ALTER TABLE "sales_ops_leads" ADD COLUMN "contact_birth_date" date;
```

- Runner: `apps/api/src/db/migration-runner.ts` (`runDatabaseMigrations`) is the "shared phased runner".
  Only tag `0018_professional_payable_identity` may be phased; every other migration is ORDINARY: all statements in one transaction with `SET LOCAL lock_timeout`, then the journal row.
  It refuses a non-monotonic `when`, a duplicate idx/tag, and any `fxl-phase:` marker in a non-phased file.
  `ALTER TABLE ... ADD COLUMN` of a nullable column without a default is a catalog-only change, so the ordinary path is correct.
- Migration header style: 0023 and 0026 start with a `--` comment block explaining the change, then the drizzle-kit statements.
- Pure migration oracles (no DB) follow `apps/api/src/domains/sellers/__tests__/seller-invitation-schema.test.ts` (0026) and `apps/api/src/db/__tests__/settlements-schema-contract.test.ts` (0024).
- `apps/api/test/rls/leads-schema-migration.test.ts` test `declares sales_ops_leads with an integer-cents estimate, ...` enumerates EVERY column of `sales_ops_leads` from `information_schema.columns` with `toEqual`; it fails after 0027 unless the three rows are added.
- No other test enumerates `sales_ops_leads` columns or snapshots `salesOpsLeads` (`getTableConfig(salesOpsLeads)` appears nowhere).
  `apps/api/scripts/seed/plan.ts` declares its own `LeadRow` interface for INSERTs, so nullable new columns need no seed change.
  `toLeadView` in `lead-service.ts` maps fields explicitly, so no new key leaks into API responses in this slice.
- `date` is already imported from `drizzle-orm/pg-core` in `schema.ts` (used by `sales_ops_settlements.paid_on` with `{ mode: 'string' }`).
- `date('x', { mode: 'string' })` has `columnType === 'PgDateString'`, `getSQLType() === 'date'`, `notNull === false`, `hasDefault === false`.
- Raw `postgres.js` parses a `date` value into a JS `Date`; only Drizzle's string mode (or a `::text` cast) yields `'YYYY-MM-DD'`. The oracle therefore reads through Drizzle.
- Integration runs: `pnpm --filter @fxl-sales/api test:integration` sets `VITEST_INTEGRATION=1`, includes `test/rls/**/*.test.ts` and `src/**/*.integration.test.ts`, runs `test/rls/global-setup.ts` (asserts the `fxl_sales_test` role, refuses non-local URLs, then `runDatabaseMigrations` on `TEST_MIGRATE_DATABASE_URL`) and `test/rls/setup-env.ts`.
  Test files read URLs only through `testDatabaseUrls()` from `apps/api/src/db/__tests__/test-database-urls.ts`; admin access uses `{ connection: { 'app.fxl_admin': 'true' } }`.
  `TEST_DATABASE_URL`, `ADMIN_DATABASE_URL` and `TEST_MIGRATE_DATABASE_URL` are set in `apps/api/.env`, and the local container `06--product--fxl-sales-db-1` listens on 5006.

## Steps

### 1. Drizzle schema

In `apps/api/src/db/schema.ts`, inside `salesOpsLeads`, insert the three fields immediately after `contactName: text('contact_name').notNull(),` and before the `/** Empresa. ...` comment:

```ts
    /**
     * Contact details (migration 0027). All three are nullable with no default,
     * so every lead written before them, and every lead the full edition writes,
     * reads NULL. Only the leads edition's contact field set writes them (slice
     * 04 of edicao-leads). The birth date is a CIVIL day: string mode, never a JS
     * Date, exactly like sales_ops_settlements.paid_on.
     */
    contactPhone: text('contact_phone'),
    contactEmail: text('contact_email'),
    contactBirthDate: date('contact_birth_date', { mode: 'string' }),
```

No import change is needed.

### 2. Generate the migration

Run once, from the repo root:

```bash
pnpm --filter @fxl-sales/api exec drizzle-kit generate --name lead_contact_fields
```

Expect three new or changed files: `apps/api/drizzle/0027_lead_contact_fields.sql`, `apps/api/drizzle/meta/0027_snapshot.json`, and one appended entry in `apps/api/drizzle/meta/_journal.json` (`idx: 27`, `tag: "0027_lead_contact_fields"`, `when` = generation time, which is greater than 1790881742363).
If drizzle-kit emits anything other than the three ALTERs shown in Code facts, STOP: the schema drifted, do not hand-edit, report it.
Run the same command a second time with `--name drift_check`: it must print `No schema changes, nothing to migrate` and create nothing.

### 3. Prepend the header

Prepend exactly this block to `apps/api/drizzle/0027_lead_contact_fields.sql`, keeping the three generated statements byte-identical below it:

```sql
-- 0027_lead_contact_fields - contact details on a kanban lead.
--
-- The leads edition (sales.edition.leads) records a lead as a person to call:
-- phone, email and birth date, with no empresa, produtos or valor. These three
-- columns hold that. All are NULLABLE with no default, so every existing lead
-- reads NULL, no backfill is needed, and the full edition (FXL) never writes them.
--
-- contact_phone is free text (WhatsApp numbers, extensions, country codes);
-- contact_email is free text validated by the API, not by a CHECK; and
-- contact_birth_date is a civil day (date), never a timestamp, so no timezone
-- can move it.
--
-- sales_ops_leads already carries FORCE RLS and both org policies from 0022; a
-- new column inherits them, so no policy statement belongs here. Ordinary
-- (non-phased) migration: adding a nullable column without a default is a
-- catalog-only change.
```

The header must contain no `fxl-phase` text and no `--> statement-breakpoint`.

### 4. Pure oracle (unit)

Create `apps/api/src/db/__tests__/lead-contact-fields-schema.test.ts`:

```ts
/**
 * Pure oracle for migration 0027 (edicao-leads slice 03): no database
 * connection, just the journal, the shipped SQL bytes, the snapshot chain and
 * the Drizzle mirror. Applying the migration is proven by
 * test/rls/lead-contact-fields-migration.test.ts under `test:integration`.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getTableConfig } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';
import { salesOpsLeads } from '../schema.js';

const apiRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const drizzleDir = path.join(apiRoot, 'drizzle');
const TAG = '0027_lead_contact_fields';

type SnapshotColumn = { name: string; type: string; primaryKey: boolean; notNull: boolean; default?: unknown };
type Snapshot = {
  id: string;
  prevId: string;
  tables: Record<string, { columns: Record<string, SnapshotColumn> }>;
};

function journal(): { idx: number; tag: string; when: number }[] {
  const raw = fs.readFileSync(path.join(drizzleDir, 'meta', '_journal.json'), 'utf8');
  return JSON.parse(raw).entries;
}

function migrationSql(): string {
  return fs.readFileSync(path.join(drizzleDir, `${TAG}.sql`), 'utf8');
}

function migrationStatements(): string[] {
  return migrationSql()
    .split('\n')
    .filter((line) => line.trim() !== '' && !line.startsWith('--'))
    .join('\n')
    .split('--> statement-breakpoint')
    .map((statement) => statement.trim())
    .filter((statement) => statement !== '');
}

function snapshot(index: string): Snapshot {
  const raw = fs.readFileSync(path.join(drizzleDir, 'meta', `${index}_snapshot.json`), 'utf8');
  return JSON.parse(raw) as Snapshot;
}

const CONTACT_COLUMNS = [
  { name: 'contact_phone', sqlType: 'text' },
  { name: 'contact_email', sqlType: 'text' },
  { name: 'contact_birth_date', sqlType: 'date' },
] as const;

describe('lead contact fields schema (migration 0027)', () => {
  it('journals 0027_lead_contact_fields immediately after 0026_seller_invitation_state', () => {
    const entries = journal();
    const at = entries.findIndex((entry) => entry.tag === TAG);
    expect(at).toBeGreaterThan(0);
    const entry = entries[at];
    const previous = entries[at - 1];
    expect(entry).toMatchObject({ idx: 27, tag: TAG });
    expect(previous).toMatchObject({ idx: 26, tag: '0026_seller_invitation_state' });
    expect(entry!.when).toBeGreaterThan(previous!.when);
  });

  it('ships exactly three additive nullable sales_ops_leads columns', () => {
    expect(migrationStatements()).toEqual([
      'ALTER TABLE "sales_ops_leads" ADD COLUMN "contact_phone" text;',
      'ALTER TABLE "sales_ops_leads" ADD COLUMN "contact_email" text;',
      'ALTER TABLE "sales_ops_leads" ADD COLUMN "contact_birth_date" date;',
    ]);
  });

  it('is an ordinary migration with no phase header or marker', () => {
    const sql = migrationSql();
    expect(sql).not.toMatch(/fxl-migration-mode/);
    expect(sql).not.toMatch(/fxl-phase/);
  });

  it('chains the 0027 snapshot to the 0026 snapshot and records the three columns', () => {
    const previous = snapshot('0026');
    const current = snapshot('0027');
    expect(current.prevId).toBe(previous.id);
    const columns = current.tables['public.sales_ops_leads']?.columns;
    expect(columns).toBeDefined();
    for (const { name, sqlType } of CONTACT_COLUMNS) {
      expect(columns![name], name).toEqual({ name, type: sqlType, primaryKey: false, notNull: false });
    }
    expect(previous.tables['public.sales_ops_leads']?.columns.contact_phone).toBeUndefined();
  });

  it('exposes the contact fields on the Drizzle salesOpsLeads table', () => {
    expect(salesOpsLeads.contactPhone.name).toBe('contact_phone');
    expect(salesOpsLeads.contactEmail.name).toBe('contact_email');
    expect(salesOpsLeads.contactBirthDate.name).toBe('contact_birth_date');
    // String mode: a civil day never becomes a JS Date.
    expect(salesOpsLeads.contactBirthDate.columnType).toBe('PgDateString');
  });

  it('declares the contact columns as nullable with no default', () => {
    const config = getTableConfig(salesOpsLeads);
    for (const { name, sqlType } of CONTACT_COLUMNS) {
      const column = config.columns.find((candidate) => candidate.name === name);
      expect(column, name).toBeDefined();
      expect(column!.getSQLType()).toBe(sqlType);
      expect(column!.notNull).toBe(false);
      expect(column!.hasDefault).toBe(false);
    }
  });
});
```

### 5. Integration oracle

Create `apps/api/test/rls/lead-contact-fields-migration.test.ts`:

```ts
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
```

### 6. Keep the existing column enumeration true

In `apps/api/test/rls/leads-schema-migration.test.ts`, test `declares sales_ops_leads with an integer-cents estimate, a nullable sale_id and a non-null stage_changed_at`, replace the single line

```ts
      { column_name: 'contact_name', data_type: 'text', is_nullable: 'NO' },
```

with these four lines (the list is ordered by `column_name`, and `contact_birth_date < contact_email < contact_name < contact_phone` holds in both C and en_US collation):

```ts
      { column_name: 'contact_birth_date', data_type: 'date', is_nullable: 'YES' },
      { column_name: 'contact_email', data_type: 'text', is_nullable: 'YES' },
      { column_name: 'contact_name', data_type: 'text', is_nullable: 'NO' },
      { column_name: 'contact_phone', data_type: 'text', is_nullable: 'YES' },
```

Change nothing else in that file.

## Verification (run-once only)

From the repo root:

```bash
pnpm --filter @fxl-sales/api exec vitest run src/db/__tests__/lead-contact-fields-schema.test.ts
pnpm --filter @fxl-sales/api test:integration -- test/rls/lead-contact-fields-migration.test.ts test/rls/leads-schema-migration.test.ts
pnpm --filter @fxl-sales/api test:integration
pnpm --filter @fxl-sales/api test
pnpm --filter @fxl-sales/api lint
pnpm --filter @fxl-sales/api type-check
pnpm --filter @fxl-sales/api exec drizzle-kit generate --name drift_check
git status --short apps/api/drizzle
```

The last two must show no new migration file (only the three files from step 2 changed).
Red-before-green: run the two oracle files BEFORE step 1 to see them fail (missing file / missing columns), then after step 6 to see them pass.
If the local test DB container is down, start it with `make db-up` (it is the project's own compose service on port 5006) and stop nothing you did not start.

## Notes for the executor

- The local test DB is SHARED across worktrees. Once this slice's integration run applies 0027, any other worktree whose `_journal.json` lacks 0027 fails `global-setup.ts` with `applied migration timestamp ... is not in the journal`. Merge this slice before any sibling runs `test:integration`, and rebase siblings onto it.
- The SEAM-CONTRACT shows one `ALTER TABLE ... ADD COLUMN a, ADD COLUMN b, ADD COLUMN c;`. The repo convention (drizzle-kit, as 0026) is three single-column statements separated by breakpoints; they run in the SAME transaction under the ordinary runner, so the effect is identical. This plan follows the repo tooling, as section 3 itself requires.
- Do not edit `nexo/knowledge/reference/*.md` here; slice 04 records the rule once the columns are read and written.
