import { useTranslation } from 'react-i18next';
import { EmptyState } from '@/components/ui/empty-state';

export function CommissionsPlaceholderPage() {
  const { t } = useTranslation();
  return (
    <EmptyState
      title={t('finder.commissions.comingSoon')}
      description={t('finder.commissions.comingSoonDesc')}
    />
  );
}
