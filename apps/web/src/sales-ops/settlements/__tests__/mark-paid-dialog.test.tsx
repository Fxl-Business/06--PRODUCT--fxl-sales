// @vitest-environment happy-dom

import * as React from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MarkPaidDialog } from '../MarkPaidDialog';
import type { SettlementTarget } from '../settlement-format';

/**
 * `Marcar como pago`, driven through the REAL `Dialog`.
 *
 * The clock is pinned at 2026-09-24T01:30:00Z, which is still 2026-09-23 in
 * São Paulo: the one instant where the UTC day and the civil day disagree.
 */

const act = (React as typeof React & { act: typeof import('react-dom/test-utils').act }).act;

const TARGET: SettlementTarget = {
  kind: 'receivable',
  id: 'rec-2',
  saleId: 'sale-1',
  saleCode: '0001-AGN',
  saleStatus: 'won',
  description: 'Parcela 2/3',
  amountBrl: 150000,
  status: 'open',
  paidOn: null,
};

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  (
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-09-24T01:30:00.000Z'));
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  document.body.querySelectorAll('[role="dialog"]').forEach((node) => node.remove());
  vi.useRealTimers();
  vi.restoreAllMocks();
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

async function typeInto(field: HTMLInputElement, value: string) {
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    setter?.call(field, value);
    field.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await settle();
}

function dialogNode(): Element {
  const node = document.querySelector('[role="dialog"]');
  if (!node) throw new Error('dialog not rendered');
  return node;
}

function dateInput(): HTMLInputElement {
  const node = document.getElementById('settlement-paid-on');
  if (!(node instanceof HTMLInputElement)) throw new Error('date input not found');
  return node;
}

function confirmButton(): HTMLButtonElement {
  const node = dialogNode().querySelector('[data-settlement-confirm]');
  if (!(node instanceof HTMLButtonElement)) throw new Error('confirm button not found');
  return node;
}

function alertText(): string | null | undefined {
  return dialogNode().querySelector('[data-settlement-error]')?.textContent;
}

async function renderDialog(overrides: {
  onConfirm?: (payload: unknown) => Promise<unknown>;
  onOpenChange?: (open: boolean) => void;
} = {}) {
  const onConfirm = vi.fn(overrides.onConfirm ?? (async () => ({})));
  const onOpenChange = vi.fn(overrides.onOpenChange ?? (() => undefined));
  await act(async () =>
    root.render(
      <MarkPaidDialog onConfirm={onConfirm} onOpenChange={onOpenChange} open target={TARGET} />,
    ),
  );
  await settle();
  return { onConfirm, onOpenChange };
}

describe('MarkPaidDialog', () => {
  it('defaults the payment date to the São Paulo day, not the UTC day', async () => {
    await renderDialog();

    expect(dateInput().value).toBe('2026-09-23');
    expect(dateInput().max).toBe('2026-09-23');
    expect(dialogNode().textContent).toContain('Parcela 2/3 · Proposta 0001-AGN');
  });

  it('refuses a future payment date before calling the API', async () => {
    const { onConfirm } = await renderDialog();

    await typeInto(dateInput(), '2026-09-24');

    expect(alertText()).toBe('A data de pagamento não pode ser no futuro.');
    expect(confirmButton().disabled).toBe(true);
    await click(confirmButton());
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('refuses an empty or impossible payment date', async () => {
    const { onConfirm } = await renderDialog();

    await typeInto(dateInput(), '');

    expect(alertText()).toBe('Informe uma data de pagamento válida.');
    expect(confirmButton().disabled).toBe(true);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('confirms with the chosen civil day and the target, never an amount', async () => {
    const { onConfirm, onOpenChange } = await renderDialog();

    await typeInto(dateInput(), '2026-09-20');
    await click(confirmButton());

    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onConfirm.mock.calls[0]?.[0]).toStrictEqual({
      targetKind: 'receivable',
      targetId: 'rec-2',
      paidOn: '2026-09-20',
    });
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('shows the full open amount read-only', async () => {
    await renderDialog();

    const amount = dialogNode().querySelector('[data-settlement-amount]');
    expect(amount?.textContent?.replace(/\u00a0/g, ' ')).toBe('R$ 1.500,00');
    const inputs = [...dialogNode().querySelectorAll('input, textarea')];
    expect(inputs).toEqual([dateInput()]);
  });

  it('renders the server 422 paid_on_in_future message and stays open', async () => {
    const { onOpenChange } = await renderDialog({
      onConfirm: async () => {
        throw { status: 422, error: 'paid_on_in_future' };
      },
    });

    await click(confirmButton());

    expect(alertText()).toBe('A data de pagamento não pode ser no futuro.');
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
    expect(confirmButton().disabled).toBe(false);
  });

  it('renders a settlement 409 inside the dialog and stays open', async () => {
    const { onOpenChange } = await renderDialog({
      onConfirm: async () => {
        throw { status: 409, error: 'already_paid' };
      },
    });

    await click(confirmButton());

    expect(alertText()).toBe('Esta linha já está paga. Atualize a página para ver o pagamento.');
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
  });

  it('keeps one activation behaviour: every footer button is type=button', async () => {
    await renderDialog();

    const buttons = [...dialogNode().querySelectorAll('button')].filter(
      (node) => node.textContent?.trim() === 'Cancelar' || node.hasAttribute('data-settlement-confirm'),
    );
    expect(buttons).toHaveLength(2);
    for (const button of buttons) expect(button.getAttribute('type')).toBe('button');

    await typeInto(dateInput(), '2026-09-24');
    expect(confirmButton().getAttribute('type')).toBe('button');
  });
});
