import { z } from 'zod';

/**
 * Client signup validator (Phase 03 T06, D-R WARN).
 *
 * The API schema (T02) uses `z.literal(true)` for lgpdConsentEssential, which
 * breaks HTML/FormData round-tripping (an unchecked checkbox is not the literal
 * `true`). This client schema has the same shape but uses `z.boolean()` plus a
 * `.refine()` asserting `lgpdConsentEssential === true`. The API still enforces
 * the strict `z.literal(true)` server-side.
 */

export const PIX_KEY_TYPES = ['cpf', 'email', 'phone', 'random'] as const;

export const finderSignupClientSchema = z
  .object({
    displayName: z.string().min(2).max(100),
    contactEmail: z.string().email(),
    cpf: z.string().regex(/^\d{11}$/).optional(),
    phone: z.string().min(10).max(20).optional(),
    pixKey: z.string().min(1).max(100).optional(),
    pixKeyType: z.enum(PIX_KEY_TYPES).optional(),
    lgpdConsentEssential: z.boolean(), // looser than the API's z.literal(true)
    lgpdConsentMarketing: z.boolean(),
    lgpdConsentVersion: z.string().min(1),
    website: z.string().optional(), // honeypot — accept anything (D-R)
  })
  .refine((d) => d.lgpdConsentEssential === true, {
    path: ['lgpdConsentEssential'],
    message: 'Você precisa aceitar os termos essenciais para continuar',
  });

export type FinderSignupClientInput = z.infer<typeof finderSignupClientSchema>;
