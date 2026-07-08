import { Navigate } from 'react-router-dom';
import { Skeleton } from '@/components/ui/skeleton';
import { useAuthProfile } from '@/auth/react';

type Role = 'admin' | 'finder' | 'seller';

/**
 * Role gate (Phase 03 T09). Reads the role from the active auth provider and
 * renders children only when it matches `role`; otherwise redirects to
 * /no-role. UX-only - the backend requireAdmin / RLS are authoritative.
 */
export function RoleGuard({ role, children }: { role: Role; children: React.ReactNode }) {
  const { isLoaded, roles } = useAuthProfile();

  if (!isLoaded) return <Skeleton className="h-screen w-full" />;

  if (!roles.includes(role)) {
    return <Navigate to="/no-role" replace />;
  }

  return <>{children}</>;
}

/**
 * Root redirect (Phase 03 T09). Sends a signed-in user to their role's home.
 */
export function RoleRouter() {
  const { isLoaded, roles } = useAuthProfile();
  if (!isLoaded) return <Skeleton className="h-screen w-full" />;
  if (roles.includes('admin')) return <Navigate to="/admin/finders" replace />;
  if (roles.includes('seller')) return <Navigate to="/seller/deals" replace />;
  if (roles.includes('finder')) return <Navigate to="/finder/dashboard" replace />;
  return <Navigate to="/no-role" replace />;
}
