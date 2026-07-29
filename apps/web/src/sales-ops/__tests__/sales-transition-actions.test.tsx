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
const wonRecurringSale = sale({
  id: 'sale-won-recurring',
  code: 'P-003',
  status: 'won',
  recurringBrl: 100000,
  wonAt: '2026-07-11T12:00:00.000Z',
});
const wonFlatSale = sale({
  id: 'sale-won-flat',
  code: 'P-006',
  status: 'won',
  recurringBrl: 0,
  wonAt: '2026-07-11T12:00:00.000Z',
});
const lostSale = sale({ id: 'sale-lost', code: 'P-004', status: 'lost', lostAt: '2026-07-12T12:00:00.000Z' });
const cancelledSale = sale({ id: 'sale-cancelled', code: 'P-005', status: 'cancelled' });

const allSales: SalesOpsSale[] = [
  draftSale,
  openSale,
  wonRecurringSale,
  wonFlatSale,
  lostSale,
  cancelledSale,
];

function bootstrap(): SalesOpsBootstrap {
  return {
    sales: allSales,
    products: [],
    clients: [],
    areas: [],
    people: [],
    payables: [],
    saleItems: [],
    receivables: [],
    saleProfessionals: [],
    settings: null,
  };
}

let container: HTMLDivElement;
let root: Root;
let onEdit: ReturnType<typeof vi.fn>;
let onTransition: ReturnType<typeof vi.fn>;
let onCancelContract: ReturnType<typeof vi.fn>;

beforeEach(async () => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
    .IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  onEdit = vi.fn();
  onTransition = vi.fn();
  onCancelContract = vi.fn();
  await act(async () => {
    root.render(
      <SalesView
        bootstrap={bootstrap()}
        canManage
        onCancelContract={onCancelContract}
        onEdit={onEdit}
        onTransition={onTransition}
        sales={allSales}
      />,
    );
  });
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  document.body.querySelectorAll('[data-radix-portal]').forEach((portal) => portal.remove());
  vi.restoreAllMocks();
});

function rowByCode(code: string): HTMLTableRowElement {
  const rows = [...container.querySelectorAll('tbody tr')];
  const row = rows.find((candidate) => candidate.textContent?.includes(code));
  if (!(row instanceof HTMLTableRowElement)) throw new Error(`row not found: ${code}`);
  return row;
}

function buttonByTextIn(scope: Element, label: string): HTMLButtonElement {
  const match = [...scope.querySelectorAll('button')].find(
    (candidate) => candidate.textContent?.trim() === label,
  );
  if (!(match instanceof HTMLButtonElement)) throw new Error(`button not found: ${label}`);
  return match;
}

function buttonByTextInOrNull(scope: Element, label: string): HTMLButtonElement | null {
  return (
    [...scope.querySelectorAll('button')].find(
      (candidate) => candidate.textContent?.trim() === label,
    ) ?? null
  );
}

// The confirmation AlertDialog renders after the table in DOM order and can share
// button labels with the row's own dropdown item (e.g. "Reabrir", "Cancelar contrato"),
// so the confirm action is always the LAST matching button in the document.
function confirmActionButton(label: string): HTMLButtonElement {
  const matches = [...container.querySelectorAll('button')].filter(
    (candidate) => candidate.textContent?.trim() === label,
  );
  const match = matches.at(-1);
  if (!(match instanceof HTMLButtonElement)) throw new Error(`confirm button not found: ${label}`);
  return match;
}

async function click(element: HTMLElement) {
  await act(async () => element.dispatchEvent(new MouseEvent('click', { bubbles: true })));
}

describe('sales transition row actions', () => {
  it('marks an open proposta as ganha without confirmation', async () => {
    const row = rowByCode('P-002');
    await click(buttonByTextIn(row, 'Marcar como ganha'));

    expect(onTransition).toHaveBeenCalledWith(openSale, 'won');
    expect(container.textContent).not.toContain('Marcar proposta como perdida?');
  });

  it('confirms before marking as perdida', async () => {
    const row = rowByCode('P-002');
    await click(buttonByTextIn(row, 'Marcar como perdida'));

    expect(onTransition).not.toHaveBeenCalled();
    expect(container.textContent).toContain('Marcar proposta como perdida?');

    await click(confirmActionButton('Marcar como perdida'));
    expect(onTransition).toHaveBeenCalledWith(openSale, 'lost');
  });

  it('confirms and voids on cancel', async () => {
    const row = rowByCode('P-002');
    await click(buttonByTextIn(row, 'Cancelar'));

    expect(container.textContent).toContain('anuladas');
    await click(confirmActionButton('Cancelar proposta'));
    expect(onTransition).toHaveBeenCalledWith(openSale, 'cancelled');
  });

  it('reopens a won proposta only after confirmation', async () => {
    const wonRow = rowByCode('P-003');
    await click(buttonByTextIn(wonRow, 'Reabrir'));
    expect(container.textContent).toContain('Reabrir proposta ganha?');
    await click(confirmActionButton('Reabrir'));
    expect(onTransition).toHaveBeenCalledWith(wonRecurringSale, 'open');

    onTransition.mockClear();
    const lostRow = rowByCode('P-004');
    await click(buttonByTextIn(lostRow, 'Reabrir'));
    expect(onTransition).toHaveBeenCalledWith(lostSale, 'open');
    expect(container.textContent).not.toContain('Reabrir proposta ganha?');
  });

  it('offers cancelar contrato only for won recurring', async () => {
    const wonRecurringRow = rowByCode('P-003');
    expect(buttonByTextInOrNull(wonRecurringRow, 'Cancelar contrato')).not.toBeNull();

    const wonFlatRow = rowByCode('P-006');
    expect(buttonByTextInOrNull(wonFlatRow, 'Cancelar contrato')).toBeNull();

    await click(buttonByTextIn(wonRecurringRow, 'Cancelar contrato'));
    expect(container.textContent).toContain('Cancelar contrato?');
    await click(confirmActionButton('Cancelar contrato'));
    expect(onCancelContract).toHaveBeenCalledWith(wonRecurringSale);
  });

  it('routes edit to the wizard for draft and open only', async () => {
    const draftRow = rowByCode('P-001');
    await click(buttonByTextIn(draftRow, 'Editar'));
    expect(onEdit).toHaveBeenCalledWith(draftSale);

    expect(buttonByTextInOrNull(rowByCode('P-003'), 'Editar')).toBeNull();
    expect(buttonByTextInOrNull(rowByCode('P-004'), 'Editar')).toBeNull();
    expect(buttonByTextInOrNull(rowByCode('P-005'), 'Editar')).toBeNull();
  });

  it('cancel button closes without mutating', async () => {
    const row = rowByCode('P-002');
    await click(buttonByTextIn(row, 'Marcar como perdida'));
    expect(container.textContent).toContain('Marcar proposta como perdida?');

    await click(buttonByTextIn(container, 'Voltar'));

    expect(onTransition).not.toHaveBeenCalled();
    expect(onCancelContract).not.toHaveBeenCalled();
    expect(onEdit).not.toHaveBeenCalled();
    expect(container.textContent).not.toContain('Marcar proposta como perdida?');
  });
});
