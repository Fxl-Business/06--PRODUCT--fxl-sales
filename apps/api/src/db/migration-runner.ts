import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import postgres from 'postgres';

export type MigrationPhase =
  | 'ordinary-commit'
  | 'column'
  | 'target-index'
  | 'source-index'
  | 'post-constraint'
  | 'backfill-batch'
  | 'validate'
  | 'journal';

export type MigrationPhaseEvent = {
  phase: MigrationPhase;
  tag: string;
  backendPid: number;
  batchUpdated?: number;
};

export type RunDatabaseMigrationsResult = {
  backendPid: number;
};

export type RunDatabaseMigrationsOptions = {
  databaseUrl: string;
  migrationsFolder: string;
  throughTag?: string;
  onPhaseComplete?: (event: MigrationPhaseEvent) => void | Promise<void>;
};

type PostgresClient = ReturnType<typeof postgres>;
type ReservedSql = Awaited<ReturnType<PostgresClient['reserve']>>;

type JournalEntry = {
  breakpoints: boolean;
  idx: number;
  tag: string;
  version: string;
  when: number;
};

type LoadedMigration = JournalEntry & {
  hash: string;
  source: string;
  statements: string[];
  phases?: Map<PhasedMarker, string>;
};

type PhasedMarker =
  | 'column'
  | 'target-index'
  | 'source-index'
  | 'constraint'
  | 'backfill-context'
  | 'backfill-repeat'
  | 'validate';

const phasedTag = '0018_professional_payable_identity';
const phasedHeader = '-- fxl-migration-mode: phased';
const phasedMarkers: PhasedMarker[] = [
  'column',
  'target-index',
  'source-index',
  'constraint',
  'backfill-context',
  'backfill-repeat',
  'validate',
];
const transactionOpen = new WeakSet<object>();

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

async function withReservedTransaction<T>(
  reserved: ReservedSql,
  work: (transaction: ReservedSql) => Promise<T>,
): Promise<T> {
  await reserved.unsafe('BEGIN');
  transactionOpen.add(reserved);
  try {
    const value = await work(reserved);
    await reserved.unsafe('COMMIT');
    transactionOpen.delete(reserved);
    return value;
  } catch (error) {
    try {
      await reserved.unsafe('ROLLBACK');
      transactionOpen.delete(reserved);
    } catch (rollbackError) {
      throw new AggregateError(
        [error, rollbackError],
        'migration transaction rollback failed',
      );
    }
    throw error;
  }
}

function phaseMarker(statement: string): string | undefined {
  return statement.match(/^\s*-- fxl-phase: ([a-z-]+)$/m)?.[1];
}

function parsePhasedMigration(source: string, statements: string[]): Map<PhasedMarker, string> {
  if (!source.startsWith(`${phasedHeader}\n`)) {
    throw new Error(`${phasedTag} must start with ${phasedHeader}`);
  }
  const observedMarkers = statements.map(phaseMarker);
  if (
    observedMarkers.length !== phasedMarkers.length ||
    observedMarkers.some((marker, index) => marker !== phasedMarkers[index])
  ) {
    throw new Error(
      `${phasedTag} must contain the exact ordered phase markers: ${phasedMarkers.join(', ')}`,
    );
  }
  return new Map(
    phasedMarkers.map((marker, index) => [marker, statements[index] as string]),
  );
}

async function loadMigrations(folder: string): Promise<LoadedMigration[]> {
  const journalPath = resolve(folder, 'meta/_journal.json');
  let journalSource: string;
  try {
    journalSource = await readFile(journalPath, 'utf8');
  } catch {
    throw new Error(`Can't find meta/_journal.json file in ${folder}`);
  }
  const journal = JSON.parse(journalSource) as { entries?: JournalEntry[] };
  if (!Array.isArray(journal.entries)) throw new Error('migration journal entries are missing');

  const entries = [...journal.entries].sort((left, right) => left.idx - right.idx);
  const indexes = new Set<number>();
  const tags = new Set<string>();
  let previousTimestamp = Number.NEGATIVE_INFINITY;
  for (const entry of entries) {
    if (indexes.has(entry.idx)) throw new Error(`duplicate migration index ${entry.idx}`);
    if (tags.has(entry.tag)) throw new Error(`duplicate migration tag ${entry.tag}`);
    if (entry.when <= previousTimestamp) {
      throw new Error(`migration ${entry.tag} has a non-monotonic timestamp`);
    }
    indexes.add(entry.idx);
    tags.add(entry.tag);
    previousTimestamp = entry.when;
  }

  return Promise.all(
    entries.map(async (entry) => {
      const migrationPath = resolve(folder, `${entry.tag}.sql`);
      let source: string;
      try {
        source = await readFile(migrationPath, 'utf8');
      } catch {
        throw new Error(`No file ${migrationPath} found in ${folder} folder`);
      }
      const statements = source.split('--> statement-breakpoint');
      const allMarkers = [...source.matchAll(/^\s*-- fxl-phase: ([a-z-]+)$/gm)].map(
        (match) => match[1],
      );
      const unknownMarker = allMarkers.find(
        (marker) => !phasedMarkers.includes(marker as PhasedMarker),
      );
      if (unknownMarker) throw new Error(`unknown migration phase marker ${unknownMarker}`);

      const declaresPhased = source.startsWith(`${phasedHeader}\n`);
      if (declaresPhased && entry.tag !== phasedTag) {
        throw new Error(`phased migration tag is not supported: ${entry.tag}`);
      }
      if (!declaresPhased && allMarkers.length > 0) {
        throw new Error(`migration ${entry.tag} has phase markers without the phased header`);
      }

      return {
        ...entry,
        hash: createHash('sha256').update(source).digest('hex'),
        phases: declaresPhased ? parsePhasedMigration(source, statements) : undefined,
        source,
        statements,
      };
    }),
  );
}

async function assertBackendPid(reserved: ReservedSql, expectedPid: number): Promise<void> {
  const [row] = await reserved<Array<{ pid: number }>>`SELECT pg_backend_pid() AS pid`;
  if (row?.pid !== expectedPid) {
    throw new Error(`migration backend changed from ${expectedPid} to ${String(row?.pid)}`);
  }
}

async function acquireMigrationLock(
  reserved: ReservedSql,
  backendPid: number,
): Promise<void> {
  while (true) {
    const [lock] = await reserved<Array<{ acquired: boolean }>>`
      SELECT pg_try_advisory_lock(hashtext('fxl-sales:database-migrations')) AS acquired
    `;
    if (lock?.acquired) return;
    await assertBackendPid(reserved, backendPid);
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 100));
  }
}

async function runCheckedTransaction<T>(
  reserved: ReservedSql,
  backendPid: number,
  work: (transaction: ReservedSql) => Promise<T>,
): Promise<T> {
  await assertBackendPid(reserved, backendPid);
  const value = await withReservedTransaction(reserved, work);
  await assertBackendPid(reserved, backendPid);
  return value;
}

async function runAutocommitPhase(
  reserved: ReservedSql,
  backendPid: number,
  statement: string,
): Promise<void> {
  await assertBackendPid(reserved, backendPid);
  await reserved.unsafe(statement);
  await assertBackendPid(reserved, backendPid);
}

async function runLockBoundedPhase(
  reserved: ReservedSql,
  backendPid: number,
  statement: string,
): Promise<void> {
  await assertBackendPid(reserved, backendPid);
  await reserved.unsafe("SET lock_timeout = '5s'");
  try {
    await reserved.unsafe(statement);
  } finally {
    await reserved.unsafe('RESET lock_timeout');
  }
  await assertBackendPid(reserved, backendPid);
}

async function emitPhase(
  options: RunDatabaseMigrationsOptions,
  event: MigrationPhaseEvent,
): Promise<void> {
  await options.onPhaseComplete?.(event);
}

async function ensureConcurrentIndex(
  reserved: ReservedSql,
  backendPid: number,
  indexName: string,
  createStatement: string,
): Promise<void> {
  await assertBackendPid(reserved, backendPid);
  const [index] = await reserved<Array<{ indisvalid: boolean }>>`
    SELECT pg_index.indisvalid
    FROM pg_class
    JOIN pg_namespace ON pg_namespace.oid = pg_class.relnamespace
    JOIN pg_index ON pg_index.indexrelid = pg_class.oid
    WHERE pg_namespace.nspname = 'public'
      AND pg_class.relname = ${indexName}
  `;
  if (index?.indisvalid) {
    await assertBackendPid(reserved, backendPid);
    return;
  }
  if (index) {
    await reserved.unsafe(`DROP INDEX CONCURRENTLY IF EXISTS "${indexName}"`);
  }
  await reserved.unsafe(createStatement);
  await assertBackendPid(reserved, backendPid);
}

async function constraintExists(reserved: ReservedSql): Promise<boolean> {
  const [constraint] = await reserved<Array<{ exists: boolean }>>`
    SELECT true AS exists
    FROM pg_constraint
    JOIN pg_class ON pg_class.oid = pg_constraint.conrelid
    JOIN pg_namespace ON pg_namespace.oid = pg_class.relnamespace
    WHERE pg_namespace.nspname = 'public'
      AND pg_class.relname = 'sales_ops_payables'
      AND pg_constraint.conname = 'sales_ops_payables_org_sale_professional_fk'
  `;
  return constraint?.exists === true;
}

async function remainingCandidateCount(transaction: ReservedSql): Promise<number> {
  const [row] = await transaction.unsafe<Array<{ count: number }>>(remainingCandidateSql);
  if (!row) throw new Error('remaining professional payable candidate count returned no row');
  return row.count;
}

async function assertPhasedStateComplete(reserved: ReservedSql): Promise<void> {
  const indexes = await reserved<Array<{ indisvalid: boolean; relname: string }>>`
    SELECT index_class.relname, pg_index.indisvalid
    FROM pg_index
    JOIN pg_class index_class ON index_class.oid = pg_index.indexrelid
    JOIN pg_namespace ON pg_namespace.oid = index_class.relnamespace
    WHERE pg_namespace.nspname = 'public'
      AND index_class.relname IN (
        'sales_ops_sale_professionals_org_sale_id_id_idx',
        'sales_ops_payables_sale_professional_id_idx'
      )
  `;
  if (indexes.length !== 2 || indexes.some((index) => !index.indisvalid)) {
    throw new Error('professional payable migration indexes are incomplete or invalid');
  }
  const [constraint] = await reserved<Array<{ convalidated: boolean }>>`
    SELECT convalidated
    FROM pg_constraint
    JOIN pg_class ON pg_class.oid = pg_constraint.conrelid
    JOIN pg_namespace ON pg_namespace.oid = pg_class.relnamespace
    WHERE pg_namespace.nspname = 'public'
      AND pg_class.relname = 'sales_ops_payables'
      AND pg_constraint.conname = 'sales_ops_payables_org_sale_professional_fk'
  `;
  if (!constraint?.convalidated) {
    throw new Error('professional payable migration foreign key is not validated');
  }
}

async function runPhasedMigration(
  reserved: ReservedSql,
  backendPid: number,
  migration: LoadedMigration,
  options: RunDatabaseMigrationsOptions,
): Promise<void> {
  const phases = migration.phases;
  if (!phases) throw new Error(`${migration.tag} is missing its phased SQL contract`);
  const phaseStatement = (phase: PhasedMarker): string => {
    const statement = phases.get(phase);
    if (statement === undefined) throw new Error(`${migration.tag} is missing phase ${phase}`);
    return statement;
  };
  const event = (phase: MigrationPhase, batchUpdated?: number): MigrationPhaseEvent => ({
    backendPid,
    ...(batchUpdated === undefined ? {} : { batchUpdated }),
    phase,
    tag: migration.tag,
  });

  await runLockBoundedPhase(reserved, backendPid, phaseStatement('column'));
  await emitPhase(options, event('column'));

  await ensureConcurrentIndex(
    reserved,
    backendPid,
    'sales_ops_sale_professionals_org_sale_id_id_idx',
    phaseStatement('target-index'),
  );
  await emitPhase(options, event('target-index'));

  await ensureConcurrentIndex(
    reserved,
    backendPid,
    'sales_ops_payables_sale_professional_id_idx',
    phaseStatement('source-index'),
  );
  await emitPhase(options, event('source-index'));

  await assertBackendPid(reserved, backendPid);
  if (!(await constraintExists(reserved))) {
    await runLockBoundedPhase(reserved, backendPid, phaseStatement('constraint'));
  }
  await assertBackendPid(reserved, backendPid);
  await emitPhase(options, event('post-constraint'));

  let consecutiveEmptyBatches = 0;
  while (true) {
    const batch = await runCheckedTransaction(reserved, backendPid, async (transaction) => {
      await transaction.unsafe(phaseStatement('backfill-context'));
      const updated = await transaction.unsafe<Array<{ id: string }>>(
        phaseStatement('backfill-repeat'),
      );
      const remaining = updated.length === 0 ? await remainingCandidateCount(transaction) : -1;
      return { remaining, updated: updated.length };
    });
    await emitPhase(options, event('backfill-batch', batch.updated));
    if (batch.updated > 0) {
      consecutiveEmptyBatches = 0;
      continue;
    }
    if (batch.remaining === 0) break;
    consecutiveEmptyBatches += 1;
    if (consecutiveEmptyBatches > 50) {
      throw new Error('professional payable backfill remained blocked after 50 retries');
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 100));
  }

  await runAutocommitPhase(reserved, backendPid, phaseStatement('validate'));
  await emitPhase(options, event('validate'));

  await assertPhasedStateComplete(reserved);
  await runCheckedTransaction(reserved, backendPid, async (transaction) => {
    await transaction.unsafe(phaseStatement('backfill-context'));
    if ((await remainingCandidateCount(transaction)) !== 0) {
      throw new Error('professional payable backfill is incomplete before journaling');
    }
    const recorded = await transaction<Array<{ hash: string }>>`
      SELECT hash
      FROM drizzle.__drizzle_migrations
      WHERE created_at = ${migration.when}
    `;
    if (recorded.length > 1) {
      throw new Error(`migration timestamp ${migration.when} has duplicate journal rows`);
    }
    if (recorded[0] && recorded[0].hash !== migration.hash) {
      throw new Error(`migration timestamp ${migration.when} has a different journal hash`);
    }
    if (recorded.length === 0) {
      await transaction`
        INSERT INTO drizzle.__drizzle_migrations (hash, created_at)
        VALUES (${migration.hash}, ${migration.when})
      `;
    }
  });
  await emitPhase(options, event('journal'));
}

async function appliedMigrationTimestamp(
  reserved: ReservedSql,
  migrations: LoadedMigration[],
): Promise<number | undefined> {
  const rows = await reserved<Array<{ created_at: string }>>`
    SELECT created_at
    FROM drizzle.__drizzle_migrations
    ORDER BY created_at ASC
  `;
  if (rows.length === 0) return undefined;

  const migrationsByTimestamp = new Map(
    migrations.map((migration) => [migration.when, migration]),
  );
  const appliedTimestamps = new Set<number>();
  for (const row of rows) {
    const timestamp = Number(row.created_at);
    const migration = migrationsByTimestamp.get(timestamp);
    if (!migration) throw new Error(`applied migration timestamp ${timestamp} is not in the journal`);
    if (appliedTimestamps.has(timestamp)) {
      throw new Error(`migration timestamp ${timestamp} has duplicate journal rows`);
    }
    appliedTimestamps.add(timestamp);
  }

  const latest = Math.max(...appliedTimestamps);
  const missingPrefix = migrations.find(
    (migration) => migration.when <= latest && !appliedTimestamps.has(migration.when),
  );
  if (missingPrefix) {
    throw new Error(`applied migration journal is missing prefix ${missingPrefix.tag}`);
  }
  return latest;
}

export async function runDatabaseMigrations(
  options: RunDatabaseMigrationsOptions,
): Promise<RunDatabaseMigrationsResult> {
  const migrations = await loadMigrations(options.migrationsFolder);
  const throughIndex = options.throughTag
    ? migrations.findIndex((migration) => migration.tag === options.throughTag)
    : migrations.length - 1;
  if (options.throughTag && throughIndex === -1) {
    throw new Error(`unknown throughTag ${options.throughTag}`);
  }

  const client = postgres(options.databaseUrl, { max: 1 });
  let reserved: ReservedSql | undefined;
  let backendPid: number | undefined;
  let advisoryLocked = false;
  let primaryError: unknown;
  let result: RunDatabaseMigrationsResult | undefined;
  const cleanupErrors: unknown[] = [];

  try {
    reserved = await client.reserve();
    const [backend] = await reserved<Array<{ pid: number }>>`SELECT pg_backend_pid() AS pid`;
    if (!backend) throw new Error('migration backend PID was not returned');
    backendPid = backend.pid;
    await acquireMigrationLock(reserved, backendPid);
    advisoryLocked = true;
    await assertBackendPid(reserved, backendPid);

    await reserved.unsafe('CREATE SCHEMA IF NOT EXISTS drizzle');
    await reserved.unsafe(`
      CREATE TABLE IF NOT EXISTS drizzle.__drizzle_migrations (
        id SERIAL PRIMARY KEY,
        hash text NOT NULL,
        created_at bigint
      )
    `);
    const latestApplied = await appliedMigrationTimestamp(reserved, migrations);

    for (const migration of migrations.slice(0, throughIndex + 1)) {
      if (latestApplied !== undefined && migration.when <= latestApplied) continue;
      if (migration.tag === phasedTag) {
        await runPhasedMigration(reserved, backendPid, migration, options);
        continue;
      }
      if (migration.phases) throw new Error(`unsupported phased migration ${migration.tag}`);
      await runCheckedTransaction(reserved, backendPid, async (transaction) => {
        for (const statement of migration.statements) {
          if (statement.trim().length > 0) await transaction.unsafe(statement);
        }
        await transaction`
          INSERT INTO drizzle.__drizzle_migrations (hash, created_at)
          VALUES (${migration.hash}, ${migration.when})
        `;
      });
      await emitPhase(options, {
        backendPid,
        phase: 'ordinary-commit',
        tag: migration.tag,
      });
    }
    result = { backendPid };
  } catch (error) {
    primaryError = error;
  } finally {
    if (reserved) {
      if (transactionOpen.has(reserved)) {
        try {
          await reserved.unsafe('ROLLBACK');
          transactionOpen.delete(reserved);
        } catch (error) {
          cleanupErrors.push(error);
        }
      }
      if (advisoryLocked) {
        try {
          const [unlocked] = await reserved<Array<{ unlocked: boolean }>>`
            SELECT pg_advisory_unlock(hashtext('fxl-sales:database-migrations')) AS unlocked
          `;
          if (!unlocked?.unlocked) {
            cleanupErrors.push(new Error('migration advisory lock was not held'));
          }
        } catch (error) {
          cleanupErrors.push(error);
        }
      }
      if (backendPid !== undefined) {
        try {
          await assertBackendPid(reserved, backendPid);
        } catch (error) {
          cleanupErrors.push(error);
        }
      }
      reserved.release();
    }
    try {
      await client.end();
    } catch (error) {
      cleanupErrors.push(error);
    }
  }

  if (primaryError !== undefined) {
    if (cleanupErrors.length === 0) throw primaryError;
    throw new AggregateError(
      [primaryError, ...cleanupErrors],
      'migration execution and cleanup failed',
    );
  }
  if (cleanupErrors.length > 0) {
    throw cleanupErrors.length === 1
      ? cleanupErrors[0]
      : new AggregateError(cleanupErrors, 'migration cleanup failed');
  }
  if (!result) throw new Error('migration runner completed without a result');
  return result;
}
