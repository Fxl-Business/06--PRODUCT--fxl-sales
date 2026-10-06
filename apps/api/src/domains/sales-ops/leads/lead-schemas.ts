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

const LeadFieldsSchema = z.object({
  contactName: z.string().trim().min(1).max(140),
  clientId: uuid.nullish(),
  /**
   * The empresa as free text. Maps to the NOT NULL `client_name_snapshot`, and
   * is the fallback when `clientId` is absent. When `clientId` DOES resolve, the
   * snapshot is overwritten from the cadastro row and this value loses - the
   * same server-authoritative rule `resolvePartyContexts` applies to
   * `personNameSnapshot`.
   */
  clientName: z.string().trim().min(1).max(200),
  estimatedValueBrl: money.default(0),
  description: z.string().max(4000).nullish(),
  /**
   * NULLABLE: a lead may sit unassigned, and an unassigned lead is then visible
   * to admins only, which is the correct answer.
   */
  sellerPersonId: uuid.nullish(),
  products: z.array(LeadProductSchema).max(50).default([]),
});

/**
 * No `stageId` and no `saleId`, deliberately: a new lead always lands in the
 * first active `kind = 'normal'` stage by position. A card that is converted or
 * lost the instant it is born is therefore not expressible, rather than merely
 * rejected.
 */
export const CreateLeadSchema = LeadFieldsSchema.strict();
export const UpdateLeadSchema = LeadFieldsSchema.partial().strict();

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

export type CreateLeadInput = z.infer<typeof CreateLeadSchema>;
export type UpdateLeadInput = z.infer<typeof UpdateLeadSchema>;
export type MoveLeadInput = z.infer<typeof MoveLeadSchema>;
export type ListLeadsQuery = z.infer<typeof ListLeadsQuerySchema>;
export type LeadProductInput = z.infer<typeof LeadProductSchema>;

/**
 * The LEADS EDITION wire contract (edicao-leads, SEAM-CONTRACT section 2).
 *
 * A separate schema rather than a widened LeadFieldsSchema, on purpose: the full
 * schemas above stay byte-identical and `.strict()`, so an FXL client can never
 * send a contact key, and a leads-edition client can never send produtos. The
 * leads edition DOES carry an empresa (`clientId`/`clientName`) and a valor
 * estimado (`estimatedValueBrl`). The route picks one by `leadFieldSet(salesEdition)`.
 *
 * Every optional text normalizes the same way: trimmed, and an empty string is
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

export const ContactLeadFieldsSchema = z
  .object({
    contactName: z.string().trim().min(1).max(140),
    contactPhone: ContactPhoneSchema,
    contactEmail: ContactEmailSchema,
    contactBirthDate: ContactBirthDateSchema,
    // A2: null clears, '' is read as null, absent stays absent (PATCH semantics).
    description: z.string().trim().max(4000).nullish().transform(blankToNull),
    sellerPersonId: z.preprocess((value) => (value === '' ? null : value), uuid.nullish()),
    // The leads edition (Construbom) DOES carry an empresa and a valor estimado:
    // `clientId` optionally links a sales_ops_clients row (the vendedor may create
    // one by name), `clientName` is the free-text snapshot used when no link
    // resolves, and `estimatedValueBrl` is integer cents feeding the funil's
    // financial view. Produtos remain full-edition only.
    clientId: z.preprocess((value) => (value === '' ? null : value), uuid.nullish()),
    clientName: z.string().trim().max(200).nullish().transform(blankToNull),
    estimatedValueBrl: money.default(0),
  })
  .strict();

export const CreateContactLeadSchema = ContactLeadFieldsSchema;
export const UpdateContactLeadSchema = ContactLeadFieldsSchema.partial().strict();

export type CreateContactLeadInput = z.infer<typeof CreateContactLeadSchema>;
export type UpdateContactLeadInput = z.infer<typeof UpdateContactLeadSchema>;
