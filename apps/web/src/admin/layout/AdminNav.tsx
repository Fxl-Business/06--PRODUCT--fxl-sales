import { NavLink } from 'react-router-dom';
import { AppWindow, Boxes, Briefcase, ClipboardList, ScrollText, Wallet } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';

const items = [
  { to: '/admin/apps', icon: AppWindow, key: 'admin.nav.apps' },
  { to: '/admin/products', icon: Boxes, key: 'admin.nav.products' },
  { to: '/admin/finders', icon: ClipboardList, key: 'admin.nav.finders' },
  { to: '/admin/sellers', icon: Briefcase, key: 'admin.nav.sellers' },
  { to: '/admin/payouts', icon: Wallet, key: 'admin.nav.payouts' },
  { to: '/admin/audit', icon: ScrollText, key: 'admin.nav.audit' },
] as const;

export function AdminNav() {
  const { t } = useTranslation();

  return (
    <aside className="w-60 shrink-0 border-r bg-card">
      <div className="p-6">
        <h1 className="text-lg font-semibold">{t('admin.title')}</h1>
      </div>
      <nav className="px-3">
        <ul className="space-y-1">
          {items.map((item) => {
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
  );
}
