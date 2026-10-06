// @vitest-environment happy-dom

import * as React from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LeadsBoard } from '../LeadsBoard';
import { buildLabelLookups } from '../board-labels';
import { formatMoneyBrl } from '../../calculations';
import type { SalesOpsLead, SalesOpsLeadStage } from '../types';

const NOVO_ID = 'cccccccc-0000-4000-8000-000000000001';
const QUAL_ID = 'cccccccc-0000-4000-8000-000000000002';
const CONV_ID = 'cccccccc-0000-4000-8000-000000000003';

const NOW = new Date('2026-09-21T12:00:00.000Z');

const act = (React as typeof React & { act: typeof import('react-dom/test-utils').act }).act;

function stage(
  id: string,
  name: string,
  kind: SalesOpsLeadStage['kind'],
  position: number,
): SalesOpsLeadStage {
  return {
    id,
    name,
    kind,
    position,
    status: 'active',
    isSystem: kind !== 'normal',
    archivedAt: null,
    orgId: 'org-1',
    createdAt: '2026-09-01T12:00:00.000Z',
    updatedAt: null,
  };
}

const STAGES: SalesOpsLeadStage[] = [
  stage(NOVO_ID, 'Novo', 'normal', 1),
  stage(QUAL_ID, 'Qualificado', 'normal', 2),
  stage(CONV_ID, 'Proposta', 'conversion', 3),
];

const LOOKUPS = buildLabelLookups({ clients: [], people: [], products: [] });

function lead(id: string, stageId: string, value: number, patch: Partial<SalesOpsLead> = {}) {
  return {
    id,
    stageId,
    position: 1,
    contactName: `Contato ${id}`,
    clientId: null,
    clientNameSnapshot: 'Acme',
    estimatedValueBrl: value,
    description: null,
    contactPhone: null,
    contactEmail: null,
    contactBirthDate: null,
    sellerPersonId: null,
    sellerNameSnapshot: 'Marina Souza',
    lostReason: null,
    stageChangedAt: '2026-09-15T12:00:00.000Z',
    saleId: null,
    saleStatus: null,
    saleCode: null,
    products: [],
    createdAt: '2026-09-01T12:00:00.000Z',
    updatedAt: null,
    ...patch,
  } as SalesOpsLead;
}

const LEADS = [
  lead('l1', NOVO_ID, 100_000),
  lead('l2', NOVO_ID, 200_000, { position: 2 }),
  lead('l3', QUAL_ID, 500_000),
  lead('l4', CONV_ID, 900_000, { saleId: 'sale-1', saleStatus: 'won', saleCode: '0001-1' }),
];

const brl0 = (c: number) =>
  formatMoneyBrl(c, { minimumFractionDigits: 0, maximumFractionDigits: 0 });

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  document.body.innerHTML = '';
});

async function renderBoard(onEditLead = vi.fn(), onOpenSale = vi.fn()) {
  await act(async () => {
    root.render(
      <LeadsBoard
        leads={LEADS}
        lookups={LOOKUPS}
        now={NOW}
        onEditLead={onEditLead}
        onMoveLead={vi.fn()}
        onOpenSale={onOpenSale}
        stages={STAGES}
      />,
    );
  });
  return { onEditLead, onOpenSale };
}

async function click(selector: string) {
  const node = container.querySelector<HTMLElement>(selector);
  expect(node, selector).not.toBeNull();
  await act(async () => {
    node?.click();
  });
}

const rows = () => [...container.querySelectorAll('[data-list-row]')];

describe('Quadro / Lista toggle', () => {
  it('defaults to the board and swaps to the list, hiding the board', async () => {
    await renderBoard();
    expect(container.querySelector('[data-stage-column]')).not.toBeNull();
    expect(container.querySelector('[data-leads-list]')).toBeNull();

    await click('[data-view-option="list"]');
    expect(container.querySelector('[data-leads-list]')).not.toBeNull();
    expect(container.querySelector('[data-stage-column]')).toBeNull();
    expect(rows()).toHaveLength(4);

    await click('[data-view-option="board"]');
    expect(container.querySelector('[data-stage-column]')).not.toBeNull();
    expect(container.querySelector('[data-leads-list]')).toBeNull();
  });

  it('renders phase chips with totals and counts', async () => {
    await renderBoard();
    await click('[data-view-option="list"]');
    const all = container.querySelector('[data-phase-chip=""]');
    expect(all?.textContent).toContain(brl0(1_700_000));
    expect(all?.querySelector('[data-phase-count]')?.textContent).toBe('4');
    expect(container.querySelector(`[data-phase-chip="${NOVO_ID}"]`)?.textContent).toContain(
      brl0(300_000),
    );
    expect(container.querySelector(`[data-phase-chip="${QUAL_ID}"]`)?.textContent).toContain(
      brl0(500_000),
    );
    expect(container.querySelector(`[data-phase-chip="${CONV_ID}"]`)).not.toBeNull();
  });

  it('filters by chip and shows the footer total and scope', async () => {
    await renderBoard();
    await click('[data-view-option="list"]');
    expect(container.querySelector('[data-list-total]')?.textContent).toBe(brl0(1_700_000));
    expect(container.querySelector('[data-leads-list]')?.textContent).toContain(
      'Todas as fases · 4 leads',
    );

    await click(`[data-phase-chip="${NOVO_ID}"]`);
    expect(rows()).toHaveLength(2);
    expect(container.querySelector('[data-list-total]')?.textContent).toBe(brl0(300_000));
    expect(container.querySelector('[data-leads-list]')?.textContent).toContain('Novo · 2 leads');

    await click('[data-phase-chip=""]');
    expect(rows()).toHaveLength(4);
  });

  it('carries Mover and Editar actions; Editar calls onEditLead, Mover opens the dialog', async () => {
    const { onEditLead } = await renderBoard();
    await click('[data-view-option="list"]');
    expect(container.querySelector('[data-move-trigger="l1"]')).not.toBeNull();
    await click('[data-edit-lead="l1"]');
    expect(onEditLead).toHaveBeenCalledTimes(1);
    await click('[data-move-trigger="l1"]');
    expect(document.querySelector('[role="dialog"]')).not.toBeNull();
  });

  it('keeps the selected phase across a round trip to the board', async () => {
    await renderBoard();
    await click('[data-view-option="list"]');
    await click(`[data-phase-chip="${QUAL_ID}"]`);
    await click('[data-view-option="board"]');
    await click('[data-view-option="list"]');
    expect(
      container.querySelector(`[data-phase-chip="${QUAL_ID}"]`)?.getAttribute('aria-pressed'),
    ).toBe('true');
    expect(rows()).toHaveLength(1);
  });

  it('shows the proposta link for a converted row and no Mover', async () => {
    const { onOpenSale } = await renderBoard();
    await click('[data-view-option="list"]');
    const open = container.querySelector('[data-open-sale="sale-1"]');
    expect(open?.textContent).toContain('0001-1');
    expect(container.querySelector('[data-move-trigger="l4"]')).toBeNull();
    await click('[data-open-sale="sale-1"]');
    expect(onOpenSale).toHaveBeenCalledWith('sale-1');
  });
});
