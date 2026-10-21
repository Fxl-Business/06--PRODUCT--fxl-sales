import { z } from 'zod';
import { isAfterTodayInSaoPaulo, isIsoDay } from '@fxl-sales/shared-utils/sao-paulo-day';

/**
 * The lead entity's wire contract. Imports only zod and the pure sao-paulo-day subpath - no database, no service -
 * which is what keeps `lead-contract.test.ts` a pure unit test.
 *
 * WHY `.strict()`, a deliberate deviation from the rest of this domain.
 *
 * Everything else here lets zod strip unknown keys, and CLAUDE.md records what
 * that costs: `PATCH /clients/:id {"status":"archived"}` answers 200 with an
 * unchanged row, "a silent no-op that reads as success". The identical trap on a
 * board is a `PATCH /leads/:id` carrying `stageId`, `position`, `saleId` or
 * `lostReason`: it would answer 200, the card would snap back on the next read,
 * and nothing would say why. `.strict()` makes each of those a loud 400 naming
 * the offending key.
 *
 * It is also the STRUCTURAL guarantee that `stage_id` has exactly one writer.
 * There is no code path from `PATCH /leads/:id` to the stage column, so "
 * stage_changed_at only moves when the stage moves" is not a runtime branch
 * anyone can later forget.
 */

const uuid = z.string().uuid();
/** Integer CENTS, like every other money value in this product. */
const money = z.number().int().nonnegative();

/**
 * The same two numbers as HISTORY_DEFAULT_LIMIT / HISTORY_MAX_LIMIT, for the
 * same reason: one screenful with room to spare, and a ceiling that bounds the
 * worst-case payload.
 */
/** Text caps of the lead write contract; the import workbook columns are tested against them. */
export const LEAD_CONTACT_NAME_MAX = 140;
export const LEAD_CLIENT_NAME_MAX = 200;
export const LEAD_DESCRIPTION_MAX = 4000;

export const LEADS_DEFAULT_LIMIT = 50;
export const LEADS_MAX_LIMIT = 200;

export const LeadProductSchema = z
  .object({
    productId: uuid.optional(),
    /** The description for a productId-less row. DISCARDED when productId resolves. */
    productName: z.string().trim().min(1).max(140).optional(),
  })
  .strict()
  .superRefine((row, ctx) => {
    if (row.productId || row.productName) return;
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['productName'],
      message: 'productName is required when productId is absent',
    });
  });

/**
 * Optional text normalization shared by every nullable lead key: trimmed, and an empty string is
 * stored as NULL ("cleared"), while an ABSENT key stays absent (PATCH semantics).
 */
function blankToNull(value: string | null | undefined): string | null | undefined {
  if (value === undefined || value === null) return value;
  return value === '' ? null : value;
}

const ContactPhoneSchema = z.string().trim().max(40).nullish().transform(blankToNull);

const ContactEmailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .max(254)
  .refine((value) => value === '' || z.string().email().safeParse(value).success, {
    message: 'contactEmail must be a valid e-mail address',
  })
  .nullish()
  .transform(blankToNull);

/**
 * A civil day, never after today in Sao Paulo. Compared as a string, never through Date.
 * Zod runs every refine even after an earlier one failed, so the future check
 * re-guards with `isIsoDay` (an impossible day is already reported above) instead
 * of letting `isAfterTodayInSaoPaulo` throw its RangeError.
 */
const ContactBirthDateSchema = z
  .string()
  .trim()
  .refine((value) => value === '' || isIsoDay(value), {
    message: 'contactBirthDate must be a real calendar day (YYYY-MM-DD)',
  })
  .refine((value) => value === '' || !isIsoDay(value) || !isAfterTodayInSaoPaulo(value), {
    message: 'contactBirthDate cannot be in the future',
  })
  .nullish()
  .transform(blankToNull);


/** One entry of `fields`: a dynamic field value, addressed by its definition id or its key. */
const FieldItemSchema = z
  .object({
    id: uuid.nullish(),
    name: z.string().trim().max(200).optional(),
  })
  .strict();

export const LeadFieldWriteSchema = z
  .object({
    fieldId: uuid.optional(),
    key: z.string().trim().min(1).max(60).optional(),
    /** text, number, money (integer cents), date (civil day), option key, or reference items; null clears. */
    value: z.union([z.string().max(4000), z.number(), z.null(), z.array(FieldItemSchema).max(50)]),
  })
  .strict()
  .refine((entry) => entry.fieldId !== undefined || entry.key !== undefined, {
    message: 'fieldId or key is required',
    path: ['key'],
  });

/**
 * THE lead write contract (phase 2 cutover): one schema for both editions. `contactName` is the
 * only required key; everything else is optional. The old keys `description`, `contactBirthDate`
 * and `products` are still accepted and stored as the `descricao`, `nascimento` and `produtos`
 * field values, so the web of today keeps working. `.strict()` stays: an unknown key is a loud 400.
 *
 * `LeadWriteBaseSchema` is the shape; `LeadWriteSchema` (create) adds the contact rule - at least
 * one of `contactPhone` or `contactEmail` - and `LeadPatchSchema` (PATCH) is the same shape with
 * every key optional and no `pipelineId` / `stageId` (a lead changes stage only through the move
 * and advance routes, so `stage_changed_at` has exactly one writer).
 * The spreadsheet import writes through the BASE schema: a workbook row has no contact column.
 */
const leadWriteShape = {
  contactName: z.string().trim().min(1).max(LEAD_CONTACT_NAME_MAX),
  contactPhone: ContactPhoneSchema,
  contactEmail: ContactEmailSchema,
  /** Create only. Absent means the org's default pipeline. */
  pipelineId: uuid.optional(),
  /** Create only. Absent means the first active normal stage of the pipeline. */
  stageId: uuid.optional(),
  /**
   * NULLABLE: a lead may sit unassigned. An unassigned lead is visible to admins and to every
   * active vendedor, and the first vendedor to write it claims it (see `claimantFor`).
   */
  sellerPersonId: z.preprocess((value) => (value === '' ? null : value), uuid.nullish()),
  /** The empresa. `clientId` resolves the snapshot; otherwise `clientName` is the free text. */
  clientId: z.preprocess((value) => (value === '' ? null : value), uuid.nullish()),
  clientName: z.string().trim().max(LEAD_CLIENT_NAME_MAX).nullish().transform(blankToNull),
  /** Integer CENTS. */
  estimatedValueBrl: money.default(0),
  fields: z.array(LeadFieldWriteSchema).max(50).optional(),
  // Legacy keys, mapped onto the descricao / nascimento / produtos field values.
  description: z.string().trim().max(LEAD_DESCRIPTION_MAX).nullish().transform(blankToNull),
  contactBirthDate: ContactBirthDateSchema,
  products: z.array(LeadProductSchema).max(50).optional(),
};

export const LeadWriteBaseSchema = z.object(leadWriteShape).strict();

export const LeadWriteSchema = LeadWriteBaseSchema.superRefine((lead, ctx) => {
  if (lead.contactPhone || lead.contactEmail) return;
  ctx.addIssue({
    code: z.ZodIssueCode.custom,
    path: ['contactPhone'],
    message: 'contactPhone or contactEmail is required',
  });
});

export const LeadPatchSchema = z
  .object(leadWriteShape)
  .omit({ pipelineId: true, stageId: true })
  .partial()
  .strict();

/**
 * The move wire body, and the field NAMES are the contract: slice 04's client
 * translates its own `toStageId` / `toIndex` into these exactly once. Renaming
 * one here silently breaks the board.
 */
export const MoveLeadSchema = z
  .object({
    stageId: uuid,
    /** 0-based target INDEX in the destination column, clamped to its length. */
    position: z.number().int().min(0).max(100_000),
    reason: z.string().trim().min(1).max(500).optional(),
    saleId: uuid.optional(),
  })
  .strict();

/**
 * The keyset cursor is the literal `(position, id)` pair the list orders by.
 * Validated by regex at the boundary so a malformed one is a 400 and never a
 * silently dropped filter.
 */
const CURSOR_RE =
  /^\d{1,9}:[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

/**
 * `stageId` is REQUIRED. A kanban board loads one request per column, which is
 * how a column actually scrolls: each paginates independently, "carregar mais"
 * is per-column, and the cursor stays the simple pair above instead of a
 * three-part composite. It also caps the worst case at one column rather than
 * the whole board.
 */
export const ListLeadsQuerySchema = z.object({
  stageId: uuid,
  limit: z.coerce.number().int().min(1).max(LEADS_MAX_LIMIT).optional(),
  cursor: z.string().regex(CURSOR_RE).optional(),
  sellerPersonId: uuid.optional(),
});

/**
 * GET /leads/summary. The list's own `sellerPersonId` parsing, PICKED and not
 * re-spelled, so the two board reads can never disagree about what a valid
 * narrowing is. There is no stageId: the summary covers every column in one
 * GROUP BY.
 */
export const LeadStageSummaryQuerySchema = ListLeadsQuerySchema.pick({ sellerPersonId: true });

export type LeadWriteInput = z.infer<typeof LeadWriteBaseSchema>;
export type LeadPatchInput = z.infer<typeof LeadPatchSchema>;
export type MoveLeadInput = z.infer<typeof MoveLeadSchema>;
export type ListLeadsQuery = z.infer<typeof ListLeadsQuerySchema>;
export type LeadStageSummaryQuery = z.infer<typeof LeadStageSummaryQuerySchema>;

/**
 * The deleted-list keyset cursor: `<deleted_at as UTC ISO with MICROseconds>_<id>`.
 *
 * Microseconds and not the milliseconds a JS Date carries, because timestamptz
 * stores microseconds: a millisecond cursor would sit between two rows deleted
 * in the same millisecond and silently skip the later one. The server renders
 * it with to_char and parses it back with ::timestamptz, so it round-trips
 * exactly. The day goes through isIsoDay so an impossible date (2026-02-30) is
 * a 400 here and never a Postgres cast error (a 500).
 */
const DELETED_CURSOR_RE =
  /^\d{4}-\d{2}-\d{2}T([01]\d|2[0-3]):[0-5]\d:[0-5]\d\.\d{6}Z_[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

export const ListDeletedLeadsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(LEADS_MAX_LIMIT).optional(),
  cursor: z
    .string()
    .regex(DELETED_CURSOR_RE)
    .refine((value) => isIsoDay(value.slice(0, 10)), {
      message: 'cursor day must be a real calendar day',
    })
    .optional(),
});

export type ListDeletedLeadsQuery = z.infer<typeof ListDeletedLeadsQuerySchema>;
export type LeadProductInput = z.infer<typeof LeadProductSchema>;

