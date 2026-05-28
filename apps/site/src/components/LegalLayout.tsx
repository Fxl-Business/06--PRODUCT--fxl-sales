import Link from 'next/link';
import { getT } from '@/i18n';

/**
 * Shared prose wrapper for the LGPD legal pages (Phase 03 T07). Server component.
 */
export function LegalLayout({
  title,
  lastUpdated,
  children,
}: {
  title: string;
  lastUpdated: string;
  children: React.ReactNode;
}) {
  const t = getT();
  return (
    <div className="mx-auto max-w-3xl px-6 py-16">
      <Link href="/" className="text-sm text-muted-foreground hover:underline">
        {t.legal.back}
      </Link>
      <h1 className="mt-6 text-3xl font-semibold">{title}</h1>
      <p className="mt-2 text-sm text-muted-foreground">{lastUpdated}</p>
      <div className="prose prose-neutral mt-8 max-w-none space-y-6 dark:prose-invert">
        {children}
      </div>
    </div>
  );
}
