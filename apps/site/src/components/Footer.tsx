import Link from 'next/link';
import { getT } from '@/i18n';

export function Footer() {
  const t = getT();

  return (
    <footer className="border-t">
      <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 px-6 py-12 sm:flex-row">
        <p className="text-sm text-muted-foreground">{t.footer.copy}</p>
        <nav className="flex gap-6 text-sm text-muted-foreground">
          <Link href="/legal/privacy" className="hover:text-foreground">
            {t.footer.links.privacy}
          </Link>
          <Link href="/legal/terms" className="hover:text-foreground">
            {t.footer.links.terms}
          </Link>
        </nav>
      </div>
    </footer>
  );
}
