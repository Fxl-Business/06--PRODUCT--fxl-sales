// @vitest-environment happy-dom

import * as React from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SalesOpsSettlement } from '../../types';
import type { SettlementTarget } from '../settlement-format';
import { PaidOnNote, SettlementRowActions } from '../SettlementRowActions';

/**
 * The admin row actions. Which action a row offers is a pure function of the
 * row and its proposta; the mutations and the history read are mocked at the
 * hook seam so the REAL dialogs run end to end.
 */

const record = vi.fn(async (_payload: unknown) => ({}));
const reverse = vi.fn(async (_payload: unknown) => ({}));
let history: SalesOpsSettlement[] = [];

vi.mock('../../hooks', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../hooks')>()),
  useRecordSalesOpsSettlement: () => ({ mutateAsync: record, isPending: false }),
  useReverseSalesOpsSettlement: () => ({ mutateAsync: reverse, isPending: false }),
  useSaleSettlements: () => ({ data: history, isLoading: false, isError: false }),
}));

const act = (React as typeof React & { act: typeof import('react-dom/test-utils').act }).act;

function target(overrides: Partial<SettlementTarget> = {}): SettlementTarget {
  return {
    kind: 'receivable',
    id: 'rec-1',
    saleId: 'sale-1',
    saleCode: '0001-AGN',
    saleStatus: 'won',
    description: 'Parcela 1/3',
    amountBrl: 150000,
    status: 'open',
    paidOn: null,
    ...overrides,
  };
}

function baixa(overrides: Partial<SalesOpsSettlement> & Pick<SalesOpsSettlement, 'id'>): SalesOpsSettlement {
  return {
    saleId: 'sale-1',
    targetKind: 'receivable',
    receivableId: 'rec-1',
    payableId: null,
    type: 'baixa',
    reversesSettlementId: null,
    reversedBySettlementId: null,
    paidOn: '2026-09-23',
    amountBrl: 150000,
    origin: 'manual',
    actorName: 'Ana',
    recordedAt: '2026-09-23T15:00:00.000Z',
    reason: null,
    ...overrides,
  };
}

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  (
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  history = [];
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  document.body.querySelectorAll('[role="dialog"]').forEach((node) => node.remove());
  vi.useRealTimers();
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

async function typeReason(value: string) {
  const field = document.getElementById('settlement-reverse-reason');
  if (!(field instanceof HTMLTextAreaElement)) throw new Error('reason field not found');
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
    setter?.call(field, value);
    field.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await settle();
}

function action(name: 'mark-paid' | 'reverse' | 'history'): HTMLButtonElement | null {
  return container.querySelector<HTMLButtonElement>(`[data-settlement-action="${name}"]`);
}

async function renderRow(row: SettlementTarget, withHistory = false) {
  await act(async () =>
    root.render(
      <div>
        <PaidOnNote paidOn={row.paidOn} status={row.status} />
        <SettlementRowActions target={row} withHistory={withHistory} />
      </div>,
    ),
  );
  await settle();
}

describe('SettlementRowActions', () => {
  it('offers Marcar como pago on an open row of a won proposta', async () => {
    await renderRow(target());

    expect(action('mark-paid')?.textContent).toBe('Marcar como pago');
    expect(action('mark-paid')?.getAttribute('type')).toBe('button');
    expect(action('reverse')).toBeNull();
    expect(action('history')).toBeNull();
    expect(container.querySelector('[data-paid-on]')).toBeNull();
  });

  it('shows Pago em and Estornar on a paid row', async () => {
    await renderRow(target({ status: 'paid', paidOn: '2026-09-23' }));

    expect(container.querySelector('[data-paid-on]')?.textContent).toBe('Pago em 23/09/2026');
    expect(action('reverse')?.textContent).toBe('Estornar');
    expect(action('mark-paid')).toBeNull();
  });

  it('reverse posts the reason for the active baixa', async () => {
    history = [
      baixa({ id: 'b0', paidOn: '2026-09-01', reversedBySettlementId: 'e0' }),
      baixa({ id: 'e0', type: 'estorno', paidOn: '2026-09-02', reversesSettlementId: 'b0' }),
      baixa({ id: 'b1', paidOn: '2026-09-23' }),
      baixa({ id: 'bx', receivableId: 'rec-other', paidOn: '2026-09-24' }),
    ];
    await renderRow(target({ status: 'paid', paidOn: '2026-09-23' }));

    await click(action('reverse') as HTMLButtonElement);
    await typeReason('Duplicado');
    const confirm = document.querySelector('[data-settlement-reverse-confirm]');
    await click(confirm as HTMLButtonElement);

    expect(reverse).toHaveBeenCalledTimes(1);
    expect(reverse.mock.calls[0]?.[0]).toStrictEqual({ settlementId: 'b1', reason: 'Duplicado' });
  });

  it('submit posts the São Paulo day for the row', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-09-24T01:30:00.000Z'));
    await renderRow(target({ kind: 'payable', id: 'pay-1', description: 'Comissão do vendedor · Ana' }));

    await click(action('mark-paid') as HTMLButtonElement);
    const confirm = document.querySelector('[data-settlement-confirm]');
    await click(confirm as HTMLButtonElement);

    expect(record).toHaveBeenCalledTimes(1);
    expect(record.mock.calls[0]?.[0]).toStrictEqual({
      targetKind: 'payable',
      targetId: 'pay-1',
      paidOn: '2026-09-23',
    });
  });

  it('offers no baixa on an open row of a proposta that is not won', async () => {
    await renderRow(target({ saleStatus: 'open' }));

    expect(action('mark-paid')).toBeNull();
    expect(action('reverse')).toBeNull();
  });

  it('offers nothing on a void row', async () => {
    await renderRow(target({ status: 'void' }), true);

    expect(container.querySelectorAll('button')).toHaveLength(0);
  });

  it('offers no Estornar on a paid row without paidOn', async () => {
    await renderRow(target({ status: 'paid', paidOn: null }));

    expect(action('reverse')).toBeNull();
    expect(action('mark-paid')).toBeNull();
    expect(container.querySelector('[data-paid-on]')).toBeNull();
  });

  it('opens the row history with only that row and no id', async () => {
    history = [
      baixa({ id: 'b1', paidOn: '2026-09-23' }),
      baixa({ id: 'bx', receivableId: 'rec-other', paidOn: '2026-09-10' }),
    ];
    await renderRow(target({ status: 'paid', paidOn: '2026-09-23' }), true);

    await click(action('history') as HTMLButtonElement);

    const dialog = document.querySelector('[role="dialog"]');
    expect(dialog?.textContent).toContain('Histórico de pagamentos');
    expect(dialog?.querySelectorAll('li[data-settlement-entry]')).toHaveLength(1);
    expect(dialog?.textContent).not.toMatch(/rec-|b1|bx/);
  });

  it('keeps a row click from reaching the row behind it', async () => {
    const rowClick = vi.fn();
    await act(async () =>
      root.render(
        <div onClick={rowClick}>
          <SettlementRowActions target={target()} withHistory />
        </div>,
      ),
    );
    await settle();

    await click(action('mark-paid') as HTMLButtonElement);
    await click(document.querySelector('[data-settlement-confirm]') as HTMLButtonElement);
    await click(action('history') as HTMLButtonElement);

    expect(rowClick).not.toHaveBeenCalled();
  });
});
