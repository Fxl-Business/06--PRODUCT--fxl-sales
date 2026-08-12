// @vitest-environment happy-dom

import * as React from 'react';
import { useEffect } from 'react';
import type { HTMLAttributes } from 'react';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '@/i18n';
import type { AppRole } from '@/auth/claims';
import {
  buildSalesOpsPath,
  getDefaultSalesOpsRoute,
  getVisibleWorkspaces,
  resolveSalesOpsRoute,
} from '@/sales-ops/navigation';
import { NoRoleGuard } from '../components/auth/RoleGuard';
import { NoRolePage } from '../pages/errors/NoRolePage';
import { SalesOpsApp } from '../sales-ops/SalesOpsApp';

const act = (
  React as typeof React & { act: typeof import('react-dom/test-utils').act }
).act;

const webRoot = path.resolve(__dirname, '../..');
const readSource = (relative: string) => readFileSync(path.join(webRoot, relative), 'utf8');

const UNAUTHORIZED = 'Acesso não autorizado';

let profileRoles: AppRole[] = [];
let profileLoaded = true;

const authMocks = vi.hoisted(() => ({ logout: vi.fn(async () => undefined) }));

vi.mock('@/auth/react', () => ({
  useAuthProfile: () => ({
    isLoaded: profileLoaded,
    isSignedIn: profileLoaded,
    roles: profileRoles,
    name: 'Test User',
    email: 'test.user@fxl.example',
  }),
  useLogout: () => authMocks.logout,
}));

const mutation = {
  isPending: false,
  mutate: vi.fn(),
  mutateAsync: vi.fn(async () => ({})),
};

vi.mock('@/sales-ops/hooks', () => ({
  useSalesOpsBootstrap: () => ({
    data: {
      sales: [],
      products: [],
      clients: [],
      areas: [],
      funcoes: [],
      people: [],
      payables: [],
      saleItems: [],
      receivables: [],
      productFuncaoCosts: [],
      saleProfessionals: [],
      settings: null,
    },
    isLoading: false,
    isError: false,
  }),
  useCreateSalesOpsSale: () => mutation,
  useUpdateSalesOpsSale: () => mutation,
  useTransitionSalesOpsSale: () => mutation,
  useCancelSalesOpsContract: () => mutation,
  useSaveSalesOpsArea: () => mutation,
  useSaveSalesOpsClient: () => mutation,
  useSaveSalesOpsFuncao: () => mutation,
  useSaveSalesOpsPerson: () => mutation,
  useSaveSalesOpsProduct: () => mutation,
  useSaveSalesOpsSettings: () => mutation,
  useSetSalesOpsCadastroStatus: () => mutation,
}));

vi.mock('@/components/ui/dialog', () => ({
  Dialog: ({ children }: HTMLAttributes<HTMLDivElement>) => <div>{children}</div>,
  DialogContent: ({ children, ...props }: HTMLAttributes<HTMLDivElement>) => (
    <div {...props}>{children}</div>
  ),
  DialogDescription: ({ children, ...props }: HTMLAttributes<HTMLParagraphElement>) => (
    <p {...props}>{children}</p>
  ),
  DialogHeader: ({ children, ...props }: HTMLAttributes<HTMLDivElement>) => (
    <div {...props}>{children}</div>
  ),
  DialogTitle: ({ children, ...props }: HTMLAttributes<HTMLHeadingElement>) => (
    <h2 {...props}>{children}</h2>
  ),
}));

let container: HTMLDivElement;
let root: Root | null;
let visited: string[];

/**
 * Records every distinct path the router settles on, in order, and converts an
 * unbounded ping-pong into ONE named failure that prints the cycle. Without the throw a
 * regression here shows up as a five second vitest timeout with no explanation, or as a
 * `Maximum update depth exceeded` stack pointing at react-router rather than at the two
 * guards that disagree.
 */
function LocationProbe() {
  const { pathname } = useLocation();
  useEffect(() => {
    visited.push(pathname);
    if (visited.length > 6) {
      throw new Error(`redirect loop: ${visited.join(' -> ')}`);
    }
  }, [pathname]);
  return <output data-testid="location-path">{pathname}</output>;
}

/**
 * The `/no-role` wiring from `router.tsx`, minus `Protected`, next to the REAL
 * `SalesOpsApp` on the two routes it owns. Mounting the real component is what makes the
 * loop assertions mean something: a stub `/` would only ever prove what the stub does.
 * `Protected` is omitted because it needs the real Hub provider; the source pin at the
 * bottom of this file is what holds the nesting inside `router.tsx` itself.
 */
async function renderAt(entry: string) {
  root = createRoot(container);
  await act(async () => {
    root?.render(
      <MemoryRouter
        future={{ v7_relativeSplatPath: true, v7_startTransition: true }}
        initialEntries={[entry]}
      >
        <Routes>
          <Route
            element={
              <NoRoleGuard>
                <NoRolePage />
              </NoRoleGuard>
            }
            path="/no-role"
          />
          <Route element={<SalesOpsApp />} path="/" />
          <Route element={<SalesOpsApp />} path="/:workspace/:view" />
        </Routes>
        <LocationProbe />
      </MemoryRouter>,
    );
  });
  for (let index = 0; index < 3; index += 1) {
    await act(async () => Promise.resolve());
  }
}

beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
    .IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div');
  document.body.append(container);
  root = null;
  visited = [];
  profileRoles = [];
  profileLoaded = true;
});

afterEach(async () => {
  if (root) {
    await act(async () => root?.unmount());
  }
  container.remove();
  vi.clearAllMocks();
});

describe('/no-role is not a dead end for an entitled operator', () => {
  it.each([
    [['admin', 'seller', 'finder'] as AppRole[], '/tatico/dashboard'],
    [['seller'] as AppRole[], '/meus-dados/vendedores'],
    [['finder'] as AppRole[], '/meus-dados/finders'],
  ])('sends a %j operator from /no-role to %s in exactly two navigations', async (roles, destination) => {
    profileRoles = roles;

    await renderAt('/no-role');

    expect(visited).toEqual(['/no-role', '/', destination]);
    expect(container.textContent).not.toContain(UNAUTHORIZED);
  });

  it('keeps the unauthorized screen for an operator with zero recognized roles', async () => {
    profileRoles = [];

    await renderAt('/no-role');

    expect(visited).toEqual(['/no-role']);
    expect(container.textContent).toContain(UNAUTHORIZED);
  });

  /**
   * The over-correction guard AND the loop guard in one. A `roles.length > 0` condition
   * passes the three cases above and fails here, by ping-ponging `/no-role` to `/` to
   * `/no-role` until `LocationProbe` throws.
   */
  it('keeps the unauthorized screen for a role the app does not recognize, and does not ping-pong', async () => {
    profileRoles = ['viewer' as AppRole];

    await renderAt('/no-role');

    expect(visited).toEqual(['/no-role']);
    expect(container.textContent).toContain(UNAUTHORIZED);
  });

  it('renders neither the unauthorized screen nor a navigation while the profile is still loading', async () => {
    profileLoaded = false;
    profileRoles = ['admin', 'seller', 'finder'];

    await renderAt('/no-role');

    expect(visited).toEqual(['/no-role']);
    expect(container.textContent).not.toContain(UNAUTHORIZED);
    expect(container.querySelector('.animate-pulse')).not.toBeNull();
  });
});

/**
 * `Record<AppRole, true>` is exhaustive by construction, so adding a member to `AppRole`
 * without adding it here is a TYPE error under `pnpm run type-check`. That is what keeps
 * the subset sweep below honest about a union it cannot enumerate at runtime.
 */
const ROLE_COVERAGE: Record<AppRole, true> = { admin: true, seller: true, finder: true };
const ALL_ROLES = Object.keys(ROLE_COVERAGE) as AppRole[];
const NON_EMPTY_ROLE_SETS: Array<[AppRole[]]> = Array.from(
  { length: 1 << ALL_ROLES.length },
  (_value, mask) => ALL_ROLES.filter((_role, index) => (mask & (1 << index)) !== 0),
)
  .filter((roles) => roles.length > 0)
  .map((roles) => [roles]);

describe('the /no-role redirect cannot ping-pong with the SalesOpsApp redirect', () => {
  it.each(NON_EMPTY_ROLE_SETS)(
    '%j yields at least one visible workspace, so the two guards can never both want to navigate',
    (roles) => {
      expect(getVisibleWorkspaces(roles).length).toBeGreaterThan(0);
    },
  );

  it.each(NON_EMPTY_ROLE_SETS)(
    'the default route for %j is canonical, so / settles in exactly one further hop',
    (roles) => {
      const route = getDefaultSalesOpsRoute(roles);
      const resolution = resolveSalesOpsRoute(route, roles);
      expect(resolution.redirect).toBe(false);
      expect(resolution.path).toBe(buildSalesOpsPath(route));
    },
  );

  it.each([
    [['admin', 'seller', 'finder'] as AppRole[], '/tatico/dashboard'],
    [['admin'] as AppRole[], '/tatico/dashboard'],
    [['seller'] as AppRole[], '/meus-dados/vendedores'],
    [['finder'] as AppRole[], '/meus-dados/finders'],
    [['seller', 'finder'] as AppRole[], '/meus-dados/vendedores'],
  ])('a %j operator entering at / lands on %s', (roles, destination) => {
    expect(buildSalesOpsPath(getDefaultSalesOpsRoute(roles))).toBe(destination);
  });
});

describe('router wiring', () => {
  /**
   * The harness above rebuilds the `/no-role` route by hand, so this is what pins that
   * `router.tsx` really wraps the page, and that the guard sits INSIDE `Protected` rather
   * than outside it, where it would judge an unresolved profile on a cold entry.
   */
  it('router.tsx wraps NoRolePage in NoRoleGuard inside Protected', () => {
    const source = readSource('src/router.tsx');
    expect(source).toMatch(
      /<Protected>\s*<NoRoleGuard>\s*<NoRolePage \/>\s*<\/NoRoleGuard>\s*<\/Protected>/,
    );
  });
});
