import { useTranslation } from 'react-i18next';
import { EmptyState } from '@/components/ui/empty-state';

export function PayoutsPlaceholderPage() {
  const { t } = useTranslation();
  return (
    <EmptyState
      title={t('finder.payouts.comingSoon')}
      description={t('finder.payouts.comingSoonDesc')}
    />
  );
}
