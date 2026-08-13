import { useTranslation } from 'react-i18next';
import { useLogout } from '@/auth/react';
import { Button } from '@/components/ui/button';

/**
 * Shown to a signed-in operator this app has nothing to offer (Phase 03 T13).
 *
 * Two live navigators send them here: `RoleGuard`, when a legacy `/admin/*`, `/finder/*`
 * or `/seller/*` URL asks for an `AppRole` the profile does not hold, and `SalesOpsApp`,
 * when `getVisibleWorkspaces(roles)` is empty. `NoRoleGuard` is the way back out and
 * redirects to `/` the moment either of those facts stops being true.
 */
export function NoRolePage() {
  const { t } = useTranslation();
  const logout = useLogout();
  return (
    <div className="flex h-screen flex-col items-center justify-center gap-4 px-6 text-center">
      <h1 className="text-2xl font-semibold">{t('errors.noRole.title')}</h1>
      <p className="max-w-md text-muted-foreground">{t('errors.noRole.body')}</p>
      <Button variant="outline" onClick={() => void logout()}>
        {t('errors.noRole.signOut')}
      </Button>
    </div>
  );
}
