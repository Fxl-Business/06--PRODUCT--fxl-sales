'use client';

import { useActionState } from 'react';
import Link from 'next/link';
import { getT } from '@/i18n';
import { Button } from '@/components/Button';
import { signupAction, type SignupState } from './actions';

const INITIAL_STATE: SignupState = { status: 'idle' };
const PIX_KEY_TYPES = ['cpf', 'email', 'phone', 'random'] as const;

const inputClass =
  'mt-1 block w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary';

export function SignupForm() {
  const t = getT();
  const [state, formAction, isPending] = useActionState(signupAction, INITIAL_STATE);

  if (state.status === 'success') {
    return (
      <div className="mt-8 rounded-lg border border-border bg-card p-8 text-center">
        <h2 className="text-xl font-semibold">{t.signup.success.title}</h2>
        <p className="mt-2 text-muted-foreground">{t.signup.success.body}</p>
        <Button asChild variant="outline" className="mt-6">
          <Link href="/">{t.legal.back}</Link>
        </Button>
      </div>
    );
  }

  return (
    <form action={formAction} className="mt-8 space-y-6">
      {/* Honeypot — visually hidden from real users (D-R) */}
      <input
        type="text"
        name="website"
        tabIndex={-1}
        aria-hidden="true"
        autoComplete="off"
        className="absolute -left-[9999px] opacity-0"
      />
      {/* Required LGPD version stamp travels with the form */}
      <input type="hidden" name="lgpdConsentVersion" value={t.signup.lgpd.version} />

      <div>
        <label htmlFor="displayName" className="text-sm font-medium">
          {t.signup.fields.displayName}
        </label>
        <input
          id="displayName"
          name="displayName"
          type="text"
          required
          minLength={2}
          maxLength={100}
          placeholder={t.signup.placeholders.displayName}
          className={inputClass}
        />
      </div>

      <div>
        <label htmlFor="contactEmail" className="text-sm font-medium">
          {t.signup.fields.contactEmail}
        </label>
        <input
          id="contactEmail"
          name="contactEmail"
          type="email"
          required
          placeholder={t.signup.placeholders.contactEmail}
          className={inputClass}
        />
      </div>

      <div className="grid gap-6 sm:grid-cols-2">
        <div>
          <label htmlFor="cpf" className="text-sm font-medium">
            {t.signup.fields.cpf} <span className="text-muted-foreground">{t.signup.optional}</span>
          </label>
          <input
            id="cpf"
            name="cpf"
            type="text"
            inputMode="numeric"
            pattern="\d{11}"
            placeholder={t.signup.placeholders.cpf}
            className={inputClass}
          />
        </div>
        <div>
          <label htmlFor="phone" className="text-sm font-medium">
            {t.signup.fields.phone}{' '}
            <span className="text-muted-foreground">{t.signup.optional}</span>
          </label>
          <input
            id="phone"
            name="phone"
            type="tel"
            placeholder={t.signup.placeholders.phone}
            className={inputClass}
          />
        </div>
      </div>

      <div className="grid gap-6 sm:grid-cols-2">
        <div>
          <label htmlFor="pixKey" className="text-sm font-medium">
            {t.signup.fields.pixKey}{' '}
            <span className="text-muted-foreground">{t.signup.optional}</span>
          </label>
          <input
            id="pixKey"
            name="pixKey"
            type="text"
            placeholder={t.signup.placeholders.pixKey}
            className={inputClass}
          />
        </div>
        <div>
          <label htmlFor="pixKeyType" className="text-sm font-medium">
            {t.signup.fields.pixKeyType}{' '}
            <span className="text-muted-foreground">{t.signup.optional}</span>
          </label>
          <select id="pixKeyType" name="pixKeyType" defaultValue="" className={inputClass}>
            <option value="" disabled>
              {t.signup.placeholders.pixKeyTypeSelect}
            </option>
            {PIX_KEY_TYPES.map((type) => (
              <option key={type} value={type}>
                {t.signup.pixKeyTypes[type]}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* LGPD consent — granular */}
      <fieldset className="space-y-3 rounded-lg border border-border p-4">
        <label className="flex items-start gap-3 text-sm">
          <input
            type="checkbox"
            name="lgpdConsentEssential"
            value="true"
            required
            className="mt-1"
          />
          <span>{t.signup.lgpd.essential}</span>
        </label>
        <label className="flex items-start gap-3 text-sm">
          <input type="checkbox" name="lgpdConsentMarketing" value="true" className="mt-1" />
          <span>{t.signup.lgpd.marketing}</span>
        </label>
        <p className="text-xs text-muted-foreground">
          <Link href="/legal/privacy" className="underline">
            {t.signup.lgpd.readMore}
          </Link>
        </p>
      </fieldset>

      {state.status === 'error' && (
        <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {state.message}
        </p>
      )}

      <Button type="submit" size="lg" disabled={isPending}>
        {isPending ? t.signup.submitting : t.signup.submit}
      </Button>
    </form>
  );
}
