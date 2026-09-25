// @vitest-environment happy-dom

import * as React from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { SalesOpsSettlement } from '../../types';
import { SettlementHistoryList } from '../SettlementHistory';

/**
 * The settlement history names the AUTHOR by the snapshotted `actor_name` and
 * never by an account id, and it names every date as a civil day except the
 * recorded instant, which is a São Paulo wall clock.
 */

const act = (React as typeof React & { act: typeof import('react-dom/test-utils').act }).act;

const BAIXA_REVERSED: SalesOpsSettlement = {
  id: 'settle-b1',
  saleId: 'sale-1',
  targetKind: 'receivable',
  receivableId: 'rec-1',
  payableId: null,
  type: 'baixa',
  reversesSettlementId: null,
  reversedBySettlementId: 'settle-e1',
  paidOn: '2026-09-20',
  amountBrl: 150000,
  origin: 'manual',
  actorName: 'Ana Martins',
  recordedAt: '2026-09-21T01:10:00.000Z',
  reason: null,
};

const ESTORNO: SalesOpsSettlement = {
  ...BAIXA_REVERSED,
  id: 'settle-e1',
  type: 'estorno',
  reversesSettlementId: 'settle-b1',
  reversedBySettlementId: null,
  paidOn: '2026-09-22',
  actorName: 'Bruno Lima',
  recordedAt: '2026-09-22T18:30:00.000Z',
  reason: 'Pagamento em duplicidade',
};

const BAIXA_ACTIVE: SalesOpsSettlement = {
  ...BAIXA_REVERSED,
  id: 'settle-b2',
  targetKind: 'payable',
  receivableId: null,
  payableId: 'pay-1',
  reversedBySettlementId: null,
  paidOn: '2026-09-23',
  amountBrl: 24000,
  actorName: null,
  recordedAt: '2026-09-23T13:00:00.000Z',
};

const DESCRIPTIONS = new Map([
  ['rec-1', 'Parcela 1/3'],
  ['pay-1', 'Comissão do vendedor · Ana Martins'],
]);

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

async function renderList(entries: readonly SalesOpsSettlement[], showTarget = true) {
  await act(async () =>
    root.render(
      <SettlementHistoryList descriptions={DESCRIPTIONS} entries={entries} showTarget={showTarget} />,
    ),
  );
}

function items(): HTMLLIElement[] {
  return [...container.querySelectorAll<HTMLLIElement>('li[data-settlement-entry]')];
}

function text(node: Element | null | undefined): string {
  return (node?.textContent ?? '').replace(/\u00a0/g, ' ');
}

describe('SettlementHistoryList', () => {
  it('lists baixas and estornos with civil date, amount, author and recorded time', async () => {
    await renderList([ESTORNO, BAIXA_REVERSED]);

    const [estorno, baixa] = items();
    expect(estorno?.getAttribute('data-settlement-entry')).toBe('estorno');
    expect(text(estorno)).toContain('Estorno');
    expect(text(estorno)).toContain('Parcela 1/3');
    expect(text(estorno)).toContain('Estornado em 22/09/2026');
    expect(text(estorno)).toContain('R$ 1.500,00');
    expect(text(estorno)).toContain('Bruno Lima');
    expect(text(estorno)).toContain('Registrado em 22/09/2026 às 15:30');

    expect(baixa?.getAttribute('data-settlement-entry')).toBe('baixa');
    expect(text(baixa)).toContain('Baixa');
    expect(text(baixa)).toContain('Pago em 20/09/2026');
    expect(text(baixa)).toContain('Ana Martins');
    // 01:10Z on the 21st is still the 20th in São Paulo.
    expect(text(baixa)).toContain('Registrado em 20/09/2026 às 22:10');
  });

  it('never renders the raw actor account id', async () => {
    const leaked = { ...BAIXA_ACTIVE, actorUserId: 'user_2xYzSecretId' } as SalesOpsSettlement;
    await renderList([leaked, ESTORNO, BAIXA_REVERSED]);

    const all = text(container);
    expect(all).not.toContain('user_2xYzSecretId');
    for (const id of ['settle-b1', 'settle-b2', 'settle-e1', 'rec-1', 'pay-1', 'sale-1']) {
      expect(all).not.toContain(id);
    }
  });

  it('falls back to Autor não identificado when actor_name is null', async () => {
    await renderList([BAIXA_ACTIVE]);

    expect(text(items()[0])).toContain('Autor não identificado');
    expect(text(items()[0])).toContain('Comissão do vendedor · Ana Martins');
  });

  it('marks a reversed baixa as Estornada', async () => {
    await renderList([BAIXA_REVERSED, BAIXA_ACTIVE]);

    expect(text(items()[0])).toContain('Estornada');
    expect(text(items()[1])).not.toContain('Estornada');
  });

  it('shows the reason only on an estorno that has one', async () => {
    await renderList([ESTORNO, { ...ESTORNO, id: 'settle-e2', reason: null }, BAIXA_ACTIVE]);

    expect(text(items()[0])).toContain('Motivo: Pagamento em duplicidade');
    expect(text(items()[1])).not.toContain('Motivo');
    expect(text(items()[2])).not.toContain('Motivo');
  });

  it('hides the target when the list already belongs to one row', async () => {
    await renderList([BAIXA_ACTIVE], false);

    expect(text(items()[0])).not.toContain('Comissão do vendedor');
  });

  it('names a removed row and says when there is nothing to show', async () => {
    await renderList([{ ...BAIXA_ACTIVE, payableId: 'pay-gone' }]);
    expect(text(items()[0])).toContain('Linha removida');

    await renderList([]);
    expect(text(container)).toContain('Nenhum pagamento registrado.');
  });
});
