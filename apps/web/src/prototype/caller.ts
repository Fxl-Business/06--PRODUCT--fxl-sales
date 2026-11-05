import type { Caller } from './http';

function base64UrlDecode(value: string): string {
  const restored = value.replace(/-/g, '+').replace(/_/g, '/');
  const padded = restored.padEnd(Math.ceil(restored.length / 4) * 4, '=');
  const binary = atob(padded);
  return new TextDecoder().decode(Uint8Array.from(binary, (char) => char.charCodeAt(0)));
}

/**
 * Reads the claims the dev identity put in the bearer token, verifying NOTHING (the token
 * is a placeholder-signed one the existing dev identity mints). Null for a missing or
 * malformed header: the fake network answers that `401 unauthorized`, like the real API.
 */
export function callerFromAuthorization(header: string | null): Caller | null {
  if (!header) return null;
  const match = /^Bearer\s+(\S+)$/i.exec(header.trim());
  if (!match) return null;
  const parts = match[1]!.split('.');
  if (parts.length !== 3 || !parts[1]) return null;
  try {
    const payload: unknown = JSON.parse(base64UrlDecode(parts[1]));
    if (typeof payload !== 'object' || payload === null) return null;
    const claims = payload as Record<string, unknown>;
    if (typeof claims.sub !== 'string') return null;
    const organizationId = typeof claims.workspaceId === 'string' ? claims.workspaceId : null;
    const name = typeof claims.name === 'string' ? claims.name : claims.sub;
    return {
      accountId: claims.sub,
      organizationId,
      label: `${name} (${claims.sub}, organization ${organizationId ?? 'none'})`,
    };
  } catch {
    return null;
  }
}
