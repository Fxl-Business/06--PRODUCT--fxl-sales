// @vitest-environment happy-dom

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import * as React from 'react';
import type { HTMLAttributes } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FORBIDDEN_COPY } from '../forbidden-copy';
import { MISSING_ENTITLEMENT_COPY } from '../missing-entitlement-copy';

const mocks = vi.hoisted(() => ({
  getToken: vi.fn(),
  logout: vi.fn(async () => undefined),
  setActive: vi.fn(async () => undefined),
  checkoutUrl: vi.fn(async () => 'https://hub.example/checkout'),
}));

/*
  A factory `vi.mock` REPLACES the module, so every export the shell OR the
  entitlement panel reads has to be here. `useOrganizations` and its
  `client.checkoutUrl` in particular: the panel calls `checkoutUrl()` from a mount
  effect, and an undefined `client` throws inside that effect rather than failing
  an assertion, which would read as the routing change being broken.
  Two Organizations, so the panel renders its switch affordance rather than its
  nowhere-to-go state.

  Every value the hook hands back is allocated ONCE, outside the hook body, because
  the real `useHubOrganizations` returns a stable `client` and the panel's checkout
  effect depends on that identity. A fresh object literal per render makes that
  effect re-run forever and the render never settles - which shows up as a five
  second test timeout, not as a failed assertion.
*/
const organizations = [
  { id: 'org-a', name: 'Alfa Consultoria' },
  { id: 'org-b', name: 'Beta Engenharia' },
];
const hubClient = { checkoutUrl: mocks.checkoutUrl };
const organizationSeam = {
  active: organizations[0],
  activeName: 'Alfa Consultoria',
  organizations,
  others: [organizations[1]],
  setActive: mocks.setActive,
  client: hubClient,
};

vi.mock('@/auth/react', () => ({
  useAuthProfile: () => ({
    isLoaded: true,
    isSignedIn: true,
    roles: ['admin'],
    name: 'Test User',
    email: 'test.user@fxl.example',
  }),
  useLogout: () => mocks.logout,
  useAccessToken: () => ({ getToken: mocks.getToken }),
  useOrganizations: () => organizationSeam,
}));

vi.mock('@/components/ui/dialog', () => ({
  Dialog: ({ children }: HTMLAttributes<HTMLDivElement>) => <div>{children}</div>,
  DialogContent: ({ children, className }: HTMLAttributes<HTMLDivElement>) => (
    <div className={className}>{children}</div>
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

// NOT mocked on purpose: '../api', '@/lib/api-client' and '../hooks'. The 402 body
// travels the REAL apiFetch error path, so this oracle also proves the status
// survives into the ApiError the shell classifies.
import { SalesOpsApp } from '../SalesOpsApp';

const act = (React as typeof React & { act: typeof import('react-dom/test-utils').act }).act;

const missingEntitlement = {
  ok: false,
  status: 402,
  json: async () => ({ error: 'payment_required', code: 'missing_entitlement' }),
};

const GENERIC_API_FAULT = 'Verifique o servidor local';
const SESSION_EXPIRED = 'Sessão expirada';
const LOADING_COPY = 'Carregando dados comerciais';

let container: HTMLDivElement;
let root: Root | null;
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  (
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div');
  document.body.append(container);
  root = null;
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(async () => {
  if (root) {
    await act(async () => root?.unmount());
  }
  container.remove();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

async function flushReact() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

async function renderApp(path: string) {
  // `retry: false` is mandatory: otherwise the 402 is retried and the error frame
  // never settles inside the two flushes below.
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  root = createRoot(container);
  await act(async () => {
    root?.render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter
          future={{ v7_relativeSplatPath: true, v7_startTransition: true }}
          initialEntries={[path]}
        >
          <Routes>
            <Route element={<SalesOpsApp />} path="/:workspace/:view" />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );
  });
  await flushReact();
  await flushReact();
}

function entitlementPanel() {
  return container.querySelector('[data-missing-entitlement]');
}

function forbiddenPanel() {
  return container.querySelector('[data-forbidden]');
}

function text() {
  return container.textContent ?? '';
}

describe('a 402 missing_entitlement is not a server fault', () => {
  it('renders the entitlement panel for a 402 missing_entitlement', async () => {
    mocks.getToken.mockResolvedValue('hub-access-token');
    fetchMock.mockResolvedValue(missingEntitlement);

    await renderApp('/tatico/dashboard');

    expect(entitlementPanel()).not.toBeNull();
    expect(text()).toContain(MISSING_ENTITLEMENT_COPY.title);
    // This is the reported defect: the operator was told their local server was
    // broken when the only thing wrong was WHICH Organization was active.
    expect(text()).not.toContain(GENERIC_API_FAULT);
    // And a future collapse of the two error branches into one is caught here too.
    expect(text()).not.toContain(SESSION_EXPIRED);
    expect(forbiddenPanel()).toBeNull();
  });

  it('still renders the generic API fault for a 500', async () => {
    mocks.getToken.mockResolvedValue('hub-access-token');
    fetchMock.mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => ({ error: 'internal_error' }),
    });

    await renderApp('/tatico/dashboard');

    expect(text()).toContain(GENERIC_API_FAULT);
    // Keeps the case above non-vacuous: the panel really is 402-only.
    expect(entitlementPanel()).toBeNull();
    expect(forbiddenPanel()).toBeNull();
  });

  it('still renders Sessão expirada for a 401', async () => {
    mocks.getToken.mockResolvedValue('hub-access-token');
    fetchMock.mockResolvedValue({
      ok: false,
      status: 401,
      json: async () => ({ error: 'unauthorized' }),
    });

    await renderApp('/tatico/dashboard');

    // Proves the new FIRST branch does not swallow a 401.
    expect(text()).toContain(SESSION_EXPIRED);
    expect(text()).not.toContain(GENERIC_API_FAULT);
    expect(entitlementPanel()).toBeNull();
    expect(forbiddenPanel()).toBeNull();
  });

  it('renders the skeleton and no error panel while the bootstrap is loading', async () => {
    mocks.getToken.mockResolvedValue('hub-access-token');
    fetchMock.mockReturnValue(new Promise(() => {}));

    await renderApp('/tatico/dashboard');

    expect(text()).toContain(LOADING_COPY);
    expect(entitlementPanel()).toBeNull();
    expect(text()).not.toContain(SESSION_EXPIRED);
    expect(text()).not.toContain(GENERIC_API_FAULT);
  });

  it('renders the forbidden panel for a 403 and never the server-fault or session-expired copy', async () => {
    mocks.getToken.mockResolvedValue('hub-access-token');
    fetchMock.mockResolvedValue({
      ok: false,
      status: 403,
      json: async () => ({ error: 'forbidden', code: 'missing_role' }),
    });

    await renderApp('/tatico/dashboard');

    expect(forbiddenPanel()).not.toBeNull();
    expect(text()).toContain(FORBIDDEN_COPY.title);
    expect(text()).not.toContain(GENERIC_API_FAULT);
    expect(text()).not.toContain(SESSION_EXPIRED);
    // Keeps the 402 arm non-vacuous in the other direction too.
    expect(entitlementPanel()).toBeNull();
  });
});
