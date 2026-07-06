/**
 * User/org label helpers. NEVER render raw provider IDs in UI.
 *
 * Fallback order:
 *   user: name -> email -> raw ID (styled as font-mono text-xs text-muted-foreground)
 *   org:  name -> raw ID (same style)
 */

type UserLike = { id: string; name?: string | null; email?: string | null };
type OrgLike = { id: string; name?: string | null };

export function userLabel(u: UserLike | null | undefined): string {
  if (!u) return '-';
  return u.name ?? u.email ?? u.id;
}

export function orgLabel(o: OrgLike | null | undefined): string {
  if (!o) return '-';
  return o.name ?? o.id;
}

export function isUserLabelFallback(u: UserLike | null | undefined): boolean {
  if (!u) return false;
  return !u.name && !u.email;
}

export function isOrgLabelFallback(o: OrgLike | null | undefined): boolean {
  if (!o) return false;
  return !o.name;
}
