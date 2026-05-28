import { Suspense } from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import { ShoppingBag } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';

const sellerItems = [{ to: '/seller/deals', icon: ShoppingBag, key: 'nav.deals' }] as const;

/**
 * Seller portal layout (Phase 03 T12). Minimal shell — one section. Real content
 * (commission views for the seller's deals) lands in Phase 05+.
 */
export function SellerShell() {
  const { t } = useTranslation();
  return (
    <div className="flex h-screen bg-background">
      <aside className="w-60 shrink-0 border-r bg-card">
        <div className="p-6">
          <h1 className="text-lg font-semibold">{t('seller.deals.title')}</h1>
        </div>
        <nav className="px-3">
          <ul className="space-y-1">
            {sellerItems.map((item) => {
              const Icon = item.icon;
              return (
                <li key={item.to}>
                  <NavLink
                    to={item.to}
                    className={({ isActive }) =>
                      cn(
                        'flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors',
                        isActive
                          ? 'bg-secondary text-secondary-foreground'
                          : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground',
                      )
                    }
                  >
                    <Icon className="h-4 w-4" />
                    {t(item.key)}
                  </NavLink>
                </li>
              );
            })}
          </ul>
        </nav>
      </aside>
      <div className="flex flex-1 flex-col overflow-hidden">
        <main className="flex-1 overflow-y-auto p-8">
          <Suspense fallback={<Skeleton className="h-64 w-full" />}>
            <Outlet />
          </Suspense>
        </main>
      </div>
    </div>
  );
}
