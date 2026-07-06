export type AppRole = 'admin' | 'finder' | 'seller';

type HubClaims = {
  isSuperAdmin?: boolean;
  roles?: {
    workspace?: string;
  };
};

export function getRoleFromHubClaims(claims: HubClaims): AppRole {
  const workspaceRole = claims.roles?.workspace;
  if (claims.isSuperAdmin || workspaceRole === 'owner' || workspaceRole === 'admin') {
    return 'admin';
  }
  return 'finder';
}

export function parseJwtPayload(token: string): Record<string, unknown> | null {
  const [, payload] = token.split('.');
  if (!payload) {
    return null;
  }

  try {
    const base64 = payload.replace(/-/g, '+').replace(/_/g, '/');
    const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, '=');
    return JSON.parse(atob(padded)) as Record<string, unknown>;
  } catch {
    return null;
  }
}
