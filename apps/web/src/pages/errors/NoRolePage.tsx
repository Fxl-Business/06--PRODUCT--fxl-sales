import { useCallback, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuthProfile, useLogout, useOrganizations } from '@/auth/react';
import { Button } from '@/components/ui/button';
import { AccountAvatar } from '@/sales-ops/AccountAvatar';

/**
 * Shown to a signed-in operator this app has nothing to offer (Phase 03 T13).
 *
 * Two live navigators send them here: `RoleGuard`, when a legacy `/admin/*`, `/finder/*`
 * or `/seller/*` URL asks for an `AppRole` the profile does not hold, and `SalesOpsApp`,
 * when `getVisibleWorkspaces(roles)` is empty. `NoRoleGuard` is the way back out and
 * redirects to `/` the moment either of those facts stops being true.
 *
 * The usual cause is being signed in with the WRONG account, so the page names the
 * active account and offers `Trocar conta` beside `Sair`. The switch goes through the
 * provider's `switchAccount` (handed out by `useOrganizations`), which owns the call into
 * the SDK; this page never builds the Hub URL itself. The account block is display only,
 * fronted by the shared `AccountAvatar` (the Hub avatar, or the initials), and simply
 * disappears when the token carries neither a name nor an email: there is no raw id to
 * fall back to on this screen.
 */
export function NoRolePage() {
  const { t } = useTranslation();
  const logout = useLogout();
  const { name, email, avatarUrl } = useAuthProfile();
  const { active, switchAccount } = useOrganizations();
  const primary = name ?? email;
  const secondary = name ? email : undefined;
  /*
    `switchAccount` is a full-document navigation to the Hub Account Chooser, so this
    document is about to be torn down; nothing ever resets the flag. The ref stops a
    second click that lands before React re-renders the button disabled, and the state
    renders it disabled, matching `MissingEntitlementPanel`. `Sair` stays enabled.
  */
  const leavingRef = useRef(false);
  const [leavingAccount, setLeavingAccount] = useState(false);
  const handleSwitchAccount = useCallback(() => {
    if (leavingRef.current) return;
    leavingRef.current = true;
    setLeavingAccount(true);
    switchAccount({ organization: active?.id });
  }, [active?.id, switchAccount]);

  return (
    <div className="flex h-screen flex-col items-center justify-center gap-4 px-6 text-center">
      <h1 className="text-2xl font-semibold">{t('errors.noRole.title')}</h1>
      <p className="max-w-md text-muted-foreground">{t('errors.noRole.body')}</p>
      {primary ? (
        <div
          className="flex w-full max-w-sm items-center gap-3 rounded-lg border bg-muted/40 px-4 py-3 text-left"
          data-testid="no-role-active-account"
        >
          <AccountAvatar avatarUrl={avatarUrl} name={primary} />
          <div className="min-w-0 flex-1 leading-tight">
            <p className="text-xs text-muted-foreground">{t('errors.noRole.signedInAs')}</p>
            <p className="mt-0.5 truncate text-sm font-medium">{primary}</p>
            {secondary ? (
              <p className="mt-0.5 truncate text-sm text-muted-foreground">{secondary}</p>
            ) : null}
          </div>
        </div>
      ) : null}
      <div className="flex flex-wrap items-center justify-center gap-2">
        <Button disabled={leavingAccount} onClick={handleSwitchAccount} type="button">
          {t('errors.noRole.switchAccount')}
        </Button>
        <Button onClick={() => void logout()} type="button" variant="outline">
          {t('errors.noRole.signOut')}
        </Button>
      </div>
    </div>
  );
}
