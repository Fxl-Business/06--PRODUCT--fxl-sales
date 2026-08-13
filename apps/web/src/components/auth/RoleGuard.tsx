import { Navigate } from 'react-router-dom';
import { Skeleton } from '@/components/ui/skeleton';
import { useAuthProfile } from '@/auth/react';
import { getVisibleWorkspaces } from '@/sales-ops/navigation';

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
 * The way OUT of `/no-role`, and the exact complement of the redirect INTO it.
 *
 * `RoleGuard` above sends anyone lacking a legacy tree's role here, and `SalesOpsApp`
 * sends anyone with no visible workspace here, but until now nothing re-checked on
 * arrival: `NoRolePage` rendered `Acesso não autorizado` unconditionally. An operator
 * who reached this screen and then signed in successfully, or a seller who merely
 * opened an `/admin/*` URL, stayed on the unauthorized screen holding real roles with
 * no way out but retyping a URL by hand.
 *
 * The condition is `getVisibleWorkspaces(...).length > 0`, which is the LITERAL
 * negation of the `visibleWorkspaceIds.length === 0` test that `SalesOpsApp` redirects
 * here on, evaluated by the same function over the same `useAuthProfile()` value in the
 * same render pass. That is what makes a ping-pong between the two impossible by
 * construction rather than by argument: at most one of the two guards can ever want to
 * navigate, for any value of `roles` at all.
 *
 * Do NOT weaken it to `roles.length > 0`. The two predicates happen to agree for every
 * non-empty subset of today's `AppRole` union, and they would silently stop agreeing the
 * day a role is added that maps to no workspace. The failure mode is an infinite
 * `/` to `/no-role` redirect loop, two files away from the change that caused it.
 *
 * `!isLoaded` renders the same `Skeleton` as `RoleGuard`, so a profile that is still
 * resolving shows neither the unauthorized screen nor a navigation. While a session is
 * LOST the profile is loaded with `roles: []`, so this guard is inert and the children
 * `HubProtected` keeps mounted under its overlay stay exactly where they are.
 */
export function NoRoleGuard({ children }: { children: React.ReactNode }) {
  const { isLoaded, roles } = useAuthProfile();

  if (!isLoaded) return <Skeleton className="h-screen w-full" />;

  // `/` is `SalesOpsApp`, which resolves this operator's default workspace from these
  // same roles, so the landing decision stays in one place. `replace` so Back cannot
  // walk into the dead end again.
  if (getVisibleWorkspaces(roles).length > 0) {
    return <Navigate to="/" replace />;
  }

  return <>{children}</>;
}
