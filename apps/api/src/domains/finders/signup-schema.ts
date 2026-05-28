import { z } from 'zod';

/**
 * Public finder signup validator (Phase 03 T02).
 *
 * D-R (honeypot): `website` is `z.string().optional()` — the validator MUST
 * accept any string. The honeypot DECISION is made in the route handler
 * (non-empty → silent 201, no insert). Never `z.string().max(0)` (that returns
 * 400 and tells a bot it tripped the trap).
 */

export const PIX_KEY_TYPES = ['cpf', 'email', 'phone', 'random'] as const;

export const finderSignupSchema = z.object({
  displayName: z.string().min(2).max(100),
  contactEmail: z.string().email(),
  cpf: z.string().regex(/^\d{11}$/, 'CPF deve ter 11 dígitos').optional(),
  phone: z.string().min(10).max(20).optional(),
  pixKey: z.string().min(1).max(100).optional(),
  pixKeyType: z.enum(PIX_KEY_TYPES).optional(),
  payoutAddress: z
    .object({
      street: z.string().optional(),
      city: z.string().optional(),
      state: z.string().length(2).optional(),
      zip: z.string().regex(/^\d{8}$/).optional(),
    })
    .optional(),
  lgpdConsentEssential: z.literal(true, {
    errorMap: () => ({ message: 'Consentimento essencial é obrigatório' }),
  }),
  lgpdConsentMarketing: z.boolean(),
  lgpdConsentVersion: z.string().min(1),
  // Honeypot (D-R) — validator MUST accept any string; the decision is in the handler.
  // Never z.string().max(0) — that returns 400 and tells a bot it tripped the trap.
  website: z.string().optional(),
});

export type FinderSignupInput = z.infer<typeof finderSignupSchema>;
