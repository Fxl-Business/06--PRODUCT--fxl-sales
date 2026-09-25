// @vitest-environment happy-dom

process.env.TZ = 'America/Sao_Paulo';

import * as React from 'react';
import type { HTMLAttributes, ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ControlledSalesView } from './controlled-sales-view';
import type { SalesOpsBootstrap, SalesOpsSale } from '../types';

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
  DropdownMenuItem: ({
    children,
    onSelect,
  }: {
    children: ReactNode;
    onSelect?: () => void;
  }) => (
    <button onClick={() => onSelect?.()} type="button">
      {children}
    </button>
  ),
}));

vi.mock('@/components/ui/alert-dialog', () => {
  const CloseCtx = React.createContext<() => void>(() => undefined);
  return {
    AlertDialog: ({
      children,
      open,
      onOpenChange,
    }: {
      children: ReactNode;
      open: boolean;
      onOpenChange?: (open: boolean) => void;
    }) =>
      open ? (
        <CloseCtx.Provider value={() => onOpenChange?.(false)}>{children}</CloseCtx.Provider>
      ) : null,
    AlertDialogContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
    AlertDialogHeader: ({ children }: { children: ReactNode }) => <div>{children}</div>,
    AlertDialogFooter: ({ children }: { children: ReactNode }) => <div>{children}</div>,
    AlertDialogTitle: ({ children }: { children: ReactNode }) => <h2>{children}</h2>,
    AlertDialogDescription: ({ children }: { children: ReactNode }) => <p>{children}</p>,
    AlertDialogAction: ({
      children,
      onClick,
    }: {
      children: ReactNode;
      onClick?: () => void;
    }) => (
      <button onClick={onClick} type="button">
        {children}
      </button>
    ),
    AlertDialogCancel: ({ children }: { children: ReactNode }) => {
      const close = React.useContext(CloseCtx);
      return (
        <button onClick={close} type="button">
          {children}
        </button>
      );
    },
  };
});

const act = (
  React as typeof React & { act: typeof import('react-dom/test-utils').act }
).act;

const areaTechId = '66666666-6666-4666-8666-666666666666';

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
    status: 'open',
    paymentMethod: 'pix',
    condition: 'installments',
    installments: 1,
    baseDate: '2026-03-01T00:00:00.000Z',
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
    createdAt: '2026-03-01T12:00:00.000Z',
    updatedAt: null,
    ...overrides,
  };
}

const wonSale = sale({
  id: 'sale-won',
  code: 'P-010',
  status: 'won',
  recurringBrl: 100000,
  wonAt: '2026-03-01T12:00:00.000Z',
  baseDate: '2026-03-01T00:00:00.000Z',
});

const allSales: SalesOpsSale[] = [wonSale];

function bootstrap(): SalesOpsBootstrap {
  return {
    sales: allSales,
    products: [],
    clients: [],
    areas: [
      {
        id: areaTechId,
        orgId: 'org-test',
        name: 'FXL Tech',
        status: 'active',
        createdAt: '2026-03-01T12:00:00.000Z',
        updatedAt: null,
      },
    ],
    funcoes: [],
    people: [],
    payables: [
      {
        id: 'payable-1',
        saleId: wonSale.id,
        beneficiaryName: 'Ana Martins',
        kind: 'seller_commission',
        dueDate: '2026-03-05T00:00:00.000Z',
        amountBrl: 12000,
        status: 'open',
      },
    ],
    saleItems: [
      {
        id: 'item-won-1',
        saleId: wonSale.id,
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
        saleId: wonSale.id,
        label: '1/2',
        dueDate: '2026-03-01T00:00:00.000Z',
        amountBrl: 150000,
        method: 'pix',
        status: 'open',
      },
      {
        id: 'rec-2',
        saleId: wonSale.id,
        label: '2/2',
        dueDate: '2026-04-01T00:00:00.000Z',
        amountBrl: 150000,
        method: 'pix',
        status: 'open',
      },
    ],
    productFuncaoCosts: [],
    saleProfessionals: [],
    settings: null,
  };
}

let container: HTMLDivElement;
let root: Root;

async function renderSalesView() {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
    .IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  const bootstrapValue = bootstrap();
  await act(async () => {
    root.render(
      <ControlledSalesView
        bootstrap={bootstrapValue}
        canManage={true}
        onCancelContract={vi.fn()}
        onEdit={vi.fn()}
        onTransition={vi.fn()}
        sales={bootstrapValue.sales}
      />,
    );
  });
}

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  document.body.querySelectorAll('[data-radix-portal]').forEach((portal) => portal.remove());
  vi.restoreAllMocks();
});

function tbody(): HTMLTableSectionElement {
  const match = container.querySelector('tbody');
  if (!(match instanceof HTMLTableSectionElement)) throw new Error('tbody not found');
  return match;
}

async function click(element: HTMLElement) {
  await act(async () => element.dispatchEvent(new MouseEvent('click', { bubbles: true })));
}

describe('sale detail renders stored civil days without a timezone slip', () => {
  beforeEach(async () => {
    await renderSalesView();
  });

  it('the process timezone is negative-offset (positive control)', () => {
    expect(new Date('2026-03-01T00:00:00.000Z').getDate()).toBe(28);
  });

  it('renders a stored UTC-midnight due date as the same civil day in a negative-offset timezone', async () => {
    const rows = [...tbody().querySelectorAll('tr')];
    const wonRow = rows.find((candidate) => candidate.textContent?.includes('P-010'));
    if (!wonRow) throw new Error('won row not found');

    await click(wonRow);

    expect(container.textContent).toContain('01/03/2026');
    expect(container.textContent).toContain('01/04/2026');
    expect(container.textContent).toContain('05/03/2026');

    expect(container.textContent).not.toContain('28/02/2026');
    expect(container.textContent).not.toContain('31/03/2026');
    expect(container.textContent).not.toContain('04/03/2026');
  });
});
