import { UserControls, useAuthProfile } from '@/auth/react';

export function TopBar() {
  const { isSignedIn } = useAuthProfile();

  return (
    <header className="flex h-14 items-center justify-end gap-4 border-b bg-background px-6">
      {isSignedIn ? (
        <>
          <UserControls />
        </>
      ) : null}
    </header>
  );
}
