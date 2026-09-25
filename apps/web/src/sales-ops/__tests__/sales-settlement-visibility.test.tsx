// @vitest-environment happy-dom

import * as React from 'react';
import type { ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CommissionsView, SalesView } from '../SalesOpsApp';
import type { SalesOpsBootstrap, SalesOpsSale } from '../types';

/**
 * WHO sees a settlement action, and where.
 *
 * `SalesView` and `CommissionsView` serve both `operacional` and `meus-dados`,
 * so the action is an explicit `canSettle` prop that defaults to OFF. `Pago em`
 * is a fact about the row and shows for every viewer. The sale detail runs
 * through the REAL `Dialog`; only the data hooks are mocked.
 */

vi.mock('../hooks', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../hooks')>()),
  useRecordSalesOpsSettlement: () => ({ mutateAsync: vi.fn(async () => ({})), isPending: false }),
  useReverseSalesOpsSettlement: () => ({ mutateAsync: vi.fn(async () => ({})), isPending: false }),
  useSaleSettlements: () => ({ data: [], isLoading: false, isError: false }),
}));

vi.mock('@/components/ui/dropdown-menu', () => ({
  DropdownMenu: ({ children }: { children: ReactNode }) => <div>{children}</div>,
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
      <SalesView
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
    expect(dialog?.textContent).toContain('Comissão do vendedor · Ana Martins · Proposta 0001-AGN');
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
        <SalesView
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
