// @vitest-environment happy-dom

/**
 * PC23 through the SHELL: a 403 on saving Configurações, on a status transition
 * or on cancelling a contract keeps the screen mounted and shows the pt-BR
 * admin-required banner, never `ForbiddenPanel` (which is the app gate for the
 * bootstrap read only). Each action is driven through its REAL button, confirm
 * step included, so removing `reportMutation` from any one call fails its case.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import * as React from 'react';
import type { HTMLAttributes, ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MUTATION_ERROR_COPY } from '../mutation-error-copy';
import type { SalesOpsBootstrap, SalesOpsSale, SalesOpsSettings } from '../types';

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
  useSalesEdition: () => 'full',
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

// Radix menus and the confirm dialog, flattened exactly as in
// sales-transition-actions.test.tsx so the row actions are plain buttons.
vi.mock('@/components/ui/dropdown-menu', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/components/ui/dropdown-menu')>()),
  DropdownMenu: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DropdownMenuTrigger: ({ children }: { children: ReactNode }) => <>{children}</>,
  DropdownMenuContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  // `asChild` items (the shell's Organization rows) already render their own
  // <button>; wrapping them in another would nest buttons.
  DropdownMenuItem: ({
    asChild,
    children,
    onSelect,
  }: {
    asChild?: boolean;
    children: ReactNode;
    onSelect?: () => void;
  }) =>
    asChild ? (
      <>{children}</>
    ) : (
      <button onClick={() => onSelect?.()} type="button">
        {children}
      </button>
    ),
  DropdownMenuLabel: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DropdownMenuSeparator: () => <hr />,
}));

vi.mock('@/components/ui/alert-dialog', () => ({
  AlertDialog: ({ children, open }: { children: ReactNode; open: boolean }) =>
    open ? <div>{children}</div> : null,
  AlertDialogContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  AlertDialogHeader: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  AlertDialogFooter: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  AlertDialogTitle: ({ children }: { children: ReactNode }) => <h2>{children}</h2>,
  AlertDialogDescription: ({ children }: { children: ReactNode }) => <p>{children}</p>,
  AlertDialogAction: ({ children, onClick }: { children: ReactNode; onClick?: () => void }) => (
    <button onClick={onClick} type="button">
      {children}
    </button>
  ),
  AlertDialogCancel: ({ children }: { children: ReactNode }) => (
    <button type="button">{children}</button>
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

function sale(overrides: Partial<SalesOpsSale> & { id: string; code: string }): SalesOpsSale {
  return {
    orgId: 'org-a',
    sequence: 1,
    clientId: null,
    clientNameSnapshot: 'SegPro',
    sellerPersonId: null,
    sellerNameSnapshot: 'Ana Martins',
    finderPersonId: null,
    finderNameSnapshot: null,
    status: 'open',
    paymentMethod: 'pix',
    condition: 'installments',
    installments: 1,
    baseDate: '2026-07-10',
    notes: null,
    wonAt: null,
    lostAt: null,
    totalBrl: 300000,
    recurringBrl: 0,
    sellerCommissionPct: '8',
    finderCommissionPct: '0',
    taxPct: '6',
    otherCostsBrl: 0,
    professionalCostsBrl: 0,
    sellerCommissionBrl: 24000,
    finderCommissionBrl: 0,
    taxBrl: 18000,
    netMarginBrl: 258000,
    netMarginPct: '86',
    createdAt: '2026-07-10T12:00:00.000Z',
    updatedAt: null,
    ...overrides,
  };
}

const openSale = sale({ id: 'sale-open', code: 'P-002', status: 'open' });
const wonRecurringSale = sale({
  id: 'sale-won-recurring',
  code: 'P-003',
  status: 'won',
  recurringBrl: 100000,
  wonAt: '2026-07-11T12:00:00.000Z',
});

const bootstrap: SalesOpsBootstrap = {
  sales: [openSale, wonRecurringSale],
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
    if (
      method === 'POST' &&
      (url.endsWith(`/api/v1/sales-ops/sales/${openSale.id}/transition`) ||
        url.endsWith(`/api/v1/sales-ops/sales/${wonRecurringSale.id}/cancel-contract`))
    ) {
      return Promise.resolve(respond(403, { error: 'forbidden', reason: 'admin_role_required' }));
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

function callsTo(method: string, suffix: string) {
  return fetchMock.mock.calls.filter(
    ([url, init]) =>
      String(url).endsWith(suffix) && ((init as RequestInit | undefined)?.method ?? 'GET') === method,
  );
}

function rowByCode(code: string): HTMLTableRowElement | null {
  const row = [...container.querySelectorAll('tbody tr')].find((candidate) =>
    candidate.textContent?.includes(code),
  );
  return row instanceof HTMLTableRowElement ? row : null;
}

function buttonIn(scope: Element, label: string): HTMLButtonElement {
  const match = [...scope.querySelectorAll('button')].find(
    (candidate) => candidate.textContent?.trim() === label,
  );
  if (!(match instanceof HTMLButtonElement)) throw new Error(`button not found: ${label}`);
  return match;
}

// The confirm dialog renders after the table and shares its label with the row
// action, so the confirm button is the LAST match in the document.
function confirmButton(label: string): HTMLButtonElement {
  const match = [...container.querySelectorAll('button')]
    .filter((candidate) => candidate.textContent?.trim() === label)
    .at(-1);
  if (!(match instanceof HTMLButtonElement)) throw new Error(`confirm not found: ${label}`);
  return match;
}

async function click(element: HTMLElement) {
  await act(async () => element.dispatchEvent(new MouseEvent('click', { bubbles: true })));
  await flushReact();
  await flushReact();
}

function expectRefusedInPlace() {
  expect(text()).toContain(MUTATION_ERROR_COPY.adminRequired);
  expect(container.querySelector('[data-forbidden]')).toBeNull();
  // The vendas table is still mounted with both rows.
  expect(rowByCode('P-002')).not.toBeNull();
  expect(rowByCode('P-003')).not.toBeNull();
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

  it('keeps Vendas on screen and shows the admin copy when a transition answers 403', async () => {
    await renderApp('/operacional/vendas');
    const row = rowByCode('P-002');
    expect(row).not.toBeNull();
    expect(text()).not.toContain(MUTATION_ERROR_COPY.adminRequired);

    await click(buttonIn(row as HTMLTableRowElement, 'Marcar como ganha'));

    expect(callsTo('POST', `/api/v1/sales-ops/sales/${openSale.id}/transition`)).toHaveLength(1);
    expectRefusedInPlace();
  });

  it('keeps Vendas on screen and shows the admin copy when cancel-contract answers 403', async () => {
    await renderApp('/operacional/vendas');
    const row = rowByCode('P-003');
    expect(row).not.toBeNull();

    await click(buttonIn(row as HTMLTableRowElement, 'Cancelar contrato'));
    expect(text()).toContain('Cancelar contrato?');
    await click(confirmButton('Cancelar contrato'));

    expect(
      callsTo('POST', `/api/v1/sales-ops/sales/${wonRecurringSale.id}/cancel-contract`),
    ).toHaveLength(1);
    expectRefusedInPlace();
  });
});
