import type { Metadata } from 'next';
import { getT } from '@/i18n';
import { SignupForm } from './SignupForm';

export function generateMetadata(): Metadata {
  const t = getT();
  return {
    title: `${t.signup.title} — ${t.app.name}`,
    description: t.signup.subtitle,
  };
}

export default function SignupPage() {
  const t = getT();
  return (
    <main className="mx-auto max-w-xl px-6 py-16">
      <h1 className="text-3xl font-semibold tracking-tight">{t.signup.title}</h1>
      <p className="mt-3 text-muted-foreground">{t.signup.subtitle}</p>
      <SignupForm />
    </main>
  );
}
