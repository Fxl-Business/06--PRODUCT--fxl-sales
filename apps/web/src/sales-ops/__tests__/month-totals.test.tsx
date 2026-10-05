// @vitest-environment happy-dom

/**
 * "Total pago no mês" (comissoes) and "Receita ganha no mês" (dashboard) count
 * only the America/Sao_Paulo civil month of today: payments by `paidOn`, won
 * revenue by the Sao Paulo day of `wonAt`. The clock is fixed with
 * `vi.setSystemTime` and the REAL `SalesOpsApp` shell renders the cards, so the
 * test proves the callers pass `todayInSaoPaulo()` and not a UTC day.
 */

import * as React from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppRole } from '@/auth/claims';
import { SALES_OPS_ROUTE_PATTERN } from '../navigation';
import { SalesOpsApp } from '../SalesOpsApp';
import type { SalesOpsBootstrap, SalesOpsPayable, SalesOpsSale } from '../types';

const act = (React as typeof React & { act: typeof import('react-dom/test-utils').act }).act;

const team: AppRole[] = ['admin', 'seller', 'finder'];
const primaryOrganization = { id: 'org-primary', name: 'FXL Matriz' };

vi.mock('@/auth/react', () => ({
  useAuthProfile: () => ({
    isLoaded: true,
    isSignedIn: true,
    roles: team,
    name: 'Test User',
    email: 'test.user@fxl.example',
  }),
  useLogout: () => vi.fn(async () => undefined),
  useOrganizations: () => ({
    active: primaryOrganization,
    activeName: primaryOrganization.name,
    organizations: [primaryOrganization],
    others: [],
    setActive: vi.fn(async () => undefined),
    client: { checkoutUrl: vi.fn(async () => 'https://hub.example/checkout') },
  }),
  useSalesEdition: () => 'full',
}));

function sale(overrides: Partial<SalesOpsSale> & { id: string; code: string }): SalesOpsSale {
  return {
    orgId: 'org-test',
    sequence: 1,
    clientId: null,
    clientNameSnapshot: 'SegPro',
    sellerPersonId: null,
    sellerNameSnapshot: 'Ana Martins',
    finderPersonId: null,
    finderNameSnapshot: null,
    status: 'won',
    paymentMethod: 'pix',
    condition: 'installments',
    installments: 1,
    baseDate: '2026-08-01',
    notes: null,
    wonAt: null,
    lostAt: null,
    totalBrl: 0,
    recurringBrl: 0,
    sellerCommissionPct: '8',
    finderCommissionPct: '0',
    taxPct: '6',
    otherCostsBrl: 0,
    professionalCostsBrl: 0,
    sellerCommissionBrl: 0,
    finderCommissionBrl: 0,
    taxBrl: 0,
    netMarginBrl: 0,
    netMarginPct: '0',
    createdAt: '2026-08-01T12:00:00.000Z',
    updatedAt: null,
    ...overrides,
  };
}

function payable(overrides: Partial<SalesOpsPayable> & { id: string }): SalesOpsPayable {
  return {
    saleId: 'sale-sep',
    beneficiaryName: 'Ana Martins',
    kind: 'seller_commission',
    dueDate: '2026-09-10T00:00:00.000Z',
    amountBrl: 0,
    status: 'paid',
    paidOn: null,
    ...overrides,
  };
}

function bootstrapFixture(): SalesOpsBootstrap {
  return {
    sales: [
      // 2026-09-01 00:00 in Sao Paulo: this month.
      sale({ id: 'sale-sep', code: 'P-001', totalBrl: 1_000_000, wonAt: '2026-09-01T03:00:00Z' }),
      // 2026-08-31 23:00 in Sao Paulo: last month, although its UTC day is September 1.
      sale({ id: 'sale-aug', code: 'P-002', totalBrl: 7_000_000, wonAt: '2026-09-01T02:00:00Z' }),
    ],
    products: [],
    clients: [],
    areas: [],
    funcoes: [],
    people: [],
    payables: [
      payable({ id: 'paid-sep', amountBrl: 250_000, paidOn: '2026-09-02' }),
      // Due this month but paid in August: not paid "no mês".
      payable({ id: 'paid-aug', amountBrl: 900_000, paidOn: '2026-08-31' }),
      payable({ id: 'open-sep', amountBrl: 40_000, status: 'open' }),
    ],
    saleItems: [],
    receivables: [],
    productFuncaoCosts: [],
    saleProfessionals: [],
    settings: null,
  };
}

const mutation = {
  isPending: false,
  mutate: vi.fn(),
  mutateAsync: vi.fn(async () => ({})),
};

vi.mock('../hooks', () => ({
  useSalesOpsBootstrap: () => ({ data: bootstrapFixture(), isLoading: false, isError: false }),
  useSaleSettlements: () => ({ data: [], isLoading: false, isError: false, error: null }),
  useRecordSalesOpsSettlement: () => mutation,
  useReverseSalesOpsSettlement: () => mutation,
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

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  (
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  // Only Date is faked, so React's scheduler keeps its real timers.
  vi.useFakeTimers({ toFake: ['Date'] });
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.useRealTimers();
  vi.clearAllMocks();
});

async function renderAt(path: string) {
  // A fresh root per entry: MemoryRouter reads `initialEntries` only on mount.
  await act(async () => root.unmount());
  root = createRoot(container);
  await act(async () => {
    root.render(
      <MemoryRouter
        future={{ v7_relativeSplatPath: true, v7_startTransition: true }}
        initialEntries={[path]}
      >
        <Routes>
          <Route element={<SalesOpsApp />} path={SALES_OPS_ROUTE_PATTERN} />
        </Routes>
      </MemoryRouter>,
    );
  });
  await act(async () => Promise.resolve());
}

function cardLabel(label: string): Element {
  const labelNode = [...container.querySelectorAll('div')].find(
    (node) => node.children.length === 0 && node.textContent === label,
  );
  if (!labelNode) throw new Error(`metric card not rendered: ${label}`);
  return labelNode;
}

/** The value line of the metric card whose label is exactly `label`. */
function cardValue(label: string): string {
  return (cardLabel(label).nextElementSibling?.textContent ?? '').replace(/\u00a0/g, ' ');
}

/** The subtitle line of the metric card whose label is exactly `label`. */
function cardSub(label: string): string {
  return cardLabel(label).nextElementSibling?.nextElementSibling?.textContent ?? '';
}

describe('month totals follow the São Paulo month', () => {
  it('comissoes "Total pago no mês" sums only baixas whose paidOn is this month', async () => {
    vi.setSystemTime(new Date('2026-09-25T15:00:00Z'));
    await renderAt('/operacional/comissoes');

    expect(cardValue('Total pago no mês')).toBe('R$ 2.500');
    expect(cardValue('Total a pagar')).toBe('R$ 400');
  });

  it('uses the São Paulo day, not the UTC day, to pick the month', async () => {
    // 2026-10-01 01:00 UTC is still 2026-09-30 in Sao Paulo.
    vi.setSystemTime(new Date('2026-10-01T01:00:00Z'));
    await renderAt('/operacional/comissoes');
    expect(cardValue('Total pago no mês')).toBe('R$ 2.500');
  });

  it('meus-dados/comissoes shows the same month total', async () => {
    vi.setSystemTime(new Date('2026-09-25T15:00:00Z'));
    await renderAt('/meus-dados/comissoes');
    expect(cardValue('Total pago no mês')).toBe('R$ 2.500');
  });

  it('dashboard "Receita ganha no mês" sums only propostas won this São Paulo month', async () => {
    vi.setSystemTime(new Date('2026-09-25T15:00:00Z'));
    await renderAt('/tatico/dashboard');

    expect(cardValue('Receita ganha no mês')).toBe('R$ 10.000');
    // The month card's subtitle counts the same propostas its value sums.
    expect(cardSub('Receita ganha no mês')).toBe('1 proposta ganha');
    // Labels without "no mês" keep their all-time meaning.
    expect(cardValue('Propostas ganhas')).toBe('2');
  });

  it('the dashboard also picks the month by the São Paulo day, not the UTC day', async () => {
    // 2026-10-01 01:00 UTC is still 2026-09-30 in Sao Paulo.
    vi.setSystemTime(new Date('2026-10-01T01:00:00Z'));
    await renderAt('/tatico/dashboard');
    expect(cardValue('Receita ganha no mês')).toBe('R$ 10.000');
  });

  it('a new month starts from zero', async () => {
    vi.setSystemTime(new Date('2026-10-15T15:00:00Z'));
    await renderAt('/tatico/dashboard');
    expect(cardValue('Receita ganha no mês')).toBe('R$ 0');
    expect(cardSub('Receita ganha no mês')).toBe('0 propostas ganhas');

    await renderAt('/operacional/comissoes');
    expect(cardValue('Total pago no mês')).toBe('R$ 0');
  });
});
