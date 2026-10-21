---
id: 05b-crm-defaults-servicos
milestone: v4.8.0
status: todo
depends_on: ["05a-crm-schema-migracao"]
files_modified: ["packages/shared-utils/src/crm-model.ts", "packages/shared-utils/src/__tests__/crm-model.test.ts", "packages/shared-utils/package.json", "apps/api/src/domains/crm/defaults.ts", "apps/api/src/domains/crm/__tests__/crm-seed-callers.test.ts", "apps/api/test/rls/crm-defaults.test.ts"]
affected_tests: [
  {path: packages/shared-utils/src/__tests__/default-pipeline.test.ts, impact: "default-pipeline.ts is not edited; only imported by crm-model.ts", update: none (must stay green), command: "pnpm --filter @fxl-sales/shared-utils exec vitest run src/__tests__/default-pipeline.test.ts", owner: builder},
  {path: packages/shared-utils/src/__tests__/sales-edition.test.ts, impact: "sales-edition.ts is not edited; imported (types and hasCapability) by crm-model.ts", update: none (must stay green), command: "pnpm --filter @fxl-sales/shared-utils exec vitest run src/__tests__/sales-edition.test.ts", owner: builder},
  {path: apps/api/src/domains/sales-ops/leads/__tests__/stages-seed-callers.test.ts, impact: "the old etapa seed allow-list; no old seed call changes", update: none (must stay green), command: "pnpm --filter @fxl-sales/api exec vitest run src/domains/sales-ops/leads/__tests__/stages-seed-callers.test.ts", owner: builder}
]
acceptance: "given an org with no pipeline, when ensureCrmDefaults runs in its tenant transaction (even three times concurrently), then exactly one default pipeline with 7 stages, 22 transitions and the Cliente system field exist; given a renamed or archived pipeline, nothing is reinserted; modulesForEdition reproduces both editions exactly"
goal: "The shared CRM vocabulary (module keys, capability mapping, transition rule) and the idempotent ensureDefaultPipeline service, with no caller wired yet"
must_not_break: ["no request path calls the new seed (crm-seed-callers.test.ts)", "packages/shared-utils/src/default-pipeline.ts and sales-edition.ts are not edited", "the old etapa seed (ensureLeadStages) and its allow-list are untouched"]
rules: ["Never use the em dash; use '-'", "crm-model.ts is pure: imports only sibling pure modules, no env, no clock", "After editing shared-utils run pnpm --filter @fxl-sales/shared-utils build; the API resolves it through dist", "defaults.ts takes the tenant transaction from its caller; it never opens one except ensureCrmDefaultsForOrg"]
verifier_focus: "Run the three tests; run the concurrency test several times (it must never 500 or leave two pipelines); confirm modulesForEdition('leads') is exactly clientes and importacao; confirm nothing else imports defaults.ts"
oracle: "apps/api/test/rls/crm-defaults.test.ts"
---

# 05b - CRM shared model and default pipeline service (phase 1b)

## Context

Slice 05a created the tables. This slice adds the code phases 2 and 3 import, with no behaviour wired yet.
- `packages/shared-utils/src/default-pipeline.ts` exports `DEFAULT_PIPELINE_KEY` ('crm-padrao'), `DEFAULT_PIPELINE_NAME` ('Funil CRM padrão'), `DEFAULT_PIPELINE_STAGES` (7), `DEFAULT_PIPELINE_TRANSITIONS` (22 pairs), types `PipelineStageType`, `PipelineExitKind`, `DefaultPipelineStage`.
- `packages/shared-utils/src/sales-edition.ts` exports `SalesCapability`, `SalesEdition`, `hasCapability`, `editionCapabilities`.
- Subpath exports are listed in `packages/shared-utils/package.json` (`exports`), the build is `tsc --build --force` into `dist/` (`pnpm --filter @fxl-sales/shared-utils build`).
- The old seed to mirror is `apps/api/src/domains/sales-ops/leads/stages-seed.ts` (`ensureLeadStages`: "any row" guard, bare `onConflictDoNothing`, re-read) and the tenant door `apps/api/src/domains/sales-ops/leads/with-tenant.ts`; its caller allow-list test is `apps/api/src/domains/sales-ops/leads/__tests__/stages-seed-callers.test.ts`.
- Prototype result: `crm-model.test.ts` 6 tests, `crm-defaults.test.ts` 6 tests (including three concurrent first callers), `crm-seed-callers.test.ts` 1 test pass; `tsc --noEmit` clean.

## Design

- `crm-model.ts` is the one place for the open-ended enumerations (no DB CHECK), the capability-to-module map, `modulesForEdition`, the pure transition rule `planPipelineTransitions` (identical to what 0030 does in SQL) and the Cliente system field constant.
- `ensureDefaultPipeline` follows `ensureLeadStages`: "seeded" means "has ANY pipeline row". The pipeline INSERT (client-generated uuid, bare `onConflictDoNothing`, `.returning`) is the lock: a concurrent first caller blocks on the unique indexes until the winner commits, its INSERT returns no row, it skips the children and re-reads. Only the caller whose INSERT returned a row writes stages and transitions, in the same transaction.
- `ensureSystemFieldDefinitions` is NOT guarded by "any row": the Cliente field is non-removable, so it is re-inserted when missing (`onConflictDoNothing` on the unique `(org_id, key)`).
- Nothing calls these functions yet; `crm-seed-callers.test.ts` pins that, and phase 2 appends its request paths to `ALLOWED_CALLERS`.

## Steps

1. TDD: create the three test files (texts below). Run them; they must fail to import.
2. Create `packages/shared-utils/src/crm-model.ts` (text below). Edit `packages/shared-utils/package.json`: add after the `./default-pipeline` export an entry `"./crm-model": { "types": "./dist/crm-model.d.ts", "import": "./dist/crm-model.js" }` (mind the comma). Do not edit `default-pipeline.ts` or `sales-edition.ts`.
3. `pnpm --filter @fxl-sales/shared-utils build` then `pnpm --filter @fxl-sales/shared-utils exec vitest run`.
4. Create `apps/api/src/domains/crm/defaults.ts` (text below).
5. Run the API tests and `type-check` (commands below). Run the concurrency test 3 times.
6. Report.

## Code

`packages/shared-utils/src/crm-model.ts`:

```ts
/**
 * CRM unificado: the shared vocabulary of the unified lead model (migration 0029).
 *
 * Pure: imports only sibling pure modules, reads no env, no clock, no locale.
 * Open-ended sets (behavior, field kind, reference target, module key, event kind,
 * source) are validated HERE and by zod, never by a database CHECK, because the
 * additive migration guard forbids DROP CONSTRAINT.
 */
import {
  DEFAULT_PIPELINE_STAGES,
  type DefaultPipelineStage,
  type PipelineExitKind,
  type PipelineStageType,
} from './default-pipeline.js';
import { hasCapability, type SalesCapability, type SalesEdition } from './sales-edition.js';

export const CRM_STATUSES = ['active', 'archived'] as const;
export type CrmStatus = (typeof CRM_STATUSES)[number];

export const PIPELINE_STAGE_TYPES = ['normal', 'orcamento', 'saida'] as const satisfies readonly PipelineStageType[];
export const PIPELINE_EXIT_KINDS = ['ganho', 'perdido', 'pausado'] as const satisfies readonly PipelineExitKind[];

export const STAGE_BEHAVIORS = ['none', 'opens_orcamentos'] as const;
export type StageBehavior = (typeof STAGE_BEHAVIORS)[number];

export const FIELD_KINDS = ['text', 'number', 'money', 'date', 'options', 'reference'] as const;
export type FieldKind = (typeof FIELD_KINDS)[number];

export const FIELD_REFERENCE_TARGETS = ['cliente', 'contato', 'produto', 'servico', 'venda'] as const;
export type FieldReferenceTarget = (typeof FIELD_REFERENCE_TARGETS)[number];

export const LEAD_EVENT_KINDS = ['stage_changed'] as const;
export type LeadEventKind = (typeof LEAD_EVENT_KINDS)[number];

export const CRM_MODULE_KEYS = [
  'orcamentos',
  'comissoes',
  'financeiro',
  'finders',
  'catalogo',
  'importacao',
  'clientes',
] as const;
export type CrmModuleKey = (typeof CRM_MODULE_KEYS)[number];

export const CRM_MODULE_SOURCES = ['default', 'token_backfill', 'admin'] as const;
export type CrmModuleSource = (typeof CRM_MODULE_SOURCES)[number];

/**
 * Today's capability -> the module(s) that must ALL be enabled for it.
 * `financeiro` maps only `history` (Geral settings and the archive history) here;
 * phase 3 decides what else the financeiro module gates.
 */
export const CAPABILITY_MODULES: Readonly<Record<SalesCapability, readonly CrmModuleKey[]>> = {
  proposals: ['orcamentos'],
  commissions: ['comissoes'],
  catalog: ['catalogo'],
  clients: ['clientes'],
  import: ['importacao'],
  finders: ['finders'],
  history: ['financeiro'],
  leadFullFields: ['catalogo'],
};

/**
 * The module flags that reproduce an edition exactly: a module is enabled iff every
 * capability mapped to it is granted by the edition. full => all seven;
 * leads => exactly `clientes` and `importacao`. Used by the phase 3 one-time token backfill.
 */
export function modulesForEdition(edition: SalesEdition): Record<CrmModuleKey, boolean> {
  const result = {} as Record<CrmModuleKey, boolean>;
  for (const key of CRM_MODULE_KEYS) {
    const mapped = (Object.keys(CAPABILITY_MODULES) as SalesCapability[]).filter((capability) =>
      CAPABILITY_MODULES[capability].includes(key),
    );
    result[key] = mapped.length > 0 && mapped.every((capability) => hasCapability(edition, capability));
  }
  return result;
}

export function isCrmModuleKey(value: unknown): value is CrmModuleKey {
  return typeof value === 'string' && (CRM_MODULE_KEYS as readonly string[]).includes(value);
}

/** The behavior a default stage is seeded with. */
export function defaultStageBehavior(stage: Pick<DefaultPipelineStage, 'type'>): StageBehavior {
  return stage.type === 'orcamento' ? 'opens_orcamentos' : 'none';
}

/** Only a perdido exit requires a reason. */
export function defaultStageRequiresReason(stage: Pick<DefaultPipelineStage, 'exitKind'>): boolean {
  return stage.exitKind === 'perdido';
}

export interface TransitionPlanStage {
  readonly id: string;
  readonly name: string;
  readonly position: number;
  readonly type: PipelineStageType;
  readonly exitKind: PipelineExitKind | null;
  readonly status: CrmStatus;
}

/**
 * The transition rule migration 0030 applies in SQL, over the ACTIVE stages of one pipeline.
 * open = type normal|orcamento ordered by (position, name); exits = type saida.
 *   open[i] -> open[i+1]; open[i+1] -> open[i]; every open -> every exit;
 *   every exit with exitKind pausado -> every open.
 * Returns unique [fromId, toId] pairs in a stable order.
 */
export function planPipelineTransitions(stages: readonly TransitionPlanStage[]): [string, string][] {
  const active = stages.filter((stage) => stage.status === 'active');
  const byOrder = (a: TransitionPlanStage, b: TransitionPlanStage) =>
    a.position - b.position || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
  const open = active.filter((stage) => stage.type !== 'saida').sort(byOrder);
  const exits = active.filter((stage) => stage.type === 'saida').sort(byOrder);
  const pairs = new Map<string, [string, string]>();
  const add = (from: string, to: string) => pairs.set(`${from}>${to}`, [from, to]);
  for (let i = 0; i + 1 < open.length; i += 1) {
    add(open[i]!.id, open[i + 1]!.id);
    add(open[i + 1]!.id, open[i]!.id);
  }
  for (const from of open) for (const to of exits) add(from.id, to.id);
  for (const from of exits) if (from.exitKind === 'pausado') for (const to of open) add(from.id, to.id);
  return [...pairs.values()];
}

/** Key -> stage lookup of the default pipeline, for seeding and parity tests. */
export const DEFAULT_PIPELINE_STAGE_BY_KEY: ReadonlyMap<string, DefaultPipelineStage> = new Map(
  DEFAULT_PIPELINE_STAGES.map((stage) => [stage.key, stage]),
);

/** The Cliente system field every org gets. Stored in the lead's client_id column, never as value rows. */
export const SYSTEM_FIELD_CLIENTE = {
  key: 'cliente',
  label: 'Cliente',
  kind: 'reference',
  referenceTarget: 'cliente',
  multiple: false,
  filterable: true,
  isSystem: true,
  removable: false,
  backingColumn: 'client_id',
  position: 1,
} as const;
```

`apps/api/src/domains/crm/defaults.ts`:

```ts
import { randomUUID } from 'node:crypto';
import {
  DEFAULT_PIPELINE_KEY,
  DEFAULT_PIPELINE_NAME,
  DEFAULT_PIPELINE_STAGES,
  DEFAULT_PIPELINE_TRANSITIONS,
} from '@fxl-sales/shared-utils/default-pipeline';
import {
  defaultStageBehavior,
  defaultStageRequiresReason,
  SYSTEM_FIELD_CLIENTE,
} from '@fxl-sales/shared-utils/crm-model';
import { asc, eq } from 'drizzle-orm';
import type { getDb } from '../../db/client.js';
import { salesOpsFieldDefinitions, salesOpsPipelines, salesOpsPipelineStages, salesOpsPipelineTransitions } from '../../db/schema.js';
import { withTenant } from '../sales-ops/leads/with-tenant.js';

type Db = ReturnType<typeof getDb>;

export type PipelineRow = typeof salesOpsPipelines.$inferSelect;
export type FieldDefinitionRow = typeof salesOpsFieldDefinitions.$inferSelect;

function selectPipelines(tx: Db, orgId: string): Promise<PipelineRow[]> {
  return tx
    .select()
    .from(salesOpsPipelines)
    .where(eq(salesOpsPipelines.orgId, orgId))
    .orderBy(asc(salesOpsPipelines.position), asc(salesOpsPipelines.name));
}

function selectFields(tx: Db, orgId: string): Promise<FieldDefinitionRow[]> {
  return tx
    .select()
    .from(salesOpsFieldDefinitions)
    .where(eq(salesOpsFieldDefinitions.orgId, orgId))
    .orderBy(asc(salesOpsFieldDefinitions.position), asc(salesOpsFieldDefinitions.key));
}

/**
 * Seeds the default CRM pipeline (stages and transitions from the shared constant) for an org
 * that has NO pipeline row at all and returns the org's pipelines in order. MUST run inside an
 * already tenant-scoped transaction (see {@link ensureCrmDefaultsForOrg}).
 *
 * "Seeded" means "has ANY pipeline row", never "has the default one": a renamed or archived
 * pipeline is never reinserted. The pipeline INSERT is a bare ON CONFLICT DO NOTHING (absorbs
 * every unique index: org+name, org+system_key, one default per org); a concurrent first caller
 * blocks on it until the winner commits, so the loser's INSERT returns no row and the re-read
 * sees the winner's complete pipeline. Stages and transitions are written only by the caller
 * whose pipeline INSERT returned a row, in the same transaction.
 */
export async function ensureDefaultPipeline(tx: Db, orgId: string): Promise<PipelineRow[]> {
  const existing = await selectPipelines(tx, orgId);
  if (existing.length > 0) return existing;

  const pipelineId = randomUUID();
  const inserted = await tx
    .insert(salesOpsPipelines)
    .values({
      id: pipelineId,
      orgId,
      name: DEFAULT_PIPELINE_NAME,
      systemKey: DEFAULT_PIPELINE_KEY,
      position: 0,
      isDefault: true,
    })
    .onConflictDoNothing()
    .returning({ id: salesOpsPipelines.id });

  if (inserted.length > 0) {
    const stageIds = new Map(DEFAULT_PIPELINE_STAGES.map((stage) => [stage.key as string, randomUUID()] as const));
    await tx.insert(salesOpsPipelineStages).values(
      DEFAULT_PIPELINE_STAGES.map((stage) => ({
        id: stageIds.get(stage.key)!,
        orgId,
        pipelineId,
        name: stage.label,
        position: stage.order,
        type: stage.type,
        behavior: defaultStageBehavior(stage),
        exitKind: stage.exitKind,
        requiresReason: defaultStageRequiresReason(stage),
      })),
    );
    await tx.insert(salesOpsPipelineTransitions).values(
      DEFAULT_PIPELINE_TRANSITIONS.map(([from, to]) => ({
        orgId,
        pipelineId,
        fromStageId: stageIds.get(from)!,
        toStageId: stageIds.get(to)!,
      })),
    );
  }

  return selectPipelines(tx, orgId);
}

/**
 * Ensures the Cliente system field exists. Unlike the pipeline it is re-inserted when missing
 * (it is not removable), keyed by the unique (org_id, key) index.
 */
export async function ensureSystemFieldDefinitions(tx: Db, orgId: string): Promise<FieldDefinitionRow[]> {
  await tx
    .insert(salesOpsFieldDefinitions)
    .values({ orgId, ...SYSTEM_FIELD_CLIENTE })
    .onConflictDoNothing();
  return selectFields(tx, orgId);
}

export async function ensureCrmDefaults(
  tx: Db,
  orgId: string,
): Promise<{ pipelines: PipelineRow[]; fields: FieldDefinitionRow[] }> {
  const pipelines = await ensureDefaultPipeline(tx, orgId);
  const fields = await ensureSystemFieldDefinitions(tx, orgId);
  return { pipelines, fields };
}

/** Opens the tenant transaction and seeds. The public entry point. */
export async function ensureCrmDefaultsForOrg(db: Db, orgId: string) {
  return withTenant(db, orgId, (tx) => ensureCrmDefaults(tx, orgId));
}
```

## Tests

`packages/shared-utils/src/__tests__/crm-model.test.ts`:
- `planPipelineTransitions over the default stages equals DEFAULT_PIPELINE_TRANSITIONS` (22 pairs, as sets).
- `ignores archived stages and adapts to a legacy-shaped pipeline` (16 pairs, no archived id, `n>e`, `e>n`, `z>p` present, `l>n` and `g>n` absent).
- default stage behavior and reason rule (`opens_orcamentos` only for the orcamento stage; only `perdido` requires a reason).
- `modulesForEdition` reproduces each edition: full all seven, leads exactly `clientes` and `importacao`.
- every capability maps to known modules and every module is reachable; `isCrmModuleKey`.
- the Cliente system field is not removable.

```ts
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PIPELINE_STAGES,
  DEFAULT_PIPELINE_TRANSITIONS,
} from '../default-pipeline.js';
import {
  CAPABILITY_MODULES,
  CRM_MODULE_KEYS,
  defaultStageBehavior,
  defaultStageRequiresReason,
  isCrmModuleKey,
  modulesForEdition,
  planPipelineTransitions,
  SYSTEM_FIELD_CLIENTE,
  type TransitionPlanStage,
} from '../crm-model.js';
import { editionCapabilities } from '../sales-edition.js';

const defaultStages: TransitionPlanStage[] = DEFAULT_PIPELINE_STAGES.map((stage) => ({
  id: stage.key,
  name: stage.label,
  position: stage.order,
  type: stage.type,
  exitKind: stage.exitKind,
  status: 'active',
}));

describe('crm-model', () => {
  it('planPipelineTransitions over the default stages equals DEFAULT_PIPELINE_TRANSITIONS', () => {
    const planned = planPipelineTransitions(defaultStages).map(([a, b]) => `${a}>${b}`).sort();
    const expected = DEFAULT_PIPELINE_TRANSITIONS.map(([a, b]) => `${a}>${b}`).sort();
    expect(planned).toEqual(expected);
    expect(planned).toHaveLength(22);
  });

  it('planPipelineTransitions ignores archived stages and adapts to a legacy-shaped pipeline', () => {
    const legacy: TransitionPlanStage[] = [
      { id: 'n', name: 'Prospecção', position: 1, type: 'normal', exitKind: null, status: 'active' },
      { id: 'e', name: 'Em negociação', position: 2, type: 'normal', exitKind: null, status: 'active' },
      { id: 'p', name: 'Proposta', position: 3, type: 'orcamento', exitKind: null, status: 'active' },
      { id: 'l', name: 'Perdido', position: 4, type: 'saida', exitKind: 'perdido', status: 'active' },
      { id: 'x', name: 'Antiga', position: 5, type: 'normal', exitKind: null, status: 'archived' },
      { id: 'g', name: 'Ganho', position: 6, type: 'saida', exitKind: 'ganho', status: 'active' },
      { id: 'z', name: 'Pausado', position: 7, type: 'saida', exitKind: 'pausado', status: 'active' },
    ];
    const planned = planPipelineTransitions(legacy);
    expect(planned).toHaveLength(16);
    expect(planned.some(([a, b]) => a === 'x' || b === 'x')).toBe(false);
    expect(planned).toContainEqual(['n', 'e']);
    expect(planned).toContainEqual(['e', 'n']);
    expect(planned).toContainEqual(['z', 'p']);
    expect(planned).not.toContainEqual(['l', 'n']);
    expect(planned).not.toContainEqual(['g', 'n']);
  });

  it('default stage behavior and reason rules', () => {
    expect(DEFAULT_PIPELINE_STAGES.map((s) => defaultStageBehavior(s))).toEqual([
      'none', 'none', 'none', 'opens_orcamentos', 'none', 'none', 'none',
    ]);
    expect(DEFAULT_PIPELINE_STAGES.filter((s) => defaultStageRequiresReason(s)).map((s) => s.key)).toEqual(['perdido']);
  });

  it('modulesForEdition reproduces each edition exactly', () => {
    expect(Object.keys(modulesForEdition('full')).sort()).toEqual([...CRM_MODULE_KEYS].sort());
    expect(Object.values(modulesForEdition('full')).every(Boolean)).toBe(true);
    const leads = modulesForEdition('leads');
    expect(Object.entries(leads).filter(([, on]) => on).map(([key]) => key).sort()).toEqual(['clientes', 'importacao']);
  });

  it('every capability maps to known modules and every module is reachable', () => {
    const mapped = new Set(Object.values(CAPABILITY_MODULES).flat());
    for (const key of CRM_MODULE_KEYS) expect(mapped.has(key), key).toBe(true);
    for (const capability of editionCapabilities('full')) expect(CAPABILITY_MODULES[capability].length).toBeGreaterThan(0);
    expect(isCrmModuleKey('orcamentos')).toBe(true);
    expect(isCrmModuleKey('sales.core')).toBe(false);
  });

  it('the Cliente system field is not removable', () => {
    expect(SYSTEM_FIELD_CLIENTE).toMatchObject({ isSystem: true, removable: false, backingColumn: 'client_id' });
  });
});
```

`apps/api/src/domains/crm/__tests__/crm-seed-callers.test.ts`:

```ts
/**
 * CRM default seed: the allow-list of callers (vendas-crm-unificado slice 05b).
 *
 * `ensureDefaultPipeline`, `ensureSystemFieldDefinitions`, `ensureCrmDefaults` and
 * `ensureCrmDefaultsForOrg` write on first use. In slice 05b NOTHING calls them but their own
 * module and the tests: the API is not cut over yet. Phase 2 appends its request paths to
 * ALLOWED_CALLERS deliberately (the same discipline as stages-seed-callers.test.ts).
 *
 * Non-vacuous by construction: the walker must visit a real tree and must find the seed
 * module's own definition, so a broken walker or a wrong root fails.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const SRC_ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const SEED_CALL = /\bensure(DefaultPipeline|SystemFieldDefinitions|CrmDefaults|CrmDefaultsForOrg)\s*\(/;
const ALLOWED_CALLERS = ['domains/crm/defaults.ts'];

function walk(dir: string, visited: { count: number }, hits: string[]): void {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === '__tests__') continue;
      walk(path, visited, hits);
      continue;
    }
    if (!entry.isFile() || !entry.name.endsWith('.ts') || entry.name.endsWith('.test.ts')) continue;
    visited.count += 1;
    if (SEED_CALL.test(readFileSync(path, 'utf8'))) hits.push(relative(SRC_ROOT, path).split(sep).join('/'));
  }
}

describe('CRM default seed: only the allowed callers', () => {
  it('only the seed module itself calls the seed', () => {
    const visited = { count: 0 };
    const hits: string[] = [];
    walk(SRC_ROOT, visited, hits);
    expect(visited.count).toBeGreaterThan(50);
    expect(hits).toContain('domains/crm/defaults.ts');
    expect(hits.sort()).toEqual(ALLOWED_CALLERS);
  });
});
```

`apps/api/test/rls/crm-defaults.test.ts` (scratch database, owner role) - cases: seeds pipeline + 7 stages + 22 transitions + Cliente (stage tuples and transition pairs compared to the shared constants); second call keeps the same ids; three concurrent first callers leave one pipeline, 7 stages, 22 transitions, 1 field; a renamed archived pipeline is never reinserted; Cliente is re-created if missing and never duplicated; seeding one org leaves another untouched.

```ts
/**
 * ensureDefaultPipeline / ensureCrmDefaults (vendas-crm-unificado slice 05b), against a scratch
 * database migrated to the head and driven as the NOSUPERUSER owner (FORCE RLS applies).
 *
 * Requires Docker Postgres running. Run with:
 *   pnpm --filter @fxl-sales/api exec env VITEST_INTEGRATION=1 vitest run test/rls/crm-defaults.test.ts
 */
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import {
  DEFAULT_PIPELINE_KEY,
  DEFAULT_PIPELINE_NAME,
  DEFAULT_PIPELINE_STAGES,
  DEFAULT_PIPELINE_TRANSITIONS,
} from '@fxl-sales/shared-utils/default-pipeline';
import { defaultStageBehavior, defaultStageRequiresReason } from '@fxl-sales/shared-utils/crm-model';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as schema from '../../src/db/schema.js';
import { ensureCrmDefaults, ensureDefaultPipeline } from '../../src/domains/crm/defaults.js';
import { runDatabaseMigrations } from '../../src/db/migration-runner.js';
import { cleanupScratch, createScratchDatabase, MIGRATIONS_FOLDER, scratchClient, type ScratchDatabase } from './scratch-database.js';

describe('CRM defaults: ensureDefaultPipeline and the Cliente system field', () => {
  let scratch: ScratchDatabase;
  let client: postgres.Sql;
  let db: ReturnType<typeof drizzle<typeof schema>>;

  /** The tenant transaction every caller opens: set_config FIRST, then the service call. */
  async function inTenant<T>(org: string, work: (tx: never) => Promise<T>, delayMs = 0): Promise<T> {
    return db.transaction(async (tx) => {
      await tx.execute(`select set_config('app.current_org_id', '${org}', true)` as never);
      if (delayMs > 0) await new Promise((resolve) => setTimeout(resolve, delayMs));
      return work(tx as never);
    });
  }

  async function adminRows<T extends object>(query: string): Promise<T[]> {
    return [...(await scratch.adminScratch.unsafe<T[]>(query))];
  }

  beforeAll(async () => {
    scratch = await createScratchDatabase();
    await runDatabaseMigrations({ databaseUrl: scratch.ownerUrl, migrationsFolder: MIGRATIONS_FOLDER });
    client = scratchClient(scratch, 8);
    db = drizzle(client, { schema });
  }, 120000);

  afterAll(async () => {
    const errors = await cleanupScratch(scratch);
    if (errors.length > 0) throw new AggregateError(errors, 'scratch database cleanup failed');
  });

  it('seeds the default pipeline, its stages, its transitions and the Cliente field for an org with none', async () => {
    const result = await inTenant('org_def_1', (tx) => ensureCrmDefaults(tx, 'org_def_1'));
    expect(result.pipelines).toHaveLength(1);
    expect(result.pipelines[0]).toMatchObject({ name: DEFAULT_PIPELINE_NAME, systemKey: DEFAULT_PIPELINE_KEY, isDefault: true, status: 'active' });
    expect(result.fields.map((f) => [f.key, f.isSystem, f.removable, f.backingColumn])).toEqual([['cliente', true, false, 'client_id']]);

    const stages = await adminRows<{ id: string; name: string; position: number; type: string; behavior: string; exit_kind: string | null; requires_reason: boolean }>(
      `SELECT id, name, position, type, behavior, exit_kind, requires_reason FROM sales_ops_pipeline_stages WHERE org_id = 'org_def_1' ORDER BY position`,
    );
    expect(stages.map((s) => [s.name, s.position, s.type, s.behavior, s.exit_kind, s.requires_reason])).toEqual(
      DEFAULT_PIPELINE_STAGES.map((s) => [s.label, s.order, s.type, defaultStageBehavior(s), s.exitKind, defaultStageRequiresReason(s)]),
    );
    const idByKey = new Map(DEFAULT_PIPELINE_STAGES.map((s, i) => [s.key as string, stages[i]!.id]));
    const transitions = await adminRows<{ from_stage_id: string; to_stage_id: string }>(
      `SELECT from_stage_id, to_stage_id FROM sales_ops_pipeline_transitions WHERE org_id = 'org_def_1'`,
    );
    expect(transitions).toHaveLength(DEFAULT_PIPELINE_TRANSITIONS.length);
    expect(new Set(transitions.map((t) => `${t.from_stage_id}>${t.to_stage_id}`))).toEqual(
      new Set(DEFAULT_PIPELINE_TRANSITIONS.map(([a, b]) => `${idByKey.get(a)}>${idByKey.get(b)}`)),
    );
  });

  it('a second call changes nothing (same ids)', async () => {
    const first = await inTenant('org_def_2', (tx) => ensureCrmDefaults(tx, 'org_def_2'));
    const second = await inTenant('org_def_2', (tx) => ensureCrmDefaults(tx, 'org_def_2'));
    expect(second.pipelines.map((p) => p.id)).toEqual(first.pipelines.map((p) => p.id));
    expect(second.fields.map((f) => f.id)).toEqual(first.fields.map((f) => f.id));
    const [counts] = await adminRows<{ s: number; t: number }>(
      `SELECT (SELECT count(*) FROM sales_ops_pipeline_stages WHERE org_id='org_def_2')::int s, (SELECT count(*) FROM sales_ops_pipeline_transitions WHERE org_id='org_def_2')::int t`,
    );
    expect(counts).toEqual({ s: 7, t: 22 });
  });

  it('three concurrent first callers never error and leave exactly one complete pipeline', async () => {
    const results = await Promise.all([1, 2, 3].map(() => inTenant('org_def_3', (tx) => ensureCrmDefaults(tx, 'org_def_3'), 40)));
    expect(new Set(results.map((r) => r.pipelines[0]!.id)).size).toBe(1);
    expect(results.every((r) => r.pipelines.length === 1 && r.fields.length === 1)).toBe(true);
    const [counts] = await adminRows<{ p: number; s: number; t: number; f: number }>(
      `SELECT (SELECT count(*) FROM sales_ops_pipelines WHERE org_id='org_def_3')::int p, (SELECT count(*) FROM sales_ops_pipeline_stages WHERE org_id='org_def_3')::int s,
              (SELECT count(*) FROM sales_ops_pipeline_transitions WHERE org_id='org_def_3')::int t, (SELECT count(*) FROM sales_ops_field_definitions WHERE org_id='org_def_3')::int f`,
    );
    expect(counts).toEqual({ p: 1, s: 7, t: 22, f: 1 });
  });

  it('"has any pipeline" is the guard: a renamed or archived pipeline is never reinserted', async () => {
    await inTenant('org_def_4', (tx) => ensureDefaultPipeline(tx, 'org_def_4'));
    await scratch.adminScratch.unsafe(`UPDATE sales_ops_pipelines SET name = 'Vendas B2B', status = 'archived', archived_at = now() WHERE org_id = 'org_def_4'`);
    const again = await inTenant('org_def_4', (tx) => ensureDefaultPipeline(tx, 'org_def_4'));
    expect(again).toHaveLength(1);
    expect(again[0]).toMatchObject({ name: 'Vendas B2B', status: 'archived' });
  });

  it('the Cliente system field is re-created if it is ever missing, and never duplicated', async () => {
    await inTenant('org_def_5', (tx) => ensureCrmDefaults(tx, 'org_def_5'));
    await scratch.adminScratch.unsafe(`DELETE FROM sales_ops_field_definitions WHERE org_id = 'org_def_5'`);
    const result = await inTenant('org_def_5', (tx) => ensureCrmDefaults(tx, 'org_def_5'));
    expect(result.fields.map((f) => f.key)).toEqual(['cliente']);
  });

  it('is tenant-scoped: seeding one org leaves another untouched', async () => {
    const before = await adminRows<{ n: number }>(`SELECT count(*)::int n FROM sales_ops_pipelines WHERE org_id = 'org_def_untouched'`);
    await inTenant('org_def_6', (tx) => ensureCrmDefaults(tx, 'org_def_6'));
    const after = await adminRows<{ n: number }>(`SELECT count(*)::int n FROM sales_ops_pipelines WHERE org_id = 'org_def_untouched'`);
    expect(before).toEqual(after);
    expect(after[0]!.n).toBe(0);
  });
});
```

## Commands

- Oracle: `pnpm --filter @fxl-sales/api exec env VITEST_INTEGRATION=1 vitest run test/rls/crm-defaults.test.ts`
- Focused: `pnpm --filter @fxl-sales/shared-utils exec vitest run src/__tests__/crm-model.test.ts` and `pnpm --filter @fxl-sales/api exec vitest run src/domains/crm`
- Affected: `pnpm --filter @fxl-sales/shared-utils test`; `pnpm --filter @fxl-sales/api exec vitest run src/domains/sales-ops/leads`
- Lint and types: `pnpm --filter @fxl-sales/api lint`; `pnpm run type-check` (it rebuilds the packages first)

## Risks

- A stale `dist/` makes `@fxl-sales/shared-utils/crm-model` unresolvable in the API: always build before the API tests.
- The concurrency case depends on Postgres blocking the second INSERT on the unique indexes; if the pipeline table ever loses the `is_default` or `system_key` unique index the loser would insert a second pipeline. The 05a RLS test pins those indexes.
