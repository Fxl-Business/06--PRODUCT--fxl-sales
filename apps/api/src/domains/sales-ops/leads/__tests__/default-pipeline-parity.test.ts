import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DEFAULT_PIPELINE_NEW_STAGE_KEYS,
  DEFAULT_PIPELINE_STAGES,
  LEGACY_LEAD_STAGE_COUNTERPART,
  type DefaultPipelineStage,
} from '@fxl-sales/shared-utils/default-pipeline';
import { describe, expect, it } from 'vitest';
import { LEAD_STAGE_SEEDS } from '../stages-seed.js';

const DRIZZLE_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../../drizzle');

interface SeedRow {
  name: string;
  kind: string;
  isSystem: boolean;
  position: number;
}

/** Parses the `CROSS JOIN (VALUES ...) AS s(...)` seed block of a migration. */
function extractSeedRows(sql: string): SeedRow[] {
  const block = /CROSS JOIN \(VALUES([\s\S]*?)\) AS s\(/.exec(sql);
  if (!block) throw new Error('seed VALUES block not found');
  const rows: SeedRow[] = [];
  for (const m of block[1]!.matchAll(/\('([^']+)',\s*'(\w+)',\s*(true|false),\s*(\d+)\)/g)) {
    rows.push({ name: m[1]!, kind: m[2]!, isSystem: m[3] === 'true', position: Number(m[4]) });
  }
  return rows;
}

function readMigration(prefix: string): string {
  const file = fs.readdirSync(DRIZZLE_DIR).find((f) => f.startsWith(`${prefix}_`) && f.endsWith('.sql'));
  if (!file) throw new Error(`migration ${prefix} not found in ${DRIZZLE_DIR}`);
  return fs.readFileSync(path.join(DRIZZLE_DIR, file), 'utf8');
}

/**
 * Each entry proves one migration's seed VALUES equal the pipeline constant.
 * SLICE-05-HOOK: slice 05 appends the 0029 entry (new pipeline stage seed) here and the same loop compares it to DEFAULT_PIPELINE_STAGES.
 */
const MIGRATION_SEED_COMPARISONS = [{ id: '0022', filePattern: '0022', extractRows: extractSeedRows }] as const;

const LEGACY_TO_DEFAULT_KIND: Record<string, DefaultPipelineStage['type']> = {
  normal: 'normal',
  conversion: 'orcamento',
  lost: 'saida',
};

const byKey = new Map(DEFAULT_PIPELINE_STAGES.map((s) => [s.key, s] as const));

/**
 * Asserts every seed row maps to its default-pipeline counterpart: label, legacy kind mapping,
 * the lost exit kind, and a strictly increasing pipeline order along the legacy position.
 */
function expectRowsMatchPipeline(rows: SeedRow[], source: string): void {
  const sorted = [...rows].sort((a, b) => a.position - b.position);
  let previousOrder = 0;
  for (const row of sorted) {
    const key = LEGACY_LEAD_STAGE_COUNTERPART[row.name as keyof typeof LEGACY_LEAD_STAGE_COUNTERPART];
    expect(key, `${source}: no counterpart for ${row.name}`).toBeDefined();
    const stage = byKey.get(key!);
    expect(stage, `${source}: pipeline stage ${key} missing`).toBeDefined();
    expect(stage!.label, `${source}: label of ${row.name}`).toBe(row.name);
    expect(stage!.type, `${source}: kind of ${row.name}`).toBe(LEGACY_TO_DEFAULT_KIND[row.kind]);
    if (row.kind === 'lost') expect(stage!.exitKind, `${source}: exit of ${row.name}`).toBe('perdido');
    expect(stage!.order, `${source}: order of ${row.name}`).toBeGreaterThan(previousOrder);
    previousOrder = stage!.order;
  }
}

describe('default pipeline parity with the legacy lead stage seed', () => {
  const rows0022 = extractSeedRows(readMigration('0022'));

  it('parses four seed rows out of migration 0022', () => {
    expect(rows0022).toHaveLength(4);
  });

  it('0022 seed rows equal LEAD_STAGE_SEEDS', () => {
    const fromCode = LEAD_STAGE_SEEDS.map((s) => ({
      name: s.name,
      kind: s.kind,
      isSystem: s.isSystem,
      position: s.position,
    }));
    expect(rows0022).toEqual(fromCode);
  });

  it('each 0022 seed row maps to its default-pipeline counterpart', () => {
    expectRowsMatchPipeline(rows0022, '0022');
  });

  it('the default stages without a legacy counterpart are qualificacao, ganho and pausado', () => {
    const mapped = new Set<string>(Object.values(LEGACY_LEAD_STAGE_COUNTERPART));
    const unmapped = DEFAULT_PIPELINE_STAGES.map((s) => s.key).filter((k) => !mapped.has(k));
    expect(unmapped.sort()).toEqual([...DEFAULT_PIPELINE_NEW_STAGE_KEYS].sort());
    expect([...DEFAULT_PIPELINE_NEW_STAGE_KEYS].sort()).toEqual(['ganho', 'pausado', 'qualificacao']);
  });

  it('every registered migration seed comparison matches the pipeline', () => {
    for (const entry of MIGRATION_SEED_COMPARISONS) {
      const rows = entry.extractRows(readMigration(entry.filePattern));
      expect(rows.length, `migration ${entry.id} has no seed rows`).toBeGreaterThan(0);
      expectRowsMatchPipeline(rows, `migration ${entry.id}`);
    }
  });
});
