import { randomUUID } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import postgres from 'postgres';
import { afterEach, describe, expect, it } from 'vitest';
import {
  type MigrationPhaseEvent,
  runDatabaseMigrations,
} from '../../src/db/migration-runner.js';

type SqlClient = ReturnType<typeof postgres>;

type ScratchDatabase = {
  admin: SqlClient;
  adminScratch: SqlClient;
  clients: Set<SqlClient>;
  databaseCreated: boolean;
  databaseName: string;
  ownerUrl: string;
  roleCreated: boolean;
  roleName: string;
};

type BaselineFixture = {
  ambiguousPayableId: string;
  candidateCount: number;
  orgId: string;
  payableId: string;
  professionalId: string;
  saleId: string;
};

const identifierPattern = /^[a-z0-9_]+$/;
const migrationsFolder = resolve(process.cwd(), 'drizzle');
const scratches: ScratchDatabase[] = [];

type ScratchSetupTestControls = {
  failAfterDatabaseCreate?: Error;
  onIdentityCreated?: (identity: { databaseName: string; roleName: string }) => void;
};

type Deferred = {
  promise: Promise<void>;
  resolve: () => void;
};

const remainingCandidateSql = `
SELECT count(*)::integer AS count
FROM "sales_ops_payables" p
INNER JOIN "sales_ops_sale_professionals" sp
  ON sp."org_id" = p."org_id"
 AND sp."sale_id" = p."sale_id"
 AND sp."person_name_snapshot" = p."beneficiary_name"
WHERE p."kind" = 'professional_cost'
  AND p."sale_professional_id" IS NULL
  AND NOT EXISTS (
    SELECT 1
    FROM "sales_ops_sale_professionals" other
    WHERE other."org_id" = sp."org_id"
      AND other."sale_id" = sp."sale_id"
      AND other."person_name_snapshot" = sp."person_name_snapshot"
      AND other."id" <> sp."id"
  )
`;

function exactIdentifier(value: string): string {
  if (!identifierPattern.test(value)) {
    throw new Error(`unsafe PostgreSQL identifier: ${value}`);
  }
  return `"${value}"`;
}

function databaseUrl(
  source: string,
  databaseName: string,
  credentials?: { password: string; username: string },
): string {
  const url = new URL(source);
  url.pathname = `/${databaseName}`;
  if (credentials) {
    url.username = credentials.username;
    url.password = credentials.password;
  }
  return url.toString();
}

function migrationAdminUrl(): string {
  return (
    process.env.TEST_MIGRATE_DATABASE_URL ??
    process.env.TEST_DATABASE_URL ??
    process.env.DATABASE_URL ??
    'postgresql://postgres:postgres@localhost:5006/fxl_sales'
  );
}

async function attemptCleanup(
  errors: unknown[],
  cleanup: () => Promise<unknown>,
): Promise<void> {
  try {
    await cleanup();
  } catch (error) {
    errors.push(error);
  }
}

function deferred(): Deferred {
  let resolvePromise: (() => void) | undefined;
  const promise = new Promise<void>((resolveValue) => {
    resolvePromise = resolveValue;
  });
  return {
    promise,
    resolve: () => resolvePromise?.(),
  };
}

async function createScratchDatabase(
  testControls: ScratchSetupTestControls = {},
): Promise<ScratchDatabase> {
  const suffix = randomUUID().replaceAll('-', '');
  const databaseName = `fxl_sales_migration_${suffix}`;
  const roleName = `fxl_sales_migrator_${suffix}`;
  const password = randomUUID().replaceAll('-', '');
  const sourceUrl = migrationAdminUrl();
  const admin = postgres(databaseUrl(sourceUrl, 'postgres'), { max: 1 });
  const ownerUrl = databaseUrl(sourceUrl, databaseName, {
    password,
    username: roleName,
  });
  const scratch: ScratchDatabase = {
    admin,
    adminScratch: postgres(databaseUrl(sourceUrl, databaseName), { max: 2 }),
    clients: new Set<SqlClient>(),
    databaseCreated: false,
    databaseName,
    ownerUrl,
    roleCreated: false,
    roleName,
  };
  scratches.push(scratch);
  testControls.onIdentityCreated?.({ databaseName, roleName });

  try {
    await admin.unsafe(
      `CREATE ROLE ${exactIdentifier(roleName)} LOGIN PASSWORD '${password}' NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`,
    );
    scratch.roleCreated = true;
    await admin.unsafe(
      `CREATE DATABASE ${exactIdentifier(databaseName)} OWNER ${exactIdentifier(roleName)}`,
    );
    scratch.databaseCreated = true;
    if (testControls.failAfterDatabaseCreate) {
      throw testControls.failAfterDatabaseCreate;
    }

    const [role] = await admin<
      Array<{ rolbypassrls: boolean; rolsuper: boolean }>
    >`SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = ${roleName}`;
    expect(role).toEqual({ rolbypassrls: false, rolsuper: false });

    return scratch;
  } catch (error) {
    const scratchIndex = scratches.indexOf(scratch);
    if (scratchIndex >= 0) scratches.splice(scratchIndex, 1);
    await cleanupScratch(scratch);
    throw error;
  }
}

function scratchClient(scratch: ScratchDatabase, max = 1): SqlClient {
  const client = postgres(scratch.ownerUrl, { max });
  scratch.clients.add(client);
  return client;
}

async function cleanupScratch(scratch: ScratchDatabase): Promise<unknown[]> {
  const errors: unknown[] = [];
  for (const client of scratch.clients) {
    await attemptCleanup(errors, () => client.end({ timeout: 1 }));
  }
  await attemptCleanup(errors, () => scratch.adminScratch.end({ timeout: 1 }));
  if (scratch.databaseCreated) {
    await attemptCleanup(errors, () => scratch.admin`
      SELECT pg_terminate_backend(pid)
      FROM pg_stat_activity
      WHERE datname = ${scratch.databaseName}
        AND pid <> pg_backend_pid()
    `);
    await attemptCleanup(errors, () =>
      scratch.admin.unsafe(
        `DROP DATABASE IF EXISTS ${exactIdentifier(scratch.databaseName)}`,
      ),
    );
  }
  if (scratch.roleCreated) {
    await attemptCleanup(errors, () =>
      scratch.admin.unsafe(`DROP ROLE IF EXISTS ${exactIdentifier(scratch.roleName)}`),
    );
  }
  await attemptCleanup(errors, () => scratch.admin.end({ timeout: 1 }));
  return errors;
}

async function candidateCount(client: SqlClient, withAdminContext: boolean): Promise<number> {
  if (!withAdminContext) {
    const [row] = await client.unsafe<Array<{ count: number }>>(remainingCandidateSql);
    return row?.count ?? -1;
  }

  return client.begin(async (transaction) => {
    await transaction`SELECT set_config('app.fxl_admin', 'true', true)`;
    const [row] = await transaction.unsafe<Array<{ count: number }>>(remainingCandidateSql);
    return row?.count ?? -1;
  });
}

async function populateBaseline(
  scratch: ScratchDatabase,
  candidateTotal = 10000,
): Promise<BaselineFixture> {
  await runDatabaseMigrations({
    databaseUrl: scratch.ownerUrl,
    migrationsFolder,
    throughTag: '0017_professional_payment_split',
  });

  const owner = scratchClient(scratch);
  return owner.begin(async (transaction) => {
    await transaction`SELECT set_config('app.fxl_admin', 'true', true)`;
    const orgId = `org_migration_${randomUUID()}`;
    const [sale] = await transaction<Array<{ id: string }>>`
      INSERT INTO sales_ops_sales (
        org_id, sequence, code, client_name_snapshot, seller_name_snapshot,
        status, payment_method, condition, installments, base_date, total_brl,
        recurring_brl, seller_commission_pct, finder_commission_pct, tax_pct,
        other_costs_brl, net_margin_pct
      ) VALUES (
        ${orgId}, 1, '0001-0', 'Cliente Migração', 'Vendedor Migração',
        'won', 'pix', 'installments', 1, now(), 1000000,
        0, 10, 3, 6, 0, 0
      )
      RETURNING id
    `;
    if (!sale) throw new Error('failed to create populated migration sale');

    const [professional] = await transaction<Array<{ id: string }>>`
      INSERT INTO sales_ops_sale_professionals (
        org_id, sale_id, person_name_snapshot, role, cost_brl
      ) VALUES (${orgId}, ${sale.id}, 'Profissional Único', 'Desenvolvimento', 40000)
      RETURNING id
    `;
    if (!professional) throw new Error('failed to create populated migration professional');

    const [payable] = await transaction<Array<{ id: string }>>`
      INSERT INTO sales_ops_payables (
        org_id, sale_id, beneficiary_name, kind, due_date, amount_brl, status
      )
      SELECT
        ${orgId}, ${sale.id}, 'Profissional Único', 'professional_cost',
        now() + make_interval(days => generated.day_number), 40000, 'open'
      FROM generate_series(1, ${candidateTotal}) AS generated(day_number)
      RETURNING id
    `;
    if (!payable) throw new Error('failed to create populated migration payables');

    const ambiguousOrgId = `org_migration_ambiguous_${randomUUID()}`;
    const [ambiguousSale] = await transaction<Array<{ id: string }>>`
      INSERT INTO sales_ops_sales (
        org_id, sequence, code, client_name_snapshot, seller_name_snapshot,
        status, payment_method, condition, installments, base_date, total_brl,
        recurring_brl, seller_commission_pct, finder_commission_pct, tax_pct,
        other_costs_brl, net_margin_pct
      ) VALUES (
        ${ambiguousOrgId}, 1, '0001-0', 'Cliente Ambíguo', 'Vendedor Migração',
        'won', 'pix', 'installments', 1, now(), 1000000,
        0, 10, 3, 6, 0, 0
      )
      RETURNING id
    `;
    if (!ambiguousSale) throw new Error('failed to create ambiguous migration sale');
    await transaction`
      INSERT INTO sales_ops_sale_professionals (
        org_id, sale_id, person_name_snapshot, role, cost_brl
      ) VALUES
        (${ambiguousOrgId}, ${ambiguousSale.id}, 'Nome Repetido', 'Design', 10000),
        (${ambiguousOrgId}, ${ambiguousSale.id}, 'Nome Repetido', 'Design', 10000)
    `;
    const [ambiguousPayable] = await transaction<Array<{ id: string }>>`
      INSERT INTO sales_ops_payables (
        org_id, sale_id, beneficiary_name, kind, due_date, amount_brl, status
      ) VALUES (
        ${ambiguousOrgId}, ${ambiguousSale.id}, 'Nome Repetido',
        'professional_cost', now(), 10000, 'paid'
      )
      RETURNING id
    `;
    if (!ambiguousPayable) throw new Error('failed to create ambiguous migration payable');

    return {
      ambiguousPayableId: ambiguousPayable.id,
      candidateCount: candidateTotal,
      orgId,
      payableId: payable.id,
      professionalId: professional.id,
      saleId: sale.id,
    };
  });
}

async function createLockProbeMigrationFolder(): Promise<string> {
  const folder = await mkdtemp(join(tmpdir(), 'fxl-sales-lock-migrations-'));
  await mkdir(join(folder, 'meta'));
  await writeFile(
    join(folder, 'meta/_journal.json'),
    JSON.stringify({
      dialect: 'postgresql',
      entries: [
        { breakpoints: true, idx: 0, tag: '0000_lock_owner', version: '7', when: 1 },
        { breakpoints: true, idx: 1, tag: '0001_lock_contender', version: '7', when: 2 },
      ],
      version: '7',
    }),
  );
  await writeFile(
    join(folder, '0000_lock_owner.sql'),
    [
      'CREATE TABLE migration_lock_probe(marker text);',
      '--> statement-breakpoint',
      "INSERT INTO migration_lock_probe VALUES ('owner');",
    ].join('\n'),
  );
  await writeFile(
    join(folder, '0001_lock_contender.sql'),
    "INSERT INTO migration_lock_probe VALUES ('contender');",
  );
  return folder;
}

async function waitFor(
  predicate: () => boolean | Promise<boolean>,
  timeoutMs: number,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!(await predicate())) {
    if (Date.now() >= deadline) throw new Error(`condition not met within ${timeoutMs}ms`);
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 10));
  }
}

afterEach(async () => {
  const cleanupErrors: unknown[] = [];
  for (const scratch of scratches.splice(0)) {
    cleanupErrors.push(...(await cleanupScratch(scratch)));
  }
  if (cleanupErrors.length > 0) {
    throw new AggregateError(cleanupErrors, 'scratch database cleanup failed');
  }
});

describe('phased professional payable identity migration', () => {
  it('removes the database, role, and admin connection after scratch setup fails', async () => {
    const sentinel = new Error('injected scratch setup failure');
    let identity: { databaseName: string; roleName: string } | undefined;

    await expect(
      createScratchDatabase({
        failAfterDatabaseCreate: sentinel,
        onIdentityCreated: (createdIdentity) => {
          identity = createdIdentity;
        },
      }),
    ).rejects.toBe(sentinel);
    if (!identity) throw new Error('scratch identity was not reported before setup failure');

    const verifier = postgres(databaseUrl(migrationAdminUrl(), 'postgres'), { max: 1 });
    try {
      const databases = await verifier`
        SELECT datname FROM pg_database WHERE datname = ${identity.databaseName}
      `;
      const roles = await verifier`
        SELECT rolname FROM pg_roles WHERE rolname = ${identity.roleName}
      `;
      expect(databases).toHaveLength(0);
      expect(roles).toHaveLength(0);
    } finally {
      await verifier.end();
    }
  });

  it('polls under real advisory-lock contention, then acquires after release', async () => {
    const scratch = await createScratchDatabase();
    const folder = await createLockProbeMigrationFolder();
    const ownerReady = deferred();
    const releaseOwner = deferred();
    const contenderPolled = deferred();
    let pollAttempts = 0;
    let ownerRun: Promise<unknown> | undefined;
    let contenderRun: Promise<unknown> | undefined;

    try {
      ownerRun = runDatabaseMigrations({
        databaseUrl: scratch.ownerUrl,
        migrationsFolder: folder,
        onPhaseComplete: async (event) => {
          if (event.tag !== '0000_lock_owner') return;
          ownerReady.resolve();
          await releaseOwner.promise;
        },
        throughTag: '0000_lock_owner',
      });
      await ownerReady.promise;

      contenderRun = runDatabaseMigrations({
        databaseUrl: scratch.ownerUrl,
        migrationsFolder: folder,
        testControls: {
          advisoryLockMaxAttempts: 100,
          advisoryLockRetryMs: 1,
          onAdvisoryLockPoll: () => {
            pollAttempts += 1;
            contenderPolled.resolve();
          },
        },
      });
      await Promise.race([
        contenderPolled.promise,
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('contender never completed a lock poll')), 1_000),
        ),
      ]);
      expect(pollAttempts).toBeGreaterThan(0);
      releaseOwner.resolve();
      await Promise.all([ownerRun, contenderRun]);

      const owner = scratchClient(scratch);
      const rows = await owner<Array<{ marker: string }>>`
        SELECT marker FROM migration_lock_probe ORDER BY marker
      `;
      const [journal] = await owner<Array<{ count: number }>>`
        SELECT count(*)::integer AS count FROM drizzle.__drizzle_migrations
      `;
      expect(rows).toEqual([{ marker: 'contender' }, { marker: 'owner' }]);
      expect(journal?.count).toBe(2);
    } finally {
      releaseOwner.resolve();
      await Promise.allSettled([ownerRun, contenderRun].filter(Boolean));
      await rm(folder, { force: true, recursive: true });
    }
  });

  it('terminates lock acquisition after the configured attempt budget without mutation', async () => {
    const scratch = await createScratchDatabase();
    const folder = await createLockProbeMigrationFolder();
    const ownerReady = deferred();
    const releaseOwner = deferred();
    let ownerRun: Promise<unknown> | undefined;
    let contenderRun: Promise<unknown> | undefined;

    try {
      ownerRun = runDatabaseMigrations({
        databaseUrl: scratch.ownerUrl,
        migrationsFolder: folder,
        onPhaseComplete: async (event) => {
          if (event.tag !== '0000_lock_owner') return;
          ownerReady.resolve();
          await releaseOwner.promise;
        },
        throughTag: '0000_lock_owner',
      });
      await ownerReady.promise;

      contenderRun = runDatabaseMigrations({
        databaseUrl: scratch.ownerUrl,
        migrationsFolder: folder,
        testControls: {
          advisoryLockMaxAttempts: 3,
          advisoryLockRetryMs: 1,
        },
      });
      await expect(
        Promise.race([
          contenderRun,
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error('lock acquisition did not terminate')), 1_000),
          ),
        ]),
      ).rejects.toThrow('migration advisory lock was not acquired after 3 attempts');

      const owner = scratchClient(scratch);
      const rows = await owner<Array<{ marker: string }>>`
        SELECT marker FROM migration_lock_probe ORDER BY marker
      `;
      const [journal] = await owner<Array<{ count: number }>>`
        SELECT count(*)::integer AS count FROM drizzle.__drizzle_migrations
      `;
      expect(rows).toEqual([{ marker: 'owner' }]);
      expect(journal?.count).toBe(1);
    } finally {
      releaseOwner.resolve();
      await Promise.allSettled([ownerRun, contenderRun].filter(Boolean));
      await rm(folder, { force: true, recursive: true });
    }
  });

  it('commits and rolls back ordinary migrations on one stable reserved backend', async () => {
    const scratch = await createScratchDatabase();
    const folder = await mkdtemp(join(tmpdir(), 'fxl-sales-migrations-'));
    const events: MigrationPhaseEvent[] = [];

    try {
      await mkdir(join(folder, 'meta'));
      await writeFile(
        join(folder, 'meta/_journal.json'),
        JSON.stringify({
          dialect: 'postgresql',
          entries: [
            { breakpoints: true, idx: 0, tag: '0000_commit_probe', version: '7', when: 1 },
            { breakpoints: true, idx: 1, tag: '0001_rollback_probe', version: '7', when: 2 },
          ],
          version: '7',
        }),
      );
      await writeFile(
        join(folder, '0000_commit_probe.sql'),
        [
          'CREATE TABLE migration_tx_probe(marker text, backend_pid integer);',
          '--> statement-breakpoint',
          "INSERT INTO migration_tx_probe VALUES ('committed', pg_backend_pid());",
        ].join('\n'),
      );
      await writeFile(
        join(folder, '0001_rollback_probe.sql'),
        [
          "INSERT INTO migration_tx_probe VALUES ('must_rollback', pg_backend_pid());",
          '--> statement-breakpoint',
          'CREATE TABLE migration_must_rollback(id integer);',
          '--> statement-breakpoint',
          'SELECT 1 / 0;',
        ].join('\n'),
      );

      const result = await runDatabaseMigrations({
        databaseUrl: scratch.ownerUrl,
        migrationsFolder: folder,
        onPhaseComplete: (event) => events.push(event),
        throughTag: '0000_commit_probe',
      });
      const owner = scratchClient(scratch);
      const [committed] = await owner<Array<{ backend_pid: number; marker: string }>>`
        SELECT marker, backend_pid FROM migration_tx_probe
      `;
      expect(committed).toEqual({ backend_pid: result.backendPid, marker: 'committed' });
      expect(events).toEqual([
        {
          backendPid: result.backendPid,
          phase: 'ordinary-commit',
          tag: '0000_commit_probe',
        },
      ]);
      const [firstJournal] = await owner<Array<{ count: number }>>`
        SELECT count(*)::integer AS count FROM drizzle.__drizzle_migrations
      `;
      expect(firstJournal?.count).toBe(1);

      await expect(
        runDatabaseMigrations({ databaseUrl: scratch.ownerUrl, migrationsFolder: folder }),
      ).rejects.toMatchObject({ code: '22012' });
      const rollbackRows = await owner`
        SELECT marker FROM migration_tx_probe WHERE marker = 'must_rollback'
      `;
      const [rollbackTable] = await owner<Array<{ name: string | null }>>`
        SELECT to_regclass('public.migration_must_rollback')::text AS name
      `;
      const [finalJournal] = await owner<Array<{ count: number }>>`
        SELECT count(*)::integer AS count FROM drizzle.__drizzle_migrations
      `;
      expect(rollbackRows).toHaveLength(0);
      expect(rollbackTable?.name).toBeNull();
      expect(finalJournal?.count).toBe(1);
    } finally {
      await rm(folder, { force: true, recursive: true });
    }
  }, 30_000);

  it('upgrades populated forced-RLS data in resumable phases while traffic continues', async () => {
    const scratch = await createScratchDatabase();
    const fixture = await populateBaseline(scratch);
    const owner = scratchClient(scratch);

    const traffic = scratchClient(scratch);
    let trafficRunning = true;
    let columnCommitted = false;
    let journalCommitted = false;
    let readsDuringMigration = 0;
    let writesDuringMigration = 0;
    const trafficErrors: unknown[] = [];
    const events: MigrationPhaseEvent[] = [];
    let blocker: SqlClient | undefined;
    let blockerReleasedAfterCommittedBatch = false;
    let lockedRowBackfilledBeforeJournal = false;

    const trafficPromise = (async () => {
      while (trafficRunning) {
        try {
          await traffic.begin(async (transaction) => {
            await transaction`SELECT set_config('app.current_org_id', ${fixture.orgId}, true)`;
            await transaction.unsafe("SET LOCAL lock_timeout = '2s'");
            await transaction`
              SELECT count(*) FROM sales_ops_payables WHERE org_id = ${fixture.orgId}
            `;
            if (columnCommitted && !journalCommitted) readsDuringMigration += 1;
            const beneficiary = `Canário ${randomUUID()}`;
            const [inserted] = await transaction<Array<{ id: string }>>`
              INSERT INTO sales_ops_payables (
                org_id, sale_id, beneficiary_name, kind, due_date, amount_brl, status
              ) VALUES (
                ${fixture.orgId}, ${fixture.saleId}, ${beneficiary},
                'other_cost', now(), 1, 'open'
              )
              RETURNING id
            `;
            if (!inserted) throw new Error('traffic canary insert returned no row');
            await transaction`
              DELETE FROM sales_ops_payables
              WHERE org_id = ${fixture.orgId} AND id = ${inserted.id}
            `;
            if (columnCommitted && !journalCommitted) writesDuringMigration += 1;
          });
        } catch (error) {
          trafficErrors.push(error);
          trafficRunning = false;
        }
        await new Promise((resolveDelay) => setTimeout(resolveDelay, 1));
      }
    })();

    try {
      const result = await runDatabaseMigrations({
        databaseUrl: scratch.ownerUrl,
        migrationsFolder,
        onPhaseComplete: async (event) => {
          events.push(event);
          if (event.phase === 'column') {
            columnCommitted = true;
            expect(await candidateCount(owner, false)).toBe(0);
            expect(await candidateCount(owner, true)).toBe(fixture.candidateCount);
            await waitFor(
              () => readsDuringMigration > 0 && writesDuringMigration > 0,
              5_000,
            );
          }
          if (event.phase === 'post-constraint') {
            const constraintProbe = scratchClient(scratch);
            await expect(
              constraintProbe.begin(async (transaction) => {
                await transaction`SELECT set_config('app.fxl_admin', 'true', true)`;
                await transaction`
                  INSERT INTO sales_ops_payables (
                    org_id, sale_id, sale_professional_id, beneficiary_name,
                    kind, due_date, amount_brl, status
                  ) VALUES (
                    ${fixture.orgId}, ${fixture.saleId}, ${randomUUID()}, 'FK Inválida',
                    'professional_cost', now(), 1, 'open'
                  )
                `;
              }),
            ).rejects.toMatchObject({ code: '23503' });

            blocker = scratchClient(scratch);
            await blocker.unsafe('BEGIN');
            await blocker`SELECT set_config('app.fxl_admin', 'true', true)`;
            await blocker`
              SELECT id FROM sales_ops_payables
              WHERE id = ${fixture.payableId}
              FOR UPDATE
            `;
          }
          if (
            event.phase === 'backfill-batch' &&
            (event.batchUpdated ?? 0) > 0 &&
            blocker &&
            !blockerReleasedAfterCommittedBatch
          ) {
            const [locked] = await blocker<Array<{ sale_professional_id: string | null }>>`
              SELECT sale_professional_id
              FROM sales_ops_payables
              WHERE id = ${fixture.payableId}
            `;
            expect(locked?.sale_professional_id).toBeNull();
            await blocker.unsafe('COMMIT');
            blockerReleasedAfterCommittedBatch = true;
          }
          if (event.phase === 'validate') {
            const probe = scratchClient(scratch);
            const state = await probe.begin(async (transaction) => {
              await transaction`SELECT set_config('app.fxl_admin', 'true', true)`;
              const [payable] = await transaction<
                Array<{ sale_professional_id: string | null }>
              >`
                SELECT sale_professional_id
                FROM sales_ops_payables
                WHERE id = ${fixture.payableId}
              `;
              const [journal] = await transaction<Array<{ count: number }>>`
                SELECT count(*)::integer AS count
                FROM drizzle.__drizzle_migrations
                WHERE created_at = 1785941449505
              `;
              return { journalCount: journal?.count, professionalId: payable?.sale_professional_id };
            });
            lockedRowBackfilledBeforeJournal =
              state.professionalId === fixture.professionalId && state.journalCount === 0;
          }
          if (event.phase === 'journal') journalCommitted = true;
        },
      });

      expect(new Set(events.map((event) => event.backendPid))).toEqual(
        new Set([result.backendPid]),
      );
    } finally {
      trafficRunning = false;
      if (blocker && !blockerReleasedAfterCommittedBatch) {
        await blocker.unsafe('ROLLBACK');
      }
      await trafficPromise;
    }

    expect(trafficErrors).toEqual([]);
    expect(readsDuringMigration).toBeGreaterThan(0);
    expect(writesDuringMigration).toBeGreaterThan(0);
    expect(blockerReleasedAfterCommittedBatch).toBe(true);
    expect(lockedRowBackfilledBeforeJournal).toBe(true);

    const [column] = await scratch.adminScratch<
      Array<{ is_nullable: 'NO' | 'YES' }>
    >`
      SELECT is_nullable
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'sales_ops_payables'
        AND column_name = 'sale_professional_id'
    `;
    expect(column?.is_nullable).toBe('YES');

    const indexes = await scratch.adminScratch<
      Array<{ indisvalid: boolean; relname: string }>
    >`
      SELECT index_class.relname, index.indisvalid
      FROM pg_index index
      JOIN pg_class index_class ON index_class.oid = index.indexrelid
      WHERE index_class.relname IN (
        'sales_ops_sale_professionals_org_sale_id_id_idx',
        'sales_ops_payables_sale_professional_id_idx'
      )
      ORDER BY index_class.relname
    `;
    expect(indexes).toEqual([
      { indisvalid: true, relname: 'sales_ops_payables_sale_professional_id_idx' },
      { indisvalid: true, relname: 'sales_ops_sale_professionals_org_sale_id_id_idx' },
    ]);

    const [constraint] = await scratch.adminScratch<
      Array<{ confdeltype: string; convalidated: boolean }>
    >`
      SELECT convalidated, confdeltype
      FROM pg_constraint
      WHERE conname = 'sales_ops_payables_org_sale_professional_fk'
    `;
    expect(constraint).toEqual({ confdeltype: 'r', convalidated: true });

    const completion = await owner.begin(async (transaction) => {
      await transaction`SELECT set_config('app.fxl_admin', 'true', true)`;
      const [linked] = await transaction<Array<{ count: number }>>`
        SELECT count(*)::integer AS count
        FROM sales_ops_payables
        WHERE org_id = ${fixture.orgId}
          AND sale_professional_id = ${fixture.professionalId}
      `;
      const [ambiguous] = await transaction<
        Array<{ sale_professional_id: string | null }>
      >`
        SELECT sale_professional_id
        FROM sales_ops_payables
        WHERE id = ${fixture.ambiguousPayableId}
      `;
      return { ambiguous: ambiguous?.sale_professional_id, linked: linked?.count };
    });
    expect(completion).toEqual({ ambiguous: null, linked: fixture.candidateCount });
    const [journal] = await owner<Array<{ count: number }>>`
      SELECT count(*)::integer AS count
      FROM drizzle.__drizzle_migrations
      WHERE created_at = 1785941449505
    `;
    expect(journal?.count).toBe(1);
  }, 120_000);

  it('retries an empty SKIP LOCKED batch and resumes after the only candidate unlocks', async () => {
    const scratch = await createScratchDatabase();
    const fixture = await populateBaseline(scratch, 1);
    const owner = scratchClient(scratch);
    const batchSizes: number[] = [];
    let blocker: SqlClient | undefined;
    let blockerOpen = false;

    try {
      await runDatabaseMigrations({
        databaseUrl: scratch.ownerUrl,
        migrationsFolder,
        onPhaseComplete: async (event) => {
          if (event.phase === 'column') {
            expect(await candidateCount(owner, false)).toBe(0);
            expect(await candidateCount(owner, true)).toBe(1);
          }
          if (event.phase === 'post-constraint') {
            blocker = scratchClient(scratch);
            await blocker.unsafe('BEGIN');
            blockerOpen = true;
            await blocker`SELECT set_config('app.fxl_admin', 'true', true)`;
            await blocker`
              SELECT id FROM sales_ops_payables
              WHERE id = ${fixture.payableId}
              FOR UPDATE
            `;
          }
          if (event.phase === 'backfill-batch') {
            batchSizes.push(event.batchUpdated ?? -1);
            if (event.batchUpdated === 0 && blockerOpen && blocker) {
              await blocker.unsafe('COMMIT');
              blockerOpen = false;
            }
          }
        },
        testControls: { backfillRetryMs: 1 },
      });
    } finally {
      if (blockerOpen && blocker) await blocker.unsafe('ROLLBACK');
    }

    expect(batchSizes).toEqual([0, 1, 0]);
    const completion = await owner.begin(async (transaction) => {
      await transaction`SELECT set_config('app.fxl_admin', 'true', true)`;
      const [payable] = await transaction<Array<{ sale_professional_id: string | null }>>`
        SELECT sale_professional_id FROM sales_ops_payables WHERE id = ${fixture.payableId}
      `;
      const [journal] = await transaction<Array<{ count: number }>>`
        SELECT count(*)::integer AS count
        FROM drizzle.__drizzle_migrations
        WHERE created_at = 1785941449505
      `;
      return { journalCount: journal?.count, professionalId: payable?.sale_professional_id };
    });
    expect(completion).toEqual({ journalCount: 1, professionalId: fixture.professionalId });
  }, 30_000);

  it('stops after 50 empty SKIP LOCKED batches and never journals incomplete work', async () => {
    const scratch = await createScratchDatabase();
    const fixture = await populateBaseline(scratch, 1);
    const owner = scratchClient(scratch);
    const batchSizes: number[] = [];
    let blocker: SqlClient | undefined;
    let blockerOpen = false;

    try {
      await expect(
        runDatabaseMigrations({
          databaseUrl: scratch.ownerUrl,
          migrationsFolder,
          onPhaseComplete: async (event) => {
            if (event.phase === 'column') {
              expect(await candidateCount(owner, false)).toBe(0);
              expect(await candidateCount(owner, true)).toBe(1);
            }
            if (event.phase === 'post-constraint') {
              blocker = scratchClient(scratch);
              await blocker.unsafe('BEGIN');
              blockerOpen = true;
              await blocker`SELECT set_config('app.fxl_admin', 'true', true)`;
              await blocker`
                SELECT id FROM sales_ops_payables
                WHERE id = ${fixture.payableId}
                FOR UPDATE
              `;
            }
            if (event.phase === 'backfill-batch') {
              batchSizes.push(event.batchUpdated ?? -1);
            }
          },
          testControls: {
            backfillMaxEmptyBatches: 50,
            backfillRetryMs: 0,
          },
        }),
      ).rejects.toThrow('professional payable backfill remained blocked after 50 empty batches');
    } finally {
      if (blockerOpen && blocker) {
        await blocker.unsafe('ROLLBACK');
        blockerOpen = false;
      }
    }

    expect(batchSizes).toHaveLength(50);
    expect(batchSizes.every((size) => size === 0)).toBe(true);
    const state = await owner.begin(async (transaction) => {
      await transaction`SELECT set_config('app.fxl_admin', 'true', true)`;
      const [payable] = await transaction<Array<{ sale_professional_id: string | null }>>`
        SELECT sale_professional_id FROM sales_ops_payables WHERE id = ${fixture.payableId}
      `;
      const [journal] = await transaction<Array<{ count: number }>>`
        SELECT count(*)::integer AS count
        FROM drizzle.__drizzle_migrations
        WHERE created_at = 1785941449505
      `;
      return { journalCount: journal?.count, professionalId: payable?.sale_professional_id };
    });
    expect(state).toEqual({ journalCount: 0, professionalId: null });
  }, 30_000);

  it('recovers an interrupted invalid concurrent index and serializes two runners', async () => {
    const scratch = await createScratchDatabase();
    await runDatabaseMigrations({
      databaseUrl: scratch.ownerUrl,
      migrationsFolder,
      throughTag: '0017_professional_payment_split',
    });
    const owner = scratchClient(scratch);
    await owner.unsafe(
      'ALTER TABLE "sales_ops_payables" ADD COLUMN IF NOT EXISTS "sale_professional_id" uuid',
    );

    const blocker = scratchClient(scratch);
    const indexClient = scratchClient(scratch);
    let blockerOpen = false;
    try {
      await blocker.unsafe('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
      blockerOpen = true;
      await blocker.unsafe('SELECT count(*) FROM sales_ops_sale_professionals');
      const [backend] = await indexClient<Array<{ pid: number }>>`SELECT pg_backend_pid() AS pid`;
      if (!backend) throw new Error('index backend PID was not returned');
      /*
        The rejection handler is attached HERE, at creation, and not at the
        `await` far below. `pg_cancel_backend` makes this statement reject while
        the assertion that consumes it is still several statements away, so a
        promise carrying no handler in that window is an unhandled rejection.
        It fails no test, because the assertion still runs and still passes, but
        it exits the runner NONZERO, which reads as a red integration gate for a
        suite in which every test passed. The window is timing dependent and
        widens under CPU load, so it appears on a busy machine and hides on an
        idle one.

        Settling into a tagged outcome rather than swallowing with `.catch(() => {})`
        keeps the claim intact: the assertions below still require this statement
        to have REJECTED, and to have rejected with 57014 specifically.
      */
      const indexOutcome = indexClient
        .unsafe(
          'CREATE UNIQUE INDEX CONCURRENTLY "sales_ops_sale_professionals_org_sale_id_id_idx" ON "sales_ops_sale_professionals" USING btree ("org_id","sale_id","id")',
        )
        .then(
          () => ({ rejected: false as const, error: undefined as unknown }),
          (error: unknown) => ({ rejected: true as const, error }),
        );

      try {
        await waitFor(async () => {
          const [state] = await scratch.adminScratch<
            Array<{
              indisvalid: boolean;
              state: string;
              wait_event: string | null;
              wait_event_type: string | null;
            }>
          >`
            SELECT index.indisvalid, activity.state,
                   activity.wait_event_type, activity.wait_event
            FROM pg_class index_class
            JOIN pg_index index ON index.indexrelid = index_class.oid
            JOIN pg_stat_activity activity ON activity.pid = ${backend.pid}
            WHERE index_class.relname = 'sales_ops_sale_professionals_org_sale_id_id_idx'
          `;
          return (
            state?.indisvalid === false &&
            state.state === 'active' &&
            state.wait_event_type === 'Lock' &&
            state.wait_event === 'virtualxid'
          );
        }, 5_000);
        const [cancelled] = await scratch.adminScratch<Array<{ cancelled: boolean }>>`
          SELECT pg_cancel_backend(${backend.pid}) AS cancelled
        `;
        expect(cancelled?.cancelled).toBe(true);
        const outcome = await indexOutcome;
        expect(outcome.rejected).toBe(true);
        expect(outcome.error).toMatchObject({ code: '57014' });
      } finally {
        await blocker.unsafe('ROLLBACK');
        blockerOpen = false;
      }
    } finally {
      if (blockerOpen) await blocker.unsafe('ROLLBACK');
    }

    const [invalidIndex] = await scratch.adminScratch<Array<{ indisvalid: boolean }>>`
      SELECT index.indisvalid
      FROM pg_class index_class
      JOIN pg_index index ON index.indexrelid = index_class.oid
      WHERE index_class.relname = 'sales_ops_sale_professionals_org_sale_id_id_idx'
    `;
    expect(invalidIndex?.indisvalid).toBe(false);

    await Promise.all([
      runDatabaseMigrations({ databaseUrl: scratch.ownerUrl, migrationsFolder }),
      runDatabaseMigrations({ databaseUrl: scratch.ownerUrl, migrationsFolder }),
    ]);

    const indexes = await scratch.adminScratch<Array<{ indisvalid: boolean }>>`
      SELECT index.indisvalid
      FROM pg_class index_class
      JOIN pg_index index ON index.indexrelid = index_class.oid
      WHERE index_class.relname IN (
        'sales_ops_sale_professionals_org_sale_id_id_idx',
        'sales_ops_payables_sale_professional_id_idx'
      )
    `;
    expect(indexes).toHaveLength(2);
    expect(indexes.every((index) => index.indisvalid)).toBe(true);
    const [constraint] = await scratch.adminScratch<Array<{ convalidated: boolean }>>`
      SELECT convalidated
      FROM pg_constraint
      WHERE conname = 'sales_ops_payables_org_sale_professional_fk'
    `;
    expect(constraint?.convalidated).toBe(true);
    const [journal] = await scratch.adminScratch<Array<{ count: number }>>`
      SELECT count(*)::integer AS count
      FROM drizzle.__drizzle_migrations
      WHERE created_at = 1785941449505
    `;
    expect(journal?.count).toBe(1);
  }, 60_000);

  it('keeps the journal timestamp and phased SQL source authoritative for migration 0018', async () => {
    const journal = JSON.parse(
      await readFile(resolve(migrationsFolder, 'meta/_journal.json'), 'utf8'),
    ) as { entries: Array<{ tag: string; when: number }> };
    const entry = journal.entries.find(
      (candidate) => candidate.tag === '0018_professional_payable_identity',
    );
    expect(entry?.when).toBe(1785941449505);
    await expect(
      readFile(resolve(migrationsFolder, '0018_professional_payable_identity.sql'), 'utf8'),
    ).resolves.toContain('-- fxl-migration-mode: phased');
  });
});
