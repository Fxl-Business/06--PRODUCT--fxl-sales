// @vitest-environment happy-dom

import * as React from 'react';
import type { ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppRole } from '@/auth/claims';
import { canSettleInWorkspace, SALES_OPS_ROUTE_PATTERN } from '../navigation';
import { CommissionsView, SalesOpsApp } from '../SalesOpsApp';
import { ControlledSalesView } from './controlled-sales-view';
import type { SalesOpsBootstrap, SalesOpsSale } from '../types';

/**
 * WHO sees a settlement action, and where.
 *
 * `SalesView` and `CommissionsView` serve both `operacional` and `meus-dados`,
 * so the action is an explicit `canSettle` prop that defaults to OFF. `Pago em`
 * is a fact about the row and shows for every viewer. The sale detail runs
 * through the REAL `Dialog`; only the data hooks are mocked.
 *
 * The last block renders the REAL `SalesOpsApp` shell, so the `canSettle` wiring
 * (admin AND operacional) is pinned where the operator meets it, not only on the
 * views' props.
 */

let profileRoles: AppRole[] = [];

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
    active: { id: 'org-primary', name: 'FXL Matriz' },
    activeName: 'FXL Matriz',
    organizations: [{ id: 'org-primary', name: 'FXL Matriz' }],
    others: [],
    setActive: vi.fn(async () => undefined),
    client: { checkoutUrl: vi.fn(async () => 'https://hub.example/checkout') },
  }),
}));

const idleMutation = { isPending: false, mutate: vi.fn(), mutateAsync: vi.fn(async () => ({})) };

vi.mock('../hooks', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../hooks')>()),
  useSalesOpsBootstrap: () => ({ data: bootstrap(), isLoading: false, isError: false }),
  // The shell mounts every writer; none is exercised here.
  useCreateSalesOpsSale: () => idleMutation,
  useUpdateSalesOpsSale: () => idleMutation,
  useTransitionSalesOpsSale: () => idleMutation,
  useCancelSalesOpsContract: () => idleMutation,
  useSaveSalesOpsArea: () => idleMutation,
  useSaveSalesOpsClient: () => idleMutation,
  useSaveSalesOpsFuncao: () => idleMutation,
  useSaveSalesOpsPerson: () => idleMutation,
  useSaveSalesOpsProduct: () => idleMutation,
  useSaveSalesOpsSettings: () => idleMutation,
  useSetSalesOpsCadastroStatus: () => idleMutation,
  useRecordSalesOpsSettlement: () => ({ mutateAsync: vi.fn(async () => ({})), isPending: false }),
  useReverseSalesOpsSettlement: () => ({ mutateAsync: vi.fn(async () => ({})), isPending: false }),
  useSaleSettlements: () => ({ data: [], isLoading: false, isError: false }),
}));

vi.mock('@/components/ui/dropdown-menu', () => ({
  DropdownMenu: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DropdownMenuGroup: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DropdownMenuLabel: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DropdownMenuSeparator: () => null,
  DropdownMenuTrigger: ({ children }: { children: ReactNode }) => <>{children}</>,
  DropdownMenuContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DropdownMenuItem: ({ children, onSelect }: { children: ReactNode; onSelect?: () => void }) => (
    <button onClick={() => onSelect?.()} type="button">
      {children}
    </button>
  ),
}));

const act = (React as typeof React & { act: typeof import('react-dom/test-utils').act }).act;

const WON_SALE: SalesOpsSale = {
  id: 'sale-won',
  orgId: 'org-test',
  sequence: 1,
  code: '0001-AGN',
  clientId: null,
  clientNameSnapshot: 'SegPro',
  sellerPersonId: null,
  sellerNameSnapshot: 'Ana Martins',
  finderPersonId: null,
  finderNameSnapshot: null,
  status: 'won',
  paymentMethod: 'pix',
  condition: 'installments',
  installments: 2,
  baseDate: '2026-09-01',
  notes: null,
  wonAt: '2026-09-01T12:00:00.000Z',
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
  createdAt: '2026-09-01T12:00:00.000Z',
  updatedAt: null,
};

function bootstrap(): SalesOpsBootstrap {
  return {
    sales: [WON_SALE],
    products: [],
    clients: [],
    areas: [],
    funcoes: [],
    people: [],
    payables: [
      {
        id: 'pay-1',
        saleId: WON_SALE.id,
        beneficiaryName: 'Ana Martins',
        kind: 'seller_commission',
        dueDate: '2026-10-01T00:00:00.000Z',
        amountBrl: 12000,
        status: 'open',
        paidOn: null,
      },
      {
        id: 'pay-2',
        saleId: WON_SALE.id,
        beneficiaryName: 'Ana Martins',
        kind: 'seller_commission',
        dueDate: '2026-09-20T00:00:00.000Z',
        amountBrl: 12000,
        status: 'paid',
        paidOn: '2026-09-20',
      },
    ],
    saleItems: [],
    receivables: [
      {
        id: 'rec-1',
        saleId: WON_SALE.id,
        label: '1/2',
        dueDate: '2026-09-20T00:00:00.000Z',
        amountBrl: 150000,
        method: 'pix',
        status: 'paid',
        paidOn: '2026-09-20',
      },
      {
        id: 'rec-2',
        saleId: WON_SALE.id,
        label: '2/2',
        dueDate: '2026-10-20T00:00:00.000Z',
        amountBrl: 150000,
        method: 'pix',
        status: 'open',
        paidOn: null,
      },
    ],
    productFuncaoCosts: [],
    saleProfessionals: [],
    settings: null,
  };
}

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  (
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  document.body.querySelectorAll('[role="dialog"]').forEach((node) => node.remove());
  vi.clearAllMocks();
});

async function settle() {
  await act(async () => {
    await new Promise((resolve) => {
      setTimeout(resolve, 5);
    });
  });
}

async function click(element: Element) {
  await act(async () => {
    element.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  });
  await settle();
}

function detailDialog(): Element | null {
  return (
    [...document.querySelectorAll('[role="dialog"]')].find((node) =>
      node.textContent?.includes('Proposta 0001-AGN'),
    ) ?? null
  );
}

function actions(scope: ParentNode, name: 'mark-paid' | 'reverse' | 'history'): Element[] {
  return [...scope.querySelectorAll(`[data-settlement-action="${name}"]`)];
}

function actionNames(scope: ParentNode): string[] {
  return [...scope.querySelectorAll('[data-settlement-action]')].map(
    (node) => node.getAttribute('data-settlement-action') ?? '',
  );
}

async function renderSalesView(props: { canManage: boolean; canSettle?: boolean }) {
  await act(async () =>
    root.render(
      <ControlledSalesView
        bootstrap={bootstrap()}
        onCancelContract={vi.fn()}
        onEdit={vi.fn()}
        onTransition={vi.fn()}
        sales={[WON_SALE]}
        {...props}
      />,
    ),
  );
  await settle();
  const row = container.querySelector('tbody tr');
  if (!row) throw new Error('sale row not rendered');
  await click(row);
  const detail = detailDialog();
  if (!detail) throw new Error('sale detail not rendered');
  return detail;
}

describe('settlement visibility', () => {
  it('admin in operacional sees settlement actions in the sale detail', async () => {
    const detail = await renderSalesView({ canManage: true, canSettle: true });

    const text = detail.textContent ?? '';
    // rec-2 and pay-1 are open; rec-1 and pay-2 are paid.
    expect(actions(detail, 'mark-paid')).toHaveLength(2);
    expect(actions(detail, 'reverse')).toHaveLength(2);
    expect(text).toContain('Pago em 20/09/2026');
    expect(text).toContain('Histórico de pagamentos');
    expect(text).toContain('Ações');
    expect(text).not.toMatch(/rec-|pay-/);
  });

  it('read-only SalesView shows Pago em but no settlement action', async () => {
    const detail = await renderSalesView({ canManage: false });

    const text = detail.textContent ?? '';
    expect(text).toContain('Pago em 20/09/2026');
    expect(actionNames(detail)).toEqual([]);
    expect(text).not.toContain('Marcar como pago');
    expect(text).not.toContain('Estornar');
    expect(text).not.toContain('Histórico de pagamentos');
    expect(text).not.toContain('Ações');
  });

  it('CommissionsView without canSettle renders no settlement action', async () => {
    await act(async () => root.render(<CommissionsView bootstrap={bootstrap()} />));

    expect(container.textContent).toContain('Pago em 20/09/2026');
    expect(actionNames(container)).toEqual([]);
    expect(container.textContent).not.toContain('Ações');
  });

  it('CommissionsView with canSettle offers Marcar como pago and Histórico', async () => {
    await act(async () => root.render(<CommissionsView bootstrap={bootstrap()} canSettle />));

    expect(actions(container, 'mark-paid')).toHaveLength(1);
    expect(actions(container, 'reverse')).toHaveLength(1);
    expect(actions(container, 'history')).toHaveLength(2);
    expect(container.textContent).toContain('Ações');

    await click(actions(container, 'history')[0] as Element);
    const dialog = document.querySelector('[role="dialog"]');
    expect(dialog?.textContent).toContain('Histórico de pagamentos');
    expect(dialog?.textContent).toContain(
      'Comissão do vendedor · Ana Martins · vencimento 20/09/2026 · Proposta 0001-AGN',
    );
  });

  it('keeps same-day parcelas in label order whatever the bootstrap order', async () => {
    const data = bootstrap();
    const sameDay = '2026-10-20T00:00:00.000Z';
    const open = data.receivables[1]!;
    data.receivables = [
      { ...open, id: 'rec-a', label: 'M1/12', dueDate: sameDay, amountBrl: 100000 },
      { ...open, id: 'rec-z', label: '2/2', dueDate: sameDay, amountBrl: 150000 },
    ];
    await act(async () =>
      root.render(
        <ControlledSalesView
          bootstrap={data}
          canManage={false}
          onCancelContract={vi.fn()}
          onEdit={vi.fn()}
          onTransition={vi.fn()}
          sales={[WON_SALE]}
        />,
      ),
    );
    await settle();
    await click(container.querySelector('tbody tr') as Element);

    const plan = [...(detailDialog()?.querySelectorAll('table') ?? [])][1];
    const amounts = [...(plan?.querySelectorAll('tbody tr') ?? [])].map((row) =>
      (row.querySelectorAll('td')[2]?.textContent ?? '').replace(/\u00a0/g, ' '),
    );
    expect(amounts).toEqual(['R$ 1.500', 'R$ 1.000']);
  });

  it('renders payables in one write-independent order in the sale detail and in comissoes', async () => {
    const payable = (
      id: string,
      kind: string,
      beneficiaryName: string,
      dueDate: string,
    ): SalesOpsBootstrap['payables'][number] => ({
      id,
      saleId: WON_SALE.id,
      beneficiaryName,
      kind,
      dueDate,
      amountBrl: 1000,
      status: 'open',
      paidOn: null,
    });
    const rows = [
      payable('pay-a', 'seller_commission', 'Ana Martins', '2026-10-01T00:00:00.000Z'),
      payable('pay-b', 'finder_commission', 'Caio Indica', '2026-10-01T00:00:00.000Z'),
      payable('pay-c', 'tax', 'Impostos', '2026-10-01T00:00:00.000Z'),
      payable('pay-d', 'seller_commission', 'Ana Martins', '2026-11-01T00:00:00.000Z'),
      payable('pay-e', 'other_cost', 'Outros custos', '2026-09-01T00:00:00.000Z'),
    ];
    const expected = [
      'Outros custos 01/09/2026',
      'Ana Martins 01/10/2026',
      'Caio Indica 01/10/2026',
      'Impostos 01/10/2026',
      'Ana Martins 01/11/2026',
    ];
    // As the API hands them back: shuffled, and after a baixa UPDATE moved the
    // settled row's tuple to the end of the heap.
    const shuffled = [rows[3]!, rows[0]!, rows[4]!, rows[2]!, rows[1]!];
    const afterSettlement = [
      rows[1]!,
      rows[2]!,
      rows[3]!,
      rows[4]!,
      { ...rows[0]!, status: 'paid' as const, paidOn: '2026-09-25' },
    ];

    function rowKeys(table: Element | null | undefined, dateCell: number): string[] {
      return [...(table?.querySelectorAll('tbody tr') ?? [])].map((row) => {
        const cells = row.querySelectorAll('td');
        return `${cells[0]?.textContent ?? ''} ${cells[dateCell]?.textContent ?? ''}`;
      });
    }

    for (const order of [shuffled, afterSettlement]) {
      const data = { ...bootstrap(), payables: order };

      await act(async () => root.render(<CommissionsView bootstrap={data} canSettle />));
      expect(rowKeys(container.querySelector('table'), 3)).toEqual(expected);

      await act(async () =>
        root.render(
          <ControlledSalesView
            bootstrap={data}
            canManage
            canSettle
            onCancelContract={vi.fn()}
            onEdit={vi.fn()}
            onTransition={vi.fn()}
            sales={[WON_SALE]}
          />,
        ),
      );
      await settle();
      await click(container.querySelector('tbody tr') as Element);
      const tables = [...(detailDialog()?.querySelectorAll('table') ?? [])];
      expect(rowKeys(tables[2], 2)).toEqual(expected);

      await act(async () => root.unmount());
      document.body.querySelectorAll('[role="dialog"]').forEach((node) => node.remove());
      root = createRoot(container);
    }
  });

  it('widens the detail only when the Ações column is present', async () => {
    const settling = await renderSalesView({ canManage: true, canSettle: true });
    expect(settling.className).toContain('max-w-[820px]');
    await act(async () => root.unmount());
    root = createRoot(container);

    const readOnly = await renderSalesView({ canManage: false });
    expect(readOnly.className).toContain('max-w-[760px]');
  });

  it('a click on a row action does not reopen or close the sale detail', async () => {
    const detail = await renderSalesView({ canManage: true, canSettle: true });

    await click(actions(detail, 'mark-paid')[0] as Element);

    expect(detailDialog()).not.toBeNull();
    const markPaid = [...document.querySelectorAll('[role="dialog"]')].find((node) =>
      node.textContent?.includes('Confirmar pagamento'),
    );
    expect(markPaid).toBeDefined();

    const cancel = [...(markPaid?.querySelectorAll('button') ?? [])].find(
      (node) => node.textContent?.trim() === 'Cancelar',
    );
    await click(cancel as Element);

    expect(detailDialog()).not.toBeNull();
    expect(
      [...document.querySelectorAll('[role="dialog"]')].some((node) =>
        node.textContent?.includes('Confirmar pagamento'),
      ),
    ).toBe(false);
  });
});

describe('settlement visibility in the SalesOpsApp shell', () => {
  const team: AppRole[] = ['admin', 'seller', 'finder'];
  const sellerOnly: AppRole[] = ['seller', 'finder'];

  async function renderShell(path: string, roles: AppRole[]) {
    profileRoles = [...roles];
    await act(async () =>
      root.render(
        <MemoryRouter
          future={{ v7_relativeSplatPath: true, v7_startTransition: true }}
          initialEntries={[path]}
        >
          <Routes>
            <Route element={<SalesOpsApp />} path={SALES_OPS_ROUTE_PATTERN} />
          </Routes>
        </MemoryRouter>,
      ),
    );
    await settle();
  }

  function commissionsTotalLabel(): boolean {
    return (container.textContent ?? '').includes('Total pago no mês');
  }

  it('an admin in operacional/comissoes sees Marcar como pago', async () => {
    await renderShell('/operacional/comissoes', team);

    expect(commissionsTotalLabel()).toBe(true);
    // pay-1 is open, pay-2 is paid.
    expect(actions(container, 'mark-paid')).toHaveLength(1);
    expect(actions(container, 'reverse')).toHaveLength(1);
  });

  it('the same admin in meus-dados/comissoes sees no settlement action', async () => {
    await renderShell('/meus-dados/comissoes', team);

    expect(commissionsTotalLabel()).toBe(true);
    expect(container.textContent).toContain('Pago em 20/09/2026');
    expect(actionNames(container)).toEqual([]);
  });

  it('a seller-only profile sees no settlement action', async () => {
    await renderShell('/meus-dados/comissoes', sellerOnly);

    expect(commissionsTotalLabel()).toBe(true);
    expect(container.textContent).toContain('Pago em 20/09/2026');
    expect(actionNames(container)).toEqual([]);
  });

  /*
    Through the shell a non-admin can never stand in `operacional`: the route
    resolution sends them to their own workspace first. The admin term is pinned
    on the predicate itself, the one place the shell reads it from.
  */
  it('canSettleInWorkspace needs both the admin role and the operacional workspace', () => {
    expect(canSettleInWorkspace('operacional', team)).toBe(true);
    expect(canSettleInWorkspace('operacional', ['admin'])).toBe(true);
    expect(canSettleInWorkspace('operacional', sellerOnly)).toBe(false);
    expect(canSettleInWorkspace('operacional', [])).toBe(false);
    expect(canSettleInWorkspace('meus-dados', team)).toBe(false);
    expect(canSettleInWorkspace('tatico', team)).toBe(false);
    expect(canSettleInWorkspace('cadastros', team)).toBe(false);
  });
});
