// @vitest-environment happy-dom

import * as React from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SalesOpsSettlement } from '../../types';
import { ReverseSettlementDialog } from '../ReverseSettlementDialog';
import type { SettlementTarget } from '../settlement-format';

/** `Estornar pagamento`, driven through the REAL `Dialog`. */

const act = (React as typeof React & { act: typeof import('react-dom/test-utils').act }).act;

const TARGET: SettlementTarget = {
  kind: 'receivable',
  id: 'rec-1',
  saleId: 'sale-1',
  saleCode: '0001-AGN',
  saleStatus: 'won',
  description: 'Parcela 1/3',
  amountBrl: 150000,
  status: 'paid',
  paidOn: '2026-09-20',
};

const BAIXA: SalesOpsSettlement = {
  id: 'b1',
  saleId: 'sale-1',
  targetKind: 'receivable',
  receivableId: 'rec-1',
  payableId: null,
  type: 'baixa',
  reversesSettlementId: null,
  reversedBySettlementId: null,
  paidOn: '2026-09-20',
  amountBrl: 150000,
  origin: 'manual',
  actorName: 'Ana',
  recordedAt: '2026-09-20T15:00:00.000Z',
  reason: null,
};

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

function dialogNode(): Element {
  const node = document.querySelector('[role="dialog"]');
  if (!node) throw new Error('dialog not rendered');
  return node;
}

function confirmButton(): HTMLButtonElement {
  const node = dialogNode().querySelector('[data-settlement-reverse-confirm]');
  if (!(node instanceof HTMLButtonElement)) throw new Error('confirm button not found');
  return node;
}

async function renderDialog(
  props: {
    activeBaixa?: SalesOpsSettlement | null;
    loading?: boolean;
    onConfirm?: (payload: unknown) => Promise<unknown>;
  } = {},
) {
  const onConfirm = vi.fn(props.onConfirm ?? (async () => ({})));
  const onOpenChange = vi.fn();
  await act(async () =>
    root.render(
      <ReverseSettlementDialog
        activeBaixa={props.activeBaixa === undefined ? BAIXA : props.activeBaixa}
        loading={props.loading ?? false}
        onConfirm={onConfirm}
        onOpenChange={onOpenChange}
        open
        target={TARGET}
      />,
    ),
  );
  await settle();
  return { onConfirm, onOpenChange };
}

describe('ReverseSettlementDialog', () => {
  it('reverses the active baixa with the typed reason', async () => {
    const { onConfirm, onOpenChange } = await renderDialog();

    expect(dialogNode().textContent?.replace(/\u00a0/g, ' ')).toContain(
      'O pagamento de 20/09/2026 (R$ 1.500,00) será estornado e a linha volta a ficar em aberto.',
    );
    await typeReason('  Pagamento em duplicidade  ');
    await click(confirmButton());

    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onConfirm.mock.calls[0]?.[0]).toStrictEqual({
      settlementId: 'b1',
      reason: 'Pagamento em duplicidade',
    });
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('omits a blank reason', async () => {
    const { onConfirm } = await renderDialog();

    await typeReason('   ');
    await click(confirmButton());

    const payload = onConfirm.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(Object.keys(payload)).toEqual(['settlementId']);
    expect(payload.settlementId).toBe('b1');
  });

  it('caps the reason at the server limit', async () => {
    await renderDialog();

    const field = document.getElementById('settlement-reverse-reason') as HTMLTextAreaElement;
    expect(field.maxLength).toBe(500);
  });

  it('refuses to confirm when no active baixa exists', async () => {
    const { onConfirm } = await renderDialog({ activeBaixa: null });

    expect(dialogNode().textContent).toContain(
      'Nenhum pagamento ativo encontrado para esta linha. Atualize a página.',
    );
    expect(confirmButton().disabled).toBe(true);
    await click(confirmButton());
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('waits for the history before offering the estorno', async () => {
    await renderDialog({ activeBaixa: null, loading: true });

    expect(dialogNode().textContent).toContain('Carregando pagamento...');
    expect(confirmButton().disabled).toBe(true);
  });

  it('renders already_reversed from the server and stays open', async () => {
    const { onOpenChange } = await renderDialog({
      onConfirm: async () => {
        throw { status: 409, error: 'already_reversed' };
      },
    });

    await click(confirmButton());

    expect(dialogNode().querySelector('[data-settlement-error]')?.textContent).toBe(
      'Este pagamento já foi estornado.',
    );
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
  });
});
