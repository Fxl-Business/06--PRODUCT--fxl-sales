import { useTranslation } from 'react-i18next';
import { EmptyState } from '@/components/ui/empty-state';

export function LinksPlaceholderPage() {
  const { t } = useTranslation();
  return (
    <EmptyState
      title={t('finder.links.comingSoon')}
      description={t('finder.links.comingSoonDesc')}
    />
  );
}
