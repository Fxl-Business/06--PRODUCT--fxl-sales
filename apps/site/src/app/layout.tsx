import type { Metadata } from 'next';
import { Analytics } from '@vercel/analytics/next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Fxl Sales',
  description: 'Bootstrapped from fxl-template.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const analyticsEnabled = process.env.NEXT_PUBLIC_VERCEL_ANALYTICS === '1';

  return (
    <html lang="pt-BR">
      <body>
        {children}
        {analyticsEnabled ? <Analytics /> : null}
      </body>
    </html>
  );
}
