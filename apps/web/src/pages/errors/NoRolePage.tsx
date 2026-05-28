import { useClerk } from '@clerk/clerk-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';

/**
 * Shown to a signed-in user with no platform role (Phase 03 T13). RoleRouter and
 * RoleGuard redirect here when publicMetadata.role is absent or mismatched.
 */
export function NoRolePage() {
  const { t } = useTranslation();
  const { signOut } = useClerk();
  return (
    <div className="flex h-screen flex-col items-center justify-center gap-4 px-6 text-center">
      <h1 className="text-2xl font-semibold">{t('errors.noRole.title')}</h1>
      <p className="max-w-md text-muted-foreground">{t('errors.noRole.body')}</p>
      <Button variant="outline" onClick={() => void signOut()}>
        {t('errors.noRole.signOut')}
      </Button>
    </div>
  );
}
