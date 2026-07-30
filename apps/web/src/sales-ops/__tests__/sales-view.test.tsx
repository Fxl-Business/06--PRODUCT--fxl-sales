// @vitest-environment happy-dom

import * as React from 'react';
import type { HTMLAttributes, ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SalesView } from '../SalesOpsApp';
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
const areaAdvisorId = '77777777-7777-4777-8777-777777777777';

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

const draftSale = sale({ id: 'sale-draft', code: 'P-001', status: 'draft' });
const openSale = sale({ id: 'sale-open', code: 'P-002', status: 'open' });
const wonSale = sale({
  id: 'sale-won',
  code: 'P-003',
  status: 'won',
  recurringBrl: 100000,
  wonAt: '2026-07-11T12:00:00.000Z',
});
const lostSale = sale({ id: 'sale-lost', code: 'P-004', status: 'lost', lostAt: '2026-07-12T12:00:00.000Z' });
const cancelledSale = sale({ id: 'sale-cancelled', code: 'P-005', status: 'cancelled' });

const allSales: SalesOpsSale[] = [draftSale, openSale, wonSale, lostSale, cancelledSale];

function bootstrap(overrides: Partial<SalesOpsBootstrap> = {}): SalesOpsBootstrap {
  return {
    sales: allSales,
    products: [],
    clients: [],
    areas: [
      { id: areaTechId, orgId: 'org-test', name: 'FXL Tech', status: 'active', createdAt: '2026-07-10T12:00:00.000Z', updatedAt: null },
      { id: areaAdvisorId, orgId: 'org-test', name: 'FXL Advisor', status: 'active', createdAt: '2026-07-10T12:00:00.000Z', updatedAt: null },
    ],
    funcoes: [],
    people: [],
    payables: [
      {
        id: 'payable-1',
        saleId: wonSale.id,
        beneficiaryName: 'Ana Martins',
        kind: 'seller_commission',
        dueDate: '2026-07-15',
        amountBrl: 24000,
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
        unitBrl: 200000,
        subtotalBrl: 200000,
        areaId: areaTechId,
        areaNameSnapshot: 'FXL Tech',
      },
      {
        id: 'item-won-2',
        saleId: wonSale.id,
        productId: null,
        productNameSnapshot: 'Consultoria',
        productTypeSnapshot: '',
        quantity: 1,
        unitBrl: 100000,
        subtotalBrl: 100000,
        areaId: areaAdvisorId,
        areaNameSnapshot: 'FXL Advisor',
      },
    ],
    receivables: [
      { id: 'rec-1', saleId: wonSale.id, label: '1/2', dueDate: '2026-07-10', amountBrl: 150000, method: 'pix', status: 'paid' },
      { id: 'rec-2', saleId: wonSale.id, label: '2/2', dueDate: '2026-08-10', amountBrl: 150000, method: 'boleto', status: 'open' },
    ],
    saleProfessionals: [],
    settings: null,
    ...overrides,
  };
}

let container: HTMLDivElement;
let root: Root;

async function renderSalesView(props: {
  bootstrapOverride?: SalesOpsBootstrap;
  sales?: SalesOpsSale[];
  canManage?: boolean;
}) {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
    .IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  const bootstrapValue = props.bootstrapOverride ?? bootstrap();
  await act(async () => {
    root.render(
      <SalesView
        bootstrap={bootstrapValue}
        canManage={props.canManage ?? true}
        onCancelContract={vi.fn()}
        onEdit={vi.fn()}
        onTransition={vi.fn()}
        sales={props.sales ?? bootstrapValue.sales}
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

function textOccurrencesIn(root: Element, text: string): number {
  return root.textContent?.split(text).length - 1 || 0;
}

async function click(element: HTMLElement) {
  await act(async () => element.dispatchEvent(new MouseEvent('click', { bubbles: true })));
}

describe('SalesView', () => {
  beforeEach(async () => {
    await renderSalesView({});
  });

  it('renders the propostas columns and one chip per status', () => {
    const headerCells = [...container.querySelectorAll('thead th')].map((cell) =>
      cell.textContent?.trim(),
    );
    expect(headerCells).toEqual([
      'Código',
      'Cliente',
      'Vendedor',
      'Áreas',
      'Total',
      'Status',
      'Data',
      'Ações',
    ]);

    const body = tbody();
    expect(textOccurrencesIn(body, 'Rascunho')).toBe(1);
    expect(textOccurrencesIn(body, 'Aberta')).toBe(1);
    expect(textOccurrencesIn(body, 'Ganha')).toBe(1);
    expect(textOccurrencesIn(body, 'Perdida')).toBe(1);
    expect(textOccurrencesIn(body, 'Cancelada')).toBe(1);
  });

  it('shows the joined área names per row', () => {
    const rows = [...tbody().querySelectorAll('tr')];
    const row = rows.find((candidate) => candidate.textContent?.includes('P-003'));
    expect(row?.textContent).toContain('FXL Tech, FXL Advisor');
  });

  it('opens the read-only detail on row click in read-only mode', async () => {
    const rows = [...tbody().querySelectorAll('tr')];
    const wonRow = rows.find((candidate) => candidate.textContent?.includes('P-003'));
    if (!wonRow) throw new Error('won row not found');

    await click(wonRow);

    expect(container.textContent).toContain('Plano de pagamento');
    expect(container.textContent).toContain('10/07/2026');
    expect(container.textContent).toContain('10/08/2026');
    expect(container.textContent).toContain('Contas a pagar');
    expect(container.textContent).toContain('Margem líquida');
  });
});

describe('SalesView read-only mode', () => {
  it('hides all row actions when canManage is false', async () => {
    await renderSalesView({ canManage: false });
    expect(container.querySelector('button[aria-label^="Ações da proposta"]')).toBeNull();
    expect(container.textContent).not.toContain('Marcar como ganha');
  });
});
