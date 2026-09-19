import { z } from 'zod';

/**
 * The lead entity's wire contract. Imports ONLY zod - no database, no service -
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
