import { useTranslation } from 'react-i18next';
import { EmptyState } from '@/components/ui/empty-state';

export function SellerDealsPlaceholderPage() {
  const { t } = useTranslation();
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">{t('seller.deals.title')}</h1>
      <EmptyState
        title={t('seller.deals.comingSoon')}
        description={t('seller.deals.comingSoonDesc')}
      />
    </div>
  );
}
