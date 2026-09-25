// @vitest-environment happy-dom

import * as React from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MutationErrorBanner } from '../../MutationErrorBanner';
import { MUTATION_ERROR_COPY } from '../../mutation-error-copy';
import { buildTargetDescriptions } from '../settlement-format';
import { lockedRowLines } from '../settlement-errors';

/**
 * A proposta that cannot leave `Ganha` (or cancel its contract) because rows
 * carry an active baixa names those rows inside slice 07's one page-level
 * surface, `MutationErrorBanner`: from the bootstrap first, the server label as
 * the fallback, and never by id.
 */

const act = (React as typeof React & { act: typeof import('react-dom/test-utils').act }).act;

const DESCRIPTIONS = buildTargetDescriptions(
  [
    {
      id: 'rec-1',
      saleId: 'sale-1',
      label: '1/3',
      dueDate: '2026-09-01T00:00:00.000Z',
      amountBrl: 100000,
      method: 'pix',
      status: 'paid',
    },
    {
      id: 'rec-2',
      saleId: 'sale-1',
      label: '2/3',
      dueDate: '2026-10-01T00:00:00.000Z',
      amountBrl: 100000,
      method: 'pix',
      status: 'paid',
    },
  ],
  [
    {
      id: 'pay-1',
      saleId: 'sale-1',
      beneficiaryName: 'Ana Martins',
      kind: 'seller_commission',
      receivableId: 'rec-1',
      dueDate: '2026-09-01T00:00:00.000Z',
      amountBrl: 8000,
      status: 'paid',
    },
    {
      id: 'pay-2',
      saleId: 'sale-1',
      beneficiaryName: 'Ana Martins',
      kind: 'seller_commission',
      receivableId: 'rec-2',
      dueDate: '2026-10-01T00:00:00.000Z',
      amountBrl: 8000,
      status: 'paid',
    },
  ],
);

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
});

describe('sale action error', () => {
  it('names the blocking rows when a proposta cannot leave Ganha', async () => {
    const error = {
      status: 409,
      error: 'sale_has_active_settlements',
      rows: [
        { kind: 'receivable', id: 'rec-1', label: '1/3' },
        { kind: 'payable', id: 'pay-1', label: 'Ana Martins (1/3)' },
        { kind: 'payable', id: 'pay-2', label: 'Ana Martins (2/3)' },
        { kind: 'receivable', id: 'rec-9', label: '3/3' },
      ],
    };

    await act(async () =>
      root.render(
        <MutationErrorBanner
          error={error}
          lines={lockedRowLines(error, DESCRIPTIONS)}
          onDismiss={vi.fn()}
        />,
      ),
    );

    const alert = container.querySelector('[role="alert"]');
    const lines = [...(alert?.querySelectorAll('[data-mutation-error-lines] li') ?? [])].map(
      (node) => node.textContent,
    );
    expect(alert?.textContent).toContain(MUTATION_ERROR_COPY.saleHasActiveSettlements);
    // Two commissions to the same person stay distinguishable by their parcela.
    expect(lines).toEqual([
      'Parcela 1/3',
      'Comissão do vendedor · Ana Martins · Parcela 1/3',
      'Comissão do vendedor · Ana Martins · Parcela 2/3',
      'Parcela 3/3',
    ]);
    expect(new Set(lines).size).toBe(lines.length);
    for (const id of ['rec-1', 'pay-1', 'pay-2', 'rec-9']) {
      expect(alert?.textContent).not.toContain(id);
    }
  });

  it('adds no lines for any other failure', async () => {
    const forbidden = { status: 403, error: 'forbidden' };
    const failure = { status: 500, error: 'request_failed' };
    const otherConflict = {
      status: 409,
      error: 'invalid_status_change',
      rows: [{ kind: 'receivable', id: 'rec-1', label: '1/3' }],
    };

    expect(lockedRowLines(forbidden, DESCRIPTIONS)).toEqual([]);
    expect(lockedRowLines(failure, DESCRIPTIONS)).toEqual([]);
    expect(lockedRowLines(otherConflict, DESCRIPTIONS)).toEqual([]);
    expect(lockedRowLines(null, DESCRIPTIONS)).toEqual([]);

    await act(async () =>
      root.render(
        <MutationErrorBanner
          error={forbidden}
          lines={lockedRowLines(forbidden, DESCRIPTIONS)}
          onDismiss={vi.fn()}
        />,
      ),
    );
    expect(container.querySelector('[role="alert"]')).not.toBeNull();
    expect(container.querySelector('[data-mutation-error-lines]')).toBeNull();
  });
});
