// @vitest-environment happy-dom

/**
 * PC23 through the SHELL: a 403 on saving Configurações keeps the screen mounted
 * and shows the pt-BR admin-required banner, never `ForbiddenPanel` (which is the
 * app gate for the bootstrap read only).
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import * as React from 'react';
import type { HTMLAttributes } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MUTATION_ERROR_COPY } from '../mutation-error-copy';
import type { SalesOpsBootstrap, SalesOpsSettings } from '../types';

const mocks = vi.hoisted(() => ({
  getToken: vi.fn(),
  logout: vi.fn(async () => undefined),
  setActive: vi.fn(async () => undefined),
  checkoutUrl: vi.fn(async () => 'https://hub.example/checkout'),
}));

// Allocated once, outside the hook body: see entitlement-dead-end.test.tsx.
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
const profile = {
  isLoaded: true,
  isSignedIn: true,
  roles: ['admin'],
  name: 'Test User',
  email: 'test.user@fxl.example',
};

vi.mock('@/auth/react', () => ({
  useAuthProfile: () => profile,
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

// NOT mocked: '../api', '@/lib/api-client' and '../hooks'. The 403 travels the REAL
// apiFetch error path into the mutation's onError.
import { SalesOpsApp } from '../SalesOpsApp';

const act = (React as typeof React & { act: typeof import('react-dom/test-utils').act }).act;

const legacySettings: SalesOpsSettings = {
  orgId: 'org-a',
  legalName: 'FXL Consultoria',
  document: '00.000.000/0001-00',
  phone: '',
  financeEmail: '',
  defaultSellerCommissionPct: '10',
  defaultFinderCommissionPct: '3',
  defaultTaxPct: '6',
  currency: 'USD',
  taxRegime: 'Simples Nacional',
  periodClosingDay: 1,
  tableDensity: 'comfortable',
  dateFormat: 'dd/mm/aaaa',
  language: 'pt-BR',
  commissionOnRecurring: true,
  sellerCanBeFinder: true,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: null,
};

const bootstrap: SalesOpsBootstrap = {
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
  settings: legacySettings,
};

let container: HTMLDivElement;
let root: Root | null;
let fetchMock: ReturnType<typeof vi.fn>;

function respond(status: number, body: unknown) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

beforeEach(() => {
  (
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div');
  document.body.append(container);
  root = null;
  fetchMock = vi.fn((url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    if (method === 'GET' && url.endsWith('/api/v1/sales-ops/bootstrap')) {
      return Promise.resolve(respond(200, bootstrap));
    }
    if (method === 'GET' && url.includes('/api/v1/sales-ops/history')) {
      return Promise.resolve(respond(200, { entries: [], nextCursor: null }));
    }
    if (method === 'PUT' && url.endsWith('/api/v1/sales-ops/settings')) {
      return Promise.resolve(respond(403, { error: 'forbidden', reason: 'admin_role_required' }));
    }
    return Promise.resolve(respond(404, { error: 'not_found' }));
  });
  vi.stubGlobal('fetch', fetchMock);
  mocks.getToken.mockResolvedValue('hub-access-token');
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

function text() {
  return container.textContent ?? '';
}

function settingsPuts() {
  return fetchMock.mock.calls.filter(
    ([url, init]) =>
      String(url).endsWith('/api/v1/sales-ops/settings') &&
      (init as RequestInit | undefined)?.method === 'PUT',
  );
}

describe('a 403 on a financial mutation is a refused action, not a refused app', () => {
  it('keeps Configurações on screen and shows the admin copy when saving settings answers 403', async () => {
    await renderApp('/cadastros/geral');
    expect(text()).toContain('Dados da empresa');

    const button = Array.from(container.querySelectorAll('button')).find(
      (candidate) => candidate.textContent?.trim() === 'Salvar alterações',
    );
    expect(button).toBeDefined();
    await act(async () => button?.click());
    await flushReact();
    await flushReact();

    expect(settingsPuts()).toHaveLength(1);
    expect(text()).toContain(MUTATION_ERROR_COPY.adminRequired);
    expect(text()).toContain('Dados da empresa');
    expect(container.querySelector('[data-forbidden]')).toBeNull();
  });
});
