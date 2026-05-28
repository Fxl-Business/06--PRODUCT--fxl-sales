'use server';

import { finderSignupClientSchema } from './signup-schema-client';

const API_URL = process.env.API_URL ?? 'http://localhost:3006';
const LGPD_VERSION = 'v1.0';

export type SignupState =
  | { status: 'idle' }
  | { status: 'success'; id: string }
  | { status: 'error'; message: string };

/**
 * Server Action for the public signup form (Phase 03 T06). Re-validates with the
 * client schema, then POSTs to the API's public signup route. The API URL never
 * reaches the browser (server-only env). No rate-limiting in v1.0 (D-R defer).
 */
export async function signupAction(_prev: SignupState, formData: FormData): Promise<SignupState> {
  const raw = {
    displayName: formData.get('displayName'),
    contactEmail: formData.get('contactEmail'),
    cpf: formData.get('cpf') || undefined,
    phone: formData.get('phone') || undefined,
    pixKey: formData.get('pixKey') || undefined,
    pixKeyType: formData.get('pixKeyType') || undefined,
    lgpdConsentEssential: formData.get('lgpdConsentEssential') === 'true',
    lgpdConsentMarketing: formData.get('lgpdConsentMarketing') === 'true',
    lgpdConsentVersion: LGPD_VERSION,
    website: formData.get('website') ?? '', // honeypot
  };

  const parsed = finderSignupClientSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      status: 'error',
      message: parsed.error.issues[0]?.message ?? 'Dados inválidos',
    };
  }

  try {
    const res = await fetch(`${API_URL}/api/v1/finders/signup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(parsed.data),
    });
    if (!res.ok) {
      const err = (await res.json().catch(() => ({}))) as { message?: string };
      return { status: 'error', message: err.message ?? 'Erro no servidor' };
    }
    const data = (await res.json()) as { id: string };
    return { status: 'success', id: data.id };
  } catch {
    return {
      status: 'error',
      message: 'Não foi possível conectar ao servidor. Tente novamente.',
    };
  }
}
