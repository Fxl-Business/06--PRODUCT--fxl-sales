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
