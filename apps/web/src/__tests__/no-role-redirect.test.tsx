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
import type { SalesEdition } from '@fxl-sales/shared-utils/sales-edition';
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
let profileEdition: SalesEdition | undefined;
let profileLoaded = true;
let profileName: string | undefined = 'Test User';
let profileEmail: string | undefined = 'test.user@fxl.example';
let profileAvatarUrl: string | undefined;
let activeOrganization: { id: string; name?: string } | null = null;

const ACTIVE_ORGANIZATION_ID = 'org_raw_no_role_7f3a';

const authMocks = vi.hoisted(() => ({
  logout: vi.fn(async () => undefined),
  switchAccount: vi.fn(),
}));

vi.mock('@/auth/react', () => ({
  useAuthProfile: () => ({
    isLoaded: profileLoaded,
    isSignedIn: profileLoaded,
    roles: profileRoles,
    edition: profileEdition,
    name: profileName,
    email: profileEmail,
    avatarUrl: profileAvatarUrl,
  }),
  useLogout: () => authMocks.logout,
  useOrganizations: () => ({
    active: activeOrganization,
    activeName: activeOrganization?.name,
    organizations: activeOrganization ? [activeOrganization] : [],
    others: [],
    setActive: vi.fn(async () => undefined),
    switchAccount: authMocks.switchAccount,
    client: {},
  }),
  useSalesEdition: () => profileEdition ?? 'full',
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

/*
  The leads edition lands on `operacional/leads` and `meus-dados/leads`, which mount the
  board. This harness tests navigation only, and the real board needs a query client and
  a token, so it is a marker here exactly as in `leads-routing.test.tsx`.
*/
vi.mock('@/sales-ops/leads/LeadsBoardContainer', () => ({
  LeadsBoardContainer: () => <div data-leads-board />,
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
  profileEdition = undefined;
  profileLoaded = true;
  profileName = 'Test User';
  profileEmail = 'test.user@fxl.example';
  profileAvatarUrl = undefined;
  activeOrganization = null;
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

describe('/no-role offers "Trocar conta" for a person signed in with the wrong account', () => {
  const buttonNamed = (label: string) =>
    Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent?.trim() === label,
    );

  it('renders "Trocar conta" beside "Sair" in the same action row', async () => {
    await renderAt('/no-role');

    const switchButton = buttonNamed('Trocar conta');
    const signOutButton = buttonNamed('Sair');
    expect(switchButton).toBeDefined();
    expect(signOutButton).toBeDefined();
    expect(switchButton?.parentElement).toBe(signOutButton?.parentElement);
    expect(switchButton?.getAttribute('type')).toBe('button');
  });

  it('calls the provider switchAccount exactly once with the active Organization as the hint', async () => {
    activeOrganization = { id: ACTIVE_ORGANIZATION_ID, name: 'Acme' };
    await renderAt('/no-role');

    await act(async () => buttonNamed('Trocar conta')?.click());

    expect(authMocks.switchAccount).toHaveBeenCalledTimes(1);
    expect(authMocks.switchAccount).toHaveBeenCalledWith({ organization: ACTIVE_ORGANIZATION_ID });
    expect(authMocks.logout).not.toHaveBeenCalled();
    expect(visited).toEqual(['/no-role']);
  });

  it('ignores a second click while the account switch is already navigating', async () => {
    activeOrganization = { id: ACTIVE_ORGANIZATION_ID, name: 'Acme' };
    await renderAt('/no-role');

    // Two clicks in ONE act: the second lands before React re-renders the button
    // disabled, so only the synchronous guard can stop it.
    await act(async () => {
      buttonNamed('Trocar conta')?.click();
      buttonNamed('Trocar conta')?.click();
    });
    await act(async () => buttonNamed('Trocar conta')?.click());

    expect(authMocks.switchAccount).toHaveBeenCalledTimes(1);
    expect(buttonNamed('Trocar conta')?.disabled).toBe(true);
    // Sair stays available: the person may still sign out instead.
    expect(buttonNamed('Sair')?.disabled).toBe(false);
  });

  it('calls switchAccount with no organization hint when no Organization is active', async () => {
    activeOrganization = null;
    await renderAt('/no-role');

    await act(async () => buttonNamed('Trocar conta')?.click());

    expect(authMocks.switchAccount).toHaveBeenCalledTimes(1);
    expect(authMocks.switchAccount).toHaveBeenCalledWith({ organization: undefined });
  });

  it('names the active account so the person can see which one has no role', async () => {
    activeOrganization = { id: ACTIVE_ORGANIZATION_ID, name: 'Acme' };
    await renderAt('/no-role');

    const account = container.querySelector('[data-testid="no-role-active-account"]');
    expect(account).not.toBeNull();
    expect(account?.textContent).toContain('Conectado como');
    expect(account?.textContent).toContain('Test User');
    expect(account?.textContent).toContain('test.user@fxl.example');
    expect(container.textContent).not.toContain(ACTIVE_ORGANIZATION_ID);
  });

  it('shows the avatar when the claim carries one, decorative only', async () => {
    profileAvatarUrl = 'https://cdn.fxl.example/avatar.png';
    await renderAt('/no-role');

    const avatar = container.querySelector('[data-testid="no-role-active-account"] img');
    expect(avatar?.getAttribute('src')).toBe(profileAvatarUrl);
    expect(avatar?.getAttribute('alt')).toBe('');
  });

  it('falls back to the email alone when the name claim is absent', async () => {
    profileName = undefined;
    await renderAt('/no-role');

    const account = container.querySelector('[data-testid="no-role-active-account"]');
    expect(account?.textContent).toContain('test.user@fxl.example');
    expect(account?.querySelectorAll('img')).toHaveLength(0);
  });

  it('renders an email-only account email exactly once, never repeated on a secondary line', async () => {
    profileName = undefined;
    await renderAt('/no-role');

    const account = container.querySelector('[data-testid="no-role-active-account"]');
    const text = account?.textContent ?? '';
    expect(text.split('test.user@fxl.example')).toHaveLength(2);
  });

  it('omits the account block, but keeps both actions, when neither name nor email is known', async () => {
    profileName = undefined;
    profileEmail = undefined;
    activeOrganization = { id: ACTIVE_ORGANIZATION_ID };
    await renderAt('/no-role');

    expect(container.querySelector('[data-testid="no-role-active-account"]')).toBeNull();
    expect(container.textContent).not.toContain(ACTIVE_ORGANIZATION_ID);
    expect(buttonNamed('Trocar conta')).toBeDefined();
    expect(buttonNamed('Sair')).toBeDefined();
  });

  it('resolves the copy from i18n in English too, with no act() warning', async () => {
    const { i18n } = await import('@/i18n');
    const consoleError = vi.spyOn(console, 'error');
    // Both language changes re-render the mounted page through react-i18next, so both
    // run inside act(); the switch back happens while the root is still mounted.
    await act(async () => {
      await i18n.changeLanguage('en');
    });
    try {
      await renderAt('/no-role');

      expect(buttonNamed('Switch account')).toBeDefined();
      expect(buttonNamed('Sign out')).toBeDefined();
      expect(container.textContent).toContain('Signed in as');
    } finally {
      await act(async () => {
        await i18n.changeLanguage('pt-BR');
      });
    }
    const actWarnings = consoleError.mock.calls.filter((call) =>
      call.some((part) => String(part).includes('not wrapped in act')),
    );
    consoleError.mockRestore();
    expect(actWarnings).toEqual([]);
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

describe('the leads edition shares one predicate between NoRoleGuard and SalesOpsApp', () => {
  it.each([
    [['admin', 'seller', 'finder'] as AppRole[], '/operacional/leads'],
    [['admin'] as AppRole[], '/operacional/leads'],
    [['seller'] as AppRole[], '/meus-dados/leads'],
    [['seller', 'finder'] as AppRole[], '/meus-dados/leads'],
  ])('sends a leads-edition %j operator from /no-role to %s in exactly two navigations', async (roles, destination) => {
    profileEdition = 'leads';
    profileRoles = roles;
    await renderAt('/no-role');
    expect(visited).toEqual(['/no-role', '/', destination]);
    expect(container.textContent).not.toContain(UNAUTHORIZED);
  });

  /** THE decisive case: keyed on roles alone, NoRoleGuard ping-pongs here. */
  it('keeps a leads-edition finder-only operator on /no-role without a loop', async () => {
    profileEdition = 'leads';
    profileRoles = ['finder'];
    await renderAt('/no-role');
    expect(visited).toEqual(['/no-role']);
    expect(container.textContent).toContain(UNAUTHORIZED);
  });

  it('sends a leads-edition finder-only operator entering at / to /no-role and stops there', async () => {
    profileEdition = 'leads';
    profileRoles = ['finder'];
    await renderAt('/');
    expect(visited).toEqual(['/', '/no-role']);
    expect(container.textContent).toContain(UNAUTHORIZED);
  });

  it.each(NON_EMPTY_ROLE_SETS)(
    'in the leads edition the default route for %j is canonical whenever a workspace is visible',
    (roles) => {
      if (getVisibleWorkspaces(roles, 'leads').length === 0) {
        expect(roles).toEqual(['finder']);
        return;
      }
      const route = getDefaultSalesOpsRoute(roles, undefined, 'leads');
      const resolution = resolveSalesOpsRoute(route, roles, 'leads');
      expect(resolution.redirect).toBe(false);
      expect(resolution.path).toBe(buildSalesOpsPath(route));
    },
  );
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
