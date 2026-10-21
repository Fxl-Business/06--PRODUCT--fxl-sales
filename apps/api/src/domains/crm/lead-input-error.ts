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
