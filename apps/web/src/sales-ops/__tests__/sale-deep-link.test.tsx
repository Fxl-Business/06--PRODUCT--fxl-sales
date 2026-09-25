// @vitest-environment happy-dom

/**
 * The proposta detail is URL state: `/:workspace/vendas/:saleId` opens it with no
 * click, a row click pushes it, and closing pops (in-app) or replaces (cold entry)
 * so Back never reopens a closed detail. The REAL Radix dialog is used on purpose:
 * its `Fechar` button is the close affordance an operator actually clicks.
 */

import * as React from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppRole } from '@/auth/claims';
import { SALES_OPS_ROUTE_PATTERN } from '../navigation';
import { SalesOpsApp } from '../SalesOpsApp';
import type { SalesOpsBootstrap, SalesOpsFuncao, SalesOpsSale } from '../types';

const act = (
  React as typeof React & { act: typeof import('react-dom/test-utils').act }
).act;

const SALE_ID = '5b0e7c1e-3f4a-4c2d-9e8b-1a2b3c4d5e6f';
const OTHER_UUID = '9d8c7b6a-5f4e-4d3c-8b2a-1f0e9d8c7b6a';
const team: AppRole[] = ['admin', 'seller', 'finder'];

let profileRoles: AppRole[] = [];

const hubClient = { checkoutUrl: vi.fn(async () => 'https://hub.example/checkout') };
const primaryOrganization = { id: 'org-primary', name: 'FXL Matriz' };

vi.mock('@/auth/react', () => ({
  useAuthProfile: () => ({
    isLoaded: true,
    isSignedIn: true,
    roles: profileRoles,
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
    client: hubClient,
  }),
}));

const funcaoVendedor: SalesOpsFuncao = {
  id: 'fc000001-0000-4000-8000-000000000001',
  orgId: '22222222-2222-4222-8222-222222222222',
  name: 'Vendedor',
  slug: 'vendedor',
  isSystem: true,
  status: 'active',
  createdAt: '2026-07-01T00:00:00.000Z',
  updatedAt: null,
};
const funcaoFinder: SalesOpsFuncao = {
  ...funcaoVendedor,
  id: 'fc000002-0000-4000-8000-000000000002',
  name: 'Finder',
  slug: 'finder',
};

const personFixture = {
  id: '11111111-1111-4111-8111-111111111111',
  orgId: '22222222-2222-4222-8222-222222222222',
  displayName: 'Alex Silva',
  contactEmail: 'alex.silva@fxl.example',
  status: 'active' as const,
  funcaoIds: [funcaoVendedor.id, funcaoFinder.id],
  funcoes: [funcaoVendedor, funcaoFinder],
  createdAt: '2026-07-01T00:00:00.000Z',
  updatedAt: null,
};

const areaTechId = '66666666-6666-4666-8666-666666666666';

function sale(overrides: Partial<SalesOpsSale> & { id: string; code: string }): SalesOpsSale {
  return {
    orgId: 'org-test',
    sequence: 3,
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

const wonSale = sale({
  id: SALE_ID,
  code: 'P-003',
  status: 'won',
  wonAt: '2026-07-11T12:00:00.000Z',
});

function bootstrapFixture(): SalesOpsBootstrap {
  return {
    sales: [wonSale],
    products: [],
    clients: [],
    areas: [
      {
        id: areaTechId,
        orgId: 'org-test',
        name: 'FXL Tech',
        status: 'active',
        createdAt: '2026-07-10T12:00:00.000Z',
        updatedAt: null,
      },
    ],
    funcoes: [funcaoVendedor, funcaoFinder],
    people: [personFixture],
    payables: [],
    saleItems: [
      {
        id: 'item-won-1',
        saleId: SALE_ID,
        productId: null,
        productNameSnapshot: 'FXL Finance',
        productTypeSnapshot: 'SaaS',
        quantity: 1,
        unitBrl: 300000,
        subtotalBrl: 300000,
        areaId: areaTechId,
        areaNameSnapshot: 'FXL Tech',
      },
    ],
    receivables: [
      {
        id: 'rec-1',
        saleId: SALE_ID,
        label: '1/1',
        dueDate: '2026-07-10',
        amountBrl: 300000,
        method: 'pix',
        status: 'open',
      },
    ],
    productFuncaoCosts: [],
    saleProfessionals: [],
    settings: null,
  };
}

let bootstrapData: SalesOpsBootstrap = bootstrapFixture();

const mutation = {
  isPending: false,
  mutate: vi.fn(),
  mutateAsync: vi.fn(async () => ({})),
};

vi.mock('../hooks', () => ({
  useSalesOpsBootstrap: () => ({ data: bootstrapData, isLoading: false, isError: false }),
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

/*
  The board's own data layer is not under test here: a stand-in renders the converted
  card's proposta link and calls the handler `SalesOpsApp` passes, exactly as `LeadCard`
  does (`leads-board-dropzones.test.tsx` pins the card half of that wire).
*/
vi.mock('../leads/LeadsBoardContainer', () => ({
  LeadsBoardContainer: ({ onOpenSale }: { onOpenSale?: (saleId: string) => void }) => (
    <button onClick={() => onOpenSale?.(SALE_ID)} type="button">
      Abrir a proposta P-003
    </button>
  ),
}));

function LocationProbe() {
  const location = useLocation();
  const navigate = useNavigate();
  return (
    <div>
      <output data-testid="location-path">{location.pathname}</output>
      <button onClick={() => navigate(-1)} type="button">
        Back
      </button>
      <button onClick={() => navigate(1)} type="button">
        Forward
      </button>
    </div>
  );
}

let container: HTMLDivElement;
let root: Root | null;

beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
    .IS_REACT_ACT_ENVIRONMENT = true;
  bootstrapData = bootstrapFixture();
  container = document.createElement('div');
  document.body.append(container);
  root = null;
});

afterEach(async () => {
  if (root) {
    await act(async () => root?.unmount());
  }
  container.remove();
  document.body.querySelectorAll('[data-radix-portal]').forEach((portal) => portal.remove());
  vi.clearAllMocks();
});

async function flushReact() {
  await act(async () => Promise.resolve());
}

async function renderHistory(entries: string[], roles: AppRole[]) {
  if (root) {
    await act(async () => root?.unmount());
  }
  profileRoles = [...roles];
  root = createRoot(container);
  await act(async () => {
    root?.render(
      <MemoryRouter
        future={{ v7_relativeSplatPath: true, v7_startTransition: true }}
        initialEntries={entries}
        initialIndex={entries.length - 1}
      >
        <Routes>
          <Route element={<SalesOpsApp />} path="/" />
          <Route element={<SalesOpsApp />} path={SALES_OPS_ROUTE_PATTERN} />
        </Routes>
        <LocationProbe />
      </MemoryRouter>,
    );
  });
  await flushReact();
}

function pathname() {
  return container.querySelector('[data-testid="location-path"]')?.textContent;
}

function bodyText() {
  return document.body.textContent ?? '';
}

/** Everything the operator sees: the body minus the test's own location probe. */
function operatorText() {
  const clone = document.body.cloneNode(true) as HTMLElement;
  clone.querySelector('[data-testid="location-path"]')?.remove();
  return clone.textContent ?? '';
}

function buttonIn(scope: ParentNode, label: string): HTMLButtonElement {
  const match = [...scope.querySelectorAll('button')].find(
    (candidate) => candidate.textContent?.trim() === label,
  );
  if (!(match instanceof HTMLButtonElement)) throw new Error(`button not found: ${label}`);
  return match;
}

async function click(element: HTMLElement) {
  await act(async () => {
    element.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
  await flushReact();
}

function saleRow(code: string): HTMLTableRowElement {
  const row = [...container.querySelectorAll('tbody tr')].find((candidate) =>
    candidate.textContent?.includes(code),
  );
  if (!(row instanceof HTMLTableRowElement)) throw new Error(`row not found: ${code}`);
  return row;
}

describe('proposta deep link', () => {
  it('opens the proposta named by the URL without a click', async () => {
    await renderHistory([`/operacional/vendas/${SALE_ID}`], team);

    expect(pathname()).toBe(`/operacional/vendas/${SALE_ID}`);
    expect(container.querySelector('h1')?.textContent?.trim()).toBe('Propostas');
    expect(bodyText()).toContain('Proposta P-003');
    expect(bodyText()).toContain('Plano de pagamento');
  });

  it('pushes the detail on a row click and pops it on close', async () => {
    await renderHistory(['/tatico/dashboard', '/operacional/vendas'], team);
    expect(bodyText()).not.toContain('Proposta P-003');

    await click(saleRow('P-003'));
    expect(pathname()).toBe(`/operacional/vendas/${SALE_ID}`);
    expect(bodyText()).toContain('Proposta P-003');

    await click(buttonIn(document.body, 'Fechar'));
    expect(pathname()).toBe('/operacional/vendas');
    expect(bodyText()).not.toContain('Proposta P-003');

    // A push-on-close would leave the detail one Back away.
    await click(buttonIn(container, 'Back'));
    expect(pathname()).toBe('/tatico/dashboard');
    expect(bodyText()).not.toContain('Proposta P-003');
  });

  it('replaces the deep link with the list when a cold-entered detail closes', async () => {
    await renderHistory(['/tatico/dashboard', `/operacional/vendas/${SALE_ID}`], team);
    expect(bodyText()).toContain('Proposta P-003');

    await click(buttonIn(document.body, 'Fechar'));
    expect(pathname()).toBe('/operacional/vendas');
    expect(bodyText()).not.toContain('Proposta P-003');

    await click(buttonIn(container, 'Back'));
    expect(pathname()).toBe('/tatico/dashboard');
    expect(bodyText()).not.toContain('Proposta P-003');
  });

  it('shows Proposta não encontrada for an unknown or other-organization id', async () => {
    await renderHistory([`/operacional/vendas/${OTHER_UUID}`], team);

    expect(pathname()).toBe(`/operacional/vendas/${OTHER_UUID}`);
    expect(bodyText()).toContain('Proposta não encontrada');
    expect(operatorText()).not.toContain(OTHER_UUID);

    await click(buttonIn(document.body, 'Voltar para a lista'));
    expect(pathname()).toBe('/operacional/vendas');
    expect(bodyText()).not.toContain('Proposta não encontrada');
  });

  it('follows the visibility rules for an operator without Operacional', async () => {
    await renderHistory([`/operacional/vendas/${SALE_ID}`], ['finder']);
    expect(pathname()).toBe('/meus-dados/finders');
    expect(bodyText()).not.toContain('Proposta P-003');

    await renderHistory([`/operacional/vendas/${SALE_ID}`], ['seller']);
    expect(pathname()).toBe('/meus-dados/vendedores');
    expect(bodyText()).not.toContain('Proposta P-003');
  });

  it('drops the id on a page that is not the propostas list', async () => {
    await renderHistory([`/operacional/comissoes/${SALE_ID}`], team);
    expect(pathname()).toBe('/operacional/comissoes');
    expect(bodyText()).not.toContain('Proposta P-003');
  });

  it('opens the read-only detail from the finder Indicações link as well', async () => {
    await renderHistory([`/meus-dados/vendas/${SALE_ID}`], ['finder']);
    expect(pathname()).toBe(`/meus-dados/vendas/${SALE_ID}`);
    expect(bodyText()).toContain('Proposta P-003');
  });

  it('opens the proposta from a converted lead card and returns to the board on close', async () => {
    await renderHistory(['/operacional/leads'], team);

    await click(buttonIn(container, 'Abrir a proposta P-003'));
    expect(pathname()).toBe(`/operacional/vendas/${SALE_ID}`);
    expect(bodyText()).toContain('Proposta P-003');

    await click(buttonIn(document.body, 'Fechar'));
    expect(pathname()).toBe('/operacional/leads');
    expect(bodyText()).not.toContain('Proposta P-003');
  });
});
