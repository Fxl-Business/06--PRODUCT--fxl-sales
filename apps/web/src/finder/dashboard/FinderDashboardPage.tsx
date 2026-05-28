import { BarChart2, Link2, Wallet } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { KPICard } from '@/components/ui/kpi-card';

/**
 * Finder dashboard placeholder (Phase 03 T11). Real metrics land in Phase 04/05.
 * KPICards render with value '—' and isLoading=false (placeholder, not loading).
 */
export function FinderDashboardPage() {
  const { t } = useTranslation();
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">{t('finder.dashboard.title')}</h1>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <KPICard title={t('finder.dashboard.kpi.activeLinks')} value="—" icon={Link2} />
        <KPICard
          title={t('finder.dashboard.kpi.pendingCommissions')}
          value="—"
          icon={BarChart2}
        />
        <KPICard title={t('finder.dashboard.kpi.nextPayout')} value="—" icon={Wallet} />
      </div>
      <p className="text-sm text-muted-foreground">{t('finder.dashboard.banner')}</p>
    </div>
  );
}
