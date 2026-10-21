# Part 07a1-cutover-fundacao of slice 07a-api-crm-cutover

Not a slice: no frontmatter. The slice file `07a-api-crm-cutover.md` carries the union frontmatter, the Design and the Risks.

## What this part does

Adds, without wiring anything: migration `0031_crm_cutover_resync`, the CRM helper modules under `apps/api/src/domains/crm/` and the test-only `deleteCrmForOrgs`. The tree stays green because no existing file imports the new modules yet.

## Steps

1. TDD: create `apps/api/test/rls/crm-cutover-resync.test.ts` (text below). Run it: it fails in `beforeAll` (no 0031 file).
2. Generate the migration shell from the repo root: `pnpm --filter @fxl-sales/api exec drizzle-kit generate --custom --name crm_cutover_resync`. It creates `apps/api/drizzle/0031_crm_cutover_resync.sql` (empty), `apps/api/drizzle/meta/0031_snapshot.json` and one journal entry `idx 31`. Do NOT edit the snapshot (it equals 0030's apart from `id` and `prevId`). If drizzle-kit asks anything, STOP and report. Replace the WHOLE body of the `.sql` file with the text below, byte for byte.
3. Create the five helper files below with exactly that content.
4. `apps/api/src/db/__tests__/settlement-test-cleanup.ts`: run `grep -n "deleteCrmForOrgs" apps/api/src/db/__tests__/settlement-test-cleanup.ts`. If it prints nothing, apply the diff below with `git apply --whitespace=nowarn`. If it already exists (slice 06 defined it), keep it, check that its DELETE order is exactly: notes, follow-ups, field values, events, leads, transitions, pipeline stages, pipelines, field definitions, org modules, and that `purgeOrgLedgerForTests` calls it right after `await deleteSettlementsForOrgs(orgIds);`; fix only a deviation.
5. Run the commands. Report.

## Tests

`crm-cutover-resync.test.ts` (migration oracle on a scratch database migrated through 0029, seeded with synthetic data, migrated through 0030, then given OLD-table writes, then migrated to the head). Cases: `repeats 0030 byte for byte, then only INSERTs and UPDATEs rows of the unified tables`; `writes no old table: the source fingerprint taken before 0031 equals the one after`; `copies the rows the old tables got after 0030 with the same ids`; `overwrites a stale copy with the row the old table changed last (move, edit, delete, restore)`; `writes ONE history event for the changed etapa`; `upserts changed and added field values, and DOES NOT mirror a removal`; `renames an etapa, skips a take-over that would collide, and never aborts`; `is idempotent: a second run converges the skipped rename, a third changes nothing`; `never overwrites a row the NEW code wrote after the cutover`.

## Commands

- Oracle: `pnpm --filter @fxl-sales/api exec env VITEST_INTEGRATION=1 vitest run test/rls/crm-cutover-resync.test.ts`
- Guards: `pnpm --filter @fxl-sales/api exec vitest run src/db/__tests__/additive-migrations-guard.test.ts src/db/__tests__/single-role-db-contract.test.ts`
- `pnpm --filter @fxl-sales/api type-check`; `pnpm --filter @fxl-sales/api lint`
- Affected integration: `pnpm --filter @fxl-sales/api exec env VITEST_INTEGRATION=1 vitest run test/rls/crm-legacy-copy-migration.test.ts test/rls/leads-schema-migration.test.ts`

## Code

#### `apps/api/src/domains/crm/lead-input-error.ts` (new file)

Create the file with exactly this content.

```ts
/**
 * The lead service's 400 sentinel, moved out of `lead-service.ts` so the CRM field module can throw
 * it without importing the service (which imports the field module). `lead-service.ts` re-exports
 * it, so every existing `import { LeadInputError } from '.../lead-service.js'` keeps working.
 *
 * Shape and the `itemIndex: -1` convention are copied verbatim from `SaleInputError`, so
 * `lead-routes.ts` maps it onto the byte-identical 400 body `routes.ts` already returns for a sale
 * input error: `{ error: 'validation_error', reason: code, itemIndex }`.
 */
export type LeadInputErrorCode =
  | 'seller_not_found'
  | 'seller_not_a_vendedor'
  | 'client_not_found'
  | 'product_not_found'
  | 'stage_not_found'
  | 'lost_reason_required'
  | 'sale_required_for_conversion'
  | 'sale_not_found'
  | 'sale_not_allowed'
  | 'no_open_stage'
  // Phase 2 additions
  | 'pipeline_not_found'
  | 'stage_not_open'
  | 'contact_required'
  | 'field_not_found'
  | 'field_invalid'
  | 'field_reference_not_found';

export class LeadInputError extends Error {
  constructor(
    readonly code: LeadInputErrorCode,
    /** The offending array row (`products[]` or `fields[]`), or -1 when the error names no array row. */
    readonly itemIndex: number = -1,
  ) {
    super(code);
    this.name = 'LeadInputError';
  }
}
```

#### `apps/api/src/domains/crm/stage-view.ts` (new file)

Create the file with exactly this content.

```ts
import type { salesOpsPipelineStages } from '../../db/schema.js';

/**
 * The legacy etapa vocabulary, derived from the unified pipeline stage (phase 2 cutover).
 *
 * The web of today still speaks `kind` (`normal | conversion | lost`) and `isSystem`, so
 * `GET /lead-stages` and every other legacy projection derive them from the new columns and
 * never store them. Pure: imports only a type, no database, no clock.
 */
export type PipelineStageRow = typeof salesOpsPipelineStages.$inferSelect;

export type LegacyStageKind = 'normal' | 'conversion' | 'lost';

type KindInput = Pick<PipelineStageRow, 'type' | 'exitKind'>;

/** `orcamento` is the old conversion etapa, exit `perdido` the old lost one, everything else is normal. */
export function legacyStageKind(stage: KindInput): LegacyStageKind {
  if (stage.type === 'orcamento') return 'conversion';
  if (stage.exitKind === 'perdido') return 'lost';
  return 'normal';
}

/**
 * The old rule "every non-normal etapa is a system etapa": the conversion and the lost etapa
 * cannot be renamed or archived through `PATCH /lead-stages/:id`. Ganho and Pausado are ordinary
 * etapas the org owns.
 */
export function legacyStageIsSystem(stage: KindInput): boolean {
  return legacyStageKind(stage) !== 'normal';
}

/** `GET /lead-stages` row: every field of the old table row plus the additive pipeline fields. */
export type LeadStageView = {
  id: string;
  orgId: string;
  name: string;
  kind: LegacyStageKind;
  isSystem: boolean;
  position: number;
  status: string;
  archivedAt: Date | null;
  createdAt: Date;
  updatedAt: Date | null;
  pipelineId: string;
  type: string;
  behavior: string;
  exitKind: string | null;
  requiresReason: boolean;
};

export function toLeadStageView(row: PipelineStageRow): LeadStageView {
  return {
    id: row.id,
    orgId: row.orgId,
    name: row.name,
    kind: legacyStageKind(row),
    isSystem: legacyStageIsSystem(row),
    position: row.position,
    status: row.status,
    archivedAt: row.archivedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    pipelineId: row.pipelineId,
    type: row.type,
    behavior: row.behavior,
    exitKind: row.exitKind,
    requiresReason: row.requiresReason,
  };
}
```

#### `apps/api/src/domains/crm/pipeline-read.ts` (new file)

Create the file with exactly this content.

```ts
import { and, asc, eq } from 'drizzle-orm';
import type { getDb } from '../../db/client.js';
import { salesOpsPipelines, salesOpsPipelineStages } from '../../db/schema.js';
import type { PipelineStageRow } from './stage-view.js';

/**
 * Read helpers for the unified pipeline tables. Every function takes the tenant transaction its
 * caller already opened and filters by `org_id` itself (defence in depth: over the `app.fxl_admin`
 * connection RLS shows every org, and this filter is then the only scoping).
 */
type Db = ReturnType<typeof getDb>;

export type PipelineRow = typeof salesOpsPipelines.$inferSelect;

/**
 * The org's default pipeline id: the `is_default` row, else the first active pipeline by board
 * order. Null only when the org has no pipeline at all (callers that must write seed first).
 */
export async function defaultPipelineId(tx: Db, orgId: string): Promise<string | null> {
  const [row] = await tx
    .select({ id: salesOpsPipelines.id })
    .from(salesOpsPipelines)
    .where(and(eq(salesOpsPipelines.orgId, orgId), eq(salesOpsPipelines.status, 'active')))
    .orderBy(asc(salesOpsPipelines.isDefault), asc(salesOpsPipelines.position), asc(salesOpsPipelines.name))
    .limit(1);
  return row?.id ?? null;
}

export async function pipelineExists(tx: Db, orgId: string, pipelineId: string): Promise<boolean> {
  const [row] = await tx
    .select({ id: salesOpsPipelines.id })
    .from(salesOpsPipelines)
    .where(and(eq(salesOpsPipelines.orgId, orgId), eq(salesOpsPipelines.id, pipelineId)))
    .limit(1);
  return row !== undefined;
}

/** A pipeline's stages in board order, archived ones included. */
export function listPipelineStages(tx: Db, orgId: string, pipelineId: string): Promise<PipelineStageRow[]> {
  return tx
    .select()
    .from(salesOpsPipelineStages)
    .where(and(eq(salesOpsPipelineStages.orgId, orgId), eq(salesOpsPipelineStages.pipelineId, pipelineId)))
    .orderBy(asc(salesOpsPipelineStages.position), asc(salesOpsPipelineStages.name));
}
```

#### `apps/api/src/domains/crm/pipeline-write.ts` (new file)

Create the file with exactly this content.

```ts
import { DEFAULT_PIPELINE_KEY, DEFAULT_PIPELINE_NAME } from '@fxl-sales/shared-utils/default-pipeline';
import type { getDb } from '../../db/client.js';
import { salesOpsPipelines } from '../../db/schema.js';
import { defaultPipelineId } from './pipeline-read.js';

type Db = ReturnType<typeof getDb>;

/**
 * The default pipeline's id, creating the pipeline row WITHOUT any stage when the org has none.
 *
 * It exists for the etapa cadastro: an org whose first act is to create its own etapa must not be
 * seeded with the default seven afterwards ("seeded" means "has ANY pipeline row", see
 * `ensureDefaultPipeline`). The bare INSERT absorbs every unique index, so two concurrent first
 * writers leave one pipeline; the loser re-reads the winner's row. It is deliberately not one of
 * the four seed functions of `defaults.ts`: it seeds no stage, no transition and no field.
 */
export async function ensureBareDefaultPipeline(tx: Db, orgId: string): Promise<string> {
  const existing = await defaultPipelineId(tx, orgId);
  if (existing !== null) return existing;
  await tx
    .insert(salesOpsPipelines)
    .values({ orgId, name: DEFAULT_PIPELINE_NAME, systemKey: DEFAULT_PIPELINE_KEY, position: 0, isDefault: true })
    .onConflictDoNothing();
  const created = await defaultPipelineId(tx, orgId);
  if (created === null) throw new Error('default pipeline disappeared inside its own transaction');
  return created;
}
```

#### `apps/api/src/domains/crm/lead-fields.ts` (new file)

Create the file with exactly this content.

```ts
import { isIsoDay } from '@fxl-sales/shared-utils/sao-paulo-day';
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import type { getDb } from '../../db/client.js';
import {
  salesOpsCrmLeadFieldValues,
  salesOpsFieldDefinitions,
  salesOpsProducts,
  salesOpsSales,
} from '../../db/schema.js';
import { LeadInputError } from './lead-input-error.js';

/**
 * Typed dynamic lead fields (EAV) for the unified CRM lead: read them as the wire shape, validate a
 * write against the field definition, store each value in exactly one typed slot.
 *
 * The slot rule is the SEAM-CONTRACT's: text -> value_text; number -> value_number; money ->
 * value_cents (integer cents); date -> value_date; options -> value_option (the option key);
 * reference cliente -> value_client_id; produto or servico -> value_product_id + snapshot, OR
 * value_text + snapshot for a FREE item; venda -> value_sale_id; contato -> value_text.
 * The Cliente system field is NOT stored here: its `backing_column` is the lead's `client_id`, so
 * a write to it is handed back to the caller as `cliente` and read from the lead row.
 *
 * Pure of request context: takes the tenant transaction its caller already opened.
 */
type Db = ReturnType<typeof getDb>;

export type FieldDefinitionRow = typeof salesOpsFieldDefinitions.$inferSelect;
type ValueInsert = typeof salesOpsCrmLeadFieldValues.$inferInsert;

export type FieldWireItem = { id: string | null; name: string };
export type FieldWireValue = string | number | null | FieldWireItem[];
export type LeadFieldValue = { fieldId: string; key: string; value: FieldWireValue };

/** One `fields[]` entry of a write body (already shape-checked by `LeadFieldWriteSchema`). */
export type FieldWriteInput = {
  fieldId?: string | undefined;
  key?: string | undefined;
  value: string | number | null | Array<{ id?: string | null | undefined; name?: string | undefined }>;
};

/** The definitions the legacy write keys map onto. Byte-equal to the rows migration 0030/0031 creates. */
export const LEGACY_FIELD_SPECS = {
  produtos: {
    key: 'produtos',
    label: 'Produtos',
    kind: 'reference',
    referenceTarget: 'produto',
    multiple: true,
    filterable: true,
    position: 2,
  },
  descricao: { key: 'descricao', label: 'Descrição', kind: 'text', filterable: false, position: 3 },
  nascimento: { key: 'nascimento', label: 'Nascimento', kind: 'date', filterable: false, position: 4 },
} as const;
export type LegacyFieldKey = keyof typeof LEGACY_FIELD_SPECS;

export function loadFieldDefinitions(tx: Db, orgId: string): Promise<FieldDefinitionRow[]> {
  return tx
    .select()
    .from(salesOpsFieldDefinitions)
    .where(eq(salesOpsFieldDefinitions.orgId, orgId))
    .orderBy(asc(salesOpsFieldDefinitions.position), asc(salesOpsFieldDefinitions.key));
}

/**
 * The definition behind a legacy write key (`description`, `contactBirthDate`, `products`),
 * created on first use. A bare ON CONFLICT DO NOTHING on the unique (org_id, key) index, then a
 * re-read, so two concurrent first writes never 500.
 */
export async function ensureLegacyFieldDefinition(
  tx: Db,
  orgId: string,
  key: LegacyFieldKey,
): Promise<FieldDefinitionRow> {
  await tx
    .insert(salesOpsFieldDefinitions)
    .values({ orgId, ...LEGACY_FIELD_SPECS[key] })
    .onConflictDoNothing();
  const [row] = await tx
    .select()
    .from(salesOpsFieldDefinitions)
    .where(and(eq(salesOpsFieldDefinitions.orgId, orgId), eq(salesOpsFieldDefinitions.key, key)))
    .limit(1);
  if (!row) throw new Error(`field definition ${key} disappeared inside its own transaction`);
  return row;
}

// ─────────────────────────────────────────────────────────────────────────────
// Reads
// ─────────────────────────────────────────────────────────────────────────────

type ValueRow = typeof salesOpsCrmLeadFieldValues.$inferSelect;

function rowToItem(def: FieldDefinitionRow, row: ValueRow): FieldWireItem {
  switch (def.referenceTarget) {
    case 'cliente':
      return { id: row.valueClientId, name: row.refNameSnapshot ?? '' };
    case 'produto':
    case 'servico':
      return { id: row.valueProductId, name: row.refNameSnapshot ?? row.valueText ?? '' };
    case 'venda':
      return { id: row.valueSaleId, name: row.refNameSnapshot ?? '' };
    default:
      return { id: null, name: row.valueText ?? '' };
  }
}

function rowsToWire(def: FieldDefinitionRow, rows: ValueRow[]): FieldWireValue {
  if (rows.length === 0) return null;
  switch (def.kind) {
    case 'number':
      return rows[0]!.valueNumber === null ? null : Number(rows[0]!.valueNumber);
    case 'money':
      return rows[0]!.valueCents;
    case 'date':
      return rows[0]!.valueDate;
    case 'options':
      return rows[0]!.valueOption;
    case 'reference':
      return rows.map((row) => rowToItem(def, row));
    default:
      return rows[0]!.valueText;
  }
}

export type FieldReadLead = { id: string; clientId: string | null; clientNameSnapshot: string };

/**
 * Every ACTIVE definition for every lead, in definition order, `null` when the lead has no value.
 * Two statements regardless of the page size: the definitions, then every value of the page.
 */
export async function readLeadFields(
  tx: Db,
  orgId: string,
  leads: readonly FieldReadLead[],
): Promise<Map<string, LeadFieldValue[]>> {
  const byLead = new Map<string, LeadFieldValue[]>();
  if (leads.length === 0) return byLead;
  const definitions = (await loadFieldDefinitions(tx, orgId)).filter((def) => def.status === 'active');
  const values = await tx
    .select()
    .from(salesOpsCrmLeadFieldValues)
    .where(
      and(
        eq(salesOpsCrmLeadFieldValues.orgId, orgId),
        inArray(
          salesOpsCrmLeadFieldValues.leadId,
          leads.map((lead) => lead.id),
        ),
      ),
    )
    .orderBy(asc(salesOpsCrmLeadFieldValues.fieldId), asc(salesOpsCrmLeadFieldValues.position));
  const rowsByLeadField = new Map<string, ValueRow[]>();
  for (const row of values) {
    const key = `${row.leadId}:${row.fieldId}`;
    const bucket = rowsByLeadField.get(key) ?? [];
    bucket.push(row);
    rowsByLeadField.set(key, bucket);
  }
  for (const lead of leads) {
    byLead.set(
      lead.id,
      definitions.map((def) => {
        if (def.backingColumn === 'client_id') {
          return {
            fieldId: def.id,
            key: def.key,
            value: lead.clientId ? [{ id: lead.clientId, name: lead.clientNameSnapshot }] : null,
          };
        }
        return { fieldId: def.id, key: def.key, value: rowsToWire(def, rowsByLeadField.get(`${lead.id}:${def.id}`) ?? []) };
      }),
    );
  }
  return byLead;
}

/** The legacy projection of a lead's fields: `description`, `contactBirthDate` and `products` keep their old keys. */
export function projectLegacyFields(fields: readonly LeadFieldValue[]): {
  description: string | null;
  contactBirthDate: string | null;
  products: Array<{ productId: string | null; productNameSnapshot: string }>;
} {
  const of = (key: string) => fields.find((field) => field.key === key)?.value ?? null;
  const description = of('descricao');
  const birth = of('nascimento');
  const products = of('produtos');
  return {
    description: typeof description === 'string' ? description : null,
    contactBirthDate: typeof birth === 'string' ? birth : null,
    // Displayed by SNAPSHOT name (then id), the pre-cutover order: the stored positions are the write
    // order, which is not a list the operator authored.
    products: Array.isArray(products)
      ? products
          .map((item) => ({ productId: item.id, productNameSnapshot: item.name }))
          .sort(
            (a, b) =>
              a.productNameSnapshot.localeCompare(b.productNameSnapshot, 'en') ||
              (a.productId ?? '').localeCompare(b.productId ?? ''),
          )
      : [],
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Writes
// ─────────────────────────────────────────────────────────────────────────────

/** A validated replacement of ONE field's value set; empty `rows` clears the field. */
export type ResolvedFieldWrite = { definition: FieldDefinitionRow; rows: Array<Partial<ValueInsert>> };

export type ResolvedFieldWrites = {
  writes: ResolvedFieldWrite[];
  /** Set when the body wrote the Cliente field: the caller applies it to the lead's client_id. */
  cliente: { clientId: string | null; index: number } | null;
};

const invalid = (index: number) => new LeadInputError('field_invalid', index);
const MAX_TEXT = 4000;
const MAX_NUMBER = 1e13;

type RefItem = { id?: string | null | undefined; name?: string | undefined };

async function resolveProductItems(
  tx: Db,
  orgId: string,
  items: readonly RefItem[],
  missing: (index: number) => LeadInputError,
): Promise<Array<Partial<ValueInsert>>> {
  const rows: Array<Partial<ValueInsert>> = [];
  for (const [index, item] of items.entries()) {
    if (!item.id) {
      const name = item.name?.trim() ?? '';
      if (name === '' || name.length > 140) throw missing(index);
      rows.push({ valueText: name, refNameSnapshot: name });
      continue;
    }
    const [product] = await tx
      .select({ id: salesOpsProducts.id, name: salesOpsProducts.name })
      .from(salesOpsProducts)
      .where(and(eq(salesOpsProducts.orgId, orgId), eq(salesOpsProducts.id, item.id)))
      .limit(1);
    if (!product) throw missing(index);
    rows.push({ valueProductId: product.id, refNameSnapshot: product.name });
  }
  return rows;
}

async function resolveReference(
  tx: Db,
  orgId: string,
  def: FieldDefinitionRow,
  items: readonly RefItem[],
  index: number,
): Promise<Array<Partial<ValueInsert>>> {
  const notFound = () => new LeadInputError('field_reference_not_found', index);
  switch (def.referenceTarget) {
    case 'produto':
    case 'servico':
      return resolveProductItems(tx, orgId, items, notFound);
    case 'venda': {
      const rows: Array<Partial<ValueInsert>> = [];
      for (const item of items) {
        if (!item.id) throw notFound();
        const [sale] = await tx
          .select({ id: salesOpsSales.id, code: salesOpsSales.code })
          .from(salesOpsSales)
          .where(and(eq(salesOpsSales.orgId, orgId), eq(salesOpsSales.id, item.id)))
          .limit(1);
        if (!sale) throw notFound();
        rows.push({ valueSaleId: sale.id, refNameSnapshot: sale.code });
      }
      return rows;
    }
    case 'contato':
      return items.map((item) => {
        const name = item.name?.trim() ?? '';
        if (name === '' || name.length > 200) throw invalid(index);
        return { valueText: name, refNameSnapshot: name };
      });
    case 'cliente': {
      const rows: Array<Partial<ValueInsert>> = [];
      for (const item of items) {
        if (!item.id) throw notFound();
        const found = (await tx.execute(
          sql`SELECT name FROM sales_ops_clients WHERE org_id = ${orgId} AND id = ${item.id}::uuid LIMIT 1`,
        )) as unknown as Array<{ name: string }>;
        if (found[0] === undefined) throw notFound();
        rows.push({ valueClientId: item.id, refNameSnapshot: found[0].name });
      }
      return rows;
    }
    default:
      throw invalid(index);
  }
}

async function resolveOne(
  tx: Db,
  orgId: string,
  def: FieldDefinitionRow,
  value: FieldWriteInput['value'],
  index: number,
): Promise<Array<Partial<ValueInsert>>> {
  if (value === null) return [];
  switch (def.kind) {
    case 'text': {
      if (typeof value !== 'string') throw invalid(index);
      const text = value.trim();
      if (text.length > MAX_TEXT) throw invalid(index);
      return text === '' ? [] : [{ valueText: text }];
    }
    case 'number': {
      if (typeof value !== 'number' || !Number.isFinite(value) || Math.abs(value) >= MAX_NUMBER) throw invalid(index);
      return [{ valueNumber: String(value) }];
    }
    case 'money': {
      if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) throw invalid(index);
      return [{ valueCents: value }];
    }
    case 'date': {
      if (typeof value !== 'string' || !isIsoDay(value)) throw invalid(index);
      return [{ valueDate: value }];
    }
    case 'options': {
      const options = Array.isArray(def.options) ? (def.options as Array<{ key?: unknown }>) : [];
      if (typeof value !== 'string' || !options.some((option) => option.key === value)) throw invalid(index);
      return [{ valueOption: value }];
    }
    case 'reference': {
      if (!Array.isArray(value)) throw invalid(index);
      if (!def.multiple && value.length > 1) throw invalid(index);
      return resolveReference(tx, orgId, def, value, index);
    }
    default:
      throw invalid(index);
  }
}

/**
 * Validates every `fields[]` entry against its definition and returns the replacement sets.
 * Unknown or archived field -> `field_not_found`; a value of the wrong shape, a duplicate field in
 * one body, or more than one value on a single-valued field -> `field_invalid`; a reference that
 * does not exist in the org -> `field_reference_not_found`. All carry the entry index.
 */
export async function resolveFieldWrites(
  tx: Db,
  orgId: string,
  inputs: readonly FieldWriteInput[],
): Promise<ResolvedFieldWrites> {
  const result: ResolvedFieldWrites = { writes: [], cliente: null };
  if (inputs.length === 0) return result;
  const definitions = (await loadFieldDefinitions(tx, orgId)).filter((def) => def.status === 'active');
  const seen = new Set<string>();
  for (const [index, input] of inputs.entries()) {
    const def = definitions.find((candidate) =>
      input.fieldId ? candidate.id === input.fieldId : candidate.key === input.key,
    );
    if (!def) throw new LeadInputError('field_not_found', index);
    if (seen.has(def.id)) throw invalid(index);
    seen.add(def.id);
    if (def.backingColumn === 'client_id') {
      if (input.value === null) {
        result.cliente = { clientId: null, index };
        continue;
      }
      if (!Array.isArray(input.value) || input.value.length !== 1 || !input.value[0]!.id) throw invalid(index);
      result.cliente = { clientId: input.value[0]!.id, index };
      continue;
    }
    result.writes.push({ definition: def, rows: await resolveOne(tx, orgId, def, input.value, index) });
  }
  return result;
}

/** Replaces each field's value set: delete the lead's rows of that field, insert the new ones at positions 0..n. */
export async function applyFieldWrites(
  tx: Db,
  orgId: string,
  leadId: string,
  writes: readonly ResolvedFieldWrite[],
): Promise<void> {
  for (const write of writes) {
    await tx
      .delete(salesOpsCrmLeadFieldValues)
      .where(
        and(
          eq(salesOpsCrmLeadFieldValues.orgId, orgId),
          eq(salesOpsCrmLeadFieldValues.leadId, leadId),
          eq(salesOpsCrmLeadFieldValues.fieldId, write.definition.id),
        ),
      );
    if (write.rows.length === 0) continue;
    await tx.insert(salesOpsCrmLeadFieldValues).values(
      write.rows.map((row, position) => ({ ...row, orgId, leadId, fieldId: write.definition.id, position })),
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Legacy write keys
// ─────────────────────────────────────────────────────────────────────────────

/** The old lead payload keys, mapped onto their field definitions. `undefined` means "not in the body". */
export type LegacyFieldInput = {
  description?: string | null | undefined;
  contactBirthDate?: string | null | undefined;
  products?: ReadonlyArray<{ productId?: string | undefined; productName?: string | undefined }> | undefined;
};

async function existingDefinition(tx: Db, orgId: string, key: LegacyFieldKey): Promise<FieldDefinitionRow | null> {
  const [row] = await tx
    .select()
    .from(salesOpsFieldDefinitions)
    .where(and(eq(salesOpsFieldDefinitions.orgId, orgId), eq(salesOpsFieldDefinitions.key, key)))
    .limit(1);
  return row ?? null;
}

/**
 * `description` -> `descricao`, `contactBirthDate` -> `nascimento`, `products` -> `produtos`.
 * A non-empty value creates the definition on first use; clearing writes nothing when the org
 * never had the definition (there is nothing to clear).
 */
export async function resolveLegacyFieldWrites(
  tx: Db,
  orgId: string,
  input: LegacyFieldInput,
): Promise<ResolvedFieldWrite[]> {
  const writes: ResolvedFieldWrite[] = [];
  const scalar = async (key: LegacyFieldKey, value: string | null, slot: 'valueText' | 'valueDate') => {
    const text = value === null ? '' : value.trim();
    if (text === '') {
      const existing = await existingDefinition(tx, orgId, key);
      if (existing) writes.push({ definition: existing, rows: [] });
      return;
    }
    writes.push({ definition: await ensureLegacyFieldDefinition(tx, orgId, key), rows: [{ [slot]: text }] });
  };
  if (input.description !== undefined) await scalar('descricao', input.description, 'valueText');
  if (input.contactBirthDate !== undefined) await scalar('nascimento', input.contactBirthDate, 'valueDate');
  if (input.products !== undefined) {
    const items = input.products.map((row) => ({ id: row.productId ?? null, name: row.productName }));
    const rows = await resolveProductItems(tx, orgId, items, (index) => new LeadInputError('product_not_found', index));
    if (rows.length === 0) {
      const existing = await existingDefinition(tx, orgId, 'produtos');
      if (existing) writes.push({ definition: existing, rows: [] });
    } else {
      writes.push({ definition: await ensureLegacyFieldDefinition(tx, orgId, 'produtos'), rows });
    }
  }
  return writes;
}
```

#### `apps/api/drizzle/0031_crm_cutover_resync.sql` (new file)

Create the file with exactly this content.

```sql
-- 0031_crm_cutover_resync - the phase 2 cutover RESYNC (vendas-crm-unificado slice 07a1).
--
-- Part 1, statements 1 to 17: a BYTE-FOR-BYTE repeat of 0030_crm_legacy_copy.sql, from the first
-- set_config to the last INSERT (crm-cutover-resync.test.ts compares the two files). It copies what
-- the old tables received after 0030 and is a no-op for what is already there (same uuids,
-- ON CONFLICT DO NOTHING).
--
-- Part 2, after the repeat: what a repeat cannot do. A row that was changed in the OLD tables after
-- 0030 (a lead moved, edited, deleted or restored, an etapa renamed or archived) keeps a stale copy,
-- so the rows the old table changed LAST are written over the copy. "Changed last" is the rule
-- COALESCE(old.updated_at, '-infinity') > COALESCE(new.updated_at, '-infinity'): every old writer
-- (create, patch, move, delete, restore, etapa edit) stamps updated_at, and the new code always
-- stamps it too, so a row the NEW code wrote is never overwritten and the whole part 2 is idempotent
-- (a second run changes nothing).
--   * etapas: name, position, status, archived_at, updated_at (a rename that would collide with
--     another etapa of the pipeline is skipped, never aborts the migration);
--   * one history event (from the copy's etapa to the old etapa, actor 'system'/'Migração') for every
--     lead whose etapa differs; written BEFORE the lead update so the comparison still sees both;
--   * leads: contact, etapa, position, stage_changed_at, vendedor, empresa, valor, lost_reason, sale_id,
--     deleted_* and updated_at;
--   * field values: descricao, nascimento and produtos are upserted (ON CONFLICT DO UPDATE) from
--     the changed leads. A value row that was REMOVED in the old table (a produto dropped, a
--     description cleared, a birth date cleared) is NOT removed here: a migration may not DELETE.
--     The stale value stays visible until an operator edits the lead. Accepted, documented, tested.
--
-- After this migration the API reads and writes ONLY the unified tables (slice 07a2): the old
-- tables sales_ops_leads, sales_ops_lead_products and sales_ops_lead_stages stay byte-intact as the
-- frozen pre-cutover copy and are never written again by product code. 0030 and 0031 ship in the
-- same deploy, so the window this resync covers is empty in practice.
-- 100% additive to the schema: INSERT and UPDATE of rows of the unified tables only, no DELETE, no
-- privilege statement, ordinary non-phased migration.
SELECT set_config('app.fxl_admin', 'true', true);--> statement-breakpoint
INSERT INTO "sales_ops_pipelines" ("org_id", "name", "system_key", "position", "is_default")
SELECT o."org_id", 'Funil CRM padrão', 'crm-padrao', 0, true
FROM (
  SELECT "org_id" FROM "sales_ops_people"
  UNION SELECT "org_id" FROM "sales_ops_settings"
  UNION SELECT "org_id" FROM "sales_ops_sales"
  UNION SELECT "org_id" FROM "sales_ops_lead_stages"
  UNION SELECT "org_id" FROM "sales_ops_leads"
  UNION SELECT "org_id" FROM "sales_ops_clients"
) AS o
ON CONFLICT DO NOTHING;--> statement-breakpoint
INSERT INTO "sales_ops_pipeline_stages" ("id", "org_id", "pipeline_id", "name", "position", "type", "behavior", "exit_kind", "requires_reason", "status", "archived_at", "created_at", "updated_at")
SELECT s."id", s."org_id", p."id", s."name", s."position",
  CASE s."kind" WHEN 'conversion' THEN 'orcamento' WHEN 'lost' THEN 'saida' ELSE 'normal' END,
  CASE s."kind" WHEN 'conversion' THEN 'opens_orcamentos' ELSE 'none' END,
  CASE s."kind" WHEN 'lost' THEN 'perdido' ELSE NULL END,
  s."kind" = 'lost',
  s."status", s."archived_at", s."created_at", s."updated_at"
FROM "sales_ops_lead_stages" s
JOIN "sales_ops_pipelines" p ON p."org_id" = s."org_id" AND p."system_key" = 'crm-padrao'
ON CONFLICT DO NOTHING;--> statement-breakpoint
INSERT INTO "sales_ops_pipeline_stages" ("org_id", "pipeline_id", "name", "position", "type", "behavior", "exit_kind", "requires_reason")
SELECT p."org_id", p."id", d."label", d."ord", d."type", d."behavior", d."exit_kind", d."requires_reason"
FROM "sales_ops_pipelines" p
CROSS JOIN (VALUES
  ('Novo',          1, 'normal',    'none',             NULL,       false),
  ('Qualificação',  2, 'normal',    'none',             NULL,       false),
  ('Em negociação', 3, 'normal',    'none',             NULL,       false),
  ('Proposta',      4, 'orcamento', 'opens_orcamentos', NULL,       false),
  ('Ganho',         5, 'saida',     'none',             'ganho',    false),
  ('Perdido',       6, 'saida',     'none',             'perdido',  true),
  ('Pausado',       7, 'saida',     'none',             'pausado',  false)
) AS d("label", "ord", "type", "behavior", "exit_kind", "requires_reason")
WHERE p."system_key" = 'crm-padrao'
  AND NOT EXISTS (SELECT 1 FROM "sales_ops_pipeline_stages" x WHERE x."pipeline_id" = p."id")
ON CONFLICT DO NOTHING;--> statement-breakpoint
INSERT INTO "sales_ops_pipeline_stages" ("org_id", "pipeline_id", "name", "position", "type", "behavior", "exit_kind", "requires_reason")
SELECT p."org_id", p."id",
  CASE WHEN EXISTS (SELECT 1 FROM "sales_ops_pipeline_stages" y WHERE y."pipeline_id" = p."id" AND y."name" = e."label")
       THEN e."label" || ' (saída)' ELSE e."label" END,
  (SELECT COALESCE(MAX(z."position"), 0) FROM "sales_ops_pipeline_stages" z WHERE z."pipeline_id" = p."id") + e."ord",
  'saida', 'none', e."exit_kind", false
FROM "sales_ops_pipelines" p
CROSS JOIN (VALUES ('Ganho', 'ganho', 1), ('Pausado', 'pausado', 2)) AS e("label", "exit_kind", "ord")
WHERE p."system_key" = 'crm-padrao'
  AND NOT EXISTS (SELECT 1 FROM "sales_ops_pipeline_stages" x WHERE x."pipeline_id" = p."id" AND x."exit_kind" = e."exit_kind")
ON CONFLICT DO NOTHING;--> statement-breakpoint
INSERT INTO "sales_ops_pipeline_transitions" ("org_id", "pipeline_id", "from_stage_id", "to_stage_id")
WITH act AS (
  SELECT s."org_id", s."pipeline_id", s."id", s."type", s."exit_kind", s."position", s."name"
  FROM "sales_ops_pipeline_stages" s
  JOIN "sales_ops_pipelines" p ON p."id" = s."pipeline_id" AND p."system_key" = 'crm-padrao'
  WHERE s."status" = 'active'
    AND NOT EXISTS (SELECT 1 FROM "sales_ops_pipeline_transitions" t WHERE t."pipeline_id" = s."pipeline_id")
), opn AS (
  SELECT a.*, row_number() OVER (PARTITION BY a."pipeline_id" ORDER BY a."position", a."name") AS rn
  FROM act a WHERE a."type" <> 'saida'
)
SELECT "org_id", "pipeline_id", "from_id", "to_id" FROM (
  SELECT a."org_id", a."pipeline_id", a."id" AS "from_id", b."id" AS "to_id" FROM opn a JOIN opn b ON b."pipeline_id" = a."pipeline_id" AND b."rn" = a."rn" + 1
  UNION
  SELECT a."org_id", a."pipeline_id", b."id", a."id" FROM opn a JOIN opn b ON b."pipeline_id" = a."pipeline_id" AND b."rn" = a."rn" + 1
  UNION
  SELECT o."org_id", o."pipeline_id", o."id", e."id" FROM opn o JOIN act e ON e."pipeline_id" = o."pipeline_id" AND e."type" = 'saida'
  UNION
  SELECT e."org_id", e."pipeline_id", e."id", o."id" FROM act e JOIN opn o ON o."pipeline_id" = e."pipeline_id" WHERE e."type" = 'saida' AND e."exit_kind" = 'pausado'
) AS g
ON CONFLICT DO NOTHING;--> statement-breakpoint
INSERT INTO "sales_ops_field_definitions" ("org_id", "key", "label", "kind", "reference_target", "multiple", "filterable", "is_system", "removable", "backing_column", "position")
SELECT o."org_id", 'cliente', 'Cliente', 'reference', 'cliente', false, true, true, false, 'client_id', 1
FROM (SELECT "org_id" FROM "sales_ops_pipelines" WHERE "system_key" = 'crm-padrao') AS o
ON CONFLICT DO NOTHING;--> statement-breakpoint
INSERT INTO "sales_ops_field_definitions" ("org_id", "key", "label", "kind", "reference_target", "multiple", "filterable", "position")
SELECT DISTINCT lp."org_id", 'produtos', 'Produtos', 'reference', 'produto', true, true, 2
FROM "sales_ops_lead_products" lp
ON CONFLICT DO NOTHING;--> statement-breakpoint
INSERT INTO "sales_ops_field_definitions" ("org_id", "key", "label", "kind", "filterable", "position")
SELECT DISTINCT l."org_id", 'descricao', 'Descrição', 'text', false, 3
FROM "sales_ops_leads" l WHERE l."description" IS NOT NULL
ON CONFLICT DO NOTHING;--> statement-breakpoint
INSERT INTO "sales_ops_field_definitions" ("org_id", "key", "label", "kind", "filterable", "position")
SELECT DISTINCT l."org_id", 'nascimento', 'Nascimento', 'date', false, 4
FROM "sales_ops_leads" l WHERE l."contact_birth_date" IS NOT NULL
ON CONFLICT DO NOTHING;--> statement-breakpoint
INSERT INTO "sales_ops_crm_leads" ("id", "org_id", "contact_name", "contact_phone", "contact_email", "pipeline_id", "stage_id", "position", "stage_changed_at", "seller_person_id", "seller_name_snapshot", "client_id", "client_name_snapshot", "estimated_value_brl", "lost_reason", "sale_id", "created_at", "updated_at", "deleted_at", "deleted_by_user_id", "deleted_by_name")
SELECT l."id", l."org_id", l."contact_name", l."contact_phone", l."contact_email", p."id", l."stage_id", l."position", l."stage_changed_at", l."seller_person_id", l."seller_name_snapshot", l."client_id", l."client_name_snapshot", l."estimated_value_brl", l."lost_reason", l."sale_id", l."created_at", l."updated_at", l."deleted_at", l."deleted_by_user_id", l."deleted_by_name"
FROM "sales_ops_leads" l
JOIN "sales_ops_pipelines" p ON p."org_id" = l."org_id" AND p."system_key" = 'crm-padrao'
ON CONFLICT ("id") DO NOTHING;--> statement-breakpoint
INSERT INTO "sales_ops_crm_lead_field_values" ("org_id", "lead_id", "field_id", "position", "value_text")
SELECT l."org_id", l."id", f."id", 0, l."description"
FROM "sales_ops_leads" l
JOIN "sales_ops_field_definitions" f ON f."org_id" = l."org_id" AND f."key" = 'descricao'
WHERE l."description" IS NOT NULL
ON CONFLICT ("org_id", "lead_id", "field_id", "position") DO NOTHING;--> statement-breakpoint
INSERT INTO "sales_ops_crm_lead_field_values" ("org_id", "lead_id", "field_id", "position", "value_date")
SELECT l."org_id", l."id", f."id", 0, l."contact_birth_date"
FROM "sales_ops_leads" l
JOIN "sales_ops_field_definitions" f ON f."org_id" = l."org_id" AND f."key" = 'nascimento'
WHERE l."contact_birth_date" IS NOT NULL
ON CONFLICT ("org_id", "lead_id", "field_id", "position") DO NOTHING;--> statement-breakpoint
INSERT INTO "sales_ops_crm_lead_field_values" ("org_id", "lead_id", "field_id", "position", "value_text", "value_product_id", "ref_name_snapshot")
SELECT lp."org_id", lp."lead_id", f."id",
  (row_number() OVER (PARTITION BY lp."lead_id" ORDER BY lp."created_at", lp."id") - 1)::integer,
  CASE WHEN lp."product_id" IS NULL THEN lp."product_name_snapshot" ELSE NULL END,
  lp."product_id",
  lp."product_name_snapshot"
FROM "sales_ops_lead_products" lp
JOIN "sales_ops_field_definitions" f ON f."org_id" = lp."org_id" AND f."key" = 'produtos'
ON CONFLICT ("org_id", "lead_id", "field_id", "position") DO NOTHING;--> statement-breakpoint
INSERT INTO "sales_ops_crm_lead_events" ("org_id", "lead_id", "kind", "from_stage_id", "to_stage_id", "reason", "actor_user_id", "actor_name_snapshot", "occurred_at")
SELECT l."org_id", l."id", 'stage_changed', NULL, l."stage_id", l."lost_reason", 'system', 'Migração', l."stage_changed_at"
FROM "sales_ops_leads" l
ON CONFLICT DO NOTHING;
--> statement-breakpoint
UPDATE "sales_ops_pipeline_stages" AS c
SET "name" = s."name", "position" = s."position", "status" = s."status", "archived_at" = s."archived_at", "updated_at" = s."updated_at"
FROM "sales_ops_lead_stages" AS s
WHERE c."id" = s."id" AND c."org_id" = s."org_id"
  AND COALESCE(s."updated_at", '-infinity'::timestamptz) > COALESCE(c."updated_at", '-infinity'::timestamptz)
  AND NOT EXISTS (SELECT 1 FROM "sales_ops_pipeline_stages" o WHERE o."pipeline_id" = c."pipeline_id" AND o."name" = s."name" AND o."id" <> c."id");--> statement-breakpoint
INSERT INTO "sales_ops_crm_lead_events" ("org_id", "lead_id", "kind", "from_stage_id", "to_stage_id", "reason", "actor_user_id", "actor_name_snapshot", "occurred_at")
SELECT l."org_id", l."id", 'stage_changed', c."stage_id", l."stage_id", l."lost_reason", 'system', 'Migração', l."stage_changed_at"
FROM "sales_ops_leads" l
JOIN "sales_ops_crm_leads" c ON c."id" = l."id" AND c."org_id" = l."org_id"
WHERE l."stage_id" <> c."stage_id"
  AND COALESCE(l."updated_at", '-infinity'::timestamptz) > COALESCE(c."updated_at", '-infinity'::timestamptz);--> statement-breakpoint
INSERT INTO "sales_ops_crm_lead_field_values" ("org_id", "lead_id", "field_id", "position", "value_text")
SELECT l."org_id", l."id", f."id", 0, l."description"
FROM "sales_ops_leads" l
JOIN "sales_ops_crm_leads" c ON c."id" = l."id" AND c."org_id" = l."org_id"
JOIN "sales_ops_field_definitions" f ON f."org_id" = l."org_id" AND f."key" = 'descricao'
WHERE l."description" IS NOT NULL
  AND COALESCE(l."updated_at", '-infinity'::timestamptz) > COALESCE(c."updated_at", '-infinity'::timestamptz)
ON CONFLICT ("org_id", "lead_id", "field_id", "position") DO UPDATE SET "value_text" = EXCLUDED."value_text", "updated_at" = now();--> statement-breakpoint
INSERT INTO "sales_ops_crm_lead_field_values" ("org_id", "lead_id", "field_id", "position", "value_date")
SELECT l."org_id", l."id", f."id", 0, l."contact_birth_date"
FROM "sales_ops_leads" l
JOIN "sales_ops_crm_leads" c ON c."id" = l."id" AND c."org_id" = l."org_id"
JOIN "sales_ops_field_definitions" f ON f."org_id" = l."org_id" AND f."key" = 'nascimento'
WHERE l."contact_birth_date" IS NOT NULL
  AND COALESCE(l."updated_at", '-infinity'::timestamptz) > COALESCE(c."updated_at", '-infinity'::timestamptz)
ON CONFLICT ("org_id", "lead_id", "field_id", "position") DO UPDATE SET "value_date" = EXCLUDED."value_date", "updated_at" = now();--> statement-breakpoint
INSERT INTO "sales_ops_crm_lead_field_values" ("org_id", "lead_id", "field_id", "position", "value_text", "value_product_id", "ref_name_snapshot")
SELECT lp."org_id", lp."lead_id", f."id",
  (row_number() OVER (PARTITION BY lp."lead_id" ORDER BY lp."created_at", lp."id") - 1)::integer,
  CASE WHEN lp."product_id" IS NULL THEN lp."product_name_snapshot" ELSE NULL END,
  lp."product_id",
  lp."product_name_snapshot"
FROM "sales_ops_lead_products" lp
JOIN "sales_ops_leads" l ON l."id" = lp."lead_id" AND l."org_id" = lp."org_id"
JOIN "sales_ops_crm_leads" c ON c."id" = l."id" AND c."org_id" = l."org_id"
JOIN "sales_ops_field_definitions" f ON f."org_id" = lp."org_id" AND f."key" = 'produtos'
WHERE COALESCE(l."updated_at", '-infinity'::timestamptz) > COALESCE(c."updated_at", '-infinity'::timestamptz)
ON CONFLICT ("org_id", "lead_id", "field_id", "position") DO UPDATE SET "value_text" = EXCLUDED."value_text", "value_product_id" = EXCLUDED."value_product_id", "ref_name_snapshot" = EXCLUDED."ref_name_snapshot", "updated_at" = now();--> statement-breakpoint
UPDATE "sales_ops_crm_leads" AS c
SET "contact_name" = l."contact_name", "contact_phone" = l."contact_phone", "contact_email" = l."contact_email",
  "stage_id" = l."stage_id", "position" = l."position", "stage_changed_at" = l."stage_changed_at",
  "seller_person_id" = l."seller_person_id", "seller_name_snapshot" = l."seller_name_snapshot",
  "client_id" = l."client_id", "client_name_snapshot" = l."client_name_snapshot",
  "estimated_value_brl" = l."estimated_value_brl", "lost_reason" = l."lost_reason", "sale_id" = l."sale_id",
  "deleted_at" = l."deleted_at", "deleted_by_user_id" = l."deleted_by_user_id", "deleted_by_name" = l."deleted_by_name",
  "updated_at" = l."updated_at"
FROM "sales_ops_leads" AS l
WHERE c."id" = l."id" AND c."org_id" = l."org_id"
  AND COALESCE(l."updated_at", '-infinity'::timestamptz) > COALESCE(c."updated_at", '-infinity'::timestamptz);
```

#### `apps/api/test/rls/crm-cutover-resync.test.ts` (new file)

Create the file with exactly this content.

```ts
/**
 * Migration oracle for 0031 (vendas-crm-unificado slice 07a1): the phase 2 cutover RESYNC.
 *
 * A scratch database is migrated through 0030 (which copied the old etapas and leads), then the OLD
 * tables are mutated the way the old API would have between 0030 and the cutover (a lead moved,
 * edited, deleted, restored, a product replaced, an etapa renamed, a new lead and a new org), then
 * 0031 runs. Synthetic data only.
 *
 * Run: pnpm --filter @fxl-sales/api exec env VITEST_INTEGRATION=1 vitest run test/rls/crm-cutover-resync.test.ts
 */
import fs from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { scanSql } from '../../src/db/__tests__/additive-migration-scan.js';
import { runDatabaseMigrations } from '../../src/db/migration-runner.js';
import {
  cleanupScratch,
  createScratchDatabase,
  MIGRATIONS_FOLDER,
  scratchClient,
  type ScratchDatabase,
} from './scratch-database.js';

const BREAKPOINT = '--> statement-breakpoint';
const TAG_0029 = '0029_crm_unificado_modelo';
const TAG_0030 = '0030_crm_legacy_copy';
const FILE_0030 = '0030_crm_legacy_copy.sql';
const FILE_0031 = '0031_crm_cutover_resync.sql';
const START = "SELECT set_config('app.fxl_admin'";

const SOURCE_TABLES = ['sales_ops_lead_stages', 'sales_ops_leads', 'sales_ops_lead_products', 'sales_ops_clients', 'sales_ops_people', 'sales_ops_sales'] as const;
const CRM_TABLES = [
  'sales_ops_pipelines',
  'sales_ops_pipeline_stages',
  'sales_ops_pipeline_transitions',
  'sales_ops_field_definitions',
  'sales_ops_crm_leads',
  'sales_ops_crm_lead_field_values',
  'sales_ops_crm_lead_events',
] as const;

const A = (n: string) => `a0000000-0000-4000-8000-000000000${n}`;
const D = (n: string) => `d0000000-0000-4000-8000-000000000${n}`;

const SEED_SQL = `SELECT set_config('app.fxl_admin', 'true', false);
INSERT INTO sales_ops_people (id, org_id, display_name) VALUES ('${A('001')}','orgA','Vendedora Ana');
INSERT INTO sales_ops_clients (id, org_id, name) VALUES ('${A('010')}','orgA','Cliente Alfa');
INSERT INTO sales_ops_products (id, org_id, name, seller_commission_value, finder_commission_value, seller_with_finder_commission_value) VALUES ('${A('020')}','orgA','Produto X',0,0,0);
INSERT INTO sales_ops_lead_stages (id, org_id, name, kind, is_system, position, status) VALUES
 ('${A('101')}','orgA','Prospecção','normal',false,1,'active'),
 ('${A('102')}','orgA','Em negociação','normal',false,2,'active'),
 ('${A('103')}','orgA','Proposta','conversion',true,3,'active'),
 ('${A('104')}','orgA','Perdido','lost',true,4,'active'),
 ('${A('105')}','orgA','Antiga','normal',false,5,'active');
INSERT INTO sales_ops_leads (id, org_id, contact_name, contact_email, contact_birth_date, client_id, client_name_snapshot, estimated_value_brl, description, seller_person_id, seller_name_snapshot, stage_id, stage_changed_at, position) VALUES
 ('${A('201')}','orgA','Lead intocado','u@x.com',NULL,NULL,'',1000,NULL,NULL,'','${A('101')}','2026-09-01T10:00:00Z',1),
 ('${A('202')}','orgA','Lead editado','e@x.com','1990-05-04',NULL,'Empresa livre',50000,'desc antiga',NULL,'','${A('101')}','2026-09-02T10:00:00Z',2),
 ('${A('203')}','orgA','Lead excluído','x@x.com',NULL,NULL,'',0,NULL,NULL,'','${A('101')}','2026-09-03T10:00:00Z',3),
 ('${A('204')}','orgA','Lead a excluir','y@x.com',NULL,NULL,'',7000,NULL,NULL,'','${A('101')}','2026-09-04T10:00:00Z',4),
 ('${A('205')}','orgA','Lead a mover','z@x.com',NULL,'${A('010')}','Cliente Alfa',12345,NULL,'${A('001')}','Vendedora Ana','${A('102')}','2026-09-05T10:00:00Z',1);
UPDATE sales_ops_leads SET deleted_at = now(), deleted_by_user_id = 'u1', deleted_by_name = 'Admin' WHERE id = '${A('203')}';
INSERT INTO sales_ops_lead_products (id, org_id, lead_id, product_id, product_name_snapshot) VALUES
 ('${A('301')}','orgA','${A('205')}','${A('020')}','Produto X'),
 ('${A('302')}','orgA','${A('205')}',NULL,'Item livre sem catálogo');
`;

/** What the OLD API does after 0030: every write stamps updated_at. */
const OLD_WRITES_SQL = `SELECT set_config('app.fxl_admin', 'true', false);
-- moved: etapa, position, stage_changed_at, updated_at
UPDATE sales_ops_leads SET stage_id = '${A('101')}', position = 9, stage_changed_at = '2026-10-01T09:00:00Z', updated_at = '2026-10-01T09:00:00Z' WHERE id = '${A('205')}';
-- edited: name, value, description; the birth date is cleared (a removal the migration cannot mirror)
UPDATE sales_ops_leads SET contact_name = 'Lead editado 2', estimated_value_brl = 99000, description = 'desc nova', contact_birth_date = NULL, updated_at = '2026-10-02T09:00:00Z' WHERE id = '${A('202')}';
-- deleted
UPDATE sales_ops_leads SET deleted_at = '2026-10-03T09:00:00Z', deleted_by_user_id = 'u2', deleted_by_name = 'Gestora', updated_at = '2026-10-03T09:00:00Z' WHERE id = '${A('204')}';
-- restored
UPDATE sales_ops_leads SET deleted_at = NULL, deleted_by_user_id = NULL, deleted_by_name = NULL, updated_at = '2026-10-04T09:00:00Z' WHERE id = '${A('203')}';
-- produtos replaced wholesale (delete + insert) by ONE free item
DELETE FROM sales_ops_lead_products WHERE lead_id = '${A('205')}';
INSERT INTO sales_ops_lead_products (id, org_id, lead_id, product_id, product_name_snapshot) VALUES ('${A('303')}','orgA','${A('205')}',NULL,'Item novo');
-- an etapa renamed, and a NAME SWAP: 101 gives its name away and 102 takes it. In the new table the
-- take-over collides until 101 is renamed, so the first run skips it (never aborts) and a second converges.
UPDATE sales_ops_lead_stages SET name = 'Antiga 2', updated_at = '2026-10-05T09:00:00Z' WHERE id = '${A('105')}';
UPDATE sales_ops_lead_stages SET name = 'Novo X', updated_at = '2026-10-05T09:00:00Z' WHERE id = '${A('101')}';
UPDATE sales_ops_lead_stages SET name = 'Prospecção', updated_at = '2026-10-05T09:00:00Z' WHERE id = '${A('102')}';
-- a new lead in an existing org, and a brand new org with an etapa and a lead
INSERT INTO sales_ops_leads (id, org_id, contact_name, contact_email, client_name_snapshot, estimated_value_brl, stage_id, stage_changed_at, position, description) VALUES
 ('${A('206')}','orgA','Lead novo','n@x.com','',5,'${A('101')}','2026-10-06T09:00:00Z',10,'com descrição');
INSERT INTO sales_ops_people (id, org_id, display_name) VALUES ('${D('001')}','orgD','Pessoa D');
INSERT INTO sales_ops_lead_stages (id, org_id, name, kind, is_system, position) VALUES ('${D('101')}','orgD','Novo','normal',false,1);
INSERT INTO sales_ops_leads (id, org_id, contact_name, contact_email, client_name_snapshot, stage_id, position) VALUES ('${D('201')}','orgD','Lead D','d@x.com','','${D('101')}',1);
`;

type Fingerprint = Record<string, { n: number; hash: string }>;

describe('migration 0031 (cutover resync) on a database that took old-table writes after 0030', () => {
  let scratch: ScratchDatabase;
  let sourceBeforeResync: Fingerprint;

  async function fingerprint(tables: readonly string[]): Promise<Fingerprint> {
    const result: Fingerprint = {};
    for (const table of tables) {
      const [row] = await scratch.adminScratch.unsafe<{ n: number; hash: string }[]>(
        `SELECT count(*)::int AS n, coalesce(md5(string_agg(t::text, '|' ORDER BY t::text)), '') AS hash FROM ${table} t`,
      );
      result[table] = row!;
    }
    return result;
  }
  const rows = async <T extends object>(query: string): Promise<T[]> => [...(await scratch.adminScratch.unsafe<T[]>(query))];
  const chunks31 = () =>
    fs
      .readFileSync(path.resolve(MIGRATIONS_FOLDER, FILE_0031), 'utf8')
      .split(BREAKPOINT)
      .map((chunk) => chunk.trim())
      .filter(Boolean);
  const rerun0031 = async () => {
    for (const chunk of chunks31()) await scratch.adminScratch.unsafe(chunk);
  };

  beforeAll(async () => {
    scratch = await createScratchDatabase();
    await runDatabaseMigrations({ databaseUrl: scratch.ownerUrl, migrationsFolder: MIGRATIONS_FOLDER, throughTag: TAG_0029 });
    await scratchClient(scratch).begin(async (tx) => {
      await tx.unsafe(SEED_SQL);
    });
    await runDatabaseMigrations({ databaseUrl: scratch.ownerUrl, migrationsFolder: MIGRATIONS_FOLDER, throughTag: TAG_0030 });
    await scratchClient(scratch).begin(async (tx) => {
      await tx.unsafe(OLD_WRITES_SQL);
    });
    sourceBeforeResync = await fingerprint(SOURCE_TABLES);
    await runDatabaseMigrations({ databaseUrl: scratch.ownerUrl, migrationsFolder: MIGRATIONS_FOLDER });
  }, 120000);

  afterAll(async () => {
    const errors = await cleanupScratch(scratch);
    if (errors.length > 0) throw new AggregateError(errors, 'scratch database cleanup failed');
  });

  it('repeats 0030 byte for byte, then only INSERTs and UPDATEs rows of the unified tables', () => {
    const a = fs.readFileSync(path.resolve(MIGRATIONS_FOLDER, FILE_0030), 'utf8');
    const b = fs.readFileSync(path.resolve(MIGRATIONS_FOLDER, FILE_0031), 'utf8');
    const repeat = a.slice(a.indexOf(START)).trimEnd();
    expect(b.includes(repeat)).toBe(true);
    expect(b.indexOf(START)).toBeLessThan(b.indexOf(repeat) + 1);
    expect(scanSql(b)).toEqual([]);
    const after = b.slice(b.indexOf(repeat) + repeat.length);
    for (const chunk of after.split(BREAKPOINT).map((c) => c.trim()).filter(Boolean)) {
      expect(chunk, chunk.slice(0, 60)).toMatch(/^(INSERT INTO|UPDATE) "sales_ops_(pipeline_stages|crm_lead_events|crm_lead_field_values|crm_leads)"/);
    }
  });

  it('writes no old table: the source fingerprint taken before 0031 equals the one after', async () => {
    expect(await fingerprint(SOURCE_TABLES)).toEqual(sourceBeforeResync);
    expect(sourceBeforeResync['sales_ops_leads']!.n).toBe(7);
  });

  it('copies the rows the old tables got after 0030 with the same ids (new lead, new org, its etapa and pipeline)', async () => {
    expect((await rows<{ id: string }>(`SELECT id FROM sales_ops_crm_leads WHERE id IN ('${A('206')}','${D('201')}') ORDER BY id`)).length).toBe(2);
    const pipelineD = await rows<{ system_key: string }>(`SELECT system_key FROM sales_ops_pipelines WHERE org_id = 'orgD'`);
    expect(pipelineD).toEqual([{ system_key: 'crm-padrao' }]);
    expect((await rows(`SELECT id FROM sales_ops_pipeline_stages WHERE id = '${D('101')}'`)).length).toBe(1);
  });

  it('overwrites a stale copy with the row the old table changed last (move, edit, delete, restore)', async () => {
    const lead = async (id: string) =>
      (await rows<Record<string, unknown>>(`SELECT * FROM sales_ops_crm_leads WHERE id = '${id}'`))[0]!;
    const moved = await lead(A('205'));
    expect(moved.stage_id).toBe(A('101'));
    expect(moved.position).toBe(9);
    expect(new Date(moved.stage_changed_at as Date).toISOString()).toBe('2026-10-01T09:00:00.000Z');
    const edited = await lead(A('202'));
    expect(edited.contact_name).toBe('Lead editado 2');
    expect(edited.estimated_value_brl).toBe(99000);
    const deleted = await lead(A('204'));
    expect(deleted.deleted_by_name).toBe('Gestora');
    expect(deleted.deleted_at).not.toBeNull();
    const restored = await lead(A('203'));
    expect(restored.deleted_at).toBeNull();
    expect(restored.deleted_by_user_id).toBeNull();
    // An untouched lead is not rewritten.
    expect((await lead(A('201'))).updated_at).toBeNull();
  });

  it('writes ONE history event for the changed etapa, from the stale etapa to the new one', async () => {
    const events = await rows<{ from_stage_id: string | null; to_stage_id: string }>(
      `SELECT from_stage_id, to_stage_id FROM sales_ops_crm_lead_events WHERE lead_id = '${A('205')}' ORDER BY occurred_at, id`,
    );
    expect(events).toEqual([
      { from_stage_id: null, to_stage_id: A('102') },
      { from_stage_id: A('102'), to_stage_id: A('101') },
    ]);
    const untouched = await rows(`SELECT id FROM sales_ops_crm_lead_events WHERE lead_id = '${A('201')}'`);
    expect(untouched).toHaveLength(1);
  });

  it('upserts changed and added field values, and DOES NOT mirror a removal (a migration may not DELETE)', async () => {
    const value = async (leadId: string, key: string) =>
      rows<{ position: number; value_text: string | null; value_date: string | null; value_product_id: string | null }>(
        `SELECT v.position, v.value_text, v.value_date::text AS value_date, v.value_product_id
           FROM sales_ops_crm_lead_field_values v JOIN sales_ops_field_definitions f ON f.id = v.field_id
          WHERE v.lead_id = '${leadId}' AND f.key = '${key}' ORDER BY v.position`,
      );
    expect(await value(A('202'), 'descricao')).toMatchObject([{ position: 0, value_text: 'desc nova' }]);
    // The birth date was cleared in the old table: the stale value stays (documented rule).
    expect(await value(A('202'), 'nascimento')).toMatchObject([{ position: 0, value_date: '1990-05-04' }]);
    // New lead with a description: the definition exists (0030 part) and the value is inserted.
    expect(await value(A('206'), 'descricao')).toMatchObject([{ value_text: 'com descrição' }]);
    // Produtos: position 0 now holds the new free item; the old second row (position 1) is stale.
    expect(await value(A('205'), 'produtos')).toMatchObject([
      { position: 0, value_text: 'Item novo', value_product_id: null },
      { position: 1, value_text: 'Item livre sem catálogo' },
    ]);
  });

  it('renames an etapa, skips a take-over that would collide, and never aborts', async () => {
    const stages = await rows<{ id: string; name: string }>(
      `SELECT id, name FROM sales_ops_pipeline_stages WHERE id IN ('${A('101')}','${A('102')}','${A('105')}') ORDER BY id`,
    );
    expect(stages).toEqual([
      { id: A('101'), name: 'Novo X' },
      { id: A('102'), name: 'Em negociação' },
      { id: A('105'), name: 'Antiga 2' },
    ]);
  });

  it('is idempotent: a second run converges the skipped rename, a third changes nothing', async () => {
    await rerun0031();
    const [swapped] = await rows<{ name: string }>(`SELECT name FROM sales_ops_pipeline_stages WHERE id = '${A('102')}'`);
    expect(swapped!.name).toBe('Prospecção');
    const before = await fingerprint(CRM_TABLES);
    await rerun0031();
    expect(await fingerprint(CRM_TABLES)).toEqual(before);
  });

  it('never overwrites a row the NEW code wrote after the cutover', async () => {
    await scratch.adminScratch.unsafe(
      `UPDATE sales_ops_crm_leads SET contact_name = 'Editado pelo código novo', updated_at = now() + interval '1 day' WHERE id = '${A('202')}'`,
    );
    const before = await fingerprint(CRM_TABLES);
    await rerun0031();
    expect(await fingerprint(CRM_TABLES)).toEqual(before);
    const [row] = await rows<{ contact_name: string }>(`SELECT contact_name FROM sales_ops_crm_leads WHERE id = '${A('202')}'`);
    expect(row!.contact_name).toBe('Editado pelo código novo');
  });
});
```

#### `apps/api/src/db/__tests__/settlement-test-cleanup.ts` (edit, 39 changed lines)

```diff
diff --git a/apps/api/src/db/__tests__/settlement-test-cleanup.ts b/apps/api/src/db/__tests__/settlement-test-cleanup.ts
index ec9f2ad..c3ef7a0 100644
--- a/apps/api/src/db/__tests__/settlement-test-cleanup.ts
+++ b/apps/api/src/db/__tests__/settlement-test-cleanup.ts
@@ -35,6 +35,44 @@ export async function deleteSettlementsForOrgs(orgIds: readonly string[]): Promi
   }
 }
 
+/**
+ * Removes every unified CRM row of the given orgs (leads, their values, events, notes and
+ * follow-ups, then pipelines with their stages and transitions, field definitions and org modules)
+ * from the LOCAL test database.
+ *
+ * Their foreign keys are RESTRICT and point at clientes, pessoas, produtos and propostas, so a test
+ * that writes CRM rows (the lead services create them, and the first read of an org seeds a
+ * default pipeline) must call this BEFORE deleting any of those. Ordinary superuser transaction,
+ * children first, foreign keys still enforced. Test-only: product code has no delete path.
+ */
+export async function deleteCrmForOrgs(orgIds: readonly string[]): Promise<void> {
+  if (orgIds.length === 0) return;
+  const ids = orgIds as string[];
+  const client = postgres(testDatabaseUrls().migrateUrl, { max: 1 });
+  try {
+    await client.begin(async (tx) => {
+      const [me] = await tx<{ rolsuper: boolean }[]>`
+        SELECT rolsuper FROM pg_roles WHERE rolname = current_user
+      `;
+      if (!me?.rolsuper) {
+        throw new Error('deleteCrmForOrgs needs the local superuser (TEST_MIGRATE_DATABASE_URL)');
+      }
+      await tx`DELETE FROM sales_ops_crm_lead_notes WHERE org_id = ANY(${ids})`;
+      await tx`DELETE FROM sales_ops_crm_lead_followups WHERE org_id = ANY(${ids})`;
+      await tx`DELETE FROM sales_ops_crm_lead_field_values WHERE org_id = ANY(${ids})`;
+      await tx`DELETE FROM sales_ops_crm_lead_events WHERE org_id = ANY(${ids})`;
+      await tx`DELETE FROM sales_ops_crm_leads WHERE org_id = ANY(${ids})`;
+      await tx`DELETE FROM sales_ops_pipeline_transitions WHERE org_id = ANY(${ids})`;
+      await tx`DELETE FROM sales_ops_pipeline_stages WHERE org_id = ANY(${ids})`;
+      await tx`DELETE FROM sales_ops_pipelines WHERE org_id = ANY(${ids})`;
+      await tx`DELETE FROM sales_ops_field_definitions WHERE org_id = ANY(${ids})`;
+      await tx`DELETE FROM sales_ops_org_modules WHERE org_id = ANY(${ids})`;
+    });
+  } finally {
+    await client.end();
+  }
+}
+
 /**
  * Removes the whole sale ledger of the given orgs, plus their leads and their
  * integration transport rows, from the LOCAL test database.
@@ -55,6 +93,7 @@ export async function deleteSettlementsForOrgs(orgIds: readonly string[]): Promi
 export async function purgeOrgLedgerForTests(orgIds: readonly string[]): Promise<void> {
   if (orgIds.length === 0) return;
   await deleteSettlementsForOrgs(orgIds);
+  await deleteCrmForOrgs(orgIds);
   const ids = orgIds as string[];
   const client = postgres(testDatabaseUrls().migrateUrl, { max: 1 });
   try {
```
