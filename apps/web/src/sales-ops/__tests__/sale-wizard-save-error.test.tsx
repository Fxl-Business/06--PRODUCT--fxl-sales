// @vitest-environment happy-dom

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import * as React from 'react';
import type { HTMLAttributes, ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SalesOpsBootstrap, SalesOpsPersonFuncao, SalesOpsSale } from '../types';

vi.mock('@/auth/react', () => ({
  useAuthProfile: () => ({
    isLoaded: true,
    isSignedIn: true,
    roles: ['admin'],
    name: 'Test User',
    email: 'test.user@fxl.example',
  }),
  useLogout: () => vi.fn(async () => undefined),
  useAccessToken: () => ({ getToken: async () => 'test-token' }),
  // The dropdown mock renders the account menu inline, which reads the Organizations.
  useOrganizations: () => ({
    active: null,
    activeName: null,
    organizations: [],
    others: [],
    setActive: vi.fn(),
    client: null,
  }),
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

vi.mock('@/components/ui/dropdown-menu', () => ({
  DropdownMenu: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DropdownMenuTrigger: ({ children }: { children: ReactNode }) => <>{children}</>,
  DropdownMenuContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DropdownMenuLabel: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DropdownMenuSeparator: () => <hr />,
  DropdownMenuGroup: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DropdownMenuItem: ({ children, onSelect }: { children: ReactNode; onSelect?: () => void }) => (
    // A menuitem, not a button: an item may wrap its own button (`asChild`).
    <div onClick={() => onSelect?.()} role="menuitem">
      {children}
    </div>
  ),
}));

vi.mock('../api', () => ({
  salesOpsApi: {
    bootstrap: vi.fn(),
    savePerson: vi.fn(),
    saveProduct: vi.fn(),
    saveClient: vi.fn(),
    saveArea: vi.fn(),
    saveFuncao: vi.fn(),
    setCadastroStatus: vi.fn(),
    createSale: vi.fn(),
    updateSale: vi.fn(),
    transitionSale: vi.fn(),
    cancelContract: vi.fn(),
    saveSettings: vi.fn(),
  },
}));

import { salesOpsApi } from '../api';
import { SalesOpsApp } from '../SalesOpsApp';

const act = (
  React as typeof React & { act: typeof import('react-dom/test-utils').act }
).act;

const funcaoVendedor: SalesOpsPersonFuncao = {
  id: 'fc000001-0000-4000-8000-000000000001',
  name: 'Vendedor',
  slug: 'vendedor',
  isSystem: true,
};
const funcaoFinder: SalesOpsPersonFuncao = {
  id: 'fc000002-0000-4000-8000-000000000002',
  name: 'Finder',
  slug: 'finder',
  isSystem: true,
};

const areaOneId = '66666666-6666-4666-8666-666666666666';
const areaTwoId = '77777777-7777-4777-8777-777777777777';
const productId = '22222222-2222-4222-8222-222222222222';
const clientId = '33333333-3333-4333-8333-333333333333';
const sellerId = '44444444-4444-4444-8444-444444444444';
const finderId = '55555555-5555-4555-8555-555555555555';
const saleId = '88888888-8888-4888-8888-888888888888';

const editSale: SalesOpsSale = {
  id: saleId,
  orgId: 'org-test',
  sequence: 1,
  code: 'V-0001',
  clientId,
  clientNameSnapshot: 'SegPro',
  sellerPersonId: sellerId,
  sellerNameSnapshot: 'Ana Martins',
  finderPersonId: null,
  finderNameSnapshot: null,
  status: 'won',
  paymentMethod: 'pix',
  condition: 'installments',
  installments: 2,
  baseDate: '2026-07-10',
  notes: 'nota interna',
  wonAt: '2026-07-11T12:00:00.000Z',
  lostAt: null,
  totalBrl: 300000,
  recurringBrl: 100000,
  sellerCommissionPct: '8',
  finderCommissionPct: '0',
  taxPct: '6',
  otherCostsBrl: 30000,
  professionalCostsBrl: 50000,
  sellerCommissionBrl: 24000,
  finderCommissionBrl: 0,
  taxBrl: 18000,
  netMarginBrl: 178000,
  netMarginPct: '59.3',
  createdAt: '2026-07-10T12:00:00.000Z',
  updatedAt: null,
};

function bootstrap(patch: Partial<SalesOpsBootstrap> = {}): SalesOpsBootstrap {
  return {
    sales: [editSale],
    products: [
      {
        id: productId,
        orgId: 'org-test',
        name: 'FXL Finance',
        codeSuffix: 'FIN',
        areaId: areaOneId,
        openPrice: false,
        setupBrl: 250000,
        hasMonthly: false,
        monthlyBrl: 0,
        recurringCommission: false,
        hasFinderCommission: false,
        sellerCommissionType: 'pct',
        sellerCommissionValue: '10',
        sellerWithFinderCommissionType: 'pct',
        sellerWithFinderCommissionValue: '7',
        finderCommissionType: 'pct',
        finderCommissionValue: '3',
        modules: [],
        providers: [],
        status: 'active',
        createdAt: '2026-07-10T12:00:00.000Z',
        updatedAt: null,
      },
    ],
    clients: [
      {
        id: clientId,
        orgId: 'org-test',
        name: 'SegPro',
        contact: null,
        createdAt: '2026-07-10T12:00:00.000Z',
        updatedAt: null,
      },
    ],
    funcoes: [],
    people: [
      {
        id: sellerId,
        orgId: 'org-test',
        displayName: 'Ana Martins',
        contactEmail: null,
        status: 'active',
        funcaoIds: [funcaoVendedor.id],
        funcoes: [funcaoVendedor],
        createdAt: '2026-07-10T12:00:00.000Z',
        updatedAt: null,
      },
      {
        id: finderId,
        orgId: 'org-test',
        displayName: 'Bruno Finder',
        contactEmail: null,
        status: 'active',
        funcaoIds: [funcaoFinder.id],
        funcoes: [funcaoFinder],
        createdAt: '2026-07-10T12:00:00.000Z',
        updatedAt: null,
      },
    ],
    areas: [
      {
        id: areaOneId,
        orgId: 'org-test',
        name: 'FXL Tech',
        status: 'active',
        createdAt: '2026-07-10T12:00:00.000Z',
        updatedAt: null,
      },
      {
        id: areaTwoId,
        orgId: 'org-test',
        name: 'FXL Advisor',
        status: 'active',
        createdAt: '2026-07-10T12:00:00.000Z',
        updatedAt: null,
      },
    ],
    payables: [],
    saleItems: [
      {
        id: 'item-1',
        saleId,
        productId,
        productNameSnapshot: 'FXL Finance',
        productTypeSnapshot: 'SaaS',
        quantity: 1,
        unitBrl: 250000,
        subtotalBrl: 250000,
      },
      {
        id: 'item-2',
        saleId,
        productId: null,
        areaId: areaTwoId,
        productNameSnapshot: 'Consultoria de processos',
        productTypeSnapshot: '',
        quantity: 1,
        unitBrl: 50000,
        subtotalBrl: 50000,
      },
    ],
    receivables: [
      { id: 'rec-1', saleId, label: '1/2', dueDate: '2026-07-10', amountBrl: 150000, method: 'pix', status: 'open' },
      { id: 'rec-2', saleId, label: '2/2', dueDate: '2026-08-10', amountBrl: 150000, method: 'boleto', status: 'open' },
      { id: 'rec-3', saleId, label: 'M1/2', dueDate: '2026-08-10', amountBrl: 100000, method: 'boleto', status: 'open' },
      { id: 'rec-4', saleId, label: 'M2/2', dueDate: '2026-09-10', amountBrl: 100000, method: 'boleto', status: 'open' },
    ],
    productFuncaoCosts: [],
    saleProfessionals: [
      { saleId, personId: null, personNameSnapshot: 'Dev Externo', role: 'Operacional', costBrl: 50000 },
    ],
    settings: {
      orgId: 'org-test',
      legalName: '',
      document: '',
      phone: '',
      financeEmail: '',
      defaultSellerCommissionPct: '10',
      defaultFinderCommissionPct: '3',
      defaultTaxPct: '6',
      currency: 'BRL',
      taxRegime: 'Simples Nacional',
      periodClosingDay: 1,
      tableDensity: 'comfortable',
      dateFormat: 'dd/mm/aaaa',
      language: 'pt-BR',
      commissionOnRecurring: true,
      sellerCanBeFinder: true,
      createdAt: '2026-07-10T12:00:00.000Z',
      updatedAt: null,
    },
    ...patch,
  };
}

let container: HTMLDivElement;
let root: Root | null;

beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
    .IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div');
  document.body.append(container);
  root = null;
  vi.mocked(salesOpsApi.bootstrap).mockResolvedValue(bootstrap());
});

afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  container.remove();
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
            <Route element={<SalesOpsApp />} path="/" />
            <Route element={<SalesOpsApp />} path="/:workspace/:view" />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );
  });
  await flushReact();
  await flushReact();
}

function buttonIn(scope: ParentNode, label: string): HTMLButtonElement {
  const match = [...scope.querySelectorAll('button')].find(
    (candidate) => candidate.textContent?.trim() === label,
  );
  if (!(match instanceof HTMLButtonElement)) throw new Error(`button not found: ${label}`);
  return match;
}

function menuItemIn(scope: ParentNode, label: string): HTMLElement {
  const match = [...scope.querySelectorAll('[role="menuitem"]')].find(
    (candidate) => candidate.textContent?.trim() === label,
  );
  if (!(match instanceof HTMLElement)) throw new Error(`menu item not found: ${label}`);
  return match;
}

function rowByCode(code: string): HTMLTableRowElement {
  const match = [...container.querySelectorAll('tr')].find((row) => row.textContent?.includes(code));
  if (!(match instanceof HTMLTableRowElement)) throw new Error(`row not found: ${code}`);
  return match;
}

function labeledInput(label: string): HTMLInputElement {
  const match = container.querySelector(`input[aria-label="${label}"]`);
  if (!(match instanceof HTMLInputElement)) throw new Error(`input not found: ${label}`);
  return match;
}

async function click(element: HTMLElement) {
  await act(async () => element.dispatchEvent(new MouseEvent('click', { bubbles: true })));
}

async function changeInput(input: HTMLInputElement, value: string) {
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    setter?.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

describe('sale wizard save error', () => {
  it('keeps the wizard open with the operator edits and names the blocking row on 409 row_has_active_settlement', async () => {
    vi.mocked(salesOpsApi.updateSale).mockRejectedValueOnce({
      error: 'row_has_active_settlement',
      status: 409,
      rows: [{ kind: 'receivable', id: 'rec-2', label: '2/2' }],
    });
    await renderApp('/operacional/vendas');

    await click(menuItemIn(rowByCode('V-0001'), 'Editar'));
    expect(container.textContent).toContain('Editar proposta');

    await click(buttonIn(container, 'Avançar'));
    await changeInput(labeledInput('Valor da parcela 1'), '1600');
    await changeInput(labeledInput('Valor da parcela 2'), '1400');
    await click(buttonIn(container, 'Avançar'));
    await click(buttonIn(container, 'Avançar'));
    await click(buttonIn(container, 'Salvar proposta'));
    await flushReact();
    await flushReact();

    const alert = container.querySelector('[role="alert"]');
    expect(alert?.querySelectorAll('p')).toHaveLength(2);
    expect(alert?.textContent).toBe(
      'A parcela 2/2 tem baixa ativa.Estorne a baixa antes de mudar valor ou vencimento.',
    );
    expect(container.textContent).toContain('Editar proposta');

    expect(salesOpsApi.updateSale).toHaveBeenCalledTimes(1);
    const [calledSaleId, payload] = vi.mocked(salesOpsApi.updateSale).mock.calls[0]!;
    expect(calledSaleId).toBe(saleId);
    expect(payload.status).toBe('won');
    expect(payload.installments[1]).toEqual(
      expect.objectContaining({ id: 'rec-2', amountBrl: 140000 }),
    );

    await click(buttonIn(container, 'Voltar'));
    await click(buttonIn(container, 'Voltar'));
    expect(labeledInput('Valor da parcela 1').value).toBe('1600');
    expect(labeledInput('Valor da parcela 2').value).toBe('1400');
  });
});
