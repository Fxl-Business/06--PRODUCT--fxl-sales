import { Navigate } from 'react-router-dom';
import { Skeleton } from '@/components/ui/skeleton';
import { useAuthProfile } from '@/auth/react';

/**
 * Admin route guard (Phase 02, T01) — UX-only redirect.
 *
 * Reads the role from the active auth provider. This is a convenience gate for the SPA;
 * the AUTHORITATIVE check is the backend
 * `requireAdmin` middleware (D-B). A non-admin who bypasses this still gets 403
 * from every /api/v1/admin/* call.
 */
export function AdminGuard({ children }: { children: React.ReactNode }) {
  const { isLoaded, roles } = useAuthProfile();

  if (!isLoaded) {
    return <Skeleton className="h-screen w-full" />;
  }

  if (!roles.includes('admin')) {
    return <Navigate to="/" replace />;
  }

  return <>{children}</>;
}
