export type AppRole = 'admin' | 'finder' | 'seller';

type HubClaims = {
  isSuperAdmin?: boolean;
  roles?: {
    productRoles?: unknown;
    workspace?: string;
  };
};

const fullAccessRoles: AppRole[] = ['admin', 'seller', 'finder'];
const productRoleOrder: AppRole[] = ['seller', 'finder'];

function readProductRoles(value: unknown): Set<string> {
  if (!Array.isArray(value)) {
    return new Set();
  }
  return new Set(value.filter((role): role is string => typeof role === 'string'));
}

export function getRolesFromHubClaims(claims: HubClaims): AppRole[] {
  const workspaceRole = claims.roles?.workspace;
  if (claims.isSuperAdmin || workspaceRole === 'owner' || workspaceRole === 'admin') {
    return fullAccessRoles;
  }

  const productRoles = readProductRoles(claims.roles?.productRoles);
  if (productRoles.has('admin')) {
    return fullAccessRoles;
  }

  return productRoleOrder.filter((role) => productRoles.has(role));
}

export function getRoleFromHubClaims(claims: HubClaims): AppRole | undefined {
  return getRolesFromHubClaims(claims)[0];
}

export function parseJwtPayload(token: string): Record<string, unknown> | null {
  const [, payload] = token.split('.');
  if (!payload) {
    return null;
  }

  try {
    const base64 = payload.replace(/-/g, '+').replace(/_/g, '/');
    const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, '=');
    const bytes = Uint8Array.from(atob(padded), (char) => char.charCodeAt(0));
    const json = new TextDecoder().decode(bytes);
    return JSON.parse(json) as Record<string, unknown>;
  } catch {
    return null;
  }
}
