import { useUser } from '@clerk/clerk-react';
import { Navigate } from 'react-router-dom';
import { Skeleton } from '@/components/ui/skeleton';

type Role = 'admin' | 'finder' | 'seller';

/**
 * Role gate (Phase 03 T09). Reads user.publicMetadata.role from the Clerk client
 * and renders children only when it matches `role`; otherwise redirects to
 * /no-role. UX-only — the backend requireAdmin / RLS are authoritative.
 *
 * NOTE: apps/web is Vite, NOT Next.js — there is NO 'use client' directive here.
 */
export function RoleGuard({ role, children }: { role: Role; children: React.ReactNode }) {
  const { user, isLoaded } = useUser();

  if (!isLoaded) return <Skeleton className="h-screen w-full" />;

  const userRole = user?.publicMetadata?.role as Role | undefined;
  if (userRole !== role) {
    return <Navigate to="/no-role" replace />;
  }

  return <>{children}</>;
}

/**
 * Root redirect (Phase 03 T09). Sends a signed-in user to their role's home.
 */
export function RoleRouter() {
  const { user, isLoaded } = useUser();
  if (!isLoaded) return <Skeleton className="h-screen w-full" />;
  const role = user?.publicMetadata?.role as string | undefined;
  if (role === 'admin') return <Navigate to="/admin/finders" replace />;
  if (role === 'finder') return <Navigate to="/finder/dashboard" replace />;
  if (role === 'seller') return <Navigate to="/seller/deals" replace />;
  return <Navigate to="/no-role" replace />;
}
